import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import crypto from 'crypto';
import { sendEmail } from '@/lib/email';

/**
 * Schedule specialist reviews — list + create.
 *
 *   GET /api/engagements/:id/schedule-reviews?scheduleKey=X
 *     List all reviews for an engagement; optionally filter to one
 *     schedule so the bottom-of-schedule panel only has to fetch
 *     what it needs.
 *
 *   POST /api/engagements/:id/schedule-reviews
 *     Create a new review request + send an email to the specialist
 *     with a magic-link to the review page.
 *     Body: { scheduleKey, role, customMessage?, assigneeName?, assigneeEmail? }
 *     If assignee not provided, we look it up from the firm's
 *     configured specialist roles (specialist_roles template).
 */
type Ctx = { params: Promise<{ engagementId: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await ctx.params;
  const { searchParams } = new URL(req.url);
  const scheduleKey = searchParams.get('scheduleKey');

  // Tenant check
  const engagement = await prisma.auditEngagement.findUnique({
    where: { id: engagementId }, select: { firmId: true },
  });
  if (!engagement) return NextResponse.json({ error: 'Engagement not found' }, { status: 404 });
  if (!session.user.isSuperAdmin && engagement.firmId !== session.user.firmId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const where: any = { engagementId };
  if (scheduleKey) where.scheduleKey = scheduleKey;
  const reviews = await prisma.scheduleSpecialistReview.findMany({
    where,
    orderBy: { sentAt: 'desc' },
  });
  // Strip the token from the list response — reviewers need it only
  // via their email. Callers in the engagement UI have no use for it.
  return NextResponse.json({
    reviews: reviews.map(r => ({
      id: r.id,
      scheduleKey: r.scheduleKey,
      role: r.role,
      assigneeName: r.assigneeName,
      assigneeEmail: r.assigneeEmail,
      status: r.status,
      comments: r.comments,
      sentByName: r.sentByName,
      sentAt: r.sentAt.toISOString(),
      decidedAt: r.decidedAt?.toISOString() || null,
    })),
  });
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await ctx.params;
  const body = await req.json().catch(() => null);
  const scheduleKey = String(body?.scheduleKey || '').trim();
  const role = String(body?.role || '').trim();
  const customMessage = String(body?.customMessage || '').trim();
  let assigneeName = String(body?.assigneeName || '').trim();
  let assigneeEmail = String(body?.assigneeEmail || '').trim().toLowerCase();
  if (!scheduleKey || !role) {
    return NextResponse.json({ error: 'scheduleKey and role are required' }, { status: 400 });
  }

  const engagement = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    include: { client: { select: { clientName: true } }, period: { select: { endDate: true } } },
  });
  if (!engagement) return NextResponse.json({ error: 'Engagement not found' }, { status: 404 });
  if (!session.user.isSuperAdmin && engagement.firmId !== session.user.firmId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Resolve assignee from the firm's specialist_roles config if the
  // caller didn't provide an explicit name/email. Keeps the send-
  // modal minimal — the admin has already typed the email elsewhere.
  if (!assigneeEmail || !assigneeName) {
    try {
      const rolesRow = await prisma.methodologyTemplate.findUnique({
        where: {
          firmId_templateType_auditType: {
            firmId: engagement.firmId,
            templateType: 'specialist_roles',
            auditType: 'ALL',
          },
        },
      });
      const roles = Array.isArray(rolesRow?.items) ? rolesRow!.items as any[] : [];
      const match = roles.find((r: any) => r.key === role && r.isActive !== false);
      if (match) {
        if (!assigneeName) assigneeName = match.name || '';
        if (!assigneeEmail) assigneeEmail = (match.email || '').toLowerCase();
      }
    } catch { /* tolerant */ }
  }
  if (!assigneeEmail) {
    return NextResponse.json({
      error: `No email configured for role ${role}. Ask the Methodology Admin to set the specialist's name and email under Methodology Admin → Specialist Roles.`,
    }, { status: 422 });
  }

  // Generate a URL-safe opaque token for magic-link access. Stored
  // uniquely on the review row — a new request creates a new row with
  // a fresh token so links can't be replayed.
  const token = crypto.randomBytes(24).toString('base64url');

  const created = await prisma.scheduleSpecialistReview.create({
    data: {
      firmId: engagement.firmId,
      engagementId,
      scheduleKey,
      role,
      assigneeName: assigneeName || assigneeEmail,
      assigneeEmail,
      status: 'pending',
      token,
      sentById: session.user.id,
      sentByName: session.user.name || session.user.email || null,
    },
  });

  // Build the magic-link URL. Prefer XERO_REDIRECT_URI's base URL
  // structure if it's been configured (same as other parts of the
  // app) — otherwise fall back to NEXTAUTH_URL.
  const baseUrl = (process.env.NEXTAUTH_URL || 'https://acumon-website.vercel.app').replace(/\/+$/, '');
  const reviewUrl = `${baseUrl}/specialist-review/${token}`;
  const periodEnd = engagement.period?.endDate ? new Date(engagement.period.endDate).toLocaleDateString('en-GB') : '';
  const subject = `Specialist review request — ${engagement.client.clientName}`;
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:20px;color:#334155">
      <h2 style="color:#1e40af;margin-bottom:4px">Specialist review required</h2>
      <p>Hi ${escapeHtml(assigneeName || assigneeEmail)},</p>
      <p>
        ${escapeHtml(session.user.name || 'An auditor')} has asked you to review a schedule on the audit of
        <strong>${escapeHtml(engagement.client.clientName)}</strong>${periodEnd ? ` (period ended ${escapeHtml(periodEnd)})` : ''}.
      </p>
      <p><strong>Schedule:</strong> ${escapeHtml(scheduleKey)}</p>
      ${customMessage ? `<blockquote style="border-left:3px solid #cbd5e1;padding:8px 12px;color:#475569;margin:16px 0">${escapeHtml(customMessage).replace(/\n/g, '<br>')}</blockquote>` : ''}
      <p>Click below to open the schedule, add comments and decide whether to accept or reject it:</p>
      <p style="text-align:center;margin:24px 0">
        <a href="${reviewUrl}" style="background:#2563eb;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600">Open review</a>
      </p>
      <p style="font-size:12px;color:#94a3b8">This link is private — please don&rsquo;t forward it.</p>
    </div>`;
  let messageId: string | undefined;
  try {
    console.log(`[schedule-reviews] Sending specialist review email — engagement=${engagementId} schedule="${scheduleKey}" role=${role} to=${assigneeEmail}`);
    const emailResult = await sendEmail(assigneeEmail, subject, html, { displayName: assigneeName });
    messageId = emailResult?.messageId;
    console.log(`[schedule-reviews] Specialist review email accepted by provider — messageId=${messageId || '(none)'} to=${assigneeEmail}`);
  } catch (err: any) {
    // Roll back on email failure — no point leaving orphaned rows the
    // specialist never knows about. Surface the full provider error
    // back to the caller so the UI can tell the auditor *why* it failed
    // rather than pretending the review was sent.
    await prisma.scheduleSpecialistReview.delete({ where: { id: created.id } }).catch(() => {});
    const detail = err?.message || 'unknown error';
    console.error(`[schedule-reviews] Specialist review email FAILED — to=${assigneeEmail} — ${detail}`);
    return NextResponse.json({ error: `Email failed: ${detail}` }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    messageId,
    review: {
      id: created.id,
      scheduleKey: created.scheduleKey,
      role: created.role,
      assigneeName: created.assigneeName,
      assigneeEmail: created.assigneeEmail,
      status: created.status,
      sentAt: created.sentAt.toISOString(),
    },
  });
}

function escapeHtml(s: string): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
