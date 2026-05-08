/**
 * Coverage analysis for journal selection results.
 * Provides breakdowns by selection layer and risk tag to support
 * audit documentation of sample coverage.
 */
import type { JournalRiskResult } from '../types';
export interface CoverageAnalysis {
    byLayer: Record<string, number>;
    byTag: Record<string, number>;
    totalSelected: number;
    totalPopulation: number;
}
/**
 * Analyse the coverage of a set of scored and selected journal results.
 *
 * - byLayer: count of journals in each SelectionLayer (including 'not_selected')
 * - byTag: for selected journals only, count of journals carrying each risk tag
 * - totalSelected / totalPopulation: summary counts
 */
export declare function analyzeCoverage(results: JournalRiskResult[]): CoverageAnalysis;
//# sourceMappingURL=coverage.d.ts.map