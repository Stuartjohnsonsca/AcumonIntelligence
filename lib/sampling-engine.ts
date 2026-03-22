/**
 * Sampling Engine — Simple Random Sampling Without Replacement (SRSWOR)
 *
 * Implements statistically rigorous audit sampling per ISA 530 / firm methodology.
 * Supports:
 * - PRNG-seeded reproducible selection
 * - Finite Population Correction (FPC)
 * - One-sided upper confidence bounds using t-distribution
 * - Three planning modes (pilot, assumed SD, book SD bound)
 * - Full audit trail (population hash, seed, algorithm, timestamps)
 */

import { jStat } from 'jstat';
import { createHash } from 'crypto';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PopulationItem {
  id: string;
  bookValue: number;
  [key: string]: unknown; // additional mapped columns
}

export type ErrorMetric = 'net_signed' | 'overstatement_only' | 'absolute_error';

export interface SamplingConfig {
  populationItems: PopulationItem[];
  sampleSize: number;
  seed: number;
  errorMetric: ErrorMetric;
  confidence: number; // e.g. 0.95
  tolerableMisstatement: number;
}

export interface PlanningConfig {
  populationItems: PopulationItem[];
  confidence: number;
  tolerableMisstatement: number;
  errorMetric: ErrorMetric;
  mode: 'pilot' | 'assumed_sd' | 'book_sd_bound';
  pilotSize?: number; // for pilot mode, default 25
  assumedSd?: number; // for assumed_sd mode
  kFactor?: number;   // for book_sd_bound mode (percentage, e.g. 20 for 20%)
}

export interface SelectionResult {
  selectedItems: PopulationItem[];
  selectedIndices: number[];
  seed: number;
  algorithm: string;
  populationHash: string;
  populationSize: number;
  sampleSize: number;
  timestamp: string;
}

export interface EvaluationInput {
  sampleItems: { id: string; bookValue: number; auditedValue: number }[];
  populationSize: number;
  confidence: number;
  tolerableMisstatement: number;
  errorMetric: ErrorMetric;
}

export interface EvaluationResult {
  sampleSize: number;
  populationSize: number;
  meanError: number;
  sampleSd: number;
  fpc: number;
  standardError: number;
  tCritical: number;
  uclMean: number;
  uclTotal: number;
  tolerableMisstatement: number;
  decision: 'PASS' | 'FAIL';
  confidenceLevel: number;
  errorMetric: ErrorMetric;
  errors: number[];
}

export interface PlanningSizeResult {
  recommendedN: number;
  estimatedSd: number;
  mode: string;
  rationale: string;
}

// ─── Seeded PRNG (Mulberry32 — fast, deterministic, 32-bit) ─────────────────

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── Core Functions ──────────────────────────────────────────────────────────

/**
 * Compute SHA-256 hash of the population (ordered by id + bookValue).
 * Proves the population frame used for reproducibility.
 */
