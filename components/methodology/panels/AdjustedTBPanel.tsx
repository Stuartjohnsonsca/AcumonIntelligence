'use client';

import { useState, useEffect, useMemo } from 'react';
import { ChevronDown, ChevronRight, Loader2, Plus, Trash2 } from 'lucide-react';

const STATEMENT_ORDER = ['Profit & Loss', 'Balance Sheet', 'Cash Flow Statement', 'Notes'];
const COL = 'grid grid-cols-[1fr_80px_80px_80px] gap-0 items-center';
const COL_ACC = 'grid grid-cols-[60px_1fr_80px_80px_80px] gap-0 items-center';

function f(n: number): string {
  if (n === 0) return '—';
  const abs = Math.abs(n);
  const s = abs.toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return n < 0 ? `(${s})` : s;
}

interface TBRow { id: string; accountCode: string; description: string; fsStatement: string | null; fsLevel: string | null; fsNoteLevel: string | null; currentYear: number | null; priorYear: number | null; }
interface ErrEntry { id: string; fsLine: string; accountCode: string | null; errorAmount: number; errorType: string; }
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

  const adjByAccount = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of errors) { if (e.accountCode) m.set(e.accountCode, (m.get(e.accountCode) || 0) + e.errorAmount); }
    for (const a of manualAdjs) { m.set(a.accountCode, (m.get(a.accountCode) || 0) + a.dr - a.cr); }
    return m;
  }, [errors, manualAdjs]);

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

  if (loading) return <div className="p-6 text-center"><Loader2 className="h-5 w-5 animate-spin text-slate-400 mx-auto" /></div>;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-slate-700">Adjusted Trial Balance</h3>
        <button onClick={() => setManualAdjs(prev => [...prev, { accountCode: '', description: '', fsStatement: 'Balance Sheet', fsLevel: '', dr: 0, cr: 0, reference: '' }])} className="inline-flex items-center gap-1 text-[10px] px-2.5 py-1 bg-blue-50 text-blue-700 border border-blue-200 rounded hover:bg-blue-100">
          <Plus className="h-3 w-3" /> Add Adjustment
        </button>
      </div>

      {/* Column headers */}
      <div className={`${COL} px-3 text-[9px] font-semibold text-slate-500 uppercase`}>
        <div>FS Line</div>
        <div className="text-right">Original</div>
        <div className="text-right">Adjustments</div>
        <div className="text-right">Adjusted</div>
      </div>

      {/* Manual adjustments */}
      {manualAdjs.length > 0 && (
        <div className="border rounded-lg overflow-hidden">
          <div className="bg-amber-50 px-3 py-1 text-[9px] font-semibold text-amber-700 uppercase">Manual Adjustments</div>
          {manualAdjs.map((adj, i) => (
            <div key={i} className="flex items-center gap-1 px-2 py-0.5 border-t text-[10px]">
              <input type="text" value={adj.accountCode} onChange={e => { const v = [...manualAdjs]; v[i] = { ...v[i], accountCode: e.target.value }; setManualAdjs(v); }} className="w-14 border rounded px-1 py-0.5 text-[10px]" placeholder="Code" />
              <input type="text" value={adj.description} onChange={e => { const v = [...manualAdjs]; v[i] = { ...v[i], description: e.target.value }; setManualAdjs(v); }} className="flex-1 border rounded px-1 py-0.5 text-[10px]" placeholder="Description" />
              <input type="number" value={adj.dr || ''} onChange={e => { const v = [...manualAdjs]; v[i] = { ...v[i], dr: Number(e.target.value) || 0 }; setManualAdjs(v); }} className="w-16 border rounded px-1 py-0.5 text-[10px] text-right" placeholder="Dr" />
              <input type="number" value={adj.cr || ''} onChange={e => { const v = [...manualAdjs]; v[i] = { ...v[i], cr: Number(e.target.value) || 0 }; setManualAdjs(v); }} className="w-16 border rounded px-1 py-0.5 text-[10px] text-right" placeholder="Cr" />
              <button onClick={() => setManualAdjs(prev => prev.filter((_, j) => j !== i))} className="text-red-400 hover:text-red-600"><Trash2 className="h-3 w-3" /></button>
            </div>
          ))}
        </div>
      )}

      {/* Statement cards */}
      {Array.from(hierarchy.entries()).map(([stmt, levels]) => {
        if (levels.size === 0) return null;
        const stmtKey = `s:${stmt}`;
        const isOpen = expanded.has(stmtKey);
        const allRows = Array.from(levels.values()).flat();
        const orig = allRows.reduce((s, r) => s + (Number(r.currentYear) || 0), 0);
        const adj = allRows.reduce((s, r) => s + (adjByAccount.get(r.accountCode) || 0), 0);

        return (
          <div key={stmt} className="bg-slate-50 rounded-lg border overflow-hidden">
            <button onClick={() => toggle(stmtKey)} className={`w-full ${COL} px-3 py-2 hover:bg-slate-100 transition-colors text-xs`}>
              <div className="flex items-center gap-2 text-left">
                {isOpen ? <ChevronDown className="h-3.5 w-3.5 text-slate-400" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-400" />}
                <span className="font-bold text-slate-800">{stmt}</span>
              </div>
              <div className="text-right font-mono">{f(orig)}</div>
              <div className={`text-right font-mono ${adj !== 0 ? 'text-amber-600 font-semibold' : 'text-slate-300'}`}>{adj !== 0 ? f(adj) : '—'}</div>
              <div className="text-right font-mono font-semibold">{f(orig + adj)}</div>
            </button>

            {isOpen && (
              <div className="px-2 pb-2 space-y-1">
                {Array.from(levels.entries()).map(([level, rows]) => {
                  const levelKey = `l:${stmt}:${level}`;
                  const isLevelOpen = expanded.has(levelKey);
                  const lOrig = rows.reduce((s, r) => s + (Number(r.currentYear) || 0), 0);
                  const lAdj = rows.reduce((s, r) => s + (adjByAccount.get(r.accountCode) || 0), 0);

                  return (
                    <div key={level} className="bg-white rounded border border-slate-200 overflow-hidden">
                      <button onClick={() => toggle(levelKey)} className={`w-full ${COL} px-3 py-1.5 hover:bg-slate-50 transition-colors text-[11px]`}>
                        <div className="flex items-center gap-1.5 text-left">
                          {isLevelOpen ? <ChevronDown className="h-3 w-3 text-slate-400" /> : <ChevronRight className="h-3 w-3 text-slate-400" />}
                          <span className="font-semibold text-slate-700">{level}</span>
                        </div>
                        <div className="text-right font-mono text-[10px]">{f(lOrig)}</div>
                        <div className={`text-right font-mono text-[10px] ${lAdj !== 0 ? 'text-amber-600' : 'text-slate-300'}`}>{lAdj !== 0 ? f(lAdj) : '—'}</div>
                        <div className="text-right font-mono text-[10px] font-semibold">{f(lOrig + lAdj)}</div>
                      </button>
                      {isLevelOpen && (
                        <div className="border-t">
                          {rows.map(r => {
                            const rOrig = Number(r.currentYear) || 0;
                            const rAdj = adjByAccount.get(r.accountCode) || 0;
                            return (
                              <div key={r.id} className={`${COL_ACC} px-2 py-0.5 border-b border-slate-100/50 text-[10px]`}>
                                <span className="font-mono text-slate-400">{r.accountCode}</span>
                                <span className="text-slate-700 truncate">{r.description}</span>
                                <span className="text-right font-mono">{f(rOrig)}</span>
                                <span className={`text-right font-mono ${rAdj !== 0 ? 'text-amber-600 font-semibold' : 'text-slate-300'}`}>{rAdj !== 0 ? f(rAdj) : '—'}</span>
                                <span className="text-right font-mono font-semibold">{f(rOrig + rAdj)}</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {/* Footer */}
      {(() => {
        const tOrig = tbRows.reduce((s, r) => s + (Number(r.currentYear) || 0), 0);
        const tAdj = Array.from(adjByAccount.values()).reduce((s, v) => s + v, 0);
        return (
          <div className={`${COL} px-3 py-2 bg-slate-100 rounded-lg text-xs font-mono`}>
            <span className="font-bold text-slate-700">Total</span>
            <span className="text-right">{f(tOrig)}</span>
            <span className={`text-right ${tAdj !== 0 ? 'text-amber-600 font-semibold' : ''}`}>{tAdj !== 0 ? f(tAdj) : '—'}</span>
            <span className="text-right font-bold">{f(tOrig + tAdj)}</span>
          </div>
        );
      })()}
    </div>
  );
}
