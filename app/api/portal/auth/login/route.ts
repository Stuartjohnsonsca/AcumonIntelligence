import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { sendPortalVerificationCode } from '@/lib/email-portal';
import { issuePortalSessionToken } from '@/lib/portal-session';
import { decidePortalAccess } from '@/lib/portal-principal';
import { PORTAL_DEVICE_COOKIE, findActiveTrustedDevice } from '@/lib/portal-trusted-device';
import { logUserAction } from '@/lib/user-action-log';

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

    // Read the device-trust cookie now so we can fast-path past 2FA
    // for a returning browser. A different machine has no cookie and
    // falls through to the standard email-code flow — a stolen
    // password alone never gets the attacker in.
    const cookieHeader = req.headers.get('cookie') || '';
    const cookieMatch = cookieHeader.match(new RegExp(`(?:^|;\\s*)${PORTAL_DEVICE_COOKIE}=([^;]+)`));
    const deviceToken = cookieMatch ? decodeURIComponent(cookieMatch[1]) : null;

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

    // Log the failure mode server-side so an operator can tell apart
    // "no portal user with this email" vs "wrong password" without
    // exposing the difference to the client (which would let an
    // attacker enumerate valid emails). The client always sees the
    // same generic 401.
    if (!user) {
      console.warn('[Portal Login] no active portal user for email', { email: email.toLowerCase() });
      // Record the attempt against a null userId so the audit trail
      // captures brute-force probes against unknown emails.
      void logUserAction({
        userKind: 'portal',
        userId: null,
        userName: String(email).toLowerCase(),
        action: 'portal.login.failed',
        summary: `Portal login failed — no active user for ${String(email).toLowerCase()}`,
        request: req as any,
        metadata: { reason: 'unknown_email' },
      });
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      console.warn('[Portal Login] wrong password', { email: user.email, userId: user.id, clientId: user.clientId });
      void logUserAction({
        userKind: 'portal',
        userId: user.id,
        userName: user.name,
        clientId: user.clientId,
        action: 'portal.login.failed',
        summary: `Portal login failed — wrong password for ${user.email}`,
        request: req as any,
        metadata: { reason: 'wrong_password' },
      });
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }

    // Portal Principal gate — staff members can't log in until their
    // engagement's Portal Principal has (a) completed setup and (b)
    // ticked accessConfirmed for this user. Portal Principals themselves
    // always pass this gate. Decision made BEFORE a 2FA code is sent
    // so we don't spam codes to users who couldn't use them anyway.
    const access = await decidePortalAccess(user.id, user.clientId);
    if (!access.allowed) {
      const message =
        access.reason === 'awaiting-setup'
          ? 'Your organisation\u2019s Portal Principal has not yet completed setup. Please ask them to finish their first-sign-in steps before trying again.'
          : access.reason === 'access-not-confirmed'
            ? 'Your Portal Principal has not confirmed your access to this engagement yet. Please ask them to approve you on their dashboard.'
            : access.reason === 'no-allocation'
              ? 'You are not yet allocated to any active engagement for this client. Please contact your Portal Principal or the audit team.'
              : 'Portal access is not available. Please contact the audit team.';
      return NextResponse.json({ error: message, reason: access.reason }, { status: 403 });
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

    // Trusted-device fast path — when the user's browser carries a
    // still-valid trust cookie minted by a previous 2FA success, skip
    // straight to a session token. The Portal Principal controls the
    // trust window per engagement (AuditEngagement.portal2faTrustDays);
    // we resolve the MIN of that across all the user's engagements,
    // and 0 / null means "always require 2FA".
    if (deviceToken) {
      const trusted = await findActiveTrustedDevice(user.id, deviceToken);
      if (trusted) {
        const issued = await issuePortalSessionToken(user.id);
        void logUserAction({
          userKind: 'portal',
          userId: user.id,
          userName: user.name,
          clientId: user.clientId,
          action: 'portal.login.trusted_device',
          summary: `Portal login by ${user.email} skipped 2FA via trusted device`,
          request: req as any,
          metadata: { trustedUntil: trusted.expiresAt.toISOString() },
        });
        return NextResponse.json({
          skipVerify: true,
          token: issued?.token,
          userId: user.id,
          user: { id: user.id, email: user.email, name: user.name, clientId: user.clientId },
          trustedUntil: trusted.expiresAt.toISOString(),
          message: 'Skipped 2FA — trusted device',
        });
      }
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

    void logUserAction({
      userKind: 'portal',
      userId: user.id,
      userName: user.name,
      clientId: user.clientId,
      action: 'portal.login.code_sent',
      summary: `Portal 2FA code sent to ${user.email}`,
      request: req as any,
    });

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
