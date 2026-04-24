import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

/**
 * GET /api/engagements/:engagementId/questionnaires
 *
 * Returns every questionnaire's answers for an engagement, pre-enriched
 * so each answer is reachable by its human-readable question key. Output
 * shape mirrors the template renderer's `questionnaires` branch:
 *
 *   {
 *     questionnaires: {
 *       ethics:         { <key>: value, ... , _byId: { <uuid>: value } },
 *       continuance:    { ... },
 *       permanentFile:  { ... },
 *       materiality:    { ... },
 *       newClientTakeOn:{ ... },
 *       subsequentEvents:{ ... },
 *     },
 *     // Alphabetic appendix aliases pointing at the same objects, so
 *     // admins can cross-ref as either `ethics.foo` or `appendix_b.foo`.
 *     aliases: {
 *       appendix_a: 'permanentFile',
 *       appendix_b: 'ethics',
 *       appendix_c: 'continuance',
 *       appendix_e: 'materiality',
 *     },
 *   }
 *
 * Used by DynamicAppendixForm to resolve per-question `crossRef` paths
 * at render time without pushing this logic down into the context builder
 * (which is server-only).
 */

type Ctx = { params: Promise<{ engagementId: string }> };

/** Canonical schedule key (context key) ← templateType (methodology row). */
const QUESTIONNAIRE_TYPES: Array<{ ctxKey: string; templateType: string; prismaModel: string }> = [
  { ctxKey: 'ethics',            templateType: 'ethics_questions',            prismaModel: 'auditEthics' },
  { ctxKey: 'continuance',       templateType: 'continuance_questions',       prismaModel: 'auditContinuance' },
  { ctxKey: 'permanentFile',     templateType: 'permanent_file_questions',    prismaModel: 'auditPermanentFile' },
  { ctxKey: 'materiality',       templateType: 'materiality_questions',       prismaModel: 'auditMateriality' },
  { ctxKey: 'newClientTakeOn',   templateType: 'new_client_takeon_questions', prismaModel: 'auditNewClientTakeOn' },
  { ctxKey: 'subsequentEvents',  templateType: 'subsequent_events_questions', prismaModel: 'auditSubsequentEvents' },
];

/** Letter-based aliases — align with the Templates.xlsx layout the firm uses. */
const APPENDIX_ALIASES: Record<string, string> = {
  appendix_a: 'permanentFile',
  appendix_b: 'ethics',
  appendix_c: 'continuance',
  appendix_e: 'materiality',
};

/**
 * Normalise a string (description / role / etc.) into a safe formula
 * identifier. Lower-case, non-alphanumerics → underscore, collapsed
 * runs, no leading/trailing underscores. Used for agreed-date keys
 * ("Hard close" → `hard_close`) and team-role keys.
 */
