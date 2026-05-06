import crypto from 'crypto';

/**
 * External Specialist Portal — token helpers.
 *
 * The portal at /specialist-portal/[engagementId]/[roleKey] is open
 * to specialists who don't have firm-side accounts. Authentication
 * is an HMAC signature over (engagementId, roleKey, email) using a
 * server secret — no new DB model required, and the URL itself
 * tells the server who's claiming access. The signature is verified
 * on every request; an attacker can't forge access without the
 * secret, can't replay across engagements, and can't escalate to a
 * different role on the same engagement.
 *
 * Scope: a portal session can ONLY:
 *   - read the chat items where specialistRoleKey matches the URL's
 *     roleKey, on the URL's engagementId
 *   - append messages to those chats
 *
 * Anything else (other engagements, other roles, other PF sections)
 * returns 403 from the portal API routes.
 *
 * Trade-offs vs a stored-token model:
 *   - No expiry. The URL is valid forever (or until SECRET rotates).
 *     For an MVP that's fine; rotate the secret to invalidate every
 *     outstanding link at once.
 *   - No per-link revocation. Same caveat.
 *   - No email-typed audit trail beyond what's already in the chat.
 *
 * If those become problems we can swap to a Prisma table without
 * changing the URL surface — the API routes call `verify()` and
 * that's the only place the auth model lives.
 */

const SECRET = process.env.SPECIALIST_PORTAL_SECRET || process.env.NEXTAUTH_SECRET || 'dev-only-change-me';

export interface PortalContext {
  engagementId: string;
  roleKey: string;
  email: string;
}

function payload(ctx: PortalContext): string {
  // Lower-case + trim the email so trivial casing differences don't
  // invalidate a link the auditor typed by hand.
  const e = (ctx.email || '').trim().toLowerCase();
  return `${ctx.engagementId}|${ctx.roleKey}|${e}`;
}

export function signPortalToken(ctx: PortalContext): string {
  const h = crypto.createHmac('sha256', SECRET);
  h.update(payload(ctx));
  // base64url so it goes in a URL without escaping.
  return h.digest('base64url');
}

export function verifyPortalToken(ctx: PortalContext, token: string): boolean {
  try {
    const expected = signPortalToken(ctx);
    // timingSafeEqual requires equal-length buffers; bail early if
    // the lengths differ (prevents a length-leaking comparison).
    const a = Buffer.from(token);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Build the public portal URL for the specialist. The auditor can
 * email this manually (or the schedule-action flow can attach it
 * when sending the invite).
 */
export function buildPortalUrl(baseUrl: string, ctx: PortalContext): string {
  const sig = signPortalToken(ctx);
  const root = baseUrl.replace(/\/+$/, '');
  const url = new URL(`${root}/specialist-portal/${encodeURIComponent(ctx.engagementId)}/${encodeURIComponent(ctx.roleKey)}`);
  url.searchParams.set('email', ctx.email);
  url.searchParams.set('sig', sig);
  return url.toString();
}
