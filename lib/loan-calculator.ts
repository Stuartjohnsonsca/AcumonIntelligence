/**
 * Loan Calculator — shared types, FS-level detection, period math and
 * traffic-light helpers for both Loan Receivables (asset side) and Loan
 * Liabilities (creditor side).
 *
 * The calculator is launched from the Audit Plan panel next to the VAT
 * Reconciliation button when the active FS Level is a loan line. Each
 * engagement persists ONE row to `audit_loan_calculators` carrying the
 * entire blob (all loans + lead summary + tests + disclosure + branch).
 *
 * ── Shape (top-level keys on AuditLoanCalculator.data) ──────────────
 *   side:           'receivable' | 'liability'            — which "side"
 *   setup:          { loanCount, maxTranches }            — initial sizing
 *   loans:          LoanTab[]                              — one per loan
 *   lead:           LeadSummary                            — computed
 *   tests:          TestState                              — 4-6 dot tests
 *   disclosure:     DisclosureState                        — totals + penalties
 *   covenants:      CovenantState                          — liabilities only
 *   impairment:     ImpairmentState                        — receivables only
 *   fmv:            FmvState                               — receivables only
 *   reviewedBy/At, signedOffBy/At  — same sign-off convention as VAT
 */

import { parseRemaps, resolveRemap, flatKey, type ToolSlugRemap } from './tool-slug-remap';

// ── Tool identity ────────────────────────────────────────────────────
export const LOAN_CALCULATOR_TOOL_NAME = 'Loan Calculator';
export const LOAN_PERMANENT_FILE_TEMPLATE_TYPE = 'permanent_file_questions';

// ── FS-level detection ────────────────────────────────────────────────
//
// The button needs to appear on every FS Line that could carry a loan.
// Firm FS Line names vary (UK GAAP ships "Loans & Borrowings" /
// "Loans" / "Bank Loans"; IFRS ships "Borrowings" / "Lease
// Liabilities"; custom firms may use "Long term creditors", "Hire
// purchase", "Director's loan"). Detection has two paths:
//   1. NAME match — isLoanFsLevel: any FS Line whose name contains
//      one of the loan keywords below qualifies. Permissive on purpose.
//   2. ROW match — isLoanFsLevelByRows: when the caller supplies the
//      TB rows mapped to the active level, we also check their
//      descriptions / account codes. Catches FS Lines like "Creditors
//      due after one year" that don't contain "loan" in the name but
//      have loan accounts mapped underneath.
// Side inference is name-driven: explicit receivable hints flip to
// receivable, everything else defaults to liability. The auditor can
// override the side on the panel's Setup screen.

// Keywords that, if present anywhere in the FS Line name, qualify the
// line as carrying loans. Permissive on purpose: the firm's FS Line
// names vary (UK GAAP ships "Loans & Borrowings" / "Loans" / "Bank
// Loans"; IFRS ships "Borrowings" / "Lease Liabilities"; custom firms
// may use "Long term creditors", "Hire purchase", "Director's loan").
const LOAN_KEYWORDS = [
  'loan', 'borrow',
  'finance lease', 'lease liabilit',
  'hire purchase', 'hp liabilit',
  'credit facility', 'credit facilities',
  'mortgage',
  'due to group', 'due from group', 'group balance',
  'intercompany', 'inter-company', 'inter company',
  'debenture', 'note payable', 'note receivable',
  'notes payable', 'notes receivable',
  "director's loan", 'directors loan',
];

// Stronger hints that flip the side from "liability" (default) to
// "receivable". Order matters: any match here wins.
const RECEIVABLE_NAME_HINTS = [
  'receivable',
  'due from',
  'loan asset', 'loans asset',
  'note receivable', 'notes receivable',
  'loan to', 'loans to',
  'loan advanced', 'loans advanced',
  'loan made', 'loans made',
];

function norm(s: string | null | undefined): string {
  return (s || '').toLowerCase().trim().replace(/\s+/g, ' ');
}

/** True when the FS Level name reads as a Loan Receivable / Loan Asset. */
export function isLoanReceivableFsLevel(level: string | null | undefined): boolean {
  return isLoanFsLevel(level) && inferLoanSide(level) === 'receivable';
}

/** True when the FS Level name reads as a Loan Liability / Borrowings. */
export function isLoanLiabilityFsLevel(level: string | null | undefined): boolean {
  return isLoanFsLevel(level) && inferLoanSide(level) === 'liability';
}

/** True when the FS Line name reads as anything that could carry a
 *  loan, receivable OR liability. The caller chooses which side to
 *  open the panel on via inferLoanSide; the auditor can override on
 *  the Setup screen if the auto-detect picked the wrong side. */
