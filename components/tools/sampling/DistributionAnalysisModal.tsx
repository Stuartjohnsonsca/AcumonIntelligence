'use client';

import { useState, useMemo, useCallback } from 'react';
import { X, BarChart3, PieChart as PieChartIcon, Activity, Table2, Info, MousePointer2, CheckSquare } from 'lucide-react';
import {
  ComposedChart, Scatter, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
  BarChart, Bar,
  PieChart, Pie, Cell,
} from 'recharts';
import type { PieLabelRenderProps } from 'recharts';

// ─── Types ───────────────────────────────────────────────────────────────────

interface StratumData {
  name: string;
  level: string;
  itemCount: number;
  sampleSize: number;
  totalValue: number;
  topDrivers: { feature: string; contribution: number }[];
}

interface LightweightProfile {
  index: number;
  riskScore: number;
  stratum: 'high' | 'medium' | 'low';
}

interface Props {
  open: boolean;
  onClose: () => void;
  fullPopulationData: Record<string, unknown>[];
  selectedIndices: Set<number>;
  amountColumn: string;
  stratificationResults: { strata: StratumData[] } | null;
  itemProfiles: LightweightProfile[] | null;
  currency: string;
  onSelectAnomalies?: (indices: Set<number>) => void;
}

// ─── Distribution Types ─────────────────────────────────────────────────────

type DistributionType = 'normal' | 'log-normal' | 'exponential' | 'uniform' | 'multimodal';

interface FittedDistribution {
  type: DistributionType;
  label: string;
  params: Record<string, number>;
  goodnessOfFit: number;
  curveData: { x: number; y: number }[];
}

// ─── Constants ───────────────────────────────────────────────────────────────

const STRATA_COLORS: Record<string, string> = {
  high: '#ef4444', medium: '#f59e0b', low: '#22c55e',
};

const DIST_COLORS: Record<DistributionType, string> = {
  'normal': '#6366f1', 'log-normal': '#ec4899', 'exponential': '#f97316',
  'uniform': '#06b6d4', 'multimodal': '#8b5cf6',
};

const TABS = [
  { key: 'histogram', label: 'Distribution', icon: BarChart3 },
  { key: 'strata', label: 'Strata', icon: PieChartIcon },
  { key: 'risk', label: 'Risk Scores', icon: Activity },
  { key: 'stats', label: 'Statistics', icon: Table2 },
] as const;

type TabKey = (typeof TABS)[number]['key'];

const STAT_TOOLTIPS: Record<string, string> = {
  'Skewness': 'Measures asymmetry of the distribution. Positive = right tail longer (large outliers). Negative = left tail longer. Near 0 = symmetric.',
  'Kurtosis': 'Measures tail heaviness relative to normal distribution. Positive (leptokurtic) = more outliers than normal. Negative (platykurtic) = fewer outliers.',
  'Range': 'Difference between the largest and smallest values in the population.',
  'CV': 'Coefficient of Variation — standard deviation as a percentage of the mean. Higher CV = more dispersed relative to the average.',
  'Anomalies': 'Items whose amount falls beyond the selected σ threshold from the mean, indicating they deviate significantly from the expected distribution.',
  'Std Dev': 'Standard deviation — measures how spread out values are from the mean. ~68% of data falls within ±1σ, ~95% within ±2σ.',
  'Mean': 'Arithmetic average of all values in the population.',
  'Median': 'Middle value when sorted — exactly half the population is above and half below. More robust to outliers than the mean.',
};

// ─── Statistical Helpers ─────────────────────────────────────────────────────

function calcMean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((s, v) => s + v, 0) / values.length;
}

function calcStdDev(values: number[], mean: number): number {
  if (values.length <= 1) return 0;
  return Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1));
}

