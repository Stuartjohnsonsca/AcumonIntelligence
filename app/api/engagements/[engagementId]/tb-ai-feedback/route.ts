import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

/**
 * POST /api/engagements/[id]/tb-ai-feedback
 *
 * Captures the difference between what the AI classifier suggested
 * for a TB row and what the auditor actually ended up with. Feeds
 * into a firm-wide corpus used to refine the classifier's prompt /
 * few-shot examples over time.
 *
 * Body:
 *   {
 *     accountCode, description, currentYear?,
 *     suggested: { fsNoteLevel, fsLevel, fsStatement, aiConfidence? },
 *     chosen:    { fsNoteLevel, fsLevel, fsStatement },
 *     action: 'accepted' | 'overridden' | 'cleared' | 'modified'
 *   }
 *
 * Stored as an ActivityLog entry with tool='tb-ai-classifier'
 * (reuses the existing generic log — no new table needed). A future
 * admin dashboard reads these rows, diffs suggested vs chosen, and
 * surfaces the most-corrected patterns so the prompt engineers have
 * a concrete list to target.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ engagementId: string }> },
) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const engagement = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    select: { firmId: true, clientId: true },
  });
  if (!engagement) return NextResponse.json({ error: 'Engagement not found' }, { status: 404 });
  if (!session.user.isSuperAdmin && engagement.firmId !== session.user.firmId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Normalise the payload defensively — never trust the client to
  // format the shape exactly as documented.
  const action = body.action === 'accepted' || body.action === 'overridden' || body.action === 'cleared' || body.action === 'modified' ? body.action : 'modified';
  const detail = {
    engagementId,
    accountCode: String(body.accountCode || '').slice(0, 64),
    description: String(body.description || '').slice(0, 500),
    currentYear: typeof body.currentYear === 'number' ? body.currentYear : null,
    suggested: body.suggested && typeof body.suggested === 'object' ? {
      fsNoteLevel: body.suggested.fsNoteLevel ?? null,
      fsLevel: body.suggested.fsLevel ?? null,
      fsStatement: body.suggested.fsStatement ?? null,
      aiConfidence: typeof body.suggested.aiConfidence === 'number' ? body.suggested.aiConfidence : null,
    } : null,
    chosen: body.chosen && typeof body.chosen === 'object' ? {
      fsNoteLevel: body.chosen.fsNoteLevel ?? null,
      fsLevel: body.chosen.fsLevel ?? null,
      fsStatement: body.chosen.fsStatement ?? null,
    } : null,
  };

  // Batch mode — when `rows` is an array, treat it as a corpus
  // snapshot (one entry per row) and store as a single ActivityLog
  // row. Fired when the auditor leaves the TB tab so we capture the
  // final state of every row at once, not one per keystroke.
  if (Array.isArray(body.rows)) {
    const snapshotRows = body.rows
      .filter((r: any) => r && (r.description || r.accountCode))
      .map((r: any) => ({
        accountCode: String(r.accountCode || '').slice(0, 64),
        description: String(r.description || '').slice(0, 500),
        currentYear: typeof r.currentYear === 'number' ? r.currentYear : null,
        // Captured when the ⚡ AI button was used on this row.
        aiSuggested: r.aiSuggested && typeof r.aiSuggested === 'object' ? {
          fsNoteLevel: r.aiSuggested.fsNoteLevel ?? null,
          fsLevel: r.aiSuggested.fsLevel ?? null,
          fsStatement: r.aiSuggested.fsStatement ?? null,
          aiConfidence: typeof r.aiSuggested.aiConfidence === 'number' ? r.aiSuggested.aiConfidence : null,
        } : null,
        // The auditor's final classification — the source of truth
        // for future training, regardless of whether AI was involved.
        final: {
          fsNoteLevel: r.final?.fsNoteLevel ?? null,
          fsLevel: r.final?.fsLevel ?? null,
          fsStatement: r.final?.fsStatement ?? null,
        },
      }));
    if (snapshotRows.length === 0) {
      return NextResponse.json({ ok: true, skipped: true, reason: 'no_rows' });
    }
    try {
      await (prisma as any).activityLog?.create?.({
        data: {
          userId: session.user.id,
          firmId: engagement.firmId,
          clientId: engagement.clientId,
          action: 'tb_ai_corpus_snapshot',
          tool: 'tb-ai-classifier',
          detail: {
            engagementId,
            rowCount: snapshotRows.length,
            snapshotAt: new Date().toISOString(),
            rows: snapshotRows,
          },
        },
      });
      return NextResponse.json({ ok: true, rowCount: snapshotRows.length });
    } catch (err: any) {
      console.error('[tb-ai-feedback/batch] failed', err);
      return NextResponse.json({ error: err?.message || 'Failed to log' }, { status: 500 });
    }
  }

  try {
    await (prisma as any).activityLog?.create?.({
      data: {
        userId: session.user.id,
        firmId: engagement.firmId,
        clientId: engagement.clientId,
        action: `tb_ai_${action}`,
        tool: 'tb-ai-classifier',
        detail,
      },
    });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('[tb-ai-feedback] failed', err);
    return NextResponse.json({ error: err?.message || 'Failed to log' }, { status: 500 });
  }
}
