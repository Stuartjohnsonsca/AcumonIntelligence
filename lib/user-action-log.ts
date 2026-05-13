/**
 * User Action Log — engagement-agnostic audit trail for every user
 * action that doesn't already land in EngagementActionLog. Captures:
 *   - Firm-side: login, 2FA verify, password reset, profile edit,
 *     role change, super-admin promotion, etc.
 *   - Portal-side: portal login, 2FA verify, password reset,
 *     channel preference change, trusted-device mint.
 *
 * Designed for indefinite retention — there is no cron purge. The
 * SuperAdmin Audit Trail reads from this table alongside the
 * engagement log to give a single chronological feed.
 *
 * All callers are best-effort: a logging failure must NEVER fail
 * the user-facing flow. Use logUserAction inside a try/catch on the
 * caller, or rely on the internal swallow.
 */

import { prisma } from '@/lib/db';

export interface LogUserActionArgs {
  /** 'firm' (internal User) or 'portal' (ClientPortalUser). */
  userKind: 'firm' | 'portal';
  /** The user's id. Null only when we want to record an attempt
   *  against an unknown user (e.g. failed login with bad email). */
  userId: string | null;
  /** Human-readable display name — denormalised so the trail stays
   *  useful even if the user record is deleted later. */
  userName: string;
  /** Slug like 'login.success', 'login.failed', 'password.reset',
   *  'two_factor.verified', 'profile.update'. Free text; the UI
   *  groups by the prefix before the first dot. */
  action: string;
  /** Single-line summary surfaced in the audit-trail table. */
  summary: string;
  /** Firm context when known. */
  firmId?: string | null;
  /** Client context for portal-side actions. */
  clientId?: string | null;
  /** Request headers / metadata. Pass req when you have one and the
   *  helper extracts ip + ua; otherwise pass them explicitly. */
  request?: { headers: Headers } | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  /** Free-form metadata payload. */
  metadata?: Record<string, unknown> | null;
}

/**
 * Insert a row into user_action_logs. Never throws. Returns the new
 * row's id, or null on failure (with a console.error). Best-effort
 * by design so logging can't take down the user-facing flow.
 */
export async function logUserAction(args: LogUserActionArgs): Promise<string | null> {
  try {
    // Extract ip + ua from the Request object when supplied. The
    // X-Forwarded-For header is honoured first (Vercel + most proxies
    // populate it); fall back to the explicit ipAddress arg.
    let ipAddress = args.ipAddress ?? null;
    let userAgent = args.userAgent ?? null;
    if (args.request?.headers) {
      const xff = args.request.headers.get('x-forwarded-for') || '';
      if (!ipAddress && xff) ipAddress = xff.split(',')[0]?.trim() || null;
      if (!userAgent) userAgent = args.request.headers.get('user-agent') || null;
    }

    const row = await prisma.userActionLog.create({
      data: {
        userKind: args.userKind,
        userId: args.userId,
        userName: args.userName.slice(0, 200),
        firmId: args.firmId ?? null,
        clientId: args.clientId ?? null,
        action: args.action.slice(0, 200),
        summary: args.summary.slice(0, 5000),
        ipAddress,
        userAgent: userAgent?.slice(0, 1000) ?? null,
        metadata: args.metadata ? (args.metadata as any) : undefined,
      },
      select: { id: true },
    });
    return row.id;
  } catch (err: any) {
    // Don't surface — the user-facing flow must complete regardless.
    console.error('[user-action-log] insert failed:', err?.message || err);
    return null;
  }
}
