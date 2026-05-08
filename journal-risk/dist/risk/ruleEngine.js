"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateRule = evaluateRule;
exports.evaluateAllRules = evaluateAllRules;
const derived_1 = require("../features/derived");
// ─── Helpers ───────────────────────────────────────────────────────────────
function formatDate(iso) {
    return iso.slice(0, 10);
}
function daysBetween(a, b) {
    const msPerDay = 86_400_000;
    const da = new Date(a.slice(0, 10));
    const db = new Date(b.slice(0, 10));
    return Math.round((da.getTime() - db.getTime()) / msPerDay);
}
// ─── Single rule evaluation ────────────────────────────────────────────────
function evaluateRule(rule, journal, ctx) {
    const noHit = { hit: false, tags: [], driver: null };
    const fn = rule.condition.derivedFn;
    if (!fn)
        return noHit;
    let hit = false;
    let explanation = '';
    switch (fn) {
        // ── Timing ─────────────────────────────────────────────────────────────
        case 'isPostClose': {
            hit = (0, derived_1.isPostClose)(journal.postedAt, ctx.config.periodEndDate);
            if (hit) {
                const days = daysBetween(journal.postedAt, ctx.config.periodEndDate);
                explanation = `Posted on ${formatDate(journal.postedAt)}, ${days} day${days !== 1 ? 's' : ''} after period end (${formatDate(ctx.config.periodEndDate)}).`;
            }
            break;
        }
        case 'isPeriodEndWindow': {
            hit = (0, derived_1.isPeriodEndWindow)(journal.postedAt, ctx.config.periodEndDate, ctx.config.periodEndWindowDays);
            if (hit) {
                explanation = `Posted on ${formatDate(journal.postedAt)}, within ${ctx.config.periodEndWindowDays}-day window before period end (${formatDate(ctx.config.periodEndDate)}).`;
            }
            break;
        }
        case 'isOutsideBusinessHours': {
            hit = (0, derived_1.isOutsideBusinessHours)(journal.postedAt, ctx.config.timezone, ctx.config.businessHours);
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
                const isSenior = user.isSeniorMgmt === true ||
                    ctx.config.seniorRoles.some((r) => user.roleTitle.toLowerCase().includes(r.toLowerCase()));
                hit = isSenior;
                if (hit) {
                    explanation = `Prepared by ${user.displayName} (${user.roleTitle}).`;
                }
            }
            break;
        }
        case 'isAtypicalPoster': {
            hit = (0, derived_1.isAtypicalPoster)(journal.preparedByUserId, ctx.userPostingPercentiles);
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
            hit = (0, derived_1.isSameAsApprover)(journal.preparedByUserId, journal.approvedByUserId);
            if (hit) {
                const user = ctx.users.get(journal.preparedByUserId);
                const name = user ? user.displayName : journal.preparedByUserId;
                explanation = `Prepared and approved by the same person: ${name}.`;
            }
            break;
        }
        // ── Content ────────────────────────────────────────────────────────────
        case 'isSeldomUsedAccount': {
            const debitHit = (0, derived_1.isSeldomUsedAccount)(journal.debitAccountId, ctx.accountFrequency);
            const creditHit = (0, derived_1.isSeldomUsedAccount)(journal.creditAccountId, ctx.accountFrequency);
            hit = debitHit || creditHit;
            if (hit) {
                const parts = [];
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
            hit = (0, derived_1.isUnusualAccountPair)(journal.debitAccountId, journal.creditAccountId, ctx.pairFrequency);
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
            hit = (0, derived_1.isRoundNumber)(journal.amount);
            if (hit) {
                explanation = `Amount ${journal.amount.toLocaleString()} is a round number.`;
            }
            break;
        }
        // ── Description ────────────────────────────────────────────────────────
        case 'isEmptyOrLowInfo': {
            hit = (0, derived_1.isEmptyOrLowInfo)(journal.description);
            if (hit) {
                explanation = journal.description
                    ? `Description "${journal.description}" is weak or low-information.`
                    : 'Journal has no description.';
            }
            break;
        }
        case 'containsSuspiciousKeywords': {
            const result = (0, derived_1.containsSuspiciousKeywords)(journal.description, ctx.config.suspiciousKeywords);
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
                const parts = [];
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
    if (!hit)
        return noHit;
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
function evaluateAllRules(rules, journal, ctx) {
    const drivers = [];
    const tagSet = new Set();
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
//# sourceMappingURL=ruleEngine.js.map