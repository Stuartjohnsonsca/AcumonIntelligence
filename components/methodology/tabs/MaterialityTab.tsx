'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAutoSave } from '@/hooks/useAutoSave';
import { MATERIALITY_BENCHMARKS, MATERIALITY_RANGES } from '@/types/methodology';

interface Props {
  engagementId: string;
}

type FormValues = Record<string, string | number | boolean | null>;

const OM_FACTORS = [
  'Is the company is a public limited entity? Is it listed?',
  'Exposure to borrowing facilities',
  'Minimal number of share holders',
  'Nature of Business (Highly regulated/Minimally regulated)',
  'Intention to get listed in the near future(3 years)',
  'Changes in the nature of business',
] as const;

const PM_FACTORS = [
  'Deficiencies in internal controls (Number and severity of deficiencies in control activities)',
  'First/second/third year audit by Firm',
  'Report of fraud or higher risk of fraud within the entity',
  'History of misstatements (corrected and uncorrected)',
  'Level of turnover of senior management or key financial reporting personnel',
  "Management's preparedness/willingness to correct misstatements",
  'Competency of management',
  'Complexity of IT environment',
] as const;

const OM_RANGE_OPTIONS = ['Low', 'Mid', 'High'] as const;
const PM_RANGE_OPTIONS = ['Low (50%)', 'Moderate (65%)', 'High (75%)'] as const;

