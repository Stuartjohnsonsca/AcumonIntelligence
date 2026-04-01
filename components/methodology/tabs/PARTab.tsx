'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAutoSave } from '@/hooks/useAutoSave';

interface Props {
  engagementId: string;
  userId?: string;
  userName?: string;
  userRole?: string;
}

interface SendMgtStatus {
  checked: boolean;
  checkedBy?: string;
  checkedAt?: string;
  sentAt?: string;
  respondedAt?: string;
  clientExplanation?: string;
}

interface AcceptedDots {
  operator?: { name: string; at: string };
  reviewer?: { name: string; at: string };
  partner?: { name: string; at: string };
}

interface PARRow {
  id: string;
  particulars: string;
  currentYear: number | null;
  priorYear: number | null;
  absVariance: number | null;
  absVariancePercent: number | null;
  significantChange: string;
  sendMgt: SendMgtStatus;
  reasons: string | null;
  auditorView: string | null;
  addedToRmm?: boolean;
  addedToRmmBy?: string | null;
  addedToRmmSent?: boolean;
  accepted: AcceptedDots;
  sortOrder: number;
  fsStatement?: string; // P&L | Balance Sheet | Cashflow
  isSection?: boolean;  // section header row (not editable)
}

interface TBRow {
  fsLevel: string | null;
  fsStatement: string | null;
  currentYear: number | null;
  priorYear: number | null;
}

const FS_STATEMENT_ORDER = ['P&L', 'Balance Sheet', 'Cashflow', 'Notes'];

