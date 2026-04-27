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

/**
 * Accounting-style number formatter.
 * - Positive (debit):  "1,234\u00A0"  ← trailing figure space
 * - Negative (credit): "(1,234)"
 *
 * The trailing non-breaking space on positives keeps the last digit in
 * the same column as the pre-paren last digit of negatives when the
 * container is right-aligned with tabular-nums. Containers must use
 * `font-mono tabular-nums tabular-nums` for this to render cleanly.
 */
function f(n: number): string {
  const abs = Math.abs(n);
  const s = abs.toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return n < 0 ? `(${s})` : `${s}\u00A0`;
}

// ─── Types ───
interface TBRow { id: string; accountCode: string; description: string; fsStatement: string | null; fsLevel: string | null; fsLineId: string | null; fsNoteLevel: string | null; currentYear: number | null; priorYear: number | null; }
interface Conc { id: string; fsLine: string; fsLineId: string | null; testDescription: string; conclusion: string | null; totalErrors: number; extrapolatedError: number; reviewedByName: string | null; riSignedByName: string | null; accountCode: string | null; }
interface Err { id: string; fsLine: string; fsLineId: string | null; errorAmount: number; errorType: string; }

// Assertion-column setup for the TB view. Order matches the audit
// standard ordering (existence → presentation), and the LABEL is the
// short code that fits in a narrow column header. Only assertions
// actually present in the engagement's tests get rendered as columns.
const ASSERTION_ORDER = ['existence', 'occurrence', 'completeness', 'accuracy', 'valuation', 'rights_obligations', 'cut_off', 'classification', 'presentation'] as const;
const ASSERTION_LABEL: Record<string, string> = {
  existence: 'E',
  occurrence: 'O',
  completeness: 'C',
  accuracy: 'A',
  valuation: 'V',
  rights_obligations: 'RO',
  cut_off: 'CO',
  classification: 'CL',
  presentation: 'P',
};
const ASSERTION_TITLE: Record<string, string> = {
  existence: 'Existence',
  occurrence: 'Occurrence',
  completeness: 'Completeness',
  accuracy: 'Accuracy',
  valuation: 'Valuation / Allocation',
  rights_obligations: 'Rights & Obligations',
  cut_off: 'Cut-off',
  classification: 'Classification',
  presentation: 'Presentation & Disclosure',
};

interface DotCounts { g: number; o: number; r: number; }
function emptyDots(): DotCounts { return { g: 0, o: 0, r: 0 }; }
function addDots(a: DotCounts, b: DotCounts): DotCounts { return { g: a.g + b.g, o: a.o + b.o, r: a.r + b.r }; }
function isEmpty(d: DotCounts): boolean { return d.g === 0 && d.o === 0 && d.r === 0; }
function colourBucket(conclusion: string | null): 'g' | 'o' | 'r' | null {
  if (conclusion === 'green') return 'g';
  if (conclusion === 'orange') return 'o';
  if (conclusion === 'red' || conclusion === 'failed') return 'r';
  return null;
}

function Dot({ c }: { c: string | null }) {
  const col = c === 'green' ? 'bg-green-500' : c === 'orange' ? 'bg-orange-500' : c === 'red' ? 'bg-red-500' : 'bg-slate-300';
  return <div className={`w-2 h-2 rounded-full ${col} inline-block`} />;
}

