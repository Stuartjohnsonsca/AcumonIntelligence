'use client';

import { useState, useEffect, useMemo } from 'react';
import { ChevronDown, ChevronRight, Loader2, Plus, Trash2 } from 'lucide-react';

const STATEMENT_ORDER = ['Profit & Loss', 'Balance Sheet', 'Cash Flow Statement', 'Notes'];

function f(n: number): string {
  if (n === 0) return '—';
  const abs = Math.abs(n);
  const s = abs.toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return n < 0 ? `(${s})` : s;
}

interface TBRow { id: string; accountCode: string; description: string; fsStatement: string | null; fsLevel: string | null; fsNoteLevel: string | null; currentYear: number | null; priorYear: number | null; }
interface ErrEntry { id: string; fsLine: string; accountCode: string | null; description: string; errorAmount: number; errorType: string; }
interface AdjRow { accountCode: string; description: string; fsStatement: string; fsLevel: string; dr: number; cr: number; reference: string; }

export function AdjustedTBPanel({ engagementId }: { engagementId: string }) {
  const [tbRows, setTbRows] = useState<TBRow[]>([]);
  const [errors, setErrors] = useState<ErrEntry[]>([]);
  const [manualAdjs, setManualAdjs] = useState<AdjRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    (async () => {
      try {
        const [tbRes, errRes] = await Promise.all([
          fetch(`/api/engagements/${engagementId}/trial-balance`),
          fetch(`/api/engagements/${engagementId}/error-schedule`),
        ]);
        if (tbRes.ok) setTbRows((await tbRes.json()).rows || []);
        if (errRes.ok) setErrors((await errRes.json()).errors || []);
      } catch {} finally { setLoading(false); }
    })();
  }, [engagementId]);

  // Build adjustment map by account code
  const adjByAccount = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of errors) {
      if (e.accountCode) {
        m.set(e.accountCode, (m.get(e.accountCode) || 0) + e.errorAmount);
      }
    }
    // Also include manual adjustments
    for (const a of manualAdjs) {
      const net = a.dr - a.cr;
      m.set(a.accountCode, (m.get(a.accountCode) || 0) + net);
    }
    return m;
  }, [errors, manualAdjs]);

  // Build hierarchy: Statement → Level → accounts
  const hierarchy = useMemo(() => {
    const stmtMap = new Map<string, Map<string, TBRow[]>>();
    for (const s of STATEMENT_ORDER) stmtMap.set(s, new Map());
    for (const row of tbRows) {
      const stmt = row.fsStatement || 'Unclassified';
      if (!stmtMap.has(stmt)) stmtMap.set(stmt, new Map());
      const levels = stmtMap.get(stmt)!;
      const level = row.fsLevel || 'Other';
      if (!levels.has(level)) levels.set(level, []);
      levels.get(level)!.push(row);
    }
    return stmtMap;
  }, [tbRows]);

  function toggle(key: string) { setExpanded(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; }); }

  function addManualAdj() {
    setManualAdjs(prev => [...prev, { accountCode: '', description: '', fsStatement: 'Balance Sheet', fsLevel: '', dr: 0, cr: 0, reference: '' }]);
  }

  if (loading) return <div className="p-6 text-center"><Loader2 className="h-5 w-5 animate-spin text-slate-400 mx-auto" /></div>;

  // Totals
  const totalOrigCY = tbRows.reduce((s, r) => s + (Number(r.currentYear) || 0), 0);
  const totalAdj = Array.from(adjByAccount.values()).reduce((s, v) => s + v, 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-slate-700">Adjusted Trial Balance</h3>
        <button onClick={addManualAdj} className="inline-flex items-center gap-1 text-[10px] px-2.5 py-1 bg-blue-50 text-blue-700 border border-blue-200 rounded hover:bg-blue-100">
          <Plus className="h-3 w-3" /> Add Adjustment
        </button>
      </div>

      {/* Manual adjustments entry */}
      {manualAdjs.length > 0 && (
        <div className="border rounded-lg overflow-hidden">
          <div className="bg-amber-50 px-3 py-1.5 text-[10px] font-semibold text-amber-700 uppercase">Manual Adjustments</div>
          <table className="w-full text-[10px]">
            <thead><tr className="bg-slate-50 border-b text-[9px] text-slate-500 uppercase">
              <th className="px-2 py-1 text-left w-20">Code</th>
              <th className="px-2 py-1 text-left">Description</th>
              <th className="px-2 py-1 text-left w-28">FS Statement</th>
              <th className="px-2 py-1 text-left w-28">FS Level</th>
              <th className="px-2 py-1 text-right w-16">Dr</th>
              <th className="px-2 py-1 text-right w-16">Cr</th>
              <th className="px-2 py-1 text-left w-16">Ref</th>
              <th className="px-2 py-1 w-6"></th>
            </tr></thead>
            <tbody>
              {manualAdjs.map((adj, i) => (
                <tr key={i} className="border-b border-slate-100">
                  <td className="px-1 py-0.5"><input type="text" value={adj.accountCode} onChange={e => { const v = [...manualAdjs]; v[i] = { ...v[i], accountCode: e.target.value }; setManualAdjs(v); }} className="w-full border rounded px-1 py-0.5 text-[10px]" placeholder="Code" /></td>
                  <td className="px-1 py-0.5"><input type="text" value={adj.description} onChange={e => { const v = [...manualAdjs]; v[i] = { ...v[i], description: e.target.value }; setManualAdjs(v); }} className="w-full border rounded px-1 py-0.5 text-[10px]" placeholder="Description" /></td>
                  <td className="px-1 py-0.5"><select value={adj.fsStatement} onChange={e => { const v = [...manualAdjs]; v[i] = { ...v[i], fsStatement: e.target.value }; setManualAdjs(v); }} className="w-full border rounded px-1 py-0.5 text-[10px]">{STATEMENT_ORDER.map(s => <option key={s}>{s}</option>)}</select></td>
                  <td className="px-1 py-0.5"><input type="text" value={adj.fsLevel} onChange={e => { const v = [...manualAdjs]; v[i] = { ...v[i], fsLevel: e.target.value }; setManualAdjs(v); }} className="w-full border rounded px-1 py-0.5 text-[10px]" placeholder="FS Level" /></td>
                  <td className="px-1 py-0.5"><input type="number" value={adj.dr || ''} onChange={e => { const v = [...manualAdjs]; v[i] = { ...v[i], dr: Number(e.target.value) || 0 }; setManualAdjs(v); }} className="w-full border rounded px-1 py-0.5 text-[10px] text-right" /></td>
                  <td className="px-1 py-0.5"><input type="number" value={adj.cr || ''} onChange={e => { const v = [...manualAdjs]; v[i] = { ...v[i], cr: Number(e.target.value) || 0 }; setManualAdjs(v); }} className="w-full border rounded px-1 py-0.5 text-[10px] text-right" /></td>
                  <td className="px-1 py-0.5"><input type="text" value={adj.reference} onChange={e => { const v = [...manualAdjs]; v[i] = { ...v[i], reference: e.target.value }; setManualAdjs(v); }} className="w-full border rounded px-1 py-0.5 text-[10px]" /></td>
                  <td className="px-1 py-0.5"><button onClick={() => setManualAdjs(prev => prev.filter((_, j) => j !== i))} className="text-red-400 hover:text-red-600"><Trash2 className="h-3 w-3" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Adjusted TB by Statement → Level → Account */}
      <div className="space-y-2">
        {Array.from(hierarchy.entries()).map(([stmt, levels]) => {
          if (levels.size === 0) return null;
          const stmtKey = `s:${stmt}`;
          const isOpen = expanded.has(stmtKey);
          const allRows = Array.from(levels.values()).flat();
          const stmtOrigCY = allRows.reduce((s, r) => s + (Number(r.currentYear) || 0), 0);
          const stmtAdj = allRows.reduce((s, r) => s + (adjByAccount.get(r.accountCode) || 0), 0);
          const stmtAdjCY = stmtOrigCY + stmtAdj;

          return (
            <div key={stmt} className="bg-slate-50 rounded-lg border overflow-hidden">
              <button onClick={() => toggle(stmtKey)} className="w-full flex items-center justify-between px-3 py-2 hover:bg-slate-100 transition-colors">
                <div className="flex items-center gap-2">
                  {isOpen ? <ChevronDown className="h-3.5 w-3.5 text-slate-400" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-400" />}
                  <span className="text-xs font-bold text-slate-800">{stmt}</span>
                </div>
                <div className="flex items-center gap-4 text-[10px] font-mono">
                  <div className="w-20 text-right"><span className="text-slate-400 text-[8px] block">Original</span>{f(stmtOrigCY)}</div>
                  <div className={`w-20 text-right ${stmtAdj !== 0 ? 'text-amber-600 font-semibold' : 'text-slate-300'}`}><span className="text-slate-400 text-[8px] block">Adjustments</span>{stmtAdj !== 0 ? f(stmtAdj) : '—'}</div>
                  <div className="w-20 text-right font-semibold"><span className="text-slate-400 text-[8px] block">Adjusted</span>{f(stmtAdjCY)}</div>
                </div>
              </button>

              {isOpen && (
                <div className="px-2 pb-2 space-y-1">
                  {Array.from(levels.entries()).map(([level, rows]) => {
                    const levelKey = `l:${stmt}:${level}`;
                    const isLevelOpen = expanded.has(levelKey);
                    const lOrigCY = rows.reduce((s, r) => s + (Number(r.currentYear) || 0), 0);
                    const lAdj = rows.reduce((s, r) => s + (adjByAccount.get(r.accountCode) || 0), 0);

                    return (
                      <div key={level} className="bg-white rounded border border-slate-200 overflow-hidden">
                        <button onClick={() => toggle(levelKey)} className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-slate-50 transition-colors">
                          <div className="flex items-center gap-1.5">
                            {isLevelOpen ? <ChevronDown className="h-3 w-3 text-slate-400" /> : <ChevronRight className="h-3 w-3 text-slate-400" />}
                            <span className="text-[11px] font-semibold text-slate-700">{level}</span>
                          </div>
                          <div className="flex items-center gap-3 text-[10px] font-mono">
                            <span className="w-18 text-right">{f(lOrigCY)}</span>
                            <span className={`w-18 text-right ${lAdj !== 0 ? 'text-amber-600' : 'text-slate-300'}`}>{lAdj !== 0 ? f(lAdj) : '—'}</span>
                            <span className="w-18 text-right font-semibold">{f(lOrigCY + lAdj)}</span>
                          </div>
                        </button>
                        {isLevelOpen && (
                          <table className="w-full text-[10px] border-t">
                            <thead><tr className="bg-slate-50/50 border-b text-[9px] text-slate-500 uppercase">
                              <th className="px-1.5 py-1 text-left w-16">Code</th>
                              <th className="px-1.5 py-1 text-left">Description</th>
                              <th className="px-1.5 py-1 text-right w-18">Original</th>
                              <th className="px-1.5 py-1 text-right w-18">Adjustment</th>
                              <th className="px-1.5 py-1 text-right w-18">Adjusted</th>
                            </tr></thead>
                            <tbody>
                              {rows.map(r => {
                                const orig = Number(r.currentYear) || 0;
                                const adj = adjByAccount.get(r.accountCode) || 0;
                                return (
                                  <tr key={r.id} className="border-b border-slate-100/50">
                                    <td className="px-1.5 py-0.5 font-mono text-slate-400">{r.accountCode}</td>
                                    <td className="px-1.5 py-0.5 text-slate-700">{r.description}</td>
                                    <td className="px-1.5 py-0.5 text-right font-mono">{f(orig)}</td>
                                    <td className={`px-1.5 py-0.5 text-right font-mono ${adj !== 0 ? 'text-amber-600 font-semibold' : 'text-slate-300'}`}>{adj !== 0 ? f(adj) : '—'}</td>
                                    <td className="px-1.5 py-0.5 text-right font-mono font-semibold">{f(orig + adj)}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer totals */}
      <div className="bg-slate-100 rounded-lg px-4 py-2 flex items-center justify-between text-xs">
        <span className="font-bold text-slate-700">Total</span>
        <div className="flex items-center gap-4 font-mono">
          <span className="w-20 text-right">Original: {f(totalOrigCY)}</span>
          <span className={`w-20 text-right ${totalAdj !== 0 ? 'text-amber-600 font-semibold' : ''}`}>Adj: {totalAdj !== 0 ? f(totalAdj) : '—'}</span>
          <span className="w-20 text-right font-bold">Adjusted: {f(totalOrigCY + totalAdj)}</span>
        </div>
      </div>
    </div>
  );
}
