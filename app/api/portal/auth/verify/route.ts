import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { issuePortalSessionToken } from '@/lib/portal-session';

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

    // Issue a server-stamped session token — persisted on the user
    // record so downstream endpoints can validate it. This replaces
    // the previous "return a random string and hope" pattern, which
    // let any request with any token be answered with the first
    // active portal user's data.
    const issued = await issuePortalSessionToken(twoFactor.user.id);

    return NextResponse.json({
      token: issued?.token,
      sessionPersisted: issued?.persisted ?? false,
      sessionError: issued?.error || null,
      user: {
        id: twoFactor.user.id,
        email: twoFactor.user.email,
        name: twoFactor.user.name,
        clientId: twoFactor.user.clientId,
      },
    });
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
