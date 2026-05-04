'use client';

import { Fragment, useState, useEffect, useCallback, useMemo } from 'react';
import { AlertTriangle, ArrowUpDown, ArrowUp, ArrowDown, Filter as FilterIcon, ChevronRight, ChevronDown as ChevronDownIcon } from 'lucide-react';

/**
 * Audit Test Summary Results — Completion view.
 *
 * Per the latest spec the columns (left → right) are:
 *   FS Line · FS Line Value · TB Dot · Test · Progress · Result ·
 *   Error Amount · Duration · Reviewer · RI
 *
 * Two header dots (Reviewer + RI) sit at the top of the panel and read
 * from the same `auditPermanentFile` signOffs source the tab label
 * reads from, so they stay sync'd with the tab dots automatically.
 *
 * Cascade rule: an RI sign-off implies the Reviewer slot is signed too.
 * Reviewer can sign their own dot but not the RI dot.
 *
 * Rows are grouped into three sections — Execution / Pending / Planning
 * — each with a count and a R/O/G dot summary in the header so the
 * outstanding work is visible at a glance.
 *
 * Columns are sortable (click the header) and filterable (open the
 * filter popover next to the header).
 */

interface TbCheck {
  tbTotal: number;
  listingTotal: number | null;
  percentage: number | null;
  reconciled: boolean;
}

interface TestExecution {
  id: string;
  testDescription: string;
  fsLine: string;
  fsLineId: string | null;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
  tbCheck: TbCheck | null;
}

interface TestConclusion {
  id: string;
  fsLine: string;
  testDescription: string;
  accountCode: string | null;
  conclusion: string | null;
  status: string;
  totalErrors: number;
  extrapolatedError: number;
  reviewedById: string | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
  riSignedById: string | null;
  riSignedByName: string | null;
  riSignedAt: string | null;
  executionId?: string | null;
}

interface Props {
  engagementId: string;
  userRole?: string;
  userId?: string;
}

type Dot = 'green' | 'orange' | 'red' | 'pending';
type Category = 'execution' | 'pending_audit_plan' | 'planning';

interface SummaryRow {
  key: string;
  testDescription: string;
  fsLine: string;
  fsLineValue: number | null;
  accountCode: string | null;
  // Per-TB-code currentYear pulled from auditTBRow keyed by
  // accountCode. Null when the test isn't tied to a single code
  // (multi-code tests / planning items / unmapped accountCode).
  tbCodeValue: number | null;
  // TB-row description for accountCode — shown alongside the code
  // in the TB Code column so the auditor doesn't have to memorise
  // every chart-of-accounts number.
  tbCodeDescription: string | null;
  tbCheck: TbCheck | null;
  progress: Dot;
  result: Dot;
  durationMs: number | null;
  totalErrors: number;
  extrapolatedError: number;
  status: string;
  conclusionId: string | null;
  executionId: string | null;
  reviewerSignedByName: string | null;
  riSignedByName: string | null;
  category: Category;
  // True when this row was synthesised from a TB code with no test
  // allocated to it (a coverage placeholder). Renders just the
  // code/description/value cells; all other columns blank.
  isPlaceholder?: boolean;
}

interface ExpectedTest {
  testName: string;
  testTypeCode: string;
  fsLine: string;
  fsLineId: string;
  accountCode: string | null;
  isIngest: boolean;
  outputFormat: string | null;
}

interface PlanningItem {
  key: string;
  label: string;
  progress: Dot;
}

interface TbRow {
  fsLineId: string | null;
  fsLine?: string | null;
  accountCode?: string | null;
  description?: string | null;
  currentYear: number | null;
  canonicalFsLine?: { name: string } | null;
}

const DOT_BG: Record<Dot, string> = {
  green: 'bg-green-500',
  orange: 'bg-orange-500',
  red: 'bg-red-500',
  pending: 'bg-slate-300',
};

const PROGRESS_TITLE: Record<Dot, string> = {
  green: 'Ran successfully',
  orange: 'In progress',
  red: 'Failed to run',
  pending: 'Not started',
};

const RESULT_TITLE: Record<Dot, string> = {
  green: 'No error or below Clearly Trivial',
  orange: 'Error between Clearly Trivial and Performance Materiality',
  red: 'Error above Performance Materiality',
  pending: 'Result pending',
};

const CATEGORY_LABEL: Record<Category, string> = {
  execution: 'Tests',
  pending_audit_plan: 'Pending',
  planning: 'Planning',
};

const CATEGORY_PILL: Record<Category, string> = {
  execution: 'bg-slate-100 text-slate-700 border-slate-200',
  pending_audit_plan: 'bg-amber-50 text-amber-700 border-amber-200',
  planning: 'bg-indigo-50 text-indigo-700 border-indigo-200',
};

