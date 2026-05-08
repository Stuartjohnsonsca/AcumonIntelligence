"use strict";
/**
 * Coverage analysis for journal selection results.
 * Provides breakdowns by selection layer and risk tag to support
 * audit documentation of sample coverage.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyzeCoverage = analyzeCoverage;
/**
 * Analyse the coverage of a set of scored and selected journal results.
 *
 * - byLayer: count of journals in each SelectionLayer (including 'not_selected')
 * - byTag: for selected journals only, count of journals carrying each risk tag
 * - totalSelected / totalPopulation: summary counts
 */
function analyzeCoverage(results) {
    const byLayer = {};
    const byTag = {};
    let totalSelected = 0;
    for (const r of results) {
        const layer = r.selection.selectionLayer;
        // Count by layer
        byLayer[layer] = (byLayer[layer] ?? 0) + 1;
        // Tag counts only for selected journals
        if (r.selection.selected) {
            totalSelected++;
            for (const tag of r.riskTags) {
                byTag[tag] = (byTag[tag] ?? 0) + 1;
            }
        }
    }
    return {
        byLayer,
        byTag,
        totalSelected,
        totalPopulation: results.length,
    };
}
//# sourceMappingURL=coverage.js.map