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
  if (!token || typeof token !== 'string' || token.length < 16) return null;

  // Try the full query first (session token + expiry) and fall back to
  // token-only if the expiry column is missing. Bypasses the
  // columnExists cache so a negative entry can't permanently break
  // things on a serverless instance after the SQL has landed.
  try {
    const user = await prisma.clientPortalUser.findFirst({
      where: {
        sessionToken: token,
        isActive: true,
        OR: [{ sessionExpiresAt: null }, { sessionExpiresAt: { gt: new Date() } }],
      },
      select: { id: true, clientId: true, email: true, name: true, isActive: true, isClientAdmin: true },
    });
    return user || null;
  } catch (err) {
    const msg = String((err as any)?.message || '');
    // Prisma P2022 fires when Prisma's generated SQL references a
    // column the DB doesn't have — typical partial-migration symptom.
    if (!/sessionExpiresAt|session_expires_at|sessionToken|session_token|P2022/i.test(msg)) {
      console.error('[portal-session] resolvePortalUserFromToken failed:', msg);
      return null;
    }
  }

  // Fallback: session_expires_at missing. Validate on token alone.
  try {
    const user = await prisma.clientPortalUser.findFirst({
      where: { sessionToken: token, isActive: true },
      select: { id: true, clientId: true, email: true, name: true, isActive: true, isClientAdmin: true },
    });
    return user || null;
  } catch (err) {
    // session_token column also missing — pre-migration. Deny safely.
    console.error('[portal-session] resolvePortalUserFromToken token-only fallback also failed:', (err as any)?.message || err);
    return null;
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
export async function issuePortalSessionToken(userId: string): Promise<{ token: string; expiresAt: Date } | null> {
  const token = crypto.randomBytes(48).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);

  try {
    await prisma.clientPortalUser.update({
      where: { id: userId },
      data: { sessionToken: token, sessionExpiresAt: expiresAt, lastLoginAt: new Date() },
    });
    return { token, expiresAt };
  } catch (err) {
    console.error('[portal-session] full session-token write failed — falling back:', (err as any)?.message || err);
  }

  // Fallback — at minimum keep lastLoginAt fresh. Caller still gets a
  // token, but protected endpoints will 401 until the migration lands.
  try {
    await prisma.clientPortalUser.update({
      where: { id: userId },
      data: { lastLoginAt: new Date() },
    });
  } catch (err) {
    console.error('[portal-session] fallback lastLoginAt write also failed:', (err as any)?.message || err);
  }
  return { token, expiresAt };
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
