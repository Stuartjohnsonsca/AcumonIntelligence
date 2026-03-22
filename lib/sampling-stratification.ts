/**
 * AI Risk Stratification Engine (Mode B)
 *
 * Segments population into risk strata using:
 * - Z-score outlier detection on numeric features
 * - Rule-based flags (override, exception, out-of-hours)
 * - K-means clustering for pattern discovery
 * - Combined risk score with explainability
 *
 * Strata: High (top 10%), Medium (next 30%), Low (remaining 60%)
 * Cut points are configurable by the user.
 */

import { type PopulationItem, selectSRSWOR, generateSeed } from './sampling-engine';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface StratificationFeature {
  name: string;
  column: string;
  type: 'numeric' | 'categorical' | 'flag';
  weight?: number; // 0-1, default 1
}

export interface StratificationConfig {
  population: PopulationItem[];
  features: StratificationFeature[];
  strataCount?: number; // Default 3 (High, Medium, Low)
  highCutPct?: number;  // Default 10 (top 10% = High)
  medCutPct?: number;   // Default 40 (next 30% = Medium, i.e. 10-40 percentile from top)
  allocationRule: 'rule_a' | 'rule_b' | 'rule_c';
  // Rule A: 100% high, n% medium, m% low
  ruleAMediumPct?: number; // Default 30
  ruleALowPct?: number;    // Default 10
  // Rule B: fixed total, proportional by risk weight
  ruleBTotalN?: number;
  // Rule C: user custom per stratum
  ruleCHighN?: number;
  ruleCMediumN?: number;
  ruleCLowN?: number;
  seed?: number;
  explainability?: 'basic' | 'detailed';
}

export interface StratumInfo {
  name: string;
  level: 'high' | 'medium' | 'low';
  itemCount: number;
  totalValue: number;
  meanRiskScore: number;
  topDrivers: { feature: string; contribution: number }[];
  sampleSize: number;
}

export interface ItemRiskProfile {
  index: number;
  riskScore: number;
  stratum: 'high' | 'medium' | 'low';
  outlierScore: number;
  ruleScore: number;
  clusterLabel: number;
  drivers: { feature: string; contribution: number; reason: string }[];
}

export interface StratificationResult {
  strata: StratumInfo[];
  itemProfiles: ItemRiskProfile[];
  selectedIndices: number[];
  selectedItems: PopulationItem[];
  sampleSize: number;
  populationSize: number;
  algorithm: string;
  featuresUsed: string[];
  timestamp: string;
}

// ─── Statistical Helpers ─────────────────────────────────────────────────────

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((s, v) => s + v, 0) / values.length;
}

function stdDev(values: number[]): number {
  if (values.length <= 1) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((s, v) => s + (v - m) ** 2, 0) / (values.length - 1));
}

function zScore(value: number, m: number, sd: number): number {
  return sd === 0 ? 0 : (value - m) / sd;
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.floor(sorted.length * p);
  return sorted[Math.min(idx, sorted.length - 1)];
}

// ─── K-Means Clustering ──────────────────────────────────────────────────────

