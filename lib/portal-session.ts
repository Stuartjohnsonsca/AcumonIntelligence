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

  const hasSessionToken = await columnExists('client_portal_users', 'session_token');
  if (!hasSessionToken) {
    // Pre-migration — we cannot validate. Safer to deny than to keep
    // the old "findFirst" behaviour which leaked data across tenants.
    return null;
  }

  const user = await prisma.clientPortalUser.findFirst({
    where: {
      sessionToken: token,
      isActive: true,
      OR: [
        { sessionExpiresAt: null },
        { sessionExpiresAt: { gt: new Date() } },
      ],
    },
    select: {
      id: true,
      clientId: true,
      email: true,
      name: true,
      isActive: true,
      isClientAdmin: true,
    },
  });

  return user || null;
}

/** Generate a new opaque session token and persist it on the user.
 *  Robust to a partially-applied migration: checks both new columns
 *  independently and only writes the ones that exist. If neither
 *  exists, the token is returned without a DB write (client still gets
 *  the token; resolvePortalUserFromToken will deny until migration
 *  completes). A DB error on the write is swallowed — we still return
 *  the token so the login/reset flow doesn't fail on a partial DB state. */
export async function issuePortalSessionToken(userId: string): Promise<{ token: string; expiresAt: Date } | null> {
  const token = crypto.randomBytes(48).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);
  const [hasSessionToken, hasSessionExpires] = await Promise.all([
    columnExists('client_portal_users', 'session_token'),
    columnExists('client_portal_users', 'session_expires_at'),
  ]);

  if (!hasSessionToken && !hasSessionExpires) {
    return { token, expiresAt };
  }

  // Build the update payload from whichever new columns actually exist
  // in the DB. lastLoginAt is part of the original schema and always
  // safe to write — it doubles as a "reset happened" signal in the
  // rare case neither session column is present yet.
  const data: Record<string, unknown> = { lastLoginAt: new Date() };
  if (hasSessionToken) data.sessionToken = token;
  if (hasSessionExpires) data.sessionExpiresAt = expiresAt;

  try {
    await prisma.clientPortalUser.update({ where: { id: userId }, data: data as any });
  } catch (err) {
    console.error('[portal-session] issuePortalSessionToken update failed:', (err as any)?.message || err);
    // Deliberately swallow — we don't want a DB hiccup to break
    // login / reset flows. The caller will decide what to do with
    // the returned token.
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
