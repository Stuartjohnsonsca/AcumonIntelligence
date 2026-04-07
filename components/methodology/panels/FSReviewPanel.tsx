'use client';

import { useState, useEffect, useMemo } from 'react';
import { ChevronDown, ChevronRight, CheckCircle2, Loader2, AlertTriangle } from 'lucide-react';

// ─── Shared constants (from AuditPlanPanel) ───
const STATEMENT_ORDER = ['Profit & Loss', 'Balance Sheet', 'Cash Flow Statement', 'Notes'];

const FRAMEWORK_ORDERS: Record<string, Record<string, string[]>> = {
  FRS102: {
    'Profit & Loss': ['Revenue','Turnover','Sales','Income','Fees','Cost of Sales','Cost of Goods Sold','Gross Profit','Distribution Costs','Administrative Expenses','Admin Expenses','Overheads','Staff Costs','Employee Costs','Depreciation','Amortisation','Other Operating Income','Other Income','Operating Profit','Interest Receivable','Interest Income','Interest Payable','Interest','Finance Costs','Profit Before Tax','Profit on Ordinary Activities','Taxation','Tax','Corporation Tax','Profit After Tax','Net Profit','Dividends','Retained Profit','Retained Earnings'],
    'Balance Sheet': ['Intangible Fixed Assets','Intangible Assets','Goodwill','Tangible Fixed Assets','Fixed Assets','Property Plant and Equipment','Investments','Fixed Asset Investments','Stock','Inventories','Debtors','Trade Debtors','Trade and Other Receivables','Receivables','Cash at Bank','Cash','Cash and Cash Equivalents','Bank','Creditors Due Within One Year','Current Liabilities','Creditors','Trade Creditors','Trade and Other Payables','Payables','Net Current Assets','Creditors Due After One Year','Long Term Liabilities','Loans & Borrowings','Loans','Bank Loans','Provisions','Provisions for Liabilities','Net Assets','Capital & Reserves','Share Capital','Called Up Share Capital','Share Premium','Revaluation Reserve','Profit and Loss Account','Retained Earnings','Reserves'],
    'Cash Flow Statement': ['Operating Activities','Cash from Operations','Investing Activities','Cash from Investing','Financing Activities','Cash from Financing','Net Change in Cash'],
  },
  IFRS: {
    'Profit & Loss': ['Revenue','Cost of Sales','Gross Profit','Other Income','Distribution Costs','Administrative Expenses','General and Administrative','Employee Benefits','Staff Costs','Depreciation and Amortisation','Depreciation','Amortisation','Impairment Losses','Other Expenses','Operating Profit','Results from Operating Activities','Finance Income','Interest Income','Finance Costs','Interest Expense','Share of Profit of Associates','Profit Before Tax','Income Tax Expense','Taxation','Profit for the Year','Net Profit','Other Comprehensive Income','Total Comprehensive Income'],
    'Balance Sheet': ['Goodwill','Intangible Assets','Property Plant and Equipment','Right of Use Assets','Investment Property','Investments in Associates','Deferred Tax Assets','Inventories','Stock','Trade and Other Receivables','Debtors','Receivables','Contract Assets','Cash and Cash Equivalents','Cash','Assets Held for Sale','Trade and Other Payables','Creditors','Payables','Contract Liabilities','Current Tax Liabilities','Borrowings','Loans','Lease Liabilities','Deferred Tax Liabilities','Provisions','Net Assets','Share Capital','Issued Capital','Share Premium','Retained Earnings','Reserves','Non-controlling Interests'],
    'Cash Flow Statement': ['Cash from Operating Activities','Operating Activities','Cash from Investing Activities','Investing Activities','Cash from Financing Activities','Financing Activities','Net Increase in Cash'],
  },
  FRS105: {
    'Profit & Loss': ['Turnover','Revenue','Sales','Cost of Sales','Gross Profit','Administrative Expenses','Overheads','Staff Costs','Depreciation','Other Charges','Tax','Profit After Tax'],
    'Balance Sheet': ['Fixed Assets','Current Assets','Cash at Bank','Cash','Debtors','Creditors Due Within One Year','Net Current Assets','Creditors Due After One Year','Net Assets','Capital and Reserves'],
  },
};
FRAMEWORK_ORDERS['FRS101'] = FRAMEWORK_ORDERS['IFRS'];

