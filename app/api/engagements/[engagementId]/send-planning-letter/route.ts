import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { runPlanningLetterJob } from '@/lib/planning-letter-job';
import { checkSendPermission } from '@/lib/document-send-permission';

/**
 * POST /api/engagements/:engagementId/send-planning-letter
 *
 * Enqueue a Planning Letter send. Returns immediately with `{ jobId }`
 * so the modal can close without holding the browser open while the
 * server renders + uploads + emails. The heavy work runs in the
 * background; the job row's status / errorMessage / completedAt are
 * the source of truth and are polled by the engagement's orange-tab
 * indicator. Quick gates (auth, permission, recipient gate) still run
 * synchronously here so the user gets immediate feedback if the send
 * can never succeed at all.
 */
type Ctx = { params: Promise<{ engagementId: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { engagementId } = await ctx.params;
  const body = await req.json().catch(() => null);
  const documentTemplateId = typeof body?.documentTemplateId === 'string' ? body.documentTemplateId : '';
  const emailTemplateId = typeof body?.emailTemplateId === 'string' ? body.emailTemplateId : '';
  if (!documentTemplateId || !emailTemplateId) {
    return NextResponse.json({ error: 'documentTemplateId and emailTemplateId are both required' }, { status: 400 });
  }

  // Tenant check.
  const engagement = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    select: { id: true, firmId: true, clientId: true },
  });
  if (!engagement) return NextResponse.json({ error: 'Engagement not found' }, { status: 404 });
  if (!session.user.isSuperAdmin && engagement.firmId !== session.user.firmId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // ── Step 0a: send-permission gate (synchronous — fast) ──────────────
  // We still surface a 403 immediately so the auditor sees the
  // permission popup straight away rather than waiting for the
  // background processor to discover the same problem.
  const docTpl = await prisma.documentTemplate.findUnique({
    where: { id: documentTemplateId },
    select: { sendPermission: true, sendSignOffSection: true },
  });
  if (docTpl) {
    const permFail = await checkSendPermission(engagementId, docTpl);
    if (permFail) return NextResponse.json(permFail, { status: 403 });
  }

  // ── Step 0b: recipient gate (synchronous — fast) ────────────────────
  // Same rule as before — if no Informed Management contact has portal
  // access we stop BEFORE enqueueing because the background processor
  // would have nothing to send to. The modal still surfaces the 422.
  const informedContacts = await prisma.auditClientContact.findMany({
    where: { engagementId, isInformedManagement: true },
  });
  const informedEmails = informedContacts
    .map(c => (c.email || '').trim().toLowerCase())
    .filter(e => e.length > 0);
  const portalUsers = informedEmails.length > 0
    ? await prisma.clientPortalUser.findMany({
        where: {
          clientId: engagement.clientId,
          isActive: true,
          email: { in: informedEmails, mode: 'insensitive' as const },
        },
      })
    : [];
  const portalEmailSet = new Set(portalUsers.map(u => u.email.toLowerCase()));
  const eligible = informedContacts.filter(c => {
    const e = (c.email || '').trim().toLowerCase();
    return e && portalEmailSet.has(e);
  });
  if (eligible.length === 0) {
    return NextResponse.json({
      error: 'No recipient available',
      reason: 'no_informed_management_with_portal_access',
      detail: informedContacts.length === 0
        ? 'No contacts on this engagement are flagged as Informed Management. Tick at least one contact as Informed Management, make sure they have Portal Access, and try again.'
        : 'One or more contacts are flagged as Informed Management, but none of them have Client Portal access. Grant Portal Access to at least one Informed Management contact and try again.',
    }, { status: 422 });
  }

  // ── Enqueue the job + kick off background processing ────────────────
  // We deliberately don't `await` runPlanningLetterJob — it's the
  // server-side fire-and-forget the user asked for. Any failure is
  // captured into the job row by the helper itself so the modal can
  // close immediately and the engagement's job poller picks up the
  // outcome.
  const job = await (prisma as any).planningLetterJob.create({
    data: {
      engagementId,
      firmId: engagement.firmId,
      clientId: engagement.clientId,
      documentTemplateId,
      emailTemplateId,
      status: 'queued',
      createdById: session.user.id,
      createdByName: session.user.name || session.user.email || null,
    },
  });

  void runPlanningLetterJob(job.id, {
    engagementId,
    clientId: engagement.clientId,
    firmId: engagement.firmId,
    documentTemplateId,
    emailTemplateId,
    actorUserId: session.user.id,
    actorUserName: session.user.name || session.user.email || null,
  });

  return NextResponse.json({
    ok: true,
    queued: true,
    jobId: job.id,
    recipientCount: eligible.length,
  }, { status: 202 });
}
