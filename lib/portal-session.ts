import { prisma } from './db';
import { columnExists } from './prisma-column-exists';
import crypto from 'crypto';

// Shared portal-session helper. Every portal API endpoint should resolve
// the caller from the token they supply before returning tenant-specific
// data — otherwise one client's portal user can see another's records
// (which happened with the earlier "findFirst where isActive: true"
// pattern). Keep this module self-contained so adding new portal routes
// that do the right thing is a one-import job.

const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface ResolvedPortalUser {
  id: string;
  clientId: string;
  email: string;
  name: string;
  isActive: boolean;
  isClientAdmin: boolean;
}

/** Look up the portal user for a given session token. Returns null for
 *  unknown tokens, expired tokens, or deactivated users. Honours the
 *  2026-04-20 migration state — during the brief window between
 *  deploying the schema change and running the SQL, we fall back to
 *  denying every request rather than leaking data. */
export async function resolvePortalUserFromToken(token: string | null | undefined): Promise<ResolvedPortalUser | null> {
  const result = await resolvePortalUserFromTokenDetailed(token);
  return result.user;
}

/** Diagnostic variant — returns both the resolved user (if any) and a
 *  human-readable reason string so 401 responses can tell the caller
 *  *why* the session didn't resolve. */
export interface ResolvePortalUserResult { user: ResolvedPortalUser | null; reason: string; }

export async function resolvePortalUserFromTokenDetailed(token: string | null | undefined): Promise<ResolvePortalUserResult> {
  if (!token || typeof token !== 'string') return { user: null, reason: 'token-missing' };
  if (token.length < 16) return { user: null, reason: 'token-too-short' };

  // Full query: session token + not-expired. If Prisma fires P2022
  // (typically because session_expires_at isn't in the DB yet) we
  // fall through to a token-only search.
  try {
    const user = await prisma.clientPortalUser.findFirst({
      where: {
        sessionToken: token,
        isActive: true,
        OR: [{ sessionExpiresAt: null }, { sessionExpiresAt: { gt: new Date() } }],
      },
      select: { id: true, clientId: true, email: true, name: true, isActive: true, isClientAdmin: true },
    });
    if (user) return { user, reason: 'ok' };

    // No active+unexpired match — check whether *any* row has this
    // token to distinguish "never persisted" from "persisted but
    // inactive/expired" so the 401 can tell the caller.
    try {
      const anyMatch = await prisma.clientPortalUser.findFirst({
        where: { sessionToken: token },
        select: { id: true, isActive: true, sessionExpiresAt: true },
      });
      if (!anyMatch) return { user: null, reason: 'token-not-in-db' };
      if (!anyMatch.isActive) return { user: null, reason: 'user-inactive' };
      if (anyMatch.sessionExpiresAt && anyMatch.sessionExpiresAt < new Date()) return { user: null, reason: 'session-expired' };
      return { user: null, reason: 'unknown-mismatch' };
    } catch {
      return { user: null, reason: 'token-not-in-db' };
    }
  } catch (err) {
    const msg = String((err as any)?.message || '');
    if (!/sessionExpiresAt|session_expires_at|sessionToken|session_token|P2022/i.test(msg)) {
      console.error('[portal-session] resolvePortalUserFromToken failed:', msg);
      return { user: null, reason: 'db-error' };
    }
    // Fall through to the token-only path.
  }

  // Fallback: session_expires_at column missing.
  try {
    const user = await prisma.clientPortalUser.findFirst({
      where: { sessionToken: token, isActive: true },
      select: { id: true, clientId: true, email: true, name: true, isActive: true, isClientAdmin: true },
    });
    if (user) return { user, reason: 'ok-no-expiry-column' };
    return { user: null, reason: 'token-not-in-db-no-expiry-column' };
  } catch (err) {
    console.error('[portal-session] resolvePortalUserFromToken token-only fallback also failed:', (err as any)?.message || err);
    return { user: null, reason: 'session-token-column-missing' };
  }
}

/** Generate a new opaque session token and persist it on the user.
 *
 *  Strategy: attempt the full write first (sessionToken +
 *  sessionExpiresAt + lastLoginAt). If that fails — typically because
 *  the 2026-04-20 migration hasn't reached this DB connection yet —
 *  fall back to writing just lastLoginAt so the timestamp is still
 *  refreshed, and return the token anyway. The caller treats a token
 *  without a persisted row as "session-less" and the user will be
 *  denied on the next protected request; we don't block login on a
 *  DB-state problem because that would leave the user stuck with no
 *  path forward.
 *
 *  Deliberately NOT using the columnExists cache here — a negative
 *  cache entry from a probe done seconds before the admin ran the SQL
 *  would otherwise permanently break new logins on that serverless
 *  instance until a cold start. */
export async function issuePortalSessionToken(userId: string): Promise<{ token: string; expiresAt: Date; persisted: boolean; error?: string } | null> {
  const token = crypto.randomBytes(48).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);

  try {
    await prisma.clientPortalUser.update({
      where: { id: userId },
      data: { sessionToken: token, sessionExpiresAt: expiresAt, lastLoginAt: new Date() },
    });
    console.log('[portal-session] session token persisted for user', userId);
    return { token, expiresAt, persisted: true };
  } catch (err) {
    const errMsg = (err as any)?.message || String(err);
    const errCode = (err as any)?.code;
    console.error('[portal-session] full session-token write failed — falling back:', { userId, code: errCode, message: errMsg });

    // Fallback — at minimum keep lastLoginAt fresh.
    try {
      await prisma.clientPortalUser.update({
        where: { id: userId },
        data: { lastLoginAt: new Date() },
      });
    } catch (err2) {
      console.error('[portal-session] fallback lastLoginAt write also failed:', (err2 as any)?.message || err2);
    }
    return { token, expiresAt, persisted: false, error: `${errCode || 'ERR'}: ${errMsg.slice(0, 200)}` };
  }
}

/** Revoke the current session token for a user (log-off). Best-effort. */
export async function revokePortalSessionToken(userId: string): Promise<void> {
  const hasSessionToken = await columnExists('client_portal_users', 'session_token');
  if (!hasSessionToken) return;
  await prisma.clientPortalUser.update({
    where: { id: userId },
    data: { sessionToken: null, sessionExpiresAt: null },
  }).catch(() => {});
}
