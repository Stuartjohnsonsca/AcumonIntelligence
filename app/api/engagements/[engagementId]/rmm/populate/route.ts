import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

/**
 * POST /api/engagements/[engagementId]/rmm/populate
 * Populate RMM rows from TB/PAR data or from previous engagement.
 * Body: { source: 'fs_line' | 'tb_account' | 'previous' }
 */
export async function POST(req: Request, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { engagementId } = await params;
  const { source } = await req.json();

  const engagement = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    select: { clientId: true, auditType: true, firmId: true },
  });
  if (!engagement) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Get existing mandatory rows to find max sortOrder
  const existingRows = await prisma.auditRMMRow.findMany({ where: { engagementId } });
  const existingLineItems = new Set(existingRows.map(r => r.lineItem));
  let maxSort = existingRows.reduce((max, r) => Math.max(max, r.sortOrder), 0);

  if (source === 'previous') {
    // Find prior engagement
    const priorEngagements = await prisma.auditEngagement.findMany({
      where: { clientId: engagement.clientId, auditType: engagement.auditType, id: { not: engagementId } },
      orderBy: { createdAt: 'desc' },
      take: 1,
    });
    if (priorEngagements.length === 0) return NextResponse.json({ error: 'No prior engagement found' }, { status: 404 });

    const priorId = priorEngagements[0].id;
    const priorRows = await prisma.auditRMMRow.findMany({ where: { engagementId: priorId }, orderBy: { sortOrder: 'asc' } });

    // Load current TB for new amounts
    const tbRows = await prisma.auditTBRow.findMany({ where: { engagementId }, select: { fsLevel: true, currentYear: true } });
    const amountsByLevel: Record<string, number> = {};
    for (const tb of tbRows) {
      if (tb.fsLevel) amountsByLevel[tb.fsLevel] = (amountsByLevel[tb.fsLevel] || 0) + (tb.currentYear || 0);
    }

    let created = 0;
    for (const prior of priorRows) {
      if (prior.isMandatory || existingLineItems.has(prior.lineItem)) continue;
      const newAmount = amountsByLevel[prior.lineItem] ?? prior.amount;
      await prisma.auditRMMRow.create({
        data: {
          engagementId,
          lineItem: prior.lineItem,
          lineType: prior.lineType,
          riskIdentified: prior.riskIdentified,
          amount: newAmount != null ? Math.round(newAmount * 100) / 100 : null,
          assertions: prior.assertions || [],
          relevance: prior.relevance,
          inherentRiskLevel: prior.inherentRiskLevel,
          likelihood: prior.likelihood,
          magnitude: prior.magnitude,
          fsStatement: prior.fsStatement,
          fsLevel: prior.fsLevel,
          fsNote: prior.fsNote,
          // Control Risk reset for new year
          controlRisk: null,
          sortOrder: ++maxSort,
        },
      });
      created++;
    }
    return NextResponse.json({ success: true, created, source: 'previous' });
  }

  // Populate from TB data
  const tbRows = await prisma.auditTBRow.findMany({ where: { engagementId } });

  if (source === 'fs_line') {
    // Group by fsLevel, aggregate amounts, capture FS hierarchy
    const groups: Record<string, { amount: number; fsStatement: string | null; fsLevel: string | null; fsNote: string | null }> = {};
    for (const tb of tbRows) {
      const level = tb.fsLevel || tb.fsStatement || '';
      if (level && !existingLineItems.has(level)) {
        if (!groups[level]) {
          groups[level] = { amount: 0, fsStatement: tb.fsStatement || null, fsLevel: tb.fsLevel || null, fsNote: (tb as any).fsNoteLevel || null };
        }
        groups[level].amount += (tb.currentYear || 0);
      }
    }

    let created = 0;
    for (const [lineItem, data] of Object.entries(groups)) {
      await prisma.auditRMMRow.create({
        data: {
          engagementId,
          lineItem,
          lineType: 'fs_line',
          amount: Math.round(data.amount * 100) / 100,
          fsStatement: data.fsStatement,
          fsLevel: data.fsLevel,
          fsNote: data.fsNote,
          sortOrder: ++maxSort,
        },
      });
      created++;
    }
    return NextResponse.json({ success: true, created, source: 'fs_line' });
  }

  if (source === 'tb_account') {
    // Individual TB accounts — carry FS hierarchy from TB row
    let created = 0;
    for (const tb of tbRows) {
      const lineItem = tb.description || tb.accountCode || '';
      if (!lineItem || existingLineItems.has(lineItem)) continue;
      await prisma.auditRMMRow.create({
        data: {
          engagementId,
          lineItem,
          lineType: 'tb_account',
          amount: tb.currentYear != null ? Math.round(tb.currentYear * 100) / 100 : null,
          fsStatement: tb.fsStatement || null,
          fsLevel: tb.fsLevel || null,
          fsNote: (tb as any).fsNoteLevel || null,
          sortOrder: ++maxSort,
        },
      });
      created++;
    }
    return NextResponse.json({ success: true, created, source: 'tb_account' });
  }

  return NextResponse.json({ error: 'Invalid source' }, { status: 400 });
}
