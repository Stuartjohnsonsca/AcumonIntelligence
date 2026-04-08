/**
 * Coverage analysis for journal selection results.
 * Provides breakdowns by selection layer and risk tag to support
 * audit documentation of sample coverage.
 */

import type { JournalRiskResult, SelectionLayer } from '../types';

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
export function analyzeCoverage(results: JournalRiskResult[]): CoverageAnalysis {
  const byLayer: Record<string, number> = {};
  const byTag: Record<string, number> = {};
  let totalSelected = 0;

  for (const r of results) {
    const layer: SelectionLayer = r.selection.selectionLayer;

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
