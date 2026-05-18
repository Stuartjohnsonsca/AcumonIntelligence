import { NextResponse } from 'next/server';
import { auth } from './auth';
import { prisma } from './db';
import { resolvePortalUserFromToken, requirePortalWriteAccess } from './portal-session';

// Shared authorisation guard for /api/portal/* endpoints that are
// called BOTH from the client portal (with a session token in the
// query string) AND from the firm's methodology pages (with an
// auth() session). Previously these routes accepted clientId /
// engagementId straight from the query with no tenant check, which
// meant any authenticated user could substitute an arbitrary clientId
// and get another tenant's data.
//
// Usage (GET handler):
//
//   const guard = await authorisePortalTenant(req, { clientId });
//   if (!guard.ok) return guard.response;
//   // …continue with the trusted clientId…

export type PortalAuthResult =
  | { ok: true; kind: 'firm'; userId: string; firmId: string | undefined; isReadOnly: false }
  | { ok: true; kind: 'portal'; portalUserId: string; portalEmail: string; isReadOnly: boolean }
  | { ok: false; response: NextResponse };

interface AuthoriseArgs {
  /** Optional — when supplied, the caller is only authorised if this
   *  client is one they have access to. Portal users must have a
   *  ClientPortalUser row for this clientId with the same email as the
   *  token-holder. Firm users get a pass at this stage (firm-side
   *  endpoints do their own access checks via verifyClientAccess). */
  clientId?: string | null;
}

export async function authorisePortalTenant(req: Request, args: AuthoriseArgs = {}): Promise<PortalAuthResult> {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get('token');

  // Portal path — token present. Must resolve to an active user and,
  // if a clientId is supplied, must own it (by email + active row).
  if (token) {
    const user = await resolvePortalUserFromToken(token);
    if (!user) {
      return { ok: false, response: NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 }) };
    }
    if (args.clientId) {
      const owns = await prisma.clientPortalUser.findFirst({
        where: { email: user.email, clientId: args.clientId, isActive: true },
        select: { id: true },
      });
      if (!owns) {
        return { ok: false, response: NextResponse.json({ error: 'Forbidden — client not in your portal access list' }, { status: 403 }) };
      }
    }
    return { ok: true, kind: 'portal', portalUserId: user.id, portalEmail: user.email, isReadOnly: !!user.isReadOnly };
  }

  // Firm path — fall back to the standard auth session. No clientId
  // check here; firm-side routes rely on verifyClientAccess /
  // verifyAccess helpers at the next layer down, same as before.
  const session = await auth();
  if (session?.user?.twoFactorVerified) {
    return { ok: true, kind: 'firm', userId: session.user.id!, firmId: session.user.firmId, isReadOnly: false };
  }

  return { ok: false, response: NextResponse.json({ error: 'Authentication required' }, { status: 401 }) };
}

/**
 * Mutation-only variant: runs `authorisePortalTenant` and additionally
 * returns 403 if the caller is a firm-issued preview impersonation.
 * Use this on every portal route that writes to the DB.
 */
export async function authorisePortalTenantWritable(req: Request, args: AuthoriseArgs = {}): Promise<PortalAuthResult> {
  const result = await authorisePortalTenant(req, args);
  if (!result.ok) return result;
  if (result.kind === 'portal' && result.isReadOnly) {
    return {
      ok: false,
      response: NextResponse.json({
        error: 'This action is blocked because you are viewing the portal in read-only preview mode. Open the real portal to make changes.',
        reason: 'preview-readonly',
      }, { status: 403 }),
    };
  }
  return result;
}

/**
 * Block writes when the caller is in a firm-issued preview session.
 * Best-effort: reads the token from the URL query, then from the
 * `X-Portal-Preview-Token` header. Returns a 403 NextResponse the
 * caller should early-return, or null to proceed. Use this on legacy
 * portal mutation endpoints that don't already authenticate the
 * caller — it gates preview tokens explicitly without changing the
 * existing legacy behaviour for tokenless requests.
 */
export async function rejectIfPreviewReadOnly(req: Request): Promise<NextResponse | null> {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get('token') || req.headers.get('x-portal-preview-token');
  if (!token) return null;
  const user = await resolvePortalUserFromToken(token);
  if (!user) return null;
  const guard = requirePortalWriteAccess(user);
  if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status });
  return null;
}