export function isLoanFsLevel(level: string | null | undefined): boolean {
  const n = norm(level);
  if (!n) return false;
  return LOAN_KEYWORDS.some(k => n.includes(k));
}

/** Row-aware fallback — extends isLoanFsLevel with a scan of the TB
 *  rows mapped under the active level. Pass the row description and/or
 *  account code strings. Catches FS Lines like "Creditors due after
 *  one year" whose name doesn't contain a loan keyword but have loan
 *  accounts mapped under them. */
export function isLoanFsLevelByRows(
  level: string | null | undefined,
  tbRowText: Array<string | null | undefined>,
): boolean {
  if (isLoanFsLevel(level)) return true;
  for (const d of tbRowText) {
    const n = norm(d);
    if (!n) continue;
    if (LOAN_KEYWORDS.some(k => n.includes(k))) return true;
  }
  return false;
}

/** Loan "side" inferred from the FS Level name. Strong receivable
 *  hints win; everything else defaults to liability (the more common
 *  case). The auditor can flip the side on the panel's Setup screen. */
export function inferLoanSide(level: string | null | undefined): LoanSide {
  const n = norm(level);
  if (RECEIVABLE_NAME_HINTS.some(h => n.includes(h))) return 'receivable';
  if (/\basset\b/.test(n) && /\bloan/.test(n)) return 'receivable';
  return 'liability';
}

// ── Types ────────────────────────────────────────────────────────────
export type LoanSide = 'receivable' | 'liability';
export type Periodicity = 'Monthly' | 'Quarterly' | 'Semi-annual' | 'Annual';
export type DayCount = 'Actual/365' | 'Actual/360' | '30/360';
export type DotStatus = 'green' | 'orange' | 'red' | 'hollow';

export interface LoanHeader {
  /** Lender (loans payable) or borrower (loans receivable). */
  lender: string;
  /** Original principal advanced in the currency of the agreement. */
  amount: number | null;
  /** Number of tranches drawn or available. */
  numberOfTranches: number;
  /** Free-text: covenants/triggers that must be met before drawdown. */
  drawdownRequirements: string;
  /** "SONIA", "Bank base rate", "Fixed", "BoE base", "SOFR", etc. */
  interestBase: string;
  /** Margin above base in percentage points (e.g. 2.5 = 2.5%). */
  interestMargin: number | null;
  /** Day-count convention. */
  dayCountBasis: DayCount;
  /** Agreement date (ISO YYYY-MM-DD). */
  loanDate: string | null;
  /** First drawdown date (ISO). */
  drawdownDate: string | null;
  /** Lender / arrangement / commitment fees (single line item summary). */
  fees: number | null;
  /** Interest-charge cadence — drives the schedule rows. */
  loanPeriodicity: Periodicity;
  /** Final repayment date (ISO) — used by Disclosure bucketing. */
  maturityDate: string | null;
  /** True if the lender has a debenture / charge over the company. */
  securityHeld: boolean | null;
  /** Plain-English description of the security if any. */
  securityDescription: string;
  /** Has the auditor checked Companies House outstanding-charges? */
  checkedCompaniesHouse: boolean;
  /** Notes if the beneficiary on CH differs from the lender named here. */
  beneficiaryMismatchNote: string;
}

export interface LoanScheduleRow {
  /** ISO yyyy-mm-dd — period start. */
  fromDate: string;
  /** ISO yyyy-mm-dd — period end. */
  toDate: string;
  bf: number;
  drawdown: number;
  lenderFees: number;
  otherFees: number;
  interestCharged: number;
  payments: number;
  cf: number;
}

export interface LoanCovenant {
  id: string;
  description: string;
  threshold: string;          // free-text — "Net Debt:EBITDA < 3.0x", "Min interest cover 2.5x"
  testFrequency: string;      // "Quarterly", "Annual", etc.
  /** Has the auditor sent a confirmation request via the Portal? */
  clientConfirmedViaPortal: boolean;
  portalRequestId?: string;
  portalSentAt?: string;
  /** Y / N / N/A. */
  metStatus: 'Y' | 'N' | 'NA' | '';
  notes: string;
}

export interface LoanPenalty {
  id: string;
  description: string;
  amount: number | null;
  /** "Early repayment", "Default rate", "Late payment fee" etc. */
  trigger: string;
  /** Does this need to be disclosed in the FS? */
  requiresDisclosure: 'Y' | 'N' | '';
  notes: string;
}

