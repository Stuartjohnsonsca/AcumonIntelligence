/**
 * Systematic Interval Sampling
 *
 * Selects items at regular intervals from an ordered population.
 * Supports single-stage and two-stage sampling.
 */

import { type PopulationItem, computePopulationHash } from './sampling-engine';

// Seeded PRNG (same as sampling-engine)
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SystematicConfig {
  population: PopulationItem[];
  sampleSize: number;
  seed: number;
  stage: 'single' | 'two_stage';
  secondStageFraction?: number; // For two-stage: fraction of residual to sample (default 0.5)
}

export interface SystematicResult {
  selectedItems: PopulationItem[];
  selectedIndices: number[];
  interval: number;
  startPoint: number;
  seed: number;
  algorithm: string;
  populationHash: string;
  populationSize: number;
  sampleSize: number;
  timestamp: string;
  stage: string;
  // Two-stage specific
  firstStageIndices?: number[];
  secondStageIndices?: number[];
}

/**
 * Single-stage systematic sampling.
 * Interval k = N/n, random start within [0, k).
 */
export function selectSystematic(config: SystematicConfig): SystematicResult {
  const { population, sampleSize: n, seed, stage } = config;
  const N = population.length;

  if (n > N) throw new Error(`Sample size (${n}) exceeds population size (${N})`);
  if (n <= 0) throw new Error('Sample size must be positive');

  const rng = mulberry32(seed);
  const interval = N / n;
  const start = rng() * interval;

  const indices: number[] = [];
  for (let i = 0; i < n; i++) {
    const idx = Math.floor(start + i * interval);
    if (idx < N) indices.push(idx);
  }

  if (stage === 'two_stage') {
    // Two-stage: first pass at interval, second pass on residual
    const firstStageIndices = [...indices];
    const firstStageSet = new Set(firstStageIndices);

    // Residual population (items not selected in first stage)
    const residualIndices = Array.from({ length: N }, (_, i) => i).filter(i => !firstStageSet.has(i));

    // Second stage: sample a fraction of the residual systematically
    const secondFraction = config.secondStageFraction || 0.5;
    const secondN = Math.max(1, Math.floor(residualIndices.length * secondFraction / (n * 2)));
    const secondInterval = residualIndices.length / Math.max(secondN, 1);
    const secondStart = rng() * secondInterval;

    const secondStageIndices: number[] = [];
    for (let i = 0; i < secondN; i++) {
      const ridx = Math.floor(secondStart + i * secondInterval);
      if (ridx < residualIndices.length) {
        secondStageIndices.push(residualIndices[ridx]);
      }
    }

    const allIndices = [...firstStageIndices, ...secondStageIndices].sort((a, b) => a - b);

    return {
      selectedItems: allIndices.map(i => population[i]),
      selectedIndices: allIndices,
      interval: Math.round(interval * 100) / 100,
      startPoint: Math.round(start * 100) / 100,
      seed,
      algorithm: 'Systematic-TwoStage',
      populationHash: computePopulationHash(population),
      populationSize: N,
      sampleSize: allIndices.length,
      timestamp: new Date().toISOString(),
      stage: 'two_stage',
      firstStageIndices,
      secondStageIndices,
    };
  }

  return {
    selectedItems: indices.map(i => population[i]),
    selectedIndices: indices,
    interval: Math.round(interval * 100) / 100,
    startPoint: Math.round(start * 100) / 100,
    seed,
    algorithm: 'Systematic-SingleStage',
    populationHash: computePopulationHash(population),
    populationSize: N,
    sampleSize: indices.length,
    timestamp: new Date().toISOString(),
    stage: 'single',
  };
}
