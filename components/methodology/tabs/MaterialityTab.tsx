'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAutoSave } from '@/hooks/useAutoSave';

interface Props { engagementId: string; }

const BENCHMARKS = ['Profit before Tax', 'Gross Profit', 'Total Revenue', 'Total Expenses', 'Total Equity or Net Assets', 'Total Assets'];
const LMH = ['Low', 'Medium', 'High'];

const OM_FACTORS = [
  'Is the company a public limited entity? Is it listed?',
  'Exposure to borrowing facilities',
  'Minimal number of shareholders',
  'Nature of Business (Highly regulated/Minimally regulated)',
  'Intention to get listed in the near future (3 years)',
  'Changes in the nature of business',
];

const PM_FACTORS = [
  'Deficiencies in internal controls',
  'First/second/third year audit by Firm',
  'Report of fraud or higher risk of fraud',
  'History of misstatements (corrected and uncorrected)',
  'Level of turnover of senior management',
  'Management preparedness to correct misstatements',
  'Competency of management',
  'Complexity of IT environment',
];

const ROUNDING_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

function fmtCurrency(v: number | null | undefined, sym = '£'): string {
  if (v == null) return '';
  const abs = Math.abs(v);
  const s = sym + abs.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return v < 0 ? `(${s})` : s;
}

function roundDown(v: number, negDecimals: number): number {
  const factor = Math.pow(10, negDecimals);
  return Math.floor(v / factor) * factor;
}