// Renders up to 3 dots (one per colour bucket) in an assertion cell,
// with a tiny count badge for buckets containing more than one test.
// The user spec: "no more than 3 dots (1 for each colour) in an
// assertion column per row… rather than duplicate a colour just have
// count".
function AssertionDots({ dots }: { dots: DotCounts }) {
  if (isEmpty(dots)) return <span className="text-slate-200 text-[9px]">—</span>;
  return (
    <div className="inline-flex items-center justify-center gap-1">
      {dots.g > 0 && <DotWithCount c="green" count={dots.g} />}
      {dots.o > 0 && <DotWithCount c="orange" count={dots.o} />}
      {dots.r > 0 && <DotWithCount c="red" count={dots.r} />}
    </div>
  );
}
function DotWithCount({ c, count }: { c: 'green' | 'orange' | 'red'; count: number }) {
  const bg = c === 'green' ? 'bg-green-500' : c === 'orange' ? 'bg-orange-500' : 'bg-red-500';
  return (
    <span className="inline-flex items-center gap-0.5 leading-none">
      <span className={`w-2 h-2 rounded-full ${bg}`} />
      {count > 1 && <span className="text-[8px] text-slate-500">{count}</span>}
    </span>
  );
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
  // testDescription (lowercased) → set of assertion codes the test
  // covers. Built from /test-allocations on mount; used by the TB view
  // to colour the per-row assertion dots without needing the
  // conclusion endpoint to be modified.
  const [testAssertions, setTestAssertions] = useState<Map<string, string[]>>(new Map());
  const [framework, setFramework] = useState('FRS102');
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Period end dates for the current + prior period, used in the
  // column heading. Resolved from the engagement's period record.
  const [periodEndLabel, setPeriodEndLabel] = useState<string>('Period End');
  const [priorPeriodEndLabel, setPriorPeriodEndLabel] = useState<string>('Prior End');

  useEffect(() => {
    (async () => {
      try {
        const [tbRes, concRes, errRes, pfRes, engRes, allocRes] = await Promise.all([
          fetch(`/api/engagements/${engagementId}/trial-balance`),
          fetch(`/api/engagements/${engagementId}/test-conclusions`),
          fetch(`/api/engagements/${engagementId}/error-schedule`),
          fetch(`/api/engagements/${engagementId}/permanent-file`),
          fetch(`/api/engagements/${engagementId}`).catch(() => null),
          // Test allocations carry the test bank with assertions; we
          // only need test.name → test.assertions to colour the
          // assertion-column dots in the TB view.
          fetch(`/api/engagements/${engagementId}/test-allocations`).catch(() => null),
        ]);
        if (tbRes.ok) setTbRows((await tbRes.json()).rows || []);
        if (concRes.ok) setConclusions((await concRes.json()).conclusions || []);
        if (errRes.ok) setErrors((await errRes.json()).errors || []);
        if (allocRes && allocRes.ok) {
          const data = await allocRes.json();
          // Index by lowercased test name. Tests appear both in the
          // allocations array (.test.name + .test.assertions) and in
          // the .tests array (top-level test bank). Read from both so
          // a conclusion whose test isn't currently allocated still
          // resolves its assertions.
          const map = new Map<string, string[]>();
          const ingest = (name: string, assertions: any) => {
            if (!name || !Array.isArray(assertions)) return;
            const key = name.toLowerCase().trim();
            if (!key) return;
            // Normalise to lowercase strings; keep the first record we
            // see so allocations win over generic test-bank entries.
            if (map.has(key)) return;
            map.set(key, assertions.map(String));
          };
          for (const t of (data?.tests || [])) ingest(t?.name, t?.assertions);
          for (const a of (data?.allocations || [])) ingest(a?.test?.name, a?.test?.assertions);
          setTestAssertions(map);
        }
        if (pfRes.ok) {
          const d = await pfRes.json(); const ans = d.answers || d.data || {};
          for (const [k, v] of Object.entries(ans)) { if (typeof v === 'string' && k.toLowerCase().includes('applicable financial reporting')) { setFramework(v); break; } }
        }
        if (engRes && engRes.ok) {
          try {
            const eng = await engRes.json();
            const fmt = (d: unknown): string | null => {
              if (!d || typeof d !== 'string') return null;
              try { return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); }
              catch { return null; }
            };
            const pEnd = fmt(eng?.engagement?.period?.periodEnd || eng?.period?.periodEnd || eng?.periodEnd);
            const priorEnd = fmt(eng?.engagement?.priorPeriodEngagement?.period?.periodEnd
              || eng?.priorPeriodEngagement?.period?.periodEnd
              || eng?.priorPeriodEnd);
            if (pEnd) setPeriodEndLabel(pEnd);
            if (priorEnd) setPriorPeriodEndLabel(priorEnd);
          } catch { /* fall back to generic labels */ }
        }
      } catch {} finally { setLoading(false); }
    })();
  }, [engagementId]);

  // Pre-compute lookup maps keyed by fsLineId (canonical, exact)
  const concsByFsLineId = useMemo(() => {
    const m = new Map<string, Conc[]>();
    for (const c of conclusions) {
      // Primary: use fsLineId if available
      const k = c.fsLineId || (c.fsLine || '').toLowerCase();
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

  const errsByFsLineId = useMemo(() => {
    const m = new Map<string, { adj: number; unadj: number }>();
    for (const e of errors) {
      const k = e.fsLineId || (e.fsLine || '').toLowerCase();
      const cur = m.get(k) || { adj: 0, unadj: 0 };
      if (e.errorType === 'factual') cur.adj += e.errorAmount; else cur.unadj += e.errorAmount;
      m.set(k, cur);
    }
    return m;
  }, [errors]);

  // Hierarchy — track fsLineId per level group
  type LevelData = { notes: Map<string, TBRow[]>; rows: TBRow[]; fsLineId: string | null };
  const hierarchy = useMemo(() => {
    const stmtMap = new Map<string, Map<string, LevelData>>();
    for (const s of STATEMENT_ORDER) stmtMap.set(s, new Map());
    for (const row of tbRows) {
      const stmt = row.fsStatement || 'Unclassified';
      if (!stmtMap.has(stmt)) stmtMap.set(stmt, new Map());
      const levels = stmtMap.get(stmt)!;
      const level = row.fsLevel || 'Other';
      if (!levels.has(level)) levels.set(level, { notes: new Map(), rows: [], fsLineId: null });
      const ld = levels.get(level)!;
      ld.rows.push(row);
      // Use the first row's fsLineId as the canonical ID for this level
      if (!ld.fsLineId && row.fsLineId) ld.fsLineId = row.fsLineId;
      if (row.fsNoteLevel) {
        if (!ld.notes.has(row.fsNoteLevel)) ld.notes.set(row.fsNoteLevel, []);
        ld.notes.get(row.fsNoteLevel)!.push(row);
      }
    }
    return stmtMap;
  }, [tbRows]);

  // Fuzzy match for pre-fsLineId data: "Cash at Bank" ↔ "Cash and Cash Equivalents"
  const allConcKeys = useMemo(() => Array.from(concsByFsLineId.keys()), [concsByFsLineId]);
  function fuzzy(a: string, b: string): boolean {
    if (a === b) return true;
    if (a.includes(b) || b.includes(a)) return true;
    const stop = new Set(['and','at','the','of','in','&','due','within','one','year','after','other','trade']);
    const wa = new Set(a.split(/[\s\-\/]+/).filter(w => w.length > 1 && !stop.has(w)));
    const wb = new Set(b.split(/[\s\-\/]+/).filter(w => w.length > 1 && !stop.has(w)));
    if (wa.size === 0 || wb.size === 0) return false;
    let n = 0; for (const w of wa) if (wb.has(w)) n++;
    return n > 0 && n >= Math.min(wa.size, wb.size) * 0.5;
  }

  function getConcs(fsLineId: string | null, name: string): Conc[] {
    // 1. Exact by fsLineId
    if (fsLineId) { const r = concsByFsLineId.get(fsLineId); if (r?.length) return r; }
    // 2. Exact by lowercase name
    const byName = concsByFsLineId.get(name.toLowerCase());
    if (byName?.length) return byName;
    // 3. Fuzzy match (for pre-fsLineId data where names differ)
    const lc = name.toLowerCase();
    for (const key of allConcKeys) {
      if (fuzzy(lc, key)) { const r = concsByFsLineId.get(key); if (r?.length) return r; }
    }
    return [];
  }

  function getErrs(fsLineId: string | null, name: string) {
    if (fsLineId) { const r = errsByFsLineId.get(fsLineId); if (r) return r; }
    const byName = errsByFsLineId.get(name.toLowerCase());
    if (byName) return byName;
    const lc = name.toLowerCase();
    for (const [key, val] of errsByFsLineId) { if (fuzzy(lc, key)) return val; }
    return { adj: 0, unadj: 0 };
  }

  function getAccConcs(code: string): Conc[] { return concsByAccount.get(code.toLowerCase()) || []; }

  function signCounts(concs: Conc[]) {
    // Reviewer count cascades from RI: a conclusion with an RI sign-off
    // but no direct reviewer sign-off still counts as reviewed for the
    // quick "X/Y" rollups.
    return {
      rev: concs.filter(c => c.reviewedByName || c.riSignedByName).length,
      ri: concs.filter(c => c.riSignedByName).length,
      total: concs.length,
    };
  }

  function toggle(key: string) { setExpanded(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; }); }

  if (loading) return <div className="p-6 text-center"><Loader2 className="h-5 w-5 animate-spin text-slate-400 mx-auto" /></div>;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-bold text-slate-700">Financial Statement Review</h3>
          <span className="text-[9px] text-slate-400">{conclusions.length} conclusions · {errors.length} errors · {tbRows.length} TB rows</span>
        </div>
        <div className="flex bg-slate-100 rounded p-0.5 text-[10px]">
          <button onClick={() => setViewMode('statement')} className={`px-3 py-1 font-medium rounded ${viewMode === 'statement' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}`}>Statement</button>
          <button onClick={() => setViewMode('tb')} className={`px-3 py-1 font-medium rounded ${viewMode === 'tb' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}`}>TB Format</button>
        </div>
      </div>

      {viewMode === 'tb' ? (
        <TBView
          tbRows={tbRows}
          conclusions={conclusions}
          testAssertions={testAssertions}
          expanded={expanded}
          toggle={toggle}
          periodEndLabel={periodEndLabel}
          priorPeriodEndLabel={priorPeriodEndLabel}
        />
      ) : (
        <div className="space-y-3">
          {/*
            Column heading row — sits outside the statement cards and uses
            the same widths as each statement's right-edge columns (w-20 / w-18
            / w-16 / w-14). Labels: FS Line / Period.End / Prior End /
            Errors (Adj) / Errors (Unadj) / Rev / RI dots.
          */}
          <div className="flex items-center justify-between px-3 py-1 text-[9px] font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200">
            <span>FS Line</span>
            <div className="flex items-center gap-4">
              <span className="w-20 text-right" title="Current period end">{periodEndLabel}</span>
              <span className="w-20 text-right" title="Prior period end">{priorPeriodEndLabel}</span>
              <span className="w-16 text-right" title="Errors booked (adjusted)">Err. Adj</span>
              <span className="w-16 text-right" title="Errors unadjusted">Err. Unadj</span>
              <span className="flex gap-1.5">
                <span className="w-3.5 text-center" title="Reviewer sign-off count">Rev</span>
                <span className="w-3.5 text-center" title="RI sign-off count">RI</span>
              </span>
            </div>
          </div>
          {Array.from(hierarchy.entries()).map(([stmt, levels]) => {
            if (levels.size === 0) return null;
            const stmtKey = `s:${stmt}`;
            const isOpen = expanded.has(stmtKey);
            // Aggregate from levels
            const allRows = Array.from(levels.values()).flatMap(l => l.rows);
            const cy = allRows.reduce((s, r) => s + (Number(r.currentYear) || 0), 0);
            const py = allRows.reduce((s, r) => s + (Number(r.priorYear) || 0), 0);
            const allConcs = Array.from(levels.entries()).flatMap(([l, ld]) => getConcs(ld.fsLineId, l));
            const so = signCounts(allConcs);
            const allErrs = Array.from(levels.entries()).reduce((a, [l, ld]) => { const e = getErrs(ld.fsLineId, l); return { adj: a.adj + e.adj, unadj: a.unadj + e.unadj }; }, { adj: 0, unadj: 0 });
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
                    <span className="font-mono tabular-nums font-semibold text-slate-700 w-20 text-right">{f(cy)}</span>
                    <span className="font-mono tabular-nums text-slate-400 w-20 text-right">{f(py)}</span>
                    {allErrs.adj !== 0 && <span className="text-red-600 font-mono tabular-nums w-16 text-right">{f(allErrs.adj)}</span>}
                    {allErrs.unadj !== 0 && <span className="text-amber-600 font-mono tabular-nums w-16 text-right">{f(allErrs.unadj)}</span>}
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
                      const lConcs = getConcs(ld.fsLineId, level);
                      const lSo = signCounts(lConcs);
                      const lErr = getErrs(ld.fsLineId, level);
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
                              <span className="font-mono tabular-nums font-semibold w-18 text-right">{f(lCY)}</span>
                              <span className="font-mono tabular-nums text-slate-400 w-18 text-right">{f(lPY)}</span>
                              <span className={`font-mono tabular-nums w-18 text-right ${lV > 0 ? 'text-green-600' : lV < 0 ? 'text-red-600' : 'text-slate-400'}`}>{f(lV)}</span>
                              <span className={`font-mono tabular-nums w-14 text-right ${lErr.adj !== 0 ? 'text-red-600' : 'text-slate-300'}`}>{lErr.adj !== 0 ? f(lErr.adj) : '—'}</span>
                              <span className={`font-mono tabular-nums w-14 text-right ${lErr.unadj !== 0 ? 'text-amber-600' : 'text-slate-300'}`}>{lErr.unadj !== 0 ? f(lErr.unadj) : '—'}</span>
                              <div className="flex gap-1"><SignDot count={lSo.rev} total={lSo.total} /><SignDot count={lSo.ri} total={lSo.total} /></div>
                            </div>
                          </button>

                          {isLevelOpen && (
                            <div className="border-t">
                              {/* FS Level test summary — shows all tests for this level */}
                              {lConcs.length > 0 ? (
                                <div className="px-3 py-1.5 bg-blue-50/30 border-b space-y-0.5">
                                  <div className="text-[8px] font-semibold text-blue-600 uppercase">Tests for {level} ({lConcs.length})</div>
                                  {lConcs.map(c => (
                                    <div key={c.id} className="flex items-center gap-2 text-[10px]">
                                      <Dot c={c.conclusion} />
                                      <span className="text-slate-700 flex-1 truncate">{c.testDescription}</span>
                                      {c.totalErrors > 0 && <span className="text-red-600 font-mono tabular-nums text-[9px]">£{f(c.extrapolatedError)}</span>}
                                      {/* Reviewer chip cascades from RI */}
                                      {c.reviewedByName
                                        ? <span className="text-[8px] bg-green-100 text-green-700 px-1 py-0.5 rounded">{c.reviewedByName}</span>
                                        : c.riSignedByName
                                          ? <span className="text-[8px] bg-green-100 text-green-700 px-1 py-0.5 rounded" title="Covered by RI sign-off">{c.riSignedByName}</span>
                                          : <span className="text-[8px] text-slate-300">No rev</span>}
                                      {c.riSignedByName ? <span className="text-[8px] bg-blue-100 text-blue-700 px-1 py-0.5 rounded">RI: {c.riSignedByName}</span> : <span className="text-[8px] text-slate-300">No RI</span>}
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <div className="px-3 py-1.5 bg-slate-50/50 border-b text-[10px] text-slate-400 italic">
                                  No test conclusions at FS line level for {level}. Expand account rows below to view account-level tests, or run tests in the Audit Plan.
                                </div>
                              )}
                              {/* FS Note sub-cards (if any) */}
                              {sortedNotes.length > 0 && (
                                <div className="px-2 py-1.5 space-y-1">
                                  {sortedNotes.map(([note, noteRows]) => {
                                    const noteKey = `n:${stmt}:${level}:${note}`;
                                    const isNoteOpen = expanded.has(noteKey);
                                    const nCY = noteRows.reduce((s, r) => s + (Number(r.currentYear) || 0), 0);
                                    const nPY = noteRows.reduce((s, r) => s + (Number(r.priorYear) || 0), 0);
                                    // Notes: try to find an fsLineId from the note rows, fallback to parent level
                                    const noteFsLineId = noteRows.find(r => r.fsLineId)?.fsLineId || ld.fsLineId;
                                    const nConcs = getConcs(noteFsLineId, note);
                                    const nSo = signCounts(nConcs);
                                    const nErr = getErrs(noteFsLineId, note);
                                    return (
                                      <div key={note} className="bg-slate-50 rounded border border-slate-100 overflow-hidden">
                                        <button onClick={() => toggle(noteKey)} className="w-full flex items-center justify-between px-2.5 py-1 hover:bg-slate-100 transition-colors">
                                          <div className="flex items-center gap-1.5">
                                            {isNoteOpen ? <ChevronDown className="h-2.5 w-2.5 text-slate-400" /> : <ChevronRight className="h-2.5 w-2.5 text-slate-400" />}
                                            <span className="text-[10px] font-medium text-slate-600">{note}</span>
                                          </div>
                                          <div className="flex items-center gap-3 text-[10px]">
                                            <span className="font-mono tabular-nums w-16 text-right">{f(nCY)}</span>
                                            <span className="font-mono tabular-nums text-slate-400 w-16 text-right">{f(nPY)}</span>
                                            <span className={`font-mono tabular-nums w-12 text-right ${nErr.adj !== 0 ? 'text-red-600' : 'text-slate-300'}`}>{nErr.adj !== 0 ? f(nErr.adj) : '—'}</span>
                                            <span className={`font-mono tabular-nums w-12 text-right ${nErr.unadj !== 0 ? 'text-amber-600' : 'text-slate-300'}`}>{nErr.unadj !== 0 ? f(nErr.unadj) : '—'}</span>
                                            <div className="flex gap-1"><SignDot count={nSo.rev} total={nSo.total} /><SignDot count={nSo.ri} total={nSo.total} /></div>
                                          </div>
                                        </button>
                                        {isNoteOpen && <AccountRows rows={noteRows} getAccConcs={getAccConcs} lineConcs={nConcs} fsLineName={note} expanded={expanded} toggle={toggle} prefix={`na:${note}`} />}
                                      </div>
                                    );
                                  })}
                                </div>
                              )}

                              {/* Account rows (when no notes, or as the default view) */}
                              {sortedNotes.length === 0 && <AccountRows rows={ld.rows} getAccConcs={getAccConcs} lineConcs={lConcs} fsLineName={level} expanded={expanded} toggle={toggle} prefix={`la:${level}`} />}
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
function AccountRows({ rows, getAccConcs, lineConcs, fsLineName, expanded, toggle, prefix }: {
  rows: TBRow[];
  getAccConcs: (code: string) => Conc[];
  lineConcs: Conc[];
  fsLineName: string;
  expanded: Set<string>;
  toggle: (key: string) => void;
  prefix: string;
}) {

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
        // Reviewer count cascades from RI (same rule as signCounts above).
        const so = {
          rev: concs.filter(c => c.reviewedByName || c.riSignedByName).length,
          ri: concs.filter(c => c.riSignedByName).length,
          total: concs.length,
        };

        return (
          <div key={r.id}>
            {/* Account row — always clickable so users can drill down even when no conclusions exist */}
            <button
              onClick={() => toggle(rowKey)}
              className={`w-full flex items-center gap-1.5 px-2 py-1 text-[10px] border-b border-slate-100/50 transition-colors cursor-pointer ${
                isOpen ? 'bg-blue-50/30' : 'hover:bg-slate-50/50'
              }`}
            >
              {/* Expander */}
              <div className="w-4 flex-shrink-0 text-center">
                {isOpen ? <ChevronDown className="h-2.5 w-2.5 text-slate-400 inline" /> : <ChevronRight className="h-2.5 w-2.5 text-slate-400 inline" />}
              </div>
              {/* Code */}
              <span className="font-mono tabular-nums text-slate-400 w-14 text-left flex-shrink-0">{r.accountCode}</span>
              {/* Description */}
              <span className="text-slate-700 flex-1 text-left truncate">{r.description}</span>
              {/* CY / PY */}
              <span className="font-mono tabular-nums w-16 text-right flex-shrink-0">{f(Number(r.currentYear) || 0)}</span>
              <span className="font-mono tabular-nums text-slate-400 w-16 text-right flex-shrink-0">{f(Number(r.priorYear) || 0)}</span>
              {/* Conclusion dots */}
              <div className="w-12 flex items-center justify-center gap-0.5 flex-shrink-0">
                {hasConcs ? concs.map(c => <Dot key={c.id} c={c.conclusion} />) : <span className="text-slate-300">—</span>}
              </div>
              {/* Rev / RI */}
              <div className="flex-shrink-0"><SignDot count={so.rev} total={so.total} /></div>
              <div className="flex-shrink-0"><SignDot count={so.ri} total={so.total} /></div>
            </button>

            {/* Expanded: individual tests for this account */}
            {isOpen && (
              <div className="bg-blue-50/20 border-b border-slate-200 px-4 py-1.5">
                {concs.length === 0 ? (
                  <div className="py-1 text-[10px] text-slate-400 italic">
                    No test conclusions recorded for {fsLineName} / {r.accountCode}. Run tests in the Audit Plan and save conclusions to populate this section.
                  </div>
                ) : concs.map(c => (
                  <div key={c.id} className="flex items-center gap-2 py-0.5 text-[10px]">
                    <Dot c={c.conclusion} />
                    <span className="text-slate-700 flex-1 truncate">{c.testDescription}</span>
                    {c.totalErrors > 0 && <span className="text-red-600 font-mono tabular-nums text-[9px]">£{f(c.extrapolatedError)}</span>}
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {/* Reviewer chip cascades from RI */}
                      {c.reviewedByName ? (
                        <span className="text-[8px] bg-green-100 text-green-700 px-1 py-0.5 rounded">{c.reviewedByName}</span>
                      ) : c.riSignedByName ? (
                        <span className="text-[8px] bg-green-100 text-green-700 px-1 py-0.5 rounded" title="Covered by RI sign-off">{c.riSignedByName}</span>
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

// ─── TB Format ──────────────────────────────────────────────────────
//
// Per user spec:
//   - Layout shifts everything left and adds breathing room between
//     columns (reduced left padding, larger horizontal gaps).
//   - Assertion columns sit between Description and the numeric
//     columns. Only assertions actually present in the data appear
//     as columns (no empty E/O/C/A/V/RO/CO/CL/P forest when most are
//     unused).
//   - Each cell shows up to three coloured dots (green / orange /
//     red), one per Result bucket from the Test Summary. Multiple
//     tests of the same colour collapse into a single dot with a
//     count badge — never duplicate a colour.
//   - Statements collapse/expand. When collapsed the statement
//     header carries the aggregated assertion dots across all rows
//     in that statement.
//
// Conclusions are matched to TB rows by accountCode (a conclusion
// recorded against a specific account) or by FS Line ID (account-
// level conclusion that applies to every TB row sharing that line).
function TBView({ tbRows, conclusions, testAssertions, expanded, toggle, periodEndLabel, priorPeriodEndLabel }: {
  tbRows: TBRow[];
  conclusions: Conc[];
  testAssertions: Map<string, string[]>;
  expanded: Set<string>;
  toggle: (key: string) => void;
  periodEndLabel: string;
  priorPeriodEndLabel: string;
}) {
  // Index conclusions for fast per-row lookup.
  const concsByAccount = useMemo(() => {
    const m = new Map<string, Conc[]>();
    for (const c of conclusions) {
      if (!c.accountCode) continue;
      const k = c.accountCode.toLowerCase();
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(c);
    }
    return m;
  }, [conclusions]);
  const concsByFsLineId = useMemo(() => {
    const m = new Map<string, Conc[]>();
    for (const c of conclusions) {
      if (!c.fsLineId) continue;
      if (!m.has(c.fsLineId)) m.set(c.fsLineId, []);
      m.get(c.fsLineId)!.push(c);
    }
    return m;
  }, [conclusions]);

  function rowConclusions(row: TBRow): Conc[] {
    const acc = concsByAccount.get(row.accountCode.toLowerCase()) || [];
    if (acc.length > 0) return acc;
    if (row.fsLineId) return concsByFsLineId.get(row.fsLineId) || [];
    return [];
  }

  function rowAssertionDots(row: TBRow): Record<string, DotCounts> {
    const out: Record<string, DotCounts> = {};
    for (const c of rowConclusions(row)) {
      const bucket = colourBucket(c.conclusion);
      if (!bucket) continue;
      const assertions = testAssertions.get((c.testDescription || '').toLowerCase().trim()) || [];
      for (const a of assertions) {
        if (!out[a]) out[a] = emptyDots();
        out[a][bucket]++;
      }
    }
    return out;
  }

  // Group TB rows by statement.
  const byStmt = useMemo(() => {
    const m = new Map<string, TBRow[]>();
    for (const r of tbRows) { const s = r.fsStatement || 'Unclassified'; if (!m.has(s)) m.set(s, []); m.get(s)!.push(r); }
    return m;
  }, [tbRows]);

  // Pre-compute statement-level aggregates so the collapsed header
  // can show rolled-up assertion dots without re-walking conclusions
  // on every render.
  const stmtData = useMemo(() => {
    const out = new Map<string, { rows: TBRow[]; aggDots: Record<string, DotCounts>; presentAssertions: Set<string>; cy: number; py: number }>();
    for (const [stmt, rows] of byStmt.entries()) {
      const agg: Record<string, DotCounts> = {};
      const present = new Set<string>();
      let cy = 0, py = 0;
      for (const row of rows) {
        cy += Number(row.currentYear) || 0;
        py += Number(row.priorYear) || 0;
        const dots = rowAssertionDots(row);
        for (const [a, d] of Object.entries(dots)) {
          if (!agg[a]) agg[a] = emptyDots();
          agg[a] = addDots(agg[a], d);
          present.add(a);
        }
      }
      out.set(stmt, { rows, aggDots: agg, presentAssertions: present, cy, py });
    }
    return out;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [byStmt, conclusions, testAssertions]);

  // Determine which assertion columns to show globally — union across
  // all statements, ordered per ASSERTION_ORDER. Assertions that
  // appear nowhere in the data get no column at all.
  const assertionCols = useMemo(() => {
    const present = new Set<string>();
    for (const data of stmtData.values()) {
      for (const a of data.presentAssertions) present.add(a);
    }
    const ordered = ASSERTION_ORDER.filter(a => present.has(a));
    // Append any unknown assertion codes (e.g. firm-specific) at the
    // end so they're still visible.
    for (const a of present) {
      if (!ordered.includes(a as any)) ordered.push(a as any);
    }
    return ordered;
  }, [stmtData]);

  return (
    // Root pulled left (no horizontal padding) and using full width
    // so the table starts as close to the viewport edge as possible.
    <div className="-mx-1 space-y-2">
      {Array.from(byStmt.keys()).map(stmt => {
        const data = stmtData.get(stmt)!;
        const stmtKey = `tb:s:${stmt}`;
        const isOpen = expanded.has(stmtKey);
        return (
          <div key={stmt} className="border rounded-lg overflow-hidden">
            {/* Statement header — clickable to collapse/expand. When
                collapsed, the assertion dots aggregate across every
                row in the statement. */}
            <button
              type="button"
              onClick={() => toggle(stmtKey)}
              className="w-full flex items-center gap-3 bg-slate-100 hover:bg-slate-200 px-2 py-1.5 text-left"
            >
              {isOpen
                ? <ChevronDown className="h-3.5 w-3.5 text-slate-500 flex-shrink-0" />
                : <ChevronRight className="h-3.5 w-3.5 text-slate-500 flex-shrink-0" />}
              <span className="text-xs font-bold text-slate-800 flex-shrink-0">{stmt}</span>
              <span className="text-[10px] text-slate-400">({data.rows.length} a/c)</span>
              <div className="flex-1" />
              {/* Aggregated assertion dots — only shown when collapsed.
                  Helps the user see at-a-glance the coverage state of
                  every assertion across the whole statement. */}
              {!isOpen && assertionCols.map(a => (
                <span key={a} className="inline-flex items-center gap-1 px-1" title={ASSERTION_TITLE[a] || a}>
                  <span className="text-[8px] uppercase text-slate-400 font-semibold">{ASSERTION_LABEL[a] || a}</span>
                  <AssertionDots dots={data.aggDots[a] || emptyDots()} />
                </span>
              ))}
              <span className="font-mono tabular-nums text-[11px] font-semibold text-slate-700 w-24 text-right flex-shrink-0 ml-3">{f(data.cy)}</span>
              <span className="font-mono tabular-nums text-[11px] text-slate-400 w-24 text-right flex-shrink-0">{f(data.py)}</span>
            </button>

            {isOpen && (
              <table className="w-full text-[10px]">
                <thead>
                  <tr className="bg-slate-50 border-b">
                    {/* Reduced horizontal padding (px-1) shifts the
                        whole table left; widened gaps between columns
                        come from the explicit right-column widths
                        below, which leave airspace either side. */}
                    <th className="text-left px-1 py-1 text-slate-600 w-20">Code</th>
                    <th className="text-left px-3 py-1 text-slate-600">Description</th>
                    <th className="text-left px-2 py-1 text-slate-400 w-32">FS Level</th>
                    {assertionCols.map(a => (
                      <th key={a} className="text-center px-2 py-1 text-slate-500 w-16" title={ASSERTION_TITLE[a] || a}>
                        {ASSERTION_LABEL[a] || a}
                      </th>
                    ))}
                    <th className="text-right px-3 py-1 text-slate-600 w-24">{periodEndLabel}</th>
                    <th className="text-right px-3 py-1 text-slate-600 w-24">{priorPeriodEndLabel}</th>
                    <th className="text-right px-3 py-1 text-slate-600 w-20">Variance</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map(r => {
                    const cy = Number(r.currentYear) || 0;
                    const py = Number(r.priorYear) || 0;
                    const v = cy - py;
                    const dots = rowAssertionDots(r);
                    return (
                      <tr key={r.id} className="border-b border-slate-50">
                        <td className="px-1 py-0.5 font-mono tabular-nums text-slate-500">{r.accountCode}</td>
                        <td className="px-3 py-0.5 text-slate-700">{r.description}</td>
                        <td className="px-2 py-0.5 text-slate-400 truncate">{r.fsLevel || ''}</td>
                        {assertionCols.map(a => (
                          <td key={a} className="px-2 py-0.5 text-center">
                            <AssertionDots dots={dots[a] || emptyDots()} />
                          </td>
                        ))}
                        <td className="px-3 py-0.5 text-right font-mono tabular-nums">{f(cy)}</td>
                        <td className="px-3 py-0.5 text-right font-mono tabular-nums text-slate-500">{f(py)}</td>
                        <td className={`px-3 py-0.5 text-right font-mono tabular-nums ${v > 0 ? 'text-green-600' : v < 0 ? 'text-red-600' : 'text-slate-400'}`}>{f(v)}</td>
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
  );
}
