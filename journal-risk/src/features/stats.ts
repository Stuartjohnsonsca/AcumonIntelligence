/**
 * Statistical helper functions for risk scoring computations.
 */

/**
 * Computes the percentile rank (0-100) of a given value within a sorted array.
 * Uses the "percentage of values below" method.
 * Returns 0 if the array is empty.
 */
export function computePercentile(values: number[], value: number): number {
  if (values.length === 0) return 0;

  const sorted = [...values].sort((a, b) => a - b);
  let countBelow = 0;
  for (const v of sorted) {
    if (v < value) {
      countBelow++;
    } else {
      break;
    }
  }

  return (countBelow / sorted.length) * 100;
}

/**
 * Builds a frequency map from an array of string items.
 * Each unique item maps to its occurrence count.
 */
export function computeFrequencyMap(items: string[]): Map<string, number> {
  const freq = new Map<string, number>();
  for (const item of items) {
    freq.set(item, (freq.get(item) ?? 0) + 1);
  }
  return freq;
}