function getStatutoryPosition(framework: string, statement: string, levelName: string): number {
  const fwOrder = FRAMEWORK_ORDERS[framework] || FRAMEWORK_ORDERS['FRS102'];
  const order = fwOrder?.[statement] || [];
  const lc = levelName.toLowerCase();
  for (let i = 0; i < order.length; i++) {
    const item = order[i].toLowerCase();
    if (item === lc || lc.includes(item) || item.includes(lc)) return i;
  }
  return 9999;
}

function fmt(n: number): string {
  const abs = Math.abs(n);
  const f = abs.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `(${f})` : f;
}

// ─── Types ───
interface TBRow {
  id: string; accountCode: string; description: string;
  fsStatement: string | null; fsLevel: string | null; fsNoteLevel: string | null;
  currentYear: number | null; priorYear: number | null;
}
interface Conclusion {
  id: string; fsLine: string; testDescription: string; conclusion: string | null;
  totalErrors: number; extrapolatedError: number;
  reviewedByName: string | null; riSignedByName: string | null;
  accountCode: string | null; executionId: string | null;
}
interface ErrorEntry {
  id: string; fsLine: string; errorAmount: number; errorType: string;
}
interface Execution {
  id: string; fsLine: string; testDescription: string; status: string;
}

// ─── Sign-off dot ───
function SignDot({ count, total, label }: { count: number; total: number; label: string }) {
  const isFull = total > 0 && count === total;
  const isPartial = count > 0 && count < total;
  return (
    <div className="flex flex-col items-center gap-0.5" title={`${label}: ${count}/${total} tests signed`}>
      <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
        isFull ? 'bg-green-500 border-green-500' :
        isPartial ? 'border-green-500 bg-white' :
        'border-slate-300 bg-white'
      }`}>
        {isFull && <CheckCircle2 className="h-2.5 w-2.5 text-white" />}
      </div>
      <span className="text-[7px] text-slate-400">{label}</span>
    </div>
  );
}

// ─── Conclusion dot ───
function ConcDot({ conclusion }: { conclusion: string | null }) {
  const c = conclusion || 'pending';
  const color = c === 'green' ? 'bg-green-500' : c === 'orange' ? 'bg-orange-500' : c === 'red' ? 'bg-red-500' : 'bg-slate-300';
  return <div className={`w-2 h-2 rounded-full ${color}`} title={c} />;
}

// ─── Main Component ───
export function FSReviewPanel({ engagementId }: { engagementId: string }) {
  const [viewMode, setViewMode] = useState<'statement' | 'tb'>('statement');
  const [tbRows, setTbRows] = useState<TBRow[]>([]);
  const [conclusions, setConclusions] = useState<Conclusion[]>([]);
  const [errors, setErrors] = useState<ErrorEntry[]>([]);
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [framework, setFramework] = useState('FRS102');
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    (async () => {
      try {
        const [tbRes, concRes, errRes, execRes, pfRes] = await Promise.all([
          fetch(`/api/engagements/${engagementId}/trial-balance`),
          fetch(`/api/engagements/${engagementId}/test-conclusions`),
          fetch(`/api/engagements/${engagementId}/error-schedule`),
          fetch(`/api/engagements/${engagementId}/test-execution`),
          fetch(`/api/engagements/${engagementId}/permanent-file`),
        ]);
        if (tbRes.ok) setTbRows((await tbRes.json()).rows || []);
        if (concRes.ok) setConclusions((await concRes.json()).conclusions || []);
        if (errRes.ok) setErrors((await errRes.json()).errors || []);
        if (execRes.ok) setExecutions((await execRes.json()).executions || []);
        if (pfRes.ok) {
          const pfData = await pfRes.json();
          const answers = pfData.answers || pfData.data || {};
          for (const [key, val] of Object.entries(answers)) {
            if (typeof val === 'string' && key.toLowerCase().includes('applicable financial reporting')) {
              setFramework(val); break;
            }
          }
        }
      } catch {} finally { setLoading(false); }
    })();
  }, [engagementId]);

  // Build hierarchy
  const hierarchy = useMemo(() => {
    const stmtMap = new Map<string, { levels: Map<string, { notes: Map<string, TBRow[]>; rows: TBRow[] }>; rows: TBRow[] }>();

    for (const stmt of STATEMENT_ORDER) {
      stmtMap.set(stmt, { levels: new Map(), rows: [] });
    }

    for (const row of tbRows) {
      const stmt = row.fsStatement || 'Unclassified';
      if (!stmtMap.has(stmt)) stmtMap.set(stmt, { levels: new Map(), rows: [] });
      const stmtData = stmtMap.get(stmt)!;
      stmtData.rows.push(row);

      const level = row.fsLevel || 'Other';
      if (!stmtData.levels.has(level)) stmtData.levels.set(level, { notes: new Map(), rows: [] });
      const levelData = stmtData.levels.get(level)!;
      levelData.rows.push(row);

      if (row.fsNoteLevel) {
        if (!levelData.notes.has(row.fsNoteLevel)) levelData.notes.set(row.fsNoteLevel, []);
        levelData.notes.get(row.fsNoteLevel)!.push(row);
      }
    }

    return stmtMap;
  }, [tbRows]);

  // Helpers
  function sumCY(rows: TBRow[]): number { return rows.reduce((s, r) => s + (Number(r.currentYear) || 0), 0); }
  function sumPY(rows: TBRow[]): number { return rows.reduce((s, r) => s + (Number(r.priorYear) || 0), 0); }

  function getConcsForLine(lineName: string): Conclusion[] {
    const lc = lineName.toLowerCase();
    return conclusions.filter(c => {
      const cl = (c.fsLine || '').toLowerCase();
      return cl === lc || cl.includes(lc) || lc.includes(cl);
    });
  }

  function getErrorsForLine(lineName: string): { adjusted: number; unadjusted: number } {
    const lc = lineName.toLowerCase();
    const matching = errors.filter(e => {
      const el = (e.fsLine || '').toLowerCase();
      return el === lc || el.includes(lc) || lc.includes(el);
    });
    return {
      adjusted: matching.filter(e => e.errorType === 'factual').reduce((s, e) => s + e.errorAmount, 0),
      unadjusted: matching.filter(e => e.errorType !== 'factual').reduce((s, e) => s + e.errorAmount, 0),
    };
  }

  function getSignOffCounts(lineName: string): { reviewerCount: number; riCount: number; total: number } {
    const concs = getConcsForLine(lineName);
    return {
      reviewerCount: concs.filter(c => c.reviewedByName).length,
      riCount: concs.filter(c => c.riSignedByName).length,
      total: concs.length,
    };
  }

  function toggle(key: string) {
    setExpanded(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  }

  if (loading) return <div className="p-6 text-center"><Loader2 className="h-5 w-5 animate-spin text-slate-400 mx-auto" /></div>;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-slate-700">Financial Statement Review</h3>
        <div className="flex bg-slate-100 rounded p-0.5">
          <button onClick={() => setViewMode('statement')} className={`px-3 py-1 text-[10px] font-medium rounded transition-colors ${viewMode === 'statement' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}`}>Statement Format</button>
          <button onClick={() => setViewMode('tb')} className={`px-3 py-1 text-[10px] font-medium rounded transition-colors ${viewMode === 'tb' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}`}>TB Format</button>
        </div>
      </div>

      {viewMode === 'tb' ? (
        <TBFormatView tbRows={tbRows} />
      ) : (
        <div className="space-y-2">
          {/* Table header */}
          <div className="grid grid-cols-[1fr_90px_90px_90px_80px_80px_40px_40px] gap-0 text-[9px] font-semibold text-slate-500 uppercase px-2">
            <div>FS Line</div>
            <div className="text-right">Current Year</div>
            <div className="text-right">Prior Year</div>
            <div className="text-right">Variance</div>
            <div className="text-right">Adj Errors</div>
            <div className="text-right">Unadj Errors</div>
            <div className="text-center">Rev</div>
            <div className="text-center">RI</div>
          </div>

          {Array.from(hierarchy.entries()).map(([stmt, stmtData]) => {
            if (stmtData.rows.length === 0) return null;
            const stmtKey = `stmt:${stmt}`;
            const isStmtExp = expanded.has(stmtKey);
            const stmtCY = sumCY(stmtData.rows);
            const stmtPY = sumPY(stmtData.rows);
            const stmtVar = stmtCY - stmtPY;
            // Roll up errors from all levels under this statement
            const stmtAdj = Array.from(stmtData.levels.keys()).reduce((s, l) => s + getErrorsForLine(l).adjusted, 0);
            const stmtUnadj = Array.from(stmtData.levels.keys()).reduce((s, l) => s + getErrorsForLine(l).unadjusted, 0);
            // Roll up sign-offs
            const stmtConcs = Array.from(stmtData.levels.keys()).flatMap(l => getConcsForLine(l));
            const stmtRevCount = stmtConcs.filter(c => c.reviewedByName).length;
            const stmtRiCount = stmtConcs.filter(c => c.riSignedByName).length;
            const stmtTotal = stmtConcs.length;

            // Sort levels by statutory position
            const sortedLevels = Array.from(stmtData.levels.entries()).sort((a, b) =>
              getStatutoryPosition(framework, stmt, a[0]) - getStatutoryPosition(framework, stmt, b[0])
            );

            return (
              <div key={stmt} className="border rounded-lg overflow-hidden">
                {/* Statement header */}
                <button onClick={() => toggle(stmtKey)} className="w-full grid grid-cols-[1fr_90px_90px_90px_80px_80px_40px_40px] gap-0 items-center px-2 py-2 bg-slate-100 hover:bg-slate-200 transition-colors text-xs">
                  <div className="flex items-center gap-1 font-bold text-slate-800">
                    {isStmtExp ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                    {stmt}
                  </div>
                  <div className="text-right font-mono font-semibold">{fmt(stmtCY)}</div>
                  <div className="text-right font-mono text-slate-500">{fmt(stmtPY)}</div>
                  <div className={`text-right font-mono ${stmtVar > 0 ? 'text-green-600' : stmtVar < 0 ? 'text-red-600' : 'text-slate-400'}`}>{fmt(stmtVar)}</div>
                  <div className={`text-right font-mono ${stmtAdj !== 0 ? 'text-red-600 font-semibold' : 'text-slate-400'}`}>{stmtAdj !== 0 ? fmt(stmtAdj) : '—'}</div>
                  <div className={`text-right font-mono ${stmtUnadj !== 0 ? 'text-amber-600 font-semibold' : 'text-slate-400'}`}>{stmtUnadj !== 0 ? fmt(stmtUnadj) : '—'}</div>
                  <div className="flex justify-center"><SignDot count={stmtRevCount} total={stmtTotal} label="Rev" /></div>
                  <div className="flex justify-center"><SignDot count={stmtRiCount} total={stmtTotal} label="RI" /></div>
                </button>

                {/* FS Level rows */}
                {isStmtExp && sortedLevels.map(([level, levelData]) => {
                  const levelKey = `level:${stmt}:${level}`;
                  const isLevelExp = expanded.has(levelKey);
                  const cy = sumCY(levelData.rows);
                  const py = sumPY(levelData.rows);
                  const v = cy - py;
                  const errs = getErrorsForLine(level);
                  const so = getSignOffCounts(level);

                  // Sort notes
                  const sortedNotes = Array.from(levelData.notes.entries()).sort((a, b) =>
                    getStatutoryPosition(framework, stmt, a[0]) - getStatutoryPosition(framework, stmt, b[0])
                  );

                  return (
                    <div key={level}>
                      <button onClick={() => toggle(levelKey)} className="w-full grid grid-cols-[1fr_90px_90px_90px_80px_80px_40px_40px] gap-0 items-center px-2 py-1.5 border-t border-slate-100 hover:bg-slate-50 transition-colors text-[11px]">
                        <div className="flex items-center gap-1 pl-4 text-slate-700 font-medium">
                          {(levelData.notes.size > 0 || levelData.rows.length > 0) ? (isLevelExp ? <ChevronDown className="h-3 w-3 text-slate-400" /> : <ChevronRight className="h-3 w-3 text-slate-400" />) : <div className="w-3" />}
                          {level}
                        </div>
                        <div className="text-right font-mono">{fmt(cy)}</div>
                        <div className="text-right font-mono text-slate-500">{fmt(py)}</div>
                        <div className={`text-right font-mono text-[10px] ${v > 0 ? 'text-green-600' : v < 0 ? 'text-red-600' : 'text-slate-400'}`}>
                          {fmt(v)} {py !== 0 ? `(${((v / Math.abs(py)) * 100).toFixed(0)}%)` : ''}
                        </div>
                        <div className={`text-right font-mono text-[10px] ${errs.adjusted !== 0 ? 'text-red-600' : 'text-slate-300'}`}>{errs.adjusted !== 0 ? fmt(errs.adjusted) : '—'}</div>
                        <div className={`text-right font-mono text-[10px] ${errs.unadjusted !== 0 ? 'text-amber-600' : 'text-slate-300'}`}>{errs.unadjusted !== 0 ? fmt(errs.unadjusted) : '—'}</div>
                        <div className="flex justify-center"><SignDot count={so.reviewerCount} total={so.total} label="" /></div>
                        <div className="flex justify-center"><SignDot count={so.riCount} total={so.total} label="" /></div>
                      </button>

                      {/* Expanded: FS Notes + TB accounts + Test conclusions */}
                      {isLevelExp && (
                        <div className="bg-slate-50/50 border-t border-slate-100">
                          {/* FS Note sub-rows */}
                          {sortedNotes.map(([note, noteRows]) => {
                            const nCY = sumCY(noteRows);
                            const nPY = sumPY(noteRows);
                            const nV = nCY - nPY;
                            const nErr = getErrorsForLine(note);
                            const nSo = getSignOffCounts(note);
                            return (
                              <div key={note} className="grid grid-cols-[1fr_90px_90px_90px_80px_80px_40px_40px] gap-0 items-center px-2 py-1 border-b border-slate-100 text-[10px]">
                                <div className="pl-10 text-slate-600 italic">{note}</div>
                                <div className="text-right font-mono text-slate-600">{fmt(nCY)}</div>
                                <div className="text-right font-mono text-slate-400">{fmt(nPY)}</div>
                                <div className={`text-right font-mono ${nV > 0 ? 'text-green-600' : nV < 0 ? 'text-red-600' : 'text-slate-400'}`}>{fmt(nV)}</div>
                                <div className={`text-right font-mono ${nErr.adjusted !== 0 ? 'text-red-600' : 'text-slate-300'}`}>{nErr.adjusted !== 0 ? fmt(nErr.adjusted) : '—'}</div>
                                <div className={`text-right font-mono ${nErr.unadjusted !== 0 ? 'text-amber-600' : 'text-slate-300'}`}>{nErr.unadjusted !== 0 ? fmt(nErr.unadjusted) : '—'}</div>
                                <div className="flex justify-center"><SignDot count={nSo.reviewerCount} total={nSo.total} label="" /></div>
                                <div className="flex justify-center"><SignDot count={nSo.riCount} total={nSo.total} label="" /></div>
                              </div>
                            );
                          })}

                          {/* Component TB accounts */}
                          <div className="px-6 py-1.5">
                            <div className="text-[8px] font-semibold text-slate-400 uppercase mb-1">Component Accounts</div>
                            <table className="w-full text-[10px]">
                              <tbody>
                                {levelData.rows.slice(0, 50).map(r => (
                                  <tr key={r.id} className="border-b border-slate-100/50">
                                    <td className="py-0.5 font-mono text-slate-400 w-20">{r.accountCode}</td>
                                    <td className="py-0.5 text-slate-600">{r.description}</td>
                                    <td className="py-0.5 text-right font-mono w-20">{fmt(Number(r.currentYear) || 0)}</td>
                                    <td className="py-0.5 text-right font-mono text-slate-400 w-20">{fmt(Number(r.priorYear) || 0)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>

                          {/* Test conclusions for this FS line */}
                          {(() => {
                            const concs = getConcsForLine(level);
                            if (concs.length === 0) return null;
                            return (
                              <div className="px-6 py-1.5 border-t border-slate-100">
                                <div className="text-[8px] font-semibold text-slate-400 uppercase mb-1">Test Conclusions</div>
                                <div className="space-y-0.5">
                                  {concs.map(c => (
                                    <div key={c.id} className="flex items-center gap-2 text-[10px]">
                                      <ConcDot conclusion={c.conclusion} />
                                      <span className="text-slate-700 flex-1 truncate">{c.testDescription}</span>
                                      {c.totalErrors > 0 && <span className="text-red-600 font-mono">£{fmt(c.extrapolatedError)}</span>}
                                      {c.reviewedByName && <span className="text-[8px] text-green-600">{c.reviewedByName}</span>}
                                      {c.riSignedByName && <span className="text-[8px] text-blue-600">RI: {c.riSignedByName}</span>}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── TB Format (existing view) ───
function TBFormatView({ tbRows }: { tbRows: TBRow[] }) {
  const byStatement = new Map<string, TBRow[]>();
  for (const row of tbRows) {
    const stmt = row.fsStatement || 'Unclassified';
    if (!byStatement.has(stmt)) byStatement.set(stmt, []);
    byStatement.get(stmt)!.push(row);
  }

  return (
    <div className="space-y-4">
      {Array.from(byStatement.entries()).map(([stmt, rows]) => {
        const totalCY = rows.reduce((s, r) => s + (Number(r.currentYear) || 0), 0);
        const totalPY = rows.reduce((s, r) => s + (Number(r.priorYear) || 0), 0);
        return (
          <div key={stmt} className="border rounded-lg overflow-hidden">
            <div className="bg-slate-100 px-3 py-2 flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-700">{stmt}</span>
              <span className="text-[10px] text-slate-500">CY: {fmt(totalCY)} | PY: {fmt(totalPY)}</span>
            </div>
            <table className="w-full text-[10px]">
              <thead><tr className="bg-slate-50 border-b">
                <th className="text-left px-2 py-1 text-slate-600">Account</th>
                <th className="text-left px-2 py-1 text-slate-600">Description</th>
                <th className="text-left px-2 py-1 text-slate-600">FS Level</th>
                <th className="text-right px-2 py-1 text-slate-600">Current Year</th>
                <th className="text-right px-2 py-1 text-slate-600">Prior Year</th>
                <th className="text-right px-2 py-1 text-slate-600">Variance</th>
              </tr></thead>
              <tbody>
                {rows.map(row => {
                  const cy = Number(row.currentYear) || 0;
                  const py = Number(row.priorYear) || 0;
                  const v = cy - py;
                  return (
                    <tr key={row.id} className="border-b border-slate-50 hover:bg-slate-50/50">
                      <td className="px-2 py-1 font-mono text-slate-500">{row.accountCode}</td>
                      <td className="px-2 py-1 text-slate-700">{row.description}</td>
                      <td className="px-2 py-1 text-slate-400">{row.fsLevel || ''}</td>
                      <td className="px-2 py-1 text-right font-mono">{fmt(cy)}</td>
                      <td className="px-2 py-1 text-right font-mono text-slate-500">{fmt(py)}</td>
                      <td className={`px-2 py-1 text-right font-mono ${v > 0 ? 'text-green-600' : v < 0 ? 'text-red-600' : 'text-slate-400'}`}>{fmt(v)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}