function kMeans(data: number[][], k: number, maxIter: number = 50): { labels: number[]; centroids: number[][] } {
  const n = data.length;
  const d = data[0]?.length || 0;
  if (n === 0 || d === 0) return { labels: [], centroids: [] };

  // Initialize centroids using k-means++ style (spread out)
  const centroids: number[][] = [];
  centroids.push([...data[Math.floor(Math.random() * n)]]);
  for (let ci = 1; ci < k; ci++) {
    const dists = data.map(point => {
      return Math.min(...centroids.map(c =>
        point.reduce((s, v, j) => s + (v - c[j]) ** 2, 0)
      ));
    });
    const totalDist = dists.reduce((s, d) => s + d, 0);
    let r = Math.random() * totalDist;
    for (let i = 0; i < n; i++) {
      r -= dists[i];
      if (r <= 0) { centroids.push([...data[i]]); break; }
    }
    if (centroids.length <= ci) centroids.push([...data[Math.floor(Math.random() * n)]]);
  }

  let labels = new Array(n).fill(0);

  for (let iter = 0; iter < maxIter; iter++) {
    // Assign
    const newLabels = data.map(point => {
      let minDist = Infinity;
      let minLabel = 0;
      centroids.forEach((c, ci) => {
        const dist = point.reduce((s, v, j) => s + (v - c[j]) ** 2, 0);
        if (dist < minDist) { minDist = dist; minLabel = ci; }
      });
      return minLabel;
    });

    // Check convergence
    if (newLabels.every((l, i) => l === labels[i])) break;
    labels = newLabels;

    // Update centroids
    for (let ci = 0; ci < k; ci++) {
      const members = data.filter((_, i) => labels[i] === ci);
      if (members.length === 0) continue;
      for (let j = 0; j < d; j++) {
        centroids[ci][j] = members.reduce((s, m) => s + m[j], 0) / members.length;
      }
    }
  }

  return { labels, centroids };
}

// ─── Main Stratification ─────────────────────────────────────────────────────

