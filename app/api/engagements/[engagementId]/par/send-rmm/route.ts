import { NextResponse } from 'next/server';
import { assertEngagementWriteAccess } from '@/lib/auth/engagement-auth';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { columnExists } from '@/lib/prisma-column-exists';

/**
 * POST /api/engagements/[engagementId]/par/send-rmm
 * Creates RMM rows from PAR items flagged for RMM.
 * Looks up amounts from TBCYvPY aggregated by FS Level.
 */
export async function POST(req: Request, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { engagementId } = await params;
  const __eqrGuard = await assertEngagementWriteAccess(engagementId, session);
  if (__eqrGuard instanceof NextResponse) return __eqrGuard;
  const { items } = await req.json();

  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: 'items array required' }, { status: 400 });
  }

  // Load TB rows to aggregate amounts by FS Level and get FS hierarchy
  const tbRows = await prisma.auditTBRow.findMany({
    where: { engagementId },
    select: { fsLevel: true, fsStatement: true, fsNoteLevel: true, description: true, currentYear: true },
  });

  // Aggregate TB amounts by FS Level (the PAR particulars = FS Level)
  const amountsByLevel: Record<string, number> = {};
  for (const tb of tbRows) {
    const level = tb.fsLevel || tb.fsStatement || '';
    if (level) {
      amountsByLevel[level] = (amountsByLevel[level] || 0) + (tb.currentYear || 0);
    }
  }

  // Get existing RMM rows so we can update-in-place instead of silently
  // skipping. Previously a duplicate lineItem was thrown away, which made
  // the UI look like "Send to RMM" did nothing — user sees no new row on
  // the RMM tab even though something was clicked.
  const existingRmm = await prisma.auditRMMRow.findMany({
    where: { engagementId },
    select: { id: true, lineItem: true, sortOrder: true, riskIdentified: true, amount: true },
  });
  const existingByLineItem = new Map(existingRmm.map(r => [r.lineItem, r]));
  let maxSort = existingRmm.reduce((max, r) => Math.max(max, r.sortOrder), 0);

  let created = 0;
  let updated = 0;
  const createdLineItems: string[] = [];
  const updatedLineItems: string[] = [];
  for (const item of items) {
    const lineItem = item.particulars || '';
    if (!lineItem) continue;

    const amount = amountsByLevel[lineItem] ?? item.currentYear ?? null;
    const matchingTb = tbRows.find(tb =>
      tb.fsLevel === lineItem || tb.fsNoteLevel === lineItem || tb.description === lineItem
    ) || tbRows.find(tb =>
      (tb.fsLevel || '').toLowerCase().includes(lineItem.toLowerCase()) ||
      lineItem.toLowerCase().includes((tb.fsLevel || '').toLowerCase())
    );
    const fsStatement = matchingTb?.fsStatement || item.fsStatement || null;
    const fsLevel = matchingTb?.fsLevel || item.fsLevel || null;
    const fsNote = matchingTb?.fsNoteLevel || item.fsNote || null;

    // Nature = client explanation text only (not audit team notes).
    let clientText = '';
    if (item.reasons) {
      const lines = String(item.reasons).split('\n').filter((l: string) => l.trim() && !l.startsWith('[Attachments:'));
      const clientLines = lines.filter((l: string) => !l.startsWith('PAR variance:') && !l.startsWith('['));
      clientText = clientLines.join('\n').trim();
      if (!clientText) clientText = lines[0] || '';
    }
    const riskIdentified = clientText || `Flagged from PAR — significant movement identified`;
    const roundedAmount = amount != null ? Math.round(amount * 100) / 100 : null;

    const existing = existingByLineItem.get(lineItem);
    if (existing) {
      // Refresh the amount + keep the narrative up to date without
      // trampling any manual RMM enrichments the user may have added.
      await prisma.auditRMMRow.update({
        where: { id: existing.id },
        data: {
          amount: roundedAmount ?? existing.amount,
          riskIdentified: existing.riskIdentified && existing.riskIdentified.length > riskIdentified.length
            ? existing.riskIdentified
            : riskIdentified,
          fsStatement: fsStatement ?? undefined,
          fsLevel: fsLevel ?? undefined,
          fsNote: fsNote ?? undefined,
        },
      });
      updated++;
      updatedLineItems.push(lineItem);
    } else {
      const hasSource = await columnExists('audit_rmm_rows', 'source');
      await prisma.auditRMMRow.create({
        data: {
          engagementId,
          lineItem,
          lineType: 'fs_line',
          riskIdentified,
          amount: roundedAmount,
          sortOrder: ++maxSort,
          fsStatement,
          fsLevel,
          fsNote,
          ...(hasSource ? { source: 'par' } : {}),
        },
      });
      created++;
      createdLineItems.push(lineItem);
      existingByLineItem.set(lineItem, { id: 'new', lineItem, sortOrder: maxSort, riskIdentified, amount: roundedAmount });
    }
  }

  return NextResponse.json({ success: true, created, updated, createdLineItems, updatedLineItems });
}
