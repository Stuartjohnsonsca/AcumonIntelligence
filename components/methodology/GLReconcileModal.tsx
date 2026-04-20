'use client';

import { useEffect, useMemo, useState } from 'react';
import { X, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';

/**
 * GL Reconcile modal — lets the auditor resolve grey / red GL Check
 * dots on the TBCYvPY tab by manually grouping TB rows and GL account
 * codes.
 *
 * Left column: outstanding TB rows (grey = no GL data, red = GL data
 * disagrees). Right column: GL accounts from the uploaded file that
 * aren't already reconciled elsewhere. Checkbox both sides; footer
 * shows the live delta between the selected TB "movement to explain"
 * and the selected GL "movement available". When the two agree within
 * the rounding tolerance the Commit button flips the selected TB rows
 * to green permanently (via the /general-ledger reconcile endpoint).
 *
 * The modal closes automatically once there are no outstanding rows
 * left to review.
 */

export interface GlCheck {
  rowId: string;
  accountCode: string;
  status: 'green' | 'red' | 'no-data';
  priorYear: number;
  glMovement: number;
  pnlAdjustment: number;
  expected: number;
  actual: number;
  difference: number;
  message: string;
}

export interface TbRowForReconcile {
  id: string;
  accountCode: string;
  description: string;
  fsStatement: string | null;
  currentYear: number | null;
  priorYear: number | null;
}

interface Props {
  engagementId: string;
  tbRows: TbRowForReconcile[];
  checks: GlCheck[];
  byAccount: Record<string, number>;
  onClose: () => void;
  onCommitted: () => void;
}

const TOLERANCE = 0.01;

function fmt(n: number): string {
  const abs = Math.abs(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `(£${abs})` : `£${abs}`;
}

function isPnlStatement(stmt: string | null | undefined) {
  const s = (stmt || '').toLowerCase();
  return s.includes('profit') || s === 'pnl' || s.includes('loss') || s.includes('income');
}

/** What each TB row needs to "explain" in the reconcile — for P&L
 *  rows it's simply the CY (opening = 0); for Balance Sheet rows it's
 *  the CY movement (CY − PY). */
function movementToExplain(row: TbRowForReconcile): number {
  const cy = Number(row.currentYear) || 0;
  const py = Number(row.priorYear) || 0;
  return isPnlStatement(row.fsStatement) ? cy : cy - py;
}

export function GLReconcileModal({ engagementId, tbRows, checks, byAccount, onClose, onCommitted }: Props) {
  const [selectedTbIds, setSelectedTbIds] = useState<Set<string>>(new Set());
  const [selectedGlCodes, setSelectedGlCodes] = useState<Set<string>>(new Set());
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only rows the auditor still needs to look at — green dots are
  // filtered out (including those already reconciled), leaving grey
  // (no-data) and red (disagrees).
  const outstanding = useMemo(() => {
    const byId = new Map(tbRows.map(r => [r.id, r]));
    return checks
      .filter(c => c.status !== 'green')
      .map(c => ({ check: c, row: byId.get(c.rowId) }))
      .filter((x): x is { check: GlCheck; row: TbRowForReconcile } => !!x.row);
  }, [tbRows, checks]);

  // GL account codes already perfectly reconciled (status green) should
  // not appear on the right — they're done. We also hide codes whose
  // movement is zero (pure balancing clutter).
  const claimedGlCodes = useMemo(() => {
    const claimed = new Set<string>();
    for (const c of checks) if (c.status === 'green' && c.accountCode) claimed.add(c.accountCode);
    return claimed;
  }, [checks]);

  // Map account code → TB description so the GL column can show the
  // human-readable account name alongside the code. TB is the canonical
  // source — if the GL has a code that isn't in TB (often the reason
  // for a grey dot) we leave the description blank.
  const codeToDescription = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of tbRows) {
      if (r.accountCode && r.description && !m.has(r.accountCode)) {
        m.set(r.accountCode, r.description);
      }
    }
    return m;
  }, [tbRows]);

  const glRows = useMemo(() => {
    return Object.entries(byAccount)
      .filter(([code, amt]) => !claimedGlCodes.has(code) && Math.abs(amt) > 0.005)
      .map(([code, amt]) => ({ code, amount: amt, description: codeToDescription.get(code) || '' }))
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  }, [byAccount, claimedGlCodes, codeToDescription]);

  // Auto-close when no outstanding rows remain
  useEffect(() => {
    if (outstanding.length === 0) {
      const t = setTimeout(() => onClose(), 400);
      return () => clearTimeout(t);
    }
  }, [outstanding.length, onClose]);

  // Live totals. Left = sum of "movement to explain" across selected
  // TB rows. Right = sum of the GL column movements for selected codes.
  const tbSelectedTotal = useMemo(() => {
    let t = 0;
    for (const { row } of outstanding) {
      if (selectedTbIds.has(row.id)) t += movementToExplain(row);
    }
    return t;
  }, [outstanding, selectedTbIds]);

  const glSelectedTotal = useMemo(() => {
    let t = 0;
    for (const code of selectedGlCodes) t += byAccount[code] || 0;
    return t;
  }, [selectedGlCodes, byAccount]);

  const delta = tbSelectedTotal - glSelectedTotal;
  const agrees = Math.abs(delta) < TOLERANCE && selectedTbIds.size > 0;

  function toggleTb(id: string) {
    setSelectedTbIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleGl(code: string) {
    setSelectedGlCodes(prev => { const n = new Set(prev); n.has(code) ? n.delete(code) : n.add(code); return n; });
  }

  async function commit() {
    if (!agrees) return;
    setCommitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/engagements/${engagementId}/general-ledger`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reconcile', rowIds: Array.from(selectedTbIds) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setSelectedTbIds(new Set());
      setSelectedGlCodes(new Set());
      onCommitted();
    } catch (err: any) {
      setError(err?.message || 'Commit failed');
    } finally {
      setCommitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[70] bg-black/60 flex items-center justify-center p-4" onClick={() => !committing && onClose()}>
      <div className="bg-white rounded-lg shadow-2xl max-w-5xl w-full max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">GL Reconcile — resolve grey &amp; red dots</h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Tick TB rows on the left and GL codes on the right. When the totals agree, hit Commit to turn those TB dots green.
            </p>
          </div>
          <button onClick={onClose} disabled={committing} className="text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></button>
        </div>

        {outstanding.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center p-10 text-center">
            <CheckCircle2 className="h-10 w-10 text-green-500 mb-2" />
            <p className="text-sm font-semibold text-slate-800">Everything reconciles.</p>
            <p className="text-xs text-slate-500 mt-1">No grey or red dots left. Closing…</p>
          </div>
        ) : (
          <>
            <div className="flex-1 grid grid-cols-2 gap-0 overflow-hidden">
              {/* LEFT — outstanding TB rows */}
              <div className="flex flex-col border-r border-slate-200 min-h-0">
                <div className="px-4 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-700">Trial Balance ({outstanding.length})</span>
                  <button
                    onClick={() => {
                      if (selectedTbIds.size === outstanding.length) setSelectedTbIds(new Set());
                      else setSelectedTbIds(new Set(outstanding.map(o => o.row.id)));
                    }}
                    className="text-[10px] text-blue-600 hover:text-blue-800"
                  >
                    {selectedTbIds.size === outstanding.length ? 'Clear all' : 'Select all'}
                  </button>
                </div>
                <div className="flex-1 overflow-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-white border-b border-slate-200">
                      <tr className="text-[10px] text-slate-500">
                        <th className="w-8 px-1 py-1"></th>
                        <th className="text-left px-2 py-1">Code</th>
                        <th className="text-left px-2 py-1">Description</th>
                        <th className="text-right px-2 py-1">Movement</th>
                        <th className="text-center px-2 py-1" title="grey = no G/L data, red = disagrees">Dot</th>
                      </tr>
                    </thead>
                    <tbody>
                      {outstanding.map(({ check, row }) => {
                        const move = movementToExplain(row);
                        const selected = selectedTbIds.has(row.id);
                        return (
                          <tr
                            key={row.id}
                            onClick={() => toggleTb(row.id)}
                            className={`cursor-pointer border-b border-slate-100 ${selected ? 'bg-blue-50' : 'hover:bg-slate-50'}`}
                          >
                            <td className="px-1 py-1 text-center">
                              <input type="checkbox" checked={selected} onChange={() => toggleTb(row.id)} className="w-3.5 h-3.5" />
                            </td>
                            <td className="px-2 py-1 font-mono text-slate-700">{row.accountCode || '—'}</td>
                            <td className="px-2 py-1 text-slate-600 truncate max-w-[220px]" title={row.description}>{row.description}</td>
                            <td className="px-2 py-1 text-right font-mono text-slate-700">{fmt(move)}</td>
                            <td className="px-2 py-1 text-center">
                              <span
                                title={check.message}
                                className={`inline-block w-2.5 h-2.5 rounded-full ${check.status === 'red' ? 'bg-red-500' : 'bg-slate-300'}`}
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="px-4 py-2 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-xs">
                  <span className="text-slate-500">Selected: {selectedTbIds.size}</span>
                  <span className="font-mono font-semibold text-slate-700">{fmt(tbSelectedTotal)}</span>
                </div>
              </div>

              {/* RIGHT — GL codes */}
              <div className="flex flex-col min-h-0">
                <div className="px-4 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-700">General Ledger ({glRows.length})</span>
                  <button
                    onClick={() => {
                      if (selectedGlCodes.size === glRows.length) setSelectedGlCodes(new Set());
                      else setSelectedGlCodes(new Set(glRows.map(g => g.code)));
                    }}
                    className="text-[10px] text-blue-600 hover:text-blue-800"
                  >
                    {selectedGlCodes.size === glRows.length ? 'Clear all' : 'Select all'}
                  </button>
                </div>
                <div className="flex-1 overflow-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-white border-b border-slate-200">
                      <tr className="text-[10px] text-slate-500">
                        <th className="w-8 px-1 py-1"></th>
                        <th className="text-left px-2 py-1">Code</th>
                        <th className="text-left px-2 py-1">Description</th>
                        <th className="text-right px-2 py-1">Net movement</th>
                      </tr>
                    </thead>
                    <tbody>
                      {glRows.map(({ code, amount, description }) => {
                        const selected = selectedGlCodes.has(code);
                        return (
                          <tr
                            key={code}
                            onClick={() => toggleGl(code)}
                            className={`cursor-pointer border-b border-slate-100 ${selected ? 'bg-blue-50' : 'hover:bg-slate-50'}`}
                          >
                            <td className="px-1 py-1 text-center">
                              <input type="checkbox" checked={selected} onChange={() => toggleGl(code)} className="w-3.5 h-3.5" />
                            </td>
                            <td className="px-2 py-1 font-mono text-slate-700">{code}</td>
                            <td className="px-2 py-1 text-slate-600 truncate max-w-[220px]" title={description || 'Not in TB'}>
                              {description || <span className="text-slate-300 italic">Not in TB</span>}
                            </td>
                            <td className="px-2 py-1 text-right font-mono text-slate-700">{fmt(amount)}</td>
                          </tr>
                        );
                      })}
                      {glRows.length === 0 && (
                        <tr>
                          <td colSpan={4} className="px-4 py-6 text-center text-slate-400 italic">No unmatched GL codes.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="px-4 py-2 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-xs">
                  <span className="text-slate-500">Selected: {selectedGlCodes.size}</span>
                  <span className="font-mono font-semibold text-slate-700">{fmt(glSelectedTotal)}</span>
                </div>
              </div>
            </div>

            {/* Footer: delta + commit */}
            <div className="px-5 py-3 border-t border-slate-200 bg-white flex items-center gap-3">
              <div className="flex-1 flex items-center gap-3">
                <span className="text-xs text-slate-500">Delta</span>
                <span className={`font-mono text-sm font-semibold ${agrees ? 'text-green-600' : Math.abs(delta) > 0.01 ? 'text-red-600' : 'text-slate-500'}`}>
                  {fmt(delta)}
                </span>
                {agrees && <span className="inline-flex items-center gap-1 text-[11px] text-green-700 bg-green-50 px-2 py-0.5 rounded-full border border-green-200"><CheckCircle2 className="h-3 w-3" /> Agrees</span>}
                {!agrees && selectedTbIds.size > 0 && <span className="inline-flex items-center gap-1 text-[11px] text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200"><AlertTriangle className="h-3 w-3" /> Not yet agreeing</span>}
              </div>
              {error && <span className="text-xs text-red-600">{error}</span>}
              <button onClick={onClose} disabled={committing} className="text-xs px-4 py-1.5 bg-slate-100 text-slate-700 rounded hover:bg-slate-200">Close</button>
              <button
                onClick={commit}
                disabled={!agrees || committing}
                className="text-xs px-4 py-1.5 bg-green-600 text-white rounded hover:bg-green-700 disabled:bg-slate-200 disabled:text-slate-400 inline-flex items-center gap-1.5"
              >
                {committing ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                {committing ? 'Committing…' : `Commit (${selectedTbIds.size})`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
