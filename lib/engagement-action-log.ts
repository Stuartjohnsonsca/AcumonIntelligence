/**
 * Engagement audit trail — helper for recording button-triggered
 * actions so the Outstanding tab can show who did what, when.
 *
 * Design goals:
 *   - Fire-and-forget. Logging failures must NEVER break the user's
 *     action. Every call is wrapped in try/catch with a console.warn
 *     fallback — worst case a log entry goes missing.
 *   - Works even if the migration hasn't been applied to the target
 *     environment (the `engagement_action_logs` table may not exist
 *     yet on older DBs). We detect that specific error and degrade
 *     silently rather than 500-ing the endpoint.
 *   - Callers pass an `action` slug (stable, machine-readable) and a
 *     `summary` (human-readable one-liner). The UI groups by action
 *     and displays the summary verbatim, so summaries should be
 *     self-contained and include the object they apply to.
 *
 * Example:
 *   await logEngagementAction({
 *     engagementId, firmId,
 *     actorUserId: session.user.id,
 *     actorName: session.user.name || session.user.email || 'unknown',
 *     action: 'rmm.send-from-par',
 *     summary: `Sent 4 PAR rows to RMM (Revenue, Trade Debtors, …)`,
 *     targetType: 'schedule', targetId: 'rmm',
 *     metadata: { created, updated, lineItems },
 *   });
 */

import { prisma } from '@/lib/db';

export interface LogEngagementActionInput {
  engagementId: string;
  firmId: string;
  /** The user who clicked the button. Null for server-triggered /
   *  portal-side events — set `actorName` to a readable label instead. */
  actorUserId: string | null;
  /** Display name captured at log time — survives user renames. */
  actorName: string;
  /** Stable dotted slug, e.g. 'rmm.send-from-par'. */
  action: string;
  /** One-line human summary — what the UI shows by default. */
  summary: string;
  /** Optional pointer to the entity the action touched. */
  targetType?: string | null;
  targetId?: string | null;
  /** Small JSON blob for action-specific context. Caller should keep
   *  this well under a kilobyte — raw row dumps don't belong here. */
  metadata?: Record<string, unknown> | null;
}

/** Maximum length we'll store for `summary` — keeps the UI row
 *  rendering predictable and the DB clean of runaway paste. */
const MAX_SUMMARY_LEN = 500;

export async function logEngagementAction(input: LogEngagementActionInput): Promise<void> {
  try {
    const model: any = (prisma as any).engagementActionLog;
    if (!model || typeof model.create !== 'function') {
      // Prisma client hasn't been regenerated against the new schema
      // yet (or the consumer is running against a DB without the
      // table). Skip silently — the action itself still succeeds.
      return;
    }
    const summary = input.summary.length > MAX_SUMMARY_LEN
      ? input.summary.slice(0, MAX_SUMMARY_LEN - 1) + '…'
      : input.summary;
    await model.create({
      data: {
        engagementId: input.engagementId,
        firmId: input.firmId,
        actorUserId: input.actorUserId,
        actorName: input.actorName || 'unknown',
        action: input.action,
        summary,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        metadata: input.metadata ? (input.metadata as any) : undefined,
      },
    });
  } catch (err: any) {
    // Known case: table doesn't exist yet in this environment.
    // Postgres error 42P01 = undefined_table. Surface once then
    // swallow so subsequent calls don't spam the logs.
    const code = err?.code || err?.meta?.code;
    const msg = String(err?.message || '');
    if (code === '42P01' || /engagement_action_logs/i.test(msg)) {
      // eslint-disable-next-line no-console
      console.warn('[engagement-action-log] table missing — run the 2026-04-22 migration. Skipping log entry.');
      return;
    }
    // eslint-disable-next-line no-console
    console.warn('[engagement-action-log] write failed (non-fatal):', err?.message || err);
  }
}

/**
 * Resolve the engagement's firmId + the caller's display identity
 * from an auth()-returned session. Handy shortcut so endpoints
 * don't need to look it up themselves before calling logEngagementAction.
 *
 * Returns null if the engagement can't be loaded (caller should
 * handle auth/404 before calling this — resolveActor is a convenience
 * for the happy path only).
 */
export async function resolveActor(
  engagementId: string,
  session: { user?: { id?: string; name?: string | null; email?: string | null } } | null | undefined,
): Promise<{ firmId: string; actorUserId: string | null; actorName: string } | null> {
  const eng = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    select: { firmId: true },
  });
  if (!eng) return null;
  const u = session?.user;
  const actorName = u?.name || u?.email || 'unknown';
  return { firmId: eng.firmId, actorUserId: u?.id || null, actorName };
}
