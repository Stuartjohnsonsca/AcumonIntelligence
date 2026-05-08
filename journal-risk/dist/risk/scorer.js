"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scoreJournal = scoreJournal;
exports.scoreAllJournals = scoreAllJournals;
const ruleEngine_1 = require("./ruleEngine");
// ─── Score a single journal from its drivers ───────────────────────────────
function scoreJournal(drivers, maxScore = 100, highRiskMinScore = 70) {
    const raw = drivers.reduce((sum, d) => sum + d.weightApplied, 0);
    const riskScore = Math.min(raw, maxScore);
    let riskBand;
    if (riskScore >= highRiskMinScore) {
        riskBand = 'high';
    }
    else if (riskScore >= 40) {
        riskBand = 'medium';
    }
    else {
        riskBand = 'low';
    }
    return { riskScore, riskBand };
}
// ─── Score all journals in the population ──────────────────────────────────
function scoreAllJournals(journals, rules, ctx) {
    const highRiskMinScore = ctx.config.thresholds?.highRiskMinScore ?? 70;
    return journals.map((journal) => {
        const { drivers, tags } = (0, ruleEngine_1.evaluateAllRules)(rules, journal, ctx);
        const { riskScore, riskBand } = scoreJournal(drivers, 100, highRiskMinScore);
        const result = {
            journalId: journal.journalId,
            postedAt: journal.postedAt,
            period: journal.period,
            isManual: journal.source === 'GL' || journal.source === 'MANUAL',
            preparedByUserId: journal.preparedByUserId,
            approvedByUserId: journal.approvedByUserId,
            riskScore,
            riskBand,
            riskTags: tags,
            drivers,
            selection: {
                selected: false,
                selectionLayer: 'not_selected',
                mandatory: false,
                rationale: '',
            },
        };
        return result;
    });
}
//# sourceMappingURL=scorer.js.map