export function computePopulationHash(items: PopulationItem[]): string {
  const sorted = [...items].sort((a, b) => a.id.localeCompare(b.id));
  const data = sorted.map(i => `${i.id}:${i.bookValue}`).join('|');
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Select n items from the population using SRSWOR (Simple Random Sampling Without Replacement).
 * Uses a seeded PRNG for reproducibility.
 */
export function selectSRSWOR(
  population: PopulationItem[],
  n: number,
  seed: number,
): SelectionResult {
  const N = population.length;
  if (n > N) throw new Error(`Sample size (${n}) exceeds population size (${N})`);
  if (n <= 0) throw new Error('Sample size must be positive');

  const rng = mulberry32(seed);
  const indices: number[] = [];
  const available = Array.from({ length: N }, (_, i) => i);

  // Fisher-Yates partial shuffle to select n items
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(rng() * (N - i));
    [available[i], available[j]] = [available[j], available[i]];
    indices.push(available[i]);
  }

  indices.sort((a, b) => a - b); // Sort for reproducible ordering

  return {
    selectedItems: indices.map(i => population[i]),
    selectedIndices: indices,
    seed,
    algorithm: 'Mulberry32-SRSWOR',
    populationHash: computePopulationHash(population),
    populationSize: N,
    sampleSize: n,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Compute errors for each sampled item based on the chosen error metric.
 */
export function computeErrors(
  items: { bookValue: number; auditedValue: number }[],
  metric: ErrorMetric,
): number[] {
  return items.map(item => {
    const signed = item.bookValue - item.auditedValue;
    switch (metric) {
      case 'net_signed':
        return signed;
      case 'overstatement_only':
        return Math.max(0, signed);
      case 'absolute_error':
        return Math.abs(signed);
      default:
        return signed;
    }
  });
}

/**
 * Compute the Finite Population Correction factor.
 * FPC = sqrt((N - n) / N)
 */
export function computeFPC(n: number, N: number): number {
  if (N <= 0 || n <= 0) return 1;
  if (n >= N) return 0;
  return Math.sqrt((N - n) / N);
}

/**
 * Compute sample mean of an array of numbers.
 */
function sampleMean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

/**
 * Compute sample standard deviation (using n-1 denominator).
 */
function sampleStdDev(values: number[]): number {
  const n = values.length;
  if (n <= 1) return 0;
  const mean = sampleMean(values);
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1);
  return Math.sqrt(variance);
}

/**
 * Evaluate sample results and compute one-sided upper confidence bound.
 *
 * UCL(μ) = x̄ + t(α, n-1) × SE
 * where SE = (s / √n) × FPC
 *
 * UCL(T) = N × UCL(μ)
 * Decision: UCL(T) ≤ TM → PASS
 */
export function evaluateSample(input: EvaluationInput): EvaluationResult {
  const { sampleItems, populationSize: N, confidence, tolerableMisstatement: TM, errorMetric } = input;
  const n = sampleItems.length;

  if (n === 0) throw new Error('No sample items to evaluate');

  // Compute errors
  const errors = computeErrors(sampleItems, errorMetric);

  // Statistics
  const meanErr = sampleMean(errors);
  const sd = sampleStdDev(errors);
  const fpc = computeFPC(n, N);
  const se = (sd / Math.sqrt(n)) * fpc;

  // t-critical value for one-sided upper bound at confidence level
  // For one-sided: use alpha in one tail
  const alpha = 1 - confidence;
  const df = n - 1;
  const tCrit = df > 0 ? jStat.studentt.inv(1 - alpha, df) : 1.96;

  // Upper confidence limits
  const uclMean = meanErr + tCrit * se;
  const uclTotal = N * uclMean;

  // Decision
  const decision: 'PASS' | 'FAIL' = uclTotal <= TM ? 'PASS' : 'FAIL';

  return {
    sampleSize: n,
    populationSize: N,
    meanError: Math.round(meanErr * 100) / 100,
    sampleSd: Math.round(sd * 100) / 100,
    fpc: Math.round(fpc * 10000) / 10000,
    standardError: Math.round(se * 100) / 100,
    tCritical: Math.round(tCrit * 10000) / 10000,
    uclMean: Math.round(uclMean * 100) / 100,
    uclTotal: Math.round(uclTotal * 100) / 100,
    tolerableMisstatement: TM,
    decision,
    confidenceLevel: confidence,
    errorMetric,
    errors,
  };
}

// ─── Sample Size Planning ────────────────────────────────────────────────────

/**
 * Compute required sample size for a given target bound on total error.
 *
 * Target: UCL(T) ≤ TM
 * Solve for n such that: N × (t(α,n-1) × (σ/√n) × FPC(n,N)) ≤ TM
 *
 * Uses monotone search (binary search on n).
 */
export function computeRequiredSampleSize(
  N: number,
  TM: number,
  sdEstimate: number,
  confidence: number,
): number {
  if (N <= 0 || TM <= 0 || sdEstimate <= 0) return Math.min(25, N);

  const alpha = 1 - confidence;
  let lo = 2;
  let hi = Math.min(N, 10000); // Cap search at 10000

  // Check if even the maximum sample size works
  const checkN = (n: number): number => {
    const df = n - 1;
    const tCrit = jStat.studentt.inv(1 - alpha, Math.max(df, 1));
    const fpc = computeFPC(n, N);
    const se = (sdEstimate / Math.sqrt(n)) * fpc;
    return N * tCrit * se;
  };

  // If even n=N doesn't satisfy, return N
  if (checkN(hi) > TM) return Math.min(hi, N);

  // Binary search for smallest n where UCL(T) ≤ TM
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (checkN(mid) <= TM) {
      hi = mid;
    } else {
      lo = mid + 1;
    }
  }

  return Math.min(lo, N);
}