export function MaterialityTab({ engagementId }: Props) {
  const [values, setValues] = useState<FormValues>({});
  const [loading, setLoading] = useState(true);
  const [initialValues, setInitialValues] = useState<FormValues>({});

  const { saving, lastSaved, error } = useAutoSave(
    `/api/engagements/${engagementId}/materiality`,
    { data: values },
    { enabled: JSON.stringify(values) !== JSON.stringify(initialValues) }
  );

  const loadData = useCallback(async () => {
    try {
      const res = await fetch(`/api/engagements/${engagementId}/materiality`);
      if (res.ok) { const json = await res.json(); const d = (json.data || {}) as FormValues; setValues(d); setInitialValues(d); }
    } catch (err) { console.error('Failed to load:', err); }
    finally { setLoading(false); }
  }, [engagementId]);

  useEffect(() => { loadData(); }, [loadData]);

  function v(key: string) { return values[key] ?? ''; }
  function set(key: string, val: string | number | boolean | null) { setValues(prev => ({ ...prev, [key]: val })); }

  // Computed materiality values
  const selectedBenchmark = (values.benchmark as string) || '';
  const benchmarkRange = MATERIALITY_RANGES[selectedBenchmark] || { low: 0, high: 0 };
  const percentage = Number(values.percentage) || 0;
  const benchmarkAmount = Number(values[`benchmark_amount_${selectedBenchmark?.replace(/\s+/g, '_')}`]) || 0;

  const materiality = useMemo(() => {
    if (!percentage || !benchmarkAmount) return null;
    return Math.round(percentage * benchmarkAmount);
  }, [percentage, benchmarkAmount]);

  const pmPercentage = useMemo(() => {
    const pmRange = values.pm_overall_range as string;
    if (pmRange === 'Low (50%)') return 0.50;
    if (pmRange === 'Moderate (65%)') return 0.65;
    if (pmRange === 'High (75%)') return 0.75;
    return 0.65; // default
  }, [values.pm_overall_range]);

  const performanceMateriality = materiality ? Math.round(materiality * pmPercentage) : null;
  const clearlyTrivial = materiality ? Math.round(materiality * 0.05) : null;

  if (loading) return <div className="py-8 text-center text-sm text-slate-400 animate-pulse">Loading Materiality...</div>;

  const inputCls = 'w-full border border-slate-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400';

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold text-slate-800">Materiality</h2>
        <div className="flex items-center gap-2 text-xs">
          {saving && <span className="text-blue-500 animate-pulse">Saving...</span>}
          {lastSaved && !saving && <span className="text-green-500">Saved</span>}
          {error && <span className="text-red-500">{error}</span>}
        </div>
      </div>

      {/* Overall Materiality Summary */}
      <div className="mb-6 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-blue-800 mb-3">Overall Materiality</h3>
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-white rounded-lg p-3 border border-blue-100 text-center">
            <div className="text-xs text-slate-500 mb-1">Materiality</div>
            <div className="text-lg font-bold text-blue-700">
              {materiality ? `£${materiality.toLocaleString()}` : '—'}
            </div>
            <div className="text-[10px] text-slate-400">CY</div>
          </div>
          <div className="bg-white rounded-lg p-3 border border-blue-100 text-center">
            <div className="text-xs text-slate-500 mb-1">Performance Materiality</div>
            <div className="text-lg font-bold text-indigo-700">
              {performanceMateriality ? `£${performanceMateriality.toLocaleString()}` : '—'}
            </div>
            <div className="text-[10px] text-slate-400">{pmPercentage * 100}% of OM</div>
          </div>
          <div className="bg-white rounded-lg p-3 border border-blue-100 text-center">
            <div className="text-xs text-slate-500 mb-1">Clearly Trivial</div>
            <div className="text-lg font-bold text-slate-600">
              {clearlyTrivial ? `£${clearlyTrivial.toLocaleString()}` : '—'}
            </div>
            <div className="text-[10px] text-slate-400">5% of OM</div>
          </div>
        </div>
      </div>

      {/* Benchmark Selection */}
      <div className="mb-6 border border-slate-200 rounded-lg overflow-hidden">
        <div className="bg-slate-50 px-4 py-2 border-b border-slate-200">
          <h3 className="text-sm font-semibold text-slate-700">Materiality Benchmark</h3>
        </div>
        <div className="p-4">
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-xs text-slate-600 mb-1">Select Benchmark</label>
              <select
                value={selectedBenchmark}
                onChange={e => set('benchmark', e.target.value)}
                className={`${inputCls} bg-white`}
              >
                <option value="">Select benchmark...</option>
                {MATERIALITY_BENCHMARKS.map(b => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-600 mb-1">
                Percentage (Range: {(benchmarkRange.low * 100).toFixed(1)}% – {(benchmarkRange.high * 100).toFixed(1)}%)
              </label>
              <input
                type="number"
                value={percentage || ''}
                onChange={e => set('percentage', Number(e.target.value) || null)}
                min={benchmarkRange.low}
                max={benchmarkRange.high}
                step={0.001}
                className={inputCls}
                placeholder={`${(benchmarkRange.low * 100).toFixed(1)}% – ${(benchmarkRange.high * 100).toFixed(1)}%`}
              />
            </div>
          </div>

          {/* Benchmark reference table */}
          <div className="mt-3">
            <div className="text-xs font-medium text-slate-500 mb-2">Determining the level of the benchmark:</div>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="text-left py-1 px-2 text-slate-500">Benchmark</th>
                  <th className="text-right py-1 px-2 text-slate-500">Low Range</th>
                  <th className="text-right py-1 px-2 text-slate-500">High Range</th>
                </tr>
              </thead>
              <tbody>
                {MATERIALITY_BENCHMARKS.map(b => {
                  const range = MATERIALITY_RANGES[b];
                  const isSelected = b === selectedBenchmark;
                  return (
                    <tr key={b} className={`border-b border-slate-100 ${isSelected ? 'bg-blue-50' : ''}`}>
                      <td className={`py-1 px-2 ${isSelected ? 'font-medium text-blue-700' : 'text-slate-600'}`}>{b}</td>
                      <td className="py-1 px-2 text-right">{(range.low * 100).toFixed(1)}%</td>
                      <td className="py-1 px-2 text-right">{(range.high * 100).toFixed(1)}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Benchmark Amounts */}
      <div className="mb-6 border border-slate-200 rounded-lg overflow-hidden">
        <div className="bg-slate-50 px-4 py-2 border-b border-slate-200">
          <h3 className="text-sm font-semibold text-slate-700">Benchmark Amount (£)</h3>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/50">
              <th className="text-left px-3 py-1.5 text-xs text-slate-500 font-medium">Benchmark</th>
              <th className="text-right px-3 py-1.5 text-xs text-slate-500 font-medium w-40">Current Year (£)</th>
              <th className="text-right px-3 py-1.5 text-xs text-slate-500 font-medium w-40">Prior Year (£)</th>
            </tr>
          </thead>
          <tbody>
            {MATERIALITY_BENCHMARKS.map(b => {
              const key = b.replace(/\s+/g, '_');
              const isSelected = b === selectedBenchmark;
              return (
                <tr key={b} className={`border-b border-slate-100 ${isSelected ? 'bg-blue-50/30' : ''}`}>
                  <td className={`px-3 py-1.5 text-xs ${isSelected ? 'font-medium text-blue-700' : 'text-slate-700'}`}>{b}</td>
                  <td className="px-3 py-1">
                    <input
                      type="number"
                      value={Number(v(`benchmark_amount_${key}`)) || ''}
                      onChange={e => set(`benchmark_amount_${key}`, Number(e.target.value) || null)}
                      className="w-full border border-slate-200 rounded px-2 py-1 text-xs text-right focus:outline-none focus:ring-1 focus:ring-blue-300"
                    />
                  </td>
                  <td className="px-3 py-1">
                    <input
                      type="number"
                      value={Number(v(`benchmark_amount_py_${key}`)) || ''}
                      onChange={e => set(`benchmark_amount_py_${key}`, Number(e.target.value) || null)}
                      className="w-full border border-slate-200 rounded px-2 py-1 text-xs text-right focus:outline-none focus:ring-1 focus:ring-blue-300"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Justification */}
      <div className="mb-6 border border-slate-200 rounded-lg overflow-hidden">
        <div className="bg-slate-50 px-4 py-2 border-b border-slate-200">
          <h3 className="text-sm font-semibold text-slate-700">Justification for Basis of Materiality</h3>
        </div>
        <div className="p-4 space-y-3">
          <div>
            <label className="block text-xs text-slate-600 mb-1">Stakeholders identified</label>
            <textarea value={(v('stakeholders') as string) || ''} onChange={e => set('stakeholders', e.target.value)} className={`${inputCls} min-h-[50px]`} />
          </div>
          <div>
            <label className="block text-xs text-slate-600 mb-1">Document how audit team assessed the focus of stakeholders and justify the basis for selecting the benchmark</label>
            <textarea value={(v('stakeholder_assessment') as string) || ''} onChange={e => set('stakeholder_assessment', e.target.value)} className={`${inputCls} min-h-[50px]`} />
          </div>
          <div>
            <label className="block text-xs text-slate-600 mb-1">Summarise key judgements and discussions of audit team in setting the materiality</label>
            <textarea value={(v('key_judgements') as string) || ''} onChange={e => set('key_judgements', e.target.value)} className={`${inputCls} min-h-[50px]`} />
          </div>
          <div>
            <label className="block text-xs text-slate-600 mb-1">Is there any change in basis of materiality from prior year?</label>
            <textarea value={(v('basis_change') as string) || ''} onChange={e => set('basis_change', e.target.value)} className={`${inputCls} min-h-[40px]`} />
          </div>
        </div>
      </div>

      {/* Overall Materiality Assessment Factors */}
      <div className="mb-6 border border-slate-200 rounded-lg overflow-hidden">
        <div className="bg-slate-50 px-4 py-2 border-b border-slate-200">
          <h3 className="text-sm font-semibold text-slate-700">Overall Materiality Assessment</h3>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/50">
              <th className="text-left px-3 py-1.5 text-xs text-slate-500 font-medium">Factor</th>
              <th className="text-left px-3 py-1.5 text-xs text-slate-500 font-medium w-64">Comment</th>
              <th className="text-center px-3 py-1.5 text-xs text-slate-500 font-medium w-24">Range</th>
            </tr>
          </thead>
          <tbody>
            {OM_FACTORS.map((factor, i) => (
              <tr key={i} className="border-b border-slate-100 hover:bg-slate-50/30">
                <td className="px-3 py-1.5 text-xs text-slate-700">{factor}</td>
                <td className="px-3 py-1">
                  <input
                    type="text"
                    value={(v(`om_comment_${i}`) as string) || ''}
                    onChange={e => set(`om_comment_${i}`, e.target.value)}
                    className="w-full border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-300"
                  />
                </td>
                <td className="px-3 py-1 text-center">
                  <select
                    value={(v(`om_range_${i}`) as string) || ''}
                    onChange={e => set(`om_range_${i}`, e.target.value)}
                    className="border border-slate-200 rounded px-1 py-0.5 text-xs bg-white"
                  >
                    <option value="">-</option>
                    {OM_RANGE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Performance Materiality Factors */}
      <div className="mb-6 border border-slate-200 rounded-lg overflow-hidden">
        <div className="bg-slate-50 px-4 py-2 border-b border-slate-200">
          <h3 className="text-sm font-semibold text-slate-700">
            Performance Materiality (PM) — Range: 50%–75%
          </h3>
        </div>
        <div className="px-4 py-2">
          <label className="block text-xs text-slate-600 mb-1">Overall PM Range</label>
          <select
            value={(v('pm_overall_range') as string) || ''}
            onChange={e => set('pm_overall_range', e.target.value)}
            className={`${inputCls} bg-white max-w-xs`}
          >
            <option value="">Select...</option>
            {PM_RANGE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/50">
              <th className="text-left px-3 py-1.5 text-xs text-slate-500 font-medium">Factor</th>
              <th className="text-left px-3 py-1.5 text-xs text-slate-500 font-medium w-64">Comment</th>
              <th className="text-center px-3 py-1.5 text-xs text-slate-500 font-medium w-32">Range</th>
            </tr>
          </thead>
          <tbody>
            {PM_FACTORS.map((factor, i) => (
              <tr key={i} className="border-b border-slate-100 hover:bg-slate-50/30">
                <td className="px-3 py-1.5 text-xs text-slate-700">{factor}</td>
                <td className="px-3 py-1">
                  <input
                    type="text"
                    value={(v(`pm_comment_${i}`) as string) || ''}
                    onChange={e => set(`pm_comment_${i}`, e.target.value)}
                    className="w-full border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-300"
                  />
                </td>
                <td className="px-3 py-1 text-center">
                  <select
                    value={(v(`pm_range_${i}`) as string) || ''}
                    onChange={e => set(`pm_range_${i}`, e.target.value)}
                    className="border border-slate-200 rounded px-1 py-0.5 text-xs bg-white"
                  >
                    <option value="">-</option>
                    {PM_RANGE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
