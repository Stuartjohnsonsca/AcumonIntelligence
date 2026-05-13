import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { issuePortalSessionToken } from '@/lib/portal-session';
import { decidePortalAccess } from '@/lib/portal-principal';
import { PORTAL_DEVICE_COOKIE, mintTrustedDevice } from '@/lib/portal-trusted-device';
import { logUserAction } from '@/lib/user-action-log';

/**
 * POST /api/portal/auth/verify
 * Verify 2FA code for client portal login.
 */
export async function POST(req: Request) {
  try {
    const { sessionToken, code } = await req.json();

    if (!sessionToken || !code) {
      return NextResponse.json({ error: 'Session token and code are required' }, { status: 400 });
    }

    // Find unused, unexpired code. Explicit select on the related user
    // avoids pulling in the 2026-04-20 session_token / session_expires_at
    // columns that may not yet be live in the DB.
    const twoFactor = await prisma.clientPortalTwoFactor.findFirst({
      where: {
        code,
        used: false,
        expiresAt: { gt: new Date() },
      },
      include: {
        user: {
          select: { id: true, email: true, name: true, clientId: true, isActive: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!twoFactor) {
      return NextResponse.json({ error: 'Invalid or expired verification code' }, { status: 401 });
    }

    // Mark code as used
    await prisma.clientPortalTwoFactor.update({
      where: { id: twoFactor.id },
      data: { used: true },
    });

    // Re-check the Portal Principal gate — the allocation state may
    // have changed between the login POST and this verify POST (e.g.
    // the Portal Principal revoked access in the intervening minutes).
    // Cheap query, strict default, matches what login already does.
    const access = await decidePortalAccess(twoFactor.user.id, twoFactor.user.clientId);
    if (!access.allowed) {
      const message =
        access.reason === 'awaiting-setup'
          ? 'Portal Principal setup is still outstanding. Please ask your Portal Principal to complete their first-sign-in steps.'
          : access.reason === 'access-not-confirmed'
            ? 'Your Portal Principal has not confirmed your access.'
            : 'Portal access is not available.';
      return NextResponse.json({ error: message, reason: access.reason }, { status: 403 });
    }

    // Issue a server-stamped session token — persisted on the user
    // record so downstream endpoints can validate it. This replaces
    // the previous "return a random string and hope" pattern, which
    // let any request with any token be answered with the first
    // active portal user's data.
    const issued = await issuePortalSessionToken(twoFactor.user.id);

    // Mint a trusted-device row + cookie so subsequent logins from
    // THIS browser can skip 2FA inside the Principal-configured
    // window. mintTrustedDevice returns null when the user's effective
    // trust window is 0 — in that case we simply don't set the
    // cookie and the next login goes through 2FA as today.
    const userAgent = req.headers.get('user-agent');
    const forwarded = req.headers.get('x-forwarded-for') || '';
    const ip = forwarded.split(',')[0]?.trim() || null;
    const minted = await mintTrustedDevice({
      userId: twoFactor.user.id,
      userAgent,
      ipAddress: ip,
    });

    const res = NextResponse.json({
      token: issued?.token,
      sessionPersisted: issued?.persisted ?? false,
      sessionError: issued?.error || null,
      deviceTrusted: !!minted,
      deviceTrustedUntil: minted?.expiresAt.toISOString() || null,
      user: {
        id: twoFactor.user.id,
        email: twoFactor.user.email,
        name: twoFactor.user.name,
        clientId: twoFactor.user.clientId,
      },
    });
    if (minted) {
      const maxAge = Math.max(60, Math.floor((minted.expiresAt.getTime() - Date.now()) / 1000));
      res.cookies.set({
        name: PORTAL_DEVICE_COOKIE,
        value: minted.token,
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/',
        maxAge,
      });
    }
    void logUserAction({
      userKind: 'portal',
      userId: twoFactor.user.id,
      userName: twoFactor.user.name,
      clientId: twoFactor.user.clientId,
      action: 'portal.login.success',
      summary: `Portal login by ${twoFactor.user.email}`,
      request: req as any,
      metadata: { deviceTrusted: !!minted, ip },
    });
    return res;
  } catch (error: any) {
    console.error('[Portal Verify] error:', {
      message: error?.message,
      code: error?.code,
      meta: error?.meta,
      stack: error?.stack,
    });
    return NextResponse.json({
      error: 'Verification failed',
      detail: error?.message || 'unknown error',
      code: error?.code || null,
    }, { status: 500 });
  }
}
