/**
 * Three-layer journal selection engine.
 *
 * Layer 1 — Mandatory high-risk: journals that MUST be tested.
 * Layer 2 — Targeted coverage: ensure breadth across risk dimensions.
 * Layer 3 — Unpredictable: deterrent element using deterministic randomness.
 */
import type { JournalRiskResult, Config } from '../types';
/**
 * Run the three-layer selection algorithm over scored journal results.
 * Mutates each result's `selection` property in place and returns the
 * full array (selected and not-selected).
 */
export declare function selectJournals(scoredResults: JournalRiskResult[], config: Config): JournalRiskResult[];
//# sourceMappingURL=selector.d.ts.map