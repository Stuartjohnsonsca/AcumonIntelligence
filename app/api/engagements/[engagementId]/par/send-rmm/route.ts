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

    // Nature = client explanation text only (not audit team notes)
    // Extract last client message from reasons (chat history format: [Name, date]: message)
    let clientText = '';
    if (item.reasons) {
      const lines = item.reasons.split('\n').filter((l: string) => l.trim() && !l.startsWith('[Attachments:'));
      // Find lines that are from client (not audit team metadata)
      const clientLines = lines.filter((l: string) => !l.startsWith('PAR variance:') && !l.startsWith('['));
      clientText = clientLines.join('\n').trim();
      if (!clientText) clientText = lines[0] || '';
    }

    await prisma.auditRMMRow.create({
      data: {
        engagementId,
        lineItem,
        lineType: 'fs_line',
        riskIdentified: clientText || `Flagged from PAR — significant movement identified`,
        amount: amount != null ? Math.round(amount * 100) / 100 : null,
        sortOrder: ++maxSort,
      },
    });
    created++;
    existingLineItems.add(lineItem);
  }

  return NextResponse.json({ success: true, created });
}