function formatDate(d: Date | string | null | undefined): string {
  if (!d) return '';
  const date = typeof d === 'string' ? new Date(d) : d;
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function fmtTimestamp(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${formatDate(d)} ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}

export function PARTab({ engagementId, userId, userName, userRole }: Props) {
  const [rows, setRows] = useState<PARRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [initialRows, setInitialRows] = useState<PARRow[]>([]);
  const [pmThreshold, setPmThreshold] = useState<number | null>(null);
  const [absVarThreshold, setAbsVarThreshold] = useState(10); // default 10%
  const [parCriteria, setParCriteria] = useState<{
    row1Basis: string; // Materiality | Performance Materiality | Clearly Trivial
    row2Pct: number;
    combinator: string; // AND | OR
  }>({ row1Basis: 'Performance Materiality', row2Pct: 10, combinator: 'AND' });
  const [materialityValues, setMaterialityValues] = useState<{ materiality: number; pm: number; ct: number }>({ materiality: 0, pm: 0, ct: 0 });
  const [periodEnd, setPeriodEnd] = useState<string>('');
  const [periodStartMinus1, setPeriodStartMinus1] = useState<string>('');
  const [sending, setSending] = useState(false);

  const { saving, lastSaved, error } = useAutoSave(
    `/api/engagements/${engagementId}/par`,
    { rows },
    { enabled: JSON.stringify(rows) !== JSON.stringify(initialRows) }
  );

  // Build a flat summary from TB: fsLevel → { cy, py }
  function buildTBSummary(tbRows: TBRow[]): Record<string, { cy: number; py: number }> {
    const summary: Record<string, { cy: number; py: number }> = {};
    for (const tb of tbRows) {
      const level = tb.fsLevel || tb.fsStatement || 'Unclassified';
      if (!summary[level]) summary[level] = { cy: 0, py: 0 };
      summary[level].cy += tb.currentYear ?? 0;
      summary[level].py += tb.priorYear ?? 0;
    }
    return summary;
  }

  // Build PAR rows from TB data, grouped by FS Statement → FS Level
  // Uses methodology admin sort order for proper financial statement ordering
  function buildRowsFromTB(tbRows: TBRow[], fsOrder: Record<string, number> = {}): PARRow[] {
    // Group by fsStatement then fsLevel, summing amounts
    const groups: Record<string, Record<string, { cy: number; py: number }>> = {};
    for (const tb of tbRows) {
      const stmt = tb.fsStatement || 'Other';
      const level = tb.fsLevel || tb.fsStatement || 'Unclassified';
      if (!groups[stmt]) groups[stmt] = {};
      if (!groups[stmt][level]) groups[stmt][level] = { cy: 0, py: 0 };
      groups[stmt][level].cy += tb.currentYear ?? 0;
      groups[stmt][level].py += tb.priorYear ?? 0;
    }

    const result: PARRow[] = [];
    let idx = 0;

    const makeSection = (stmt: string): PARRow => ({
      id: `section-${stmt}`, particulars: stmt,
      currentYear: null, priorYear: null, absVariance: null, absVariancePercent: null,
      significantChange: '', sendMgt: { checked: false }, reasons: null, auditorView: null,
      accepted: {}, sortOrder: idx++, fsStatement: stmt, isSection: true,
    });

    const makeLine = (level: string, amounts: { cy: number; py: number }, stmt: string): PARRow => ({
      id: '', particulars: level,
      currentYear: Math.round(amounts.cy * 100) / 100,
      priorYear: Math.round(amounts.py * 100) / 100,
      absVariance: null, absVariancePercent: null, significantChange: '',
      sendMgt: { checked: false }, reasons: null, auditorView: null,
      accepted: {}, sortOrder: idx++, fsStatement: stmt,
    });

    // Sort FS lines by methodology admin sortOrder, then alphabetically as fallback
    function sortLines(entries: [string, { cy: number; py: number }][]): [string, { cy: number; py: number }][] {
      return entries.sort(([a], [b]) => {
        const orderA = fsOrder[a] ?? 9999;
        const orderB = fsOrder[b] ?? 9999;
        if (orderA !== orderB) return orderA - orderB;
        return a.localeCompare(b);
      });
    }

    // Process in standard FS order
    const allStatements = [...FS_STATEMENT_ORDER, ...Object.keys(groups).filter(s => !FS_STATEMENT_ORDER.includes(s))];
    for (const stmt of allStatements) {
      const fsGroup = groups[stmt];
      if (!fsGroup || Object.keys(fsGroup).length === 0) continue;
      result.push(makeSection(stmt));
      for (const [level, amounts] of sortLines(Object.entries(fsGroup))) {
        result.push(makeLine(level, amounts, stmt));
      }
    }

    return result;
  }

  const loadData = useCallback(async () => {
    try {
      const [parRes, engRes, tbRes, fsLinesRes, parCriteriaRes, matRes] = await Promise.all([
        fetch(`/api/engagements/${engagementId}/par`),
        fetch(`/api/engagements/${engagementId}`),
        fetch(`/api/engagements/${engagementId}/trial-balance`),
        fetch('/api/methodology-admin/fs-lines'),
        fetch('/api/methodology-admin/risk-tables?tableType=par_criteria'),
        fetch(`/api/engagements/${engagementId}/materiality`),
      ]);

      // Load PAR significance criteria from Firm Wide Assumptions
      if (parCriteriaRes.ok) {
        const d = await parCriteriaRes.json();
        if (d.table?.data) setParCriteria(d.table.data);
      }

      // Load materiality values for threshold comparison
      if (matRes.ok) {
        const d = await matRes.json();
        const matData = d.data || {};
        // These would be the calculated values — for now read from saved data
        setMaterialityValues({
          materiality: Number(matData.materiality_calculated) || 0,
          pm: Number(matData.pm_calculated) || 0,
          ct: Number(matData.ct_calculated) || 0,
        });
      }

      // Get FS line ordering from methodology admin
      let fsLineOrder: Record<string, number> = {};
      let fsLineCategories: Record<string, string> = {};
      if (fsLinesRes.ok) {
        const fsData = await fsLinesRes.json();
        const fsLines = fsData.fsLines || [];
        fsLines.forEach((fl: any, idx: number) => {
          fsLineOrder[fl.name] = fl.sortOrder ?? idx;
          fsLineCategories[fl.name] = fl.fsCategory || '';
        });
      }

      let existingRows: PARRow[] = [];
      if (parRes.ok) {
        const json = await parRes.json();
        existingRows = (json.rows || []).map((r: any) => ({
          ...r,
          sendMgt: r.sendMgt || { checked: false },
          accepted: r.accepted || {},
        }));
        if (json.absVarThreshold != null) setAbsVarThreshold(json.absVarThreshold);
      }

      // Load TB data for auto-population
      let tbRows: TBRow[] = [];
      if (tbRes.ok) {
        const tbJson = await tbRes.json();
        tbRows = (tbJson.rows || []).filter((r: any) => r.fsLevel || r.fsStatement);
      }

      if (engRes.ok) {
        const eng = await engRes.json();
        const period = eng.period || eng.engagement?.period;
        if (period) {
          setPeriodEnd(formatDate(period.endDate));
          const start = new Date(period.startDate);
          start.setDate(start.getDate() - 1);
          setPeriodStartMinus1(formatDate(start));
        }
      }

      // Auto-populate from TB if PAR is empty, or refresh amounts from TB
      if (existingRows.length === 0 && tbRows.length > 0) {
        // First time: build entirely from TB with methodology ordering
        const built = buildRowsFromTB(tbRows, fsLineOrder);
        setRows(built);
        setInitialRows(built);
      } else if (existingRows.length > 0 && tbRows.length > 0) {
        // Update existing rows' CY/PY from TB (keep user edits to other fields)
        const tbSummary = buildTBSummary(tbRows);
        const updated = existingRows.map(r => {
          if (r.isSection) return r;
          const key = r.particulars;
          const tbData = tbSummary[key];
          if (tbData) {
            return { ...r, currentYear: Math.round(tbData.cy * 100) / 100, priorYear: Math.round(tbData.py * 100) / 100 };
          }
          return r;
        });
        setRows(updated);
        setInitialRows(updated);
      } else {
        setRows(existingRows);
        setInitialRows(existingRows);
      }
    } catch (err) { console.error('Failed to load:', err); }
    finally { setLoading(false); }
  }, [engagementId]);

  // Load PM from materiality
  useEffect(() => {
    async function loadPM() {
      try {
        const res = await fetch(`/api/engagements/${engagementId}/materiality`);
        if (res.ok) {
          const json = await res.json();
          const data = json.data || {};
          const pm = Number(data.performance_materiality);
          if (pm && pm > 0) { setPmThreshold(pm); return; }
          // Fallback: calculate from benchmark
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

  // Auto-calculate fields
  const computedRows = useMemo(() => {
    return rows.map(row => {
      const cy = row.currentYear;
      const py = row.priorYear;
      if (cy == null && py == null) return { ...row, absVariance: null, absVariancePercent: null, significantChange: '' };

      const cyVal = cy ?? 0;
      const pyVal = py ?? 0;
      const variance = Math.abs(cyVal - pyVal);
      const variancePct = pyVal !== 0 ? Math.round((Math.abs((cyVal - pyVal) / pyVal)) * 10000) / 100 : (cyVal !== 0 ? 100 : 0);

      let sigChange = '';
      if (cy != null || py != null) {
        // Get the threshold amount based on configured basis
        const basisMap: Record<string, number> = {
          'Materiality': materialityValues.materiality,
          'Performance Materiality': materialityValues.pm || (pmThreshold ?? 0),
          'Clearly Trivial': materialityValues.ct,
        };
        const thresholdAmount = basisMap[parCriteria.row1Basis] || (pmThreshold ?? 0);
        const thresholdPct = parCriteria.row2Pct ?? absVarThreshold;

        const test1 = variance > thresholdAmount; // Absolute variance > threshold
        const test2 = variancePct > thresholdPct;  // Variance % > threshold %

        const isMaterial = parCriteria.combinator === 'OR' ? (test1 || test2) : (test1 && test2);

        if (thresholdAmount > 0 || thresholdPct > 0) {
          sigChange = isMaterial ? 'Material' : 'Not Material';
        }
      }

      return { ...row, absVariance: variance, absVariancePercent: variancePct, significantChange: sigChange };
    });
  }, [rows, pmThreshold, absVarThreshold]);

  function addRow() {
    setRows(prev => [...prev, {
      id: '', particulars: '', currentYear: null, priorYear: null,
      absVariance: null, absVariancePercent: null, significantChange: '',
      sendMgt: { checked: false }, reasons: null, auditorView: null, accepted: {},
      sortOrder: prev.length,
    }]);
  }

  function updateRow(index: number, field: string, value: any) {
    setRows(prev => prev.map((r, i) => i === index ? { ...r, [field]: value } : r));
  }

  function removeRow(index: number) {
    setRows(prev => prev.filter((_, i) => i !== index));
  }

  function toggleSendMgtCheckbox(index: number) {
    const row = computedRows[index];
    const current = row.sendMgt || { checked: false };
    if (!current.checked) {
      // Mark as checked (orange)
      updateRow(index, 'sendMgt', {
        checked: true,
        checkedBy: `${userName || 'Unknown'}${userRole ? ` (${userRole})` : ''}`,
        checkedAt: new Date().toISOString(),
      });
    } else if (!current.sentAt) {
      // Uncheck
      updateRow(index, 'sendMgt', { checked: false });
    }
  }

  async function sendToManagement() {
    setSending(true);
    try {
      const itemsToSend = computedRows.filter(r => r.sendMgt?.checked && !r.sendMgt?.sentAt);
      if (itemsToSend.length === 0) { setSending(false); return; }

      const res = await fetch(`/api/engagements/${engagementId}/par/send-management`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: itemsToSend.map(r => ({
          id: r.id,
          particulars: r.particulars,
          currentYear: r.currentYear,
          priorYear: r.priorYear,
          absVariance: r.absVariance,
          absVariancePercent: r.absVariancePercent,
        })) }),
      });

      if (res.ok) {
        const now = new Date().toISOString();
        setRows(prev => prev.map(r => {
          if (r.sendMgt?.checked && !r.sendMgt?.sentAt) {
            return { ...r, sendMgt: { ...r.sendMgt, sentAt: now } };
          }
          return r;
        }));
      }
    } catch (err) { console.error('Send failed:', err); }
    finally { setSending(false); }
  }

  function toggleAccepted(index: number, role: 'operator' | 'reviewer' | 'partner') {
    const row = computedRows[index];
    const accepted = { ...(row.accepted || {}) };
    if (accepted[role]) {
      // Unclaim
      delete accepted[role];
    } else {
      const now = new Date().toISOString();
      accepted[role] = { name: userName || 'User', at: now };
      // Partner signs: also sign reviewer and operator
      if (role === 'partner') {
        if (!accepted.reviewer) accepted.reviewer = { name: userName || 'User', at: now };
        if (!accepted.operator) accepted.operator = { name: userName || 'User', at: now };
      }
    }
    updateRow(index, 'accepted', accepted);
  }

  if (loading) return <div className="py-8 text-center text-sm text-slate-400 animate-pulse">Loading PAR...</div>;

  const numCls = 'w-full border-0 bg-transparent text-xs text-right focus:outline-none focus:ring-1 focus:ring-blue-300 rounded px-1 py-0.5';
  const orangeCount = computedRows.filter(r => r.sendMgt?.checked && !r.sendMgt?.sentAt).length;
  const rmmCount = computedRows.filter(r => r.addedToRmm && !r.addedToRmmSent).length;
  const [sendingRmm, setSendingRmm] = useState(false);

  async function sendToRMM() {
    setSendingRmm(true);
    try {
      const itemsToSend = computedRows.filter(r => r.addedToRmm && !r.addedToRmmSent);
      if (itemsToSend.length === 0) { setSendingRmm(false); return; }

      const res = await fetch(`/api/engagements/${engagementId}/par/send-rmm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: itemsToSend.map(r => ({
            particulars: r.particulars,
            currentYear: r.currentYear,
            priorYear: r.priorYear,
            absVariance: r.absVariance,
            absVariancePercent: r.absVariancePercent,
            auditorView: r.auditorView,
            reasons: r.reasons,
            fsStatement: r.fsStatement,
          })),
        }),
      });

      if (res.ok) {
        // Mark as sent
        setRows(prev => prev.map(r => {
          if (r.addedToRmm && !(r as any).addedToRmmSent) {
            return { ...r, addedToRmmSent: true } as any;
          }
          return r;
        }));
      }
    } catch (err) { console.error('Send to RMM failed:', err); }
    setSendingRmm(false);
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-3 flex-shrink-0 flex-wrap gap-2">
        <div className="flex items-center gap-3">
          {pmThreshold !== null && (
            <span className="text-xs text-slate-400">PM: £{pmThreshold.toLocaleString()} | Var Threshold: {absVarThreshold}%</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {saving && <span className="text-xs text-blue-500 animate-pulse">Saving...</span>}
          {lastSaved && !saving && <span className="text-xs text-green-500">Saved</span>}
          {error && <span className="text-xs text-red-500">{error}</span>}
          {orangeCount > 0 && (
            <button onClick={sendToManagement} disabled={sending}
              className="text-xs px-3 py-1 bg-orange-500 text-white rounded hover:bg-orange-600 disabled:opacity-50">
              {sending ? 'Sending...' : `Send to Management (${orangeCount})`}
            </button>
          )}
          {rmmCount > 0 && (
            <button onClick={sendToRMM} disabled={sendingRmm}
              className="text-xs px-3 py-1 bg-purple-500 text-white rounded hover:bg-purple-600 disabled:opacity-50">
              {sendingRmm ? 'Sending...' : `Send to RMM (${rmmCount})`}
            </button>
          )}
          <button onClick={addRow} className="text-xs px-3 py-1 bg-blue-50 text-blue-600 rounded hover:bg-blue-100">+ Add Row</button>
        </div>
      </div>

      <div className="border border-slate-200 rounded-lg overflow-auto flex-1" style={{ minHeight: '300px', maxHeight: 'calc(100vh - 280px)' }}>
        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0 z-10">
            <tr className="bg-slate-100 border-b border-slate-200">
              <th className="text-left px-2 py-2 text-slate-500 font-medium w-44 whitespace-nowrap">Particulars</th>
              <th className="text-right px-2 py-2 text-slate-500 font-medium w-24 whitespace-nowrap">{periodEnd || 'Period End'}</th>
              <th className="text-right px-2 py-2 text-slate-500 font-medium w-24 whitespace-nowrap">{periodStartMinus1 || 'PY End'}</th>
              <th className="text-right px-2 py-2 text-slate-500 font-medium w-24 whitespace-nowrap">ABS Variance</th>
              <th className="text-right px-2 py-2 text-slate-500 font-medium w-20 whitespace-nowrap">ABS Var %</th>
              <th className="text-center px-2 py-2 text-slate-500 font-medium w-28 whitespace-nowrap">
                <span title="Material if ABS Variance > PM AND ABS Var % > Threshold">Significant Change</span>
              </th>
              <th className="text-center px-2 py-2 text-slate-500 font-medium w-20 whitespace-nowrap">
                <span title="Send to Management">Send Mgt</span>
              </th>
              <th className="text-left px-2 py-2 text-slate-500 font-medium min-w-[200px]">Reasons</th>
              <th className="text-left px-2 py-2 text-slate-500 font-medium min-w-[180px]">Auditor View</th>
              <th className="text-center px-2 py-2 text-slate-500 font-medium w-16 whitespace-nowrap" title="Add to Identifying & Assessing RMM">RMM</th>
              <th className="text-center px-2 py-2 text-slate-500 font-medium w-36 whitespace-nowrap">Accepted</th>
              <th className="w-6"></th>
            </tr>
          </thead>
          <tbody>
            {computedRows.length === 0 ? (
              <tr><td colSpan={12} className="text-center py-8 text-slate-400 italic">No PAR rows. Click &quot;+ Add Row&quot; or populate from Trial Balance.</td></tr>
            ) : computedRows.map((row, i) => {
              // Section header row
              if (row.isSection) {
                const sectionColor = row.particulars === 'P&L' ? 'bg-green-50 text-green-800' :
                  row.particulars === 'Balance Sheet' ? 'bg-blue-50 text-blue-800' :
                  row.particulars === 'Cashflow' ? 'bg-purple-50 text-purple-800' :
                  'bg-slate-100 text-slate-700';
                return (
                  <tr key={`section-${row.particulars}`} className={`${sectionColor} border-b border-slate-200`}>
                    <td colSpan={12} className="px-3 py-1.5 font-semibold text-xs tracking-wide uppercase">{row.particulars}</td>
                  </tr>
                );
              }
              const mgt = row.sendMgt || { checked: false };
              const acc = row.accepted || {};
              return (
                <tr key={row.id || `new-${i}`} className={`border-b border-slate-100 hover:bg-slate-50/50 ${row.significantChange === 'Material' ? 'bg-yellow-50/30' : ''}`}>
                  <td className="px-2 py-0.5">
                    <input type="text" value={row.particulars} onChange={e => updateRow(i, 'particulars', e.target.value)}
                      className="w-full border-0 bg-transparent text-xs focus:outline-none focus:ring-1 focus:ring-blue-300 rounded px-1 py-0.5" placeholder="Line item..." />
                  </td>
                  <td className="px-2 py-0.5">
                    <input type="number" value={row.currentYear ?? ''} onChange={e => updateRow(i, 'currentYear', e.target.value ? Number(e.target.value) : null)} className={numCls} step="0.01" />
                  </td>
                  <td className="px-2 py-0.5">
                    <input type="number" value={row.priorYear ?? ''} onChange={e => updateRow(i, 'priorYear', e.target.value ? Number(e.target.value) : null)} className={numCls} step="0.01" />
                  </td>
                  {/* ABS Variance = |CY - PY| */}
                  <td className="px-2 py-0.5 text-right text-slate-500 font-mono">
                    {row.absVariance != null && row.absVariance > 0 ? row.absVariance.toLocaleString(undefined, { maximumFractionDigits: 0 }) : ''}
                  </td>
                  {/* ABS Var % = |CY-PY|/PY * 100, rounded 2dp */}
                  <td className="px-2 py-0.5 text-right text-slate-500 font-mono">
                    {row.absVariancePercent != null && (row.currentYear != null || row.priorYear != null) ? `${row.absVariancePercent.toFixed(2)}%` : ''}
                  </td>
                  {/* Significant Change */}
                  <td className="px-2 py-0.5 text-center">
                    {row.significantChange === 'Material' ? (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 text-[10px] font-medium">Material</span>
                    ) : row.significantChange === 'Not Material' ? (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-green-50 text-green-600 text-[10px] font-medium">Not Material</span>
                    ) : <span className="text-slate-300">—</span>}
                  </td>
                  {/* Send Mgt checkbox with status */}
                  <td className="px-2 py-0.5 text-center">
                    <div className="flex flex-col items-center gap-0.5">
                      <button
                        onClick={() => toggleSendMgtCheckbox(i)}
                        disabled={!!mgt.sentAt}
                        className={`w-5 h-5 rounded border-2 inline-flex items-center justify-center transition-colors ${
                          mgt.respondedAt ? 'bg-green-500 border-green-500 text-white' :
                          mgt.sentAt ? 'bg-blue-500 border-blue-500 text-white' :
                          mgt.checked ? 'bg-orange-400 border-orange-400 text-white' :
                          'border-slate-300 hover:border-orange-400'
                        }`}
                        title={mgt.respondedAt ? 'Client responded' : mgt.sentAt ? 'Sent to management' : mgt.checked ? 'Marked to send' : 'Mark to send'}
                      >
                        {(mgt.checked || mgt.sentAt) && <span className="text-[10px]">✓</span>}
                      </button>
                      {mgt.checkedBy && !mgt.sentAt && (
                        <span className="text-[8px] text-orange-500 leading-tight">{mgt.checkedBy}<br/>{fmtTimestamp(mgt.checkedAt)}</span>
                      )}
                      {mgt.sentAt && !mgt.respondedAt && (
                        <span className="text-[8px] text-blue-600 leading-tight">Sent<br/>{fmtTimestamp(mgt.sentAt)}</span>
                      )}
                      {mgt.respondedAt && (
                        <span className="text-[8px] text-green-700 leading-tight">Response<br/>{fmtTimestamp(mgt.respondedAt)}</span>
                      )}
                    </div>
                  </td>
                  {/* Reasons */}
                  <td className="px-2 py-0.5">
                    <textarea
                      value={row.reasons || ''}
                      onChange={e => updateRow(i, 'reasons', e.target.value || null)}
                      className="w-full border-0 bg-transparent text-xs focus:outline-none focus:ring-1 focus:ring-blue-300 rounded px-1 py-0.5 resize-none"
                      rows={1}
                      placeholder="Reason..."
                      onInput={(e) => { const t = e.target as HTMLTextAreaElement; t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; }}
                    />
                  </td>
                  {/* Auditor View — shows last client message inline, chat history + attachments as icons */}
                  <td className="px-2 py-0.5">
                    <div className="flex items-start gap-1">
                      <div className="flex-1">
                        {/* Last client message shown in the box if present */}
                        {mgt.respondedAt && (mgt as any).clientExplanation && !row.auditorView && (
                          <div className="text-xs text-blue-700 bg-blue-50 rounded px-1 py-0.5 mb-0.5 border border-blue-100">
                            {(() => {
                              const explanation = (mgt as any).clientExplanation as string;
                              // Get last meaningful line (not attachment/metadata)
                              const lines = explanation.split('\n').filter(l => l.trim() && !l.startsWith('['));
                              return lines[lines.length - 1] || explanation.split('\n')[0] || '';
                            })()}
                          </div>
                        )}
                        <textarea
                          value={row.auditorView || ''}
                          onChange={e => updateRow(i, 'auditorView', e.target.value || null)}
                          className="w-full border-0 bg-transparent text-xs focus:outline-none focus:ring-1 focus:ring-blue-300 rounded px-1 py-0.5 resize-none"
                          rows={1}
                          placeholder="Auditor view..."
                          onInput={(e) => { const t = e.target as HTMLTextAreaElement; t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; }}
                        />
                      </div>
                      {/* Chat history bubble — hover to see full conversation */}
                      {mgt.respondedAt && (
                        <div className="relative group flex-shrink-0 mt-0.5">
                          <button className="w-5 h-5 rounded bg-green-100 text-green-600 hover:bg-green-200 flex items-center justify-center text-[10px]" title="View full conversation">
                            💬
                          </button>
                          <div className="absolute right-0 top-6 z-20 bg-white border border-slate-200 rounded-lg shadow-lg p-2 min-w-[250px] max-h-56 overflow-y-auto hidden group-hover:block">
                            <p className="text-[9px] font-semibold text-slate-500 mb-1">Full Conversation</p>
                            <p className="text-[10px] text-slate-700 whitespace-pre-line">{(mgt as any).clientExplanation || row.reasons || ''}</p>
                          </div>
                        </div>
                      )}
                      {/* Attachment icon — separate */}
                      {row.reasons?.includes('[Attachments:') && (() => {
                        const match = row.reasons!.match(/\[Attachments:\s*(.+?)\]/);
                        const fileNames = match ? match[1].split(',').map(s => s.trim()) : [];
                        return fileNames.length > 0 ? (
                          <div className="relative group flex-shrink-0 mt-0.5">
                            <button className="w-5 h-5 rounded bg-blue-100 text-blue-600 hover:bg-blue-200 flex items-center justify-center text-[10px]" title={`${fileNames.length} attachment(s)`}>
                              📎
                            </button>
                            <div className="absolute right-0 top-6 z-20 bg-white border border-slate-200 rounded-lg shadow-lg p-2 min-w-[160px] hidden group-hover:block">
                              <p className="text-[9px] font-semibold text-slate-500 mb-1">Attachments</p>
                              {fileNames.map((name, fi) => (
                                <div key={fi} className="text-[10px] text-blue-600 hover:text-blue-800 py-0.5 cursor-pointer">
                                  📎 {name}
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null;
                      })()}
                    </div>
                  </td>
                  {/* Add to RMM checkbox — cannot be unchecked by junior */}
                  <td className="px-2 py-0.5 text-center">
                    {!row.isSection && (
                      <div className="flex flex-col items-center gap-0.5">
                        <input
                          type="checkbox"
                          checked={row.addedToRmm ?? false}
                          onChange={e => {
                            const adding = e.target.checked;
                            // Cannot uncheck if added by a more senior role
                            if (!adding && row.addedToRmmBy) {
                              const roleRank: Record<string, number> = { Junior: 0, Manager: 1, RI: 2 };
                              const myRank = roleRank[userRole || 'Junior'] ?? 0;
                              // Parse who added it
                              const addedRole = row.addedToRmmBy.match(/\((\w+)\)/)?.[1] || '';
                              const addedRank = roleRank[addedRole] ?? 0;
                              if (myRank < addedRank) return; // Can't delete senior's addition
                            }
                            updateRow(i, 'addedToRmm', adding);
                            if (adding) {
                              updateRow(i, 'addedToRmmBy', `${userName || 'Unknown'}${userRole ? ` (${userRole})` : ''}`);
                            }
                          }}
                          className="w-3.5 h-3.5 rounded border-slate-300"
                          title={row.addedToRmm ? `Added to RMM by ${row.addedToRmmBy || 'Unknown'}` : 'Add to Identifying & Assessing RMM'}
                        />
                        {row.addedToRmm && row.addedToRmmBy && (
                          <span className="text-[7px] text-purple-600 leading-tight">{row.addedToRmmBy}</span>
                        )}
                      </div>
                    )}
                  </td>
                  {/* Accepted dots */}
                  <td className="px-2 py-0.5">
                    <div className="flex items-start gap-1.5 justify-center">
                      {(['operator', 'reviewer', 'partner'] as const).map(role => {
                        const dot = acc[role];
                        const label = role === 'operator' ? 'Pr' : role === 'reviewer' ? 'Rv' : 'Pt';
                        return (
                          <div key={role} className="flex flex-col items-center">
                            <span className="text-[7px] text-slate-400 leading-none mb-0.5">{label}</span>
                            <button
                              onClick={() => toggleAccepted(i, role)}
                              className={`w-4 h-4 rounded-full border-2 transition-colors ${
                                dot ? 'bg-green-500 border-green-500' : 'border-slate-300 hover:border-green-400'
                              }`}
                              title={dot ? `${dot.name} - ${fmtTimestamp(dot.at)}` : `Sign as ${role}`}
                            />
                            {dot && (
                              <span className="text-[6px] text-green-600 leading-tight mt-0.5 text-center max-w-[40px] truncate" title={`${dot.name} ${fmtTimestamp(dot.at)}`}>
                                {dot.name.split(' ')[0]}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </td>
                  <td className="px-2 py-0.5">
                    <button onClick={() => removeRow(i)} className="text-red-400 hover:text-red-600">×</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