export interface LoanDocumentRef {
  /** Stable id — points at AuditDocument.id when uploaded/from-client/
   *  prior-period, or 'manual_<ts>' for user-entered. */
  id: string;
  source: 'client_portal' | 'upload' | 'prior_period' | 'manual';
  /** Filename or human label. */
  name: string;
  /** Who entered/uploaded (display name). */
  capturedBy: string;
  /** Captured at (ISO timestamp). */
  capturedAt: string;
  /** Free-text notes (visible to reviewer). */
  notes: string;
  /** When source = 'manual' the user-entered fields are mirrored here so
   *  the original entry can be re-displayed alongside any later edits. */
  manualSnapshot?: Partial<LoanHeader> & { scheduleRows?: LoanScheduleRow[] };
}

export interface LoanTab {
  /** Stable id — also used as the React key and the tab anchor. */
  id: string;
  /** Display label = lender + loan name + drawdown date. */
  label: string;
  header: LoanHeader;
  schedule: LoanScheduleRow[];
  /** Document evidence sources for this loan. */
  documents: LoanDocumentRef[];
  /** Covenants attached to this specific loan (liabilities only). */
  covenants: LoanCovenant[];
  /** Penalty / future-liability disclosures attached to this loan. */
  penalties: LoanPenalty[];
}

export interface LeadSummaryRow {
  fromDate: string;
  toDate: string;
  bf: number;
  drawdown: number;
  lenderFees: number;
  otherFees: number;
  interestCharged: number;
  payments: number;
  cf: number;
}

export interface LeadSummary {
  /** Aggregated rows — typically just one row covering the engagement
   *  period start → end, but the type permits multi-row breakdowns if
   *  the auditor wants a quarterly lead. */
  rows: LeadSummaryRow[];
  /** Performance Materiality at the moment the lead was last computed —
   *  cached so reopening the panel doesn't refetch on every render. */
  performanceMateriality?: number;
}

export interface TestResult {
  status: DotStatus;
  /** Auditor comment when overriding / explaining the dot. */
  comment: string;
  /** Computed difference (when applicable) used to drive the dot. */
  computedDiff?: number;
}

export interface TestState {
  /** "Does the effective interest rate appear reasonable?" — Y/N user toggle. */
  rateReasonable: { answer: 'Y' | 'N' | ''; comment: string };
  /** Interest charge in lead vs Finance Cost / Income line in TBCYvPY. */
  interestVsTb: TestResult;
  /** Period start balance vs Prior period end balance in TBCYvPY. */
  openingVsPriorTb: TestResult;
  /** Period end balance vs TBCYvPY closing (incl. LT + ST split). */
  closingVsTb: TestResult;
  /** Within-12-months vs after-12-months split agrees TBCYvPY. */
  ltStSplit: TestResult;
}

export interface DisclosureMaturityBucket {
  /** "Within 12m", "12-24m", "24-60m", "After 60m". */
  label: string;
  /** Carrying amount in the FS (principal + accrued, depending on policy). */
  amount: number | null;
  /** Cash payments contractually due in the bucket. */
  payments: number | null;
}

export interface DisclosureState {
  /** 4 bucket rows in fixed order. */
  amountBuckets: DisclosureMaturityBucket[];
  /** Payment-bucket rows (may differ from amountBuckets — e.g. PIK loans). */
  paymentBuckets: DisclosureMaturityBucket[];
  /** Auditor sign-off dot for the total ties to TBCYvPY. */
  totalsTie: TestResult;
  /** Auditor sign-off dot for security confirmation work. */
  securityConfirmed: TestResult;
}

export interface CovenantState {
  /** If a liability — does the auditor want to test covenants this period? */
  testThisPeriod: 'Y' | 'N' | '';
  /** PortalRequest sent to client confirming all covenants met? */
  portalRequestId?: string;
  portalSentAt?: string;
  /** Conclusion dot — green if all met + evidence on file. */
  conclusion: TestResult;
}

export interface ImpairmentState {
  /** If a receivable — is there any indication of impairment? */
  anyIndication: 'Y' | 'N' | '';
  /** Performing / non-performing assessment (per loan, keyed by loan id). */
  performingByLoan: Record<string, 'performing' | 'non_performing' | ''>;
  /** Portal request id when evidence was sought from client. */
  portalRequestId?: string;
  portalSentAt?: string;
  /** Free-text impairment assessment (one per loan). */
  assessmentByLoan: Record<string, string>;
  /** Final dot — green if no indication / all evidence in / assessment done. */
  conclusion: TestResult;
}

export interface FmvState {
  /** If a receivable — does it need to be revalued to FMV? */
  required: 'Y' | 'N' | '';
  /** Discount rate used (annual %). */
  discountRate: number | null;
  /** Justification (source + reasoning) — populated from web research. */
  rateJustification: string;
  /** Web source URL(s) supporting the rate. */
  sources: { url: string; title: string; capturedAt: string }[];
  /** Computed FMV per loan. */
  fmvByLoan: Record<string, number>;
  /** Final dot. */
  conclusion: TestResult;
}

