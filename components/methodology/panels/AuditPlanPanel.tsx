'use client';

import { useState, useEffect, useMemo, Fragment } from 'react';
import { Loader2, ArrowLeft, FileText, Play, ClipboardList, ChevronDown, ChevronRight, CheckCircle2, XCircle, Clock, AlertTriangle, GitBranch, Calculator } from 'lucide-react';
import { TestExecutionPanel } from './TestExecutionPanel';
import { TestResultsPanel } from './TestResultsPanel';
import { ExecutionFlowViewer } from './ExecutionFlowViewer';
import { ErrorSchedulePanel } from './ErrorSchedulePanel';
import { AnalyticalReviewPanel } from './AnalyticalReviewPanel';
import { PayrollTestPanel } from './PayrollTestPanel';
import { assertionShortLabel } from '@/types/methodology';

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
  human_action: 'bg-green-100 text-green-700 border-green-200',
};

interface Props {
  engagementId: string;
  clientId?: string;
  periodId?: string;
  onClose: () => void;
  periodEndDate?: string | null;
  periodStartDate?: string | null;
}

const STATEMENT_ORDER = ['Profit & Loss', 'Balance Sheet', 'Cash Flow Statement', 'Notes'];
const THREE_LEVEL_STATEMENTS = new Set(['Balance Sheet']);

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

