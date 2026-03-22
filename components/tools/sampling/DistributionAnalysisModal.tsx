'use client';

import { useState, useMemo } from 'react';
import { X, BarChart3, PieChart as PieChartIcon, Activity, Table2 } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
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
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const STRATA_COLORS: Record<string, string> = {
  high: '#ef4444',   // red-500
  medium: '#f59e0b', // amber-500
  low: '#22c55e',    // green-500
};

const TABS = [
  { key: 'histogram', label: 'Distribution', icon: BarChart3 },
  { key: 'strata', label: 'Strata', icon: PieChartIcon },
  { key: 'risk', label: 'Risk Scores', icon: Activity },
  { key: 'stats', label: 'Statistics', icon: Table2 },
] as const;

type TabKey = (typeof TABS)[number]['key'];

function computeHistogramBins(values: number[], binCount: number = 20) {
  if (values.length === 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) return [{ range: `${min.toFixed(0)}`, min, max: min, population: values.length, sample: 0 }];
  const binWidth = (max - min) / binCount;
  const bins = Array.from({ length: binCount }, (_, i) => ({
    range: `${(min + i * binWidth).toFixed(0)}`,
    min: min + i * binWidth,
    max: min + (i + 1) * binWidth,
    population: 0,
    sample: 0,
  }));
  return bins;
}

function assignToBin(value: number, bins: { min: number; max: number }[]) {
  for (let i = 0; i < bins.length; i++) {
    if (value >= bins[i].min && (value < bins[i].max || i === bins.length - 1)) return i;
  }
  return bins.length - 1;
}

