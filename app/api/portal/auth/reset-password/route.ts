import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { sendPortalPasswordResetCode } from '@/lib/email-portal';

/**
 * POST /api/portal/auth/reset-password
 * Three-step password reset: request → verify code → set new password.
 * Uses the same ClientPortalTwoFactor table for reset codes.
 */
export async function POST(req: Request) {
  try {
    const { action, email, code, resetToken, newPassword } = await req.json();

    // ─── Step 1: Request reset code ──────────────────────────────
    if (action === 'request') {
      if (!email) {
        return NextResponse.json({ error: 'Email is required' }, { status: 400 });
      }

      const user = await prisma.clientPortalUser.findFirst({
        where: { email: email.toLowerCase(), isActive: true },
      });

      if (!user) {
        console.warn(`[Portal Reset] No active portal user found for email: ${email.toLowerCase()}`);
        return NextResponse.json({ error: 'No portal account found with that email address. Please contact your auditor to set up portal access.' }, { status: 404 });
      }

      console.log(`[Portal Reset] Found portal user ${user.id} for email ${user.email}`);

      // Generate 6-digit code
      const resetCode = String(Math.floor(100000 + Math.random() * 900000));

      // Store reset code with 15-minute expiry
      await prisma.clientPortalTwoFactor.create({
        data: {
          userId: user.id,
          code: resetCode,
          expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        },
      });

      // Send email
      try {
        await sendPortalPasswordResetCode(user.email, user.name, resetCode);
      } catch (emailErr) {
        console.error('Failed to send reset code email:', emailErr);
        // Clean up the code since email failed
        await prisma.clientPortalTwoFactor.deleteMany({
          where: { userId: user.id, code: resetCode },
        });
        return NextResponse.json({ error: 'Failed to send reset email. Please try again or contact your auditor.' }, { status: 500 });
      }

      return NextResponse.json({ message: 'A reset code has been sent to your email.' });
    }

    // ─── Step 2: Verify reset code ───────────────────────────────
    if (action === 'verify') {
      if (!email || !code) {
        return NextResponse.json({ error: 'Email and code are required' }, { status: 400 });
      }

      const user = await prisma.clientPortalUser.findFirst({
        where: { email: email.toLowerCase(), isActive: true },
      });
      if (!user) {
        return NextResponse.json({ error: 'Invalid code' }, { status: 401 });
      }

      // Find valid (unexpired) code
      const twoFactor = await prisma.clientPortalTwoFactor.findFirst({
        where: {
          userId: user.id,
          code,
          expiresAt: { gt: new Date() },
        },
        orderBy: { createdAt: 'desc' },
      });

      if (!twoFactor) {
        return NextResponse.json({ error: 'Invalid or expired code' }, { status: 401 });
      }

      // Delete the used code
      await prisma.clientPortalTwoFactor.delete({ where: { id: twoFactor.id } });

      // Generate a short-lived reset token
      const token = crypto.randomBytes(32).toString('hex');

      // Store it as another 2FA record with 5-minute expiry (for the reset step)
      await prisma.clientPortalTwoFactor.create({
        data: {
          userId: user.id,
          code: `reset_${token}`,
          expiresAt: new Date(Date.now() + 5 * 60 * 1000),
        },
      });

      return NextResponse.json({ resetToken: token });
    }

    // ─── Step 3: Set new password ────────────────────────────────
    if (action === 'reset') {
      if (!email || !resetToken || !newPassword) {
        return NextResponse.json({ error: 'Email, reset token, and new password are required' }, { status: 400 });
      }

      if (newPassword.length < 8) {
        return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
      }

      const user = await prisma.clientPortalUser.findFirst({
        where: { email: email.toLowerCase(), isActive: true },
      });
      if (!user) {
        return NextResponse.json({ error: 'Invalid request' }, { status: 401 });
      }

      // Verify reset token
      const tokenRecord = await prisma.clientPortalTwoFactor.findFirst({
        where: {
          userId: user.id,
          code: `reset_${resetToken}`,
          expiresAt: { gt: new Date() },
        },
      });

      if (!tokenRecord) {
        return NextResponse.json({ error: 'Reset token expired or invalid. Please start over.' }, { status: 401 });
      }

      // Delete the token
      await prisma.clientPortalTwoFactor.delete({ where: { id: tokenRecord.id } });

      // Hash and update password
      const passwordHash = await bcrypt.hash(newPassword, 12);
      await prisma.clientPortalUser.update({
        where: { id: user.id },
        data: { passwordHash },
      });

      return NextResponse.json({ success: true, message: 'Password reset successfully' });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    console.error('Password reset error:', error);
    return NextResponse.json({ error: 'Password reset failed' }, { status: 500 });
  }
}
