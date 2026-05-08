/**
 * Statistical helper functions for risk scoring computations.
 */
/**
 * Computes the percentile rank (0-100) of a given value within a sorted array.
 * Uses the "percentage of values below" method.
 * Returns 0 if the array is empty.
 */
export declare function computePercentile(values: number[], value: number): number;
/**
 * Builds a frequency map from an array of string items.
 * Each unique item maps to its occurrence count.
 */
export declare function computeFrequencyMap(items: string[]): Map<string, number>;
//# sourceMappingURL=stats.d.ts.map