export interface LoanCalcData {
  side: LoanSide;
  setup: { loanCount: number; maxTranches: number };
  loans: LoanTab[];
  lead: LeadSummary;
  tests: TestState;
  disclosure: DisclosureState;
  covenants: CovenantState;
  impairment: ImpairmentState;
  fmv: FmvState;
  /** ISO timestamp of last edit. */
  updatedAt?: string;
  /** Sign-off — same fields as the VAT panel. */
  reviewedBy?: string;
  reviewedByName?: string;
  reviewedAt?: string;
  riSignedBy?: string;
  riSignedByName?: string;
  riSignedAt?: string;
}

/**
 * One "loan group" — a self-contained calculator run scoped to one or
 * more FS Lines. Engagements with several loan-bearing FS Lines (e.g.
 * "Bank Loans", "Director's Loan", "Lease Liabilities") run the
 * calculator separately for each, and each run gets its own group
 * with an auto-assigned letter badge ("A", "B", "C", ...) so the audit
 * plan can mirror the conclusion dots back onto every FS Line that
 * triggered a run.
 */
export interface LoanGroup extends LoanCalcData {
  /** Stable id — used in URLs and React keys. */
  id: string;
  /** Letter badge "A", "B", "C"... — assigned by index on save. */
  label: string;
  /** FS Line names this group covers (the user can group several FS
   *  Lines under one calculator run, but the default is one). */
  fsLines: string[];
  /** ISO timestamp the group was first opened. */
  createdAt: string;
  /** Optional free-text title (auditor-supplied), defaults to label. */
  title?: string;
}

/** Top-level shape of AuditLoanCalculator.data after groups land. The
 *  panel and audit plan always read/write through parseLoanCalcRoot so
 *  legacy single-group blobs (which had `side`/`setup`/`loans` at the
 *  root) keep working — they lift into a single group "A". */
export interface LoanCalcRoot {
  groups: LoanGroup[];
  updatedAt?: string;
}

// ── Empty / default helpers ──────────────────────────────────────────
export function emptyHeader(): LoanHeader {
  return {
    lender: '', amount: null, numberOfTranches: 1, drawdownRequirements: '',
    interestBase: '', interestMargin: null, dayCountBasis: 'Actual/365',
    loanDate: null, drawdownDate: null, fees: null, loanPeriodicity: 'Quarterly',
    maturityDate: null, securityHeld: null, securityDescription: '',
    checkedCompaniesHouse: false, beneficiaryMismatchNote: '',
  };
}

export function emptyTestResult(): TestResult {
  return { status: 'hollow', comment: '' };
}

export function emptyDisclosureBuckets(): DisclosureMaturityBucket[] {
  return [
    { label: 'Within 12m of period end',  amount: null, payments: null },
    { label: '12-24m after period end',   amount: null, payments: null },
    { label: '24-60m after period end',   amount: null, payments: null },
    { label: 'After 60m from period end', amount: null, payments: null },
  ];
}

export function emptyLoanCalc(side: LoanSide): LoanCalcData {
  return {
    side,
    setup: { loanCount: 1, maxTranches: 1 },
    loans: [],
    lead: { rows: [] },
    tests: {
      rateReasonable:  { answer: '', comment: '' },
      interestVsTb:    emptyTestResult(),
      openingVsPriorTb: emptyTestResult(),
      closingVsTb:     emptyTestResult(),
      ltStSplit:       emptyTestResult(),
    },
    disclosure: {
      amountBuckets:    emptyDisclosureBuckets(),
      paymentBuckets:   emptyDisclosureBuckets(),
      totalsTie:        emptyTestResult(),
      securityConfirmed: emptyTestResult(),
    },
    covenants: {
      testThisPeriod: '',
      conclusion: emptyTestResult(),
    },
    impairment: {
      anyIndication: '',
      performingByLoan: {},
      assessmentByLoan: {},
      conclusion: emptyTestResult(),
    },
    fmv: {
      required: '',
      discountRate: null,
      rateJustification: '',
      sources: [],
      fmvByLoan: {},
      conclusion: emptyTestResult(),
    },
  };
}

// ── Group helpers ────────────────────────────────────────────────────

/** Convert a 0-based index to a spreadsheet-style letter label:
 *  0 → "A", 1 → "B", 25 → "Z", 26 → "AA", 27 → "AB", etc. */
export function groupLetter(idx: number): string {
  if (idx < 0) return '';
  let n = idx;
  let out = '';
  while (true) {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
    if (n < 0) break;
  }
  return out;
}

