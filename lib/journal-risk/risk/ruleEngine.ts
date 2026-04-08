import type {
  RiskRule,
  RiskDriver,
  JournalRecord,
  EvaluationContext,
} from '../types';
import {
  isPostClose,
  isPeriodEndWindow,
  isOutsideBusinessHours,
  isRoundNumber,
  isEmptyOrLowInfo,
  containsSuspiciousKeywords,
  isSameAsApprover,
  isAtypicalPoster,
  isSeldomUsedAccount,
  isUnusualAccountPair,
} from '../features/derived';

// ─── Helpers ───────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return iso.slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  const msPerDay = 86_400_000;
  const da = new Date(a.slice(0, 10));
  const db = new Date(b.slice(0, 10));
  return Math.round((da.getTime() - db.getTime()) / msPerDay);
}

// ─── Single rule evaluation ────────────────────────────────────────────────

export function evaluateRule(
  rule: RiskRule,
  journal: JournalRecord,
  ctx: EvaluationContext,
): { hit: boolean; tags: string[]; driver: RiskDriver | null } {
  const noHit = { hit: false, tags: [], driver: null };
  const fn = rule.condition.derivedFn;
  if (!fn) return noHit;

  let hit = false;
  let explanation = '';

  switch (fn) {
    // ── Timing ─────────────────────────────────────────────────────────────
    case 'isPostClose': {
      hit = isPostClose(journal.postedAt, ctx.config.periodEndDate);
      if (hit) {
        const days = daysBetween(journal.postedAt, ctx.config.periodEndDate);
        explanation = `Posted on ${formatDate(journal.postedAt)}, ${days} day${days !== 1 ? 's' : ''} after period end (${formatDate(ctx.config.periodEndDate)}).`;
      }
      break;
    }
    case 'isPeriodEndWindow': {
      hit = isPeriodEndWindow(
        journal.postedAt,
        ctx.config.periodEndDate,
        ctx.config.periodEndWindowDays,
      );
      if (hit) {
        explanation = `Posted on ${formatDate(journal.postedAt)}, within ${ctx.config.periodEndWindowDays}-day window before period end (${formatDate(ctx.config.periodEndDate)}).`;
      }
      break;
    }
    case 'isOutsideBusinessHours': {
      hit = isOutsideBusinessHours(
        journal.postedAt,
        ctx.config.timezone,
        ctx.config.businessHours,
      );
      if (hit) {
        const time = journal.postedAt.slice(11, 16);
        explanation = `Posted at ${time} UTC, outside business hours (${ctx.config.businessHours.start}–${ctx.config.businessHours.end}).`;
      }
      break;
    }

    // ── User / Access ──────────────────────────────────────────────────────
    case 'isSeniorPoster': {
      const user = ctx.users.get(journal.preparedByUserId);
      if (user) {
        const isSenior =
          user.isSeniorMgmt === true ||
          ctx.config.seniorRoles.some(
            (r) => user.roleTitle.toLowerCase().includes(r.toLowerCase()),
          );
        hit = isSenior;
        if (hit) {
          explanation = `Prepared by ${user.displayName} (${user.roleTitle}).`;
        }
      }
      break;
    }
    case 'isAtypicalPoster': {
      hit = isAtypicalPoster(journal.preparedByUserId, ctx.userPostingPercentiles);
      if (hit) {
        const user = ctx.users.get(journal.preparedByUserId);
        const pct = ctx.userPostingPercentiles.get(journal.preparedByUserId);
        const name = user ? user.displayName : journal.preparedByUserId;
        explanation = pct !== undefined
          ? `${name} is at the ${pct}th percentile of posting frequency (atypical poster).`
          : `${name} has no posting history (unknown user treated as atypical).`;
      }
      break;
    }
    case 'isSameAsApprover': {
      hit = isSameAsApprover(journal.preparedByUserId, journal.approvedByUserId);
      if (hit) {
        const user = ctx.users.get(journal.preparedByUserId);
        const name = user ? user.displayName : journal.preparedByUserId;
        explanation = `Prepared and approved by the same person: ${name}.`;
      }
      break;
    }

    // ── Content ────────────────────────────────────────────────────────────
    case 'isSeldomUsedAccount': {
      const debitHit = isSeldomUsedAccount(journal.debitAccountId, ctx.accountFrequency);
      const creditHit = isSeldomUsedAccount(journal.creditAccountId, ctx.accountFrequency);
      hit = debitHit || creditHit;
      if (hit) {
        const parts: string[] = [];
        if (debitHit) {
          const acc = ctx.accounts.get(journal.debitAccountId);
          const count = ctx.accountFrequency.get(journal.debitAccountId);
          const name = acc ? `${journal.debitAccountId} (${acc.accountName})` : journal.debitAccountId;
          parts.push(`Account ${name} used only ${count ?? 0} time${(count ?? 0) !== 1 ? 's' : ''} in population`);
        }
        if (creditHit) {
          const acc = ctx.accounts.get(journal.creditAccountId);
          const count = ctx.accountFrequency.get(journal.creditAccountId);
          const name = acc ? `${journal.creditAccountId} (${acc.accountName})` : journal.creditAccountId;
          parts.push(`Account ${name} used only ${count ?? 0} time${(count ?? 0) !== 1 ? 's' : ''} in population`);
        }
        explanation = parts.join('; ') + '.';
      }
      break;
    }
    case 'isUnusualAccountPair': {
      hit = isUnusualAccountPair(
        journal.debitAccountId,
        journal.creditAccountId,
        ctx.pairFrequency,
      );
      if (hit) {
        const debitAcc = ctx.accounts.get(journal.debitAccountId);
        const creditAcc = ctx.accounts.get(journal.creditAccountId);
        const debitLabel = debitAcc ? `${journal.debitAccountId} (${debitAcc.accountName})` : journal.debitAccountId;
        const creditLabel = creditAcc ? `${journal.creditAccountId} (${creditAcc.accountName})` : journal.creditAccountId;
        const key = `${journal.debitAccountId}|${journal.creditAccountId}`;
        const count = ctx.pairFrequency.get(key) ?? 0;
        explanation = `Account pair ${debitLabel} / ${creditLabel} seen only ${count} time${count !== 1 ? 's' : ''} in population.`;
      }
      break;
    }
    case 'isRoundNumber': {
      hit = isRoundNumber(journal.amount);
      if (hit) {
        explanation = `Amount ${journal.amount.toLocaleString()} is a round number.`;
      }
      break;
    }

    // ── Description ────────────────────────────────────────────────────────
    case 'isEmptyOrLowInfo': {
      hit = isEmptyOrLowInfo(journal.description);
      if (hit) {
        explanation = journal.description
          ? `Description "${journal.description}" is weak or low-information.`
          : 'Journal has no description.';
      }
      break;
    }
    case 'containsSuspiciousKeywords': {
      const result = containsSuspiciousKeywords(
        journal.description,
        ctx.config.suspiciousKeywords,
      );
      hit = result.found;
      if (hit) {
        explanation = `Contains suspicious keyword${result.matchedKeywords.length > 1 ? 's' : ''} '${result.matchedKeywords.join("', '")}'.`;
      }
      break;
    }

    // ── Accounting Risk ────────────────────────────────────────────────────
    case 'isJudgmentalAccount': {
      const debitAcc = ctx.accounts.get(journal.debitAccountId);
      const creditAcc = ctx.accounts.get(journal.creditAccountId);
      const debitJudgmental = debitAcc?.isJudgmental === true;
      const creditJudgmental = creditAcc?.isJudgmental === true;
      hit = debitJudgmental || creditJudgmental;
      if (hit) {
        const parts: string[] = [];
        if (debitJudgmental && debitAcc) {
          parts.push(`${journal.debitAccountId} (${debitAcc.accountName})`);
        }
        if (creditJudgmental && creditAcc) {
          parts.push(`${journal.creditAccountId} (${creditAcc.accountName})`);
        }
        explanation = `Posts to judgmental/estimate account${parts.length > 1 ? 's' : ''}: ${parts.join(', ')}.`;
      }
      break;
    }

    // ── Behaviour ──────────────────────────────────────────────────────────
    case 'isQuickReversal': {
      hit = journal.reversalJournalId !== null && journal.reversalJournalId !== '';
      if (hit) {
        explanation = `Journal is linked to reversal ${journal.reversalJournalId}.`;
      }
      break;
    }

    default:
      return noHit;
  }

  if (!hit) return noHit;

  const weightApplied = ctx.config.weights[rule.ruleId] ?? rule.weight;

  return {
    hit: true,
    tags: [...rule.tags],
    driver: {
      ruleId: rule.ruleId,
      ruleName: rule.name,
      severity: rule.severity,
      weightApplied,
      explanation,
    },
  };
}

// ─── Evaluate all rules against a single journal ───────────────────────────

export function evaluateAllRules(
  rules: RiskRule[],
  journal: JournalRecord,
  ctx: EvaluationContext,
): { drivers: RiskDriver[]; tags: string[] } {
  const drivers: RiskDriver[] = [];
  const tagSet = new Set<string>();

  for (const rule of rules) {
    const result = evaluateRule(rule, journal, ctx);
    if (result.hit && result.driver) {
      drivers.push(result.driver);
      for (const tag of result.tags) {
        tagSet.add(tag);
      }
    }
  }

  return { drivers, tags: Array.from(tagSet) };
}
