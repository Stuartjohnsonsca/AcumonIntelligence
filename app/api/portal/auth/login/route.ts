import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { sendPortalVerificationCode } from '@/lib/email-portal';
import { issuePortalSessionToken } from '@/lib/portal-session';

/**
 * POST /api/portal/auth/login
 * Client portal login — validates credentials, sends 2FA code.
 */
export async function POST(req: Request) {
  try {
    const { email, password } = await req.json();

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
    }

    // Use explicit select so Prisma doesn't include the 2026-04-20
    // session_token / session_expires_at columns in the SELECT — that
    // keeps login working across every state of the migration (not
    // applied / partially applied / fully applied). The fields we
    // actually need are always-present columns.
    const user = await prisma.clientPortalUser.findFirst({
      where: { email: email.toLowerCase(), isActive: true },
      select: {
        id: true,
        clientId: true,
        email: true,
        name: true,
        passwordHash: true,
        isActive: true,
        isClientAdmin: true,
        client: { select: { clientName: true } },
      },
    });

    if (!user) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }

    // Check if 2FA is disabled (for testing)
    if (process.env.DISABLE_2FA === 'true') {
      const issued = await issuePortalSessionToken(user.id);
      return NextResponse.json({
        skipVerify: true,
        token: issued?.token,
        userId: user.id,
        user: { id: user.id, email: user.email, name: user.name, clientId: user.clientId },
        message: '2FA disabled — logged in directly',
      });
    }

    // Generate 6-digit code
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const sessionToken = crypto.randomBytes(32).toString('hex');

    // Store 2FA code with 10-minute expiry
    await prisma.clientPortalTwoFactor.create({
      data: {
        userId: user.id,
        code,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
    });

    // Send verification email
    try {
      await sendPortalVerificationCode(user.email, user.name, code);
    } catch (emailErr) {
      console.error('Failed to send portal 2FA email:', emailErr);
    }

    return NextResponse.json({
      sessionToken,
      userId: user.id,
      message: 'Verification code sent to your email',
    });
  } catch (error: any) {
    console.error('[Portal Login] error:', {
      message: error?.message,
      code: error?.code,
      meta: error?.meta,
      stack: error?.stack,
    });
    return NextResponse.json({
      error: 'Login failed',
      detail: error?.message || 'unknown error',
      code: error?.code || null,
    }, { status: 500 });
  }
}
