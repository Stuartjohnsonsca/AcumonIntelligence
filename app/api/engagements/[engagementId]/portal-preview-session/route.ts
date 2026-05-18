import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

/**
 * Mint a short-lived (1h, hard-capped at 4h) preview impersonation
 * token a firm auditor can use to load the client portal AS a given
 * portal user in strict read-only mode. The token is stored in its
 * own table (`ClientPortalPreviewSession`) so it never disturbs the
 * impersonated user's own session — both can be active at the same
 * time on the same browser, since the portal uses URL-token auth and
 * not cookies.
 *
 * Authorisation: firm-side NextAuth session, with read access to the
 * engagement (same gate the rest of the audit tool uses). We do NOT
 * require write access — read-only firm users can preview too.
 */
const DEFAULT_EXPIRY_SECONDS = 60 * 60;        // 1 hour
const MAX_EXPIRY_SECONDS     = 60 * 60 * 4;    // 4 hours hard cap

async function verifyAccess(engagementId: string, firmId: string | undefined, isSuperAdmin: boolean) {
  const eng = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    select: { id: true, firmId: true, clientId: true },
  });
  if (!eng) return null;
  if (eng.firmId !== firmId && !isSuperAdmin) return null;
  return eng;
}

export async function POST(req: Request, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { engagementId } = await params;
  const eng = await verifyAccess(engagementId, session.user.firmId, session.user.isSuperAdmin);
  if (!eng) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const portalUserId: string | null = typeof body?.portalUserId === 'string' && body.portalUserId.length > 0
    ? body.portalUserId
    : null;
  const expirySeconds = Math.min(
    MAX_EXPIRY_SECONDS,
    Math.max(60, Number(body?.expirySeconds) || DEFAULT_EXPIRY_SECONDS),
  );

  if (!portalUserId) {
    return NextResponse.json({ error: 'portalUserId required' }, { status: 400 });
  }

  // The impersonated user MUST belong to the engagement's client —
  // prevents a firm user from previewing as someone outside the scope
  // of this engagement (which would also leak that other client's
  // data via the portal pages).
  const portalUser = await prisma.clientPortalUser.findUnique({
    where: { id: portalUserId },
    select: { id: true, clientId: true, isActive: true, name: true },
  });
  if (!portalUser) return NextResponse.json({ error: 'Portal user not found' }, { status: 404 });
  if (portalUser.clientId !== eng.clientId) {
    return NextResponse.json({ error: 'Portal user belongs to a different client' }, { status: 400 });
  }
  if (!portalUser.isActive) {
    return NextResponse.json({ error: 'Portal user is deactivated' }, { status: 400 });
  }

  const token = crypto.randomBytes(48).toString('hex');
  const expiresAt = new Date(Date.now() + expirySeconds * 1000);

  try {
    const created = await prisma.clientPortalPreviewSession.create({
      data: {
        token,
        portalUserId: portalUser.id,
        engagementId,
        firmUserId: session.user.id,
        isReadOnly: true,
        expiresAt,
      },
      select: { id: true, expiresAt: true },
    });
    return NextResponse.json({
      ok: true,
      token,
      expiresAt: created.expiresAt,
      portalUserName: portalUser.name,
    });
  } catch (err: any) {
    const code = err?.code || 'unknown';
    console.error('[portal-preview-session] create failed:', { code, message: err?.message });
    const hint = code === 'P2022'
      ? 'Column missing — run prisma/migrations/20260518_portal_preview_session/migration.sql in Supabase SQL Editor and retry.'
      : `Database error ${code}.`;
    return NextResponse.json({ error: hint, code }, { status: 500 });
  }
}

/**
 * Revoke (immediately expire) preview sessions. Two modes:
 *   - DELETE ?token=<theToken>    — revoke this specific preview
 *   - DELETE (no token)            — revoke all of the caller's
 *                                    previews for this engagement
 */
export async function DELETE(req: Request, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { engagementId } = await params;
  const eng = await verifyAccess(engagementId, session.user.firmId, session.user.isSuperAdmin);
  if (!eng) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const url = new URL(req.url);
  const token = url.searchParams.get('token');

  const now = new Date();
  if (token) {
    await prisma.clientPortalPreviewSession.updateMany({
      where: { token, firmUserId: session.user.id, engagementId },
      data: { revokedAt: now },
    });
  } else {
    await prisma.clientPortalPreviewSession.updateMany({
      where: { firmUserId: session.user.id, engagementId, revokedAt: null },
      data: { revokedAt: now },
    });
  }
  return NextResponse.json({ ok: true });
}
