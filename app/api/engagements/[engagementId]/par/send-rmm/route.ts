import { NextResponse } from 'next/server';
import { assertEngagementWriteAccess } from '@/lib/auth/engagement-auth';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { logEngagementAction, resolveActor } from '@/lib/engagement-action-log';

/**
 * POST /api/engagements/[engagementId]/par/send-rmm
 * Creates RMM rows from PAR items flagged for RMM.
 * Looks up amounts from TBCYvPY aggregated by FS Level.
 *
 * Every row this endpoint creates OR updates is marked
 * `source = 'par'` so the RMM tab can segregate PAR-sourced rows to
 * the bottom of the schedule with distinct shading. A bulk backfill
 * at the top of the handler also retroactively marks any existing
 * RMM row whose lineItem matches a PAR row with addedToRmm=true but
 * where `source` is still NULL — catches rows that were pushed from
 * PAR before the `source` column was deployed.
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

  // Retroactive backfill: any RMM row whose lineItem matches a PAR row
  // flagged addedToRmm=true but whose `source` is still NULL is almost
  // certainly a row that was pushed from PAR BEFORE the `source`
  // column existed (or before this endpoint started setting it).
  // Mark them so the RMM tab segregates them alongside new pushes.
  // Runs on every send-rmm request — cheap and idempotent.
  const parPushedRows = await prisma.auditPARRow.findMany({
    where: { engagementId, addedToRmm: true },
    select: { particulars: true },
  });
  const parLineItems = Array.from(new Set(parPushedRows.map(p => p.particulars).filter(Boolean)));
  if (parLineItems.length > 0) {
    await prisma.auditRMMRow.updateMany({
      where: { engagementId, source: null, lineItem: { in: parLineItems } },
      data: { source: 'par' },
    }).catch(err => {
      // If the `source` column doesn't exist yet (migration not applied
      // to this environment), log but don't fail the whole push — the
      // PAR rows still get into RMM, just without the bottom grouping.
      console.warn('[send-rmm] source backfill skipped (column missing?):', err?.message);
    });
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

    // Pull any client-supplied explanation text out of the PAR item's
    // `reasons` field — only used to seed the Nature column when the
    // client actually said something. Audit-team variance markers
    // (`PAR variance:`, `[…]` etc.) are stripped. If nothing meaningful
    // remains we leave Nature EMPTY so the auditor types their own
    // assessment from scratch — the row's PAR origin is now signalled
    // by an asterisk on the lineItem cell, not by stuffing boilerplate
    // text into the Nature column.
    let clientText = '';
    if (item.reasons) {
      const lines = String(item.reasons).split('\n').filter((l: string) => l.trim() && !l.startsWith('[Attachments:'));
      const clientLines = lines.filter((l: string) => !l.startsWith('PAR variance:') && !l.startsWith('['));
      clientText = clientLines.join('\n').trim();
      if (!clientText) clientText = lines[0] || '';
    }
    // Empty string → null so existing-row "keep the longer text"
    // logic below doesn't pin a literal "" over a useful narrative.
    const riskIdentified: string | null = clientText.trim().length > 0 ? clientText : null;
    const roundedAmount = amount != null ? Math.round(amount * 100) / 100 : null;

    const existing = existingByLineItem.get(lineItem);
    if (existing) {
      // Refresh the amount + keep the narrative up to date without
      // trampling any manual RMM enrichments the user may have added.
      // Rule: prefer whichever of (existing, fresh-PAR-text) is the
      // longer non-empty value; if both are blank, leave the column
      // null. Setting source='par' on update is important too — see
      // the backfill logic at the top of this route.
      const keepExisting = existing.riskIdentified
        && (!riskIdentified || existing.riskIdentified.length >= riskIdentified.length);
      await prisma.auditRMMRow.update({
        where: { id: existing.id },
        data: {
          amount: roundedAmount ?? existing.amount,
          riskIdentified: keepExisting ? existing.riskIdentified : riskIdentified,
          fsStatement: fsStatement ?? undefined,
          fsLevel: fsLevel ?? undefined,
          fsNote: fsNote ?? undefined,
          source: 'par',
        },
      });
      updated++;
      updatedLineItems.push(lineItem);
    } else {
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
          source: 'par',
        },
      });
      created++;
      createdLineItems.push(lineItem);
      existingByLineItem.set(lineItem, { id: 'new', lineItem, sortOrder: maxSort, riskIdentified: riskIdentified || '', amount: roundedAmount });
    }
  }

  // Audit trail — captures WHO sent WHAT from PAR to RMM, and when.
  // Bypasses the green-dot flow, so the log is the only record of
  // this decision until someone signs the RMM tab off. Fire-and-
  // forget; logging failures never block the response.
  if (created > 0 || updated > 0) {
    const actor = await resolveActor(engagementId, session);
    if (actor) {
      const changed = [...createdLineItems, ...updatedLineItems].slice(0, 6).join(', ');
      const more = createdLineItems.length + updatedLineItems.length > 6 ? ', …' : '';
      await logEngagementAction({
        engagementId,
        firmId: actor.firmId,
        actorUserId: actor.actorUserId,
        actorName: actor.actorName,
        action: 'rmm.send-from-par',
        summary: `Sent ${created + updated} PAR row${created + updated === 1 ? '' : 's'} to RMM — ${changed}${more}`,
        targetType: 'schedule',
        targetId: 'rmm',
        metadata: { created, updated, createdLineItems, updatedLineItems },
      });
    }
  }

  return NextResponse.json({ success: true, created, updated, createdLineItems, updatedLineItems });
}
