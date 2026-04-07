'use client';

import { useState, useEffect, useMemo } from 'react';
import { ChevronDown, ChevronRight, CheckCircle2, Loader2 } from 'lucide-react';

const STATEMENT_ORDER = ['Profit & Loss', 'Balance Sheet', 'Cash Flow Statement', 'Notes'];

const FRAMEWORK_ORDERS: Record<string, Record<string, string[]>> = {
  FRS102: {
    'Profit & Loss': ['Revenue','Turnover','Sales','Income','Cost of Sales','Gross Profit','Distribution Costs','Administrative Expenses','Overheads','Staff Costs','Depreciation','Amortisation','Other Operating Income','Other Income','Operating Profit','Interest Receivable','Interest Payable','Finance Costs','Profit Before Tax','Taxation','Tax','Profit After Tax','Net Profit','Dividends','Retained Profit','Retained Earnings'],
    'Balance Sheet': ['Intangible Fixed Assets','Goodwill','Tangible Fixed Assets','Fixed Assets','Property Plant and Equipment','Investments','Stock','Inventories','Debtors','Trade Debtors','Receivables','Cash at Bank','Cash','Cash and Cash Equivalents','Bank','Creditors Due Within One Year','Current Liabilities','Creditors','Payables','Net Current Assets','Creditors Due After One Year','Long Term Liabilities','Loans','Provisions','Net Assets','Capital & Reserves','Share Capital','Share Premium','Retained Earnings','Reserves'],
    'Cash Flow Statement': ['Operating Activities','Investing Activities','Financing Activities','Net Change in Cash'],
  },
  IFRS: {
    'Profit & Loss': ['Revenue','Cost of Sales','Gross Profit','Other Income','Administrative Expenses','Staff Costs','Depreciation','Operating Profit','Finance Income','Finance Costs','Profit Before Tax','Taxation','Profit for the Year','Net Profit'],
    'Balance Sheet': ['Goodwill','Intangible Assets','Property Plant and Equipment','Inventories','Receivables','Cash and Cash Equivalents','Payables','Borrowings','Provisions','Net Assets','Share Capital','Retained Earnings'],
    'Cash Flow Statement': ['Operating Activities','Investing Activities','Financing Activities','Net Increase in Cash'],
  },
};
FRAMEWORK_ORDERS['FRS101'] = FRAMEWORK_ORDERS['IFRS'];
FRAMEWORK_ORDERS['FRS105'] = FRAMEWORK_ORDERS['FRS102'];

function getPos(fw: string, stmt: string, name: string): number {
  const order = (FRAMEWORK_ORDERS[fw] || FRAMEWORK_ORDERS['FRS102'])?.[stmt] || [];
  const lc = name.toLowerCase();
  for (let i = 0; i < order.length; i++) {
    const o = order[i].toLowerCase();
    if (o === lc || lc.includes(o) || o.includes(lc)) return i;
  }
  return 9999;
}

function f(n: number): string {
  const abs = Math.abs(n);
  const s = abs.toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return n < 0 ? `(${s})` : s;
}

// ─── Types ───
interface TBRow { id: string; accountCode: string; description: string; fsStatement: string | null; fsLevel: string | null; fsNoteLevel: string | null; currentYear: number | null; priorYear: number | null; }
interface Conc { id: string; fsLine: string; testDescription: string; conclusion: string | null; totalErrors: number; extrapolatedError: number; reviewedByName: string | null; riSignedByName: string | null; accountCode: string | null; }
interface Err { id: string; fsLine: string; errorAmount: number; errorType: string; }

function Dot({ c }: { c: string | null }) {
  const col = c === 'green' ? 'bg-green-500' : c === 'orange' ? 'bg-orange-500' : c === 'red' ? 'bg-red-500' : 'bg-slate-300';
  return <div className={`w-2 h-2 rounded-full ${col} inline-block`} />;
}

function SignDot({ count, total }: { count: number; total: number }) {
  if (total === 0) return <div className="w-3.5 h-3.5 rounded-full border border-slate-200" />;
  if (count === total) return <div className="w-3.5 h-3.5 rounded-full bg-green-500 flex items-center justify-center"><CheckCircle2 className="h-2.5 w-2.5 text-white" /></div>;
  if (count > 0) return <div className="w-3.5 h-3.5 rounded-full border-2 border-green-500" />;
  return <div className="w-3.5 h-3.5 rounded-full border border-slate-300" />;
}

