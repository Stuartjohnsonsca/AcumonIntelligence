'use client';

import { useState, useEffect, useMemo } from 'react';
import { ChevronDown, ChevronRight, Loader2, Plus, Trash2, AlertTriangle } from 'lucide-react';

const STATEMENT_ORDER = ['Profit & Loss', 'Balance Sheet', 'Cash Flow Statement', 'Notes'];
// Single grid template used at every level so that the three numeric columns
// (Original, Adjustments, Adjusted) line up perfectly from statement header
// all the way down to account rows. Generous column widths + a gap between
// columns makes the figures breathe.
const COL = 'grid grid-cols-[1fr_128px_128px_128px] gap-4 items-center';

/**
 * Accounting-style number formatter.
 * - Positive (debit):  "1,234\u00A0"  ← trailing figure space
 * - Negative (credit): "(1,234)"
 *
 * The trailing non-breaking space on positives keeps the last digit in
 * the same column as the pre-paren last digit of negatives when the
 * container is right-aligned with tabular-nums. Containers must use
 * `font-mono tabular-nums` for this to render cleanly.
 */
function f(n: number): string {
  if (n === 0) return '—';
  const abs = Math.abs(n);
  const s = abs.toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return n < 0 ? `(${s})` : `${s}\u00A0`;
}

interface TBRow { id: string; accountCode: string; description: string; fsStatement: string | null; fsLevel: string | null; fsNoteLevel: string | null; currentYear: number | null; priorYear: number | null; }
interface ErrEntry { id: string; fsLine: string; accountCode: string | null; errorAmount: number; errorType: string; }
/**
 * An adjustment row. `fsLineId` is captured the first time the user
 * enters a "new" account code (one that isn't in the imported TB). The
 * category modal forces this so adjustments with unknown codes aren't
 * silently mis-posted to a generic bucket.
 */
interface AdjRow {
  accountCode: string;
  description: string;
  fsStatement: string;
  fsLevel: string;
  fsLineId: string | null;
  dr: number;
  cr: number;
  reference: string;
}

interface FsLineLite { id: string; name: string; fsCategory: string; lineType: string; }

