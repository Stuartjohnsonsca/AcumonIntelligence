'use client';

import { useState, useEffect, useMemo, Fragment } from 'react';
import { Loader2, ArrowLeft, FileText, Play } from 'lucide-react';
import { TestExecutionPanel } from './TestExecutionPanel';

interface TBRow {
  id: string;
  accountCode: string;
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

export function AuditPlanPanel({ engagementId, clientId, periodId, onClose, periodEndDate, periodStartDate }: Props) {
  const [tbRows, setTbRows] = useState<TBRow[]>([]);
  const [rmmItems, setRmmItems] = useState<RMMItem[]>([]);
  const [allocations, setAllocations] = useState<AllocationEntry[]>([]);
  const [fsLinesList, setFsLinesList] = useState<FsLineEntry[]>([]);
  const [testTypes, setTestTypes] = useState<TestType[]>([]);
  // Legacy fallback: if no allocations exist (migration not run), use old test-bank data
  const [legacyTestBank, setLegacyTestBank] = useState<{ fsLine: string; tests: any[] }[]>([]);
  const [useLegacy, setUseLegacy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeStatement, setActiveStatement] = useState('');
  const [activeLevel, setActiveLevel] = useState('');
  const [activeNote, setActiveNote] = useState('');
  const [framework, setFramework] = useState('');
  const [expandedRmm, setExpandedRmm] = useState<Set<string>>(new Set());
  const [excludedTests, setExcludedTests] = useState<Set<string>>(new Set());
  const [activeExecution, setActiveExecution] = useState<string | null>(null); // testKey of open execution panel
  const [testConclusions, setTestConclusions] = useState<Record<string, 'green' | 'orange' | 'red' | 'pending'>>({}); // testKey → conclusion dot

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
        const [tbRes, rmmRes, engRes, allocRes, ttRes] = await Promise.all([
          fetch(`/api/engagements/${engagementId}/trial-balance`),
          fetch(`/api/engagements/${engagementId}/rmm`),
          fetch(`/api/engagements/${engagementId}`),
          fetch(`/api/engagements/${engagementId}/test-allocations`),
          fetch('/api/methodology-admin/test-types'),
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
          const allocs = allocData.allocations || [];
          setAllocations(allocs);
          setFsLinesList(allocData.fsLines || []);
          // If no allocations, fall back to legacy test-bank
          if (allocs.length === 0) {
            const legacyRes = await fetch('/api/methodology-admin/test-bank');
            if (legacyRes.ok) {
              const legacyData = await legacyRes.json();
              setLegacyTestBank(legacyData.testBanks || legacyData.entries || []);
              setUseLegacy(true);
            }
          }
        }
        if (ttRes.ok) {
          const ttData = await ttRes.json();
          setTestTypes(ttData.types || ttData.testTypes || []);
        }
        if (engRes.ok) {
          const eng = (await engRes.json()).engagement;
          if (eng?.methodologyConfig?.config?.accountingFramework) {
            setFramework(eng.methodologyConfig.config.accountingFramework);
          }
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

  // Get tests for a row — uses FK-based allocation lookup with legacy fallback
  function getTestsForRow(fsLevel: string | null, fsNote: string | null, desc: string, assertions: string[] | null, statement?: string): { description: string; testTypeCode: string; assertion?: string; assertions?: string[]; framework?: string; color: string; typeName: string; flow?: any; executionDef?: any }[] {
    if (useLegacy) {
      return getTestsForRowLegacy(fsLevel, fsNote, desc, assertions, statement);
    }

    // FK-based: find allocations whose FS line name matches the active level/note
    const matchingFsLineIds = new Set<string>();
    const searchTerms = [fsLevel, fsNote].filter(Boolean).map(s => s!.toLowerCase().trim());

    for (const fl of fsLinesList) {
      const flName = fl.name.toLowerCase().trim();
      if (searchTerms.some(term => flName === term || term.includes(flName) || flName.includes(term))) {
        matchingFsLineIds.add(fl.id);
      }
    }

    const matchingAllocs = allocations.filter(a => matchingFsLineIds.has(a.fsLineId));

    const allTests: { description: string; testTypeCode: string; assertion?: string; assertions?: string[]; framework?: string; color: string; typeName: string; flow?: any; executionDef?: any }[] = [];
    const seen = new Set<string>();

    for (const alloc of matchingAllocs) {
      const test = alloc.test;
      if (test.framework && framework && test.framework.toLowerCase() !== framework.toLowerCase() && test.framework !== 'ALL') continue;
      if (!assertionMatches(test.assertions as string[] | null, assertions)) continue;
      if (seen.has(test.name)) continue;
      seen.add(test.name);

      const tt = testTypes.find(t => t.code === test.testTypeCode);
      const color = TEST_TYPE_COLORS[tt?.actionType || ''] || 'bg-slate-100 text-slate-600 border-slate-200';
      allTests.push({
        description: test.name,
        testTypeCode: test.testTypeCode,
        assertions: (test.assertions as string[]) || [],
        assertion: ((test.assertions as string[]) || [])[0] || '',
        framework: test.framework,
        color,
        typeName: tt?.name || test.testTypeCode,
        flow: test.flow,
        executionDef: tt?.executionDef,
      });
    }
    return allTests;
  }

  // Legacy fallback: fuzzy string matching on old MethodologyTestBank entries
  function getTestsForRowLegacy(fsLevel: string | null, fsNote: string | null, desc: string, assertions: string[] | null, statement?: string): { description: string; testTypeCode: string; assertion?: string; framework?: string; color: string; typeName: string; flow?: any; executionDef?: any }[] {
    const searchTerms = [fsLevel, fsNote, desc, statement].filter(Boolean).map(s => s!.toLowerCase().trim());

    const matchingEntries = legacyTestBank.filter(tb => {
      const tbLine = tb.fsLine.toLowerCase().trim();
      if (!tbLine) return true;
      return searchTerms.some(term => {
        return tbLine === term || term.includes(tbLine) || tbLine.includes(term) ||
          term.split(/[\s\-\/,]+/).some(word => word.length > 3 && tbLine.includes(word)) ||
          tbLine.split(/[\s\-\/,]+/).some(word => word.length > 3 && term.includes(word));
      });
    });

    const allTests: { description: string; testTypeCode: string; assertion?: string; framework?: string; color: string; typeName: string; flow?: any; executionDef?: any }[] = [];
    const seen = new Set<string>();

    for (const entry of matchingEntries) {
      for (const test of entry.tests || []) {
        if (test.framework && framework && test.framework.toLowerCase() !== framework.toLowerCase() && test.framework !== 'ALL') continue;
        if (assertions && assertions.length > 0 && test.assertion) {
          const testAss = test.assertion.toLowerCase().trim();
          const testAliases = Object.entries(ASSERTION_ALIASES)
            .filter(([, aliases]) => aliases.some(a => a === testAss || testAss.includes(a) || a.includes(testAss)))
            .flatMap(([, aliases]) => aliases);
          const matches = assertions.some(a => {
            const rowAss = a.toLowerCase().trim();
            if (testAss.includes(rowAss) || rowAss.includes(testAss)) return true;
            return testAliases.some(alias => alias === rowAss || rowAss.includes(alias) || alias.includes(rowAss));
          });
          if (!matches) continue;
        }
        if ((test as any).categories?.length > 0) {
          const cats = (test as any).categories.map((c: string) => c.toLowerCase());
          const fsLevelMatch = fsLevel && cats.some((c: string) => c === fsLevel.toLowerCase());
          if (!fsLevelMatch && !searchTerms.some(term => cats.some((c: string) => c.includes(term) || term.includes(c)))) continue;
        }
        if (seen.has(test.description)) continue;
        seen.add(test.description);
        const tt = testTypes.find(t => t.code === test.testTypeCode);
        const color = TEST_TYPE_COLORS[tt?.actionType || ''] || 'bg-slate-100 text-slate-600 border-slate-200';
        allTests.push({ ...test, color, typeName: tt?.name || test.testTypeCode, flow: (test as any).flow, executionDef: (tt as any)?.executionDef });
      }
    }
    return allTests;
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

  const levels = useMemo(() => {
    if (!activeStatement) return [];
    const levelAmounts: Record<string, number> = {};
    for (const row of tbRows) {
      if (row.fsStatement === activeStatement && row.fsLevel) {
        levelAmounts[row.fsLevel] = (levelAmounts[row.fsLevel] || 0) + Math.abs(Number(row.currentYear) || 0);
      }
    }
    // Only include levels with monetary value or significant risk, sorted by statutory order
    return Object.keys(levelAmounts)
      .filter(l => levelAmounts[l] > 0 || significantRiskItems.has(l))
      .sort((a, b) => getStatutoryPosition(framework || 'FRS102', activeStatement, a) - getStatutoryPosition(framework || 'FRS102', activeStatement, b));
  }, [tbRows, activeStatement, significantRiskItems]);

  // Notes — only for 3-level statements (Balance Sheet), filtered by value/risk
  const notes = useMemo(() => {
    if (!activeLevel || !THREE_LEVEL_STATEMENTS.has(activeStatement)) return [];
    const noteAmounts: Record<string, number> = {};
    for (const row of tbRows) {
      if (row.fsStatement === activeStatement && row.fsLevel === activeLevel && row.fsNoteLevel) {
        noteAmounts[row.fsNoteLevel] = (noteAmounts[row.fsNoteLevel] || 0) + Math.abs(Number(row.currentYear) || 0);
      }
    }
    return Object.keys(noteAmounts)
      .filter(n => noteAmounts[n] > 0 || significantRiskItems.has(n))
      .sort((a, b) => getStatutoryPosition(framework || 'FRS102', activeStatement, a) - getStatutoryPosition(framework || 'FRS102', activeStatement, b));
  }, [tbRows, activeStatement, activeLevel, significantRiskItems, framework]);

  const filteredRows = useMemo(() => {
    return tbRows.filter(row => {
      if (row.fsStatement !== activeStatement) return false;
      if (activeLevel && row.fsLevel && row.fsLevel !== activeLevel) return false;
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

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 text-blue-500 animate-spin" /></div>;

  if (statements.length === 0) {
    return (
      <div className="text-center py-12">
        <FileText className="h-10 w-10 text-slate-300 mx-auto mb-3" />
        <p className="text-sm text-slate-500">No FS Statement data found.</p>
        <button onClick={onClose} className="mt-4 text-xs text-blue-600 hover:text-blue-800">&larr; Back to RMM</button>
      </div>
    );
  }

  const isThreeLevel = THREE_LEVEL_STATEMENTS.has(activeStatement);

  return (
    <div className="space-y-2">
      {/* Header — compact */}
      <div className="flex items-center gap-3">
        <button onClick={onClose} className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1">
          <ArrowLeft className="h-3 w-3" /> Back to RMM
        </button>
        <h2 className="text-sm font-semibold text-slate-800">Audit Plan</h2>
        {framework && <span className="text-[9px] px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded">{framework}</span>}
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

      {/* Integrated TB rows with expandable tests */}
      <div className="bg-white rounded border border-slate-200 overflow-hidden">
        {filteredRows.length === 0 ? (
          <div className="p-3 text-center text-[10px] text-slate-400">No items for this selection.</div>
        ) : (
          <table className="w-full text-[10px]" style={{ tableLayout: 'auto' }}>
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
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
                const rmmMatch = rmmItems.find(r => r.lineItem.toLowerCase() === (row.fsLevel || activeLevel || row.fsNoteLevel || '').toLowerCase());
                // Use RMM stored FS hierarchy if available, then active tabs, then row fields
                const effectiveFsLevel = rmmMatch?.fsLevel || activeLevel || row.fsLevel;
                const effectiveFsNote = rmmMatch?.fsNote || row.fsNoteLevel;
                const effectiveStatement = rmmMatch?.fsStatement || activeStatement;
                const tests = getTestsForRow(effectiveFsLevel, effectiveFsNote, row.description, rmmMatch?.assertions || null, effectiveStatement);
                const rowKey = row.id || row.accountCode;
                const isExp = expandedRmm.has(rowKey);
                const isSig = rmmMatch && (rmmMatch.overallRisk === 'High' || rmmMatch.overallRisk === 'Very High');
                return (
                  <Fragment key={rowKey}>
                    <tr className={`border-b border-slate-100 hover:bg-slate-50 ${tests.length > 0 ? 'cursor-pointer' : ''} ${isSig ? 'bg-red-50/20' : ''}`}
                      onClick={() => tests.length > 0 && toggleRmmExpand(rowKey)}>
                      <td className="text-center text-slate-400 text-[9px]">{tests.length > 0 ? (isExp ? '▼' : '▶') : ''}</td>
                      <td className="pl-1 pr-0.5 py-px font-mono text-slate-500">{row.accountCode}</td>
                      <td className="px-0.5 py-px text-slate-700">{row.description}</td>
                      {isThreeLevel && <td className="px-0.5 py-px text-slate-400">{row.fsNoteLevel || ''}</td>}
                      <td className="px-0.5 py-px text-right whitespace-nowrap">{fmtAmount(row.currentYear)}</td>
                      <td className="px-0.5 py-px text-right text-slate-500 whitespace-nowrap">{fmtAmount(row.priorYear)}</td>
                      <td className="px-0.5 py-px">
                        {rmmMatch?.assertions && rmmMatch.assertions.length > 0 ? (
                          <div className="flex flex-wrap gap-px">
                            {rmmMatch.assertions.map(a => (
                              <span key={a} className="text-[7px] px-0.5 py-0 bg-blue-100 text-blue-600 rounded">{a.length > 10 ? a.split(' ').map(w => w[0]).join('') : a}</span>
                            ))}
                          </div>
                        ) : ''}
                      </td>
                      <td className="px-0.5 py-px">
                        {rmmMatch?.overallRisk && (
                          <span className={`text-[7px] px-0.5 py-0 rounded font-medium ${isSig ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-500'}`}>
                            {rmmMatch.overallRisk}
                          </span>
                        )}
                      </td>
                    </tr>
                    {isExp && tests.map((test, ti) => {
                      const testKey = `${rowKey}::${test.description}`;
                      const isApplicable = !excludedTests.has(testKey);
                      const isExecutionOpen = activeExecution === testKey;
                      return (
                      <Fragment key={`${rowKey}-t${ti}`}>
                        <tr className={`border-b border-slate-50 ${!isApplicable ? 'opacity-30' : ''} ${isExecutionOpen ? 'bg-blue-50/50' : ''}`}>
                          <td className="text-center">
                            <input type="checkbox" checked={isApplicable} onChange={() => toggleTestApplicable(testKey)}
                              className="w-2.5 h-2.5 rounded border-slate-300 cursor-pointer" title={isApplicable ? 'Applicable — click to exclude' : 'Not applicable — click to include'} />
                          </td>
                          <td colSpan={isThreeLevel ? 7 : 6} className="py-0.5 pl-4">
                            <div className="flex items-start gap-1.5 flex-wrap">
                              <span className={`text-[7px] px-1 py-0.5 rounded border font-semibold flex-shrink-0 ${test.color}`}>{test.typeName}</span>
                              <span className={`text-[9px] ${isApplicable ? 'text-slate-700' : 'text-slate-400 line-through'}`}>{test.description}</span>
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
                              {/* Conclusion dot */}
                              {testConclusions[testKey] && testConclusions[testKey] !== 'pending' && (
                                <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                                  testConclusions[testKey] === 'green' ? 'bg-green-500' :
                                  testConclusions[testKey] === 'orange' ? 'bg-orange-500' : 'bg-red-500'
                                }`} title={
                                  testConclusions[testKey] === 'green' ? 'No material errors' :
                                  testConclusions[testKey] === 'orange' ? 'Errors above CT, within PM' : 'Errors exceed PM'
                                } />
                              )}
                              {test.assertion && <span className="text-[7px] px-0.5 py-0 bg-slate-100 text-slate-400 rounded flex-shrink-0">{test.assertion}</span>}
                            </div>
                          </td>
                        </tr>
                        {/* Execution Panel — opens below the test row */}
                        {isExecutionOpen && (
                          <tr>
                            <td colSpan={isThreeLevel ? 8 : 7} className="p-2 bg-slate-50/50">
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
                                onClose={() => setActiveExecution(null)}
                                onConclusionChange={(c) => setTestConclusions(prev => ({ ...prev, [testKey]: c }))}
                              />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                      );
                    })}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
