'use client';

import { useState, useEffect, useMemo, Fragment } from 'react';
import { Loader2, ArrowLeft, FileText, Play, ClipboardList, ChevronDown, ChevronRight, CheckCircle2, XCircle, Clock, AlertTriangle, GitBranch, Calculator } from 'lucide-react';
import { useScrollToAnchor } from '@/lib/hooks/useScrollToAnchor';
import { TestExecutionPanel } from './TestExecutionPanel';
import { TestResultsPanel } from './TestResultsPanel';
import { ExecutionFlowViewer } from './ExecutionFlowViewer';
import { ErrorSchedulePanel } from './ErrorSchedulePanel';
import { AnalyticalReviewPanel } from './AnalyticalReviewPanel';
import { PayrollTestPanel } from './PayrollTestPanel';
import { assertionShortLabel } from '@/types/methodology';
import { JournalRiskPanel } from './JournalRiskPanel';
import { SRMMPanel } from './SRMMPanel';
import { PlanCustomiserModal } from './PlanCustomiserModal';
import { VatReconciliationPanel } from './VatReconciliationPanel';
import { isRevenueFsLevel } from '@/lib/vat-reconciliation';

interface TBRow {
  id: string;
  accountCode: string;
  originalAccountCode: string | null;
  description: string;
  fsStatement: string | null;
  fsLevel: string | null;
  fsNoteLevel: string | null;
  currentYear: number | null;
  priorYear: number | null;
  category: string | null;
}

interface RMMItem {
  lineItem: string;
  riskIdentified: string | null;
  overallRisk: string | null;
  amount: number | null;
  assertions: string[] | null;
  notes: string | null;
  fsStatement: string | null;
  fsLevel: string | null;
  fsNote: string | null;
}

interface AllocationEntry {
  id: string;
  testId: string;
  fsLineId: string;
  fsLine: { id: string; name: string };
  test: {
    id: string;
    name: string;
    description: string | null;
    testTypeCode: string;
    assertions: string[] | null;
    framework: string;
    significantRisk: boolean;
    isDraft?: boolean;
    flow: any | null;
  };
}

interface FsLineEntry {
  id: string;
  name: string;
  lineType: string;
  fsCategory: string;
}

interface TestType {
  code: string;
  name: string;
  actionType: string;
  executionDef?: any | null;
}

const TEST_TYPE_COLORS: Record<string, string> = {
  client_action: 'bg-blue-100 text-blue-700 border-blue-200',
  ai_action: 'bg-purple-100 text-purple-700 border-purple-200',
  team_action: 'bg-green-100 text-green-700 border-green-200',
};

interface Props {
  engagementId: string;
  clientId?: string;
  periodId?: string;
  onClose: () => void;
  periodEndDate?: string | null;
  periodStartDate?: string | null;
  /**
   * Optional deep-link target. When supplied (e.g. from the Completion
   * sidebar's AP shortcuts) the panel opens with this Statement
   * pre-selected instead of the default first statement.
   */
  initialStatement?: string;
  /**
   * Pre-select this FS Level under the initialStatement on open.
   * Honoured only the first time the level list resolves for the
   * matching statement — afterwards the user's level clicks take over.
   */
  initialLevel?: string;
  /** Same idea for the "Other" group (Going Concern, SRMM, etc.). */
  initialOtherTab?: string;
}

const STATEMENT_ORDER = ['Profit & Loss', 'Balance Sheet', 'Cash Flow Statement', 'Notes'];
const THREE_LEVEL_STATEMENTS = new Set(['Balance Sheet']);
const OTHER_TABS = ['Going Concern', 'Management Override', 'SRMM Memos', 'Subsequent Events', 'Tax Technical', 'Permanent', 'Disclosure'] as const;
type OtherTab = typeof OTHER_TABS[number];

// Statutory format order by framework
// Each framework may have different terminology and ordering
const FRAMEWORK_ORDERS: Record<string, Record<string, string[]>> = {
  // FRS102 / UK Companies Act format
  FRS102: {
    'Profit & Loss': [
      'Revenue', 'Turnover', 'Sales', 'Income', 'Fees',
      'Cost of Sales', 'Cost of Goods Sold',
      'Gross Profit',
      'Distribution Costs',
      'Administrative Expenses', 'Admin Expenses', 'Overheads',
      'Staff Costs', 'Employee Costs',
      'Depreciation', 'Amortisation',
      'Other Operating Income', 'Other Income',
      'Operating Profit',
      'Interest Receivable', 'Interest Income',
      'Interest Payable', 'Interest', 'Finance Costs',
      'Profit Before Tax', 'Profit on Ordinary Activities',
      'Taxation', 'Tax', 'Corporation Tax',
      'Profit After Tax', 'Net Profit',
      'Dividends',
      'Retained Profit', 'Retained Earnings',
    ],
    'Balance Sheet': [
      'Intangible Fixed Assets', 'Intangible Assets', 'Goodwill',
      'Tangible Fixed Assets', 'Fixed Assets', 'Property Plant and Equipment',
      'Investments', 'Fixed Asset Investments',
      'Stock', 'Inventories',
      'Debtors', 'Trade Debtors', 'Trade and Other Receivables', 'Receivables',
      'Cash at Bank', 'Cash', 'Cash and Cash Equivalents', 'Bank',
      'Creditors Due Within One Year', 'Current Liabilities',
      'Creditors', 'Trade Creditors', 'Trade and Other Payables', 'Payables',
      'Net Current Assets',
      'Creditors Due After One Year', 'Long Term Liabilities',
      'Loans & Borrowings', 'Loans', 'Bank Loans',
      'Provisions', 'Provisions for Liabilities',
      'Net Assets',
      'Capital & Reserves', 'Share Capital', 'Called Up Share Capital',
      'Share Premium', 'Revaluation Reserve',
      'Profit and Loss Account', 'Retained Earnings', 'Reserves',
    ],
    'Cash Flow Statement': [
      'Operating Activities', 'Cash from Operations',
      'Investing Activities', 'Cash from Investing',
      'Financing Activities', 'Cash from Financing',
      'Net Change in Cash',
    ],
  },
  // IFRS format — uses different terminology
  IFRS: {
    'Profit & Loss': [
      'Revenue',
      'Cost of Sales',
      'Gross Profit',
      'Other Income',
      'Distribution Costs',
      'Administrative Expenses', 'General and Administrative',
      'Employee Benefits', 'Staff Costs',
      'Depreciation and Amortisation', 'Depreciation', 'Amortisation',
      'Impairment Losses',
      'Other Expenses',
      'Operating Profit', 'Results from Operating Activities',
      'Finance Income', 'Interest Income',
      'Finance Costs', 'Interest Expense',
      'Share of Profit of Associates',
      'Profit Before Tax',
      'Income Tax Expense', 'Taxation',
      'Profit for the Year', 'Net Profit',
      'Other Comprehensive Income',
      'Total Comprehensive Income',
    ],
    'Balance Sheet': [
      'Goodwill', 'Intangible Assets',
      'Property Plant and Equipment', 'Right of Use Assets',
      'Investment Property',
      'Investments in Associates',
      'Deferred Tax Assets',
      'Inventories', 'Stock',
      'Trade and Other Receivables', 'Debtors', 'Receivables',
      'Contract Assets',
      'Cash and Cash Equivalents', 'Cash',
      'Assets Held for Sale',
      'Trade and Other Payables', 'Creditors', 'Payables',
      'Contract Liabilities',
      'Current Tax Liabilities',
      'Borrowings', 'Loans',
      'Lease Liabilities',
      'Deferred Tax Liabilities',
      'Provisions',
      'Net Assets',
      'Share Capital', 'Issued Capital',
      'Share Premium',
      'Retained Earnings', 'Reserves',
      'Non-controlling Interests',
    ],
    'Cash Flow Statement': [
      'Cash from Operating Activities', 'Operating Activities',
      'Cash from Investing Activities', 'Investing Activities',
      'Cash from Financing Activities', 'Financing Activities',
      'Net Increase in Cash',
    ],
  },
  // FRS105 — micro-entity, simplified
  FRS105: {
    'Profit & Loss': [
      'Turnover', 'Revenue', 'Sales',
      'Cost of Sales',
      'Gross Profit',
      'Administrative Expenses', 'Overheads',
      'Staff Costs',
      'Depreciation',
      'Other Charges',
      'Tax',
      'Profit After Tax',
    ],
    'Balance Sheet': [
      'Fixed Assets',
      'Current Assets',
      'Cash at Bank', 'Cash',
      'Debtors',
      'Creditors Due Within One Year',
      'Net Current Assets',
      'Creditors Due After One Year',
      'Net Assets',
      'Capital and Reserves',
    ],
  },
};

// FRS101 uses IFRS presentation with UK Companies Act disclosure
FRAMEWORK_ORDERS['FRS101'] = FRAMEWORK_ORDERS['IFRS'];

function getStatutoryPosition(framework: string, statement: string, levelName: string): number {
  // Try specific framework first, then FRS102 as default
  const fwOrder = FRAMEWORK_ORDERS[framework] || FRAMEWORK_ORDERS['FRS102'];
  const order = fwOrder?.[statement] || [];
  const lc = levelName.toLowerCase();
  for (let i = 0; i < order.length; i++) {
    const item = order[i].toLowerCase();
    if (item === lc || lc.includes(item) || item.includes(lc)) return i;
  }
  return 9999;
}
// Statements that use 2-level only (Statement > Level, notes listed inline)
// P&L, Cash Flow, Notes all use 2-level

function fmtAmount(v: number | null | undefined): string {
  if (v == null) return '';
  const n = Number(v);
  if (isNaN(n)) return '';
  return `£${Math.abs(n).toLocaleString('en-GB', { minimumFractionDigits: 2 })}${n < 0 ? ' Cr' : ' Dr'}`;
}