/** Coerce whatever was loaded from `audit_loan_calculators.data` into
 *  the canonical `LoanCalcRoot` shape. Tolerant of:
 *   - empty / undefined: returns `{ groups: [] }`.
 *   - legacy single-group blob (has `side` at the root): lifts the
 *     whole blob into one group "A" covering the FS Lines listed under
 *     `legacy._fsLines` (when present) or an empty array.
 *   - new shape (has `groups: [...]`): coerced + relabelled.
 *  Re-labels group letters by index every time so deleting / reordering
 *  groups stays consistent. */
export function parseLoanCalcRoot(raw: unknown): LoanCalcRoot {
  if (!raw || typeof raw !== 'object') return { groups: [] };
  const r = raw as Record<string, unknown>;
  // New shape — groups at root.
  if (Array.isArray(r.groups)) {
    const groups = (r.groups as unknown[])
      .filter((g): g is Record<string, unknown> => !!g && typeof g === 'object')
      .map((g, idx) => normaliseGroup(g, idx));
    return { groups, updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : undefined };
  }
  // Legacy single-blob — was the old `LoanCalcData` saved directly.
  if (typeof r.side === 'string' && (r.side === 'receivable' || r.side === 'liability')) {
    const side = r.side as LoanSide;
    const legacyFsLines = Array.isArray((r as any)._fsLines)
      ? ((r as any)._fsLines as string[]).filter(s => typeof s === 'string')
      : [];
    const group: LoanGroup = {
      ...emptyLoanCalc(side),
      ...(r as unknown as LoanCalcData),
      id: typeof r.id === 'string' ? r.id as string : `grp_legacy_${Date.now()}`,
      label: 'A',
      fsLines: legacyFsLines,
      createdAt: typeof r.createdAt === 'string' ? r.createdAt as string : new Date().toISOString(),
    };
    return { groups: [group], updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : undefined };
  }
  return { groups: [] };
}

function normaliseGroup(g: Record<string, unknown>, idx: number): LoanGroup {
  const side: LoanSide = g.side === 'receivable' ? 'receivable' : 'liability';
  const fsLines = Array.isArray(g.fsLines) ? (g.fsLines as unknown[]).filter((s): s is string => typeof s === 'string') : [];
  const base = emptyLoanCalc(side);
  // Object-by-object merge so a partial `tests` / `disclosure` /
  // branch object on disk doesn't wipe the nested defaults. Without
  // this, a legacy group that has only `tests.rateReasonable` would
  // leave `tests.interestVsTb` undefined and crash dotsForGroup.
  const gAny = g as Record<string, any>;
  return {
    ...base,
    side,
    setup: { ...base.setup, ...(gAny.setup || {}) },
    loans: Array.isArray(gAny.loans) ? gAny.loans : base.loans,
    lead: { ...base.lead, ...(gAny.lead || {}) },
    tests: { ...base.tests, ...(gAny.tests || {}) },
    disclosure: { ...base.disclosure, ...(gAny.disclosure || {}) },
    covenants: { ...base.covenants, ...(gAny.covenants || {}) },
    impairment: { ...base.impairment, ...(gAny.impairment || {}) },
    fmv: { ...base.fmv, ...(gAny.fmv || {}) },
    id: typeof g.id === 'string' ? g.id : `grp_${Date.now()}_${idx}`,
    label: groupLetter(idx),
    fsLines,
    createdAt: typeof g.createdAt === 'string' ? g.createdAt : new Date().toISOString(),
    title: typeof g.title === 'string' ? g.title : undefined,
    updatedAt: typeof gAny.updatedAt === 'string' ? gAny.updatedAt : base.updatedAt,
    reviewedBy: typeof gAny.reviewedBy === 'string' ? gAny.reviewedBy : undefined,
    reviewedByName: typeof gAny.reviewedByName === 'string' ? gAny.reviewedByName : undefined,
    reviewedAt: typeof gAny.reviewedAt === 'string' ? gAny.reviewedAt : undefined,
    riSignedBy: typeof gAny.riSignedBy === 'string' ? gAny.riSignedBy : undefined,
    riSignedByName: typeof gAny.riSignedByName === 'string' ? gAny.riSignedByName : undefined,
    riSignedAt: typeof gAny.riSignedAt === 'string' ? gAny.riSignedAt : undefined,
  };
}

/** Build an empty new group attached to a specific FS Line. Side is
 *  auto-inferred from the FS Line name; auditor can override on the
 *  panel's Setup screen. */
