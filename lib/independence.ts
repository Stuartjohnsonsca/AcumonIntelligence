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
  await prisma.auditMemberIndependence.upsert({
    where: { engagementId_userId: { engagementId, userId } },
    create: { engagementId, userId, status: 'outstanding' },
    update: {}, // don't clobber confirmed / declined rows if they already exist
  });
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

/** Fetch the firm's question set, returning an empty list if none is configured. */
export async function getFirmIndependenceQuestions(firmId: string): Promise<IndependenceQuestion[]> {
  const row = await prisma.methodologyTemplate.findUnique({
    where: {
      firmId_templateType_auditType: {
        firmId,
        templateType: 'independence_questions',
        auditType: 'ALL',
      },
    },
  }).catch(() => null);
  if (!row) return [];
  const items = row.items as unknown;
  return Array.isArray(items) ? (items as IndependenceQuestion[]) : [];
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
