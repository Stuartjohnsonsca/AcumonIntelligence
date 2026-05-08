"use strict";
/**
 * Three-layer journal selection engine.
 *
 * Layer 1 — Mandatory high-risk: journals that MUST be tested.
 * Layer 2 — Targeted coverage: ensure breadth across risk dimensions.
 * Layer 3 — Unpredictable: deterrent element using deterministic randomness.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.selectJournals = selectJournals;
const explainer_1 = require("../risk/explainer");
const unpredictability_1 = require("./unpredictability");
// Tags that indicate a critical-severity rule fired
const CRITICAL_TAGS = new Set(['post_close', 'senior_poster']);
// ─── Helpers ────────────────────────────────────────────────────────────────
function countCriticalTags(tags) {
    let count = 0;
    for (const tag of tags) {
        if (CRITICAL_TAGS.has(tag))
            count++;
    }
    return count;
}
function markSelection(result, layer, mandatory, selected) {
    result.selection = {
        selected,
        selectionLayer: layer,
        mandatory,
        rationale: '', // filled in at the end
    };
}
// ─── Layer 1: Mandatory high-risk ───────────────────────────────────────────
function applyLayer1(results, config) {
    const selectedIds = new Set();
    const { mandatorySelectMinScore, mandatorySelectMinCriticalTags } = config.thresholds;
    for (const r of results) {
        const critCount = countCriticalTags(r.riskTags);
        if (r.riskScore >= mandatorySelectMinScore || critCount >= mandatorySelectMinCriticalTags) {
            markSelection(r, 'layer1_mandatory_high_risk', true, true);
            selectedIds.add(r.journalId);
        }
    }
    return selectedIds;
}
// ─── Layer 2: Targeted coverage ─────────────────────────────────────────────
function applyLayer2(results, config, alreadySelected) {
    const layer2Ids = new Set();
    const targets = config.selection.layer2CoverageTargets;
    const maxTotal = config.selection.maxSampleSize;
    // Pre-sort unselected candidates by riskScore descending for efficient picking
    const unselected = results
        .filter((r) => !alreadySelected.has(r.journalId))
        .sort((a, b) => b.riskScore - a.riskScore);
    // Track total selected across all layers so far
    let totalSelected = alreadySelected.size;
    // Process each coverage bucket
    for (const [bucketTag, targetCount] of Object.entries(targets)) {
        let picked = 0;
        for (const r of unselected) {
            if (picked >= targetCount)
                break;
            if (totalSelected >= maxTotal)
                break;
            if (alreadySelected.has(r.journalId) || layer2Ids.has(r.journalId))
                continue;
            // Journal must carry the bucket tag
            if (!r.riskTags.includes(bucketTag))
                continue;
            markSelection(r, 'layer2_targeted_coverage', false, true);
            layer2Ids.add(r.journalId);
            totalSelected++;
            picked++;
        }
    }
    return layer2Ids;
}
// ─── Layer 3: Unpredictable ─────────────────────────────────────────────────
function applyLayer3(results, config, alreadySelected) {
    const layer3Ids = new Set();
    const targetCount = config.selection.layer3UnpredictableCount;
    // Candidates: manual, low or medium risk, not already selected
    const candidates = results.filter((r) => !alreadySelected.has(r.journalId) &&
        r.isManual &&
        (r.riskBand === 'low' || r.riskBand === 'medium'));
    if (candidates.length === 0 || targetCount <= 0)
        return layer3Ids;
    // Deterministic seed from population size + period end date
    const seedInput = `${results.length}${config.periodEndDate}`;
    const seed = (0, unpredictability_1.hashSeed)(seedInput);
    const sampled = (0, unpredictability_1.deterministicSample)(candidates, targetCount, seed);
    for (const r of sampled) {
        markSelection(r, 'layer3_unpredictable', false, true);
        layer3Ids.add(r.journalId);
    }
    return layer3Ids;
}
// ─── Main entry point ───────────────────────────────────────────────────────
/**
 * Run the three-layer selection algorithm over scored journal results.
 * Mutates each result's `selection` property in place and returns the
 * full array (selected and not-selected).
 */
function selectJournals(scoredResults, config) {
    // Layer 1
    const layer1Ids = applyLayer1(scoredResults, config);
    // Layer 2
    const afterLayer1 = new Set(layer1Ids);
    const layer2Ids = applyLayer2(scoredResults, config, afterLayer1);
    // Layer 3
    const afterLayer2 = new Set([...afterLayer1, ...layer2Ids]);
    const layer3Ids = applyLayer3(scoredResults, config, afterLayer2);
    // Collect all selected IDs
    const allSelectedIds = new Set([...afterLayer2, ...layer3Ids]);
    // Mark everything not selected
    for (const r of scoredResults) {
        if (!allSelectedIds.has(r.journalId)) {
            markSelection(r, 'not_selected', false, false);
        }
    }
    // Apply rationale text to every result
    for (const r of scoredResults) {
        if (r.selection.selected) {
            r.selection.rationale = (0, explainer_1.composeSelectionRationale)(r);
        }
        else {
            r.selection.rationale = (0, explainer_1.composeNotSelectedRationale)(r);
        }
    }
    return scoredResults;
}
//# sourceMappingURL=selector.js.map