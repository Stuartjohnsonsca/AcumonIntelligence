/**
 * Monetary Unit Sampling (MUS) / Probability Proportional to Size (PPS)
 *
 * Selects sampling units proportional to their monetary value.
 * Larger items have a higher probability of selection.
 * Uses cumulative monetary amount method with a fixed sampling interval.
 */

import { type PopulationItem, computePopulationHash } from './sampling-engine';

// Seeded PRNG
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface MUSConfig {
  population: PopulationItem[];
  tolerableMisstatement: number;
  confidenceFactor: number; // From firm's confidence factor table
  seed: number;
  expectedErrors?: number; // Expected number of errors (default 0)
}

export interface MUSResult {
  selectedItems: PopulationItem[];
  selectedIndices: number[];
  samplingInterval: number;
  sampleSize: number;
  populationTotal: number;
  seed: number;
  algorithm: string;
  populationHash: string;
  populationSize: number;
  timestamp: string;
  // Items that exceed the sampling interval (100% tested)
  highValueItems: number[];
  // Remaining items selected by cumulative method
  cumulativeSelections: number[];
}

/**
 * MUS Selection using cumulative monetary amount method.
 *
 * Sampling interval = TM / confidence factor
 * Items with book value >= interval are selected with certainty (high-value items).
 * Remaining items are selected using cumulative value selection.
 */
export function selectMUS(config: MUSConfig): MUSResult {
  const { population, tolerableMisstatement: TM, confidenceFactor, seed } = config;
  const N = population.length;

  if (N === 0) throw new Error('Population is empty');
  if (TM <= 0) throw new Error('Tolerable misstatement must be positive for MUS');
  if (confidenceFactor <= 0) throw new Error('Confidence factor must be positive');

  // Use absolute values for MUS (value-weighted)
  const absPopulation = population.map(item => ({
    ...item,
    absValue: Math.abs(item.bookValue),
  }));

  const populationTotal = absPopulation.reduce((s, i) => s + i.absValue, 0);
  const samplingInterval = TM / confidenceFactor;

  // Identify high-value items (book value >= sampling interval)
  const highValueIndices: number[] = [];
  const remainingIndices: number[] = [];

  absPopulation.forEach((item, idx) => {
    if (item.absValue >= samplingInterval) {
      highValueIndices.push(idx);
    } else {
      remainingIndices.push(idx);
    }
  });

  // Cumulative monetary amount selection on remaining items
  const rng = mulberry32(seed);
  const randomStart = rng() * samplingInterval;
  const cumulativeSelections: number[] = [];

  let cumulative = 0;
  let nextSelectionPoint = randomStart;

  for (const idx of remainingIndices) {
    const prevCumulative = cumulative;
    cumulative += absPopulation[idx].absValue;

    // Check if this item spans one or more selection points
    while (nextSelectionPoint <= cumulative && nextSelectionPoint > prevCumulative) {
      if (!cumulativeSelections.includes(idx)) {
        cumulativeSelections.push(idx);
      }
      nextSelectionPoint += samplingInterval;
    }
  }

  // Combine selections
  const allIndices = [...highValueIndices, ...cumulativeSelections].sort((a, b) => a - b);
  // Deduplicate
  const uniqueIndices = [...new Set(allIndices)];

  return {
    selectedItems: uniqueIndices.map(i => population[i]),
    selectedIndices: uniqueIndices,
    samplingInterval: Math.round(samplingInterval * 100) / 100,
    sampleSize: uniqueIndices.length,
    populationTotal: Math.round(populationTotal * 100) / 100,
    seed,
    algorithm: 'MUS-CumulativeMonetaryAmount',
    populationHash: computePopulationHash(population),
    populationSize: N,
    timestamp: new Date().toISOString(),
    highValueItems: highValueIndices,
    cumulativeSelections,
  };
}

/**
 * Calculate the expected MUS sample size for planning purposes.
 */
export function estimateMUSSampleSize(
  populationTotal: number,
  tolerableMisstatement: number,
  confidenceFactor: number,
): { sampleSize: number; samplingInterval: number } {
  const interval = tolerableMisstatement / confidenceFactor;
  const n = Math.ceil(populationTotal / interval);
  return { sampleSize: n, samplingInterval: Math.round(interval * 100) / 100 };
}
