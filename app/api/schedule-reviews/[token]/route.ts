import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

/**
 * Token-auth'd specialist review endpoints.
 *
 *   GET  /api/schedule-reviews/:token
 *     Returns the review, engagement context, AND a read-only snapshot
 *     of the schedule content the specialist is being asked to review
 *     (when available). Public — the token is the auth.
 *
 *   PUT  /api/schedule-reviews/:token
 *     Submit the specialist's decision + comments.
 *     Body: { status: 'accepted' | 'rejected', comments?: string }
 *     Only works once — subsequent submits are blocked.
 */
type Ctx = { params: Promise<{ token: string }> };

/**
 * Map a scheduleKey to the methodology-template type that defines its
 * question list. Matches the TAB_TEMPLATE_TYPES map in EngagementTabs.
 * Only keys present here can produce a specialist-viewable snapshot.
 * Unknown keys get a null `schedule` field and the UI tells the
 * specialist the preview isn't available for this type (they should
 * ask the auditor for the content).
 */
const SCHEDULE_TO_TEMPLATE_TYPE: Record<string, string> = {
  'permanent-file': 'permanent_file_questions',
  // Future: add ethics, continuance, new-client, materiality, etc.
  // here as the corresponding template types are stabilised. Keep
  // this map narrow on purpose — we should only expose content we're
  // confident renders safely as a read-only list.
};

/**
 * Fetch a read-only snapshot of the schedule's content suitable for
 * display on the specialist-review page. Returns `null` when the
 * scheduleKey isn't supported (the UI then hides the preview).
 *
 * Shape:
 *   {
 *     questions: [{ id, label, section?, inputType, dropdownOptions? }],
 *     values:    { [questionId]: string | number | boolean | null }
 *   }
 *
 * The specialist sees each question with its current value. Blank
 * answers render as "—" so the specialist can spot them.
 */
async function loadScheduleSnapshot(
  scheduleKey: string,
  engagementId: string,
  firmId: string,
  auditType: string,
): Promise<{ questions: any[]; values: Record<string, any> } | null> {
  const templateType = SCHEDULE_TO_TEMPLATE_TYPE[scheduleKey];
  if (!templateType) return null;

  // Template questions are firm-wide. There's a unique constraint on
  // (firmId, templateType, auditType), so we fetch both the specific
  // auditType template and the ALL fallback and pick the more-specific
  // one. The model has no `isActive` column — the template simply
  // exists or doesn't.
  const templates = await prisma.methodologyTemplate.findMany({
    where: {
      firmId,
      templateType,
      auditType: { in: [auditType, 'ALL'] },
    },
  });
  const template = templates.find(t => t.auditType === auditType) ?? templates.find(t => t.auditType === 'ALL');
  const questions = Array.isArray((template?.items as any)) ? (template!.items as any[]) : [];

  // Pull the engagement's answers. Currently only permanent-file is
  // mapped here; if we add more schedules in SCHEDULE_TO_TEMPLATE_TYPE
  // above, this block branches to pick the right Prisma model.
  let values: Record<string, any> = {};
  if (scheduleKey === 'permanent-file') {
    const sections = await prisma.auditPermanentFile.findMany({ where: { engagementId } });
    for (const s of sections) {
      // Skip sign-off / field-meta bookkeeping sections — they're
      // framework metadata, not answers the specialist should see.
      if (s.sectionKey.startsWith('__')) continue;
      if (s.data && typeof s.data === 'object') {
        Object.assign(values, s.data);
      }
    }
  }

  return { questions, values };
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { token } = await ctx.params;
  if (!token) return NextResponse.json({ error: 'Token required' }, { status: 400 });
  const review = await prisma.scheduleSpecialistReview.findUnique({ where: { token } });
  if (!review) return NextResponse.json({ error: 'Review link not found or has been revoked' }, { status: 404 });

  // Load the engagement's client + period so the page can show what
  // the specialist is reviewing. No sensitive fields exposed.
  const engagement = await prisma.auditEngagement.findUnique({
    where: { id: review.engagementId },
    include: {
      client: { select: { clientName: true } },
      period: { select: { startDate: true, endDate: true } },
      firm: { select: { name: true } },
    },
  });

  // Load the schedule's questions + values if we know how to render
  // this type. Errors fall through silently so a transient DB hiccup
  // doesn't block the accept/reject UI — the specialist can still act
  // on the review even without the preview.
  let schedule: { questions: any[]; values: Record<string, any> } | null = null;
  if (engagement) {
    try {
      schedule = await loadScheduleSnapshot(
        review.scheduleKey,
        review.engagementId,
        engagement.firmId,
        engagement.auditType,
      );
    } catch (err) {
      console.error('[schedule-reviews] snapshot load failed:', err);
    }
  }

  return NextResponse.json({
    review: {
      id: review.id,
      scheduleKey: review.scheduleKey,
      role: review.role,
      assigneeName: review.assigneeName,
      assigneeEmail: review.assigneeEmail,
      status: review.status,
      comments: review.comments,
      sentByName: review.sentByName,
      sentAt: review.sentAt.toISOString(),
      decidedAt: review.decidedAt?.toISOString() || null,
    },
    engagement: engagement ? {
      id: engagement.id,
      firmName: engagement.firm.name,
      clientName: engagement.client.clientName,
      periodStart: engagement.period?.startDate?.toISOString() || null,
      periodEnd: engagement.period?.endDate?.toISOString() || null,
    } : null,
    schedule,
  });
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  const { token } = await ctx.params;
  if (!token) return NextResponse.json({ error: 'Token required' }, { status: 400 });
  const body = await req.json().catch(() => null);
  const status = body?.status;
  const comments = typeof body?.comments === 'string' ? body.comments : null;
  if (status !== 'accepted' && status !== 'rejected') {
    return NextResponse.json({ error: "status must be 'accepted' or 'rejected'" }, { status: 400 });
  }

  const review = await prisma.scheduleSpecialistReview.findUnique({ where: { token } });
  if (!review) return NextResponse.json({ error: 'Review link not found' }, { status: 404 });
  if (review.status !== 'pending') {
    return NextResponse.json({
      error: `This review was already ${review.status} on ${review.decidedAt?.toISOString().slice(0, 10) || 'a previous date'}.`,
    }, { status: 409 });
  }

  const updated = await prisma.scheduleSpecialistReview.update({
    where: { id: review.id },
    data: { status, comments: comments || null, decidedAt: new Date() },
  });
  return NextResponse.json({
    ok: true,
    review: {
      id: updated.id,
      status: updated.status,
      comments: updated.comments,
      decidedAt: updated.decidedAt?.toISOString() || null,
    },
  });
}
