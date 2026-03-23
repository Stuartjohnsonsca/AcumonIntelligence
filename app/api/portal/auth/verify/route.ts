import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import crypto from 'crypto';

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

    // Update last login
    await prisma.clientPortalUser.update({
      where: { id: twoFactor.user.id },
      data: { lastLoginAt: new Date() },
    });

    // Generate a portal session token (simple JWT-like token for now)
    const token = crypto.randomBytes(48).toString('hex');

    // In production, store this token in a session table or use JWT
    // For now, encode user info in a signed cookie or query param
    return NextResponse.json({
      token,
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