export function stratifyPopulation(config: StratificationConfig): StratificationResult {
  const { population, features, allocationRule, seed: providedSeed } = config;
  const N = population.length;
  const seed = providedSeed || generateSeed();
  const highCut = (config.highCutPct || 10) / 100;
  const medCut = (config.medCutPct || 40) / 100;
  const detailed = config.explainability === 'detailed';

  // ─── 1. Extract and standardise features ─────────────────────────────

  const numericFeatures = features.filter(f => f.type === 'numeric');
  const flagFeatures = features.filter(f => f.type === 'flag');
  const catFeatures = features.filter(f => f.type === 'categorical');

  // Compute stats for numeric features
  const featureStats = numericFeatures.map(f => {
    const values = population.map(item => parseFloat(String(item[f.column])) || 0);
    return { name: f.name, column: f.column, weight: f.weight ?? 1, mean: mean(values), sd: stdDev(values), values };
  });

  // ─── 2. Compute outlier scores (z-score based) ───────────────────────

  const outlierScores = population.map((_, idx) => {
    let maxZ = 0;
    for (const fs of featureStats) {
      const z = Math.abs(zScore(fs.values[idx], fs.mean, fs.sd));
      maxZ = Math.max(maxZ, z * fs.weight);
    }
    return maxZ;
  });

  // Normalise outlier scores to 0-1
  const maxOutlier = Math.max(...outlierScores, 1);
  const normOutlier = outlierScores.map(s => s / maxOutlier);

  // ─── 3. Rule-based flags ─────────────────────────────────────────────

  const ruleScores = population.map((item) => {
    let score = 0;
    for (const f of flagFeatures) {
      const val = String(item[f.column] || '').toLowerCase();
      if (val === 'true' || val === '1' || val === 'yes' || val === 'y') {
        score += (f.weight ?? 1);
      }
    }
    // Normalise by max possible
    const maxRule = flagFeatures.reduce((s, f) => s + (f.weight ?? 1), 0);
    return maxRule > 0 ? score / maxRule : 0;
  });

  // ─── 4. K-means clustering ───────────────────────────────────────────

  // Build feature matrix for clustering
  const featureMatrix = population.map((_, idx) => {
    const row: number[] = [];
    for (const fs of featureStats) {
      row.push(fs.sd > 0 ? zScore(fs.values[idx], fs.mean, fs.sd) : 0);
    }
    // Add categorical frequency encoding
    for (const cf of catFeatures) {
      const vals = population.map(item => String(item[cf.column] || ''));
      const freq: Record<string, number> = {};
      vals.forEach(v => { freq[v] = (freq[v] || 0) + 1; });
      row.push((freq[vals[idx]] || 0) / N); // frequency ratio
    }
    return row;
  });

  const k = Math.min(3, N); // 3 clusters
  const { labels: clusterLabels } = featureMatrix.length > 0 && featureMatrix[0].length > 0
    ? kMeans(featureMatrix, k)
    : { labels: new Array(N).fill(0) };

  // Compute cluster risk (mean outlier score per cluster)
  const clusterRisks: Record<number, number> = {};
  for (let c = 0; c < k; c++) {
    const members = normOutlier.filter((_, i) => clusterLabels[i] === c);
    clusterRisks[c] = members.length > 0 ? mean(members) : 0;
  }
  const maxClusterRisk = Math.max(...Object.values(clusterRisks), 1);
  const normCluster = clusterLabels.map(c => clusterRisks[c] / maxClusterRisk);

  // ─── 5. Combined risk score ──────────────────────────────────────────

  const riskScores = population.map((_, idx) => {
    // Weighted blend: 50% outlier, 25% rules, 25% cluster
    return normOutlier[idx] * 0.5 + ruleScores[idx] * 0.25 + normCluster[idx] * 0.25;
  });

  // ─── 6. Assign strata by quantiles ───────────────────────────────────

  const sortedScores = [...riskScores].sort((a, b) => b - a); // Descending
  const highThreshold = sortedScores[Math.floor(N * highCut) - 1] ?? sortedScores[0] ?? 0;
  const medThreshold = sortedScores[Math.floor(N * medCut) - 1] ?? 0;

  const strataAssignment: ('high' | 'medium' | 'low')[] = riskScores.map(score => {
    if (score >= highThreshold) return 'high';
    if (score >= medThreshold) return 'medium';
    return 'low';
  });

  // ─── 7. Build item profiles with explainability ──────────────────────

  const itemProfiles: ItemRiskProfile[] = population.map((_, idx) => {
    const drivers: { feature: string; contribution: number; reason: string }[] = [];

    if (detailed || strataAssignment[idx] === 'high') {
      // Top contributing features
      for (const fs of featureStats) {
        const z = Math.abs(zScore(fs.values[idx], fs.mean, fs.sd));
        if (z > 1.5) {
          const direction = fs.values[idx] > fs.mean ? 'above' : 'below';
          drivers.push({
            feature: fs.name,
            contribution: Math.round(z * 100) / 100,
            reason: `Value ${direction} average by ${z.toFixed(1)} standard deviations`,
          });
        }
      }
      for (const f of flagFeatures) {
        const val = String(population[idx][f.column] || '').toLowerCase();
        if (val === 'true' || val === '1' || val === 'yes' || val === 'y') {
          drivers.push({ feature: f.name, contribution: f.weight ?? 1, reason: `Flag is set (${f.name})` });
        }
      }
      drivers.sort((a, b) => b.contribution - a.contribution);
    }

    return {
      index: idx,
      riskScore: Math.round(riskScores[idx] * 10000) / 10000,
      stratum: strataAssignment[idx],
      outlierScore: Math.round(normOutlier[idx] * 10000) / 10000,
      ruleScore: Math.round(ruleScores[idx] * 10000) / 10000,
      clusterLabel: clusterLabels[idx],
      drivers,
    };
  });

  // ─── 8. Build stratum summaries ──────────────────────────────────────

  const stratumNames: ('high' | 'medium' | 'low')[] = ['high', 'medium', 'low'];
  const strata: StratumInfo[] = stratumNames.map(level => {
    const members = itemProfiles.filter(ip => ip.stratum === level);
    const memberItems = members.map(m => population[m.index]);
    const totalValue = memberItems.reduce((s, i) => s + Math.abs(i.bookValue), 0);

    // Top drivers for this stratum (aggregate)
    const driverCounts: Record<string, number> = {};
    members.forEach(m => m.drivers.forEach(d => {
      driverCounts[d.feature] = (driverCounts[d.feature] || 0) + d.contribution;
    }));
    const topDrivers = Object.entries(driverCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([feature, contribution]) => ({ feature, contribution: Math.round(contribution * 100) / 100 }));

    return {
      name: level === 'high' ? 'High Risk' : level === 'medium' ? 'Medium Risk' : 'Low Risk',
      level,
      itemCount: members.length,
      totalValue: Math.round(totalValue * 100) / 100,
      meanRiskScore: Math.round(mean(members.map(m => m.riskScore)) * 10000) / 10000,
      topDrivers,
      sampleSize: 0, // Will be set by allocation
    };
  });

  // ─── 9. Allocate sample sizes ────────────────────────────────────────

  const highStratum = strata.find(s => s.level === 'high')!;
  const medStratum = strata.find(s => s.level === 'medium')!;
  const lowStratum = strata.find(s => s.level === 'low')!;

  switch (allocationRule) {
    case 'rule_a': {
      // 100% high, n% medium, m% low
      highStratum.sampleSize = highStratum.itemCount;
      medStratum.sampleSize = Math.ceil(medStratum.itemCount * ((config.ruleAMediumPct || 30) / 100));
      lowStratum.sampleSize = Math.ceil(lowStratum.itemCount * ((config.ruleALowPct || 10) / 100));
      break;
    }
    case 'rule_b': {
      // Fixed total, proportional by risk weight
      const totalN = config.ruleBTotalN || 50;
      const totalRisk = strata.reduce((s, st) => s + st.meanRiskScore * st.itemCount, 0);
      if (totalRisk > 0) {
        highStratum.sampleSize = Math.min(highStratum.itemCount, Math.ceil(totalN * (highStratum.meanRiskScore * highStratum.itemCount) / totalRisk));
        medStratum.sampleSize = Math.min(medStratum.itemCount, Math.ceil(totalN * (medStratum.meanRiskScore * medStratum.itemCount) / totalRisk));
        lowStratum.sampleSize = Math.min(lowStratum.itemCount, totalN - highStratum.sampleSize - medStratum.sampleSize);
      } else {
        const perStratum = Math.ceil(totalN / 3);
        highStratum.sampleSize = Math.min(highStratum.itemCount, perStratum);
        medStratum.sampleSize = Math.min(medStratum.itemCount, perStratum);
        lowStratum.sampleSize = Math.min(lowStratum.itemCount, perStratum);
      }
      break;
    }
    case 'rule_c': {
      // User custom
      highStratum.sampleSize = Math.min(highStratum.itemCount, config.ruleCHighN || highStratum.itemCount);
      medStratum.sampleSize = Math.min(medStratum.itemCount, config.ruleCMediumN || 10);
      lowStratum.sampleSize = Math.min(lowStratum.itemCount, config.ruleCLowN || 5);
      break;
    }
  }

  // ─── 10. Select items from each stratum ──────────────────────────────

  const selectedIndices: number[] = [];

  for (const stratum of strata) {
    const stratumMembers = itemProfiles
      .filter(ip => ip.stratum === stratum.level)
      .sort((a, b) => b.riskScore - a.riskScore); // Highest risk first

    if (stratum.level === 'high' && allocationRule === 'rule_a') {
      // 100% of high risk
      stratumMembers.forEach(m => selectedIndices.push(m.index));
    } else {
      // Select top-n by risk score, or random if needed
      const toSelect = Math.min(stratum.sampleSize, stratumMembers.length);
      if (toSelect === stratumMembers.length) {
        stratumMembers.forEach(m => selectedIndices.push(m.index));
      } else {
        // Select top by risk score for deterministic selection
        stratumMembers.slice(0, toSelect).forEach(m => selectedIndices.push(m.index));
      }
    }
  }

  selectedIndices.sort((a, b) => a - b);

  return {
    strata,
    itemProfiles,
    selectedIndices,
    selectedItems: selectedIndices.map(i => population[i]),
    sampleSize: selectedIndices.length,
    populationSize: N,
    algorithm: 'RiskStratification-KMeans-ZScore',
    featuresUsed: features.map(f => f.name),
    timestamp: new Date().toISOString(),
  };
}
