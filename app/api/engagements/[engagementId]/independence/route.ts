import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import {
  getFirmIndependenceQuestions,
  hasAuditStarted,
  type IndependenceAnswer,
  type IndependenceQuestion,
} from '@/lib/independence';
import { sendIndependenceDeclinedEmail } from '@/lib/audit-email';

/**
 * Per-engagement Independence endpoints.
 *
 * GET  — current user's status for this engagement + the firm's question list.
 *        Also returns `required: true` when the audit has started AND the
 *        user has an outstanding row — the client gate keys off this.
 *
 * POST — submit answers. Auto-evaluates isIndependent from the answers:
 *        any hardFail question answered No, or any explicit "overall not
 *        independent" flag from the client, sets isIndependent=false and
 *        triggers the RI + Ethics Partner email.
 */

interface RouteCtx {
  params: Promise<{ engagementId: string }>;
}

export async function GET(_req: NextRequest, ctx: RouteCtx) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { engagementId } = await ctx.params;
  const userId = session.user.id;
  const firmId = session.user.firmId;

  const engagement = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    select: { id: true, firmId: true, status: true, startedAt: true },
  });
  if (!engagement || engagement.firmId !== firmId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Is the user actually on this engagement? (Or a super-admin / methodology
  // admin who's viewing it in an admin capacity — they bypass the gate.)
  const isAdminViewer = Boolean(session.user.isSuperAdmin || session.user.isMethodologyAdmin);
  const teamMembership = await prisma.auditTeamMember.findUnique({
    where: { engagementId_userId: { engagementId, userId } },
    select: { role: true },
  });

  const started = hasAuditStarted(engagement);
  const row = await prisma.auditMemberIndependence.findUnique({
    where: { engagementId_userId: { engagementId, userId } },
  });

  const questions = await getFirmIndependenceQuestions(firmId);

  // Gate logic — only block when:
  //  - audit has started, AND
  //  - user is an actual team member (not just an admin peeking), AND
  //  - their row is NOT confirmed (outstanding or declined keeps them out).
  const required = Boolean(
    started
    && teamMembership
    && (!row || row.status !== 'confirmed')
    && !isAdminViewer,
  );

  return NextResponse.json({
    status: row?.status || 'outstanding',
    isIndependent: row?.isIndependent ?? null,
    confirmedAt: row?.confirmedAt,
    answers: row?.answers ?? null,
    required,
    started,
    questions,
    isAdminViewer,
    isTeamMember: Boolean(teamMembership),
  });
}

export async function POST(req: NextRequest, ctx: RouteCtx) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { engagementId } = await ctx.params;
  const userId = session.user.id;
  const firmId = session.user.firmId;

  const engagement = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    include: {
      client: { select: { clientName: true } },
      period: { select: { startDate: true, endDate: true } },
      teamMembers: {
        where: { role: { in: ['RI', 'Partner'] } },
        include: { user: { select: { id: true, name: true, email: true } } },
      },
      specialists: {
        where: { specialistType: { in: ['EthicsPartner', 'Ethics'] } },
      },
    },
  });
  if (!engagement || engagement.firmId !== firmId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const submittedAnswers: IndependenceAnswer[] = Array.isArray(body.answers) ? body.answers : [];
  const overallDeclined: boolean = body.isIndependent === false;
  const notes: string = typeof body.notes === 'string' ? body.notes : '';

  // Evaluate — any hardFail question answered No, or the explicit overall
  // decline flag, flips us into `declined`.
  const questions = await getFirmIndependenceQuestions(firmId);
  const byId: Record<string, IndependenceQuestion> = Object.fromEntries(questions.map(q => [q.id, q]));
  const flaggedQuestions: Array<{ text: string; notes?: string }> = [];
  let hardFail = false;
  for (const a of submittedAnswers) {
    const q = byId[a.questionId];
    if (!q) continue;
    if (q.answerType !== 'text' && a.answer === false) {
      // "No" to a yes/no question — note the question text for the email.
      if (q.hardFail) { hardFail = true; flaggedQuestions.push({ text: q.text, notes: a.notes }); }
    }
  }
  const isIndependent = !overallDeclined && !hardFail;
  const status: 'confirmed' | 'declined' = isIndependent ? 'confirmed' : 'declined';

  const upserted = await prisma.auditMemberIndependence.upsert({
    where: { engagementId_userId: { engagementId, userId } },
    create: {
      engagementId,
      userId,
      status,
      isIndependent,
      answers: submittedAnswers as any,
      notes: notes || null,
      confirmedAt: new Date(),
    },
    update: {
      status,
      isIndependent,
      answers: submittedAnswers as any,
      notes: notes || null,
      confirmedAt: new Date(),
    },
  });

  // Decline path — email RI and Ethics Partner.
  let emailsSent = 0;
  if (!isIndependent) {
    const recipients: Array<{ email: string; name: string }> = [];
    for (const tm of engagement.teamMembers) {
      if (tm.user?.email && tm.userId !== userId) {
        recipients.push({ email: tm.user.email, name: tm.user.name || tm.user.email });
      }
    }
    for (const sp of engagement.specialists) {
      if (sp.email) recipients.push({ email: sp.email, name: sp.name || sp.email });
    }
    if (recipients.length > 0) {
      const submitter = await prisma.user.findUnique({
        where: { id: userId },
        select: { name: true, email: true },
      });
      const periodLabel = `${engagement.period.startDate.toLocaleDateString('en-GB')} – ${engagement.period.endDate.toLocaleDateString('en-GB')}`;
      const baseUrl = process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || '';
      const engagementUrl = baseUrl ? `${baseUrl}/tools/methodology/StatAudit?engagement=${engagementId}` : `/tools/methodology/StatAudit?engagement=${engagementId}`;

      try {
        await sendIndependenceDeclinedEmail(
          recipients,
          { name: submitter?.name || 'Team member', email: submitter?.email || '' },
          engagement.client.clientName,
          periodLabel,
          engagement.auditType,
          overallDeclined && flaggedQuestions.length === 0
            ? [{ text: 'Overall: declared not independent (no specific questions flagged).', notes }]
            : flaggedQuestions,
          engagementUrl,
        );
        emailsSent = recipients.length;
        await prisma.auditMemberIndependence.update({
          where: { id: upserted.id },
          data: { notifiedAt: new Date() },
        });
      } catch (err) {
        console.error('[independence] decline email failed:', err);
      }
    }
  }

  return NextResponse.json({
    ok: true,
    status: upserted.status,
    isIndependent: upserted.isIndependent,
    confirmedAt: upserted.confirmedAt,
    emailsSent,
  });
}