export function AdjustedTBPanel({ engagementId }: { engagementId: string }) {
  const [tbRows, setTbRows] = useState<TBRow[]>([]);
  const [errors, setErrors] = useState<ErrEntry[]>([]);
  const [manualAdjs, setManualAdjs] = useState<AdjRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // FS lines for the category-selector popup. Loaded lazily on first new
  // code; null = not loaded yet.
  const [fsLines, setFsLines] = useState<FsLineLite[] | null>(null);
  const [categoryModalFor, setCategoryModalFor] = useState<number | null>(null);

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

  /** Lazy-load the firm's FS lines the first time we need to show the
   *  category picker. Cached afterwards. */
  async function ensureFsLinesLoaded(): Promise<FsLineLite[]> {
    if (fsLines) return fsLines;
    try {
      const res = await fetch('/api/methodology-admin/fs-lines');
      if (res.ok) {
        const data = await res.json();
        const lines: FsLineLite[] = (data.fsLines || []).map((l: any) => ({
          id: l.id,
          name: l.name,
          fsCategory: l.fsCategory || 'balance_sheet',
          lineType: l.lineType || 'fs_line_item',
        }));
        setFsLines(lines);
        return lines;
      }
    } catch {}
    setFsLines([]);
    return [];
  }

  // Set of imported TB account codes — used to detect "new" codes on
  // manual adjustments (triggers the category picker).
  const tbCodeSet = useMemo(() => {
    const s = new Set<string>();
    for (const r of tbRows) if (r.accountCode) s.add(r.accountCode.trim());
    return s;
  }, [tbRows]);

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

  // Adjustment balance check. Dr and Cr must sum to equal amounts;
  // until they do we ring the adjustments card in red and show a
  // running-delta banner so the user can see which side is short.
  const totalDr = manualAdjs.reduce((s, a) => s + (Number(a.dr) || 0), 0);
  const totalCr = manualAdjs.reduce((s, a) => s + (Number(a.cr) || 0), 0);
  const drCrDelta = Math.round((totalDr - totalCr) * 100) / 100;
  const isBalanced = manualAdjs.length === 0 || drCrDelta === 0;

  function toggle(key: string) { setExpanded(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; }); }

  /** Opens the category modal for an adjustment row, making sure we
   *  have the FS lines list loaded first. */
  async function openCategoryFor(index: number) {
    await ensureFsLinesLoaded();
    setCategoryModalFor(index);
  }

  /** Called when the code field loses focus. If the user has entered a
   *  code that isn't in the imported TB and the row doesn't already
   *  have a category assigned, we open the picker automatically. */
  function handleCodeBlur(index: number) {
    const row = manualAdjs[index];
    if (!row) return;
    const trimmed = (row.accountCode || '').trim();
    if (!trimmed) return;
    if (tbCodeSet.has(trimmed)) return; // known code — nothing to do
    if (row.fsLineId) return;           // category already chosen
    void openCategoryFor(index);
  }

  if (loading) return <div className="p-6 text-center"><Loader2 className="h-5 w-5 animate-spin text-slate-400 mx-auto" /></div>;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-slate-700">Adjusted Trial Balance</h3>
        <button onClick={() => setManualAdjs(prev => [...prev, { accountCode: '', description: '', fsStatement: 'Balance Sheet', fsLevel: '', fsLineId: null, dr: 0, cr: 0, reference: '' }])} className="inline-flex items-center gap-1 text-[10px] px-2.5 py-1 bg-blue-50 text-blue-700 border border-blue-200 rounded hover:bg-blue-100">
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
        <div className={`border rounded-lg overflow-hidden ${isBalanced ? 'border-slate-200' : 'border-red-500 ring-2 ring-red-200'}`}>
          <div className={`px-3 py-1.5 text-[10px] font-semibold uppercase flex items-center justify-between ${isBalanced ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700'}`}>
            <span>Manual Adjustments</span>
            {!isBalanced && (
              <span className="flex items-center gap-1 normal-case font-medium">
                <AlertTriangle className="h-3.5 w-3.5" />
                Dr/Cr do not balance — {drCrDelta > 0 ? `Dr exceeds Cr by ${f(drCrDelta)}` : `Cr exceeds Dr by ${f(-drCrDelta)}`}
              </span>
            )}
          </div>
          {/* Column headers for the adjustments grid */}
          <div className="grid grid-cols-[80px_1fr_128px_128px_140px_28px] gap-3 items-center px-3 py-1 bg-slate-50 border-t border-b border-slate-200 text-[9px] font-semibold text-slate-500 uppercase">
            <span>Code</span>
            <span>Description</span>
            <span className="text-right">Dr</span>
            <span className="text-right">Cr</span>
            <span>Category</span>
            <span></span>
          </div>
          {manualAdjs.map((adj, i) => {
            const trimmedCode = (adj.accountCode || '').trim();
            const isNewCode = trimmedCode.length > 0 && !tbCodeSet.has(trimmedCode);
            const needsCategory = isNewCode && !adj.fsLineId;
            return (
              <div key={i} className="grid grid-cols-[80px_1fr_128px_128px_140px_28px] gap-3 items-center px-3 py-1 border-t text-[10px]">
                <input
                  type="text"
                  value={adj.accountCode}
                  onChange={e => { const v = [...manualAdjs]; v[i] = { ...v[i], accountCode: e.target.value }; setManualAdjs(v); }}
                  onBlur={() => handleCodeBlur(i)}
                  className={`border rounded px-2 py-1 text-[10px] ${needsCategory ? 'border-red-300 bg-red-50/30' : 'border-slate-200'}`}
                  placeholder="Code"
                />
                <input
                  type="text"
                  value={adj.description}
                  onChange={e => { const v = [...manualAdjs]; v[i] = { ...v[i], description: e.target.value }; setManualAdjs(v); }}
                  className="border border-slate-200 rounded px-2 py-1 text-[10px]"
                  placeholder="Description"
                />
                <input
                  type="number"
                  value={adj.dr || ''}
                  onChange={e => { const v = [...manualAdjs]; v[i] = { ...v[i], dr: Number(e.target.value) || 0 }; setManualAdjs(v); }}
                  className="border border-slate-200 rounded px-2 py-1 text-[10px] text-right font-mono tabular-nums"
                  placeholder="Dr"
                />
                <input
                  type="number"
                  value={adj.cr || ''}
                  onChange={e => { const v = [...manualAdjs]; v[i] = { ...v[i], cr: Number(e.target.value) || 0 }; setManualAdjs(v); }}
                  className="border border-slate-200 rounded px-2 py-1 text-[10px] text-right font-mono tabular-nums"
                  placeholder="Cr"
                />
                {/*
                  Category column: shows the chosen FS line when set, else
                  an "Assign" button for known codes and a red "New code —
                  pick" button for codes the TB has never seen.
                */}
                {needsCategory ? (
                  <button
                    onClick={() => openCategoryFor(i)}
                    className="inline-flex items-center gap-1 text-[10px] px-2 py-1 bg-red-50 text-red-700 border border-red-300 rounded hover:bg-red-100"
                    title="New code — pick a FS line category before this adjustment can be posted"
                  >
                    <AlertTriangle className="h-3 w-3" /> New code — pick
                  </button>
                ) : adj.fsLineId ? (
                  <button
                    onClick={() => openCategoryFor(i)}
                    className="text-[10px] px-2 py-1 bg-blue-50 text-blue-700 border border-blue-200 rounded hover:bg-blue-100 truncate"
                    title="Click to change the FS line category"
                  >
                    {fsLines?.find(l => l.id === adj.fsLineId)?.name || 'Change…'}
                  </button>
                ) : (
                  <span className="text-[9px] text-slate-400">from TB</span>
                )}
                <button
                  onClick={() => setManualAdjs(prev => prev.filter((_, j) => j !== i))}
                  className="text-red-400 hover:text-red-600 justify-self-end"
                  title="Remove adjustment"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            );
          })}
          {/* Dr/Cr totals footer for the adjustments block. */}
          <div className="grid grid-cols-[80px_1fr_128px_128px_140px_28px] gap-3 items-center px-3 py-1 border-t bg-slate-50 text-[10px] font-semibold text-slate-700">
            <span></span>
            <span className="text-right">Totals</span>
            <span className="text-right font-mono tabular-nums">{f(totalDr)}</span>
            <span className="text-right font-mono tabular-nums">{f(totalCr)}</span>
            <span className={`text-right font-mono tabular-nums ${isBalanced ? 'text-green-600' : 'text-red-600'}`}>
              {isBalanced ? 'Balanced' : `Δ ${f(drCrDelta)}`}
            </span>
            <span></span>
          </div>
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
              <div className="text-right font-mono tabular-nums">{f(orig)}</div>
              <div className={`text-right font-mono tabular-nums ${adj !== 0 ? 'text-amber-600 font-semibold' : 'text-slate-300'}`}>{adj !== 0 ? f(adj) : '—'}</div>
              <div className="text-right font-mono tabular-nums font-semibold">{f(orig + adj)}</div>
            </button>

            {isOpen && (
              <div className="space-y-1 pb-1">
                {Array.from(levels.entries()).map(([level, rows]) => {
                  const levelKey = `l:${stmt}:${level}`;
                  const isLevelOpen = expanded.has(levelKey);
                  const lOrig = rows.reduce((s, r) => s + (Number(r.currentYear) || 0), 0);
                  const lAdj = rows.reduce((s, r) => s + (adjByAccount.get(r.accountCode) || 0), 0);

                  return (
                    <div key={level} className="bg-white border-t border-slate-200 overflow-hidden">
                      <button onClick={() => toggle(levelKey)} className={`w-full ${COL} px-3 py-1.5 hover:bg-slate-50 transition-colors text-[11px]`}>
                        <div className="flex items-center gap-1.5 text-left min-w-0">
                          {isLevelOpen ? <ChevronDown className="h-3 w-3 text-slate-400 flex-shrink-0" /> : <ChevronRight className="h-3 w-3 text-slate-400 flex-shrink-0" />}
                          <span className="font-semibold text-slate-700 truncate">{level}</span>
                        </div>
                        <div className="text-right font-mono tabular-nums text-[10px]">{f(lOrig)}</div>
                        <div className={`text-right font-mono tabular-nums text-[10px] ${lAdj !== 0 ? 'text-amber-600' : 'text-slate-300'}`}>{lAdj !== 0 ? f(lAdj) : '—'}</div>
                        <div className="text-right font-mono tabular-nums text-[10px] font-semibold">{f(lOrig + lAdj)}</div>
                      </button>
                      {isLevelOpen && (
                        <div className="border-t">
                          {rows.map(r => {
                            const rOrig = Number(r.currentYear) || 0;
                            const rAdj = adjByAccount.get(r.accountCode) || 0;
                            return (
                              <div key={r.id} className={`${COL} px-3 py-0.5 border-b border-slate-100/50 text-[10px] bg-slate-50/30`}>
                                <div className="flex items-center gap-2 text-left min-w-0 pl-5">
                                  <span className="font-mono tabular-nums text-slate-400 w-14 flex-shrink-0">{r.accountCode}</span>
                                  <span className="text-slate-700 truncate">{r.description}</span>
                                </div>
                                <span className="text-right font-mono tabular-nums">{f(rOrig)}</span>
                                <span className={`text-right font-mono tabular-nums ${rAdj !== 0 ? 'text-amber-600 font-semibold' : 'text-slate-300'}`}>{rAdj !== 0 ? f(rAdj) : '—'}</span>
                                <span className="text-right font-mono tabular-nums font-semibold">{f(rOrig + rAdj)}</span>
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
          <div className={`${COL} px-3 py-2 bg-slate-100 rounded-lg text-xs font-mono tabular-nums`}>
            <span className="font-bold text-slate-700">Total</span>
            <span className="text-right">{f(tOrig)}</span>
            <span className={`text-right ${tAdj !== 0 ? 'text-amber-600 font-semibold' : ''}`}>{tAdj !== 0 ? f(tAdj) : '—'}</span>
            <span className="text-right font-bold">{f(tOrig + tAdj)}</span>
          </div>
        );
      })()}

      {/* Category picker modal — opens automatically when the user enters
          an adjustment code that isn't in the imported TB, and also on
          demand when the user wants to re-pick a category for an
          already-categorised row. */}
      {categoryModalFor !== null && manualAdjs[categoryModalFor] && (
        <CategoryPickerModal
          currentCode={manualAdjs[categoryModalFor].accountCode}
          currentFsLineId={manualAdjs[categoryModalFor].fsLineId}
          fsLines={fsLines || []}
          onCancel={() => setCategoryModalFor(null)}
          onChoose={(chosen) => {
            const v = [...manualAdjs];
            v[categoryModalFor] = {
              ...v[categoryModalFor],
              fsLineId: chosen.id,
              fsStatement: fsCategoryToStatement(chosen.fsCategory),
              fsLevel: chosen.name,
            };
            setManualAdjs(v);
            setCategoryModalFor(null);
          }}
        />
      )}
    </div>
  );
}

/** Translate the FS line's fsCategory to a statement name (used for
 *  bucketing adjustments on the statement cards above). */
function fsCategoryToStatement(cat: string): string {
  switch (cat) {
    case 'pnl': return 'Profit & Loss';
    case 'balance_sheet': return 'Balance Sheet';
    case 'cashflow': return 'Cash Flow Statement';
    case 'notes': return 'Notes';
    default: return 'Balance Sheet';
  }
}

/**
 * Modal that asks the user to classify a manual adjustment against one
 * of the firm's existing FS lines, grouped by statement. Includes a
 * search box for long lists.
 *
 * Design notes:
 *  - Keyed only to fsLines (the firm list) and a search string — the
 *    parent owns the selection state so closing + reopening reflects
 *    the current row's category.
 *  - Clicking an option immediately commits via onChoose, matching the
 *    behaviour of the native dropdown the user would otherwise expect.
 */
function CategoryPickerModal({
  currentCode,
  currentFsLineId,
  fsLines,
  onCancel,
  onChoose,
}: {
  currentCode: string;
  currentFsLineId: string | null;
  fsLines: FsLineLite[];
  onCancel: () => void;
  onChoose: (chosen: FsLineLite) => void;
}) {
  const [query, setQuery] = useState('');
  const normalised = query.trim().toLowerCase();
  const byStatement = useMemo(() => {
    const m = new Map<string, FsLineLite[]>();
    for (const l of fsLines) {
      if (normalised && !l.name.toLowerCase().includes(normalised)) continue;
      const stmt = fsCategoryToStatement(l.fsCategory);
      if (!m.has(stmt)) m.set(stmt, []);
      m.get(stmt)!.push(l);
    }
    return m;
  }, [fsLines, normalised]);
  const totalShown = Array.from(byStatement.values()).reduce((s, arr) => s + arr.length, 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4"
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b flex items-start justify-between">
          <div>
            <h4 className="text-sm font-bold text-slate-800">Assign FS Line Category</h4>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Code <span className="font-mono tabular-nums">{currentCode || '—'}</span> isn&rsquo;t in the imported trial balance. Pick the FS line it should post to — pick a real category like &ldquo;Revenue&rdquo;, not a sub-code like 1/1 or 1/2.
            </p>
          </div>
          <button onClick={onCancel} className="text-slate-400 hover:text-slate-600 text-lg leading-none">×</button>
        </div>
        <div className="px-4 pt-3">
          <input
            type="text"
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search FS lines…"
            className="w-full border border-slate-200 rounded px-3 py-1.5 text-xs focus:outline-none focus:border-blue-400"
          />
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {fsLines.length === 0 ? (
            <div className="text-center text-xs text-slate-400 py-8">
              No FS lines configured for this firm — ask a methodology admin to set them up in Methodology Admin → FS Lines.
            </div>
          ) : totalShown === 0 ? (
            <div className="text-center text-xs text-slate-400 py-8">No FS lines match &ldquo;{query}&rdquo;.</div>
          ) : (
            Array.from(byStatement.entries()).map(([stmt, lines]) => (
              <div key={stmt}>
                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">{stmt}</div>
                <div className="space-y-0.5">
                  {lines.map(l => (
                    <button
                      key={l.id}
                      onClick={() => onChoose(l)}
                      className={`w-full text-left px-2 py-1.5 rounded text-[11px] transition-colors ${
                        l.id === currentFsLineId
                          ? 'bg-blue-100 text-blue-800 font-semibold'
                          : 'hover:bg-blue-50 text-slate-700'
                      }`}
                    >
                      {l.name}
                      {l.lineType === 'note_item' && <span className="ml-2 text-[9px] text-slate-400">(note)</span>}
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
        <div className="px-4 py-2 border-t flex justify-end">
          <button
            onClick={onCancel}
            className="text-xs px-3 py-1 text-slate-600 hover:text-slate-800"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
