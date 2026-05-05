/**
 * Per-team-member Independence sign-off gate.
 *
 * Rules:
 *   - When an engagement's audit starts (status flips to `active` or
 *     `startedAt` is set), every team member gets an `outstanding` row.
 *   - When a new team member is added to an engagement that has already
 *     started, they get an `outstanding` row immediately.
 *   - While the row is `outstanding`, that user cannot view or do anything
 *     on that engagement — the client-side gate blocks render.
 *   - When the user submits the questions:
 *       - isIndependent = true  → row moves to `confirmed` and the gate clears.
 *       - isIndependent = false → row moves to `declined`; the RI and Ethics
 *         Partner are emailed; the gate stays up (user locked out).
 *
 * Firm-wide question list is a `MethodologyTemplate` row with
 *   templateType = 'independence_questions', auditType = 'ALL'
 *   items       = IndependenceQuestion[]
 *
 * This module just holds the types + a small ensure-outstanding helper.
 * HTTP routes live under `/api/engagements/[id]/independence/*` and
 * `/api/methodology-admin/independence-questions/*`.
 */

import { prisma } from '@/lib/db';

export interface IndependenceQuestion {
  /** Stable id so the admin can edit / delete. */
  id: string;
  /** Question text shown to the user. */
  text: string;
  /** Optional helper text — e.g. examples, guidance on what to include. */
  helpText?: string;
  /** 'boolean' (default) = Yes/No; 'text' = free-text response only. */
  answerType?: 'boolean' | 'text';
  /** When true, user must provide supporting notes if they answer No. */
  requiresNotesOnNo?: boolean;
  /** When true, answering No for this question automatically marks the
   *  user as NOT independent (the decline email fires). */
  hardFail?: boolean;
}

export interface IndependenceAnswer {
  questionId: string;
  questionText: string;
  answer: boolean | string;
  notes?: string;
}

export type IndependenceStatus = 'outstanding' | 'confirmed' | 'declined';

/**
 * Ensure an independence row exists for a given (engagement, user) pair.
 * Called on audit start for every team member, and again when a team
 * member is added to an engagement that has already started. Safe to
 * call repeatedly — uniqueness constraint means the second call is a
 * no-op.
 */
export async function ensureIndependenceRow(engagementId: string, userId: string): Promise<void> {
  try {
    await prisma.auditMemberIndependence.upsert({
      where: { engagementId_userId: { engagementId, userId } },
      create: { engagementId, userId, status: 'outstanding' },
      update: {}, // don't clobber confirmed / declined rows if they already exist
    });
  } catch (err: any) {
    // Fail quietly when the table hasn't been migrated yet — the admin just
    // needs to run scripts/sql/independence-gate.sql in Supabase. Logged so
    // it's visible but non-blocking for the caller (Start Audit / add team).
    const msg = err?.message || String(err);
    if (/audit_member_independence/.test(msg) && /does not exist/i.test(msg)) {
      console.warn('[independence] ensureIndependenceRow: table missing — run scripts/sql/independence-gate.sql on Supabase.');
      return;
    }
    throw err;
  }
}

/**
 * Seed outstanding rows for every current team member of an engagement.
 * Called from the "Start Audit" handler on the one-shot transition from
 * pre_start → active.
 */
export async function seedIndependenceForEngagement(engagementId: string): Promise<number> {
  const members = await prisma.auditTeamMember.findMany({
    where: { engagementId },
    select: { userId: true },
  });
  if (members.length === 0) return 0;
  let count = 0;
  for (const m of members) {
    await ensureIndependenceRow(engagementId, m.userId);
    count++;
  }
  return count;
}

/**
 * "Has the audit started?" — centralised so the triggers use the same rule
 * the gate uses. An engagement has started when its status has moved past
 * `pre_start` OR `startedAt` is populated. Both are checked because either
 * can be the trigger depending on the flow.
 */
export function hasAuditStarted(engagement: { status?: string | null; startedAt?: Date | null }): boolean {
  if (engagement.startedAt) return true;
  if (engagement.status && engagement.status !== 'pre_start') return true;
  return false;
}

/**
 * Fetch the firm's question set.
 *
 *   1. Prefer the auditType='ALL' row written by the methodology
 *      admin UI.
 *   2. If that row is missing or empty, accept ANY non-empty
 *      independence_questions row for the firm — defends against
 *      cases where the row was saved under a specific auditType
 *      (e.g. 'PIE') by an earlier migration or by hand.
 *   3. If still nothing, fall back to the built-in defaults so the
 *      gate never tells the auditor "no questions configured" while
 *      the firm waits on Methodology Admin to seed the row. The
 *      admin UI itself seeds defaults on first open, so the only
 *      time this fallback hits at runtime is for a firm that
 *      hasn't visited the admin page yet.
 */
