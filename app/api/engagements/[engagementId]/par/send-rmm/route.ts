import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

/**
 * POST /api/engagements/[engagementId]/par/send-rmm
 * Creates RMM rows from PAR items flagged for RMM.
 * Looks up amounts from TBCYvPY aggregated by FS Level.
 */
export async function POST(req: Request, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { engagementId } = await params;
  const { items } = await req.json();

  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: 'items array required' }, { status: 400 });
  }

  // Load TB rows to aggregate amounts by FS Level
  const tbRows = await prisma.auditTBRow.findMany({
    where: { engagementId },
    select: { fsLevel: true, fsStatement: true, currentYear: true },
  });

  // Aggregate TB amounts by FS Level (the PAR particulars = FS Level)
  const amountsByLevel: Record<string, number> = {};
  for (const tb of tbRows) {
    const level = tb.fsLevel || tb.fsStatement || '';
    if (level) {
      amountsByLevel[level] = (amountsByLevel[level] || 0) + (tb.currentYear || 0);
    }
  }

  // Get existing RMM rows to find max sortOrder and avoid duplicates
  const existingRmm = await prisma.auditRMMRow.findMany({
    where: { engagementId },
    select: { lineItem: true, sortOrder: true },
  });
  const existingLineItems = new Set(existingRmm.map(r => r.lineItem));
  let maxSort = existingRmm.reduce((max, r) => Math.max(max, r.sortOrder), 0);

  let created = 0;
  for (const item of items) {
    const lineItem = item.particulars || '';
    if (!lineItem || existingLineItems.has(lineItem)) continue;

    // Look up amount from TB aggregation
    const amount = amountsByLevel[lineItem] ?? item.currentYear ?? null;

    // Build risk description from PAR context
    const riskParts = [];
    if (item.auditorView) riskParts.push(item.auditorView);
    if (item.reasons) riskParts.push(`Client explanation: ${item.reasons.split('\n')[0]}`);
    if (item.absVariance != null) {
      riskParts.push(`PAR variance: £${Math.abs(item.absVariance).toLocaleString('en-GB', { minimumFractionDigits: 2 })} (${item.absVariancePercent?.toFixed(1) || '?'}%)`);
    }

    await prisma.auditRMMRow.create({
      data: {
        engagementId,
        lineItem,
        lineType: 'fs_line',
        riskIdentified: riskParts.join('\n') || `Flagged from PAR — significant movement identified`,
        amount: amount != null ? Math.round(amount * 100) / 100 : null,
        sortOrder: ++maxSort,
      },
    });
    created++;
    existingLineItems.add(lineItem);
  }

  return NextResponse.json({ success: true, created });
}