function calcMedian(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function calcSkewness(values: number[], mean: number, sd: number): number {
  if (sd === 0 || values.length < 3) return 0;
  const n = values.length;
  const m3 = values.reduce((s, v) => s + ((v - mean) / sd) ** 3, 0) / n;
  return m3 * (n * (n - 1)) / ((n - 1) * (n - 2) || 1) || m3;
}

function calcKurtosis(values: number[], mean: number, sd: number): number {
  if (sd === 0 || values.length < 4) return 0;
  const n = values.length;
  return values.reduce((s, v) => s + ((v - mean) / sd) ** 4, 0) / n - 3;
}

function normalPDF(x: number, mu: number, sigma: number): number {
  if (sigma === 0) return x === mu ? 1 : 0;
  const z = (x - mu) / sigma;
  return Math.exp(-0.5 * z * z) / (sigma * Math.sqrt(2 * Math.PI));
}

function logNormalPDF(x: number, mu: number, sigma: number): number {
  if (x <= 0 || sigma === 0) return 0;
  const lnx = Math.log(x);
  const z = (lnx - mu) / sigma;
  return Math.exp(-0.5 * z * z) / (x * sigma * Math.sqrt(2 * Math.PI));
}

function exponentialPDF(x: number, lambda: number): number {
  if (x < 0 || lambda <= 0) return 0;
  return lambda * Math.exp(-lambda * x);
}

function uniformPDF(x: number, a: number, b: number): number {
  if (b <= a) return 0;
  return (x >= a && x <= b) ? 1 / (b - a) : 0;
}

// ─── Distribution Fitting ───────────────────────────────────────────────────

function fitDistributions(values: number[], binCount: number = 30): FittedDistribution[] {
  if (values.length < 5) return [];
  const sorted = [...values].sort((a, b) => a - b);
  const n = values.length;
  const mean = calcMean(values);
  const sd = calcStdDev(values, mean);
  const min = sorted[0];
  const max = sorted[n - 1];
  const skew = calcSkewness(values, mean, sd);
  const kurt = calcKurtosis(values, mean, sd);
  const range = max - min || 1;
  const binWidth = range / binCount;

  const observed = new Array(binCount).fill(0);
  for (const v of values) {
    const bi = Math.min(Math.floor((v - min) / binWidth), binCount - 1);
    observed[bi]++;
  }

  const curvePoints = 80;
  const xMin = min - range * 0.05;
  const xMax = max + range * 0.05;
  const xStep = (xMax - xMin) / curvePoints;
  const xs = Array.from({ length: curvePoints + 1 }, (_, i) => xMin + i * xStep);

  function goodnessOfFit(pdfFn: (x: number) => number): number {
    let chiSq = 0;
    let totalExpected = 0;
    for (let i = 0; i < binCount; i++) {
      const binCenter = min + (i + 0.5) * binWidth;
      const expected = pdfFn(binCenter) * binWidth * n;
      totalExpected += expected;
      if (expected > 0.5) chiSq += (observed[i] - expected) ** 2 / expected;
    }
    if (totalExpected === 0) return 0;
    return Math.max(0, 1 - chiSq / (binCount * 2));
  }

  const candidates: FittedDistribution[] = [];

  if (sd > 0) {
    candidates.push({
      type: 'normal', label: 'Normal', params: { mean, stdDev: sd },
      goodnessOfFit: goodnessOfFit(x => normalPDF(x, mean, sd)),
      curveData: xs.map(x => ({ x, y: normalPDF(x, mean, sd) * binWidth * n })),
    });
  }

  const positiveValues = values.filter(v => v > 0);
  if (positiveValues.length > n * 0.9) {
    const logValues = positiveValues.map(v => Math.log(v));
    const logMean = calcMean(logValues);
    const logSd = calcStdDev(logValues, logMean);
    if (logSd > 0) {
      candidates.push({
        type: 'log-normal', label: 'Log-Normal', params: { logMean, logStdDev: logSd },
        goodnessOfFit: goodnessOfFit(x => logNormalPDF(x, logMean, logSd)),
        curveData: xs.filter(x => x > 0).map(x => ({ x, y: logNormalPDF(x, logMean, logSd) * binWidth * n })),
      });
    }
  }

  if (min >= 0 && mean > 0 && skew > 0.5) {
    const lambda = 1 / mean;
    candidates.push({
      type: 'exponential', label: 'Exponential', params: { rate: lambda },
      goodnessOfFit: goodnessOfFit(x => exponentialPDF(x, lambda)),
      curveData: xs.filter(x => x >= 0).map(x => ({ x, y: exponentialPDF(x, lambda) * binWidth * n })),
    });
  }

  candidates.push({
    type: 'uniform', label: 'Uniform', params: { min, max },
    goodnessOfFit: goodnessOfFit(x => uniformPDF(x, min, max)),
    curveData: xs.map(x => ({ x, y: uniformPDF(x, min, max) * binWidth * n })),
  });

  if (kurt < -1 || (Math.abs(skew) < 0.3 && sd > mean * 0.5 && kurt < 0)) {
    candidates.push({ type: 'multimodal', label: 'Multimodal', params: { skewness: skew, kurtosis: kurt }, goodnessOfFit: 0.3, curveData: [] });
  }

  candidates.sort((a, b) => b.goodnessOfFit - a.goodnessOfFit);
  return candidates;
}

// ─── Info Tooltip ────────────────────────────────────────────────────────────

function InfoTooltip({ text }: { text: string }) {
  return (
    <span className="relative group inline-block ml-1 align-middle">
      <Info className="h-3 w-3 text-slate-400 cursor-help" />
      <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 hidden group-hover:block w-56 p-2 bg-slate-800 text-white text-[10px] leading-relaxed rounded-lg shadow-lg z-50 pointer-events-none">
        {text}
      </span>
    </span>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function DistributionAnalysisModal({
  open, onClose, fullPopulationData, selectedIndices, amountColumn,
  stratificationResults, itemProfiles, currency, onSelectAnomalies,
}: Props) {
  const [activeTab, setActiveTab] = useState<TabKey>('histogram');
  const [sigmaThreshold, setSigmaThreshold] = useState(2);
  const [selectionMode, setSelectionMode] = useState(false);
  const [manuallySelected, setManuallySelected] = useState<Set<number>>(new Set());

  const hasSample = selectedIndices.size > 0;
  const hasStrata = !!stratificationResults && stratificationResults.strata.length > 0;
  const hasRisk = !!itemProfiles && itemProfiles.length > 0;

  const amounts = useMemo(() =>
    fullPopulationData.map(row => parseFloat(String(row[amountColumn] || 0)) || 0),
    [fullPopulationData, amountColumn],
  );

  // ─── Anomaly detection with adjustable σ threshold ─────────────────────
  const scatterAnalysis = useMemo(() => {
    const mean = calcMean(amounts);
    const sd = calcStdDev(amounts, mean);

    const normalPoints: { x: number; y: number; idx: number }[] = [];
    const samplePoints: { x: number; y: number; idx: number }[] = [];
    const anomalyPoints: { x: number; y: number; idx: number }[] = [];
    const anomalyIndices: number[] = [];

    amounts.forEach((val, i) => {
      const zScore = sd > 0 ? Math.abs((val - mean) / sd) : 0;
      const isAnomaly = zScore > sigmaThreshold;
      const isSample = selectedIndices.has(i);
      const jitterY = (i % 20) / 20 + Math.sin(i * 0.7) * 0.3;

      if (isAnomaly) {
        anomalyPoints.push({ x: val, y: jitterY, idx: i });
        anomalyIndices.push(i);
      } else if (isSample) {
        samplePoints.push({ x: val, y: jitterY, idx: i });
      } else {
        normalPoints.push({ x: val, y: jitterY, idx: i });
      }
    });

    return { normalPoints, samplePoints, anomalyPoints, anomalyIndices, anomalyCount: anomalyPoints.length };
  }, [amounts, selectedIndices, sigmaThreshold]);

  // ─── Handle clicking an anomaly point ─────────────────────────────────
  const handleScatterClick = useCallback((data: { idx?: number }) => {
    if (!selectionMode || data?.idx == null) return;
    setManuallySelected(prev => {
      const next = new Set(prev);
      next.has(data.idx!) ? next.delete(data.idx!) : next.add(data.idx!);
      return next;
    });
  }, [selectionMode]);

  const handleSelectAllAnomalies = useCallback(() => {
    setManuallySelected(new Set(scatterAnalysis.anomalyIndices));
  }, [scatterAnalysis.anomalyIndices]);

  const handleApplySelection = useCallback(() => {
    if (onSelectAnomalies && manuallySelected.size > 0) {
      onSelectAnomalies(manuallySelected);
      onClose();
    }
  }, [onSelectAnomalies, manuallySelected, onClose]);

  // ─── Distribution fitting ─────────────────────────────────────────────
  const distributions = useMemo(() => fitDistributions(amounts), [amounts]);
  const bestFit = distributions[0] || null;

  // ─── Histogram bins ───────────────────────────────────────────────────
  const histogramData = useMemo(() => {
    if (amounts.length === 0) return [];
    const sorted = [...amounts].sort((a, b) => a - b);
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const range = max - min || 1;
    // Use Freedman-Diaconis rule for bin count — better for skewed data
    const iqr = sorted[Math.floor(sorted.length * 0.75)] - sorted[Math.floor(sorted.length * 0.25)];
    const fdBinWidth = iqr > 0 ? 2 * iqr / Math.cbrt(sorted.length) : range / 15;
    const binCount = Math.max(8, Math.min(40, Math.ceil(range / fdBinWidth)));
    const binWidth = range / binCount;
    const bins = Array.from({ length: binCount }, (_, i) => ({
      binCenter: min + (i + 0.5) * binWidth,
      label: (min + i * binWidth).toFixed(0),
      population: 0,
      sample: 0,
    }));
    for (let i = 0; i < amounts.length; i++) {
      const bi = Math.min(Math.floor((amounts[i] - min) / binWidth), binCount - 1);
      bins[bi].population++;
      if (selectedIndices.has(i)) bins[bi].sample++;
    }
    return bins;
  }, [amounts, selectedIndices]);

  const composedData = useMemo(() => {
    if (histogramData.length === 0) return [];
    return histogramData.map(bin => {
      const curvePoint = bestFit?.curveData.reduce((closest, p) =>
        Math.abs(p.x - bin.binCenter) < Math.abs(closest.x - bin.binCenter) ? p : closest,
        bestFit.curveData[0],
      );
      return { ...bin, fitted: curvePoint ? Math.max(0, curvePoint.y) : 0 };
    });
  }, [histogramData, bestFit]);

  // ─── Strata + risk data ───────────────────────────────────────────────
  const strataItemData = useMemo(() => !hasStrata ? [] : stratificationResults!.strata.map(s => ({ name: s.name, value: s.itemCount, level: s.level })), [stratificationResults, hasStrata]);
  const strataValueData = useMemo(() => !hasStrata ? [] : stratificationResults!.strata.map(s => ({ name: s.name, value: Math.round(s.totalValue), level: s.level })), [stratificationResults, hasStrata]);
  const riskHistData = useMemo(() => {
    if (!hasRisk) return [];
    const binCount = 20;
    const bins = Array.from({ length: binCount }, (_, i) => ({ range: (i / binCount).toFixed(2), high: 0, medium: 0, low: 0 }));
    for (const ip of itemProfiles!) { const bi = Math.min(Math.floor(ip.riskScore * binCount), binCount - 1); bins[bi][ip.stratum]++; }
    return bins;
  }, [itemProfiles, hasRisk]);

  const stats = useMemo(() => {
    const sorted = [...amounts].sort((a, b) => a - b);
    const total = amounts.reduce((s, v) => s + v, 0);
    const mean = amounts.length > 0 ? total / amounts.length : 0;
    const sd = calcStdDev(amounts, mean);
    const sampleAmounts = hasSample ? amounts.filter((_, i) => selectedIndices.has(i)) : [];
    const sampleTotal = sampleAmounts.reduce((s, v) => s + v, 0);
    return {
      population: { count: amounts.length, total, mean, median: calcMedian(sorted), stdDev: sd, skewness: calcSkewness(amounts, mean, sd), kurtosis: calcKurtosis(amounts, mean, sd), min: sorted[0] ?? 0, max: sorted[sorted.length - 1] ?? 0 },
      sample: hasSample ? { count: sampleAmounts.length, total: sampleTotal, mean: sampleAmounts.length > 0 ? sampleTotal / sampleAmounts.length : 0, coverage: total > 0 ? (sampleTotal / total * 100) : 0 } : null,
    };
  }, [amounts, selectedIndices, hasSample]);

  if (!open) return null;

  const fmt = (n: number) => `${currency} ${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  const fmtPct = (n: number) => `${n.toFixed(1)}%`;
  const fmtAxis = (v: number) => v >= 1000000 ? `${(v/1000000).toFixed(1)}M` : v >= 1000 ? `${(v/1000).toFixed(0)}k` : v.toFixed(0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-4xl mx-4 max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
          <h3 className="text-base font-semibold text-slate-900">Distribution Analysis</h3>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600"><X className="h-5 w-5" /></button>
        </div>

        {/* Tabs */}
        <div className="px-5 pt-3 flex gap-1 border-b border-slate-100 shrink-0">
          {TABS.map(tab => {
            const disabled = (tab.key === 'strata' && !hasStrata) || (tab.key === 'risk' && !hasRisk);
            return (
              <button key={tab.key} onClick={() => !disabled && setActiveTab(tab.key)} disabled={disabled}
                className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-t-md transition-colors ${
                  activeTab === tab.key ? 'bg-slate-50 text-slate-900 border-b-2 border-blue-600'
                  : disabled ? 'text-slate-300 cursor-not-allowed' : 'text-slate-500 hover:text-slate-700'}`}>
                <tab.icon className="h-3.5 w-3.5" />{tab.label}
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div className="px-5 py-4 overflow-y-auto flex-1">

          {/* ── Distribution Tab ────────────────────────────────────────── */}
          {activeTab === 'histogram' && (
            <div className="space-y-4">
              {/* Controls bar */}
              <div className="flex items-center gap-4 flex-wrap">
                {bestFit && (
                  <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium" style={{ backgroundColor: `${DIST_COLORS[bestFit.type]}15`, color: DIST_COLORS[bestFit.type] }}>
                    Best fit: {bestFit.label} ({(bestFit.goodnessOfFit * 100).toFixed(0)}%)
                  </div>
                )}
                {scatterAnalysis.anomalyCount > 0 && (
                  <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-red-50 text-red-600">
                    {scatterAnalysis.anomalyCount} anomalies (&gt;{sigmaThreshold}σ)
                  </div>
                )}
                {distributions.slice(1, 3).map(d => (
                  <span key={d.type} className="text-[10px] text-slate-400">{d.label}: {(d.goodnessOfFit * 100).toFixed(0)}%</span>
                ))}
              </div>

              {/* σ threshold slider + selection controls */}
              <div className="flex items-center gap-4 bg-slate-50 rounded-lg p-3">
                <div className="flex items-center gap-2 flex-1">
                  <label className="text-xs font-medium text-slate-600 whitespace-nowrap">Anomaly threshold:</label>
                  <input type="range" min={1} max={4} step={0.1} value={sigmaThreshold}
                    onChange={e => setSigmaThreshold(parseFloat(e.target.value))}
                    className="flex-1 h-1.5 accent-red-500" />
                  <span className="text-xs font-mono text-red-600 w-10">{sigmaThreshold.toFixed(1)}σ</span>
                </div>
                <div className="border-l border-slate-200 pl-4 flex items-center gap-2">
                  <button onClick={() => setSelectionMode(!selectionMode)}
                    className={`inline-flex items-center gap-1 px-2.5 py-1 text-[10px] font-medium rounded-md transition-colors ${
                      selectionMode ? 'bg-blue-600 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'}`}>
                    <MousePointer2 className="h-3 w-3" />{selectionMode ? 'Selection ON' : 'Select'}
                  </button>
                  <button onClick={handleSelectAllAnomalies} disabled={scatterAnalysis.anomalyCount === 0}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-[10px] font-medium rounded-md bg-white border border-slate-200 text-slate-600 hover:bg-slate-100 disabled:opacity-40">
                    <CheckSquare className="h-3 w-3" />Select All Red
                  </button>
                  {manuallySelected.size > 0 && (
                    <span className="text-[10px] text-blue-600 font-medium">{manuallySelected.size} selected</span>
                  )}
                </div>
              </div>

              {/* Scatter: x=amount, anomalies in red, clickable in selection mode */}
              <div>
                <p className="text-xs text-slate-500 mb-2">
                  Each transaction by amount. <span className="text-red-500 font-medium">Red</span> = anomaly (&gt;{sigmaThreshold.toFixed(1)}σ).
                  {selectionMode && ' Click points to select for sampling.'}
                </p>
                <ResponsiveContainer width="100%" height={260}>
                  <ComposedChart margin={{ top: 10, right: 20, bottom: 5, left: 10 }} data={[]}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis type="number" dataKey="x" tick={{ fontSize: 9 }} domain={['auto', 'auto']}
                      tickFormatter={fmtAxis}
                      label={{ value: `Amount (${currency})`, position: 'insideBottom', offset: -3, fontSize: 10 }} />
                    <YAxis type="number" dataKey="y" tick={false} axisLine={false} domain={[-0.5, 1.5]} hide />
                    <Tooltip formatter={(value) => [fmt(Number(value)), 'Amount']} />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    <Scatter data={scatterAnalysis.normalPoints} dataKey="y" fill="#94a3b8" name="Normal" r={2} opacity={0.4}
                      cursor={selectionMode ? 'pointer' : 'default'}
                      onClick={selectionMode ? ((point: /* eslint-disable-line @typescript-eslint/no-explicit-any */ any) => handleScatterClick({ idx: point?.idx as number })) : undefined} />
                    {hasSample && <Scatter data={scatterAnalysis.samplePoints} dataKey="y" fill="#22c55e" name="Sampled" r={3} opacity={0.7} />}
                    <Scatter data={scatterAnalysis.anomalyPoints} dataKey="y" fill="#ef4444" name={`Anomaly (>${sigmaThreshold.toFixed(1)}σ)`} r={4} opacity={0.9}
                      cursor={selectionMode ? 'pointer' : 'default'}
                      onClick={selectionMode ? ((point: /* eslint-disable-line @typescript-eslint/no-explicit-any */ any) => handleScatterClick({ idx: point?.idx as number })) : undefined} />
                    {/* Show manually selected points as blue overlay */}
                    {manuallySelected.size > 0 && (
                      <Scatter data={[...manuallySelected].map(origIdx => ({
                        x: amounts[origIdx] ?? 0,
                        y: (origIdx % 20) / 20 + Math.sin(origIdx * 0.7) * 0.3,
                      }))} dataKey="y" fill="#3b82f6" name="Selected" r={5} opacity={0.9} />
                    )}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>

              {/* Histogram with distribution curve overlay */}
              <div>
                <p className="text-xs text-slate-500 mb-2">
                  Frequency histogram with {bestFit?.label || 'fitted'} distribution overlay.
                </p>
                <ResponsiveContainer width="100%" height={220}>
                  <ComposedChart data={composedData} barGap={0} barCategoryGap="5%" margin={{ bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="label" tick={{ fontSize: 8 }} angle={-45} textAnchor="end" height={50} tickFormatter={fmtAxis} />
                    <YAxis tick={{ fontSize: 9 }} label={{ value: 'Count', angle: -90, position: 'insideLeft', fontSize: 10 }} />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    <Bar dataKey="population" fill="#94a3b8" name="Population" radius={[3, 3, 0, 0]} />
                    {hasSample && <Bar dataKey="sample" fill="#22c55e" name="Sample" radius={[3, 3, 0, 0]} />}
                    {bestFit && bestFit.curveData.length > 0 && (
                      <Line dataKey="fitted" stroke={DIST_COLORS[bestFit.type]} strokeWidth={2.5} dot={false} name={`${bestFit.label} fit`} type="monotone" />
                    )}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>

              {/* Stats with info tooltips */}
              <div className="grid grid-cols-5 gap-2">
                {[
                  { label: 'Skewness', value: stats.population.skewness.toFixed(3), desc: stats.population.skewness > 0.5 ? 'Right-skewed' : stats.population.skewness < -0.5 ? 'Left-skewed' : 'Symmetric' },
                  { label: 'Kurtosis', value: stats.population.kurtosis.toFixed(3), desc: stats.population.kurtosis > 1 ? 'Heavy-tailed' : stats.population.kurtosis < -1 ? 'Light-tailed' : 'Mesokurtic' },
                  { label: 'Range', value: fmt(stats.population.max - stats.population.min), desc: '' },
                  { label: 'CV', value: stats.population.mean !== 0 ? `${((stats.population.stdDev / Math.abs(stats.population.mean)) * 100).toFixed(1)}%` : '—', desc: '' },
                  { label: 'Anomalies', value: `${scatterAnalysis.anomalyCount}`, desc: `of ${amounts.length}` },
                ].map(s => (
                  <div key={s.label} className="bg-slate-50 rounded-lg p-2">
                    <div className="text-[10px] text-slate-500">
                      {s.label}
                      {STAT_TOOLTIPS[s.label] && <InfoTooltip text={STAT_TOOLTIPS[s.label]} />}
                    </div>
                    <div className="text-xs font-medium text-slate-800">{s.value}</div>
                    {s.desc && <div className="text-[9px] text-slate-400">{s.desc}</div>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Strata Tab ─────────────────────────────────────────────── */}
          {activeTab === 'strata' && hasStrata && (
            <div>
              <p className="text-xs text-slate-500 mb-3">Strata composition by item count and total value.</p>
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <h4 className="text-xs font-semibold text-slate-600 text-center mb-2">Items by Stratum</h4>
                  <ResponsiveContainer width="100%" height={240}>
                    <PieChart><Pie data={strataItemData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={90}
                      label={(props: PieLabelRenderProps) => `${props.name} ${((props.percent as number) * 100).toFixed(0)}%`} labelLine={false} fontSize={10}>
                      {strataItemData.map((d, i) => <Cell key={i} fill={STRATA_COLORS[d.level] || '#94a3b8'} />)}
                    </Pie><Tooltip formatter={(value) => [String(value), 'Items']} /></PieChart>
                  </ResponsiveContainer>
                </div>
                <div>
                  <h4 className="text-xs font-semibold text-slate-600 text-center mb-2">Value by Stratum</h4>
                  <ResponsiveContainer width="100%" height={240}>
                    <PieChart><Pie data={strataValueData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={90}
                      label={(props: PieLabelRenderProps) => `${props.name} ${((props.percent as number) * 100).toFixed(0)}%`} labelLine={false} fontSize={10}>
                      {strataValueData.map((d, i) => <Cell key={i} fill={STRATA_COLORS[d.level] || '#94a3b8'} />)}
                    </Pie><Tooltip formatter={(value) => [fmt(Number(value)), 'Value']} /></PieChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <table className="w-full text-xs mt-4">
                <thead><tr className="border-b border-slate-200 text-slate-500"><th className="py-1.5 text-left">Stratum</th><th className="py-1.5 text-right">Items</th><th className="py-1.5 text-right">Sampled</th><th className="py-1.5 text-right">Value</th><th className="py-1.5 text-left pl-3">Top Drivers</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {stratificationResults!.strata.map(s => (
                    <tr key={s.level}><td className="py-1.5 font-medium" style={{ color: STRATA_COLORS[s.level] }}>{s.name}</td><td className="py-1.5 text-right">{s.itemCount}</td><td className="py-1.5 text-right">{s.sampleSize}</td><td className="py-1.5 text-right">{fmt(s.totalValue)}</td><td className="py-1.5 pl-3 text-slate-500">{s.topDrivers.map(d => d.feature).join(', ') || '—'}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Risk Score Tab ─────────────────────────────────────────── */}
          {activeTab === 'risk' && hasRisk && (
            <div>
              <p className="text-xs text-slate-500 mb-3">Risk score distribution coloured by stratum.</p>
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={riskHistData} barGap={0} barCategoryGap={1}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="range" tick={{ fontSize: 10 }} label={{ value: 'Risk Score', position: 'insideBottom', offset: -5, fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} /><Tooltip /><Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="high" stackId="risk" fill={STRATA_COLORS.high} name="High Risk" />
                  <Bar dataKey="medium" stackId="risk" fill={STRATA_COLORS.medium} name="Medium Risk" />
                  <Bar dataKey="low" stackId="risk" fill={STRATA_COLORS.low} name="Low Risk" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* ── Statistics Tab ─────────────────────────────────────────── */}
          {activeTab === 'stats' && (
            <div className="space-y-4">
              <div>
                <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Population</h4>
                <div className="grid grid-cols-4 gap-3">
                  {[
                    { label: 'Records', value: stats.population.count.toLocaleString() },
                    { label: 'Total Value', value: fmt(stats.population.total) },
                    { label: 'Mean', value: fmt(stats.population.mean) },
                    { label: 'Median', value: fmt(stats.population.median) },
                    { label: 'Std Dev', value: fmt(stats.population.stdDev) },
                    { label: 'Min', value: fmt(stats.population.min) },
                    { label: 'Max', value: fmt(stats.population.max) },
                    { label: 'Skewness', value: stats.population.skewness.toFixed(3) },
                  ].map(s => (
                    <div key={s.label} className="bg-slate-50 rounded-lg p-2.5">
                      <div className="text-[10px] text-slate-500">{s.label}{STAT_TOOLTIPS[s.label] && <InfoTooltip text={STAT_TOOLTIPS[s.label]} />}</div>
                      <div className="text-sm font-medium text-slate-800">{s.value}</div>
                    </div>
                  ))}
                </div>
              </div>
              {stats.sample && (
                <div>
                  <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Sample</h4>
                  <div className="grid grid-cols-4 gap-3">
                    {[{ label: 'Items Selected', value: stats.sample.count.toLocaleString() }, { label: 'Sample Value', value: fmt(stats.sample.total) }, { label: 'Sample Mean', value: fmt(stats.sample.mean) }, { label: 'Coverage', value: fmtPct(stats.sample.coverage) }].map(s => (
                      <div key={s.label} className="bg-green-50 rounded-lg p-2.5"><div className="text-[10px] text-green-600">{s.label}</div><div className="text-sm font-medium text-green-800">{s.value}</div></div>
                    ))}
                  </div>
                </div>
              )}
              {hasStrata && (
                <div>
                  <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Stratification</h4>
                  <div className="space-y-2">
                    {stratificationResults!.strata.map(s => (
                      <div key={s.level} className={`p-2.5 rounded-lg text-xs ${s.level === 'high' ? 'bg-red-50 text-red-700' : s.level === 'medium' ? 'bg-amber-50 text-amber-700' : 'bg-green-50 text-green-700'}`}>
                        <div className="flex justify-between"><strong>{s.name}</strong><span>{s.sampleSize}/{s.itemCount} ({s.itemCount > 0 ? ((s.sampleSize / s.itemCount) * 100).toFixed(0) : 0}%)</span></div>
                        <div className="text-[10px] opacity-75 mt-0.5">Value: {fmt(s.totalValue)}{s.topDrivers.length > 0 && ` · ${s.topDrivers.map(d => d.feature).join(', ')}`}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {bestFit && (
                <div>
                  <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Distribution Identification</h4>
                  <div className="space-y-1.5">
                    {distributions.slice(0, 4).map((d, i) => (
                      <div key={d.type} className={`flex items-center gap-2 text-xs ${i === 0 ? 'font-medium' : 'text-slate-500'}`}>
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: DIST_COLORS[d.type] }} />
                        <span className="w-24">{d.label}</span>
                        <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden"><div className="h-full rounded-full" style={{ width: `${d.goodnessOfFit * 100}%`, backgroundColor: DIST_COLORS[d.type] }} /></div>
                        <span className="w-10 text-right">{(d.goodnessOfFit * 100).toFixed(0)}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer with Apply */}
        <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-between shrink-0">
          <div className="text-xs text-slate-400">
            {manuallySelected.size > 0 && `${manuallySelected.size} anomalies selected for sampling`}
          </div>
          <div className="flex gap-2">
            {manuallySelected.size > 0 && onSelectAnomalies && (
              <button onClick={handleApplySelection}
                className="px-4 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors">
                Apply Selection ({manuallySelected.size} items)
              </button>
            )}
            <button onClick={onClose} className="px-4 py-1.5 text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors">
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
