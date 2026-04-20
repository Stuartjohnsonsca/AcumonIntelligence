import { NextResponse } from 'next/server';
import { auth } from './auth';
import { prisma } from './db';
import { resolvePortalUserFromToken } from './portal-session';

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
  | { ok: true; kind: 'firm'; userId: string; firmId: string | undefined }
  | { ok: true; kind: 'portal'; portalUserId: string; portalEmail: string }
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
    return { ok: true, kind: 'portal', portalUserId: user.id, portalEmail: user.email };
  }

  // Firm path — fall back to the standard auth session. No clientId
  // check here; firm-side routes rely on verifyClientAccess /
  // verifyAccess helpers at the next layer down, same as before.
  const session = await auth();
  if (session?.user?.twoFactorVerified) {
    return { ok: true, kind: 'firm', userId: session.user.id!, firmId: session.user.firmId };
  }

  return { ok: false, response: NextResponse.json({ error: 'Authentication required' }, { status: 401 }) };
}
