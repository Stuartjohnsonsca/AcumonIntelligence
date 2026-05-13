/**
 * POST /api/engagements/[engagementId]/comms-preference-invite
 *
 * Emails every active portal user attached to the engagement a
 * deep-link to /portal/my-details where they pick their preferred
 * notification channel via the radio-button MessagingChannelsEditor.
 *
 * Audience:
 *   - The engagement's Portal Principal.
 *   - Every access-confirmed staff member on the engagement's
 *     ClientPortalStaffMember list.
 *
 * Replaces the prior "audit team pastes a WeCom webhook URL" flow.
 * The audit firm no longer owns the channel-setup config — clients
 * self-serve.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { assertEngagementWriteAccess } from '@/lib/auth/engagement-auth';
import { sendEmail } from '@/lib/email';
import { resolvePortalPublicUrl } from '@/lib/portal-public-url';
import { issuePortalSessionToken } from '@/lib/portal-session';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ engagementId: string }> },
) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { engagementId } = await params;
  const guard = await assertEngagementWriteAccess(engagementId, session);
  if (guard instanceof NextResponse) return guard;

  const engagement = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    select: {
      id: true, firmId: true, clientId: true, portalPrincipalId: true,
      client: { select: { clientName: true } },
    },
  });
  if (!engagement) return NextResponse.json({ error: 'Engagement not found' }, { status: 404 });
  if (engagement.firmId !== session.user.firmId && !session.user.isSuperAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Build the audience: Principal + access-confirmed staff members
  // for this engagement. De-dupe by portal user id so the Principal
  // who's also on the staff list doesn't get two emails.
  const audience = new Map<string, { id: string; email: string; name: string }>();

  if (engagement.portalPrincipalId) {
    const principal = await prisma.clientPortalUser.findUnique({
      where: { id: engagement.portalPrincipalId },
      select: { id: true, email: true, name: true, isActive: true },
    });
    if (principal?.isActive) {
      audience.set(principal.id, { id: principal.id, email: principal.email, name: principal.name });
    }
  }

  const staffRows = await prisma.clientPortalStaffMember.findMany({
    where: { engagementId, isActive: true, accessConfirmed: true, portalUserId: { not: null } },
    select: {
      portalUserId: true,
      portalUser: { select: { id: true, email: true, name: true, isActive: true } },
    },
  });
  for (const s of staffRows) {
    const u = s.portalUser;
    if (u?.isActive) {
      audience.set(u.id, { id: u.id, email: u.email, name: u.name });
    }
  }

  if (audience.size === 0) {
    return NextResponse.json({ error: 'No active portal users to invite. Add the Portal Principal first, or have staff complete sign-in.' }, { status: 400 });
  }

  // Dynamically resolved base URL (PORTAL_PUBLIC_URL env override →
  // request host → Vercel auto-vars). See lib/portal-public-url.ts.
  const requestHost = req.headers.get('host');
  const portalBase = resolvePortalPublicUrl({ requestHost });
  if (!portalBase) {
    return NextResponse.json({ error: 'Cannot determine portal URL. Set PORTAL_PUBLIC_URL env var or deploy to Vercel so VERCEL_PROJECT_PRODUCTION_URL resolves.' }, { status: 500 });
  }

  // Issue a fresh session token per recipient so the link logs them
  // straight into /portal/my-details. Tokens follow the existing
  // expiry policy in issuePortalSessionToken.
  const clientName = engagement.client?.clientName || 'your engagement';
  let sent = 0;
  const failures: string[] = [];

  for (const user of audience.values()) {
    try {
      const issued = await issuePortalSessionToken(user.id);
      const link = issued?.token
        ? `${portalBase}/portal/my-details?token=${encodeURIComponent(issued.token)}#communication`
        : `${portalBase}/portal`;
      await sendEmail(
        user.email,
        `Please set your communication preferences — ${clientName}`,
        renderInviteHtml({ name: user.name, clientName, link }),
        { displayName: user.name },
      );
      sent++;
    } catch (err) {
      console.error('[comms-preference-invite] send failed for', user.email, err);
      failures.push(user.email);
    }
  }

  return NextResponse.json({
    ok: true,
    sentTo: sent,
    failures,
    message: failures.length === 0
      ? `Sent to ${sent} client user(s).`
      : `Sent to ${sent}; failed for ${failures.length} (${failures.join(', ')}).`,
  });
}

function renderInviteHtml(args: { name: string; clientName: string; link: string }): string {
  const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
      <h2 style="color: #1e3a5f; font-size: 18px; margin: 0 0 12px;">Set your notification preference</h2>
      <p style="color: #374151; font-size: 14px;">Hi ${escape(args.name)},</p>
      <p style="color: #374151; font-size: 14px; line-height: 1.55;">
        We'd like to make sure we reach you on the channel you check most. Please pick how you'd prefer to receive audit-related notifications for <strong>${escape(args.clientName)}</strong>.
        You can choose from WhatsApp, Telegram, SMS, WeChat or email-only.
      </p>
      <p style="margin: 28px 0;">
        <a href="${args.link}" style="display: inline-block; padding: 12px 24px; background: #2563eb; color: white; text-decoration: none; border-radius: 6px; font-weight: 600;">Set my preference</a>
      </p>
      <p style="color: #6b7280; font-size: 12px;">The link signs you in and takes you straight to your communication preferences. It expires shortly for security.</p>
    </div>
  `;
}
