import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { logEngagementAction } from '@/lib/engagement-action-log';

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
 * Maps a scheduleKey (= the sign-off endpoint / tab key) to the
 * methodology-template type that defines its question list AND the
 * Prisma model that stores the answers. Every schedule the specialist
 * can be asked to review must have an entry here so we never fall back
 * to "preview not available" — specialists always see what they're
 * reviewing before they decide. Two shapes are supported:
 *
 *   kind: 'single'   — one row keyed by engagementId with a `data`
 *                      JSON blob containing all answers. Matches the
 *                      majority of the "*_questions" schedules.
 *
 *   kind: 'sectioned' — many rows keyed by (engagementId, sectionKey),
 *                       each row's `data` is a flat map merged into a
 *                       single answers object. Used by permanent-file
 *                       where content is naturally grouped into named
 *                       sections (entity_details / fraud_risk / …).
 *
 * Adding a new schedule: add it here, no frontend changes needed. The
 * UI renders whatever questions + values come back.
 */
type ScheduleSource =
  | { kind: 'single'; templateType: string; prismaModel: string }
  | { kind: 'sectioned'; templateType: string; prismaModel: string };

const SCHEDULE_SOURCES: Record<string, ScheduleSource> = {
  'permanent-file': {
    kind: 'sectioned',
    templateType: 'permanent_file_questions',
    prismaModel: 'auditPermanentFile',
  },
  'ethics': {
    kind: 'single',
    templateType: 'ethics_questions',
    prismaModel: 'auditEthics',
  },
  'continuance': {
    kind: 'single',
    templateType: 'continuance_questions',
    prismaModel: 'auditContinuance',
  },
  'new-client-takeon': {
    kind: 'single',
    templateType: 'new_client_takeon_questions',
    prismaModel: 'auditNewClientTakeOn',
  },
  'subsequent-events': {
    kind: 'single',
    templateType: 'subsequent_events_questions',
    prismaModel: 'auditSubsequentEvents',
  },
  'materiality': {
    kind: 'single',
    templateType: 'materiality_questions',
    prismaModel: 'auditMateriality',
  },
  // Non-Q&A schedules (PAR rows, RMM matrix, Trial Balance) fall through
  // to loadRowBasedSnapshot below — they produce a 'rows' content type
  // rather than 'questions'. Still always returns something.
};

/**
 * Unified content shape returned to the specialist-review client.
 * Discriminated by `kind` so the UI can render Q&A vs tabular data
 * differently without resorting to any-types.
 */
type ScheduleContent =
  | { kind: 'questions'; questions: any[]; values: Record<string, any> }
  | { kind: 'rows'; columns: { key: string; label: string }[]; rows: Record<string, any>[] }
  | { kind: 'note'; message: string };

/**
 * Fetch a read-only snapshot of the schedule's content. ALWAYS returns
 * something viewable — either the Q&A for template-backed schedules,
 * the raw rows for tabular schedules, or a short explanatory note
 * when the scheduleKey is genuinely unknown. Never returns null; the
 * specialist must always be able to see what they're reviewing.
 */
async function loadScheduleSnapshot(
  scheduleKey: string,
  engagementId: string,
  firmId: string,
  auditType: string,
): Promise<ScheduleContent> {
  // ── 1. Template-backed Q&A schedules ───────────────────────────────
  const src = SCHEDULE_SOURCES[scheduleKey];
  if (src) {
    // Template questions are firm-wide. Unique constraint is
    // (firmId, templateType, auditType), so both the specific auditType
    // template and the ALL fallback can exist; pick the more-specific.
    const templates = await prisma.methodologyTemplate.findMany({
      where: { firmId, templateType: src.templateType, auditType: { in: [auditType, 'ALL'] } },
    });
    const template = templates.find(t => t.auditType === auditType) ?? templates.find(t => t.auditType === 'ALL');
    const questions = Array.isArray((template?.items as any)) ? (template!.items as any[]) : [];

    // Answers — delegate to the right Prisma model based on kind.
    let values: Record<string, any> = {};
    try {
      const model = (prisma as any)[src.prismaModel];
      if (!model) {
        // Model name mismatch — should never happen given the static
        // map above, but fall through safely rather than crashing.
        return { kind: 'questions', questions, values: {} };
      }
      if (src.kind === 'sectioned') {
        const rows = await model.findMany({ where: { engagementId } });
        for (const r of rows) {
          // Skip bookkeeping sections (sign-offs, field metadata) —
          // those keys are framework-internal, not review content.
          if (typeof r?.sectionKey === 'string' && r.sectionKey.startsWith('__')) continue;
          if (r?.data && typeof r.data === 'object') Object.assign(values, r.data);
        }
      } else {
        // kind: 'single' — one row per engagement.
        const row = await model.findUnique({ where: { engagementId } });
        if (row?.data && typeof row.data === 'object') {
          values = row.data as Record<string, any>;
        }
      }
    } catch (err) {
      console.error(`[schedule-reviews] failed loading answers for ${scheduleKey}:`, err);
    }
    return { kind: 'questions', questions, values };
  }

  // ── 2. Row-based schedules (PAR / RMM / TB) ────────────────────────
  const rowsSnapshot = await loadRowBasedSnapshot(scheduleKey, engagementId);
  if (rowsSnapshot) return rowsSnapshot;

  // ── 3. Last-resort note (never a dead-end) ─────────────────────────
  // If scheduleKey isn't a known Q&A or row-based schedule, we still
  // tell the specialist what kind of thing they're reviewing rather
  // than leaving them guessing. The note explicitly invites them to
  // request the content from the auditor — better UX than silence.
  return {
    kind: 'note',
    message:
      `This schedule (${scheduleKey}) doesn't have a built-in preview yet. ` +
      `The auditor who sent the review link can share the schedule content with you directly — ` +
      `please reach out before deciding.`,
  };
}

