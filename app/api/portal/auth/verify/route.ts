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

    // Find unused, unexpired code
    const twoFactor = await prisma.clientPortalTwoFactor.findFirst({
      where: {
        code,
        used: false,
        expiresAt: { gt: new Date() },
      },
      include: {
        user: {
          select: { id: true, email: true, name: true, clientId: true },
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
      user: {
        id: twoFactor.user.id,
        email: twoFactor.user.email,
        name: twoFactor.user.name,
        clientId: twoFactor.user.clientId,
      },
    });
  } catch (error) {
    console.error('Portal verify error:', error);
    return NextResponse.json({ error: 'Verification failed' }, { status: 500 });
  }
}