// ─── Main ───
export function FSReviewPanel({ engagementId }: { engagementId: string }) {
  const [viewMode, setViewMode] = useState<'statement' | 'tb'>('statement');
  const [tbRows, setTbRows] = useState<TBRow[]>([]);
  const [conclusions, setConclusions] = useState<Conc[]>([]);
  const [errors, setErrors] = useState<Err[]>([]);
  const [framework, setFramework] = useState('FRS102');
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    (async () => {
      try {
        const [tbRes, concRes, errRes, pfRes] = await Promise.all([
          fetch(`/api/engagements/${engagementId}/trial-balance`),
          fetch(`/api/engagements/${engagementId}/test-conclusions`),
          fetch(`/api/engagements/${engagementId}/error-schedule`),
          fetch(`/api/engagements/${engagementId}/permanent-file`),
        ]);
        if (tbRes.ok) setTbRows((await tbRes.json()).rows || []);
        if (concRes.ok) setConclusions((await concRes.json()).conclusions || []);
        if (errRes.ok) setErrors((await errRes.json()).errors || []);
        if (pfRes.ok) {
          const d = await pfRes.json(); const ans = d.answers || d.data || {};
          for (const [k, v] of Object.entries(ans)) { if (typeof v === 'string' && k.toLowerCase().includes('applicable financial reporting')) { setFramework(v); break; } }
        }
      } catch {} finally { setLoading(false); }
    })();
  }, [engagementId]);

  // Pre-compute lookup maps for O(1) access
  const concsByLine = useMemo(() => {
    const m = new Map<string, Conc[]>();
    for (const c of conclusions) {
      const k = (c.fsLine || '').toLowerCase();
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(c);
    }
    return m;
  }, [conclusions]);

  const concsByAccount = useMemo(() => {
    const m = new Map<string, Conc[]>();
    for (const c of conclusions) {
      if (c.accountCode) {
        const k = c.accountCode.toLowerCase();
        if (!m.has(k)) m.set(k, []);
        m.get(k)!.push(c);
      }
    }
    return m;
  }, [conclusions]);

  const errsByLine = useMemo(() => {
    const m = new Map<string, { adj: number; unadj: number }>();
    for (const e of errors) {
      const k = (e.fsLine || '').toLowerCase();
      const cur = m.get(k) || { adj: 0, unadj: 0 };
      if (e.errorType === 'factual') cur.adj += e.errorAmount; else cur.unadj += e.errorAmount;
      m.set(k, cur);
    }
    return m;
  }, [errors]);

  // Hierarchy
  const hierarchy = useMemo(() => {
    const stmtMap = new Map<string, Map<string, { notes: Map<string, TBRow[]>; rows: TBRow[] }>>();
    for (const s of STATEMENT_ORDER) stmtMap.set(s, new Map());
    for (const row of tbRows) {
      const stmt = row.fsStatement || 'Unclassified';
      if (!stmtMap.has(stmt)) stmtMap.set(stmt, new Map());
      const levels = stmtMap.get(stmt)!;
      const level = row.fsLevel || 'Other';
      if (!levels.has(level)) levels.set(level, { notes: new Map(), rows: [] });
      const ld = levels.get(level)!;
      ld.rows.push(row);
      if (row.fsNoteLevel) {
        if (!ld.notes.has(row.fsNoteLevel)) ld.notes.set(row.fsNoteLevel, []);
        ld.notes.get(row.fsNoteLevel)!.push(row);
      }
    }
    return stmtMap;
  }, [tbRows]);

  function getConcs(name: string): Conc[] { return concsByLine.get(name.toLowerCase()) || []; }
  function getErrs(name: string) { return errsByLine.get(name.toLowerCase()) || { adj: 0, unadj: 0 }; }
  function getAccConcs(code: string): Conc[] { return concsByAccount.get(code.toLowerCase()) || []; }

  function signCounts(concs: Conc[]) {
    return { rev: concs.filter(c => c.reviewedByName).length, ri: concs.filter(c => c.riSignedByName).length, total: concs.length };
  }

  function toggle(key: string) { setExpanded(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; }); }

  if (loading) return <div className="p-6 text-center"><Loader2 className="h-5 w-5 animate-spin text-slate-400 mx-auto" /></div>;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-slate-700">Financial Statement Review</h3>
        <div className="flex bg-slate-100 rounded p-0.5 text-[10px]">
          <button onClick={() => setViewMode('statement')} className={`px-3 py-1 font-medium rounded ${viewMode === 'statement' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}`}>Statement</button>
          <button onClick={() => setViewMode('tb')} className={`px-3 py-1 font-medium rounded ${viewMode === 'tb' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}`}>TB Format</button>
        </div>
      </div>

      {viewMode === 'tb' ? (
        <TBView tbRows={tbRows} />
      ) : (
        <div className="space-y-3">
          {Array.from(hierarchy.entries()).map(([stmt, levels]) => {
            if (levels.size === 0) return null;
            const stmtKey = `s:${stmt}`;
            const isOpen = expanded.has(stmtKey);
            // Aggregate from levels
            const allRows = Array.from(levels.values()).flatMap(l => l.rows);
            const cy = allRows.reduce((s, r) => s + (Number(r.currentYear) || 0), 0);
            const py = allRows.reduce((s, r) => s + (Number(r.priorYear) || 0), 0);
            const allConcs = Array.from(levels.keys()).flatMap(l => getConcs(l));
            const so = signCounts(allConcs);
            const allErrs = Array.from(levels.keys()).reduce((a, l) => { const e = getErrs(l); return { adj: a.adj + e.adj, unadj: a.unadj + e.unadj }; }, { adj: 0, unadj: 0 });
            const sortedLevels = Array.from(levels.entries()).sort((a, b) => getPos(framework, stmt, a[0]) - getPos(framework, stmt, b[0]));

            return (
              <div key={stmt} className="bg-slate-50 rounded-lg border overflow-hidden">
                {/* Statement header */}
                <button onClick={() => toggle(stmtKey)} className="w-full flex items-center justify-between px-3 py-2 hover:bg-slate-100 transition-colors">
                  <div className="flex items-center gap-2">
                    {isOpen ? <ChevronDown className="h-3.5 w-3.5 text-slate-400" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-400" />}
                    <span className="text-xs font-bold text-slate-800">{stmt}</span>
                  </div>
                  <div className="flex items-center gap-4 text-[10px]">
                    <span className="font-mono font-semibold text-slate-700 w-20 text-right">{f(cy)}</span>
                    <span className="font-mono text-slate-400 w-20 text-right">{f(py)}</span>
                    {allErrs.adj !== 0 && <span className="text-red-600 font-mono w-16 text-right">{f(allErrs.adj)}</span>}
                    {allErrs.unadj !== 0 && <span className="text-amber-600 font-mono w-16 text-right">{f(allErrs.unadj)}</span>}
                    {(allErrs.adj === 0 && allErrs.unadj === 0) && <span className="text-slate-300 w-16 text-right">—</span>}
                    <div className="flex gap-1.5"><SignDot count={so.rev} total={so.total} /><SignDot count={so.ri} total={so.total} /></div>
                  </div>
                </button>

                {/* FS Level cards */}
                {isOpen && (
                  <div className="px-2 pb-2 space-y-1.5">
                    {sortedLevels.map(([level, ld]) => {
                      const levelKey = `l:${stmt}:${level}`;
                      const isLevelOpen = expanded.has(levelKey);
                      const lCY = ld.rows.reduce((s, r) => s + (Number(r.currentYear) || 0), 0);
                      const lPY = ld.rows.reduce((s, r) => s + (Number(r.priorYear) || 0), 0);
                      const lV = lCY - lPY;
                      const lConcs = getConcs(level);
                      const lSo = signCounts(lConcs);
                      const lErr = getErrs(level);
                      const sortedNotes = Array.from(ld.notes.entries()).sort((a, b) => getPos(framework, stmt, a[0]) - getPos(framework, stmt, b[0]));

                      return (
                        <div key={level} className="bg-white rounded border border-slate-200 overflow-hidden">
                          {/* Level header */}
                          <button onClick={() => toggle(levelKey)} className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-slate-50 transition-colors">
                            <div className="flex items-center gap-1.5">
                              {isLevelOpen ? <ChevronDown className="h-3 w-3 text-slate-400" /> : <ChevronRight className="h-3 w-3 text-slate-400" />}
                              <span className="text-[11px] font-semibold text-slate-700">{level}</span>
                              <span className="text-[9px] text-slate-400 ml-1">({ld.rows.length} a/c)</span>
                            </div>
                            <div className="flex items-center gap-3 text-[10px]">
                              <span className="font-mono font-semibold w-18 text-right">{f(lCY)}</span>
                              <span className="font-mono text-slate-400 w-18 text-right">{f(lPY)}</span>
                              <span className={`font-mono w-18 text-right ${lV > 0 ? 'text-green-600' : lV < 0 ? 'text-red-600' : 'text-slate-400'}`}>{f(lV)}</span>
                              <span className={`font-mono w-14 text-right ${lErr.adj !== 0 ? 'text-red-600' : 'text-slate-300'}`}>{lErr.adj !== 0 ? f(lErr.adj) : '—'}</span>
                              <span className={`font-mono w-14 text-right ${lErr.unadj !== 0 ? 'text-amber-600' : 'text-slate-300'}`}>{lErr.unadj !== 0 ? f(lErr.unadj) : '—'}</span>
                              <div className="flex gap-1"><SignDot count={lSo.rev} total={lSo.total} /><SignDot count={lSo.ri} total={lSo.total} /></div>
                            </div>
                          </button>

                          {isLevelOpen && (
                            <div className="border-t">
                              {/* FS Note sub-cards (if any) */}
                              {sortedNotes.length > 0 && (
                                <div className="px-2 py-1.5 space-y-1">
                                  {sortedNotes.map(([note, noteRows]) => {
                                    const noteKey = `n:${stmt}:${level}:${note}`;
                                    const isNoteOpen = expanded.has(noteKey);
                                    const nCY = noteRows.reduce((s, r) => s + (Number(r.currentYear) || 0), 0);
                                    const nPY = noteRows.reduce((s, r) => s + (Number(r.priorYear) || 0), 0);
                                    const nConcs = getConcs(note);
                                    const nSo = signCounts(nConcs);
                                    const nErr = getErrs(note);
                                    return (
                                      <div key={note} className="bg-slate-50 rounded border border-slate-100 overflow-hidden">
                                        <button onClick={() => toggle(noteKey)} className="w-full flex items-center justify-between px-2.5 py-1 hover:bg-slate-100 transition-colors">
                                          <div className="flex items-center gap-1.5">
                                            {isNoteOpen ? <ChevronDown className="h-2.5 w-2.5 text-slate-400" /> : <ChevronRight className="h-2.5 w-2.5 text-slate-400" />}
                                            <span className="text-[10px] font-medium text-slate-600">{note}</span>
                                          </div>
                                          <div className="flex items-center gap-3 text-[10px]">
                                            <span className="font-mono w-16 text-right">{f(nCY)}</span>
                                            <span className="font-mono text-slate-400 w-16 text-right">{f(nPY)}</span>
                                            <span className={`font-mono w-12 text-right ${nErr.adj !== 0 ? 'text-red-600' : 'text-slate-300'}`}>{nErr.adj !== 0 ? f(nErr.adj) : '—'}</span>
                                            <span className={`font-mono w-12 text-right ${nErr.unadj !== 0 ? 'text-amber-600' : 'text-slate-300'}`}>{nErr.unadj !== 0 ? f(nErr.unadj) : '—'}</span>
                                            <div className="flex gap-1"><SignDot count={nSo.rev} total={nSo.total} /><SignDot count={nSo.ri} total={nSo.total} /></div>
                                          </div>
                                        </button>
                                        {isNoteOpen && <AccountRows rows={noteRows} getAccConcs={getAccConcs} getLineConcs={getConcs} fsLineName={note} expanded={expanded} toggle={toggle} prefix={`na:${note}`} />}
                                      </div>
                                    );
                                  })}
                                </div>
                              )}

                              {/* Account rows (when no notes, or as the default view) */}
                              {sortedNotes.length === 0 && <AccountRows rows={ld.rows} getAccConcs={getAccConcs} getLineConcs={getConcs} fsLineName={level} expanded={expanded} toggle={toggle} prefix={`la:${level}`} />}
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
        </div>
      )}
    </div>
  );
}

// ─── Account Rows: each row shows conclusion/Rev/RI, click expands to show individual tests ───
function AccountRows({ rows, getAccConcs, getLineConcs, fsLineName, expanded, toggle, prefix }: {
  rows: TBRow[];
  getAccConcs: (code: string) => Conc[];
  getLineConcs: (name: string) => Conc[];
  fsLineName: string;
  expanded: Set<string>;
  toggle: (key: string) => void;
  prefix: string;
}) {
  const lineConcs = getLineConcs(fsLineName);

  // For each account row, get its applicable conclusions (account-specific first, then FS-line level)
  function getRowConcs(accountCode: string): Conc[] {
    const acc = getAccConcs(accountCode);
    return acc.length > 0 ? acc : lineConcs;
  }

  return (
    <div className="border-t">
      {rows.map(r => {
        const concs = getRowConcs(r.accountCode);
        const rowKey = `${prefix}:${r.accountCode}`;
        const isOpen = expanded.has(rowKey);
        const hasConcs = concs.length > 0;
        const so = { rev: concs.filter(c => c.reviewedByName).length, ri: concs.filter(c => c.riSignedByName).length, total: concs.length };

        return (
          <div key={r.id}>
            {/* Account row */}
            <button
              onClick={() => hasConcs && toggle(rowKey)}
              className={`w-full flex items-center gap-1.5 px-2 py-1 text-[10px] border-b border-slate-100/50 transition-colors ${
                isOpen ? 'bg-blue-50/30' : hasConcs ? 'hover:bg-slate-50/50 cursor-pointer' : 'cursor-default'
              }`}
            >
              {/* Expander */}
              <div className="w-4 flex-shrink-0 text-center">
                {hasConcs && (isOpen ? <ChevronDown className="h-2.5 w-2.5 text-slate-400 inline" /> : <ChevronRight className="h-2.5 w-2.5 text-slate-400 inline" />)}
              </div>
              {/* Code */}
              <span className="font-mono text-slate-400 w-14 text-left flex-shrink-0">{r.accountCode}</span>
              {/* Description */}
              <span className="text-slate-700 flex-1 text-left truncate">{r.description}</span>
              {/* CY / PY */}
              <span className="font-mono w-16 text-right flex-shrink-0">{f(Number(r.currentYear) || 0)}</span>
              <span className="font-mono text-slate-400 w-16 text-right flex-shrink-0">{f(Number(r.priorYear) || 0)}</span>
              {/* Conclusion dots */}
              <div className="w-12 flex items-center justify-center gap-0.5 flex-shrink-0">
                {hasConcs ? concs.map(c => <Dot key={c.id} c={c.conclusion} />) : <span className="text-slate-300">—</span>}
              </div>
              {/* Rev / RI */}
              <div className="flex-shrink-0"><SignDot count={so.rev} total={so.total} /></div>
              <div className="flex-shrink-0"><SignDot count={so.ri} total={so.total} /></div>
            </button>

            {/* Expanded: individual tests for this account */}
            {isOpen && concs.length > 0 && (
              <div className="bg-blue-50/20 border-b border-slate-200 px-4 py-1.5">
                {concs.map(c => (
                  <div key={c.id} className="flex items-center gap-2 py-0.5 text-[10px]">
                    <Dot c={c.conclusion} />
                    <span className="text-slate-700 flex-1 truncate">{c.testDescription}</span>
                    {c.totalErrors > 0 && <span className="text-red-600 font-mono text-[9px]">£{f(c.extrapolatedError)}</span>}
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {c.reviewedByName ? (
                        <span className="text-[8px] bg-green-100 text-green-700 px-1 py-0.5 rounded">{c.reviewedByName}</span>
                      ) : (
                        <span className="text-[8px] text-slate-300 px-1">No rev</span>
                      )}
                      {c.riSignedByName ? (
                        <span className="text-[8px] bg-blue-100 text-blue-700 px-1 py-0.5 rounded">RI: {c.riSignedByName}</span>
                      ) : (
                        <span className="text-[8px] text-slate-300 px-1">No RI</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── TB Format ───
function TBView({ tbRows }: { tbRows: TBRow[] }) {
  const byStmt = new Map<string, TBRow[]>();
  for (const r of tbRows) { const s = r.fsStatement || 'Unclassified'; if (!byStmt.has(s)) byStmt.set(s, []); byStmt.get(s)!.push(r); }
  return (
    <div className="space-y-3">
      {Array.from(byStmt.entries()).map(([stmt, rows]) => (
        <div key={stmt} className="border rounded-lg overflow-hidden">
          <div className="bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700">{stmt}</div>
          <table className="w-full text-[10px]">
            <thead><tr className="bg-slate-50 border-b"><th className="text-left px-2 py-1 text-slate-600">Code</th><th className="text-left px-2 py-1 text-slate-600">Description</th><th className="text-left px-2 py-1 text-slate-600">FS Level</th><th className="text-right px-2 py-1 text-slate-600">CY</th><th className="text-right px-2 py-1 text-slate-600">PY</th><th className="text-right px-2 py-1 text-slate-600">Var</th></tr></thead>
            <tbody>{rows.map(r => { const cy = Number(r.currentYear)||0; const py = Number(r.priorYear)||0; const v = cy-py; return (
              <tr key={r.id} className="border-b border-slate-50"><td className="px-2 py-0.5 font-mono text-slate-500">{r.accountCode}</td><td className="px-2 py-0.5 text-slate-700">{r.description}</td><td className="px-2 py-0.5 text-slate-400">{r.fsLevel||''}</td><td className="px-2 py-0.5 text-right font-mono">{f(cy)}</td><td className="px-2 py-0.5 text-right font-mono text-slate-500">{f(py)}</td><td className={`px-2 py-0.5 text-right font-mono ${v>0?'text-green-600':v<0?'text-red-600':'text-slate-400'}`}>{f(v)}</td></tr>
            ); })}</tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
