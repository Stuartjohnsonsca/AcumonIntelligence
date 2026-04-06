import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

async function verifyAccess(engagementId: string, firmId: string | undefined, isSuperAdmin: boolean) {
  const e = await prisma.auditEngagement.findUnique({ where: { id: engagementId }, select: { firmId: true } });
  if (!e || (e.firmId !== firmId && !isSuperAdmin)) return null;
  return e;
}

// GET: Fetch payroll test data
export async function GET(req: NextRequest, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await params;
  if (!await verifyAccess(engagementId, session.user.firmId, session.user.isSuperAdmin)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const url = new URL(req.url);
  const fsLine = url.searchParams.get('fsLine') || 'Wages & Salaries';

  let test = await prisma.auditPayrollTest.findUnique({
    where: { engagementId_fsLine: { engagementId, fsLine } },
  });

  // Auto-create if not exists
  if (!test) {
    test = await prisma.auditPayrollTest.create({
      data: { engagementId, fsLine },
    });
  }

  // Also load TB rows for lead schedule population
  const tbRows = await prisma.auditTBRow.findMany({
    where: { engagementId },
    select: { accountCode: true, description: true, currentYear: true, priorYear: true, fsLevel: true },
  });

  // Load materiality
  const materiality = await prisma.auditMateriality.findFirst({ where: { engagementId } });
  const matData = (materiality?.data as any) || {};

  return NextResponse.json({
    test,
    tbRows: tbRows.map(r => ({ ...r, currentYear: Number(r.currentYear) || 0, priorYear: Number(r.priorYear) || 0 })),
    materiality: {
      overall: matData.materiality || 0,
      pm: matData.performanceMateriality || 0,
      ct: matData.clearlyTrivial || 0,
    },
  });
}

// POST: Actions — ingest, calculate, sign-off
export async function POST(req: NextRequest, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await params;
  if (!await verifyAccess(engagementId, session.user.firmId, session.user.isSuperAdmin)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const body = await req.json();
  const fsLine = body.fsLine || 'Wages & Salaries';

  let test = await prisma.auditPayrollTest.findUnique({
    where: { engagementId_fsLine: { engagementId, fsLine } },
  });
  if (!test) {
    test = await prisma.auditPayrollTest.create({ data: { engagementId, fsLine } });
  }

  // ─── Ingest payroll data (parsed CSV/Excel rows) ───
  if (body.action === 'ingest_payroll') {
    const { months } = body; // Array of monthly payroll summary objects
    const updated = await prisma.auditPayrollTest.update({
      where: { id: test.id },
      data: { payrollData: { months } as any, status: 'in_progress' },
    });
    return NextResponse.json({ test: updated });
  }

  // ─── Auto-populate lead schedule from TB ───
  if (body.action === 'populate_lead') {
    const { accountCodes } = body; // Array of TB account codes to include
    const tbRows = await prisma.auditTBRow.findMany({
      where: { engagementId, accountCode: { in: accountCodes } },
    });
    const leadRows = tbRows.map(r => ({
      accountCode: r.accountCode,
      accountName: r.description,
      cyBalance: Number(r.currentYear) || 0,
      adjustment: 0,
      finalCY: Number(r.currentYear) || 0,
      pyBalance: Number(r.priorYear) || 0,
      variance: (Number(r.currentYear) || 0) - (Number(r.priorYear) || 0),
      pct: (Number(r.priorYear) || 0) !== 0 ? ((Number(r.currentYear) || 0) - (Number(r.priorYear) || 0)) / Math.abs(Number(r.priorYear)) : 0,
      wpRef: '',
    }));
    const updated = await prisma.auditPayrollTest.update({
      where: { id: test.id },
      data: { leadSchedule: { rows: leadRows } as any },
    });
    return NextResponse.json({ test: updated });
  }

  // ─── Sign-off ───
  if (body.action === 'signoff' || body.action === 'unsignoff') {
    const { role, section } = body;
    const signOffs = (test.signOffs as Record<string, any>) || {};
    const key = section ? `${section}_${role}` : role;
    if (body.action === 'signoff') {
      signOffs[key] = { userId: session.user.id, userName: session.user.name || session.user.email, timestamp: new Date().toISOString() };
    } else {
      delete signOffs[key];
    }
    const updated = await prisma.auditPayrollTest.update({
      where: { id: test.id },
      data: { signOffs: signOffs as any },
    });
    return NextResponse.json({ test: updated });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}

// PUT: Update any section data
export async function PUT(req: NextRequest, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await params;
  if (!await verifyAccess(engagementId, session.user.firmId, session.user.isSuperAdmin)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const body = await req.json();
  const fsLine = body.fsLine || 'Wages & Salaries';

  const allowedFields = [
    'payrollData', 'leadSchedule', 'payrollRecon', 'hmrcRecon',
    'pensionsRecon', 'joiners', 'leavers', 'holidayPay',
    'errors', 'conclusion', 'auditorNotes', 'status',
  ];

  const data: Record<string, any> = {};
  for (const field of allowedFields) {
    if (body[field] !== undefined) data[field] = body[field];
  }

  const test = await prisma.auditPayrollTest.upsert({
    where: { engagementId_fsLine: { engagementId, fsLine } },
    create: { engagementId, fsLine, ...data },
    update: data,
  });

  return NextResponse.json({ test });
}
