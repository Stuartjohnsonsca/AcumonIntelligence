/**
 * Firm-defined validation rules for engagement schedules.
 *
 * Rules are set up in Methodology Admin → Firm-Wide Assumptions →
 * Validation Rules. Each rule targets a single schedule and carries a
 * formula-engine expression that, when it evaluates to a truthy
 * value, is considered a "violation" — the engagement UI renders a
 * banner at the top of the affected schedule explaining the issue
 * and gates Error-severity rules for sign-off.
 *
 * Storage: the rule list for a firm is persisted as a single
 * `methodologyTemplate` row with templateType='validation_rules',
 * auditType='ALL' and the rule array stored in the `items` JSON
 * column. No new Prisma model or migration needed.
 */

import { evaluateFormula, buildFormulaValues } from '@/lib/formula-engine';

export type RuleSeverity = 'warning' | 'error';

export interface ValidationRule {
  /** Stable id so we can edit/delete individual rules. */
  id: string;
  /** Short human label shown as the banner heading. */
  label: string;
  /** Target schedule this rule applies to — matches the schedule key
   *  used throughout the methodology (e.g. `fees`, `materiality`,
   *  `ethics`, or any custom key the firm has added). */
  scheduleKey: string;
  /** Formula-engine expression that should return TRUTHY when the
   *  rule is VIOLATED. Uses the same slug-based identifiers the
   *  formula chips on question editing use (e.g.
   *  `PERCENT(audit_fee, total_fees) < 25`). */
  expression: string;
  /** `warning` → amber banner, non-blocking.
   *  `error`   → red banner, blocks "all required done" green dot. */
  severity: RuleSeverity;
  /** Message shown in the banner body — plain text, supports newlines. */
  message: string;
  /** Disable without deleting — useful for parking rules while the
   *  firm decides whether to keep them. */
  isActive: boolean;
}

/** Evaluation result for a single rule against a single engagement. */
export interface RuleEvaluation {
  rule: ValidationRule;
  /** True when the rule's expression evaluated to a truthy value — i.e.
   *  the rule IS violated and the banner should appear. */
  violated: boolean;
  /** Set when the expression couldn't be evaluated (parse error etc.).
   *  Surfaced as a subtle "rule error" rather than a user-facing
   *  validation banner so the admin knows their expression is broken
   *  without alarming the auditor. */
  error?: string;
}

/** Evaluate one rule against a values map. Wraps evaluateFormula to
 *  coerce the result into a "violated yes/no" boolean regardless of
 *  what the expression returned (numeric zero → not violated; empty
 *  string → not violated; anything else → violated). */
export function evaluateRule(rule: ValidationRule, values: Record<string, string | number | boolean | null>): RuleEvaluation {
  if (!rule.isActive) return { rule, violated: false };
  try {
    const result = evaluateFormula(rule.expression, values);
    const violated = coerceTruthy(result);
    return { rule, violated };
  } catch (err: any) {
    return { rule, violated: false, error: err?.message || 'Expression failed to evaluate' };
  }
}

/** Evaluate every rule that applies to a given schedule. Rules not
 *  matching the schedule key are filtered out. Pass the schedule's
 *  current questions + current answers so the formula engine's slug
 *  aliases resolve (e.g. `audit_fee`). */
export function evaluateRulesForSchedule(
  allRules: ValidationRule[],
  scheduleKey: string,
  questions: Array<{ id: string; questionText?: string | null }>,
  answers: Record<string, string | number | boolean | null>,
  extra?: Record<string, string | number | boolean | null>,
): RuleEvaluation[] {
  const applicable = allRules.filter(r => r.scheduleKey === scheduleKey && r.isActive);
  if (applicable.length === 0) return [];
  // Build the values map the formula engine expects: canonical ids
  // PLUS slug aliases (so admins can write `audit_fee` regardless of
  // whether the underlying question id is a cuid/uuid).
  const valuesWithExtra: Record<string, any> = { ...(extra || {}), ...answers };
  const valuesMap = buildFormulaValues(questions, valuesWithExtra);
  return applicable.map(r => evaluateRule(r, valuesMap));
}

/** What the template-engine considers "truthy" for the purposes of
 *  a validation-rule violation. Mirrors the semantics used elsewhere
 *  (IF, OR, AND) — numeric 0, empty string, false, null → NOT violated;
 *  everything else → violated. */
function coerceTruthy(v: string | number | boolean | null): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0 && Number.isFinite(v);
  if (typeof v === 'string') return v.trim() !== '' && v.trim() !== '0' && v.trim().toLowerCase() !== 'false';
  return Boolean(v);
}

/** Generate a short id for a new rule. Short + URL-safe is all we
 *  need — we don't look these up externally, just within the rule
 *  list for the firm. */
export function newRuleId(): string {
  return 'vr-' + Math.random().toString(36).slice(2, 10);
}

/** Default starter rule. Shown on an empty list so the admin sees a
 *  working example rather than a blank canvas. */
export function starterRule(): ValidationRule {
  return {
    id: newRuleId(),
    label: 'Audit fee floor',
    scheduleKey: 'fees',
    expression: 'PERCENT(audit_fee, total_fees) < 25',
    severity: 'warning',
    message: 'Audit fees are below 25% of total fees — consider whether this reflects an appropriate allocation of effort.',
    isActive: false, // off by default so it doesn't fire on existing engagements
  };
}