/**
 * Plan sample size using one of three modes.
 */
export function planSampleSize(config: PlanningConfig): PlanningSizeResult {
  const { populationItems, confidence, tolerableMisstatement, mode } = config;
  const N = populationItems.length;

  switch (mode) {
    case 'pilot': {
      // Mode A: Use pilot sample to estimate SD
      const n0 = config.pilotSize || 25;
      const pilotSeed = 42; // Fixed seed for pilot
      const pilot = selectSRSWOR(populationItems, Math.min(n0, N), pilotSeed);
      // For planning, use book value SD as proxy (no audited values yet)
      const bookValues = pilot.selectedItems.map(i => i.bookValue);
      const sd = sampleStdDev(bookValues);
      const requiredN = computeRequiredSampleSize(N, tolerableMisstatement, sd, confidence);
      return {
        recommendedN: Math.max(requiredN, n0),
        estimatedSd: Math.round(sd * 100) / 100,
        mode: 'Pilot sample',
        rationale: `Pilot sample of ${n0} items yielded estimated SD of ${sd.toFixed(2)}. Required sample size computed using FPC-adjusted one-sided bound.`,
      };
    }

    case 'assumed_sd': {
      // Mode B: User-supplied conservative SD
      const sd = config.assumedSd || 1;
      const requiredN = computeRequiredSampleSize(N, tolerableMisstatement, sd, confidence);
      return {
        recommendedN: requiredN,
        estimatedSd: sd,
        mode: 'Assumed SD',
        rationale: `Using assumed standard deviation of ${sd.toFixed(2)} (from prior period or professional judgement). Required sample size computed using FPC-adjusted one-sided bound.`,
      };
    }

    case 'book_sd_bound': {
      // Mode C: Use population book value SD × k factor
      const bookValues = populationItems.map(i => i.bookValue);
      const bookSd = sampleStdDev(bookValues);
      const k = (config.kFactor || 20) / 100; // Convert percentage to decimal
      const sdEstimate = bookSd * k;
      const requiredN = computeRequiredSampleSize(N, tolerableMisstatement, sdEstimate, confidence);
      return {
        recommendedN: requiredN,
        estimatedSd: Math.round(sdEstimate * 100) / 100,
        mode: 'Book value SD bound',
        rationale: `Population book value SD = ${bookSd.toFixed(2)}. Applied k-factor of ${(k * 100).toFixed(0)}% to estimate error SD = ${sdEstimate.toFixed(2)}. Required sample size computed using FPC-adjusted one-sided bound.`,
      };
    }

    default:
      return { recommendedN: 25, estimatedSd: 0, mode: 'Default', rationale: 'Default sample size' };
  }
}

// ─── Audit Trail ─────────────────────────────────────────────────────────────

export interface AuditTrail {
  populationHash: string;
  populationSize: number;
  sampleSize: number;
  seed: number;
  algorithm: string;
  errorMetric: ErrorMetric;
  confidence: number;
  tolerableMisstatement: number;
  timestamp: string;
  toolVersion: string;
  selectedItemIds: string[];
}

export function buildAuditTrail(
  selection: SelectionResult,
  config: { errorMetric: ErrorMetric; confidence: number; tolerableMisstatement: number },
): AuditTrail {
  return {
    populationHash: selection.populationHash,
    populationSize: selection.populationSize,
    sampleSize: selection.sampleSize,
    seed: selection.seed,
    algorithm: selection.algorithm,
    errorMetric: config.errorMetric,
    confidence: config.confidence,
    tolerableMisstatement: config.tolerableMisstatement,
    timestamp: selection.timestamp,
    toolVersion: '1.0',
    selectedItemIds: selection.selectedItems.map(i => i.id),
  };
}

/**
 * Generate a random seed from current timestamp if not provided.
 */
export function generateSeed(): number {
  return Math.floor(Math.random() * 2147483647);
}