function slugify(s: string): string {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Build the synthetic `engagement` bucket — Opening-tab data exposed
 * as a cross-ref source so schedule formulas can pull it with
 * `{engagement.period_end}`, `{engagement.hard_close}`,
 * `{engagement.partner_name}`, etc. ISO dates are surfaced as both
 * the raw ISO string AND a `yyyy-MM-dd` short-form for easy
 * arithmetic; Date objects don't survive JSON so the formula
 * engine's string path handles everything.
 */
async function buildEngagementBucket(engagementId: string): Promise<Record<string, any>> {
  const out: Record<string, any> = {};
  try {
    const eng = await prisma.auditEngagement.findUnique({
      where: { id: engagementId },
      select: {
        id: true,
        auditType: true,
        status: true,
        isGroupAudit: true,
        isNewClient: true,
        infoRequestType: true,
        hardCloseDate: true,
        startedAt: true,
        completedAt: true,
        createdAt: true,
        client: { select: { clientName: true, sector: true, isPIE: true, isListed: true } },
        period: { select: { startDate: true, endDate: true } },
        firm: { select: { name: true } },
        agreedDates: { select: { description: true, targetDate: true, progress: true } },
        teamMembers: {
          select: {
            role: true,
            user: { select: { name: true, email: true, jobTitle: true } },
          },
        },
        specialists: { select: { name: true, email: true, specialistType: true, firmName: true } },
      },
    });
    if (!eng) return out;

    // Top-level scalars.
    out.audit_type           = eng.auditType;
    out.status               = eng.status;
    out.is_group_audit       = !!eng.isGroupAudit;
    out.is_new_client        = eng.isNewClient;
    out.info_request_type    = eng.infoRequestType;
    out.hard_close_date      = eng.hardCloseDate ? eng.hardCloseDate.toISOString() : null;
    out.started_at           = eng.startedAt     ? eng.startedAt.toISOString()     : null;
    out.completed_at         = eng.completedAt   ? eng.completedAt.toISOString()   : null;

    // Client.
    out.client_name          = eng.client?.clientName ?? null;
    out.client_sector        = eng.client?.sector ?? null;
    out.client_is_pie        = !!eng.client?.isPIE;
    out.client_is_listed     = !!eng.client?.isListed;

    // Period.
    out.period_start         = eng.period?.startDate ? eng.period.startDate.toISOString() : null;
    out.period_end           = eng.period?.endDate   ? eng.period.endDate.toISOString()   : null;
    out.period_start_date    = eng.period?.startDate ? eng.period.startDate.toISOString().slice(0, 10) : null;
    out.period_end_date      = eng.period?.endDate   ? eng.period.endDate.toISOString().slice(0, 10)   : null;

    // Firm.
    out.firm_name            = eng.firm?.name ?? null;

    // Planned timetable — every agreed date is keyed by its
    // slugified description, e.g. `hard_close`, `draft_report_issued`.
    // Admins writing formulas can reference `{engagement.hard_close}`
    // (returns ISO string) or `{engagement.hard_close_date}` (the
    // short-form yyyy-MM-dd for display). Progress is also surfaced
    // so a formula can gate on "Complete".
    for (const d of eng.agreedDates || []) {
      const key = slugify(d.description);
      if (!key) continue;
      const iso = d.targetDate ? d.targetDate.toISOString() : null;
      out[`agreed_${key}`]       = iso;
      out[`agreed_${key}_date`]  = iso ? iso.slice(0, 10) : null;
      out[`agreed_${key}_progress`] = d.progress || null;
      // Also surface without the `agreed_` prefix so templates can
      // read `{engagement.hard_close}` rather than the more verbose
      // `{engagement.agreed_hard_close}`.
      out[key] = iso;
      out[`${key}_progress`] = d.progress || null;
    }

    // Team — first user per role (Junior / Manager / RI / etc.)
    // exposed as `team_<role_slug>_name` / `_email` / `_title`.
    for (const m of eng.teamMembers || []) {
      if (!m.role) continue;
      const key = slugify(m.role);
      if (!key) continue;
      if (!out[`team_${key}_name`]) {
        out[`team_${key}_name`]  = m.user?.name  ?? null;
        out[`team_${key}_email`] = m.user?.email ?? null;
        out[`team_${key}_title`] = m.user?.jobTitle ?? null;
      }
    }

    // Specialists — one entry per specialistType.
    for (const s of eng.specialists || []) {
      if (!s.specialistType) continue;
      const key = slugify(s.specialistType);
      if (!key) continue;
      if (!out[`specialist_${key}_name`]) {
        out[`specialist_${key}_name`]     = s.name ?? null;
        out[`specialist_${key}_email`]    = s.email ?? null;
        out[`specialist_${key}_firm`]     = s.firmName ?? null;
      }
    }
  } catch (err) {
    console.error('[questionnaires] buildEngagementBucket failed:', (err as any)?.message || err);
  }
  return out;
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await ctx.params;

  // Tenancy: engagement must belong to the user's firm (or super-admin).
  const engagement = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    select: { firmId: true },
  });
  if (!engagement) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (engagement.firmId !== session.user.firmId && !session.user.isSuperAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Load all firm schemas once. Tolerant: tables/schemas missing → empty data.
  const schemas = await prisma.methodologyTemplate.findMany({
    where: {
      firmId: engagement.firmId,
      templateType: { in: QUESTIONNAIRE_TYPES.map(q => q.templateType) },
    },
  });
  const schemaByType = new Map<string, any[]>();
  for (const s of schemas) {
    schemaByType.set(s.templateType, Array.isArray(s.items) ? (s.items as any[]) : []);
  }

  const questionnaires: Record<string, Record<string, any>> = {};
  await Promise.all(QUESTIONNAIRE_TYPES.map(async (qt) => {
    // Load raw { <uuid>: value } answers.
    let rawData: Record<string, any> = {};
    try {
      const model = (prisma as any)[qt.prismaModel];
      if (model?.findUnique) {
        const row = await model.findUnique({ where: { engagementId } });
        if (row?.data && typeof row.data === 'object') rawData = row.data as Record<string, any>;
      }
    } catch { /* tolerant */ }

    // Enrich with human-readable keys.
    const schema = schemaByType.get(qt.templateType) || [];
    const enriched: Record<string, any> = {};
    const byId: Record<string, any> = { ...rawData };
    for (const item of schema) {
      if (!item?.id) continue;
      const value = rawData[item.id];
      if (value === undefined) continue;
      const key = typeof item.key === 'string' && item.key.trim() ? item.key.trim() : null;
      if (key) enriched[key] = value;
    }
    enriched._byId = byId;
    questionnaires[qt.ctxKey] = enriched;
  }));

  // Synthetic "engagement" bucket — Opening-tab data surfaced as a
  // cross-ref source. Lets schedule formulas reach outside their
  // own appendix with `{engagement.period_end}`, `{engagement.hard_close}`,
  // `{engagement.team_ri_name}`, etc.
  questionnaires.engagement = await buildEngagementBucket(engagementId);

  return NextResponse.json({
    questionnaires,
    aliases: APPENDIX_ALIASES,
  });
}