function median(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function stdDev(values: number[], mean: number): number {
  if (values.length <= 1) return 0;
  return Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1));
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function DistributionAnalysisModal({
  open, onClose, fullPopulationData, selectedIndices, amountColumn,
  stratificationResults, itemProfiles, currency,
}: Props) {
  const [activeTab, setActiveTab] = useState<TabKey>('histogram');

  const hasSample = selectedIndices.size > 0;
  const hasStrata = !!stratificationResults && stratificationResults.strata.length > 0;
  const hasRisk = !!itemProfiles && itemProfiles.length > 0;

  // ─── Amount values ─────────────────────────────────────────────────────
  const amounts = useMemo(() =>
    fullPopulationData.map(row => parseFloat(String(row[amountColumn] || 0)) || 0),
    [fullPopulationData, amountColumn],
  );

  // ─── Histogram data ───────────────────────────────────────────────────
  const histogramData = useMemo(() => {
    const bins = computeHistogramBins(amounts);
    amounts.forEach((val, idx) => {
      const bi = assignToBin(val, bins);
      bins[bi].population++;
      if (selectedIndices.has(idx)) bins[bi].sample++;
    });
    return bins;
  }, [amounts, selectedIndices]);

  // ─── Strata pie data ──────────────────────────────────────────────────
  const strataItemData = useMemo(() => {
    if (!hasStrata) return [];
    return stratificationResults!.strata.map(s => ({
      name: s.name, value: s.itemCount, level: s.level,
    }));
  }, [stratificationResults, hasStrata]);

  const strataValueData = useMemo(() => {
    if (!hasStrata) return [];
    return stratificationResults!.strata.map(s => ({
      name: s.name, value: Math.round(s.totalValue), level: s.level,
    }));
  }, [stratificationResults, hasStrata]);

  // ─── Risk score histogram ─────────────────────────────────────────────
  const riskHistData = useMemo(() => {
    if (!hasRisk) return [];
    const binCount = 20;
    const bins = Array.from({ length: binCount }, (_, i) => ({
      range: (i / binCount).toFixed(2),
      min: i / binCount,
      max: (i + 1) / binCount,
      high: 0, medium: 0, low: 0,
    }));
    for (const ip of itemProfiles!) {
      const bi = Math.min(Math.floor(ip.riskScore * binCount), binCount - 1);
      bins[bi][ip.stratum]++;
    }
    return bins;
  }, [itemProfiles, hasRisk]);

  // ─── Statistics ────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const sorted = [...amounts].sort((a, b) => a - b);
    const total = amounts.reduce((s, v) => s + v, 0);
    const mean = amounts.length > 0 ? total / amounts.length : 0;

    const sampleAmounts = hasSample
      ? amounts.filter((_, i) => selectedIndices.has(i))
      : [];
    const sampleTotal = sampleAmounts.reduce((s, v) => s + v, 0);
    const sampleMean = sampleAmounts.length > 0 ? sampleTotal / sampleAmounts.length : 0;

    return {
      population: {
        count: amounts.length,
        total,
        mean,
        median: median(sorted),
        stdDev: stdDev(amounts, mean),
        min: sorted[0] ?? 0,
        max: sorted[sorted.length - 1] ?? 0,
      },
      sample: hasSample ? {
        count: sampleAmounts.length,
        total: sampleTotal,
        mean: sampleMean,
        coverage: total > 0 ? (sampleTotal / total * 100) : 0,
      } : null,
    };
  }, [amounts, selectedIndices, hasSample]);

  if (!open) return null;

  // ─── Custom tooltip ────────────────────────────────────────────────────
  const HistTooltip = ({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string }) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="bg-white border border-slate-200 rounded-lg p-2 shadow-lg text-xs">
        <p className="font-medium text-slate-700 mb-1">{currency} {label}</p>
        {payload.map((p, i) => (
          <p key={i} style={{ color: p.color }}>{p.name}: {p.value}</p>
        ))}
      </div>
    );
  };

  const fmt = (n: number) => `${currency} ${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  const fmtPct = (n: number) => `${n.toFixed(1)}%`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-3xl mx-4 max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
          <h3 className="text-base font-semibold text-slate-900">Distribution Analysis</h3>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="px-5 pt-3 flex gap-1 border-b border-slate-100 shrink-0">
          {TABS.map(tab => {
            const disabled = (tab.key === 'strata' && !hasStrata) || (tab.key === 'risk' && !hasRisk);
            return (
              <button
                key={tab.key}
                onClick={() => !disabled && setActiveTab(tab.key)}
                disabled={disabled}
                className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-t-md transition-colors ${
                  activeTab === tab.key
                    ? 'bg-slate-50 text-slate-900 border-b-2 border-blue-600'
                    : disabled
                      ? 'text-slate-300 cursor-not-allowed'
                      : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                <tab.icon className="h-3.5 w-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div className="px-5 py-4 overflow-y-auto flex-1">

          {/* ── Histogram Tab ──────────────────────────────────────────── */}
          {activeTab === 'histogram' && (
            <div>
              <p className="text-xs text-slate-500 mb-3">
                Amount distribution across the population{hasSample ? ' (green = sampled items)' : ''}.
              </p>
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={histogramData} barGap={0} barCategoryGap={1}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="range" tick={{ fontSize: 10 }} angle={-45} textAnchor="end" height={60} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip content={<HistTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="population" fill="#94a3b8" name="Population" radius={[2, 2, 0, 0]} />
                  {hasSample && (
                    <Bar dataKey="sample" fill="#22c55e" name="Sample" radius={[2, 2, 0, 0]} />
                  )}
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* ── Strata Tab ─────────────────────────────────────────────── */}
          {activeTab === 'strata' && hasStrata && (
            <div>
              <p className="text-xs text-slate-500 mb-3">Strata composition by item count and total value.</p>
              <div className="grid grid-cols-2 gap-6">
                {/* Items pie */}
                <div>
                  <h4 className="text-xs font-semibold text-slate-600 text-center mb-2">Items by Stratum</h4>
                  <ResponsiveContainer width="100%" height={240}>
                    <PieChart>
                      <Pie
                        data={strataItemData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%" cy="50%"
                        innerRadius={50} outerRadius={90}
                        label={(props: PieLabelRenderProps) => `${props.name} ${((props.percent as number) * 100).toFixed(0)}%`}
                        labelLine={false}
                        fontSize={10}
                      >
                        {strataItemData.map((d, i) => (
                          <Cell key={i} fill={STRATA_COLORS[d.level] || '#94a3b8'} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value) => [String(value), 'Items']} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                {/* Value pie */}
                <div>
                  <h4 className="text-xs font-semibold text-slate-600 text-center mb-2">Value by Stratum</h4>
                  <ResponsiveContainer width="100%" height={240}>
                    <PieChart>
                      <Pie
                        data={strataValueData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%" cy="50%"
                        innerRadius={50} outerRadius={90}
                        label={(props: PieLabelRenderProps) => `${props.name} ${((props.percent as number) * 100).toFixed(0)}%`}
                        labelLine={false}
                        fontSize={10}
                      >
                        {strataValueData.map((d, i) => (
                          <Cell key={i} fill={STRATA_COLORS[d.level] || '#94a3b8'} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value) => [fmt(Number(value)), 'Value']} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>
              {/* Strata table */}
              <table className="w-full text-xs mt-4">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="py-1.5 text-left">Stratum</th>
                    <th className="py-1.5 text-right">Items</th>
                    <th className="py-1.5 text-right">Sampled</th>
                    <th className="py-1.5 text-right">Value</th>
                    <th className="py-1.5 text-left pl-3">Top Drivers</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {stratificationResults!.strata.map(s => (
                    <tr key={s.level}>
                      <td className="py-1.5 font-medium" style={{ color: STRATA_COLORS[s.level] }}>{s.name}</td>
                      <td className="py-1.5 text-right">{s.itemCount}</td>
                      <td className="py-1.5 text-right">{s.sampleSize}</td>
                      <td className="py-1.5 text-right">{fmt(s.totalValue)}</td>
                      <td className="py-1.5 pl-3 text-slate-500">{s.topDrivers.map(d => d.feature).join(', ') || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Risk Score Tab ─────────────────────────────────────────── */}
          {activeTab === 'risk' && hasRisk && (
            <div>
              <p className="text-xs text-slate-500 mb-3">
                Risk score distribution across the population, coloured by assigned stratum.
              </p>
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={riskHistData} barGap={0} barCategoryGap={1} stackOffset="none">
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="range" tick={{ fontSize: 10 }} label={{ value: 'Risk Score', position: 'insideBottom', offset: -5, fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} label={{ value: 'Count', angle: -90, position: 'insideLeft', fontSize: 10 }} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
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
              {/* Population stats */}
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
                  ].map(s => (
                    <div key={s.label} className="bg-slate-50 rounded-lg p-2.5">
                      <div className="text-[10px] text-slate-500">{s.label}</div>
                      <div className="text-sm font-medium text-slate-800">{s.value}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Sample stats */}
              {stats.sample && (
                <div>
                  <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Sample</h4>
                  <div className="grid grid-cols-4 gap-3">
                    {[
                      { label: 'Items Selected', value: stats.sample.count.toLocaleString() },
                      { label: 'Sample Value', value: fmt(stats.sample.total) },
                      { label: 'Sample Mean', value: fmt(stats.sample.mean) },
                      { label: 'Coverage', value: fmtPct(stats.sample.coverage) },
                    ].map(s => (
                      <div key={s.label} className="bg-green-50 rounded-lg p-2.5">
                        <div className="text-[10px] text-green-600">{s.label}</div>
                        <div className="text-sm font-medium text-green-800">{s.value}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Strata stats */}
              {hasStrata && (
                <div>
                  <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Stratification</h4>
                  <div className="space-y-2">
                    {stratificationResults!.strata.map(s => (
                      <div key={s.level} className={`p-2.5 rounded-lg text-xs ${
                        s.level === 'high' ? 'bg-red-50 text-red-700'
                        : s.level === 'medium' ? 'bg-amber-50 text-amber-700'
                        : 'bg-green-50 text-green-700'
                      }`}>
                        <div className="flex justify-between">
                          <strong>{s.name}</strong>
                          <span>{s.sampleSize}/{s.itemCount} sampled ({s.itemCount > 0 ? ((s.sampleSize / s.itemCount) * 100).toFixed(0) : 0}%)</span>
                        </div>
                        <div className="text-[10px] opacity-75 mt-0.5">
                          Value: {fmt(s.totalValue)}
                          {s.topDrivers.length > 0 && ` · Drivers: ${s.topDrivers.map(d => d.feature).join(', ')}`}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-100 flex justify-end shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
