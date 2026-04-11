import { NextResponse } from 'next/server';
import { assertEngagementWriteAccess } from '@/lib/auth/engagement-auth';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getPermanentFileSignOffs, handlePermanentFileSignOff, handlePermanentFileUnsignOff, savePermanentFileFieldMeta } from '@/lib/signoff-handler';

async function verifyAccess(engagementId: string, firmId: string | undefined, isSuperAdmin: boolean) {
  const e = await prisma.auditEngagement.findUnique({ where: { id: engagementId }, select: { firmId: true } });
  if (!e || (e.firmId !== firmId && !isSuperAdmin)) return null;
  return e;
}

export async function GET(req: Request, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await params;
  if (!await verifyAccess(engagementId, session.user.firmId, session.user.isSuperAdmin)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const url = new URL(req.url);
  if (url.searchParams.get('meta') === 'signoffs') {
    return getPermanentFileSignOffs(engagementId, 'par');
  }

  const dbRows = await prisma.auditPARRow.findMany({ where: { engagementId }, orderBy: { sortOrder: 'asc' } });
  // Map DB rows to include sendMgt object for the component
  const rows = dbRows.map(r => ({
    ...r,
    sendMgt: r.sendMgtData || { checked: r.sentToManagement },
  }));
  return NextResponse.json({ rows });
}

export async function PUT(req: Request, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await params;
  if (!await verifyAccess(engagementId, session.user.firmId, session.user.isSuperAdmin)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const __eqrGuard = await assertEngagementWriteAccess(engagementId, session);
  if (__eqrGuard instanceof NextResponse) return __eqrGuard;

  const body = await req.json();
  const { rows } = body as { rows: any[] };

  // Filter out section headers and sanitise data for DB
  const dataRows = (rows || []).filter((r: any) => !r.isSection);
  const existingIds = dataRows.filter((r: any) => r.id && !r.id.startsWith('section-')).map((r: any) => r.id);
  await prisma.auditPARRow.deleteMany({ where: { engagementId, id: { notIn: existingIds } } });

  for (const row of dataRows) {
    const sigChange = typeof row.significantChange === 'string'
      ? row.significantChange === 'Material'
      : (row.significantChange ?? false);
    const sendMgt = row.sendMgt?.checked ?? row.sentToManagement ?? false;

    const data = {
      particulars: row.particulars || '',
      currentYear: row.currentYear != null ? Number(row.currentYear) || null : null,
      priorYear: row.priorYear != null ? Number(row.priorYear) || null : null,
      absVariance: row.absVariance != null ? Number(row.absVariance) || null : null,
      absVariancePercent: row.absVariancePercent != null ? Number(row.absVariancePercent) || null : null,
      significantChange: sigChange,
      sentToManagement: sendMgt,
      sendMgtData: row.sendMgt || null,
      managementResponseStatus: row.managementResponseStatus || null,
      reasons: row.reasons || null,
      auditorView: row.auditorView || null,
      addedToRmm: row.addedToRmm ?? false,
      addedToRmmBy: row.addedToRmmBy || null,
      sortOrder: row.sortOrder ?? 0,
    };

    if (row.id && !row.id.startsWith('section-') && existingIds.includes(row.id)) {
      await prisma.auditPARRow.update({ where: { id: row.id }, data });
    } else {
      await prisma.auditPARRow.create({ data: { engagementId, ...data } });
    }
  }

  const updated = await prisma.auditPARRow.findMany({ where: { engagementId }, orderBy: { sortOrder: 'asc' } });
  return NextResponse.json({ rows: updated });
}

export async function POST(req: Request, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await params;
  if (!await verifyAccess(engagementId, session.user.firmId, session.user.isSuperAdmin)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const __eqrGuard = await assertEngagementWriteAccess(engagementId, session);
  if (__eqrGuard instanceof NextResponse) return __eqrGuard;

  const body = await req.json();
  if (body.action === 'signoff') {
    return handlePermanentFileSignOff(engagementId, {
      engagementId,
      userId: session.user.id!,
      userName: session.user.name || session.user.email || 'Unknown',
      role: body.role,
    }, 'par');
  }
  if (body.action === 'unsignoff') {
    return handlePermanentFileUnsignOff(engagementId, session.user.id, body.role, 'par');
  }
  if (body.action === 'fieldMeta') {
    await savePermanentFileFieldMeta(engagementId, body.fieldMeta, 'par');
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