export function MaterialityTab({ engagementId }: Props) {
  const [data, setData] = useState<Record<string, any>>({});
  const [initialData, setInitialData] = useState<Record<string, any>>({});
  const [priorData, setPriorData] = useState<Record<string, any> | null>(null);
  const [tbTotals, setTbTotals] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [materialityRange, setMaterialityRange] = useState<{ benchmark: string; low: number; high: number }[]>([]);

  const loadData = useCallback(async () => {
    try {
      const [dataRes, rangeRes, tbRes] = await Promise.all([
        fetch(`/api/engagements/${engagementId}/materiality`),
        fetch('/api/methodology-admin/risk-tables?tableType=materiality_range'),
        fetch(`/api/engagements/${engagementId}/trial-balance`),
      ]);

      if (dataRes.ok) {
        const json = await dataRes.json();
        const d = json.data || {};
        setData(d);
        setInitialData(d);
      }
      if (rangeRes.ok) {
        const json = await rangeRes.json();
        if (json.table?.data) setMaterialityRange(json.table.data);
      }
      // Build TB totals by FS Level for benchmark lookup
      if (tbRes.ok) {
        const json = await tbRes.json();
        const rows = json.rows || [];
        const totals: Record<string, number> = {};
        for (const r of rows) {
          const cy = r.currentYear || 0;
          if (r.fsLevel) totals[r.fsLevel] = (totals[r.fsLevel] || 0) + cy;
          if (r.fsStatement === 'Profit & Loss') totals['__pnl'] = (totals['__pnl'] || 0) + cy;
          if (r.fsStatement === 'Balance Sheet') totals['__bs'] = (totals['__bs'] || 0) + cy;
          if (r.fsLevel === 'Revenue') totals['__revenue'] = (totals['__revenue'] || 0) + cy;
        }
        // Map benchmark names to totals
        totals['Profit before Tax'] = totals['__pnl'] || 0;
        totals['Gross Profit'] = (totals['__revenue'] || 0) + (totals['Cost of Sales'] || 0);
        totals['Total Revenue'] = totals['__revenue'] || 0;
        totals['Total Expenses'] = (totals['__pnl'] || 0) - (totals['__revenue'] || 0);
        totals['Total Equity or Net Assets'] = totals['__bs'] || 0;
        totals['Total Assets'] = rows.filter((r: any) => r.fsStatement === 'Balance Sheet' && (r.currentYear || 0) > 0).reduce((s: number, r: any) => s + (r.currentYear || 0), 0);
        setTbTotals(totals);
      }

      // Load prior year
      try {
        const engRes = await fetch(`/api/engagements/${engagementId}`);
        if (engRes.ok) {
          const eng = (await engRes.json()).engagement;
          if (eng?.clientId) {
            const priorRes = await fetch(`/api/engagements?clientId=${eng.clientId}&auditType=${eng.auditType}&prior=true&currentEngagementId=${engagementId}`);
            if (priorRes.ok) {
              const priorEng = (await priorRes.json()).engagement;
              if (priorEng?.id) {
                const priorMatRes = await fetch(`/api/engagements/${priorEng.id}/materiality`);
                if (priorMatRes.ok) {
                  const pd = (await priorMatRes.json()).data || {};
                  setPriorData(pd);
                }
              }
            }
          }
        }
      } catch {}
    } catch (err) {
      console.error('Failed to load materiality:', err);
    } finally {
      setLoading(false);
    }
  }, [engagementId]);

  useEffect(() => { loadData(); }, [loadData]);

  useAutoSave(`/api/engagements/${engagementId}/materiality`, { data }, {
    enabled: JSON.stringify(data) !== JSON.stringify(initialData),
  });

  function set(key: string, value: any) { setData(prev => ({ ...prev, [key]: value })); }
  function get(key: string): any { return data[key]; }
  function getPy(key: string): any { return priorData?.[key]; }

  // Derived values
  const benchmark = get('materiality_benchmark') as string || '';
  const benchmarkAmount = tbTotals[benchmark] || 0;
  const benchmarkPct = (get('benchmark_pct') as number) || 0;
  const rounding = (get('materiality_rounding') as number) || 3;

  const materialityRaw = benchmarkAmount * (benchmarkPct / 100);
  const materiality = materialityRaw ? roundDown(Math.abs(materialityRaw), rounding) : 0;

  // PM % from factor assessment
  const pmAssessments = PM_FACTORS.map((_, i) => get(`pm_factor_${i}`) as string || 'Medium');
  const pmPctMap: Record<string, number> = { Low: 50, Medium: 65, High: 75 };
  const avgPmPct = pmAssessments.length > 0
    ? pmAssessments.reduce((s, v) => s + (pmPctMap[v] || 65), 0) / pmAssessments.length
    : 65;
  const performanceMateriality = materiality ? roundDown(materiality * (avgPmPct / 100), rounding) : 0;
  const clearlyTrivial = materiality ? roundDown(materiality * 0.05, rounding) : 0;

  // Prior year derived
  const pyBenchmarkPct = (getPy('benchmark_pct') as number) || 0;
  const pyMaterialityRaw = getPy('materiality_manual') as number;
  const pyMateriality = pyMaterialityRaw || 0;
  const pyPM = getPy('performance_materiality_manual') as number || 0;
  const pyCT = getPy('clearly_trivial_manual') as number || 0;

  // Breach check
  const rangeRow = materialityRange.find(r => r.benchmark.toLowerCase() === benchmark.toLowerCase());
  const actualPct = benchmarkAmount ? materiality / Math.abs(benchmarkAmount) : 0;
  const breachWarning = rangeRow && actualPct > 0 && (actualPct < rangeRow.low || actualPct > rangeRow.high)
    ? `Materiality (${(actualPct * 100).toFixed(2)}%) is outside the range (${(rangeRow.low * 100).toFixed(1)}%–${(rangeRow.high * 100).toFixed(1)}%) for ${benchmark}`
    : null;

  const basisChanged = get('basis_changed') === true || get('basis_changed') === 'Yes';

  if (loading) return <div className="py-8 text-center text-sm text-slate-400 animate-pulse">Loading Materiality...</div>;

  const rc = 'text-right px-2 py-1.5 text-xs font-mono';
  const lc = 'bg-slate-50 px-3 py-1.5 text-xs text-slate-700 w-[40%]';
  const pyc = 'bg-slate-100 text-right px-2 py-1.5 text-xs text-slate-500 font-mono w-[15%]';
  const ic = 'px-2 py-1 flex-1';

  function LmhSelect({ value, onChange, pyValue }: { value: string; onChange: (v: string) => void; pyValue?: string }) {
    return (
      <div className="flex items-center gap-1">
        {pyValue !== undefined && (
          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
            pyValue === 'High' ? 'bg-red-100 text-red-700' : pyValue === 'Low' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
          }`}>{pyValue || '—'}</span>
        )}
        <select
          value={value}
          onChange={e => onChange(e.target.value)}
          className={`text-xs border rounded px-2 py-1 ${
            value === 'High' ? 'border-red-300 text-red-700 bg-red-50' :
            value === 'Low' ? 'border-green-300 text-green-700 bg-green-50' :
            'border-amber-300 text-amber-700 bg-amber-50'
          }`}
        >
          {LMH.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {breachWarning && (
        <div className="p-3 bg-red-50 border-2 border-red-300 rounded-lg flex items-start gap-2">
          <span className="text-red-500 text-lg">⚠</span>
          <div>
            <p className="text-sm font-semibold text-red-800">Materiality Range Breach</p>
            <p className="text-xs text-red-700 mt-0.5">{breachWarning}</p>
          </div>
        </div>
      )}

      {/* ═══ Summary: PY vs CY materiality figures ═══ */}
      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-100 border-b">
              <th className="text-left px-3 py-2 text-slate-600 w-[40%]"></th>
              <th className="text-right px-3 py-2 text-slate-500 w-[15%]">Prior Year</th>
              <th className="text-right px-3 py-2 text-slate-600 w-[15%]">Current Year</th>
              <th className="w-[30%]"></th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b">
              <td className={lc}>Materiality</td>
              <td className={pyc}>{pyMateriality ? fmtCurrency(pyMateriality) : '—'}</td>
              <td className={`${rc} font-semibold text-slate-800`}>{fmtCurrency(materiality)}</td>
              <td></td>
            </tr>
            <tr className="border-b">
              <td className={lc}>Performance Materiality</td>
              <td className={pyc}>{pyPM ? fmtCurrency(pyPM) : '—'}</td>
              <td className={`${rc} font-semibold text-slate-800`}>{fmtCurrency(performanceMateriality)}</td>
              <td></td>
            </tr>
            <tr>
              <td className={lc}>Clearly Trivial</td>
              <td className={pyc}>{pyCT ? fmtCurrency(pyCT) : '—'}</td>
              <td className={`${rc} font-semibold text-slate-800`}>{fmtCurrency(clearlyTrivial)}</td>
              <td></td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* ═══ Overall Materiality ═══ */}
      <div>
        <div className="bg-blue-50 px-3 py-1.5 rounded-t-lg border border-blue-100">
          <h3 className="text-xs font-semibold text-blue-800">Overall Materiality</h3>
        </div>
        <div className="border border-t-0 rounded-b-lg divide-y">
          {/* Benchmark selector */}
          <div className="flex">
            <div className={lc}>Materiality Benchmark</div>
            <div className={pyc}>{getPy('materiality_benchmark') || '—'}</div>
            <div className={ic}>
              <select value={benchmark} onChange={e => set('materiality_benchmark', e.target.value)} className="w-full text-xs border rounded px-2 py-1.5">
                <option value="">Select...</option>
                {BENCHMARKS.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
          </div>
          {/* Benchmark amount from TB — dynamic */}
          <div className="flex">
            <div className={lc}>Benchmark Amount (from TB)</div>
            <div className={pyc}>—</div>
            <div className={`${ic} flex items-center`}>
              <span className="text-xs font-semibold text-slate-800 font-mono">{benchmark ? fmtCurrency(benchmarkAmount) : '—'}</span>
              {benchmark && <span className="text-[10px] text-slate-400 ml-2">auto from TBCYvPY</span>}
            </div>
          </div>
          {/* Benchmark % */}
          <div className="flex">
            <div className={lc}>Benchmark %</div>
            <div className={pyc}>{pyBenchmarkPct ? `${pyBenchmarkPct}%` : '—'}</div>
            <div className={`${ic} flex items-center gap-2`}>
              <input type="number" value={benchmarkPct || ''} onChange={e => set('benchmark_pct', e.target.value ? Number(e.target.value) : null)} className="w-20 text-xs border rounded px-2 py-1.5 text-right" step="0.1" placeholder="%" />
              <span className="text-[10px] text-slate-400">%</span>
              {rangeRow && <span className="text-[10px] text-slate-400">Range: {(rangeRow.low * 100).toFixed(1)}%–{(rangeRow.high * 100).toFixed(1)}%</span>}
            </div>
          </div>
          {/* Rounding */}
          <div className="flex">
            <div className={lc}>Materiality Rounding</div>
            <div className={pyc}>{getPy('materiality_rounding') || '—'}</div>
            <div className={`${ic} flex items-center gap-2`}>
              <select value={rounding} onChange={e => set('materiality_rounding', Number(e.target.value))} className="text-xs border rounded px-2 py-1.5">
                {ROUNDING_OPTIONS.map(r => <option key={r} value={r}>10^{r} ({Math.pow(10, r).toLocaleString()})</option>)}
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* ═══ Justification ═══ */}
      <div>
        <div className="bg-blue-50 px-3 py-1.5 rounded-t-lg border border-blue-100">
          <h3 className="text-xs font-semibold text-blue-800">Justification</h3>
        </div>
        <div className="border border-t-0 rounded-b-lg divide-y">
          <div className="flex">
            <div className={lc}>Stakeholders identified</div>
            <div className={pyc}><span className="text-[10px] break-words">{getPy('stakeholders') || ''}</span></div>
            <div className={ic}><textarea value={get('stakeholders') || ''} onChange={e => set('stakeholders', e.target.value)} rows={2} className="w-full text-xs border rounded px-2 py-1.5" /></div>
          </div>
          <div className="flex">
            <div className={lc}>How audit team assessed focus of stakeholders</div>
            <div className={pyc}><span className="text-[10px] break-words">{getPy('stakeholder_focus') || ''}</span></div>
            <div className={ic}><textarea value={get('stakeholder_focus') || ''} onChange={e => set('stakeholder_focus', e.target.value)} rows={2} className="w-full text-xs border rounded px-2 py-1.5" /></div>
          </div>
          <div className="flex">
            <div className={lc}>Key judgements in setting materiality</div>
            <div className={pyc}><span className="text-[10px] break-words">{getPy('key_judgements') || ''}</span></div>
            <div className={ic}><textarea value={get('key_judgements') || ''} onChange={e => set('key_judgements', e.target.value)} rows={2} className="w-full text-xs border rounded px-2 py-1.5" /></div>
          </div>
          <div className="flex">
            <div className={lc}>Any change in basis from prior year?</div>
            <div className={pyc}>{getPy('basis_changed') != null ? (getPy('basis_changed') ? 'Yes' : 'No') : '—'}</div>
            <div className={`${ic} flex items-center gap-3`}>
              <label className="flex items-center gap-1 text-xs"><input type="radio" name="basis_changed" checked={basisChanged === true} onChange={() => set('basis_changed', true)} className="w-3 h-3" /> Yes</label>
              <label className="flex items-center gap-1 text-xs"><input type="radio" name="basis_changed" checked={basisChanged === false || get('basis_changed') == null} onChange={() => { set('basis_changed', false); set('basis_change_reason', ''); }} className="w-3 h-3" /> No</label>
            </div>
          </div>
          {basisChanged && (
            <div className="flex">
              <div className={lc}>Reasons for change in basis</div>
              <div className={pyc}><span className="text-[10px] break-words">{getPy('basis_change_reason') || ''}</span></div>
              <div className={ic}><textarea value={get('basis_change_reason') || ''} onChange={e => set('basis_change_reason', e.target.value)} rows={2} className="w-full text-xs border rounded px-2 py-1.5" /></div>
            </div>
          )}
        </div>
      </div>

      {/* ═══ Overall Materiality Assessment (OM factors) ═══ */}
      <div>
        <div className="bg-blue-50 px-3 py-1.5 rounded-t-lg border border-blue-100">
          <h3 className="text-xs font-semibold text-blue-800">Overall Materiality Assessment</h3>
        </div>
        <div className="border border-t-0 rounded-b-lg divide-y">
          {OM_FACTORS.map((f, i) => (
            <div key={i} className="flex items-center">
              <div className={lc}>{f}</div>
              <div className={`${pyc} flex justify-end`}>
                {getPy(`om_factor_${i}`) && (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                    getPy(`om_factor_${i}`) === 'High' ? 'bg-red-100 text-red-700' : getPy(`om_factor_${i}`) === 'Low' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
                  }`}>{getPy(`om_factor_${i}`)}</span>
                )}
              </div>
              <div className={`${ic} flex items-center gap-2`}>
                {i === 0 ? (
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-1 text-xs"><input type="radio" name={`om_yn_${i}`} checked={get(`om_yn_${i}`) === 'Yes'} onChange={() => set(`om_yn_${i}`, 'Yes')} className="w-3 h-3" /> Yes</label>
                    <label className="flex items-center gap-1 text-xs"><input type="radio" name={`om_yn_${i}`} checked={get(`om_yn_${i}`) !== 'Yes'} onChange={() => set(`om_yn_${i}`, 'No')} className="w-3 h-3" /> No</label>
                  </div>
                ) : (
                  <input type="text" value={get(`om_text_${i}`) || ''} onChange={e => set(`om_text_${i}`, e.target.value)} className="flex-1 text-xs border rounded px-2 py-1.5" />
                )}
                <LmhSelect value={get(`om_factor_${i}`) || 'Medium'} onChange={v => set(`om_factor_${i}`, v)} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ═══ Performance Materiality Factors ═══ */}
      <div>
        <div className="bg-blue-50 px-3 py-1.5 rounded-t-lg border border-blue-100">
          <h3 className="text-xs font-semibold text-blue-800">Performance Materiality Factors</h3>
          <p className="text-[10px] text-blue-600 mt-0.5">Average assessment: {avgPmPct.toFixed(0)}% → PM = {fmtCurrency(performanceMateriality)}</p>
        </div>
        <div className="border border-t-0 rounded-b-lg divide-y">
          {PM_FACTORS.map((f, i) => (
            <div key={i} className="flex items-center">
              <div className={lc}>{f}</div>
              <div className={`${pyc} flex justify-end`}>
                {getPy(`pm_factor_${i}`) && (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                    getPy(`pm_factor_${i}`) === 'High' ? 'bg-red-100 text-red-700' : getPy(`pm_factor_${i}`) === 'Low' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
                  }`}>{getPy(`pm_factor_${i}`)}</span>
                )}
              </div>
              <div className={`${ic} flex items-center justify-end`}>
                <LmhSelect value={get(`pm_factor_${i}`) || 'Medium'} onChange={v => set(`pm_factor_${i}`, v)} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
