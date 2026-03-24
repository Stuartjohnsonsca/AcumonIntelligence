'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAutoSave } from '@/hooks/useAutoSave';

interface Props {
  engagementId: string;
}

interface PARRow {
  id: string;
  particulars: string;
  currentYear: number | null;
  priorYear: number | null;
  absVariance: number | null;
  absVariancePercent: number | null;
  significantChange: boolean;
  sentToManagement: boolean;
  managementResponseStatus: string | null;
  reasons: string | null;
  sortOrder: number;
}

export function PARTab({ engagementId }: Props) {
  const [rows, setRows] = useState<PARRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [initialRows, setInitialRows] = useState<PARRow[]>([]);
  const [pmThreshold, setPmThreshold] = useState<number | null>(null);
  const [varianceThreshold] = useState(0.10); // 10% default

  const { saving, lastSaved, error } = useAutoSave(
    `/api/engagements/${engagementId}/par`,
    { rows },
    { enabled: JSON.stringify(rows) !== JSON.stringify(initialRows) }
  );

  // Load PAR rows
  const loadData = useCallback(async () => {
    try {
      const res = await fetch(`/api/engagements/${engagementId}/par`);
      if (res.ok) { const json = await res.json(); setRows(json.rows || []); setInitialRows(json.rows || []); }
    } catch (err) { console.error('Failed to load:', err); }
    finally { setLoading(false); }
  }, [engagementId]);

  // Load PM from materiality tab
  useEffect(() => {
    async function loadPM() {
      try {
        const res = await fetch(`/api/engagements/${engagementId}/materiality`);
        if (res.ok) {
          const json = await res.json();
          const data = json.data || {};
          const benchmark = data.benchmark as string;
          const pct = Number(data.percentage) || 0;
          const amount = Number(data[`benchmark_amount_${benchmark?.replace(/\s+/g, '_')}`]) || 0;
          const materiality = pct && amount ? Math.round(pct * amount) : null;
          const pmRange = data.pm_overall_range as string;
          const pmPct = pmRange === 'Low (50%)' ? 0.5 : pmRange === 'High (75%)' ? 0.75 : 0.65;
          setPmThreshold(materiality ? Math.round(materiality * pmPct) : null);
        }
      } catch { /* ignore */ }
    }
    loadPM();
  }, [engagementId]);

  useEffect(() => { loadData(); }, [loadData]);

  // Auto-calculate variance fields
  const computedRows = useMemo(() => {
    return rows.map(row => {
      const cy = row.currentYear ?? 0;
      const py = row.priorYear ?? 0;
      const variance = Math.abs(cy - py);
      const variancePct = py !== 0 ? Math.abs((cy - py) / py) : (cy !== 0 ? 1 : 0);
      const isSignificant = pmThreshold !== null
        ? variance > pmThreshold && variancePct > varianceThreshold
        : false;
      return { ...row, absVariance: variance, absVariancePercent: variancePct, significantChange: isSignificant };
    });
  }, [rows, pmThreshold, varianceThreshold]);

  function addRow() {
    setRows(prev => [...prev, {
      id: '', particulars: '', currentYear: null, priorYear: null,
      absVariance: null, absVariancePercent: null, significantChange: false,
      sentToManagement: false, managementResponseStatus: null, reasons: null,
      sortOrder: prev.length,
    }]);
  }

  function updateRow(index: number, field: keyof PARRow, value: string | number | boolean | null) {
    setRows(prev => prev.map((r, i) => i === index ? { ...r, [field]: value } : r));
  }

  function removeRow(index: number) {
    setRows(prev => prev.filter((_, i) => i !== index));
  }

  function toggleSendToManagement(index: number) {
    const row = computedRows[index];
    const newVal = !row.sentToManagement;
    updateRow(index, 'sentToManagement', newVal);
    if (newVal) {
      updateRow(index, 'managementResponseStatus', 'pending');
    }
  }

  if (loading) return <div className="py-8 text-center text-sm text-slate-400 animate-pulse">Loading PAR...</div>;

  const numCls = 'w-full border-0 bg-transparent text-xs text-right focus:outline-none focus:ring-1 focus:ring-blue-300 rounded px-1 py-0.5';

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-semibold text-slate-800">Preliminary Analytical Review</h2>
          {pmThreshold !== null && (
            <span className="text-xs text-slate-400">PM Threshold: £{pmThreshold.toLocaleString()}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {saving && <span className="text-xs text-blue-500 animate-pulse">Saving...</span>}
          {lastSaved && !saving && <span className="text-xs text-green-500">Saved</span>}
          {error && <span className="text-xs text-red-500">{error}</span>}
          <button onClick={addRow} className="text-xs px-3 py-1 bg-blue-50 text-blue-600 rounded hover:bg-blue-100">+ Add Row</button>
        </div>
      </div>

      <div className="border border-slate-200 rounded-lg overflow-auto max-h-[600px]">
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-100 border-b border-slate-200">
              <th className="text-left px-2 py-2 text-slate-500 font-medium w-48">Particulars</th>
              <th className="text-right px-2 py-2 text-slate-500 font-medium w-24">Period End</th>
              <th className="text-right px-2 py-2 text-slate-500 font-medium w-24">Period Start - 1</th>
              <th className="text-right px-2 py-2 text-slate-500 font-medium w-24">ABS Variance</th>
              <th className="text-right px-2 py-2 text-slate-500 font-medium w-20">ABS Var %</th>
              <th className="text-center px-2 py-2 text-slate-500 font-medium w-24">Significant?</th>
              <th className="text-center px-2 py-2 text-slate-500 font-medium w-20">Send Mgmt</th>
              <th className="text-left px-2 py-2 text-slate-500 font-medium">Reasons</th>
              <th className="w-8"></th>
            </tr>
          </thead>
          <tbody>
            {computedRows.length === 0 ? (
              <tr><td colSpan={9} className="text-center py-8 text-slate-400 italic">No PAR rows. Click &quot;Add Row&quot; or populate from Trial Balance.</td></tr>
            ) : computedRows.map((row, i) => (
              <tr key={row.id || `new-${i}`} className={`border-b border-slate-100 hover:bg-slate-50/50 ${row.significantChange ? 'bg-yellow-50/30' : ''}`}>
                <td className="px-2 py-0.5">
                  <input type="text" value={row.particulars} onChange={e => updateRow(i, 'particulars', e.target.value)} className="w-full border-0 bg-transparent text-xs focus:outline-none focus:ring-1 focus:ring-blue-300 rounded px-1 py-0.5" placeholder="Line item..." />
                </td>
                <td className="px-2 py-0.5">
                  <input type="number" value={row.currentYear ?? ''} onChange={e => updateRow(i, 'currentYear', e.target.value ? Number(e.target.value) : null)} className={numCls} step="0.01" />
                </td>
                <td className="px-2 py-0.5">
                  <input type="number" value={row.priorYear ?? ''} onChange={e => updateRow(i, 'priorYear', e.target.value ? Number(e.target.value) : null)} className={numCls} step="0.01" />
                </td>
                <td className="px-2 py-0.5 text-right text-slate-500">
                  {row.absVariance !== null && row.absVariance > 0 ? row.absVariance.toLocaleString(undefined, { maximumFractionDigits: 0 }) : ''}
                </td>
                <td className="px-2 py-0.5 text-right text-slate-500">
                  {row.absVariancePercent !== null && row.absVariancePercent > 0 ? `${(row.absVariancePercent * 100).toFixed(1)}%` : ''}
                </td>
                <td className="px-2 py-0.5 text-center">
                  {row.significantChange ? (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 text-[10px] font-medium">
                      &gt;PM &amp; {(varianceThreshold * 100)}%
                    </span>
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                </td>
                <td className="px-2 py-0.5 text-center">
                  <button
                    onClick={() => toggleSendToManagement(i)}
                    className={`w-5 h-5 rounded border-2 inline-flex items-center justify-center transition-colors ${
                      row.sentToManagement
                        ? row.managementResponseStatus === 'responded' ? 'bg-green-500 border-green-500 text-white' : 'bg-orange-400 border-orange-400 text-white'
                        : 'border-slate-300 hover:border-blue-400'
                    }`}
                    title={row.sentToManagement ? (row.managementResponseStatus === 'responded' ? 'Client responded' : 'Awaiting response') : 'Send to management'}
                  >
                    {row.sentToManagement && <span className="text-[10px]">✓</span>}
                  </button>
                </td>
                <td className="px-2 py-0.5">
                  <input type="text" value={row.reasons || ''} onChange={e => updateRow(i, 'reasons', e.target.value || null)} className="w-full border-0 bg-transparent text-xs focus:outline-none focus:ring-1 focus:ring-blue-300 rounded px-1 py-0.5" placeholder="Reason..." />
                </td>
                <td className="px-2 py-0.5">
                  <button onClick={() => removeRow(i)} className="text-red-400 hover:text-red-600">×</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
