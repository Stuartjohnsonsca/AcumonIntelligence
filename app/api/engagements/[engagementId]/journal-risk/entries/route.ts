import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

async function verifyAccess(engagementId: string, firmId: string | undefined, isSuperAdmin: boolean) {
  const e = await prisma.auditEngagement.findUnique({ where: { id: engagementId }, select: { firmId: true } });
  if (!e || (e.firmId !== firmId && !isSuperAdmin)) return null;
  return e;
}

export async function GET(req: Request, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await params;
  if (!await verifyAccess(engagementId, session.user.firmId, session.user.isSuperAdmin)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const url = new URL(req.url);
  const runIdParam = url.searchParams.get('runId');
  const selectedOnly = url.searchParams.get('selected') === 'true';
  const riskBand = url.searchParams.get('riskBand');
  const selectionLayer = url.searchParams.get('selectionLayer');
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
  const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get('limit') || '50')));
  const sort = url.searchParams.get('sort') || 'riskScore';
  const dir = url.searchParams.get('dir') === 'asc' ? 'asc' as const : 'desc' as const;

  // Find the run
  let runId: string | undefined;
  if (runIdParam) {
    const run = await prisma.journalRiskRun.findUnique({ where: { runId: runIdParam }, select: { id: true } });
    runId = run?.id;
  } else {
    const run = await prisma.journalRiskRun.findFirst({
      where: { engagementId, status: 'completed' },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    runId = run?.id;
  }

  if (!runId) return NextResponse.json({ entries: [], total: 0, page, limit });

  // Build where clause
  const where: Record<string, unknown> = { runId };
  if (selectedOnly) where.selected = true;
  if (riskBand) where.riskBand = riskBand;
  if (selectionLayer) where.selectionLayer = selectionLayer;

  // Validate sort field
  const validSorts = ['riskScore', 'journalId', 'postedAt', 'amount', 'selectionLayer', 'testStatus'];
  const orderField = validSorts.includes(sort) ? sort : 'riskScore';

  const [entries, total] = await Promise.all([
    prisma.journalRiskEntry.findMany({
      where: where as any,
      orderBy: { [orderField]: dir },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.journalRiskEntry.count({ where: where as any }),
  ]);

  return NextResponse.json({
    entries: entries.map(e => ({
      id: e.id,
      journalId: e.journalId,
      postedAt: e.postedAt,
      period: e.period,
      isManual: e.isManual,
      preparedByUserId: e.preparedByUserId,
      approvedByUserId: e.approvedByUserId,
      amount: e.amount,
      description: e.description,
      debitAccountId: e.debitAccountId,
      creditAccountId: e.creditAccountId,
      riskScore: e.riskScore,
      riskBand: e.riskBand,
      riskTags: e.riskTags,
      drivers: e.drivers,
      selected: e.selected,
      selectionLayer: e.selectionLayer,
      mandatory: e.mandatory,
      rationale: e.rationale,
      testStatus: e.testStatus,
      testNotes: e.testNotes,
      testedAt: e.testedAt,
    })),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  });
}