/**
 * Produce a row-based snapshot for schedules whose content is a set
 * of rows rather than Q&A. Returns null when the scheduleKey isn't
 * one of these tabular schedules (the caller then falls through to
 * the explanatory note).
 */
async function loadRowBasedSnapshot(scheduleKey: string, engagementId: string): Promise<ScheduleContent | null> {
  try {
    if (scheduleKey === 'par') {
      // Preliminary Analytical Review — one row per FS line with
      // current / prior figures, variance, and the auditor's reasoning.
      const rows = await prisma.auditPARRow.findMany({
        where: { engagementId },
        orderBy: { sortOrder: 'asc' },
      });
      return {
        kind: 'rows',
        columns: [
          { key: 'particulars', label: 'Particulars' },
          { key: 'currentYear', label: 'Current Year' },
          { key: 'priorYear', label: 'Prior Year' },
          { key: 'absVariance', label: 'Variance' },
          { key: 'absVariancePercent', label: 'Variance %' },
          { key: 'reasons', label: 'Reasons' },
          { key: 'auditorView', label: 'Auditor View' },
        ],
        rows: rows.map(r => ({
          particulars: r.particulars,
          currentYear: r.currentYear,
          priorYear: r.priorYear,
          absVariance: r.absVariance,
          absVariancePercent: r.absVariancePercent,
          reasons: r.reasons,
          auditorView: r.auditorView,
        })),
      };
    }
    if (scheduleKey === 'rmm') {
      // Risk of Material Misstatement — one row per identified risk.
      const rows = await prisma.auditRMMRow.findMany({ where: { engagementId } });
      return {
        kind: 'rows',
        columns: [
          { key: 'lineItem', label: 'Line Item' },
          { key: 'riskIdentified', label: 'Risk' },
          { key: 'inherentRiskLevel', label: 'Inherent Risk' },
          { key: 'controlRisk', label: 'Control Risk' },
          { key: 'finalRiskAssessment', label: 'Final Assessment' },
        ],
        rows: rows.map(r => ({
          lineItem: r.lineItem,
          riskIdentified: r.riskIdentified,
          inherentRiskLevel: r.inherentRiskLevel,
          controlRisk: r.controlRisk,
          finalRiskAssessment: r.finalRiskAssessment,
        })),
      };
    }
    if (scheduleKey === 'trial-balance' || scheduleKey === 'tb') {
      // Trial Balance — account-level figures. Capped at the full set
      // because trial balances can run to thousands of rows; for very
      // large TBs we'd want pagination but that's a follow-up.
      const rows = await prisma.auditTBRow.findMany({
        where: { engagementId },
        orderBy: { accountCode: 'asc' },
      });
      return {
        kind: 'rows',
        columns: [
          { key: 'accountCode', label: 'Code' },
          { key: 'description', label: 'Account' },
          { key: 'currentYear', label: 'Current Year' },
          { key: 'priorYear', label: 'Prior Year' },
          { key: 'fsNoteLevel', label: 'FS Note' },
          { key: 'fsLevel', label: 'FS Level' },
        ],
        rows: rows.map(r => ({
          accountCode: r.accountCode,
          description: r.description,
          currentYear: r.currentYear,
          priorYear: r.priorYear,
          fsNoteLevel: r.fsNoteLevel,
          fsLevel: r.fsLevel,
        })),
      };
    }
  } catch (err) {
    console.error(`[schedule-reviews] row-based snapshot failed for ${scheduleKey}:`, err);
  }
  return null;
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

  // Load the schedule's content. `loadScheduleSnapshot` is designed
  // to ALWAYS return something — Q&A, rows, or an explanatory note —
  // so the specialist can never hit a dead "preview not available"
  // card. Errors still fall through safely (we surface a note rather
  // than 500 the page) because blocking the Accept/Reject buttons on
  // a bad DB read would be worse than showing the review form alone.
  let schedule: ScheduleContent = {
    kind: 'note',
    message: 'Unable to load the schedule right now. The Accept/Reject below still works — please contact the auditor for the content.',
  };
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

  // Audit trail — the specialist's accept/reject is a pivotal decision
  // that lives entirely outside the normal sign-off flow. Record it
  // against the engagement with actorUserId=null (the specialist is
  // external, authenticated only by the magic-link token) and
  // actorName = the specialist's assigneeName so the Outstanding
  // tab's audit panel can show who decided and what they said.
  const commentsSnippet = (comments || '').trim().slice(0, 180);
  await logEngagementAction({
    engagementId: review.engagementId,
    firmId: review.firmId,
    actorUserId: null,
    actorName: review.assigneeName || review.assigneeEmail || 'specialist',
    action: 'specialist.decide',
    summary: `${review.assigneeName || 'Specialist'} ${status === 'accepted' ? 'ACCEPTED' : 'REJECTED'} "${review.scheduleKey}" (${review.role.replace(/_/g, ' ')})${commentsSnippet ? ` — ${commentsSnippet}${(comments || '').length > 180 ? '…' : ''}` : ''}`,
    targetType: 'schedule',
    targetId: review.scheduleKey,
    metadata: { status, role: review.role, scheduleReviewId: review.id, assigneeEmail: review.assigneeEmail },
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
