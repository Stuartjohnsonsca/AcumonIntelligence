/**
 * Composite Sampling
 *
 * Full testing of large items above a threshold, plus residual sampling
 * on the remaining population using a chosen method (random, systematic, MUS).
 *
 * Includes threshold sensitivity analysis for decision support.
 */

import { type PopulationItem, selectSRSWOR, computePopulationHash, generateSeed } from './sampling-engine';
import { selectSystematic } from './sampling-systematic';
import { selectMUS } from './sampling-mus';

export interface CompositeConfig {
  population: PopulationItem[];
  threshold: number;
  residualMethod: 'random' | 'systematic' | 'mus';
  residualSampleSize?: number; // For random/systematic
  seed: number;
  tolerableMisstatement?: number; // For MUS residual
  confidenceFactor?: number; // For MUS residual
  confidence?: number; // For random residual
}

export interface CompositeResult {
  // Large items (100% tested)
  largeItems: PopulationItem[];
  largeItemIndices: number[];
  largeItemTotal: number;
  largeItemCount: number;
  // Residual sample
  residualItems: PopulationItem[];
  residualIndices: number[];
  residualTotal: number;
  residualPopulationSize: number;
  residualMethod: string;
  // Combined
  selectedItems: PopulationItem[];
  selectedIndices: number[];
  sampleSize: number;
  populationSize: number;
  populationTotal: number;
  sampleTotal: number;
  coverage: number;
  threshold: number;
  seed: number;
  algorithm: string;
  populationHash: string;
  timestamp: string;
}

export interface ThresholdSensitivity {
  threshold: number;
  largeItemCount: number;
  largeItemTotal: number;
  residualPopulationSize: number;
  residualPopulationTotal: number;
  indicativeResidualSample: number;
  totalSampleItems: number;
  valueCoverage: number; // percentage of population value covered by large items
}

/**
 * Compute threshold sensitivity analysis data.
 * Returns an array of data points for different threshold values.
 */
export function computeThresholdSensitivity(
  population: PopulationItem[],
  tolerableMisstatement: number,
  confidenceFactor: number,
  thresholdSteps?: number[],
): ThresholdSensitivity[] {
  const N = population.length;
  const popTotal = population.reduce((s, i) => s + Math.abs(i.bookValue), 0);

  // If no steps provided, generate from population value distribution
  if (!thresholdSteps) {
    const values = population.map(i => Math.abs(i.bookValue)).sort((a, b) => a - b);
    const p10 = values[Math.floor(N * 0.1)] || 0;
    const p25 = values[Math.floor(N * 0.25)] || 0;
    const p50 = values[Math.floor(N * 0.5)] || 0;
    const p75 = values[Math.floor(N * 0.75)] || 0;
    const p90 = values[Math.floor(N * 0.9)] || 0;
    const max = values[N - 1] || 0;

    // Generate 10 threshold points across the value range
    const step = max / 10;
    thresholdSteps = [];
    for (let i = 1; i <= 10; i++) {
      thresholdSteps.push(Math.round(step * i * 100) / 100);
    }
    // Add percentile-based thresholds
    thresholdSteps = [...new Set([p10, p25, p50, p75, p90, ...thresholdSteps])].sort((a, b) => a - b).filter(t => t > 0);
  }

  return thresholdSteps.map(threshold => {
    const largeItems = population.filter(i => Math.abs(i.bookValue) >= threshold);
    const residual = population.filter(i => Math.abs(i.bookValue) < threshold);
    const largeTotal = largeItems.reduce((s, i) => s + Math.abs(i.bookValue), 0);
    const residualTotal = residual.reduce((s, i) => s + Math.abs(i.bookValue), 0);

    // Indicative residual sample using MUS interval
    const interval = tolerableMisstatement > 0 && confidenceFactor > 0
      ? tolerableMisstatement / confidenceFactor
      : 0;
    const indicativeResidual = interval > 0 ? Math.ceil(residualTotal / interval) : Math.min(25, residual.length);

    return {
      threshold,
      largeItemCount: largeItems.length,
      largeItemTotal: Math.round(largeTotal * 100) / 100,
      residualPopulationSize: residual.length,
      residualPopulationTotal: Math.round(residualTotal * 100) / 100,
      indicativeResidualSample: Math.min(indicativeResidual, residual.length),
      totalSampleItems: largeItems.length + Math.min(indicativeResidual, residual.length),
      valueCoverage: popTotal > 0 ? Math.round((largeTotal / popTotal) * 10000) / 100 : 0,
    };
  });
}