function AmountCell({ value, className = '' }: { value: number | null | undefined; className?: string }) {
  if (value == null) return <span></span>;
  const n = Number(value);
  if (isNaN(n)) return <span></span>;
  const isCr = n < 0;
  return (
    <span className={`${isCr ? 'pl-3' : ''} ${className}`}>
      £{Math.abs(n).toLocaleString('en-GB', { minimumFractionDigits: 2 })}{isCr ? ' Cr' : ' Dr'}
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

export function AuditPlanPanel({ engagementId, clientId, periodId, onClose, periodEndDate, periodStartDate }: Props) {
  const [tbRows, setTbRows] = useState<TBRow[]>([]);
  const [rmmItems, setRmmItems] = useState<RMMItem[]>([]);
  const [allocations, setAllocations] = useState<AllocationEntry[]>([]);
  const [fsLinesList, setFsLinesList] = useState<FsLineEntry[]>([]);
  const [testTypes, setTestTypes] = useState<TestType[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeStatement, setActiveStatement] = useState('');
  const [activeLevel, setActiveLevel] = useState('');
  const [activeNote, setActiveNote] = useState('');
  const [framework, setFramework] = useState('');
  const [expandedRmm, setExpandedRmm] = useState<Set<string>>(new Set());
  const [excludedTests, setExcludedTests] = useState<Set<string>>(new Set());
  const [activeExecution, setActiveExecution] = useState<string | null>(null);
  const [testConclusions, setTestConclusions] = useState<Record<string, 'green' | 'orange' | 'red' | 'failed' | 'pending'>>({});
  const [riskClassificationTable, setRiskClassificationTable] = useState<Record<string, string> | null>(null);
  const [dbConclusions, setDbConclusions] = useState<any[]>([]);
  const [dbExecutions, setDbExecutions] = useState<any[]>([]);
  const [errorFooterOpen, setErrorFooterOpen] = useState(true);
  const [selectedForMerge, setSelectedForMerge] = useState<Set<string>>(new Set());
  const [merging, setMerging] = useState(false);
  const [showAuditLog, setShowAuditLog] = useState(false);
  const [auditLog, setAuditLog] = useState<any[]>([]);
  const [auditLogLoading, setAuditLogLoading] = useState(false);
  const [flowViewerExec, setFlowViewerExec] = useState<{ id: string; testDescription: string } | null>(null);
  const [showErrorSchedule, setShowErrorSchedule] = useState(false);

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

  useEffect(() => {
    async function load() {
      try {
        const [tbRes, rmmRes, allocRes, ttRes, pfRes, concRes, rcRes, execRes] = await Promise.all([
          fetch(`/api/engagements/${engagementId}/trial-balance`),
          fetch(`/api/engagements/${engagementId}/rmm`),
          fetch(`/api/engagements/${engagementId}/test-allocations`),
          fetch('/api/methodology-admin/test-types'),
          fetch(`/api/engagements/${engagementId}/permanent-file`),
          fetch(`/api/engagements/${engagementId}/test-conclusions`),
          fetch('/api/methodology-admin/risk-tables?tableType=riskClassification'),
          fetch(`/api/engagements/${engagementId}/test-execution`),
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

    // Get all tests allocated to the matched FS Lines
    const matchedTestsMap = new Map<string, AllocationEntry['test']>();
    for (const a of allocations) {
      if (matchingFsLineIds.has(a.fsLineId) && !matchedTestsMap.has(a.test.id)) {
        matchedTestsMap.set(a.test.id, a.test);
      }
    }

    const result: { description: string; testTypeCode: string; assertion?: string; assertions?: string[]; framework?: string; color: string; typeName: string; flow?: any; executionDef?: any; isIngest?: boolean; outputFormat?: string | null }[] = [];

    for (const test of matchedTestsMap.values()) {
      if (test.framework && framework && test.framework.toLowerCase() !== framework.toLowerCase() && test.framework !== 'ALL') continue;
      if (!assertionMatches(test.assertions as string[] | null, assertions)) continue;

      // Risk-based filtering using test.category (or legacy significantRisk):
      // - null: no RMM data — show all tests
      // - AR: only Analytical Review + Mandatory tests
      // - Area of Focus: all except Significant Risk category tests
      // - Significant Risk: all tests
      const testCategory = (test as any).category || (test.significantRisk ? 'Significant Risk' : 'Other');
      if (riskClassification === 'AR' && testCategory !== 'Analytical Review' && testCategory !== 'Mandatory') continue;
      if (riskClassification === 'Area of Focus' && testCategory === 'Significant Risk') continue;

      const tt = testTypes.find(t => t.code === test.testTypeCode);
      const color = TEST_TYPE_COLORS[tt?.actionType || ''] || 'bg-slate-100 text-slate-600 border-slate-200';
      result.push({
        description: test.name,
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

  useEffect(() => {
    if (statements.length > 0 && !activeStatement) setActiveStatement(statements[0]);
  }, [statements, activeStatement]);

  useEffect(() => {
    if (levels.length > 0) setActiveLevel(levels[0]); else setActiveLevel('');
    setActiveNote('');
  }, [levels]);

  useEffect(() => { setActiveNote(''); }, [activeLevel]);

  async function loadAuditLog() {
    setAuditLogLoading(true);
    try {
      // Filter by active FS level sub-tab when set
      const params = new URLSearchParams();
      if (activeLevel) params.set('fsLine', activeLevel);
      const qs = params.toString() ? `?${params.toString()}` : '';
      const res = await fetch(`/api/engagements/${engagementId}/test-execution${qs}`);
      if (res.ok) {
        const data = await res.json();
        setAuditLog(data.executions || []);
      }
    } catch {} finally { setAuditLogLoading(false); }
  }

  function toggleAuditLog() {
    const next = !showAuditLog;
    setShowAuditLog(next);
    if (next && auditLog.length === 0) loadAuditLog();
  }

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
        <button onClick={toggleAuditLog}
          className={`inline-flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-md border transition-colors ${
            showAuditLog ? 'bg-blue-100 border-blue-300 text-blue-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
          }`}>
          <ClipboardList className="h-3 w-3" />
          Test Audit Log
        </button>
        <button onClick={() => setShowErrorSchedule(!showErrorSchedule)}
          className={`inline-flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-md border transition-colors ${
            showErrorSchedule ? 'bg-red-100 border-red-300 text-red-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
          }`}>
          <AlertTriangle className="h-3 w-3" />
          Error Schedule
        </button>
      </div>

      {/* Level 1: FS Statement tabs */}
      <div className="flex gap-0.5 border-b border-slate-200 overflow-x-auto">
        {statements.map(stmt => (
          <button key={stmt}
            onClick={() => { setActiveStatement(stmt); setActiveLevel(''); setActiveNote(''); }}
            className={`px-3 py-1.5 text-[11px] font-medium border-b-2 whitespace-nowrap transition-colors ${
              activeStatement === stmt ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}>
            {stmt}
          </button>
        ))}
      </div>

      {/* Level 2: FS Level sub-tabs */}
      {levels.length > 0 && (
        <div className="flex gap-0.5 bg-slate-100 rounded p-0.5 overflow-x-auto">
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

      {/* Level 3: FS Note sub-sub-tabs — only for Balance Sheet */}
      {isThreeLevel && notes.length > 1 && (
        <div className="flex gap-0.5 overflow-x-auto">
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
      {(() => {
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
      {selectedForMerge.size > 0 && (
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
      <div className="bg-white rounded border border-slate-200 overflow-hidden">
        {filteredRows.length === 0 ? (
          <div className="p-3 text-center text-[10px] text-slate-400">No items for this selection.</div>
        ) : (
          <table className="w-full text-[10px]" style={{ tableLayout: 'auto' }}>
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="w-5"></th>
                <th className="w-4"></th>
                <th className="pl-1 pr-0.5 py-0.5 text-left font-semibold text-slate-600">Code</th>
                <th className="px-0.5 py-0.5 text-left font-semibold text-slate-600">Description</th>
                {isThreeLevel && <th className="px-0.5 py-0.5 text-left font-semibold text-slate-600">FS Note</th>}
                <th className="px-0.5 py-0.5 text-right font-semibold text-slate-600 whitespace-nowrap">{fmtDate(periodEndDate) || 'CY'}</th>
                <th className="px-0.5 py-0.5 text-right font-semibold text-slate-600 whitespace-nowrap">{dayBefore(periodStartDate) || 'PY'}</th>
                <th className="px-0.5 py-0.5 text-left font-semibold text-slate-600">Assertions</th>
                <th className="px-0.5 py-0.5 text-left font-semibold text-slate-600">Risk</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map(row => {
                // Match RMM to this TB row.
                // RMM lineItem is the account description (e.g. "Barclays Current Account").
                // Match by: description, account code, or FS level from TBCYvPY.
                const rowDesc = (row.description || '').toLowerCase().trim();
                const rowCode = (row.accountCode || '').toLowerCase().trim();
                const rowFsLevel = (row.fsLevel || '').toLowerCase().trim();
                const canonRowLevel = (canonicalLevel(row) || '').toLowerCase().trim();
                const activeLevelLower = (activeLevel || '').toLowerCase().trim();

                const rmmMatch = rmmItems.find(r => {
                  const li = r.lineItem.toLowerCase().trim();
                  // Direct match: RMM lineItem is the account description or code
                  if (li === rowDesc || li === rowCode) return true;
                  // FS level match: RMM lineItem matches the FS level
                  if (li === rowFsLevel || li === canonRowLevel || li === activeLevelLower) return true;
                  // RMM has its own fsLevel set
                  const rfl = (r.fsLevel || '').toLowerCase().trim();
                  if (rfl && (rfl === rowFsLevel || rfl === canonRowLevel || rfl === activeLevelLower)) return true;
                  return false;
                });

                // The active tab level is the primary FS level for test matching
                const effectiveFsLevel = activeLevel || rmmMatch?.fsLevel || row.fsLevel;
                const effectiveFsNote = activeNote || rmmMatch?.fsNote || row.fsNoteLevel;
                const effectiveStatement = activeStatement || rmmMatch?.fsStatement;

                // Determine risk classification from admin table.
                // If no RMM match found, show tests without risk filtering (null = show all).
                const rowClassification = rmmMatch?.overallRisk
                  ? (riskClassificationTable?.[rmmMatch.overallRisk] || (
                      rmmMatch.overallRisk === 'High' || rmmMatch.overallRisk === 'Very High' ? 'Significant Risk'
                      : rmmMatch.overallRisk === 'Medium' ? 'Area of Focus' : 'AR'
                    ))
                  : null; // null = no RMM data, don't filter by risk
                const tests = getTestsForRow(effectiveFsLevel, effectiveFsNote, row.description, rmmMatch?.assertions || null, effectiveStatement || undefined, rowClassification);
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
                    <tr className={`border-b border-slate-100 hover:bg-slate-50 ${tests.length > 0 ? 'cursor-pointer' : ''} ${isSig ? 'bg-red-50/20' : isAoF ? 'bg-orange-50/20' : ''} ${isMerged ? 'bg-blue-50/20' : ''}`}
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
                      <td className="px-0.5 py-px text-right whitespace-nowrap"><AmountCell value={row.currentYear} /></td>
                      <td className="px-0.5 py-px text-right whitespace-nowrap"><AmountCell value={row.priorYear} className="text-slate-500" /></td>
                      <td className="px-0.5 py-px">
                        {rmmMatch?.assertions && rmmMatch.assertions.length > 0 ? (
                          <div className="flex flex-wrap gap-px">
                            {rmmMatch.assertions.map(a => (
                              <span key={a} className="text-[7px] px-0.5 py-0 bg-blue-100 text-blue-600 rounded">{assertionShortLabel(a)}</span>
                            ))}
                          </div>
                        ) : ''}
                      </td>
                      <td className="px-0.5 py-px">
                        {rmmMatch?.overallRisk && (
                          <span className={`text-[7px] px-0.5 py-0 rounded font-medium ${
                            isSig ? 'bg-red-100 text-red-700' : isAoF ? 'bg-orange-100 text-orange-700' : 'bg-green-50 text-green-600'
                          }`}>
                            {isAR ? 'AR' : rowClassification}
                          </span>
                        )}
                      </td>
                    </tr>
                    {isExp && tests.map((test, ti) => {
                      const testKey = `${rowKey}::${test.description}`;
                      const isApplicable = !excludedTests.has(testKey);
                      const isExecutionOpen = activeExecution === testKey;
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
                      // Also check for completed executions (tests that ran but have no conclusion record yet)
                      const dbExec = dbExecutions.find(e =>
                        e.testDescription === test.description && e.status === 'completed' && e.fsLine === effectiveFsLineForConc
                      ) || dbExecutions.find(e => e.testDescription === test.description && e.status === 'completed');
                      const conc = testConc || dbConc?.conclusion || (dbExec ? 'green' : 'pending');
                      const effectiveExecId = dbConc?.executionId || dbExec?.id || null;
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
                          <td colSpan={isThreeLevel ? 8 : 7} className="py-0.5 pl-5">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className={`text-[7px] px-1 py-0.5 rounded border font-semibold flex-shrink-0 ${test.color}`}>{test.typeName}</span>
                              <span className={`text-[9px] flex-1 ${isApplicable ? 'text-slate-700' : 'text-slate-400 line-through'}`}>{test.description}</span>
                              {isApplicable && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); setActiveExecution(isExecutionOpen ? null : testKey); }}
                                  className={`inline-flex items-center gap-0.5 text-[8px] font-medium px-1.5 py-0.5 rounded transition-colors flex-shrink-0 ${
                                    isExecutionOpen
                                      ? 'bg-blue-600 text-white'
                                      : 'bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-200'
                                  }`}
                                  title="Open test execution workspace"
                                >
                                  <Play className="h-2.5 w-2.5" />
                                  {isExecutionOpen ? 'Close' : 'Execute'}
                                </button>
                              )}
                              {/* Conclusion dot — clickable to toggle results */}
                              {conc !== 'pending' && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); setActiveExecution(isExecutionOpen ? null : testKey); }}
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
                              {/* Review / RI checkboxes — clickable */}
                              {dbConc && (
                                <div className="flex items-center gap-1 flex-shrink-0 ml-1" onClick={e => e.stopPropagation()}>
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
                                      dbConc.reviewedBy ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-slate-100 text-slate-400 hover:bg-slate-200'
                                    }`}
                                    title={dbConc.reviewedBy ? `Reviewed by ${dbConc.reviewedByName} on ${new Date(dbConc.reviewedAt).toLocaleDateString('en-GB')} — click to unreview` : 'Click to review'}
                                  >
                                    R {dbConc.reviewedBy ? '✓' : ''}
                                  </button>
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
                            <td colSpan={isThreeLevel ? 9 : 8} className="p-2 bg-slate-50/50">
                              <TestExecutionPanel
                                testId={testKey}
                                testDescription={test.description}
                                testType={test.testTypeCode}
                                engagementId={engagementId}
                                clientId={clientId}
                                periodId={periodId}
                                fsLine={activeLevel || activeStatement}
                                tbRow={{ accountCode: row.accountCode, description: row.description, currentYear: row.currentYear, priorYear: row.priorYear, fsNote: row.fsNoteLevel }}
                                flowData={(test as any).flow || null}
                                executionDef={(test as any).executionDef || null}
                                assertions={(test as any).assertions || []}
                                onClose={() => setActiveExecution(null)}
                                onConclusionChange={(c) => setTestConclusions(prev => ({ ...prev, [testKey]: c }))}
                              />
                            </td>
                          </tr>
                        )}
                        {/* Payroll Workpaper — for payroll_workpaper output format */}
                        {isExecutionOpen && test.outputFormat === 'payroll_workpaper' && (
                          <tr>
                            <td colSpan={isThreeLevel ? 9 : 8} className="p-2 bg-white">
                              <PayrollTestPanel
                                engagementId={engagementId}
                                fsLine={activeLevel || activeStatement}
                              />
                            </td>
                          </tr>
                        )}
                        {/* Results Panel — shown for completed tests with results OR completed executions */}
                        {isExecutionOpen && hasResults && (
                          <tr>
                            <td colSpan={isThreeLevel ? 9 : 8} className="p-2 bg-white">
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
                        <td colSpan={isThreeLevel ? 9 : 8} className="p-2 bg-green-50/30">
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
              })}
            </tbody>
          </table>
        )}
      </div>

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

      {/* ─── AUDIT LOG ─── */}
      {showAuditLog && (
        <div className="bg-white rounded border border-slate-200 overflow-hidden">
          <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ClipboardList className="h-3.5 w-3.5 text-slate-500" />
              <span className="text-xs font-semibold text-slate-700">Test Execution Audit Log</span>
            </div>
            <button onClick={loadAuditLog} className="text-[10px] text-blue-600 hover:text-blue-800">Refresh</button>
          </div>
          {auditLogLoading ? (
            <div className="p-4 text-center"><Loader2 className="h-4 w-4 animate-spin text-blue-500 mx-auto" /></div>
          ) : auditLog.length === 0 ? (
            <div className="p-4 text-center text-xs text-slate-400">No test executions recorded yet.</div>
          ) : (
            <table className="w-full text-[10px]">
              <thead className="bg-slate-50 border-b">
                <tr>
                  <th className="text-left px-2 py-1.5 font-semibold text-slate-600">Test</th>
                  <th className="text-left px-2 py-1.5 font-semibold text-slate-600">FS Line</th>
                  <th className="text-left px-2 py-1.5 font-semibold text-slate-600">Status</th>
                  <th className="text-left px-2 py-1.5 font-semibold text-slate-600">Steps</th>
                  <th className="text-left px-2 py-1.5 font-semibold text-slate-600">Started</th>
                  <th className="text-left px-2 py-1.5 font-semibold text-slate-600">Error</th>
                  <th className="w-12 px-2 py-1.5"></th>
                </tr>
              </thead>
              <tbody>
                {auditLog.map(exec => {
                  const completedSteps = (exec.nodeRuns || []).filter((r: any) => r.status === 'completed').length;
                  const failedSteps = (exec.nodeRuns || []).filter((r: any) => r.status === 'failed').length;
                  const totalSteps = (exec.nodeRuns || []).length;
                  const failedNode = (exec.nodeRuns || []).find((r: any) => r.status === 'failed');
                  return (
                    <tr key={exec.id} className={`border-b border-slate-50 hover:bg-slate-50 ${exec.status === 'failed' ? 'bg-red-50/30' : ''}`}>
                      <td className="px-2 py-1.5 text-slate-700 font-medium max-w-[200px] truncate">{exec.testDescription}</td>
                      <td className="px-2 py-1.5 text-slate-500">{exec.fsLine}</td>
                      <td className="px-2 py-1.5">
                        <span className={`inline-flex items-center gap-0.5 text-[9px] font-medium px-1.5 py-0.5 rounded-full ${
                          exec.status === 'completed' ? 'bg-green-100 text-green-700' :
                          exec.status === 'failed' ? 'bg-red-100 text-red-700' :
                          exec.status === 'running' ? 'bg-blue-100 text-blue-700' :
                          exec.status === 'paused' ? 'bg-orange-100 text-orange-700' :
                          exec.status === 'cancelled' ? 'bg-slate-100 text-slate-500' :
                          'bg-slate-100 text-slate-500'
                        }`}>
                          {exec.status === 'completed' && <CheckCircle2 className="h-2.5 w-2.5" />}
                          {exec.status === 'failed' && <XCircle className="h-2.5 w-2.5" />}
                          {exec.status === 'running' && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
                          {exec.status === 'paused' && <Clock className="h-2.5 w-2.5" />}
                          {exec.status}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-slate-500">
                        <span className="text-green-600">{completedSteps}</span>
                        {failedSteps > 0 && <span className="text-red-500 ml-1">/ {failedSteps} failed</span>}
                        <span className="text-slate-400"> / {totalSteps}</span>
                      </td>
                      <td className="px-2 py-1.5 text-slate-400">
                        {exec.startedAt ? new Date(exec.startedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}
                      </td>
                      <td className="px-2 py-1.5 text-red-500 max-w-[200px] truncate">
                        {failedNode?.errorMessage || exec.errorMessage || ''}
                      </td>
                      <td className="px-2 py-1.5">
                        <button
                          onClick={() => setFlowViewerExec({ id: exec.id, testDescription: exec.testDescription })}
                          className="inline-flex items-center gap-0.5 text-[9px] font-medium px-1.5 py-0.5 rounded border border-blue-200 text-blue-600 hover:bg-blue-50"
                          title="View execution flow"
                        >
                          <GitBranch className="h-2.5 w-2.5" /> Flow
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
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
    </div>
  );
}