function formatDuration(ms: number | null): string {
  if (ms == null || ms < 0) return '—';
  const totalMinutes = Math.round(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (totalMinutes === 0) {
    const seconds = Math.max(1, Math.round(ms / 1000));
    return `0:00:${String(seconds).padStart(2, '0')}`;
  }
  return `${hours}:${String(minutes).padStart(2, '0')}`;
}

function formatGbp(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return '—';
  const sign = n < 0 ? '-' : '';
  return `${sign}£${Math.abs(Math.round(n)).toLocaleString()}`;
}

function progressFromStatus(status: string): Dot {
  if (status === 'completed') return 'green';
  if (status === 'failed' || status === 'cancelled') return 'red';
  if (status === 'running' || status === 'paused') return 'orange';
  return 'pending';
}

function resultFromConclusion(
  conclusion: TestConclusion | null,
  execStatus: string,
  performanceMateriality: number,
  clearlyTrivial: number,
): Dot {
  if (conclusion?.conclusion === 'failed') return 'red';
  if (conclusion?.conclusion === 'red') return 'red';
  if (conclusion?.conclusion === 'orange') return 'orange';
  if (conclusion?.conclusion === 'green') return 'green';
  const err = Math.abs(Number(conclusion?.extrapolatedError) || 0);
  if (err > 0 && performanceMateriality > 0) {
    if (err > performanceMateriality) return 'red';
    if (err > clearlyTrivial) return 'orange';
    return 'green';
  }
  if (execStatus === 'completed') return 'green';
  return 'pending';
}

// ─── Sorting / filtering ───────────────────────────────────────────
type SortKey = 'fsLine' | 'tbCode' | 'value' | 'tbCheck' | 'testDescription' | 'progress' | 'result' | 'extrapolatedError' | 'durationMs' | 'reviewer' | 'ri';
type SortDir = 'asc' | 'desc';

interface ColumnFilters {
  fsLine: string;
  testDescription: string;
  // Dot-style columns: subset of dots to include (empty = all)
  progress: Set<Dot>;
  result: Set<Dot>;
  // TB Dot column: 'any' | 'has_check' | 'no_check' | 'red' | 'green'
  tbCheck: 'any' | 'has_check' | 'no_check' | 'red' | 'green';
  category: Set<Category>;
}

const EMPTY_FILTERS: ColumnFilters = {
  fsLine: '',
  testDescription: '',
  progress: new Set(),
  result: new Set(),
  tbCheck: 'any',
  category: new Set(),
};

function dotRank(d: Dot): number {
  if (d === 'red') return 0;
  if (d === 'orange') return 1;
  if (d === 'green') return 2;
  return 3;
}

function compareRow(a: SummaryRow, b: SummaryRow, key: SortKey, dir: SortDir): number {
  const sign = dir === 'asc' ? 1 : -1;
  switch (key) {
    case 'fsLine':           return sign * (a.fsLine || '').localeCompare(b.fsLine || '');
    case 'tbCode':           return sign * (a.accountCode || '').localeCompare(b.accountCode || '');
    case 'value':            return sign * ((a.tbCodeValue ?? -Infinity) - (b.tbCodeValue ?? -Infinity));
    case 'tbCheck': {
      const aP = a.tbCheck?.percentage ?? -1;
      const bP = b.tbCheck?.percentage ?? -1;
      return sign * (aP - bP);
    }
    case 'testDescription':  return sign * (a.testDescription || '').localeCompare(b.testDescription || '');
    case 'progress':         return sign * (dotRank(a.progress) - dotRank(b.progress));
    case 'result':           return sign * (dotRank(a.result) - dotRank(b.result));
    case 'extrapolatedError':return sign * ((a.extrapolatedError || 0) - (b.extrapolatedError || 0));
    case 'durationMs':       return sign * ((a.durationMs ?? -1) - (b.durationMs ?? -1));
    case 'reviewer':         return sign * ((a.reviewerSignedByName || a.riSignedByName ? 1 : 0) - (b.reviewerSignedByName || b.riSignedByName ? 1 : 0));
    case 'ri':               return sign * ((a.riSignedByName ? 1 : 0) - (b.riSignedByName ? 1 : 0));
  }
}

// ─── Component ──────────────────────────────────────────────────────

export function AuditTestSummaryPanel({ engagementId, userRole }: Props) {
  const [executions, setExecutions] = useState<TestExecution[]>([]);
  const [conclusions, setConclusions] = useState<TestConclusion[]>([]);
  const [expectedTests, setExpectedTests] = useState<ExpectedTest[]>([]);
  const [planningItems, setPlanningItems] = useState<PlanningItem[]>([]);
  const [tbRows, setTbRows] = useState<TbRow[]>([]);
  const [performanceMateriality, setPerformanceMateriality] = useState(0);
  const [clearlyTrivial, setClearlyTrivial] = useState(0);
  const [loading, setLoading] = useState(true);

  const [sortKey, setSortKey] = useState<SortKey>('fsLine');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [filters, setFilters] = useState<ColumnFilters>(EMPTY_FILTERS);
  const [openFilter, setOpenFilter] = useState<keyof ColumnFilters | null>(null);
  // FS-Line groups default to collapsed so the panel reads as a
  // tidy "one row per FS line" summary at first glance. Click the
  // chevron on a group header to drill into the per-TB-code rows;
  // the Expand-All / Collapse-All button at the panel top toggles
  // every group at once.
  const [expandedFsLines, setExpandedFsLines] = useState<Set<string>>(new Set());
  // Toggle for showing FS Lines / TB codes that have no test
  // allocated (the slate-tinted "No test allocated" rows + the
  // fully-untested FS-line groups like Cash and Cash Equivalents
  // when no tests have been added yet). Default ON so coverage
  // gaps are visible at first glance; toggle OFF to focus on
  // tested rows only.
  const [showUntested, setShowUntested] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [execRes, concRes, matRes, expectedRes, ppRes, tbRes] = await Promise.all([
        fetch(`/api/engagements/${engagementId}/test-execution?lite=true`),
        fetch(`/api/engagements/${engagementId}/test-conclusions`),
        fetch(`/api/engagements/${engagementId}/materiality`),
        fetch(`/api/engagements/${engagementId}/audit-plan/expected-tests`),
        fetch(`/api/engagements/${engagementId}/prior-period`),
        fetch(`/api/engagements/${engagementId}/trial-balance`),
      ]);
      if (execRes.ok) {
        const data = await execRes.json();
        setExecutions(Array.isArray(data?.executions) ? data.executions : []);
      }
      if (concRes.ok) {
        const data = await concRes.json();
        setConclusions(Array.isArray(data?.conclusions) ? data.conclusions : []);
      }
      if (matRes.ok) {
        const data = await matRes.json();
        const m = data?.data || {};
        setPerformanceMateriality(Number(m?.materiality?.performanceMateriality ?? m?.performanceMateriality ?? 0) || 0);
        setClearlyTrivial(Number(m?.materiality?.clearlyTrivial ?? m?.clearlyTrivial ?? 0) || 0);
      }
      if (expectedRes.ok) {
        const data = await expectedRes.json();
        setExpectedTests(Array.isArray(data?.tests) ? data.tests : []);
      }
      if (tbRes.ok) {
        const data = await tbRes.json();
        setTbRows(Array.isArray(data?.rows) ? data.rows : []);
      }
      if (ppRes.ok) {
        const data = await ppRes.json();
        const docStatus: Array<{ key: string; label: string; documentId?: string }> = Array.isArray(data?.docStatus) ? data.docStatus : [];
        const points: Record<string, Array<{ signOffs?: { operator?: any; reviewer?: any; partner?: any } }>> = data?.points || {};
        const REVIEWABLE = new Set(['pp_letter_of_comment', 'pp_letter_of_representation', 'pp_financial_statements']);
        const items: PlanningItem[] = docStatus.map(d => {
          if (!d.documentId) return { key: d.key, label: d.label, progress: 'pending' as Dot };
          if (!REVIEWABLE.has(d.key)) return { key: d.key, label: d.label, progress: 'green' as Dot };
          const pts = points[d.key];
          if (!Array.isArray(pts) || pts.length === 0) return { key: d.key, label: d.label, progress: 'orange' as Dot };
          const allSigned = pts.every(p => p.signOffs?.operator && p.signOffs?.reviewer && p.signOffs?.partner);
          return { key: d.key, label: d.label, progress: allSigned ? ('green' as Dot) : ('orange' as Dot) };
        });
        const obRows = Array.isArray(data?.openingBalances) ? data.openingBalances : [];
        items.push({
          key: 'pp_opening_balances',
          label: 'Agree prior year TB to accounts (opening balances)',
          progress: obRows.length > 0 ? 'green' : 'pending',
        });
        setPlanningItems(items);
      }
    } finally { setLoading(false); }
  }, [engagementId]);

  useEffect(() => { void load(); }, [load]);

  // FS-line value lookup keyed by FS line name (case-insensitive). Each
  // value sums the |currentYear| of every TB row that maps to that FS
  // line. Falls back to fsLineId when name lookups can't resolve.
  const fsLineValueByName = useMemo<Map<string, number>>(() => {
    const m = new Map<string, number>();
    for (const r of tbRows) {
      const name = (r.canonicalFsLine?.name || r.fsLine || '').trim().toLowerCase();
      if (!name) continue;
      const cur = Number(r.currentYear || 0);
      m.set(name, (m.get(name) || 0) + cur);
    }
    return m;
  }, [tbRows]);

  // Per-TB-code currentYear lookup. Used to populate the per-row
  // Value column under each FS-line group. Account codes are
  // normalised (trim + lowercase) so casing differences between
  // conclusions and TB rows don't cause false misses.
  const tbValueByCode = useMemo<Map<string, number>>(() => {
    const m = new Map<string, number>();
    for (const r of tbRows) {
      const code = (r.accountCode || '').toString().trim().toLowerCase();
      if (!code) continue;
      m.set(code, Number(r.currentYear || 0));
    }
    return m;
  }, [tbRows]);

  // TB-row description lookup — same key shape as tbValueByCode.
  // The TB Code column renders "<code> <description>" using this.
  const tbDescriptionByCode = useMemo<Map<string, string>>(() => {
    const m = new Map<string, string>();
    for (const r of tbRows) {
      const code = (r.accountCode || '').toString().trim().toLowerCase();
      if (!code) continue;
      m.set(code, (r.description || '').toString());
    }
    return m;
  }, [tbRows]);

  // Every TB code mapped to each FS line, keyed by FS line name
  // (lowercased). Used to render coverage-placeholder rows for TB
  // codes that don't have a test, AND to surface FS Lines that
  // exist in the TB but have zero tests anywhere (e.g. Cash and
  // Cash Equivalents at the start of an engagement).
  interface TbCodeUnderFsLine {
    code: string;
    description: string | null;
    currentYear: number;
    fsLineDisplay: string; // original-cased FS line name from the TB
  }
  const tbCodesByFsLine = useMemo<Map<string, TbCodeUnderFsLine[]>>(() => {
    const m = new Map<string, TbCodeUnderFsLine[]>();
    for (const r of tbRows) {
      const display = (r.canonicalFsLine?.name || r.fsLine || '').toString();
      const key = display.trim().toLowerCase();
      if (!key) continue;
      const code = (r.accountCode || '').toString();
      if (!code) continue;
      const list = m.get(key) || [];
      list.push({
        code,
        description: r.description || null,
        currentYear: Number(r.currentYear || 0),
        fsLineDisplay: display,
      });
      m.set(key, list);
    }
    // Stable order within each FS line by accountCode.
    for (const list of m.values()) list.sort((a, b) => a.code.localeCompare(b.code));
    return m;
  }, [tbRows]);

  function lookupFsLineValue(fsLine: string): number | null {
    const v = fsLineValueByName.get((fsLine || '').trim().toLowerCase());
    return v === undefined ? null : v;
  }

  function lookupTbCodeValue(accountCode: string | null): number | null {
    if (!accountCode) return null;
    const v = tbValueByCode.get(accountCode.toString().trim().toLowerCase());
    return v === undefined ? null : v;
  }

  function lookupTbCodeDescription(accountCode: string | null): string | null {
    if (!accountCode) return null;
    const v = tbDescriptionByCode.get(accountCode.toString().trim().toLowerCase());
    return v === undefined || v === '' ? null : v;
  }

  // Build the per-test row list. Same join logic as before but with
  // the additional FS-line value + TB check + Reviewer name fields.
  const rows = useMemo<SummaryRow[]>(() => {
    const out: SummaryRow[] = [];
    for (const e of executions) {
      const conc = conclusions.find(c => c.executionId === e.id)
        ?? conclusions.find(c => c.testDescription === e.testDescription && c.fsLine === e.fsLine)
        ?? null;
      const startedAt = e.startedAt ? new Date(e.startedAt).getTime() : null;
      const completedAt = e.completedAt ? new Date(e.completedAt).getTime() : null;
      const durationMs = startedAt != null && completedAt != null ? completedAt - startedAt : null;
      const ac = conc?.accountCode || null;
      out.push({
        key: e.id,
        testDescription: e.testDescription,
        fsLine: e.fsLine,
        fsLineValue: lookupFsLineValue(e.fsLine),
        accountCode: ac,
        tbCodeValue: lookupTbCodeValue(ac),
        tbCodeDescription: lookupTbCodeDescription(ac),
        tbCheck: e.tbCheck || null,
        progress: progressFromStatus(e.status),
        result: resultFromConclusion(conc, e.status, performanceMateriality, clearlyTrivial),
        durationMs,
        totalErrors: conc?.totalErrors || 0,
        extrapolatedError: Number(conc?.extrapolatedError) || 0,
        status: conc?.status || e.status,
        conclusionId: conc?.id || null,
        executionId: e.id,
        reviewerSignedByName: conc?.reviewedByName || null,
        riSignedByName: conc?.riSignedByName || null,
        category: 'execution',
      });
    }
    for (const c of conclusions) {
      const alreadyShown = out.some(r => r.conclusionId === c.id || (r.testDescription === c.testDescription && r.fsLine === c.fsLine));
      if (alreadyShown) continue;
      out.push({
        key: c.id,
        testDescription: c.testDescription,
        fsLine: c.fsLine,
        fsLineValue: lookupFsLineValue(c.fsLine),
        accountCode: c.accountCode,
        tbCodeValue: lookupTbCodeValue(c.accountCode),
        tbCodeDescription: lookupTbCodeDescription(c.accountCode),
        tbCheck: null,
        progress: c.status === 'pending' ? 'pending' : 'green',
        result: resultFromConclusion(c, 'completed', performanceMateriality, clearlyTrivial),
        durationMs: null,
        totalErrors: c.totalErrors || 0,
        extrapolatedError: Number(c.extrapolatedError) || 0,
        status: c.status,
        conclusionId: c.id,
        executionId: null,
        reviewerSignedByName: c.reviewedByName,
        riSignedByName: c.riSignedByName,
        category: 'execution',
      });
    }
    for (const et of expectedTests) {
      if (et.isIngest) continue;
      const alreadyShown = out.some(r => r.testDescription.toLowerCase() === et.testName.toLowerCase() && (r.fsLine || '').toLowerCase() === et.fsLine.toLowerCase());
      if (alreadyShown) continue;
      out.push({
        key: `expected:${et.fsLineId}:${et.testName}`,
        testDescription: et.testName,
        fsLine: et.fsLine,
        fsLineValue: lookupFsLineValue(et.fsLine),
        accountCode: et.accountCode,
        tbCodeValue: lookupTbCodeValue(et.accountCode),
        tbCodeDescription: lookupTbCodeDescription(et.accountCode),
        tbCheck: null,
        progress: 'pending',
        result: 'pending',
        durationMs: null,
        totalErrors: 0,
        extrapolatedError: 0,
        status: 'pending',
        conclusionId: null,
        executionId: null,
        reviewerSignedByName: null,
        riSignedByName: null,
        category: 'pending_audit_plan',
      });
    }
    for (const p of planningItems) {
      out.push({
        key: `planning:${p.key}`,
        testDescription: p.label,
        fsLine: 'Planning',
        fsLineValue: null,
        accountCode: null,
        tbCodeValue: null,
        tbCodeDescription: null,
        tbCheck: null,
        progress: p.progress,
        result: p.progress === 'green' ? 'green' : 'pending',
        durationMs: null,
        totalErrors: 0,
        extrapolatedError: 0,
        status: p.progress === 'green' ? 'complete' : 'pending',
        conclusionId: null,
        executionId: null,
        reviewerSignedByName: null,
        riSignedByName: null,
        category: 'planning',
      });
    }
    return out;
  }, [executions, conclusions, expectedTests, planningItems, performanceMateriality, clearlyTrivial, fsLineValueByName, tbValueByCode]);

  // Filter + sort applied over the whole row list. Grouping by category
  // happens in the render below.
  const filteredSorted = useMemo<SummaryRow[]>(() => {
    const fsFilter = filters.fsLine.trim().toLowerCase();
    const tdFilter = filters.testDescription.trim().toLowerCase();
    const filtered = rows.filter(r => {
      if (filters.category.size > 0 && !filters.category.has(r.category)) return false;
      if (fsFilter && !(r.fsLine || '').toLowerCase().includes(fsFilter)) return false;
      if (tdFilter && !(r.testDescription || '').toLowerCase().includes(tdFilter)) return false;
      if (filters.progress.size > 0 && !filters.progress.has(r.progress)) return false;
      if (filters.result.size > 0 && !filters.result.has(r.result)) return false;
      if (filters.tbCheck === 'has_check' && !r.tbCheck) return false;
      if (filters.tbCheck === 'no_check' && r.tbCheck) return false;
      if (filters.tbCheck === 'red' && !(r.tbCheck && !r.tbCheck.reconciled)) return false;
      if (filters.tbCheck === 'green' && !(r.tbCheck && r.tbCheck.reconciled)) return false;
      return true;
    });
    return [...filtered].sort((a, b) => {
      const r = compareRow(a, b, sortKey, sortDir);
      if (r !== 0) return r;
      // Stable secondary sort by FS Line then test description.
      const f = (a.fsLine || '').localeCompare(b.fsLine || '');
      if (f !== 0) return f;
      return (a.testDescription || '').localeCompare(b.testDescription || '');
    });
  }, [rows, filters, sortKey, sortDir]);

  // Worst-state aggregator: red beats orange beats green beats pending.
  // Used to roll up row-level dots into a section/tab aggregate.
  function aggregateDot(dots: Dot[]): Dot {
    if (dots.length === 0) return 'pending';
    if (dots.some(d => d === 'red')) return 'red';
    if (dots.some(d => d === 'orange')) return 'orange';
    if (dots.every(d => d === 'green')) return 'green';
    return 'pending';
  }

  // Per-category Progress + Result counts used in section headers.
  // Each category exposes two independent count buckets (one per
  // dot type) so the header can show, separately:
  //   Progress: 🔴N 🟠N 🟢N ⚪N
  //   Result  : 🔴N 🟠N 🟢N ⚪N
  // The single worst-state aggregates (`progress`/`result`) are
  // retained for any caller that wants the at-a-glance dot.
  type DotCounts = { red: number; orange: number; green: number; pending: number };
  const categorySummary = useMemo(() => {
    const init = (): { count: number; progress: Dot; result: Dot; progressCounts: DotCounts; resultCounts: DotCounts } => ({
      count: 0, progress: 'pending', result: 'pending',
      progressCounts: { red: 0, orange: 0, green: 0, pending: 0 },
      resultCounts: { red: 0, orange: 0, green: 0, pending: 0 },
    });
    const summary: Record<Category, ReturnType<typeof init>> = {
      execution: init(), pending_audit_plan: init(), planning: init(),
    };
    const progressByCat: Record<Category, Dot[]> = { execution: [], pending_audit_plan: [], planning: [] };
    const resultByCat: Record<Category, Dot[]> = { execution: [], pending_audit_plan: [], planning: [] };
    for (const r of filteredSorted) {
      const s = summary[r.category];
      s.count++;
      progressByCat[r.category].push(r.progress);
      resultByCat[r.category].push(r.result);
      s.progressCounts[r.progress]++;
      s.resultCounts[r.result]++;
    }
    for (const cat of ['execution', 'pending_audit_plan', 'planning'] as Category[]) {
      summary[cat].progress = aggregateDot(progressByCat[cat]);
      summary[cat].result = aggregateDot(resultByCat[cat]);
    }
    return summary;
  }, [filteredSorted]);

  // Tab-level aggregate — Progress + Result rolled across every row in
  // the panel. Drives the panel-header dots and the sub-tab pill dots
  // in CompletionPanel (via the engagement:test-summary-aggregates
  // window event below).
  const overallAggregate = useMemo<{ progress: Dot; result: Dot }>(() => ({
    progress: aggregateDot(rows.map(r => r.progress)),
    result: aggregateDot(rows.map(r => r.result)),
  }), [rows]);

  // Broadcast the overall aggregate so CompletionPanel can sync the
  // sub-tab pill dots without re-fetching the same data. Fires on
  // every aggregate change, including the initial load.
  useEffect(() => {
    if (loading) return;
    try {
      window.dispatchEvent(new CustomEvent('engagement:test-summary-aggregates', {
        detail: { engagementId, progress: overallAggregate.progress, result: overallAggregate.result },
      }));
    } catch {}
  }, [overallAggregate, loading, engagementId]);

  // ─── FS-Line grouping ──────────────────────────────────────────────
  // Within each Category section, rows are grouped by FS Line. Each
  // group exposes a chevron-toggleable header that summarises the
  // group (Value rolled up from the FS Line's TB total, worst-state
  // dot aggregates, sum extrapolatedError, count of tests). Children
  // render only when the group is expanded.
  interface FsLineGroup {
    key: string; // unique within the panel: `${category}::${fsLine}`
    fsLine: string;
    fsLineValue: number | null;
    rows: SummaryRow[];
    progress: Dot;
    result: Dot;
    tbCheckDot: Dot | null;
    extrapolatedErrorTotal: number;
    distinctCodeCount: number;
  }
  const groupsByCategory = useMemo<Record<Category, FsLineGroup[]>>(() => {
    const init: Record<Category, FsLineGroup[]> = { execution: [], pending_audit_plan: [], planning: [] };
    const buckets: Record<Category, Map<string, SummaryRow[]>> = {
      execution: new Map(), pending_audit_plan: new Map(), planning: new Map(),
    };
    // Preserve the post-sort order: walk filteredSorted in order and
    // append rows to their FS-line bucket. Bucket insertion order
    // determines the on-screen order of FS-line groups.
    for (const r of filteredSorted) {
      const fsLine = r.fsLine || '(unassigned)';
      const map = buckets[r.category];
      if (!map.has(fsLine)) map.set(fsLine, []);
      map.get(fsLine)!.push(r);
    }

    // Track which FS lines (lowercased) appear in ANY category as a
    // tested FS line. Anything in tbCodesByFsLine that's missing
    // here is a coverage gap — surfaced as an empty group in the
    // 'execution' section so the auditor can see the FS line they
    // haven't tested at all (e.g. Cash and Cash Equivalents).
    const testedFsLines = new Set<string>();
    for (const cat of ['execution', 'pending_audit_plan', 'planning'] as Category[]) {
      for (const fsLine of buckets[cat].keys()) testedFsLines.add(fsLine.trim().toLowerCase());
    }

    for (const cat of ['execution', 'pending_audit_plan', 'planning'] as Category[]) {
      for (const [fsLine, groupRows] of buckets[cat]) {
        const tbDots: Dot[] = [];
        for (const r of groupRows) {
          if (!r.tbCheck) continue;
          tbDots.push(r.tbCheck.reconciled || r.tbCheck.percentage === 100 ? 'green' : 'red');
        }
        // Append placeholder rows for TB codes under this FS line
        // that don't have a test row in this section. Lets the
        // operator see the codes that haven't been tested when
        // they expand the group. Codes already covered by a test
        // row in this section are skipped to avoid duplication.
        const codesInTests = new Set(
          groupRows.map(r => (r.accountCode || '').toString().trim().toLowerCase()).filter(Boolean),
        );
        const tbCodes = tbCodesByFsLine.get(fsLine.trim().toLowerCase()) || [];
        const placeholders: SummaryRow[] = (cat === 'execution')
          ? tbCodes
              .filter(c => !codesInTests.has(c.code.trim().toLowerCase()))
              .map(c => ({
                key: `placeholder:${cat}:${fsLine}:${c.code}`,
                testDescription: '',
                fsLine,
                fsLineValue: lookupFsLineValue(fsLine),
                accountCode: c.code,
                tbCodeValue: c.currentYear,
                tbCodeDescription: c.description,
                tbCheck: null,
                progress: 'pending',
                result: 'pending',
                durationMs: null,
                totalErrors: 0,
                extrapolatedError: 0,
                status: 'untested',
                conclusionId: null,
                executionId: null,
                reviewerSignedByName: null,
                riSignedByName: null,
                category: 'execution',
                isPlaceholder: true,
              }))
          : [];
        // Hide placeholder rows when the toggle is off — but keep
        // the group itself since it has tests.
        const allRows = showUntested ? [...groupRows, ...placeholders] : groupRows;
        init[cat].push({
          key: `${cat}::${fsLine}`,
          fsLine,
          fsLineValue: groupRows[0]?.fsLineValue ?? lookupFsLineValue(fsLine),
          rows: allRows,
          progress: aggregateDot(groupRows.map(r => r.progress)),
          result: aggregateDot(groupRows.map(r => r.result)),
          tbCheckDot: tbDots.length === 0 ? null : aggregateDot(tbDots),
          extrapolatedErrorTotal: groupRows.reduce((acc, r) => acc + (r.extrapolatedError || 0), 0),
          // Distinct-code count uses the TB-side population (not
          // just the codes the tests cover) so the header pill
          // matches the count of rows the operator sees on
          // expansion. When the untested toggle is off, narrow it
          // to the codes actually covered by a test.
          distinctCodeCount: showUntested
            ? (tbCodes.length || new Set(groupRows.map(r => r.accountCode).filter(Boolean)).size)
            : new Set(groupRows.map(r => r.accountCode).filter(Boolean)).size,
        });
      }
    }

    // Coverage-gap groups: every FS line in the TB that doesn't
    // appear in any tested-bucket above. Lands in the 'execution'
    // section so it's visible in the main work area without
    // creating a new section just for empty groups. Skipped
    // entirely when the untested toggle is off.
    if (showUntested) {
      for (const [key, codes] of tbCodesByFsLine) {
        if (testedFsLines.has(key)) continue;
        const fsLine = codes[0]?.fsLineDisplay || key;
        const placeholders: SummaryRow[] = codes.map(c => ({
          key: `placeholder:execution:${fsLine}:${c.code}`,
          testDescription: '',
          fsLine,
          fsLineValue: lookupFsLineValue(fsLine),
          accountCode: c.code,
          tbCodeValue: c.currentYear,
          tbCodeDescription: c.description,
          tbCheck: null,
          progress: 'pending',
          result: 'pending',
          durationMs: null,
          totalErrors: 0,
          extrapolatedError: 0,
          status: 'untested',
          conclusionId: null,
          executionId: null,
          reviewerSignedByName: null,
          riSignedByName: null,
          category: 'execution',
          isPlaceholder: true,
        }));
        init.execution.push({
          key: `execution::${fsLine}`,
          fsLine,
          fsLineValue: lookupFsLineValue(fsLine),
          rows: placeholders,
          progress: 'pending',
          result: 'pending',
          tbCheckDot: null,
          extrapolatedErrorTotal: 0,
          distinctCodeCount: codes.length,
        });
      }
    }

    return init;
  }, [filteredSorted, tbCodesByFsLine, fsLineValueByName, showUntested]);

  // Stable list of every FS-Line group key currently in view — used by
  // the Expand-All / Collapse-All button and by the chevron click
  // handlers below.
  const allGroupKeys = useMemo<string[]>(() => {
    const keys: string[] = [];
    for (const cat of ['execution', 'pending_audit_plan', 'planning'] as Category[]) {
      for (const g of groupsByCategory[cat]) keys.push(g.key);
    }
    return keys;
  }, [groupsByCategory]);

  function toggleGroup(key: string) {
    setExpandedFsLines(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }
  function expandAll() { setExpandedFsLines(new Set(allGroupKeys)); }
  function collapseAll() { setExpandedFsLines(new Set()); }
  const allExpanded = allGroupKeys.length > 0 && allGroupKeys.every(k => expandedFsLines.has(k));

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  function toggleDotFilter(field: 'progress' | 'result', value: Dot) {
    setFilters(f => {
      const next = new Set(f[field]);
      if (next.has(value)) next.delete(value); else next.add(value);
      return { ...f, [field]: next };
    });
  }

  async function handleSignOff(row: SummaryRow, role: 'reviewer' | 'ri', isUnsign: boolean) {
    if (!row.conclusionId) return;
    // The conclusions PATCH endpoint uses the legacy verb pair
    // `review`/`unreview` for the Reviewer slot and
    // `ri_signoff`/`ri_unsignoff` for the RI slot.
    const action = role === 'ri'
      ? (isUnsign ? 'ri_unsignoff' : 'ri_signoff')
      : (isUnsign ? 'unreview' : 'review');
    try {
      const res = await fetch(`/api/engagements/${engagementId}/test-conclusions`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: row.conclusionId, action }),
      });
      if (res.ok) await load();
    } catch {}
  }

  if (loading) return <div className="p-6 text-center text-xs text-slate-400 animate-pulse">Loading test summary…</div>;
  if (rows.length === 0) return <div className="p-6 text-center text-xs text-slate-400">No tests recorded yet.</div>;

  const haveThresholds = performanceMateriality > 0;

  function renderTbDot(tb: TbCheck | null) {
    if (!tb) return <span className="text-slate-300 text-[9px]">—</span>;
    const pct = tb.percentage;
    const colour: Dot = tb.reconciled || pct === 100 ? 'green' : 'red';
    const hover = pct !== null ? `${pct}% — listing ${formatGbp(tb.listingTotal)} / TB ${formatGbp(tb.tbTotal)}` : 'No client response yet';
    return <div className={`w-3 h-3 rounded-full mx-auto ${DOT_BG[colour]}`} title={hover} />;
  }

  function renderSignOffButton(row: SummaryRow, role: 'reviewer' | 'ri') {
    if (!row.conclusionId) return <span className="text-[9px] text-slate-300">—</span>;
    const signedName = role === 'ri' ? row.riSignedByName : (row.reviewerSignedByName || row.riSignedByName);
    const viaCascade = role === 'reviewer' && !row.reviewerSignedByName && !!row.riSignedByName;
    // Authorisation: RI can sign either column. Reviewer can sign only
    // the Reviewer column (not the RI column).
    const canSign = role === 'ri' ? userRole === 'RI' : (userRole === 'RI' || userRole === 'Reviewer');
    if (!canSign) {
      return signedName
        ? <span className="text-[9px] text-blue-600" title={`Signed by ${signedName}${viaCascade ? ' (via RI)' : ''}`}>✓</span>
        : <span className="text-[9px] text-slate-300">—</span>;
    }
    return (
      <button
        onClick={() => handleSignOff(row, role, !!signedName && !viaCascade)}
        disabled={viaCascade}
        className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${
          signedName ? 'bg-blue-100 text-blue-700 hover:bg-blue-200' : 'bg-slate-100 text-slate-400 hover:bg-slate-200'
        } ${viaCascade ? 'opacity-60 cursor-not-allowed' : ''}`}
        title={signedName ? `Signed by ${signedName}${viaCascade ? ' (via RI — clear by unsigning the RI dot)' : ' — click to unsign'}` : `Sign as ${role === 'ri' ? 'RI' : 'Reviewer'}`}
      >
        {signedName ? '✓' : 'Sign'}
      </button>
    );
  }

  return (
    <div className="space-y-3">
      {/* ─── Header: title + 2 aggregate dots + materiality context ─
          The two header dots are Progress + Result rolled across
          every row in the panel (worst-state-wins). Sub-tab pill
          dots in CompletionPanel sync with the same aggregate via
          the engagement:test-summary-aggregates window event. */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-bold text-slate-700">Audit Test Summary Results</h3>
          <div className="flex items-center gap-3 text-[10px]">
            <span className="inline-flex items-center gap-1" title={`Progress (overall) — ${PROGRESS_TITLE[overallAggregate.progress]}`}>
              <span className={`w-2.5 h-2.5 rounded-full ${DOT_BG[overallAggregate.progress]}`} />
              <span className="text-slate-500">Progress</span>
            </span>
            <span className="inline-flex items-center gap-1" title={`Result (overall) — ${RESULT_TITLE[overallAggregate.result]}`}>
              <span className={`w-2.5 h-2.5 rounded-full ${DOT_BG[overallAggregate.result]}`} />
              <span className="text-slate-500">Result</span>
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3 text-[10px] text-slate-400">
          {/* Untested toggle — checkbox so the on/off state is
              obvious at a glance and matches the rest of the
              panel's filter idioms. Hides FS-line groups with
              zero tests AND placeholder rows under tested
              groups. */}
          <label className="inline-flex items-center gap-1 text-slate-600 cursor-pointer select-none" title="Show FS Lines and TB codes that don't have a test allocated">
            <input
              type="checkbox"
              checked={showUntested}
              onChange={e => setShowUntested(e.target.checked)}
              className="w-3 h-3 cursor-pointer"
            />
            <span>Show untested</span>
          </label>
          <button
            onClick={() => allExpanded ? collapseAll() : expandAll()}
            className="text-[10px] text-slate-500 hover:text-slate-700 underline"
            title={allExpanded ? 'Collapse every FS-line group' : 'Expand every FS-line group'}
          >
            {allExpanded ? 'Collapse all' : 'Expand all'}
          </button>
          <span>
            {filteredSorted.length} of {rows.length} test{rows.length !== 1 ? 's' : ''}
            {haveThresholds && (
              <> · CT {clearlyTrivial.toLocaleString()} · PM {performanceMateriality.toLocaleString()}</>
            )}
          </span>
        </div>
      </div>

      {/* ─── Table with sortable / filterable headers ────────────── */}
      <div className="border rounded-lg overflow-hidden bg-white">
        <table className="w-full text-[11px]">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
            <tr>
              <SortableHeader label="FS Line" col="fsLine" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} onFilterToggle={() => setOpenFilter(o => o === 'fsLine' ? null : 'fsLine')} hasFilter={!!filters.fsLine} className="w-40 text-left" />
              <SortableHeader label="TB Code" col="tbCode" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="w-20 text-left" />
              <SortableHeader label="Value" col="value" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="w-24 text-right" />
              <SortableHeader label="TB" col="tbCheck" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} onFilterToggle={() => setOpenFilter(o => o === 'tbCheck' ? null : 'tbCheck')} hasFilter={filters.tbCheck !== 'any'} className="w-12 text-center" />
              <SortableHeader label="Test" col="testDescription" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} onFilterToggle={() => setOpenFilter(o => o === 'testDescription' ? null : 'testDescription')} hasFilter={!!filters.testDescription} className="text-left" />
              <SortableHeader label="Progress" col="progress" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} onFilterToggle={() => setOpenFilter(o => o === 'progress' ? null : 'progress')} hasFilter={filters.progress.size > 0} className="w-20 text-center" />
              <SortableHeader label="Result" col="result" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} onFilterToggle={() => setOpenFilter(o => o === 'result' ? null : 'result')} hasFilter={filters.result.size > 0} className="w-20 text-center" />
              <SortableHeader label="Error £" col="extrapolatedError" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="w-24 text-right" />
              <SortableHeader label="Duration" col="durationMs" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="w-20 text-right" />
              <SortableHeader label="Reviewer" col="reviewer" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="w-16 text-center" />
              <SortableHeader label="RI" col="ri" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="w-12 text-center" />
            </tr>
            {openFilter && (
              <tr>
                <td colSpan={11} className="px-3 py-2 bg-slate-50 border-t border-slate-200">
                  <FilterRow filter={openFilter} filters={filters} setFilters={setFilters} toggleDotFilter={toggleDotFilter} onClose={() => setOpenFilter(null)} />
                </td>
              </tr>
            )}
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(['execution', 'pending_audit_plan', 'planning'] as Category[]).map(cat => {
              const groups = groupsByCategory[cat];
              if (groups.length === 0) return null;
              const s = categorySummary[cat];
              return (
                <Fragment key={`section:${cat}`}>
                  {/* Section header */}
                  <tr className="bg-slate-100/70">
                    <td colSpan={11} className="px-3 py-1.5">
                      <div className="flex items-center gap-4 flex-wrap">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase tracking-wide border ${CATEGORY_PILL[cat]}`}>
                          {CATEGORY_LABEL[cat]}
                        </span>

                        {/* Progress group — per-state counted pills
                            in the site-standard "coloured pill +
                            number inside" style (matches the count
                            badges on Review Point / RI Matters /
                            Outstanding etc.). All four states are
                            shown even when 0 so the layout stays
                            stable across sections. */}
                        <div className="inline-flex items-center gap-1 text-[10px] text-slate-600">
                          <span className="font-medium text-slate-500">Progress:</span>
                          <CountPill colour="red" count={s.progressCounts.red} title={`${s.progressCounts.red} test${s.progressCounts.red === 1 ? '' : 's'} failed to run`} />
                          <CountPill colour="orange" count={s.progressCounts.orange} title={`${s.progressCounts.orange} test${s.progressCounts.orange === 1 ? '' : 's'} in progress`} />
                          <CountPill colour="green" count={s.progressCounts.green} title={`${s.progressCounts.green} test${s.progressCounts.green === 1 ? '' : 's'} ran successfully`} />
                          <CountPill colour="pending" count={s.progressCounts.pending} title={`${s.progressCounts.pending} test${s.progressCounts.pending === 1 ? '' : 's'} not yet started`} />
                        </div>

                        {/* Result group — same pill style; error-
                            size buckets. */}
                        <div className="inline-flex items-center gap-1 text-[10px] text-slate-600">
                          <span className="font-medium text-slate-500">Result:</span>
                          <CountPill colour="red" count={s.resultCounts.red} title={`${s.resultCounts.red} test${s.resultCounts.red === 1 ? '' : 's'} with error above Performance Materiality`} />
                          <CountPill colour="orange" count={s.resultCounts.orange} title={`${s.resultCounts.orange} test${s.resultCounts.orange === 1 ? '' : 's'} with error between Clearly Trivial and Performance Materiality`} />
                          <CountPill colour="green" count={s.resultCounts.green} title={`${s.resultCounts.green} test${s.resultCounts.green === 1 ? '' : 's'} with no error or below Clearly Trivial`} />
                          <CountPill colour="pending" count={s.resultCounts.pending} title={`${s.resultCounts.pending} test${s.resultCounts.pending === 1 ? '' : 's'} with no result yet`} />
                        </div>

                        <span className="text-[10px] font-medium text-slate-700">{s.count} item{s.count !== 1 ? 's' : ''}</span>
                      </div>
                    </td>
                  </tr>

                  {/* FS-Line groups within the section */}
                  {groups.map(group => {
                    const isExpanded = expandedFsLines.has(group.key);
                    const Chev = isExpanded ? ChevronDownIcon : ChevronRight;
                    const tbDot = group.tbCheckDot;
                    return (
                      <Fragment key={group.key}>
                        {/* Group header — clickable chevron toggles
                            child rows. Aggregates roll up across the
                            group (Value = FS Line TB total; dots =
                            worst-state aggregate; Error £ = sum). */}
                        <tr
                          className={`bg-white hover:bg-slate-50 cursor-pointer ${group.progress === 'red' || group.result === 'red' ? 'bg-red-50/30' : ''}`}
                          onClick={() => toggleGroup(group.key)}
                        >
                          <td className="px-2 py-1.5 text-slate-700 font-medium">
                            <div className="flex items-center gap-1">
                              <Chev className="h-3 w-3 text-slate-400 flex-shrink-0" />
                              <span className="truncate">{group.fsLine}</span>
                            </div>
                          </td>
                          <td className="px-2 py-1.5 text-left text-[9px] text-slate-400">
                            {group.distinctCodeCount > 0
                              ? `${group.distinctCodeCount} code${group.distinctCodeCount === 1 ? '' : 's'}`
                              : ''}
                          </td>
                          <td className="px-2 py-1.5 text-right text-slate-700 tabular-nums font-medium">
                            {formatGbp(group.fsLineValue)}
                          </td>
                          <td className="px-2 py-1.5 text-center">
                            {tbDot
                              ? <div className={`w-3 h-3 rounded-full mx-auto ${DOT_BG[tbDot]}`} title={`TB check (group) — ${tbDot === 'green' ? 'all reconciled' : tbDot === 'red' ? 'one or more variances' : 'pending'}`} />
                              : <span className="text-slate-300 text-[9px]">—</span>}
                          </td>
                          <td className="px-3 py-1.5 text-[10px] text-slate-500 italic">
                            {group.rows.length} test{group.rows.length === 1 ? '' : 's'} {isExpanded ? '— click to collapse' : '— click to expand'}
                          </td>
                          <td className="px-2 py-1.5 text-center">
                            <div className={`w-3 h-3 rounded-full mx-auto ${DOT_BG[group.progress]}`} title={`Progress (group) — ${PROGRESS_TITLE[group.progress]}`} />
                          </td>
                          <td className="px-2 py-1.5 text-center">
                            <div className={`w-3 h-3 rounded-full mx-auto ${DOT_BG[group.result]}`} title={`Result (group) — ${RESULT_TITLE[group.result]}`} />
                          </td>
                          <td className="px-2 py-1.5 text-right text-slate-700 tabular-nums font-medium">
                            {group.extrapolatedErrorTotal ? formatGbp(group.extrapolatedErrorTotal) : <span className="text-slate-300 font-normal">—</span>}
                          </td>
                          <td className="px-2 py-1.5 text-right text-slate-300">—</td>
                          <td className="px-2 py-1.5 text-center text-slate-300">—</td>
                          <td className="px-2 py-1.5 text-center text-slate-300">—</td>
                        </tr>

                        {/* Child rows */}
                        {isExpanded && group.rows.map(row => (
                          <tr key={row.key} className={row.isPlaceholder ? 'bg-slate-50/40' : (row.progress === 'red' || row.result === 'red' ? 'bg-red-50/40' : '')}>
                            <td className="px-2 py-1.5 text-slate-300 text-[9px] pl-6">
                              {/* indent shown via pl-6; FS Line name lives on the group header */}
                            </td>
                            {/* TB Code + description side by side. Code
                                in mono so the digits read clearly,
                                description in regular text afterwards. */}
                            <td className="px-2 py-1.5 text-left text-slate-600 text-[10px]">
                              {row.accountCode ? (
                                <div className="flex items-baseline gap-1.5 min-w-0">
                                  <span className="font-mono text-slate-700 flex-shrink-0">{row.accountCode}</span>
                                  {row.tbCodeDescription && (
                                    <span className="text-slate-500 truncate" title={row.tbCodeDescription}>{row.tbCodeDescription}</span>
                                  )}
                                </div>
                              ) : (
                                <span className="text-slate-300 italic">—</span>
                              )}
                            </td>
                            <td className="px-2 py-1.5 text-right text-slate-600 tabular-nums">
                              {formatGbp(row.tbCodeValue)}
                            </td>
                            <td className="px-2 py-1.5 text-center">{renderTbDot(row.tbCheck)}</td>
                            <td className="px-3 py-1.5 text-slate-700">
                              {row.isPlaceholder ? (
                                <span className="text-[10px] text-slate-400 italic">No test allocated</span>
                              ) : (
                                <>
                                  <div className="truncate max-w-[420px]">{row.testDescription}</div>
                                  {row.totalErrors > 0 && (
                                    <div className="text-[9px] text-red-600 mt-0.5 inline-flex items-center gap-0.5">
                                      <AlertTriangle className="h-2.5 w-2.5" />{row.totalErrors} error{row.totalErrors !== 1 ? 's' : ''}
                                    </div>
                                  )}
                                </>
                              )}
                            </td>
                            <td className="px-2 py-1.5 text-center">
                              {row.isPlaceholder ? <span className="text-slate-300 text-[9px]">—</span>
                                : <div className={`w-3 h-3 rounded-full mx-auto ${DOT_BG[row.progress]}`} title={PROGRESS_TITLE[row.progress]} />}
                            </td>
                            <td className="px-2 py-1.5 text-center">
                              {row.isPlaceholder ? <span className="text-slate-300 text-[9px]">—</span>
                                : <div className={`w-3 h-3 rounded-full mx-auto ${DOT_BG[row.result]}`} title={RESULT_TITLE[row.result]} />}
                            </td>
                            <td className="px-2 py-1.5 text-right text-slate-600 tabular-nums">
                              {row.extrapolatedError ? formatGbp(row.extrapolatedError) : <span className="text-slate-300">—</span>}
                            </td>
                            <td className="px-2 py-1.5 text-right text-slate-500 tabular-nums">{formatDuration(row.durationMs)}</td>
                            <td className="px-2 py-1.5 text-center">{row.isPlaceholder ? <span className="text-slate-300 text-[9px]">—</span> : renderSignOffButton(row, 'reviewer')}</td>
                            <td className="px-2 py-1.5 text-center">{row.isPlaceholder ? <span className="text-slate-300 text-[9px]">—</span> : renderSignOffButton(row, 'ri')}</td>
                          </tr>
                        ))}
                      </Fragment>
                    );
                  })}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────

interface SortableHeaderProps {
  label: string;
  col: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
  onFilterToggle?: () => void;
  hasFilter?: boolean;
  className?: string;
}

function SortableHeader({ label, col, sortKey, sortDir, onSort, onFilterToggle, hasFilter, className }: SortableHeaderProps) {
  const active = col === sortKey;
  return (
    <th className={`px-2 py-1.5 font-semibold ${className || ''}`}>
      <div className="inline-flex items-center gap-1">
        <button
          onClick={() => onSort(col)}
          className={`inline-flex items-center gap-1 hover:text-slate-700 ${active ? 'text-slate-700' : ''}`}
          title="Click to sort"
        >
          <span>{label}</span>
          {active
            ? (sortDir === 'asc' ? <ArrowUp className="h-2.5 w-2.5" /> : <ArrowDown className="h-2.5 w-2.5" />)
            : <ArrowUpDown className="h-2.5 w-2.5 text-slate-300" />}
        </button>
        {onFilterToggle && (
          <button
            onClick={onFilterToggle}
            className={`p-0.5 rounded hover:bg-slate-200 ${hasFilter ? 'text-blue-600' : 'text-slate-400'}`}
            title="Filter"
          >
            <FilterIcon className="h-2.5 w-2.5" />
          </button>
        )}
      </div>
    </th>
  );
}

interface FilterRowProps {
  filter: keyof ColumnFilters;
  filters: ColumnFilters;
  setFilters: (fn: (f: ColumnFilters) => ColumnFilters) => void;
  toggleDotFilter: (field: 'progress' | 'result', value: Dot) => void;
  onClose: () => void;
}

function FilterRow({ filter, filters, setFilters, toggleDotFilter, onClose }: FilterRowProps) {
  if (filter === 'fsLine') {
    return (
      <FilterShell label="Filter FS Line" onClose={onClose} onClear={() => setFilters(f => ({ ...f, fsLine: '' }))} hasValue={!!filters.fsLine}>
        <input
          type="text"
          value={filters.fsLine}
          onChange={e => setFilters(f => ({ ...f, fsLine: e.target.value }))}
          placeholder="Type to filter…"
          className="text-[11px] px-2 py-1 border border-slate-300 rounded w-48 focus:outline-none focus:border-blue-400"
          autoFocus
        />
      </FilterShell>
    );
  }
  if (filter === 'testDescription') {
    return (
      <FilterShell label="Filter Test" onClose={onClose} onClear={() => setFilters(f => ({ ...f, testDescription: '' }))} hasValue={!!filters.testDescription}>
        <input
          type="text"
          value={filters.testDescription}
          onChange={e => setFilters(f => ({ ...f, testDescription: e.target.value }))}
          placeholder="Type to filter…"
          className="text-[11px] px-2 py-1 border border-slate-300 rounded w-64 focus:outline-none focus:border-blue-400"
          autoFocus
        />
      </FilterShell>
    );
  }
  if (filter === 'progress' || filter === 'result') {
    const set = filters[filter];
    const dots: Dot[] = ['red', 'orange', 'green', 'pending'];
    return (
      <FilterShell label={`Filter ${filter === 'progress' ? 'Progress' : 'Result'}`} onClose={onClose} onClear={() => setFilters(f => ({ ...f, [filter]: new Set() }))} hasValue={set.size > 0}>
        <div className="flex items-center gap-2 text-[11px]">
          {dots.map(d => (
            <label key={d} className="inline-flex items-center gap-1 cursor-pointer">
              <input type="checkbox" checked={set.has(d)} onChange={() => toggleDotFilter(filter, d)} className="w-3 h-3" />
              <span className={`w-2.5 h-2.5 rounded-full ${DOT_BG[d]}`} />
              <span className="capitalize">{d}</span>
            </label>
          ))}
        </div>
      </FilterShell>
    );
  }
  if (filter === 'tbCheck') {
    return (
      <FilterShell label="Filter TB Check" onClose={onClose} onClear={() => setFilters(f => ({ ...f, tbCheck: 'any' }))} hasValue={filters.tbCheck !== 'any'}>
        <select
          value={filters.tbCheck}
          onChange={e => setFilters(f => ({ ...f, tbCheck: e.target.value as ColumnFilters['tbCheck'] }))}
          className="text-[11px] px-2 py-1 border border-slate-300 rounded focus:outline-none focus:border-blue-400"
          autoFocus
        >
          <option value="any">Any</option>
          <option value="has_check">Has TB check</option>
          <option value="no_check">No TB check</option>
          <option value="green">Reconciled (green)</option>
          <option value="red">Variance (red)</option>
        </select>
      </FilterShell>
    );
  }
  return null;
}

// Coloured count pill — matches the site-standard count badge
// shape used on Review Point / RI Matters / Outstanding etc.
// (white-on-colour for the active states; dark-on-slate for
// pending so a 0 still reads as a neutral, present cell rather
// than disappearing).
function CountPill({ colour, count, title }: { colour: 'red' | 'orange' | 'green' | 'pending'; count: number; title: string }) {
  const cls =
    colour === 'red'    ? 'bg-red-600 text-white' :
    colour === 'orange' ? 'bg-orange-500 text-white' :
    colour === 'green'  ? 'bg-green-600 text-white' :
                          'bg-slate-200 text-slate-600';
  return (
    <span
      className={`inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded-full text-[9px] font-bold leading-none ${cls}`}
      title={title}
    >
      {count}
    </span>
  );
}

function FilterShell({ label, onClose, onClear, hasValue, children }: { label: string; onClose: () => void; onClear: () => void; hasValue: boolean; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">{label}</span>
      {children}
      <div className="flex-1" />
      {hasValue && (
        <button onClick={onClear} className="text-[10px] text-slate-500 hover:text-slate-700 underline">Clear</button>
      )}
      <button onClick={onClose} className="text-[10px] text-slate-500 hover:text-slate-700">Close</button>
    </div>
  );
}