/**
 * Execute composite sampling: 100% of large items + residual method on the rest.
 */
export function selectComposite(config: CompositeConfig): CompositeResult {
  const { population, threshold, residualMethod, seed } = config;
  const N = population.length;
  const popTotal = population.reduce((s, i) => s + Math.abs(i.bookValue), 0);

  // Split into large items and residual
  const largeItemIndices: number[] = [];
  const residualIndices: number[] = [];
  const residualPopulation: PopulationItem[] = [];

  population.forEach((item, idx) => {
    if (Math.abs(item.bookValue) >= threshold) {
      largeItemIndices.push(idx);
    } else {
      residualIndices.push(idx);
      residualPopulation.push(item);
    }
  });

  const largeItems = largeItemIndices.map(i => population[i]);
  const largeTotal = largeItems.reduce((s, i) => s + Math.abs(i.bookValue), 0);

  // Select from residual population
  let residualSelected: PopulationItem[] = [];
  let residualSelectedOriginalIndices: number[] = [];
  let residualMethodName: string = residualMethod;

  if (residualPopulation.length > 0) {
    const residualN = config.residualSampleSize || Math.min(25, residualPopulation.length);

    switch (residualMethod) {
      case 'random': {
        const result = selectSRSWOR(residualPopulation, Math.min(residualN, residualPopulation.length), seed);
        residualSelected = result.selectedItems;
        residualSelectedOriginalIndices = result.selectedIndices.map(ri => residualIndices[ri]);
        break;
      }
      case 'systematic': {
        const result = selectSystematic({
          population: residualPopulation,
          sampleSize: Math.min(residualN, residualPopulation.length),
          seed,
          stage: 'single',
        });
        residualSelected = result.selectedItems;
        residualSelectedOriginalIndices = result.selectedIndices.map(ri => residualIndices[ri]);
        break;
      }
      case 'mus': {
        if (config.tolerableMisstatement && config.confidenceFactor) {
          const result = selectMUS({
            population: residualPopulation,
            tolerableMisstatement: config.tolerableMisstatement,
            confidenceFactor: config.confidenceFactor,
            seed,
          });
          residualSelected = result.selectedItems;
          residualSelectedOriginalIndices = result.selectedIndices.map(ri => residualIndices[ri]);
        } else {
          // Fallback to random if MUS params not provided
          const result = selectSRSWOR(residualPopulation, Math.min(residualN, residualPopulation.length), seed);
          residualSelected = result.selectedItems;
          residualSelectedOriginalIndices = result.selectedIndices.map(ri => residualIndices[ri]);
          residualMethodName = 'random (MUS params not provided)';
        }
        break;
      }
    }
  }

  const allIndices = [...largeItemIndices, ...residualSelectedOriginalIndices].sort((a, b) => a - b);
  const allItems = allIndices.map(i => population[i]);
  const sampleTotal = allItems.reduce((s, i) => s + Math.abs(i.bookValue), 0);
  const residualSampleTotal = residualSelected.reduce((s, i) => s + Math.abs(i.bookValue), 0);

  return {
    largeItems,
    largeItemIndices,
    largeItemTotal: Math.round(largeTotal * 100) / 100,
    largeItemCount: largeItems.length,
    residualItems: residualSelected,
    residualIndices: residualSelectedOriginalIndices,
    residualTotal: Math.round(residualSampleTotal * 100) / 100,
    residualPopulationSize: residualPopulation.length,
    residualMethod: residualMethodName,
    selectedItems: allItems,
    selectedIndices: allIndices,
    sampleSize: allItems.length,
    populationSize: N,
    populationTotal: Math.round(popTotal * 100) / 100,
    sampleTotal: Math.round(sampleTotal * 100) / 100,
    coverage: popTotal > 0 ? Math.round((sampleTotal / popTotal) * 10000) / 100 : 0,
    threshold,
    seed,
    algorithm: `Composite-${residualMethodName}`,
    populationHash: computePopulationHash(population),
    timestamp: new Date().toISOString(),
  };
}