// Dr/Cr offset: renders into the correct column. Use DrCell for debit, CrCell for credit.
function DrCell({ value, className = '' }: { value: number | null | undefined; className?: string }) {
  if (value == null) return <span></span>;
  const n = Number(value);
  if (isNaN(n) || n <= 0) return <span></span>;
  return <span className={`font-mono text-[10px] ${className}`}>{n.toLocaleString('en-GB', { minimumFractionDigits: 0 })}</span>;
}
function CrCell({ value, className = '' }: { value: number | null | undefined; className?: string }) {
  if (value == null) return <span></span>;
  const n = Number(value);
  if (isNaN(n) || n >= 0) return <span></span>;
  return <span className={`font-mono text-[10px] ${className}`}>({Math.abs(n).toLocaleString('en-GB', { minimumFractionDigits: 0 })})</span>;
}
// Legacy single-column for merged rows etc
function AmountCell({ value, className = '' }: { value: number | null | undefined; className?: string }) {
  if (value == null) return <span></span>;
  const n = Number(value);
  if (isNaN(n)) return <span></span>;
  const isCr = n < 0;
  return (
    <span className={`font-mono text-[10px] ${isCr ? '' : ''} ${className}`}>
      {isCr ? `(${Math.abs(n).toLocaleString('en-GB', { minimumFractionDigits: 0 })})` : n.toLocaleString('en-GB', { minimumFractionDigits: 0 })}
    </span>
  );
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function dayBefore(d: string | null | undefined): string {
  if (!d) return '';
  const dt = new Date(d);
  dt.setDate(dt.getDate() - 1);
  return dt.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// Common aliases for FS line name matching (TB category → FS Line name)
const FS_LINE_ALIASES: Record<string, string[]> = {
  'cash and bank': ['cash and cash equivalents', 'cash at bank', 'bank', 'cash & bank', 'cash'],
  'cash and cash equivalents': ['cash and bank', 'cash at bank', 'bank', 'cash & bank', 'cash'],
  'cash at bank': ['cash and bank', 'cash and cash equivalents', 'bank', 'cash & bank', 'cash'],
  'fixed assets': ['property plant and equipment', 'ppe', 'tangible assets', 'tangible fixed assets', 'non-current assets'],
  'tangible fixed assets': ['fixed assets', 'property plant and equipment', 'ppe'],
  'current assets': ['other current assets', 'debtors', 'receivables'],
  'debtors': ['current assets', 'receivables', 'trade debtors'],
  'current liabilities': ['creditors', 'payables', 'other current liabilities'],
  'creditors': ['current liabilities', 'payables', 'trade creditors'],
  'long term liabilities': ['non-current liabilities', 'long-term liabilities', 'borrowings'],
  'cost of sales': ['cost of goods sold', 'cogs', 'direct costs'],
  'administrative expenses': ['overheads', 'admin expenses', 'operating expenses'],
  'stock': ['inventory', 'inventories'],
  'inventory': ['stock', 'inventories'],
  'capital & reserves': ['equity', 'share capital', 'shareholders funds'],
  'equity': ['capital & reserves', 'shareholders funds'],
};

export function AuditPlanPanel({ engagementId, clientId, periodId, onClose, periodEndDate, periodStartDate, initialStatement, initialLevel, initialOtherTab }: Props) {
  const [tbRows, setTbRows] = useState<TBRow[]>([]);
  const [rmmItems, setRmmItems] = useState<RMMItem[]>([]);
  const [allocations, setAllocations] = useState<AllocationEntry[]>([]);

  // Plan Customiser — per-engagement N/A overrides + custom tests.
  // Keyed by `${testId}__${fsLineId}` for overrides; custom tests carry
  // their own unique ids.
  const [planCustomiser, setPlanCustomiser] = useState<{
    overrides: Record<string, { status: 'na'; reasonCategory: string; reason: string; setBy: { id: string; name: string }; setAt: string }>;
    customTests: Array<{
      id: string;
      name: string;
      description: string;
      fsLineId: string;
      fsLineName?: string;
      fsNote?: string;
      testTypeCode: string;
      assertions: string[];
      framework: string;
      createdBy: { id: string; name: string };
      createdAt: string;
    }>;
  }>({ overrides: {}, customTests: [] });
  const [planCustomiserOpen, setPlanCustomiserOpen] = useState(false);
  const [planCustomiserContext, setPlanCustomiserContext] = useState<{ fsLineId: string; fsLineName: string } | null>(null);
  const [fsLinesList, setFsLinesList] = useState<FsLineEntry[]>([]);
  const [testTypes, setTestTypes] = useState<TestType[]>([]);
  const [loading, setLoading] = useState(true);
  // Deep-scroll to audit-plan-<accountCode> or audit-plan-<fsLine> when
  // navigated to from the Completion panel's AI Populate reference chips.
  useScrollToAnchor([loading, tbRows.length], { enabled: !loading });
  const [activeStatement, setActiveStatement] = useState('');
  const [activeLevel, setActiveLevel] = useState('');
  const [activeNote, setActiveNote] = useState('');
  const [activeOtherTab, setActiveOtherTab] = useState<OtherTab | ''>('');
  const [framework, setFramework] = useState('');
  const [expandedRmm, setExpandedRmm] = useState<Set<string>>(new Set());
  const [excludedTests, setExcludedTests] = useState<Set<string>>(new Set());
  // Per-test data source — where the auditor expects the evidence
  // for this test to come from. Drives nothing behaviour-wise yet
  // (no automatic ingest swap), but the dropdown/indent on each row
  // makes the planning decision visible and reviewable. Persisted
  // to localStorage per engagement so the choice survives reloads
  // without a backend change.
  type DataSource = 'gl' | 'mgmt' | 'tp';
  const dataSourceStorageKey = `audit-plan-data-sources:${engagementId}`;
  const [testDataSources, setTestDataSources] = useState<Record<string, DataSource>>(() => {
    if (typeof window === 'undefined') return {};
    try {
      const raw = window.localStorage.getItem(dataSourceStorageKey);
      return raw ? (JSON.parse(raw) as Record<string, DataSource>) : {};
    } catch { return {}; }
  });
  function setTestDataSource(testKey: string, source: DataSource) {
    setTestDataSources(prev => {
      const next = { ...prev, [testKey]: source };
      try { window.localStorage.setItem(dataSourceStorageKey, JSON.stringify(next)); } catch {}
      return next;
    });
  }
  // Multiple test execution panels can be open at once. Switching from
  // a single id to a Set so clicking Execute on one test no longer
  // unmounts the panel for another — each TestExecutionPanel polls
  // its own execution independently, and the server-side runs are
  // unaffected by the panel mount/unmount anyway, but the UX read as
  // "it stopped" because the panel disappeared.
  const [activeExecutions, setActiveExecutions] = useState<Set<string>>(new Set());
  const [autoStartKeys, setAutoStartKeys] = useState<Set<string>>(new Set());
  const [testConclusions, setTestConclusions] = useState<Record<string, 'green' | 'orange' | 'red' | 'failed' | 'pending'>>({});
  const [riskClassificationTable, setRiskClassificationTable] = useState<Record<string, string> | null>(null);
  const [performanceMateriality, setPerformanceMateriality] = useState(0);
  const [dbConclusions, setDbConclusions] = useState<any[]>([]);
  const [dbExecutions, setDbExecutions] = useState<any[]>([]);
  // "Run all" progress. null = idle. While set, the header button is
  // disabled and shows progress; a polling interval refreshes
  // dbExecutions every few seconds so the conclusion dots update
  // without the user having to refresh.
  const [runAllProgress, setRunAllProgress] = useState<{ started: number; total: number; failed: number } | null>(null);
  const [errorFooterOpen, setErrorFooterOpen] = useState(true);
  const [selectedForMerge, setSelectedForMerge] = useState<Set<string>>(new Set());
  const [merging, setMerging] = useState(false);
  const [flowViewerExec, setFlowViewerExec] = useState<{ id: string; testDescription: string } | null>(null);
  const [showErrorSchedule, setShowErrorSchedule] = useState(false);
  const [vatReconcOpen, setVatReconcOpen] = useState(false);

  function toggleMergeSelect(rowId: string) {
    setSelectedForMerge(prev => {
      const next = new Set(prev);
      next.has(rowId) ? next.delete(rowId) : next.add(rowId);
      return next;
    });
  }

  async function handleMerge() {
    if (selectedForMerge.size < 2) return;
    setMerging(true);
    const rowIds = Array.from(selectedForMerge);
    const mergedCode = `MERGED_${activeLevel?.replace(/\s+/g, '_').toUpperCase() || 'GRP'}_${Date.now().toString(36).slice(-4)}`;
    try {
      const res = await fetch(`/api/engagements/${engagementId}/trial-balance`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'merge', rowIds, mergedCode }),
      });
      if (res.ok) {
        const data = await res.json();
        setTbRows(data.rows || []);
        setSelectedForMerge(new Set());
      }
    } finally { setMerging(false); }
  }

  async function handleUnmerge(mergedCode: string) {
    setMerging(true);
    const rowIds = tbRows.filter(r => r.accountCode === mergedCode && r.originalAccountCode).map(r => r.id);
    try {
      const res = await fetch(`/api/engagements/${engagementId}/trial-balance`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'unmerge', rowIds }),
      });
      if (res.ok) {
        const data = await res.json();
        setTbRows(data.rows || []);
      }
    } finally { setMerging(false); }
  }

  function toggleTestApplicable(testKey: string) {
    setExcludedTests(prev => {
      const next = new Set(prev);
      next.has(testKey) ? next.delete(testKey) : next.add(testKey);
      return next;
    });
  }

  // Refetch the executions + conclusions lists so the conclusion dots
  // pick up runs started in the background. Returns the latest
  // executions array (rather than relying on the state setter
  // immediately) so the run-all poller can check stop conditions
  // without racing the React render cycle.
  async function refreshExecutionsAndConclusions(): Promise<any[]> {
    let latestExecutions: any[] = [];
    try {
      const [execRes, concRes] = await Promise.all([
        fetch(`/api/engagements/${engagementId}/test-execution?lite=true`),
        fetch(`/api/engagements/${engagementId}/test-conclusions`),
      ]);
      if (execRes.ok) {
        const data = await execRes.json();
        latestExecutions = data.executions || [];
        setDbExecutions(latestExecutions);
      }
      if (concRes.ok) {
        const data = await concRes.json();
        setDbConclusions(data.conclusions || []);
      }
    } catch { /* polling — silently leave previous state */ }
    return latestExecutions;
  }

  // Launch every pending test in the current tab in parallel. Each
  // POST returns immediately with an executionId; the actual work
  // runs server-side, so kicking off N tests doesn't tie up the
  // browser. Once all start requests resolve, poll the executions
  // list every 5s until everything's reached a terminal state (or 5
  // minutes elapse, to avoid forever-polling on a stuck run).
  async function runAllPending() {
    const targets = pendingExecutions;
    if (targets.length === 0) return;
    setRunAllProgress({ started: 0, total: targets.length, failed: 0 });

    let started = 0;
    let failed = 0;
    await Promise.allSettled(targets.map(async ({ row, test, fsLine, fsLineId }) => {
      try {
        const res = await fetch(`/api/engagements/${engagementId}/test-execution`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fsLine,
            fsLineId,
            testDescription: test.description,
            testTypeCode: test.testTypeCode,
            flowData: (test as any).flow || null,
            tbRow: {
              accountCode: row.accountCode,
              description: row.description,
              currentYear: row.currentYear,
              priorYear: row.priorYear,
              fsNote: row.fsNoteLevel,
            },
          }),
        });
        if (res.ok) started++; else failed++;
      } catch { failed++; }
      setRunAllProgress(prev => prev ? { ...prev, started, failed } : null);
    }));

    // First refresh after all start requests resolved.
    await refreshExecutionsAndConclusions();

    // Background poller — keeps the conclusion dots fresh while runs
    // complete. Stops when no executions remain in 'running' or
    // 'paused' state, or after 5 minutes (whichever first). Reads
    // the fresh executions from the refresh's return value to avoid
    // a stale-closure bug on dbExecutions.
    const pollStart = Date.now();
    const MAX_POLL_MS = 5 * 60 * 1000;
    const interval = setInterval(async () => {
      if (Date.now() - pollStart > MAX_POLL_MS) {
        clearInterval(interval);
        setRunAllProgress(null);
        return;
      }
      const latest = await refreshExecutionsAndConclusions();
      const stillRunning = latest.some(e => e.status === 'running' || e.status === 'paused');
      if (!stillRunning) {
        clearInterval(interval);
        setRunAllProgress(null);
      }
    }, 5000);
  }

  useEffect(() => {
    async function load() {
      try {
        const [tbRes, rmmRes, allocRes, ttRes, pfRes, concRes, rcRes, execRes, matRes, pcRes] = await Promise.all([
          fetch(`/api/engagements/${engagementId}/trial-balance`),
          fetch(`/api/engagements/${engagementId}/rmm`),
          fetch(`/api/engagements/${engagementId}/test-allocations`),
          fetch('/api/methodology-admin/test-types'),
          fetch(`/api/engagements/${engagementId}/permanent-file`),
          fetch(`/api/engagements/${engagementId}/test-conclusions`),
          fetch('/api/methodology-admin/risk-tables?tableType=riskClassification'),
          // Lite mode skips the heavy nodeRuns payload — we only need summary
          // fields + status here, so this is 10-100x faster on mature engagements.
          fetch(`/api/engagements/${engagementId}/test-execution?lite=true`),
          fetch(`/api/engagements/${engagementId}/materiality`),
          fetch(`/api/engagements/${engagementId}/plan-customiser`),
        ]);
        if (tbRes.ok) setTbRows((await tbRes.json()).rows || []);
        if (rmmRes.ok) {
          setRmmItems(((await rmmRes.json()).rows || []).map((r: any) => ({
            lineItem: r.lineItem, riskIdentified: r.riskIdentified, overallRisk: r.overallRisk || r.finalRiskAssessment,
            amount: r.amount, assertions: r.assertions || [], notes: r.notes,
            fsStatement: r.fsStatement || null, fsLevel: r.fsLevel || null, fsNote: r.fsNote || null,
          })));
        }
        if (allocRes.ok) {
          const allocData = await allocRes.json();
          setAllocations(allocData.allocations || []);
          setFsLinesList(allocData.fsLines || []);
        }
        if (ttRes.ok) {
          const ttData = await ttRes.json();
          setTestTypes(ttData.types || ttData.testTypes || []);
        }
        // Get accounting framework from permanent file answers
        if (pfRes.ok) {
          const pfData = await pfRes.json();
          const answers = pfData.answers || pfData.data || {};
          // Find the framework answer — look for key containing 'applicable financial reporting'
          for (const [key, val] of Object.entries(answers)) {
            if (typeof val === 'string' && key.toLowerCase().includes('applicable financial reporting')) {
              setFramework(val);
              break;
            }
          }
          // Also check nested format
          if (!framework && Array.isArray(pfData.sections)) {
            for (const section of pfData.sections) {
              for (const answer of section.answers || []) {
                if (answer.questionText?.toLowerCase().includes('applicable financial reporting') && answer.value) {
                  setFramework(answer.value);
                }
              }
            }
          }
        }
        // Load persisted conclusions
        if (concRes.ok) {
          const concData = await concRes.json();
          const conclusions = concData.conclusions || [];
          setDbConclusions(conclusions);
          // Populate testConclusions state from DB
          const conc: Record<string, 'green' | 'orange' | 'red' | 'failed' | 'pending'> = {};
          for (const c of conclusions) {
            const key = c.testDescription;
            if (c.conclusion) conc[key] = c.conclusion;
          }
          setTestConclusions(conc);
        }
        // Load executions (to show results for tests that ran but have no conclusion record)
        if (execRes.ok) {
          const execData = await execRes.json();
          setDbExecutions(execData.executions || []);
          // For completed executions without a conclusion, mark them as 'green' (no errors found by default)
          const execConcs: Record<string, 'green' | 'orange' | 'red' | 'failed' | 'pending'> = {};
          for (const exec of (execData.executions || [])) {
            if (exec.status === 'completed' && !testConclusions[exec.testDescription]) {
              execConcs[exec.testDescription] = 'green'; // Default: completed without errors = green
            } else if (exec.status === 'failed') {
              execConcs[exec.testDescription] = 'failed';
            }
          }
          setTestConclusions(prev => ({ ...execConcs, ...prev })); // Existing conclusions override exec defaults
        }
        // Load risk classification table
        if (rcRes.ok) {
          const rcData = await rcRes.json();
          if (rcData.table?.data) setRiskClassificationTable(rcData.table.data);
        }
        // Load performance materiality
        if (matRes.ok) {
          const matData = await matRes.json();
          const pm = matData.materiality?.performanceMateriality || matData.performanceMateriality || 0;
          setPerformanceMateriality(Number(pm) || 0);
        }
        if (pcRes.ok) {
          const pcData = await pcRes.json();
          setPlanCustomiser(pcData.data || { overrides: {}, customTests: [] });
        }
      } catch (err) { console.error('Failed to load:', err); }
      setLoading(false);
    }
    load();
  }, [engagementId]);

  // Assertion aliases for matching abbreviated RMM assertions to full test assertions
  const ASSERTION_ALIASES: Record<string, string[]> = {
    'completeness': ['com', 'comp', 'completeness'],
    'occurrence': ['occ', 'occur', 'occurrence', 'o&a', 'occurrence & accuracy'],
    'accuracy': ['acc', 'accuracy', 'o&a', 'occurrence & accuracy'],
    'cut off': ['cut', 'cutoff', 'cut off', 'cut-off'],
    'classification': ['cla', 'class', 'classification'],
    'presentation': ['pre', 'pres', 'presentation'],
    'existence': ['exi', 'exist', 'existence'],
    'valuation': ['val', 'valuation'],
    'rights & obligations': ['r&o', 'rig', 'rights', 'rights & obligations', 'rights and obligations', 'obligations'],
  };

  function assertionMatches(testAssertions: string[] | null, rowAssertions: string[] | null): boolean {
    if (!rowAssertions || rowAssertions.length === 0) return true; // No assertions on row = show all tests
    if (!testAssertions || testAssertions.length === 0) return true; // Test has no assertion filter = applies to all

    return testAssertions.some(ta => {
      const testAss = ta.toLowerCase().trim();
      const testAliases = Object.entries(ASSERTION_ALIASES)
        .filter(([, aliases]) => aliases.some(a => a === testAss || testAss.includes(a) || a.includes(testAss)))
        .flatMap(([, aliases]) => aliases);

      return rowAssertions.some(ra => {
        const rowAss = ra.toLowerCase().trim();
        if (testAss.includes(rowAss) || rowAss.includes(testAss)) return true;
        return testAliases.some(alias => alias === rowAss || rowAss.includes(alias) || alias.includes(rowAss));
      });
    });
  }

  // Find tests for a row — uses TBCYvPY fsLevel/fsNote mapping to look up allocated tests.
  // The TB row's fsLevel is the key — set via AI Classification or manually in TBCYvPY.
  function getTestsForRow(fsLevel: string | null, fsNote: string | null, desc: string, assertions: string[] | null, statement?: string, riskClassification?: string | null): { description: string; testTypeCode: string; assertion?: string; assertions?: string[]; framework?: string; color: string; typeName: string; flow?: any; executionDef?: any; isIngest?: boolean; outputFormat?: string | null }[] {
    // Build list of FS Line names to search — canonical mapped name + raw + fsNote
    const names = new Set<string>();
    if (fsLevel) {
      names.add(fsLevel.toLowerCase().trim());
      const canon = fsLevelMap[fsLevel];
      if (canon) names.add(canon.toLowerCase().trim());
    }
    if (fsNote) names.add(fsNote.toLowerCase().trim());

    // Find matching FS Line IDs by name (direct lookup from firm taxonomy)
    const matchingFsLineIds = new Set<string>();
    for (const fl of fsLinesList) {
      if (names.has(fl.name.toLowerCase().trim())) {
        matchingFsLineIds.add(fl.id);
      }
    }

    // If no direct match, try aliases as fallback
    if (matchingFsLineIds.size === 0 && names.size > 0) {
      for (const fl of fsLinesList) {
        const flName = fl.name.toLowerCase().trim();
        for (const term of names) {
          const aliases = FS_LINE_ALIASES[term] || [];
          const reverseAliases = FS_LINE_ALIASES[flName] || [];
          if (aliases.includes(flName) || reverseAliases.includes(term)) {
            matchingFsLineIds.add(fl.id);
            break;
          }
        }
      }
    }

    // Get all tests allocated to the matched FS Lines, skipping:
    //  - draft tests (defence in depth — the API already filters these but
    //    we double-check on the client so legacy cached responses can't
    //    leak drafts into the audit plan)
    //  - tests the auditor has marked N/A for this engagement via the
    //    Plan Customiser
    const matchedTestsMap = new Map<string, { test: AllocationEntry['test']; fsLineId: string }>();
    for (const a of allocations) {
      if (!a.test) continue; // Guard against deleted tests
      if (a.test.isDraft) continue; // Drafts never appear in the audit plan
      if (!matchingFsLineIds.has(a.fsLineId)) continue;
      const overrideKey = `${a.test.id}__${a.fsLineId}`;
      if (planCustomiser.overrides[overrideKey]?.status === 'na') continue;
      if (!matchedTestsMap.has(a.test.id)) {
        matchedTestsMap.set(a.test.id, { test: a.test, fsLineId: a.fsLineId });
      }
    }

    // Include engagement-specific custom tests from the Plan Customiser that
    // target any of the matched FS Lines. Custom tests bypass the firm-wide
    // allocation path entirely.
    const customForRow: Array<{ test: AllocationEntry['test'] & { category?: string }; fsLineId: string }> = [];
    for (const ct of planCustomiser.customTests) {
      if (!matchingFsLineIds.has(ct.fsLineId)) continue;
      customForRow.push({
        test: {
          id: ct.id,
          name: ct.name,
          description: ct.description || null,
          testTypeCode: ct.testTypeCode,
          assertions: ct.assertions || [],
          framework: ct.framework,
          significantRisk: false,
          flow: null,
          category: 'Normal',
          // Forward outputFormat so the audit plan render picks the
          // right workspace (spreadsheet, document_summary, etc.)
          // when the auditor opens this custom test. Without this
          // every custom test fell through to the default
          // three-section workspace regardless of what the Plan
          // Customiser dropdown said.
          outputFormat: (ct as any).outputFormat || null,
        } as any,
        fsLineId: ct.fsLineId,
      });
    }

    const result: { description: string; testTypeCode: string; assertion?: string; assertions?: string[]; framework?: string; color: string; typeName: string; flow?: any; executionDef?: any; isIngest?: boolean; outputFormat?: string | null; isCustom?: boolean }[] = [];

    const allForRow = [
      ...Array.from(matchedTestsMap.values()).map(v => ({ ...v, isCustom: false })),
      ...customForRow.map(v => ({ ...v, isCustom: true })),
    ];
    for (const { test, isCustom } of allForRow) {
      if (!test || !test.name) continue; // Skip tests without names
      if (test.framework && framework && test.framework.toLowerCase() !== framework.toLowerCase() && test.framework !== 'ALL') continue;
      if (!assertionMatches(test.assertions as string[] | null, assertions)) continue;

      // Risk-based filtering using the firm-defined Test Classification mapping
      // (see Firm Wide Assumptions → Risk Classification table → Test Classification column):
      // - AR              → Analytical Review only
      // - Normal          → Normal only
      // - Area of Focus   → Area of Focus + Normal
      // - Significant Risk → Significant Risk + Normal
      // Mandatory tests are always allowed regardless of classification.
      const testCategory = (test as any).category || (test.significantRisk ? 'Significant Risk' : 'Normal');
      const allowedCategories: string[] =
        riskClassification === 'AR' ? ['Analytical Review', 'Mandatory'] :
        riskClassification === 'Normal' ? ['Normal', 'Mandatory'] :
        riskClassification === 'Area of Focus' ? ['Area of Focus', 'Normal', 'Mandatory'] :
        riskClassification === 'Significant Risk' ? ['Significant Risk', 'Normal', 'Mandatory'] :
        ['Normal', 'Mandatory']; // safe default if classification missing
      if (!allowedCategories.includes(testCategory)) continue;

      const tt = testTypes.find(t => t.code === test.testTypeCode);
      const color = TEST_TYPE_COLORS[tt?.actionType || ''] || 'bg-slate-100 text-slate-600 border-slate-200';
      result.push({
        description: test.name || `Test ${test.id?.slice(0, 8) || 'unknown'}`,
        testTypeCode: test.testTypeCode,
        assertions: (test.assertions as string[]) || [],
        assertion: ((test.assertions as string[]) || [])[0] || '',
        framework: test.framework,
        color: (test as any).isIngest ? 'bg-slate-100 text-slate-400 border-slate-200' : color,
        typeName: (test as any).isIngest ? 'Ingest' : (tt?.name || test.testTypeCode),
        flow: test.flow,
        executionDef: tt?.executionDef,
        isIngest: (test as any).isIngest || false,
        outputFormat: (test as any).outputFormat || undefined,
        isCustom,
      });
    }
    return result;
  }


  function toggleRmmExpand(id: string) {
    setExpandedRmm(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const significantRiskItems = useMemo(() => {
    return new Set(rmmItems.filter(r => r.overallRisk === 'High' || r.overallRisk === 'Very High').map(r => r.lineItem));
  }, [rmmItems]);

  // Include Cash Flow if framework is IFRS/FRS101/FRS102
  const requiresCashFlow = ['IFRS', 'FRS101', 'FRS102'].includes(framework);

  const statements = useMemo(() => {
    const set = new Set<string>();
    for (const row of tbRows) { if (row.fsStatement) set.add(row.fsStatement); }
    // Always include Cash Flow for relevant frameworks even if no TB rows tagged
    if (requiresCashFlow) set.add('Cash Flow Statement');
    return STATEMENT_ORDER.filter(s => set.has(s)).concat(Array.from(set).filter(s => !STATEMENT_ORDER.includes(s)));
  }, [tbRows, requiresCashFlow]);

  // Map TB fsLevel values to the firm's canonical FS Line names.
  // Uses keyword overlap to match e.g. "Cash at Bank" → "Cash and Cash Equivalents"
  const fsLevelMap = useMemo(() => {
    const map: Record<string, string> = {};
    const stopWords = new Set(['and', 'at', 'the', 'of', 'in', '&']);
    function keywords(s: string): Set<string> {
      return new Set(s.toLowerCase().split(/[\s\-\/]+/).filter(w => w.length > 1 && !stopWords.has(w)));
    }
    function overlapScore(a: Set<string>, b: Set<string>): number {
      let overlap = 0;
      for (const w of a) if (b.has(w)) overlap++;
      return overlap === 0 ? 0 : overlap / Math.max(a.size, b.size);
    }

    for (const row of tbRows) {
      if (!row.fsLevel || map[row.fsLevel]) continue;
      const lower = row.fsLevel.toLowerCase().trim();
      // Exact match first
      const exact = fsLinesList.find(fl => fl.name.toLowerCase().trim() === lower);
      if (exact) { map[row.fsLevel] = exact.name; continue; }
      // Keyword overlap — find best match
      const rowKw = keywords(row.fsLevel);
      let bestMatch = '';
      let bestScore = 0;
      for (const fl of fsLinesList) {
        const flKw = keywords(fl.name);
        const score = overlapScore(rowKw, flKw);
        if (score > bestScore) { bestScore = score; bestMatch = fl.name; }
      }
      // Accept if at least 50% keyword overlap
      if (bestScore >= 0.5 && bestMatch) { map[row.fsLevel] = bestMatch; continue; }
      // Check aliases from FS_LINE_ALIASES
      const aliasMatch = fsLinesList.find(fl => {
        const aliases = FS_LINE_ALIASES[lower] || [];
        return aliases.includes(fl.name.toLowerCase().trim());
      });
      if (aliasMatch) { map[row.fsLevel] = aliasMatch.name; continue; }
      // No match — use as-is
      map[row.fsLevel] = row.fsLevel;
    }
    return map;
  }, [tbRows, fsLinesList]);

  // Get the canonical FS Level for a TB row
  function canonicalLevel(row: { fsLevel?: string | null }): string {
    return row.fsLevel ? (fsLevelMap[row.fsLevel] || row.fsLevel) : '';
  }

  const levels = useMemo(() => {
    if (!activeStatement) return [];
    const levelAmounts: Record<string, number> = {};
    for (const row of tbRows) {
      if (row.fsStatement === activeStatement && row.fsLevel) {
        const canon = canonicalLevel(row);
        levelAmounts[canon] = (levelAmounts[canon] || 0) + Math.abs(Number(row.currentYear) || 0);
      }
    }
    // Only include levels with monetary value or significant risk, sorted by statutory order
    return Object.keys(levelAmounts)
      .filter(l => levelAmounts[l] > 0 || significantRiskItems.has(l))
      .sort((a, b) => getStatutoryPosition(framework || 'FRS102', activeStatement, a) - getStatutoryPosition(framework || 'FRS102', activeStatement, b));
  }, [tbRows, activeStatement, significantRiskItems, fsLevelMap]);

  // Notes — only for 3-level statements (Balance Sheet), filtered by value/risk
  const notes = useMemo(() => {
    if (!activeLevel || !THREE_LEVEL_STATEMENTS.has(activeStatement)) return [];
    const noteAmounts: Record<string, number> = {};
    for (const row of tbRows) {
      if (row.fsStatement === activeStatement && canonicalLevel(row) === activeLevel && row.fsNoteLevel) {
        noteAmounts[row.fsNoteLevel] = (noteAmounts[row.fsNoteLevel] || 0) + Math.abs(Number(row.currentYear) || 0);
      }
    }
    return Object.keys(noteAmounts)
      .filter(n => noteAmounts[n] > 0 || significantRiskItems.has(n))
      .sort((a, b) => getStatutoryPosition(framework || 'FRS102', activeStatement, a) - getStatutoryPosition(framework || 'FRS102', activeStatement, b));
  }, [tbRows, activeStatement, activeLevel, significantRiskItems, framework, fsLevelMap]);

  const filteredRows = useMemo(() => {
    return tbRows.filter(row => {
      if (row.fsStatement !== activeStatement) return false;
      if (activeLevel && row.fsLevel && canonicalLevel(row) !== activeLevel) return false;
      if (activeNote && row.fsNoteLevel && row.fsNoteLevel !== activeNote) return false;
      // Must have monetary value (CY or PY non-zero)
      const cy = Number(row.currentYear) || 0;
      const py = Number(row.priorYear) || 0;
      if (cy === 0 && py === 0) return false;
      return true;
    });
  }, [tbRows, activeStatement, activeLevel, activeNote]);

  // Tests visible in the current tab, ready to be POSTed to the
  // /test-execution endpoint. Mirrors the per-row matching logic from
  // the render loop below — copying it here is duplication, but the
  // alternative (a structural refactor of the 70-line per-row block)
  // would touch a lot more code. Skips ingest tests + payroll
  // workpaper format (those are launched through different panels)
  // and skips anything the user has marked not-applicable.
  const visibleTestExecutions = useMemo(() => {
    const out: Array<{
      row: any; test: any; testKey: string;
      fsLine: string; fsLineId: string | null;
    }> = [];
    for (const row of filteredRows) {
      if (!row) continue;
      const rowDesc = (row.description || '').toLowerCase().trim();
      const rowCode = (row.accountCode || '').toLowerCase().trim();
      const rowFsLevel = (row.fsLevel || '').toLowerCase().trim();
      const canonRowLevel = (canonicalLevel(row) || '').toLowerCase().trim();
      const activeLevelLower = (activeLevel || '').toLowerCase().trim();

      const rmmMatches = rmmItems.filter(r => {
        const li = r.lineItem.toLowerCase().trim();
        if (li === rowDesc || li === rowCode) return true;
        if (li === rowFsLevel || li === canonRowLevel || li === activeLevelLower) return true;
        const rfl = (r.fsLevel || '').toLowerCase().trim();
        if (rfl && (rfl === rowFsLevel || rfl === canonRowLevel || rfl === activeLevelLower)) return true;
        return false;
      });
      const RISK_PRIORITY: Record<string, number> = { 'Very High': 0, 'High': 1, 'Medium': 2, 'Low': 3 };
      const rmmMatch = rmmMatches.length > 0
        ? rmmMatches.reduce((best, r) => (RISK_PRIORITY[r.overallRisk || ''] ?? 99) < (RISK_PRIORITY[best.overallRisk || ''] ?? 99) ? r : best)
        : null;
      const effectiveFsLevel = activeLevel || rmmMatch?.fsLevel || row.fsLevel;
      const effectiveFsNote = activeNote || rmmMatch?.fsNote || row.fsNoteLevel;
      const effectiveStatement = activeStatement || rmmMatch?.fsStatement;

      const rowValue = Math.abs(Number(row.currentYear) || 0);
      function classifyRisk(overallRisk: string | undefined): string {
        if (!overallRisk) return 'Normal';
        const mapped = riskClassificationTable?.[overallRisk];
        if (mapped) return mapped;
        if (overallRisk === 'High' || overallRisk === 'Very High') return 'Significant Risk';
        if (overallRisk === 'Medium') return 'Area of Focus';
        return 'Normal';
      }
      let rowClassification: string | null = null;
      if (rmmMatch) {
        rowClassification = classifyRisk(rmmMatch.overallRisk ?? undefined);
      } else if (performanceMateriality > 0 && rowValue > performanceMateriality) {
        rowClassification = 'Normal';
      } else if (performanceMateriality > 0) {
        rowClassification = 'AR';
      }

      let tests: ReturnType<typeof getTestsForRow>;
      if (rmmMatches.length > 0) {
        const seen = new Set<string>();
        tests = [];
        for (const rm of rmmMatches) {
          const rmClass = classifyRisk(rm.overallRisk ?? undefined);
          const rmTests = getTestsForRow(effectiveFsLevel, effectiveFsNote, row.description, rm.assertions || null, effectiveStatement || undefined, rmClass);
          for (const t of rmTests) {
            if (!seen.has(t.description)) { seen.add(t.description); tests.push(t); }
          }
        }
      } else {
        tests = getTestsForRow(effectiveFsLevel, effectiveFsNote, row.description, null, effectiveStatement || undefined, rowClassification);
      }

      const rowKey = row.id || row.accountCode;
      const fsLine = activeLevel || activeStatement;
      const fsLineId = (row as any).fsLineId || null;

      for (const test of tests) {
        const testKey = `${rowKey}::${test.description}`;
        if (excludedTests.has(testKey)) continue;
        if (test.isIngest) continue;
        if (test.outputFormat === 'payroll_workpaper') continue;
        out.push({ row, test, testKey, fsLine, fsLineId });
      }
    }
    return out;
  // getTestsForRow isn't wrapped in useCallback so this memo will
  // recompute on most renders, but the work is cheap (a few hundred
  // function calls in worst case) so leaving it as-is.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredRows, rmmItems, activeLevel, activeStatement, activeNote, riskClassificationTable, performanceMateriality, excludedTests]);

  // Tests in the current tab that haven't been started yet — the
  // Run All button only fires for these so existing runs aren't
  // duplicated. Re-running a single test via the per-row "Open"
  // workflow is still available.
  const pendingExecutions = useMemo(() => {
    return visibleTestExecutions.filter(({ test, fsLine }) => {
      const dbExec = dbExecutions.find(e =>
        e.testDescription === test.description && (e.fsLine === fsLine || !e.fsLine)
      );
      const dbConc = dbConclusions.find(c =>
        c.testDescription === test.description && (c.fsLine === fsLine || !c.fsLine)
      );
      return !dbExec && !dbConc;
    });
  }, [visibleTestExecutions, dbExecutions, dbConclusions]);

  useEffect(() => {
    // Deep-link path: when the host supplied an initial Statement /
    // Other-tab target, honour it on first render. Falls back to the
    // first available statement if the named target isn't present.
    if (initialOtherTab && (OTHER_TABS as readonly string[]).includes(initialOtherTab)) {
      setActiveOtherTab(initialOtherTab as OtherTab);
      setActiveStatement('');
      setActiveLevel('');
      setActiveNote('');
      return;
    }
    if (initialStatement && statements.includes(initialStatement) && !activeStatement) {
      setActiveStatement(initialStatement);
      setActiveOtherTab('');
      return;
    }
    if (statements.length > 0 && !activeStatement) setActiveStatement(statements[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statements, activeStatement, initialStatement, initialOtherTab]);

  // Tracks whether we've already consumed the initialLevel deep-link.
  // Once the user clicks any level (or moves to a different statement)
  // we stop honouring it so further statement changes default cleanly
  // to the first level in the new statement.
  const [initialLevelConsumed, setInitialLevelConsumed] = useState(false);
  useEffect(() => {
    if (
      !initialLevelConsumed &&
      initialLevel &&
      initialStatement &&
      activeStatement === initialStatement &&
      levels.includes(initialLevel)
    ) {
      setActiveLevel(initialLevel);
      setInitialLevelConsumed(true);
      setActiveNote('');
      return;
    }
    if (levels.length > 0) setActiveLevel(levels[0]); else setActiveLevel('');
    setActiveNote('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [levels]);

  useEffect(() => { setActiveNote(''); }, [activeLevel]);

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 text-blue-500 animate-spin" /></div>;

  if (statements.length === 0) {
    const hasRows = tbRows.length > 0;
    const unclassified = tbRows.filter(r => !r.fsStatement).length;
    return (
      <div className="text-center py-12">
        <FileText className="h-10 w-10 text-slate-300 mx-auto mb-3" />
        <p className="text-sm text-slate-500 font-medium">No FS Statement data found.</p>
        {hasRows && unclassified > 0 && (
          <p className="text-xs text-amber-600 mt-2">{unclassified} TB row{unclassified !== 1 ? 's' : ''} have not been classified yet. Go to TBCYvPY and run <strong>AI Classify All</strong> first.</p>
        )}
        {!hasRows && (
          <p className="text-xs text-slate-400 mt-2">Import a trial balance first, then run AI Classification.</p>
        )}
        <button onClick={onClose} className="mt-4 text-xs text-blue-600 hover:text-blue-800">&larr; Back to RMM</button>
      </div>
    );
  }

  const isThreeLevel = THREE_LEVEL_STATEMENTS.has(activeStatement);

  return (
    <div className="space-y-2">
      {/* Header — compact */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={onClose} className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1">
            <ArrowLeft className="h-3 w-3" /> Back to RMM
          </button>
          <h2 className="text-sm font-semibold text-slate-800">Audit Plan</h2>
          {framework && <span className="text-[9px] px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded">{framework}</span>}
        </div>
        <div className="flex items-center gap-2">
          {/* Run All Pending Tests — fires every visible, applicable,
              not-yet-run test in the current tab in parallel. Each
              POST returns immediately with an executionId; the work
              runs server-side so launching N tests doesn't block the
              browser. Disabled while a run-all is in flight or when
              there's nothing pending. */}
          <button
            onClick={() => void runAllPending()}
            disabled={!!runAllProgress || pendingExecutions.length === 0}
            className={`inline-flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-md border transition-colors ${
              runAllProgress
                ? 'border-blue-300 bg-blue-50 text-blue-700 cursor-progress'
                : pendingExecutions.length === 0
                  ? 'border-slate-200 text-slate-400 cursor-not-allowed'
                  : 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
            }`}
            title={
              pendingExecutions.length === 0
                ? 'All visible tests have already been run — use the per-test Open button to re-run'
                : 'Launch every pending test in this tab — each runs independently in the background'
            }
          >
            {runAllProgress
              ? <Loader2 className="h-3 w-3 animate-spin" />
              : <Play className="h-3 w-3" />}
            {runAllProgress
              ? `Running ${runAllProgress.started}/${runAllProgress.total}${runAllProgress.failed ? ` · ${runAllProgress.failed} failed to start` : ''}`
              : `Run All (${pendingExecutions.length})`}
          </button>
          <button onClick={() => setShowErrorSchedule(!showErrorSchedule)}
            className={`inline-flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-md border transition-colors ${
              showErrorSchedule ? 'bg-red-100 border-red-300 text-red-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}>
            <AlertTriangle className="h-3 w-3" />
            Error Schedule
          </button>
        </div>
      </div>

      {/* Level 1: FS Statement tabs + Other.
          flex-wrap so when there are too many tabs to fit a single
          row they wrap to a second row instead of forcing the user
          to scroll horizontally. gap-y-0.5 keeps wrapped rows tight
          but visually separated. */}
      <div className="flex flex-wrap gap-0.5 gap-y-0.5 border-b border-slate-200">
        {statements.map(stmt => (
          <button key={stmt}
            onClick={() => { setActiveStatement(stmt); setActiveLevel(''); setActiveNote(''); setActiveOtherTab(''); }}
            className={`px-3 py-1.5 text-[11px] font-medium border-b-2 whitespace-nowrap transition-colors ${
              activeStatement === stmt && !activeOtherTab ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}>
            {stmt}
          </button>
        ))}
        <div className="w-px bg-slate-300 mx-1.5 my-1" />
        <span className="px-1 py-1.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wide self-center">Other</span>
        {OTHER_TABS.map(tab => (
          <button key={tab}
            onClick={() => { setActiveOtherTab(tab); setActiveStatement(''); setActiveLevel(''); setActiveNote(''); }}
            className={`px-3 py-1.5 text-[11px] font-medium border-b-2 whitespace-nowrap transition-colors ${
              activeOtherTab === tab ? 'border-purple-600 text-purple-700' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}>
            {tab}
          </button>
        ))}
      </div>

      {/* ─── "Other" tab content ─── */}
      {activeOtherTab === 'Going Concern' && (
        <div className="p-6 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-purple-50 text-purple-700 rounded-lg text-sm font-medium">Going Concern</div>
          <p className="text-xs text-slate-400 mt-3">Going Concern assessment workspace — coming soon.</p>
        </div>
      )}
      {activeOtherTab === 'Management Override' && (
        <JournalRiskPanel engagementId={engagementId} periodStartDate={periodStartDate} periodEndDate={periodEndDate} />
      )}
      {activeOtherTab === 'SRMM Memos' && (
        <SRMMPanel engagementId={engagementId} />
      )}
      {activeOtherTab === 'Disclosure' && (
        <div className="p-6 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-purple-50 text-purple-700 rounded-lg text-sm font-medium">Disclosure</div>
          <p className="text-xs text-slate-400 mt-3">Disclosure checklist and testing workspace — coming soon.</p>
        </div>
      )}

      {/* Level 2: FS Level sub-tabs */}
      {!activeOtherTab && levels.length > 0 && (
        <div className="flex flex-wrap gap-0.5 gap-y-0.5 bg-slate-100 rounded p-0.5">
          {levels.map(level => (
            <button key={level}
              onClick={() => { setActiveLevel(level); setActiveNote(''); }}
              className={`px-2 py-1 text-[10px] font-medium rounded whitespace-nowrap transition-colors ${
                activeLevel === level ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}>
              {level}
            </button>
          ))}
        </div>
      )}

      {/*
        Plan Customiser action bar — visible on every Audit Plan
        view (Statement / Level / Note AND the "Other" tabs:
        Going Concern, Management Override, SRMM Memos,
        Disclosure, etc.). The auditor flagged that hiding the
        button on Other tabs left them unable to add custom tests
        or audit-tools to those sections. Scope name falls back:
        Other tab > Level > Statement.

        FS Line resolution uses a fallback chain:
        exact → case-insensitive → alias → fsLevelMap → synthetic
        pseudo-id keyed by the scope label.
      */}
      {(activeOtherTab || activeLevel || activeStatement) && (
        <div className="flex items-center justify-between gap-3 px-3 py-2 bg-indigo-50 border border-indigo-200 rounded">
          <div className="text-xs text-slate-700">
            <span className="text-[10px] uppercase tracking-wide text-indigo-700 font-semibold">Audit Plan for:</span>{' '}
            <span className="font-semibold">{activeOtherTab || activeLevel || activeStatement}</span>
            {activeNote && <span className="text-slate-500"> → {activeNote}</span>}
            {!activeOtherTab && !activeLevel && (
              <span className="ml-2 text-[10px] text-slate-500 italic">(select an FS Level for more precise customisation)</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* VAT Reconciliation — only on the Revenue level. Opens the
                calculator modal which gates on the Permanent-tab VAT
                registration question, runs through the consistent-rates
                setup once, then lets the team map each revenue code to
                a VAT rate. The grid + Verified-to-Bank + TB compare
                land in subsequent commits. */}
            {isRevenueFsLevel(activeLevel) && (
              <button
                onClick={() => setVatReconcOpen(true)}
                className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded bg-emerald-600 text-white border border-emerald-700 hover:bg-emerald-700 shadow-sm whitespace-nowrap"
                title="Open VAT Reconciliation calculator for the Revenue section"
              >
                <Calculator className="h-3.5 w-3.5" />
                VAT Reconciliation
              </button>
            )}
          <button
            onClick={() => {
              const scopeName = activeOtherTab || activeLevel || activeStatement;
              const levelLower = scopeName.toLowerCase().trim();
              // 1. Exact name match
              let fl = fsLinesList.find(f => f.name === scopeName);
              // 2. Case-insensitive match
              if (!fl) fl = fsLinesList.find(f => f.name.toLowerCase().trim() === levelLower);
              // 3. Alias match (either direction)
              if (!fl) {
                fl = fsLinesList.find(f => {
                  const flName = f.name.toLowerCase().trim();
                  const aliases = FS_LINE_ALIASES[levelLower] || [];
                  const reverseAliases = FS_LINE_ALIASES[flName] || [];
                  return aliases.includes(flName) || reverseAliases.includes(levelLower);
                });
              }
              // 4. Keyword overlap (uses the same fsLevelMap we already computed)
              if (!fl && fsLevelMap[scopeName]) {
                const mapped = fsLevelMap[scopeName].toLowerCase().trim();
                fl = fsLinesList.find(f => f.name.toLowerCase().trim() === mapped);
              }
              // 5. Synthetic fallback — use the raw scope name as
              //    both id and name. The modal filters by id and
              //    by case-insensitive name match so this also
              //    works for Other tabs (Going Concern etc.) where
              //    no FS Line record exists.
              setPlanCustomiserContext({
                fsLineId: fl?.id || `__synthetic__${scopeName}`,
                fsLineName: fl?.name || scopeName,
              });
              setPlanCustomiserOpen(true);
            }}
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded bg-indigo-600 text-white border border-indigo-700 hover:bg-indigo-700 shadow-sm whitespace-nowrap"
            title="Open Plan Customiser for this scope — mark tests N/A, add engagement-specific custom tests, or deploy Audit Tools"
          >
            <ClipboardList className="h-3.5 w-3.5" />
            Plan Customiser
          </button>
          </div>
        </div>
      )}

      {/* Level 3: FS Note sub-sub-tabs — only for Balance Sheet */}
      {!activeOtherTab && isThreeLevel && notes.length > 1 && (
        <div className="flex flex-wrap gap-0.5 gap-y-0.5">
          <button onClick={() => setActiveNote('')}
            className={`px-2 py-0.5 text-[9px] font-medium rounded border transition-colors ${!activeNote ? 'bg-blue-100 text-blue-700 border-blue-300' : 'bg-white text-slate-500 border-slate-200'}`}>
            All
          </button>
          {notes.map(note => {
            const isSig = significantRiskItems.has(note);
            return (
              <button key={note} onClick={() => setActiveNote(note)}
                className={`px-2 py-0.5 text-[9px] font-medium rounded border transition-colors ${
                  activeNote === note ? 'bg-blue-100 text-blue-700 border-blue-300' :
                  isSig ? 'bg-red-50 text-red-700 border-red-200' : 'bg-white text-slate-500 border-slate-200'
                }`}>
                {note}{isSig && <span className="ml-0.5 text-red-500">⚠</span>}
              </button>
            );
          })}
        </div>
      )}

      {/* Tab-level error summary bar */}
      {!activeOtherTab && (() => {
        const levelConcs = dbConclusions.filter(c =>
          activeLevel ? c.fsLine === activeLevel : c.fsLine // all for statement
        );
        const errorConcs = levelConcs.filter(c => c.conclusion === 'orange' || c.conclusion === 'red');
        if (errorConcs.length === 0) return null;
        const totalError = errorConcs.reduce((s: number, c: any) => s + Math.abs(c.extrapolatedError || 0), 0);
        const hasRed = errorConcs.some((c: any) => c.conclusion === 'red');
        return (
          <div className={`flex items-center justify-between px-3 py-1.5 rounded text-xs ${hasRed ? 'bg-red-50 border border-red-200' : 'bg-orange-50 border border-orange-200'}`}>
            <div className="flex items-center gap-2">
              <AlertTriangle className={`h-3.5 w-3.5 ${hasRed ? 'text-red-500' : 'text-orange-500'}`} />
              <span className={`font-medium ${hasRed ? 'text-red-700' : 'text-orange-700'}`}>
                {errorConcs.length} test{errorConcs.length !== 1 ? 's' : ''} with errors — Total: £{totalError.toLocaleString('en-GB', { minimumFractionDigits: 2 })}
              </span>
            </div>
            <button
              onClick={async () => {
                for (const c of errorConcs) {
                  if (!c.errors || !(c.errors as any[]).length) continue;
                  await fetch(`/api/engagements/${engagementId}/error-schedule`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      action: 'commit_from_conclusion', conclusionId: c.id,
                      items: (c.errors as any[]).filter((e: any) => Math.abs(e.difference) > 0).map((e: any) => ({
                        description: `${e.reference}: ${e.description}`, errorAmount: e.difference,
                        errorType: e.isAnomaly ? 'judgemental' : 'factual', explanation: e.explanation, isFraud: e.isFraud,
                      })),
                    }),
                  });
                }
                alert('Errors committed to Error Schedule');
              }}
              className={`text-[10px] font-medium px-2.5 py-1 rounded ${hasRed ? 'bg-red-600 text-white hover:bg-red-700' : 'bg-orange-600 text-white hover:bg-orange-700'}`}
            >
              Commit to Error Schedule
            </button>
          </div>
        );
      })()}

      {/* Merge toolbar */}
      {!activeOtherTab && selectedForMerge.size > 0 && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 border border-blue-200 rounded text-xs">
          <span className="text-blue-700 font-medium">{selectedForMerge.size} rows selected</span>
          {selectedForMerge.size >= 2 && (
            <button onClick={handleMerge} disabled={merging}
              className="px-2 py-0.5 bg-blue-600 text-white rounded text-[10px] font-medium hover:bg-blue-700 disabled:opacity-50">
              {merging ? 'Merging...' : 'Merge Selected'}
            </button>
          )}
          <button onClick={() => setSelectedForMerge(new Set())} className="text-[10px] text-blue-500 hover:text-blue-700">Clear</button>
        </div>
      )}

      {/* Integrated TB rows with expandable tests */}
      {!activeOtherTab && (<div className="bg-white rounded border border-slate-200 overflow-hidden overflow-x-auto max-w-full">
        {filteredRows.length === 0 ? (
          <div className="p-3 text-center text-[10px] text-slate-400">No items for this selection.</div>
        ) : (
          <table className="w-full text-[10px]">
            <colgroup>
              <col style={{width: '20px'}} />
              <col style={{width: '16px'}} />
              <col style={{width: '60px'}} />
              <col />
              {isThreeLevel && <col style={{width: '80px'}} />}
              <col style={{width: '70px'}} />
              <col style={{width: '70px'}} />
              <col style={{width: '12px'}} />{/* spacer between CY and PY */}
              <col style={{width: '70px'}} />
              <col style={{width: '70px'}} />
              <col style={{width: '70px'}} />{/* Assertions */}
              <col style={{width: '60px'}} />{/* Coverage — applicable tests for this FS row */}
              <col style={{width: '50px'}} />{/* Risk */}
            </colgroup>
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="w-5" rowSpan={2}></th>
                <th className="w-4" rowSpan={2}></th>
                <th className="pl-1 pr-0.5 py-0.5 text-left font-semibold text-slate-600" rowSpan={2}>Code</th>
                <th className="px-0.5 py-0.5 text-left font-semibold text-slate-600" rowSpan={2}>Description</th>
                {isThreeLevel && <th className="px-0.5 py-0.5 text-left font-semibold text-slate-600" rowSpan={2}>FS Note</th>}
                <th className="px-0.5 py-0 text-left font-semibold text-slate-600 whitespace-nowrap border-b border-slate-200" colSpan={2}>{fmtDate(periodEndDate) || 'CY'}</th>
                <th rowSpan={2} className="w-3"></th>{/* spacer between CY/PY blocks */}
                <th className="px-0.5 py-0 text-left font-semibold text-slate-600 whitespace-nowrap border-b border-slate-200" colSpan={2}>{dayBefore(periodStartDate) || 'PY'}</th>
                <th className="px-0.5 py-0.5 text-left font-semibold text-slate-600" rowSpan={2}>Assertions</th>
                <th className="px-0.5 py-0.5 text-left font-semibold text-slate-600" rowSpan={2}>Coverage</th>
                <th className="px-0.5 py-0.5 text-left font-semibold text-slate-600" rowSpan={2}>Risk</th>
              </tr>
              <tr>
                {/* Dr/Cr sub-headers — left-aligned to match the
                    body cells. min-w keeps the column wide enough
                    for 7-figure values without truncation. */}
                <th className="px-1 py-0 text-left text-[8px] text-slate-400 font-medium min-w-[80px]">Dr</th>
                <th className="px-1 py-0 text-left text-[8px] text-slate-400 font-medium min-w-[80px]">Cr</th>
                <th className="px-1 py-0 text-left text-[8px] text-slate-400 font-medium min-w-[80px]">Dr</th>
                <th className="px-1 py-0 text-left text-[8px] text-slate-400 font-medium min-w-[80px]">Cr</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.filter(Boolean).map(row => {
                try {
                if (!row) return null;
                // Match RMM to this TB row.
                // RMM lineItem is the account description (e.g. "Barclays Current Account").
                // Match by: description, account code, or FS level from TBCYvPY.
                const rowDesc = (row.description || '').toLowerCase().trim();
                const rowCode = (row.accountCode || '').toLowerCase().trim();
                const rowFsLevel = (row.fsLevel || '').toLowerCase().trim();
                const canonRowLevel = (canonicalLevel(row) || '').toLowerCase().trim();
                const activeLevelLower = (activeLevel || '').toLowerCase().trim();

                // Find ALL matching RMM entries for this row (multiple risks can map to same account)
                const rmmMatches = rmmItems.filter(r => {
                  const li = r.lineItem.toLowerCase().trim();
                  if (li === rowDesc || li === rowCode) return true;
                  if (li === rowFsLevel || li === canonRowLevel || li === activeLevelLower) return true;
                  const rfl = (r.fsLevel || '').toLowerCase().trim();
                  if (rfl && (rfl === rowFsLevel || rfl === canonRowLevel || rfl === activeLevelLower)) return true;
                  return false;
                });
                // Pick the highest-risk RMM match: Sig Risk > Area of Focus > Normal > AR
                const RISK_PRIORITY: Record<string, number> = { 'Very High': 0, 'High': 1, 'Medium': 2, 'Low': 3 };
                const rmmMatch = rmmMatches.length > 0
                  ? rmmMatches.reduce((best, r) => (RISK_PRIORITY[r.overallRisk || ''] ?? 99) < (RISK_PRIORITY[best.overallRisk || ''] ?? 99) ? r : best)
                  : null;

                const effectiveFsLevel = activeLevel || rmmMatch?.fsLevel || row.fsLevel;
                const effectiveFsNote = activeNote || rmmMatch?.fsNote || row.fsNoteLevel;
                const effectiveStatement = activeStatement || rmmMatch?.fsStatement;

                // Classify based on highest RMM risk found
                const rowValue = Math.abs(Number(row.currentYear) || 0);

                function classifyRisk(overallRisk: string | undefined): string {
                  if (!overallRisk) return 'Normal';
                  const mapped = riskClassificationTable?.[overallRisk];
                  if (mapped) return mapped;
                  if (overallRisk === 'High' || overallRisk === 'Very High') return 'Significant Risk';
                  if (overallRisk === 'Medium') return 'Area of Focus';
                  return 'Normal'; // Low or unknown
                }

                let rowClassification: string | null = null;
                if (rmmMatch) {
                  rowClassification = classifyRisk(rmmMatch.overallRisk ?? undefined);
                } else if (performanceMateriality > 0 && rowValue > performanceMateriality) {
                  rowClassification = 'Normal';
                } else if (performanceMateriality > 0) {
                  rowClassification = 'AR';
                } else {
                  rowClassification = null; // PM not set → show all
                }
                // Each RMM risk drives its own tests with its own assertions + classification
                // Call getTestsForRow once per RMM match, then deduplicate by test description
                let tests: ReturnType<typeof getTestsForRow>;
                if (rmmMatches.length > 0) {
                  const seen = new Set<string>();
                  tests = [];
                  for (const rm of rmmMatches) {
                    const rmClass = classifyRisk(rm.overallRisk ?? undefined);
                    const rmTests = getTestsForRow(effectiveFsLevel, effectiveFsNote, row.description, rm.assertions || null, effectiveStatement || undefined, rmClass);
                    for (const t of rmTests) {
                      if (!seen.has(t.description)) { seen.add(t.description); tests.push(t); }
                    }
                  }
                } else {
                  tests = getTestsForRow(effectiveFsLevel, effectiveFsNote, row.description, null, effectiveStatement || undefined, rowClassification);
                }
                const rowKey = row.id || row.accountCode;
                const isExp = expandedRmm.has(rowKey);
                const isSig = rowClassification === 'Significant Risk';
                const isAoF = rowClassification === 'Area of Focus';
                const isAR = rowClassification === 'AR';
                const noRmm = rowClassification === null;
                const isMerged = !!row.originalAccountCode && row.accountCode !== row.originalAccountCode;
                // Use ALL tb rows for merged totals (not filtered — filtered excludes zero rows)
                const mergedGroupRows = isMerged ? tbRows.filter(r => r.accountCode === row.accountCode) : [];
                const isFirstInMerge = isMerged && mergedGroupRows[0]?.id === row.id;
                const displayCode = row.originalAccountCode || row.accountCode;
                return (
                  <Fragment key={rowKey}>
                    {/* Merged group header — show once for the group */}
                    {isMerged && isFirstInMerge && (
                      <tr className="border-b border-blue-200 bg-blue-50/50">
                        <td></td>
                        <td></td>
                        <td className="pl-1 pr-0.5 py-1 font-mono text-blue-600 text-[9px] font-bold">{row.accountCode}</td>
                        <td colSpan={isThreeLevel ? 2 : 1} className="px-0.5 py-1 text-blue-700 font-medium">
                          Merged: {mergedGroupRows.length} accounts
                        </td>
                        <td className="px-0.5 py-1 text-right whitespace-nowrap font-medium"><AmountCell value={mergedGroupRows.reduce((s, r) => s + (Number(r.currentYear) || 0), 0)} className="text-blue-700" /></td>
                        <td className="px-0.5 py-1 text-right whitespace-nowrap"><AmountCell value={mergedGroupRows.reduce((s, r) => s + (Number(r.priorYear) || 0), 0)} className="text-blue-500" /></td>
                        <td></td>
                        <td className="px-0.5 py-1">
                          <button onClick={() => handleUnmerge(row.accountCode)} disabled={merging}
                            className="text-[8px] px-1.5 py-0.5 bg-white border border-blue-300 text-blue-600 rounded hover:bg-blue-100 font-medium">
                            Unmerge
                          </button>
                        </td>
                      </tr>
                    )}
                    <tr
                      data-scroll-anchor={row.accountCode ? `audit-plan-${row.accountCode}` : undefined}
                      className={`border-b border-slate-100 hover:bg-slate-50 ${tests.length > 0 ? 'cursor-pointer' : ''} ${isSig ? 'bg-red-50/20' : isAoF ? 'bg-orange-50/20' : ''} ${isMerged ? 'bg-blue-50/20' : ''}`}
                      onClick={() => tests.length > 0 && toggleRmmExpand(rowKey)}>
                      <td className="text-center px-0.5" onClick={e => { e.stopPropagation(); toggleMergeSelect(row.id); }}>
                        {!isMerged && (
                          <input type="checkbox" checked={selectedForMerge.has(row.id)} readOnly
                            className="w-3 h-3 rounded border-slate-300 text-blue-600 cursor-pointer" />
                        )}
                      </td>
                      <td className="text-center text-slate-400 text-[9px]">{tests.length > 0 ? (isExp ? '▼' : '▶') : ''}</td>
                      <td className="pl-1 pr-0.5 py-px font-mono text-slate-500">{displayCode}</td>
                      <td className="px-0.5 py-px text-slate-700">{row.description}</td>
                      {isThreeLevel && <td className="px-0.5 py-px text-slate-400">{row.fsNoteLevel || ''}</td>}
                      {/* Dr/Cr cells — left-aligned with a fixed
                          min-width so a long Cr value (e.g. a
                          7-figure trade payables balance rendered
                          as "(5,000,000)") can't overflow leftward
                          into the Description / FS Note columns
                          that the auditor flagged. tabular-nums
                          keeps digit columns aligned across rows. */}
                      <td className="px-1 py-px text-left whitespace-nowrap min-w-[80px] tabular-nums"><DrCell value={row.currentYear} /></td>
                      <td className="px-1 py-px text-left whitespace-nowrap min-w-[80px] tabular-nums"><CrCell value={row.currentYear} /></td>
                      <td className="w-3"></td>{/* spacer between CY and PY blocks */}
                      <td className="px-1 py-px text-left whitespace-nowrap min-w-[80px] tabular-nums"><DrCell value={row.priorYear} className="text-slate-500" /></td>
                      <td className="px-1 py-px text-left whitespace-nowrap min-w-[80px] tabular-nums"><CrCell value={row.priorYear} className="text-slate-500" /></td>
                      <td className="px-0.5 py-px">
                        {rmmMatch?.assertions && rmmMatch.assertions.length > 0 ? (
                          <div className="flex flex-wrap gap-px">
                            {rmmMatch.assertions.map(a => (
                              <span key={a} className="text-[7px] px-0.5 py-0 bg-blue-100 text-blue-600 rounded">{assertionShortLabel(a)}</span>
                            ))}
                          </div>
                        ) : ''}
                      </td>
                      {/* Coverage pill — count of applicable tests
                          and how many have a recorded conclusion.
                          Sits beneath the Assertions pill so the
                          reviewer can see at a glance how much of
                          the row is covered without expanding it. */}
                      <td className="px-0.5 py-px">
                        {(() => {
                          const applicable = tests.filter(t => t?.description && !excludedTests.has(`${rowKey}::${t.description}`));
                          if (applicable.length === 0) {
                            return <span className="text-[8px] text-slate-300">—</span>;
                          }
                          const concluded = applicable.filter(t => {
                            const tk = `${rowKey}::${t.description}`;
                            return testConclusions[tk] || dbConclusions.some(c => c.testDescription === t.description);
                          }).length;
                          const allDone = concluded === applicable.length;
                          return (
                            <span
                              className={`text-[8px] px-1 py-0.5 rounded font-semibold border whitespace-nowrap ${
                                allDone
                                  ? 'bg-green-100 text-green-700 border-green-200'
                                  : concluded > 0
                                    ? 'bg-amber-100 text-amber-700 border-amber-200'
                                    : 'bg-slate-100 text-slate-500 border-slate-200'
                              }`}
                              title={`${concluded} of ${applicable.length} applicable test${applicable.length === 1 ? '' : 's'} concluded`}
                            >
                              {concluded}/{applicable.length}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="px-0.5 py-px">
                        {rmmMatch?.overallRisk && (
                          <span
                            className={`text-[9px] px-1.5 py-0.5 rounded font-semibold border shadow-sm ${
                              isSig ? 'bg-red-600 text-white border-red-700' :
                              isAoF ? 'bg-orange-500 text-white border-orange-600' :
                              isAR ? 'bg-blue-600 text-white border-blue-700' :
                              'bg-green-600 text-white border-green-700'
                            }`}
                            title={
                              isSig
                                ? 'Significant Risk — High or Very High RMM. Tests drawn from: Significant Risk, Area of Focus, Normal, Mandatory. Analytical Review excluded.'
                                : isAoF
                                  ? 'Area of Focus — Medium RMM. Tests drawn from: Area of Focus, Normal, Mandatory. Significant Risk and Analytical Review excluded.'
                                  : isAR
                                    ? 'Analytical Review — Balance at or below Performance Materiality with no RMM. Tests drawn from: Analytical Review, Mandatory only — no substantive testing.'
                                    : 'Normal — Balance above Performance Materiality but no RMM. Tests drawn from: Normal, Mandatory only.'
                            }
                          >
                            {isAR ? 'AR' : rowClassification}
                          </span>
                        )}
                      </td>
                    </tr>
                    {isExp && tests.filter(Boolean).map((test, ti) => {
                      if (!test?.description) return null;
                      const testKey = `${rowKey}::${test.description}`;
                      const isApplicable = !excludedTests.has(testKey);
                      const isExecutionOpen = activeExecutions.has(testKey);
                      const testConc = testConclusions[testKey] || testConclusions[test.description];
                      // Match conclusion by test description AND fsLine (or account code) for correct scoping
                      const effectiveFsLineForConc = activeLevel || activeStatement;
                      const dbConc = dbConclusions.find(c =>
                        c.testDescription === test.description && (
                          c.accountCode === row.accountCode ||
                          c.fsLine === effectiveFsLineForConc ||
                          !c.accountCode
                        )
                      ) || dbConclusions.find(c => c.testDescription === test.description);
                      // Completed executions drive the green/pending dot
                      // colour. Kept separate from the "any execution"
                      // lookup below because completed-without-conclusion
                      // defaults to green, but an in-progress run
                      // shouldn't.
                      const dbExec = dbExecutions.find(e =>
                        e.testDescription === test.description && e.status === 'completed' && e.fsLine === effectiveFsLineForConc
                      ) || dbExecutions.find(e => e.testDescription === test.description && e.status === 'completed');
                      // Any execution at all — running, paused, completed,
                      // failed. The Execute/Open button label depends on
                      // this so a test that's been started (even if not
                      // yet finished) shows "Open" instead of "Execute".
                      // Without this the button regressed to "Execute"
                      // mid-run and re-clicking it kicked off a new run.
                      const dbAnyExec = dbExecutions.find(e =>
                        e.testDescription === test.description && e.fsLine === effectiveFsLineForConc
                      ) || dbExecutions.find(e => e.testDescription === test.description);
                      const conc = testConc || dbConc?.conclusion || (dbExec ? 'green' : 'pending');
                      const effectiveExecId = dbConc?.executionId || dbExec?.id || dbAnyExec?.id || null;
                      const hasResults = (conc !== 'pending' || effectiveExecId) && !test.isIngest && test.outputFormat !== 'payroll_workpaper';
                      return (
                      <Fragment key={`${rowKey}-t${ti}`}>
                        {(() => {
                          const isFailed = conc === 'failed';
                          return (
                        <tr className={`border-b border-slate-50 ${!isApplicable ? 'opacity-30' : ''} ${isExecutionOpen ? 'bg-blue-50/50' : ''} ${isFailed ? 'bg-red-100' : ''} ${test.isIngest ? 'opacity-50' : ''}`}>
                          <td className="text-center">
                            <input type="checkbox" checked={isApplicable} onChange={() => toggleTestApplicable(testKey)}
                              className="w-2.5 h-2.5 rounded border-slate-300 cursor-pointer" title={isApplicable ? 'Applicable — click to exclude' : 'Not applicable — click to include'} />
                          </td>
                          <td colSpan={isThreeLevel ? 8 : 7} className="py-0.5 pl-5 pr-2">
                            {/* Test row layout —
                                [type pill] [conclusion dot] [description grows] [Execute] [G/L | Mgmt | 3rdP] [Reviewer/RI →]
                                The Execute and G/L buttons sit in fixed-
                                width slots on the right of the description
                                so they line up vertically across rows. The
                                description itself uses flex-1 + truncate so
                                it fills the remaining space without
                                pushing the right-side controls around. */}
                            <div className="flex items-center gap-1.5">
                              <span className={`text-[7px] px-1 py-0.5 rounded border font-semibold flex-shrink-0 ${test.color}`}>{test.typeName}</span>
                              {/* Conclusion dot — clickable to toggle results */}
                              {conc !== 'pending' && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setActiveExecutions(prev => {
                                      const next = new Set(prev);
                                      if (next.has(testKey)) next.delete(testKey); else next.add(testKey);
                                      return next;
                                    });
                                  }}
                                  className={`w-2.5 h-2.5 rounded-full flex-shrink-0 cursor-pointer hover:ring-2 hover:ring-offset-1 ${
                                    conc === 'green' ? 'bg-green-500 hover:ring-green-300' :
                                    conc === 'orange' ? 'bg-orange-500 hover:ring-orange-300' :
                                    conc === 'failed' ? 'bg-red-800 hover:ring-red-300' : 'bg-red-500 hover:ring-red-300'
                                  }`} title={`${
                                    conc === 'green' ? 'No material errors' :
                                    conc === 'orange' ? 'Errors above CT, within PM' :
                                    conc === 'failed' ? 'Test failed to run' : 'Errors exceed PM'
                                  } — click to ${isExecutionOpen ? 'hide' : 'view'} results`}
                                />
                              )}
                              {/* Test description — flex-1 so it absorbs all
                                  remaining horizontal space, pushing the
                                  Execute / G/L / R/RI controls to the
                                  right edge. Truncates with ellipsis on
                                  long text so the row never wraps. */}
                              <span
                                className={`text-[9px] flex-1 min-w-0 truncate ${isApplicable ? 'text-slate-700' : 'text-slate-400 line-through'}`}
                                title={test.description}
                              >
                                {test.description}
                              </span>
                              {/* Execute / Open / Close — fixed-width slot
                                  so the button's right edge stays aligned
                                  across rows regardless of label length.
                                  When the test isn't applicable we still
                                  reserve the space (empty div) so the
                                  G/L pill doesn't shift left. */}
                              {isApplicable ? (() => {
                                // hasRun = "this test has been kicked off
                                // at least once" — true for in-progress
                                // runs as well as completed ones, so the
                                // button label stays "Open" while a test
                                // is still running. Without dbAnyExec the
                                // label flipped back to "Execute" mid-run
                                // and re-clicking started a new run.
                                const hasRun = !!dbExec || !!dbAnyExec || conc !== 'pending';
                                const label = isExecutionOpen ? 'Close' : hasRun ? 'Open' : 'Execute';
                                return (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setActiveExecutions(prev => {
                                      const next = new Set(prev);
                                      if (next.has(testKey)) {
                                        next.delete(testKey);
                                      } else {
                                        next.add(testKey);
                                        if (!hasRun) {
                                          setAutoStartKeys(p => { const n = new Set(p); n.add(testKey); return n; });
                                        }
                                      }
                                      return next;
                                    });
                                  }}
                                  className={`inline-flex items-center gap-0.5 text-[8px] font-medium px-1.5 py-0.5 rounded transition-colors flex-shrink-0 w-16 justify-center ${
                                    isExecutionOpen
                                      ? 'bg-blue-600 text-white'
                                      : hasRun
                                        ? 'bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-200'
                                        : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200'
                                  }`}
                                  title={hasRun ? 'Open test execution workspace' : 'Run this test now'}
                                >
                                  <Play className="h-2.5 w-2.5" />
                                  {label}
                                </button>
                                );
                              })() : <div className="w-16 flex-shrink-0" aria-hidden />}
                              {(() => {
                                const currentSource: DataSource = testDataSources[testKey] || 'gl';
                                const SOURCE_DEF: Record<DataSource, { label: string; full: string; cls: string; title: string }> = {
                                  gl:   { label: 'G/L',  full: 'General Ledger',          cls: 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100',          title: 'Evidence comes from the General Ledger / TB' },
                                  mgmt: { label: 'Mgmt', full: 'Management',              cls: 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100',     title: 'Evidence comes from management (schedules, reports)' },
                                  tp:   { label: '3rdP', full: 'Third Party',             cls: 'bg-violet-50 text-violet-700 border-violet-200 hover:bg-violet-100', title: 'Evidence comes from a third party (bank, supplier, etc.)' },
                                };
                                const order: DataSource[] = ['gl', 'mgmt', 'tp'];
                                const def = SOURCE_DEF[currentSource];
                                return (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const idx = order.indexOf(currentSource);
                                      const nextSrc = order[(idx + 1) % order.length];
                                      setTestDataSource(testKey, nextSrc);
                                    }}
                                    className={`inline-flex items-center text-[8px] font-semibold px-1.5 py-0.5 rounded border transition-colors flex-shrink-0 w-12 justify-center ${def.cls}`}
                                    title={`${def.full} — ${def.title}. Click to cycle: G/L → Management → Third Party`}
                                  >
                                    {def.label}
                                  </button>
                                );
                              })()}
                              {/* Review / RI checkboxes — clickable */}
                              {dbConc && (
                                <div className="flex items-center gap-1 flex-shrink-0 ml-1" onClick={e => e.stopPropagation()}>
                                  {/* Reviewer chip — cascade: appears signed if Reviewer OR RI has signed. Clicking still toggles the reviewer-level record specifically. */}
                                  {(() => {
                                    const reviewerEffective = dbConc.reviewedBy || dbConc.riSignedBy;
                                    const reviewerEffectiveName = dbConc.reviewedByName || dbConc.riSignedByName;
                                    const reviewerEffectiveAt = dbConc.reviewedAt || dbConc.riSignedAt;
                                    const viaRi = !dbConc.reviewedBy && !!dbConc.riSignedBy;
                                    return (
                                      <button
                                        onClick={async () => {
                                          const action = dbConc.reviewedBy ? 'unreview' : 'review';
                                          const res = await fetch(`/api/engagements/${engagementId}/test-conclusions`, {
                                            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify({ id: dbConc.id, action }),
                                          });
                                          if (res.ok) {
                                            const { conclusion: updated } = await res.json();
                                            setDbConclusions(prev => prev.map(c => c.id === updated.id ? updated : c));
                                          }
                                        }}
                                        className={`inline-flex items-center text-[7px] px-1 py-0.5 rounded cursor-pointer transition-colors ${
                                          reviewerEffective ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-slate-100 text-slate-400 hover:bg-slate-200'
                                        }`}
                                        title={
                                          reviewerEffective
                                            ? `${viaRi ? 'Covered by RI ' : 'Reviewed by '}${reviewerEffectiveName} on ${new Date(reviewerEffectiveAt).toLocaleDateString('en-GB')}${dbConc.reviewedBy ? ' — click to unreview' : ''}`
                                            : 'Click to review'
                                        }
                                      >
                                        R {reviewerEffective ? '✓' : ''}
                                      </button>
                                    );
                                  })()}
                                  <button
                                    onClick={async () => {
                                      const action = dbConc.riSignedBy ? 'ri_unsignoff' : 'ri_signoff';
                                      const res = await fetch(`/api/engagements/${engagementId}/test-conclusions`, {
                                        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ id: dbConc.id, action }),
                                      });
                                      if (res.ok) {
                                        const { conclusion: updated } = await res.json();
                                        setDbConclusions(prev => prev.map(c => c.id === updated.id ? updated : c));
                                      }
                                    }}
                                    className={`inline-flex items-center text-[7px] px-1 py-0.5 rounded cursor-pointer transition-colors ${
                                      dbConc.riSignedBy ? 'bg-blue-100 text-blue-700 hover:bg-blue-200' : 'bg-slate-100 text-slate-400 hover:bg-slate-200'
                                    }`}
                                    title={dbConc.riSignedBy ? `RI signed by ${dbConc.riSignedByName} on ${new Date(dbConc.riSignedAt).toLocaleDateString('en-GB')} — click to unsign` : 'Click to sign as RI'}
                                  >
                                    RI {dbConc.riSignedBy ? '✓' : ''}
                                  </button>
                                </div>
                              )}
                              {test.assertion && <span className="text-[7px] px-0.5 py-0 bg-slate-100 text-slate-400 rounded flex-shrink-0">{test.assertion}</span>}
                            </div>
                          </td>
                        </tr>
                          );
                        })()}
                        {/* Execution Panel — opens below the test row */}
                        {isExecutionOpen && (
                          <tr>
                            <td colSpan={isThreeLevel ? 13 : 12} className="p-2 bg-slate-50/50">
                              <TestExecutionPanel
                                testId={testKey}
                                testDescription={test.description}
                                testType={test.testTypeCode}
                                engagementId={engagementId}
                                clientId={clientId}
                                periodId={periodId}
                                fsLine={activeLevel || activeStatement}
                                fsLineId={(row as any).fsLineId || null}
                                tbRow={{ accountCode: row.accountCode, description: row.description, currentYear: row.currentYear, priorYear: row.priorYear, fsNote: row.fsNoteLevel }}
                                flowData={(test as any).flow || null}
                                executionDef={(test as any).executionDef || null}
                                assertions={(test as any).assertions || []}
                                conclusionRecord={dbConc || null}
                                autoStart={autoStartKeys.has(testKey)}
                                onAutoStartConsumed={() => setAutoStartKeys(prev => { const n = new Set(prev); n.delete(testKey); return n; })}
                                onClose={() => setActiveExecutions(prev => {
                                  const next = new Set(prev);
                                  next.delete(testKey);
                                  return next;
                                })}
                                onConclusionChange={(c) => setTestConclusions(prev => ({ ...prev, [testKey]: c }))}
                              />
                            </td>
                          </tr>
                        )}
                        {/* Payroll Workpaper — for payroll_workpaper output format */}
                        {isExecutionOpen && test.outputFormat === 'payroll_workpaper' && (
                          <tr>
                            <td colSpan={isThreeLevel ? 13 : 12} className="p-2 bg-white">
                              <PayrollTestPanel
                                engagementId={engagementId}
                                fsLine={activeLevel || activeStatement}
                              />
                            </td>
                          </tr>
                        )}
                        {/* Results Panel — shown for completed tests with results (not for ranked_flagged which shows in execution panel) */}
                        {isExecutionOpen && hasResults && test.outputFormat !== 'ranked_flagged' && (
                          <tr>
                            <td colSpan={isThreeLevel ? 13 : 12} className="p-2 bg-white">
                              <TestResultsPanel
                                engagementId={engagementId}
                                executionId={effectiveExecId}
                                testDescription={test.description}
                                fsLine={activeLevel || activeStatement}
                                accountCode={row.accountCode}
                                outputFormat={test.outputFormat || 'three_section_no_sampling'}
                                conclusion={conc}
                                executionStatus="completed"
                                executionOutput={null}
                                conclusionRecord={dbConc || null}
                              />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                      );
                    })}
                    {/* Analytical Review Panel — for AR-classified rows */}
                    {isExp && isAR && (
                      <tr>
                        <td colSpan={isThreeLevel ? 13 : 12} className="p-2 bg-green-50/30">
                          <AnalyticalReviewPanel
                            engagementId={engagementId}
                            fsLine={effectiveFsLevel || activeLevel || activeStatement}
                            accountCodes={[row.accountCode]}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
                } catch (renderErr) {
                  console.error('[AuditPlanPanel] Row render error:', renderErr, 'row:', row?.accountCode, row?.description);
                  return <tr key={row?.accountCode || 'err'}><td colSpan={8} className="px-2 py-1 text-red-500 text-xs">Error rendering row: {(renderErr as Error).message}</td></tr>;
                }
              })}
            </tbody>
          </table>
        )}
      </div>
      )}

      {/* ─── ERROR SCHEDULE ─── */}
      {showErrorSchedule && (
        <div className="bg-white rounded border border-slate-200 overflow-hidden">
          <div className="px-3 py-2 bg-red-50 border-b border-red-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
              <span className="text-xs font-semibold text-red-700">Error Schedule</span>
            </div>
          </div>
          <div className="p-3">
            <ErrorSchedulePanel engagementId={engagementId} />
          </div>
        </div>
      )}

      {/* ─── FLOW VIEWER MODAL ─── */}
      {/* ─── PERSISTENT ERROR SUMMARY FOOTER ─── */}
      {dbConclusions.length > 0 && (
        <div className="fixed bottom-4 left-4 z-50 w-72 bg-white rounded-lg shadow-xl border border-slate-200 overflow-hidden">
          <button onClick={() => setErrorFooterOpen(!errorFooterOpen)}
            className="w-full flex items-center justify-between px-3 py-2 bg-slate-800 text-white text-xs font-bold">
            <span>Errors: {activeLevel || activeStatement}</span>
            <span className="text-[9px] text-slate-300">{errorFooterOpen ? '▼' : '▲'}</span>
          </button>
          {errorFooterOpen && (() => {
            // Filter conclusions by active statement/level
            const filtered = dbConclusions.filter(c => {
              if (activeLevel) return c.fsLine === activeLevel;
              return true; // Show all for statement level
            });
            if (filtered.length === 0) return <div className="p-3 text-xs text-slate-400 text-center">No test conclusions yet</div>;

            // Group by fsLine
            const byFsLine: Record<string, { total: number; conclusion: string }> = {};
            for (const c of filtered) {
              if (!byFsLine[c.fsLine]) byFsLine[c.fsLine] = { total: 0, conclusion: 'green' };
              byFsLine[c.fsLine].total += (c.extrapolatedError || 0);
              if (c.conclusion === 'red') byFsLine[c.fsLine].conclusion = 'red';
              else if (c.conclusion === 'orange' && byFsLine[c.fsLine].conclusion !== 'red') byFsLine[c.fsLine].conclusion = 'orange';
            }

            const totalDr = Object.values(byFsLine).reduce((s, v) => s + (v.total > 0 ? v.total : 0), 0);
            const totalCr = Object.values(byFsLine).reduce((s, v) => s + (v.total < 0 ? Math.abs(v.total) : 0), 0);
            const netError = totalDr - totalCr;
            const footerCT = filtered[0]?.clearlyTrivial || 0;
            const footerTM = filtered[0]?.tolerableMisstatement || 0;
            const netConclusion = footerCT === 0 && footerTM === 0
              ? (Object.values(byFsLine).some(v => v.conclusion === 'red') ? 'red' : Object.values(byFsLine).some(v => v.conclusion === 'orange') ? 'orange' : 'green')
              : Math.abs(netError) <= footerCT ? 'green' : Math.abs(netError) <= footerTM ? 'orange' : 'red';

            return (
              <div className="p-2 space-y-1 max-h-[200px] overflow-y-auto">
                {Object.entries(byFsLine).map(([fsLine, data]) => (
                  <div key={fsLine} className="flex items-center justify-between text-[10px] px-1">
                    <span className="text-slate-600 truncate flex-1">{fsLine}</span>
                    <span className={`font-mono font-medium ${data.total >= 0 ? '' : 'pl-2'}`}>
                      £{Math.abs(data.total).toLocaleString('en-GB', { minimumFractionDigits: 2 })} {data.total >= 0 ? 'Dr' : 'Cr'}
                    </span>
                    <div className={`w-2 h-2 rounded-full ml-2 ${
                      data.conclusion === 'green' ? 'bg-green-500' : data.conclusion === 'orange' ? 'bg-orange-500' : 'bg-red-500'
                    }`} />
                  </div>
                ))}
                <div className="border-t border-slate-200 pt-1 mt-1">
                  <div className="flex items-center justify-between text-[10px] font-bold px-1">
                    <span className="text-slate-700">Net Error</span>
                    <div className="flex items-center gap-1">
                      <span className="font-mono">£{Math.abs(netError).toLocaleString('en-GB', { minimumFractionDigits: 2 })} {netError >= 0 ? 'Dr' : 'Cr'}</span>
                      <div className={`w-2.5 h-2.5 rounded-full ${
                        netConclusion === 'green' ? 'bg-green-500' : netConclusion === 'orange' ? 'bg-orange-500' : 'bg-red-500'
                      }`} />
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {flowViewerExec && (
        <ExecutionFlowViewer
          engagementId={engagementId}
          executionId={flowViewerExec.id}
          testDescription={flowViewerExec.testDescription}
          onClose={() => setFlowViewerExec(null)}
        />
      )}

      {/* Plan Customiser modal — engagement-level test trimming + custom tests */}
      {planCustomiserOpen && planCustomiserContext && (() => {
        // Resolve which allocations to show: prefer exact id match; if the
        // fsLineId is synthetic (no firm-level match), fall back to matching
        // on the fsLine name instead so the user still sees tests.
        const ctx = planCustomiserContext;
        const isSynthetic = ctx.fsLineId.startsWith('__synthetic__');
        const nameLower = ctx.fsLineName.toLowerCase().trim();
        const matching = allocations.filter(a => {
          if (!a.test) return false;
          // Drafts never appear in the Plan Customiser — they live only in
          // Test Bank admin until the Methodology Admin publishes them.
          if (a.test.isDraft) return false;
          if (!isSynthetic && a.fsLineId === ctx.fsLineId) return true;
          // Synthetic or id-miss: match by name
          return a.fsLine?.name?.toLowerCase().trim() === nameLower;
        });
        return (
          <PlanCustomiserModal
            engagementId={engagementId}
            fsLineId={ctx.fsLineId}
            fsLineName={ctx.fsLineName}
            allocatedTests={matching.map(a => ({
              id: a.test.id,
              name: a.test.name,
              description: a.test.description,
              testTypeCode: a.test.testTypeCode,
              assertions: a.test.assertions as string[] | null,
              framework: a.test.framework,
            }))}
            onClose={() => { setPlanCustomiserOpen(false); setPlanCustomiserContext(null); }}
            onChange={(data) => setPlanCustomiser(data)}
          />
        );
      })()}

      {vatReconcOpen && (
        <VatReconciliationPanel
          engagementId={engagementId}
          periodStartDate={periodStartDate}
          periodEndDate={periodEndDate}
          onClose={() => setVatReconcOpen(false)}
        />
      )}
    </div>
  );
}