export async function getFirmIndependenceQuestions(firmId: string): Promise<IndependenceQuestion[]> {
  // Step 1 — preferred row.
  const allRow = await prisma.methodologyTemplate.findUnique({
    where: {
      firmId_templateType_auditType: {
        firmId,
        templateType: 'independence_questions',
        auditType: 'ALL',
      },
    },
  }).catch(() => null);
  const allItems = Array.isArray(allRow?.items) ? (allRow!.items as unknown as IndependenceQuestion[]) : [];
  if (allItems.length > 0) return allItems;

  // Step 2 — any other audit-type row for this firm. Picks the most
  // recently updated row that has questions.
  const anyRows = await prisma.methodologyTemplate.findMany({
    where: { firmId, templateType: 'independence_questions' },
    orderBy: { updatedAt: 'desc' },
  }).catch(() => [] as Array<{ items: unknown }>);
  for (const r of anyRows) {
    const items = Array.isArray(r.items) ? (r.items as unknown as IndependenceQuestion[]) : [];
    if (items.length > 0) return items;
  }

  // Step 3 — built-in defaults. Same set the admin UI seeds on first
  // visit, so the runtime fallback matches what the admin would see.
  return defaultIndependenceQuestions();
}

// ─── Refresh cadence (re-confirm after N days) ─────────────────────────────

/**
 * One rule per audit type (or 'ALL' for the default that applies to every
 * audit type not overridden below). Stored as a firm-wide
 * `MethodologyTemplate` row with templateType='independence_refresh_days'
 * and items = IndependenceRefreshDaysRule[].
 */
export interface IndependenceRefreshDaysRule {
  auditType: string; // 'ALL' | 'SME' | 'PIE' | 'SME_CONTROLS' | 'PIE_CONTROLS' | 'GROUP'
  days: number;
}

const REFRESH_TEMPLATE_KEY = { templateType: 'independence_refresh_days', auditType: 'ALL' as const };

export function defaultIndependenceRefreshRules(): IndependenceRefreshDaysRule[] {
  // Default: re-confirm every 30 days for all audit types.
  return [{ auditType: 'ALL', days: 30 }];
}

export async function getFirmIndependenceRefreshRules(firmId: string): Promise<IndependenceRefreshDaysRule[]> {
  try {
    const row = await prisma.methodologyTemplate.findUnique({
      where: { firmId_templateType_auditType: { firmId, ...REFRESH_TEMPLATE_KEY } },
    });
    if (!row) return defaultIndependenceRefreshRules();
    const items = row.items as unknown;
    if (!Array.isArray(items)) return defaultIndependenceRefreshRules();
    const rules = items as IndependenceRefreshDaysRule[];
    // Guarantee the ALL default is present — the admin UI enforces this but
    // defend against hand-edited data.
    if (!rules.some(r => r.auditType === 'ALL')) {
      return [{ auditType: 'ALL', days: 30 }, ...rules];
    }
    return rules;
  } catch {
    return defaultIndependenceRefreshRules();
  }
}

/**
 * Given the firm's rule list and the engagement's audit type, return the
 * applicable "days between re-confirmations" value. Exact-match override
 * wins over the ALL default. Returns null (no refresh required) only if
 * no rule matches at all.
 */
export function resolveRefreshDays(rules: IndependenceRefreshDaysRule[], auditType: string): number | null {
  const override = rules.find(r => r.auditType === auditType);
  if (override && Number.isFinite(override.days) && override.days > 0) return override.days;
  const fallback = rules.find(r => r.auditType === 'ALL');
  if (fallback && Number.isFinite(fallback.days) && fallback.days > 0) return fallback.days;
  return null;
}

/**
 * Is the previous confirmation stale enough that we need to re-ask?
 * Returns true when confirmedAt is more than `days` ago.
 */
export function isConfirmationStale(confirmedAt: Date | null | undefined, days: number | null): boolean {
  if (!confirmedAt || !days || days <= 0) return false;
  const ageMs = Date.now() - new Date(confirmedAt).getTime();
  const ageDays = ageMs / 86_400_000;
  return ageDays > days;
}

/** A reasonable default set of questions seeded the first time the admin opens the section. */
export function defaultIndependenceQuestions(): IndependenceQuestion[] {
  return [
    { id: 'indep_financial_interest', text: 'Do you, or any immediate family member, have a financial interest (shares, loans, investments) in the client or any of its group entities?', answerType: 'boolean', requiresNotesOnNo: false, hardFail: true, helpText: 'Includes direct and indirect holdings — e.g. unit trusts and pension funds managed by a third party are generally excluded, but check before answering Yes.' },
    { id: 'indep_family_role', text: 'Does any close family member hold a role at the client that could influence the financial statements (e.g. director, senior finance role, significant shareholder)?', answerType: 'boolean', requiresNotesOnNo: false, hardFail: true },
    { id: 'indep_prior_employment', text: 'Have you been employed by the client, or in a significant service role, in the last two years?', answerType: 'boolean', requiresNotesOnNo: false, hardFail: true },
    { id: 'indep_non_audit_services', text: 'Are you aware of any non-audit services provided by the firm to this client that could impair your independence?', answerType: 'boolean', requiresNotesOnNo: true, hardFail: false },
    { id: 'indep_gifts_hospitality', text: 'Have you accepted gifts or hospitality from the client in the last 12 months beyond modest trivial amounts?', answerType: 'boolean', requiresNotesOnNo: true, hardFail: false },
    { id: 'indep_relationships', text: 'Are there any close personal, business, or litigation relationships with the client that might reasonably be perceived as impairing your independence?', answerType: 'boolean', requiresNotesOnNo: true, hardFail: false },
    { id: 'indep_conflict_other', text: 'Are you aware of any other matter (not covered above) that could compromise your independence on this engagement?', answerType: 'boolean', requiresNotesOnNo: true, hardFail: false },
  ];
}
