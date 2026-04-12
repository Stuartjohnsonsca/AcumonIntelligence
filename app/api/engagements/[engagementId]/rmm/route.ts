import { NextResponse } from 'next/server';
import { assertEngagementWriteAccess } from '@/lib/auth/engagement-auth';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { Prisma } from '@prisma/client';
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
    return getPermanentFileSignOffs(engagementId, 'rmm');
  }

  const rows = await prisma.auditRMMRow.findMany({ where: { engagementId }, orderBy: { sortOrder: 'asc' } });
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
  const { rows } = body as { rows: Array<Record<string, unknown>> };

  const existingIds = rows.filter(r => r.id).map(r => r.id as string);
  // Only delete non-mandatory rows that were removed
  await prisma.auditRMMRow.deleteMany({ where: { engagementId, id: { notIn: existingIds }, isMandatory: false } });

  for (const row of rows) {
    const data = {
      lineItem: row.lineItem as string,
      lineType: (row.lineType as string) || 'fs_line',
      riskIdentified: row.riskIdentified as string || null,
      amount: row.amount != null ? Number(row.amount) : null,
      assertions: row.assertions ? (row.assertions as Prisma.InputJsonValue) : Prisma.JsonNull,
      relevance: row.relevance as string || null,
      complexityText: row.complexityText as string || null,
      subjectivityText: row.subjectivityText as string || null,
      changeText: row.changeText as string || null,
      uncertaintyText: row.uncertaintyText as string || null,
      susceptibilityText: row.susceptibilityText as string || null,
      inherentRiskLevel: row.inherentRiskLevel as string || null,
      aiSummary: row.aiSummary as string || null,
      isAiEdited: (row.isAiEdited as boolean) ?? false,
      likelihood: row.likelihood as string || null,
      magnitude: row.magnitude as string || null,
      finalRiskAssessment: row.finalRiskAssessment as string || null,
      controlRisk: row.controlRisk as string || null,
      overallRisk: row.overallRisk as string || null,
      rowCategory: (row.rowCategory as string) || null,
      isHidden: (row.isHidden as boolean) ?? false,
      sortOrder: (row.sortOrder as number) ?? 0,
    };

    if (row.id) {
      await prisma.auditRMMRow.update({ where: { id: row.id as string }, data });
    } else {
      await prisma.auditRMMRow.create({ data: { engagementId, isMandatory: (row.isMandatory as boolean) ?? false, ...data } });
    }
  }

  const updated = await prisma.auditRMMRow.findMany({ where: { engagementId }, orderBy: { sortOrder: 'asc' } });
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
    }, 'rmm');
  }
  if (body.action === 'unsignoff') {
    return handlePermanentFileUnsignOff(engagementId, session.user.id, body.role, 'rmm');
  }
  if (body.action === 'fieldMeta') {
    await savePermanentFileFieldMeta(engagementId, body.fieldMeta, 'rmm');
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