export function emptyLoanGroup(fsLineName: string, idx: number): LoanGroup {
  const side = inferLoanSide(fsLineName);
  return {
    ...emptyLoanCalc(side),
    id: `grp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    label: groupLetter(idx),
    fsLines: fsLineName ? [fsLineName] : [],
    createdAt: new Date().toISOString(),
  };
}

/** Find every group covering a given FS Line. */
export function groupsForFsLine(root: LoanCalcRoot, fsLineName: string | null | undefined): LoanGroup[] {
  if (!fsLineName) return [];
  const target = norm(fsLineName);
  return root.groups.filter(g => g.fsLines.some(x => norm(x) === target));
}

/** Pick a single group covering an FS Line, or create a new one and
 *  return it. The returned `{ root, group, isNew }` lets the caller
 *  persist back via `root.groups`. */
export function ensureGroupForFsLine(
  root: LoanCalcRoot,
  fsLineName: string,
): { root: LoanCalcRoot; group: LoanGroup; isNew: boolean } {
  const matches = groupsForFsLine(root, fsLineName);
  if (matches.length > 0) {
    return { root, group: matches[0], isNew: false };
  }
  const idx = root.groups.length;
  const group = emptyLoanGroup(fsLineName, idx);
  const next: LoanCalcRoot = { ...root, groups: [...root.groups, group] };
  return { root: next, group, isNew: true };
}

/** Replace one group inside a root (matched by id) and return the
 *  patched root. Relabels every group by index so deleting / reordering
 *  always gives stable A/B/C labels. */
export function upsertGroup(root: LoanCalcRoot, group: LoanGroup): LoanCalcRoot {
  const idx = root.groups.findIndex(g => g.id === group.id);
  const next = idx >= 0
    ? root.groups.map(g => g.id === group.id ? group : g)
    : [...root.groups, group];
  return {
    ...root,
    groups: next.map((g, i) => ({ ...g, label: groupLetter(i) })),
    updatedAt: new Date().toISOString(),
  };
}

/** Collect every conclusion dot inside a group — the four 3-colour
 *  test dots, the two disclosure dots, and the side-specific branch
 *  dots (covenants OR impairment + FMV). The rateReasonable Y/N is
 *  excluded — it isn't a dot. Defensive against partial / legacy
 *  shapes: any missing nested field reads as 'hollow' rather than
 *  blowing up the audit-plan FS Level tab strip. */
export function dotsForGroup(g: LoanGroup): { key: string; label: string; status: DotStatus }[] {
  const dot = (r: TestResult | undefined | null): DotStatus => (r && r.status) || 'hollow';
  const t = (g.tests || {}) as Partial<TestState>;
  const d = (g.disclosure || {}) as Partial<DisclosureState>;
  const c = (g.covenants || {}) as Partial<CovenantState>;
  const i = (g.impairment || {}) as Partial<ImpairmentState>;
  const f = (g.fmv || {}) as Partial<FmvState>;
  const out: { key: string; label: string; status: DotStatus }[] = [
    { key: 'interestVsTb',     label: 'Interest vs TB',       status: dot(t.interestVsTb) },
    { key: 'openingVsPriorTb', label: 'Opening vs Prior TB',  status: dot(t.openingVsPriorTb) },
    { key: 'closingVsTb',      label: 'Closing vs TB',        status: dot(t.closingVsTb) },
    { key: 'ltStSplit',        label: 'LT/ST split',          status: dot(t.ltStSplit) },
    { key: 'totalsTie',        label: 'Disclosure totals',    status: dot(d.totalsTie) },
    { key: 'securityConfirmed',label: 'Security confirmed',   status: dot(d.securityConfirmed) },
  ];
  if (g.side === 'liability') {
    out.push({ key: 'covenants', label: 'Covenants', status: dot(c.conclusion) });
  } else {
    out.push({ key: 'impairment', label: 'Impairment', status: dot(i.conclusion) });
    out.push({ key: 'fmv',        label: 'FMV',        status: dot(f.conclusion) });
  }
  return out;
}

/** Single roll-up dot for a group: worst-of (red > orange > green >
 *  hollow). Hollow when ALL dots are hollow — i.e. the calculator has
 *  not yet been concluded on any front. */
export function overallDot(g: LoanGroup): DotStatus {
  const dots = dotsForGroup(g);
  if (dots.some(d => d.status === 'red')) return 'red';
  if (dots.some(d => d.status === 'orange')) return 'orange';
  if (dots.some(d => d.status === 'green')) return 'green';
  return 'hollow';
}

// ── Period math ──────────────────────────────────────────────────────
export const PERIODICITY_MONTHS: Record<Periodicity, number> = {
  Monthly: 1, Quarterly: 3, 'Semi-annual': 6, Annual: 12,
};

/** Walk from `loanStartIso` forward in `periodicity` increments until
 *  we pass `cutoffIso`. Each row's [from, to] is the period boundary.
 *  Used to seed the schedule for a brand-new loan; the auditor can then
 *  edit individual cells. */
export function generateScheduleRows(
  loanStartIso: string,
  cutoffIso: string,
  periodicity: Periodicity
): LoanScheduleRow[] {
  if (!loanStartIso || !cutoffIso) return [];
  const start = new Date(loanStartIso + 'T00:00:00Z');
  const end = new Date(cutoffIso + 'T00:00:00Z');
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end < start) return [];
  const stepMonths = PERIODICITY_MONTHS[periodicity];
  const rows: LoanScheduleRow[] = [];
  let cur = new Date(start);
  while (cur < end) {
    const next = new Date(cur);
    next.setUTCMonth(next.getUTCMonth() + stepMonths);
    const rowEnd = next > end ? end : next;
    rows.push({
      fromDate: cur.toISOString().slice(0, 10),
      toDate: rowEnd.toISOString().slice(0, 10),
      bf: 0, drawdown: 0, lenderFees: 0, otherFees: 0,
      interestCharged: 0, payments: 0, cf: 0,
    });
    cur = next;
  }
  return rows;
}

/** Pro-rate a value across an overlap with a target window — used when
 *  a loan starts mid-period or ends before the period closes, so the
 *  lead summary correctly captures only the slice that falls inside
 *  the engagement period. */
export function proRata(raw: number | null | undefined, daysOverlap: number, daysInRow: number): number {
  if (raw == null || !isFinite(raw)) return 0;
  if (daysInRow <= 0) return 0;
  return raw * (daysOverlap / daysInRow);
}

function dayDiff(aIso: string, bIso: string): number {
  const a = new Date(aIso + 'T00:00:00Z').getTime();
  const b = new Date(bIso + 'T00:00:00Z').getTime();
  return Math.round((b - a) / 86400000);
}

/** Compute one Lead-Summary row spanning [periodStartIso, periodEndIso].
 *  For each loan we pro-rate any rows that straddle the window edges.
 *  bf = sum of each loan's bf at first row overlapping period start (or
 *  the carry-forward of the prior row if the loan started earlier).
 *  cf = sum of each loan's cf at the last row overlapping period end. */
export function aggregateLeadRow(
  loans: LoanTab[],
  periodStartIso: string,
  periodEndIso: string
): LeadSummaryRow {
  let bf = 0, drawdown = 0, lenderFees = 0, otherFees = 0;
  let interestCharged = 0, payments = 0, cf = 0;
  const pStart = periodStartIso;
  const pEnd   = periodEndIso;

  for (const loan of loans) {
    // bf — the cf of the row that ENDS on or before period start, else 0.
    const priorRow = [...loan.schedule].reverse().find(r => r.toDate <= pStart);
    bf += priorRow ? priorRow.cf : 0;

    // cf — the cf of the LAST row that ENDS on or before period end.
    const lastIn = [...loan.schedule].reverse().find(r => r.toDate <= pEnd);
    cf += lastIn ? lastIn.cf : (priorRow ? priorRow.cf : 0);

    // For each schedule row, compute the overlap with [pStart, pEnd] and
    // pro-rate the flow figures by overlap / row-length.
    for (const r of loan.schedule) {
      if (r.toDate <= pStart || r.fromDate >= pEnd) continue;
      const overlapStart = r.fromDate < pStart ? pStart : r.fromDate;
      const overlapEnd   = r.toDate   > pEnd   ? pEnd   : r.toDate;
      const overlapDays = dayDiff(overlapStart, overlapEnd);
      const rowDays = dayDiff(r.fromDate, r.toDate) || 1;
      const w = overlapDays / rowDays;
      drawdown        += (r.drawdown || 0) * w;
      lenderFees      += (r.lenderFees || 0) * w;
      otherFees       += (r.otherFees || 0) * w;
      interestCharged += (r.interestCharged || 0) * w;
      payments        += (r.payments || 0) * w;
    }
  }

  return {
    fromDate: periodStartIso, toDate: periodEndIso,
    bf, drawdown, lenderFees, otherFees, interestCharged, payments, cf,
  };
}

// ── Traffic-light / materiality helper ───────────────────────────────
//
// Mirrors the VAT panel: green if |diff| < CT, orange between CT and PM,
// red if >= PM, hollow if we have no PM / can't compute the diff.

export function dotForDiff(
  diff: number | null | undefined,
  clearlyTrivial: number | null | undefined,
  performanceMateriality: number | null | undefined
): DotStatus {
  if (diff == null || !isFinite(diff)) return 'hollow';
  if (performanceMateriality == null || !isFinite(performanceMateriality)) return 'hollow';
  const abs = Math.abs(diff);
  const ct = clearlyTrivial && isFinite(clearlyTrivial) ? clearlyTrivial : performanceMateriality * 0.05;
  if (abs < ct) return 'green';
  if (abs < performanceMateriality) return 'orange';
  return 'red';
}

// ── Permanent-file gate (optional — used if the firm wires a question) ─
//
// Some firms add a Permanent-File question like "Does the client have
// loan agreements?" to gate this calculator. The lookup mirrors VAT /
// Tax-on-Profits: load the template, build slug → questionId map,
// consult the tool-slug-remap registry, then read the flat permanent-
// file JSON by question UUID (or `<uuid>_col<N>` for multi-column rows).

export const LOAN_PERMANENT_QUESTION_SLUG = 'does_the_client_have_loan_agreements';
export const LOAN_PERMANENT_QUESTION_LABEL = 'Does the client have any loan agreements (receivable or payable)?';

function simpleSlugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/%/g, ' pct ')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export interface LoanGateStatus {
  status: 'Y' | 'N' | 'unanswered';
  raw?: string;
}

/** Read whether the permanent file flags loan agreements present.
 *  Tolerant of: the question not being defined yet, the slug being
 *  remapped via the registry, or the answer being absent. */
export async function readLoanGate(args: {
  engagementId: string;
  permanentFileData: Record<string, unknown> | undefined | null;
  remaps: ToolSlugRemap[] | unknown;
  templateSlugToQuestionId: Record<string, string>;
}): Promise<LoanGateStatus> {
  const { permanentFileData, templateSlugToQuestionId } = args;
  if (!permanentFileData || typeof permanentFileData !== 'object') {
    return { status: 'unanswered' };
  }
  const remaps = parseRemaps(args.remaps);
  const resolved = resolveRemap(
    remaps,
    LOAN_CALCULATOR_TOOL_NAME,
    LOAN_PERMANENT_FILE_TEMPLATE_TYPE,
    LOAN_PERMANENT_QUESTION_SLUG,
  );
  const slug = resolved.slug || LOAN_PERMANENT_QUESTION_SLUG;
  const col  = resolved.column;

  // Find the question UUID by slug. The template stores `text` per
  // question, so we slugify each text and pick the match.
  const qid = templateSlugToQuestionId[slug];
  // Tolerant scan — pick the first slug containing "loan" + "agreement".
  let key: string | undefined;
  if (qid) {
    key = col ? flatKey(qid, col) : qid;
  } else {
    const data = permanentFileData as Record<string, unknown>;
    key = Object.keys(data).find(k => {
      const s = simpleSlugify(k);
      return s.includes('loan') && s.includes('agreement');
    });
    if (!key) {
      // Legacy literal-key fallback (matches the pre-remap behaviour).
      key = LOAN_PERMANENT_QUESTION_SLUG;
    }
  }
  const raw = (permanentFileData as Record<string, unknown>)[key!];
  if (raw == null || raw === '') return { status: 'unanswered' };
  const s = String(raw).trim().toUpperCase();
  if (s === 'Y' || s === 'YES' || s === 'TRUE') return { status: 'Y', raw: String(raw) };
  if (s === 'N' || s === 'NO' || s === 'FALSE') return { status: 'N', raw: String(raw) };
  return { status: 'unanswered', raw: String(raw) };
}

// ── Protected-question registry (for AppendixTemplateEditor warnings) ─
export interface ProtectedQuestion {
  slug: string;
  column?: number;
  templateType: string;
  toolName: string;
  description: string;
  allowedInputTypes?: Array<'text' | 'textarea' | 'yesno' | 'yna' | 'yes_only' | 'dropdown' | 'number' | 'currency' | 'date' | 'formula' | 'checkbox'>;
  expectedValues?: string[];
}

export const LOAN_CALCULATOR_PROTECTED_QUESTIONS: ProtectedQuestion[] = [
  {
    slug: LOAN_PERMANENT_QUESTION_SLUG,
    templateType: LOAN_PERMANENT_FILE_TEMPLATE_TYPE,
    toolName: LOAN_CALCULATOR_TOOL_NAME,
    description:
      'Gates the Loan Calculator. Answer Y → calculator opens. Answer N → tool hidden / advises no testing needed. Unanswered → operator prompted to complete the Permanent tab first.',
    allowedInputTypes: ['yesno', 'yna', 'yes_only', 'dropdown'],
    expectedValues: ['Y', 'N'],
  },
];

// ── Public helpers used by the panel ─────────────────────────────────
export function buildLoanLabel(header: LoanHeader, index: number): string {
  const lender = (header.lender || '').trim() || `Loan ${index + 1}`;
  const date = header.drawdownDate || header.loanDate || '';
  return date ? `${lender} – ${date}` : lender;
}

/** Format a number as currency — fallback when Intl.NumberFormat isn't
 *  available (server-side render). */
export function fmtCcy(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return '—';
  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(n);
  } catch {
    return n.toFixed(0);
  }
}
