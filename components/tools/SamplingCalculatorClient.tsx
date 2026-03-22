'use client';

import { useState, useCallback, useRef } from 'react';
import {
  Upload, FileSpreadsheet, Loader2, ChevronDown, AlertCircle,
  CheckCircle2, Search, Lock, ArrowLeft, Plus, BarChart3,
  Link2, Grid3X3, MessageSquare, Info, Printer, Download, X,
  RotateCcw, Clock,
} from 'lucide-react';
import { useBackgroundTasks } from '@/components/BackgroundTaskProvider';
import AISuggestStratification, { type AISuggestion } from '@/components/tools/sampling/AISuggestStratification';
import DistributionAnalysisModal from '@/components/tools/sampling/DistributionAnalysisModal';
import XeroFetchPopulation from '@/components/tools/sampling/XeroFetchPopulation';

// ─── Interfaces ──────────────────────────────────────────────────────────────

interface Client {
  id: string;
  clientName: string;
  software: string | null;
  contactName: string | null;
  contactEmail: string | null;
}

interface Period {
  id: string;
  startDate: string;
  endDate: string;
}

interface AuditData {
  performanceMateriality: number;
  clearlyTrivial: number;
  tolerableMisstatement: number;
  functionalCurrency: string;
  dataType: string;
  testType: string;
}

interface ColumnMapping {
  transactionId: string;
  date: string;
  amount: string;
  description: string;
  preparer?: string;
  timestamp?: string;
  manualAutoFlag?: string;
  overrideFlag?: string;
  exceptionFlag?: string;
  vendorCustomer?: string;
  glCode?: string;
  sourceSystem?: string;
}

interface DataQuality {
  recordCount: number;
  dateRange: { min: string; max: string } | null;
  missingCounts: Record<string, number>;
  duplicateIds: number;
  amountStats: { min: number; max: number; mean: number; median: number; stdDev: number } | null;
}

interface Props {
  userId: string;
  userName: string;
  firmId: string;
  firmName: string;
  assignedClients: Client[];
  isFirmAdmin: boolean;
  isPortfolioOwner: boolean;
  firmConfig: {
    confidenceLevel: number;
    confidenceFactorTable: Record<string, unknown>[] | null;
    riskMatrix: number[][] | null;
  } | null;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const DATA_TYPES = [
  'Revenue', 'Direct Costs', 'Overheads', 'Expenditure',
  'Trade Debtors', 'Trade Creditors', 'Asset Additions', 'Assets',
];

const CURRENCIES = [
  'GBP', 'USD', 'EUR', 'CHF', 'JPY', 'AUD', 'CAD', 'HKD', 'SGD', 'NZD',
];

const SAMPLING_METHODS = [
  { key: 'random', label: 'Random' },
  { key: 'systematic', label: 'Systematic' },
  { key: 'mus', label: 'Monetary Unit Sampling (MUS)' },
  { key: 'judgemental', label: 'Judgemental' },
  { key: 'composite', label: 'Composite' },
];

const RANDOM_BASIS_OPTIONS = [
  { key: 'net_signed', label: 'Net (signed) misstatement' },
  { key: 'overstatement_only', label: 'Overstatement-only' },
  { key: 'absolute_error', label: 'Absolute error / gross error' },
];

const SYSTEMATIC_BASIS_OPTIONS = [
  { key: 'single_stage', label: 'Single Stage' },
  { key: 'two_stage', label: '2 Stage' },
];

function formatPeriod(start: string, end: string) {
  const s = new Date(start);
  const e = new Date(end);
  const fmt = (d: Date) => d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
  return `${fmt(s)} – ${fmt(e)}`;
}

function defaultTestType(dataType: string): string {
  if (['Trade Debtors', 'Trade Creditors'].includes(dataType)) return 'two_tail';
  return 'one_tail';
}

// ─── Component ───────────────────────────────────────────────────────────────

export function SamplingCalculatorClient({
  userName, assignedClients, firmConfig,
}: Props) {
  const { addTask, updateTask } = useBackgroundTasks();

  // ─── Step/state management ─────────────────────────────────────────────────
  const [step, setStep] = useState<'client' | 'no-access' | 'configure' | 'upload' | 'map' | 'method'>('client');

  // ─── Client/period selection ───────────────────────────────────────────────
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [clientSearch, setClientSearch] = useState('');
  const [periods, setPeriods] = useState<Period[]>([]);
  const [periodsLoading, setPeriodsLoading] = useState(false);
  const [selectedPeriod, setSelectedPeriod] = useState<Period | null>(null);
  const [hasAccess, setHasAccess] = useState<boolean | null>(null);

  // ─── Audit data ────────────────────────────────────────────────────────────
  const [auditData, setAuditData] = useState<AuditData>({
    performanceMateriality: 0,
    clearlyTrivial: 0,
    tolerableMisstatement: 0,
    functionalCurrency: 'GBP',
    dataType: 'Revenue',
    testType: 'one_tail',
  });

  // ─── Upload / mapping ─────────────────────────────────────────────────────
  const [uploading, setUploading] = useState(false);
  const [uploadedColumns, setUploadedColumns] = useState<string[]>([]);
  const [uploadedPreview, setUploadedPreview] = useState<Record<string, unknown>[]>([]);
  const [uploadedFileName, setUploadedFileName] = useState('');
  const [columnMapping, setColumnMapping] = useState<Partial<ColumnMapping>>({});
  const [mappingErrors, setMappingErrors] = useState<string[]>([]);

  // ─── Sampling method ──────────────────────────────────────────────────────
  const [stratification, setStratification] = useState<'simple' | 'stratified'>('simple');
  const [samplingMethod, setSamplingMethod] = useState('random');
  const [randomBasis, setRandomBasis] = useState('net_signed');
  const [systematicBasis, setSystematicBasis] = useState('single_stage');
  const [sampleSizeStrategy, setSampleSizeStrategy] = useState<'fixed' | 'calculator'>('calculator');
  const [fixedSampleSize, setFixedSampleSize] = useState(25);
  const [inherentRisk, setInherentRisk] = useState<'Low' | 'Medium' | 'High'>('Medium');
  const [specificRisk, setSpecificRisk] = useState<'Low' | 'Medium' | 'High'>('Medium');

  // ─── Data input mode ────────────────────────────────────────────────────
  const [dataInputMode, setDataInputMode] = useState<'upload' | 'paste' | 'connect' | 'bank'>('upload');
  const [bankStatementParsing, setBankStatementParsing] = useState(false);
  const [bankStatementMeta, setBankStatementMeta] = useState<Record<string, unknown> | null>(null);

  // ─── Spreadsheet paste ─────────────────────────────────────────────────
  const [spreadsheetData, setSpreadsheetData] = useState<string[][]>([['', '', '', '', '']]);
  const spreadsheetRef = useRef<HTMLDivElement>(null);

  // ─── Accounting connection (managed by XeroFetchPopulation component) ──

  // ─── Fixed size justification ──────────────────────────────────────────
  const [fixedJustification, setFixedJustification] = useState('');
  const [justificationAssessing, setJustificationAssessing] = useState(false);
  const [justificationResult, setJustificationResult] = useState<'defensible' | 'weak' | 'indefensible' | null>(null);
  const [justificationFeedback, setJustificationFeedback] = useState('');

  // ─── Composite extras ─────────────────────────────────────────────────────
  const [compositeThreshold, setCompositeThreshold] = useState(0);
  const [compositeJustification, setCompositeJustification] = useState('');
  const [compositeResidualMethod, setCompositeResidualMethod] = useState('random');
  const [compositeResidualBasis, setCompositeResidualBasis] = useState('net_signed');
  const [compositeResidualSystematic, setCompositeResidualSystematic] = useState('single_stage');
  const [compositeDefResult, setCompositeDefResult] = useState<'defensible' | 'weak' | 'indefensible' | null>(null);
  const [compositeDefFeedback, setCompositeDefFeedback] = useState('');
  const [compositeDefAssessing, setCompositeDefAssessing] = useState(false);

  // Judgemental
  const [judgementalDescription, setJudgementalDescription] = useState('');
  const [judgementalJustification, setJudgementalJustification] = useState('');
  const [judgementalDefResult, setJudgementalDefResult] = useState<'defensible' | 'weak' | 'indefensible' | null>(null);
  const [judgementalDefFeedback, setJudgementalDefFeedback] = useState('');
  const [judgementalDefAssessing, setJudgementalDefAssessing] = useState(false);

  // Stratification rationale
  const [stratRationale, setStratRationale] = useState('');
  const [stratDefResult, setStratDefResult] = useState<'defensible' | 'weak' | 'indefensible' | null>(null);
  const [stratDefFeedback, setStratDefFeedback] = useState('');
  const [stratDefAssessing, setStratDefAssessing] = useState(false);

  // Reset confirmation
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  // Session history
  const [engagementHistory, setEngagementHistory] = useState<{ id: string; createdAt: string; auditArea: string | null; status: string; _count: { runs: number } }[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  // ─── Mode B stratification ──────────────────────────────────────────────
  const [allocationRule, setAllocationRule] = useState<'rule_a' | 'rule_b' | 'rule_c'>('rule_a');
  const [ruleBTotal, setRuleBTotal] = useState(50);
  const [ruleCHigh, setRuleCHigh] = useState(0);
  const [ruleCMedium, setRuleCMedium] = useState(10);
  const [ruleCLow, setRuleCLow] = useState(5);
  const [stratificationResults, setStratificationResults] = useState<{ strata: { name: string; level: string; itemCount: number; sampleSize: number; totalValue: number; topDrivers: { feature: string; contribution: number }[] }[] } | null>(null);
  const [aiStratSuggestion, setAiStratSuggestion] = useState<AISuggestion | null>(null);
  const [itemProfiles, setItemProfiles] = useState<{ index: number; riskScore: number; stratum: 'high' | 'medium' | 'low' }[] | null>(null);
  const [showDistributionModal, setShowDistributionModal] = useState(false);

  // ─── Saved column mappings ──────────────────────────────────────────────
  const [savedMappings, setSavedMappings] = useState<Record<string, Partial<ColumnMapping>>>({});
  const [mappingSaved, setMappingSaved] = useState(false);

  // ─── Population totals ─────────────────────────────────────────────────
  const [populationTotal, setPopulationTotal] = useState(0);
  const [populationCount, setPopulationCount] = useState(0);

  // ─── Sampling results ───────────────────────────────────────────────────
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  const [sampleTotal, setSampleTotal] = useState<number | null>(null);
  const [coverage, setCoverage] = useState<number | null>(null);
  const [runningSelection, setRunningSelection] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [selectionSeed, setSelectionSeed] = useState<number | null>(null);
  const [planningRationale, setPlanningRationale] = useState('');
  const [fullPopulationData, setFullPopulationData] = useState<Record<string, unknown>[]>([]);
  const [showRationalePopup, setShowRationalePopup] = useState(false);
  const [detailedAuditTrail, setDetailedAuditTrail] = useState<Record<string, unknown> | null>(null);
  const rationaleRef = useRef<HTMLDivElement>(null);

  // ─── Engagement ────────────────────────────────────────────────────────────
  const [engagementId, setEngagementId] = useState<string | null>(null);
  const [error, setError] = useState('');

  // Access request state
  const [accessRequesting, setAccessRequesting] = useState(false);
  const [accessRequestSent, setAccessRequestSent] = useState<{ notifiedCount: number; notifiedUsers: string[] } | null>(null);

  // Review state
  const [reviews, setReviews] = useState<{ id: string; decision: string; notes: string | null; createdAt: string; reviewer: { name: string; displayId: string } }[]>([]);
  const [reviewNotes, setReviewNotes] = useState('');
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [runLocked, setRunLocked] = useState(false);

  // ─── Load periods ──────────────────────────────────────────────────────────

  const loadPeriods = useCallback(async (clientId: string) => {
    setPeriodsLoading(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/periods`);
      const data = await res.json();
      setPeriods(Array.isArray(data) ? data : []);
    } catch { setPeriods([]); }
    setPeriodsLoading(false);
  }, []);

  // ─── Check access (PeriodProductAssignment for "Sampling") ─────────────────

  const checkAccess = useCallback(async (clientId: string, periodId: string) => {
    try {
      const res = await fetch(`/api/clients/${clientId}/periods`);
      const allPeriods = await res.json();
      const period = allPeriods.find((p: Period & { productAssignments?: { productKey: string }[] }) => p.id === periodId);
      if (!period) { setHasAccess(false); return false; }
      const assignments = (period as { productAssignments?: { productKey: string }[] }).productAssignments || [];
      const hasSampling = assignments.some((a: { productKey: string }) => a.productKey === 'Sampling');
      setHasAccess(hasSampling);
      return hasSampling;
    } catch { setHasAccess(false); return false; }
  }, []);

  // ─── Select client ─────────────────────────────────────────────────────────

  function handleSelectClient(client: Client) {
    setSelectedClient(client);
    setSelectedPeriod(null);
    setHasAccess(null);
    loadPeriods(client.id);
  }

  async function handleSelectPeriod(period: Period) {
    if (!selectedClient) return;
    setSelectedPeriod(period);
    const access = await checkAccess(selectedClient.id, period.id);
    if (access) {
      setStep('configure');
    } else {
      setStep('no-access');
    }
  }

  // ─── File upload handler ───────────────────────────────────────────────────

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError('');

    try {
      // Parse locally using FileReader
      const buffer = await file.arrayBuffer();
      const { read, utils } = await import('xlsx');
      const wb = read(buffer, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows: Record<string, unknown>[] = utils.sheet_to_json(sheet, { defval: '' });

      if (rows.length === 0) {
        setError('File contains no data rows');
        setUploading(false);
        return;
      }

      const columns = Object.keys(rows[0]);
      setUploadedColumns(columns);
      setUploadedPreview(rows.slice(0, 5));
      setUploadedFileName(file.name);
      setPopulationCount(rows.length);
      setFullPopulationData(rows);
      applyAutoMapping(columns);
      setStep('map');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse file');
    }
    setUploading(false);
  }

  // ─── Bank statement PDF upload ──────────────────────────────────────────

  async function handleBankStatementUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBankStatementParsing(true);
    setError('');
    setBankStatementMeta(null);

    try {
      // Ensure engagement exists before uploading
      let eid = engagementId;
      if (!eid && selectedClient && selectedPeriod) {
        const engRes = await fetch('/api/sampling/engagement', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientId: selectedClient.id,
            periodId: selectedPeriod.id,
            auditArea: auditData.dataType,
            testingType: 'test_of_details',
            auditData,
          }),
        });
        if (!engRes.ok) {
          const err = await engRes.json().catch(() => null);
          throw new Error(err?.error || 'Failed to create engagement');
        }
        const eng = await engRes.json();
        eid = eng.id;
        setEngagementId(eng.id);
      }

      if (!eid) throw new Error('Please select a client and period first');

      // Step 1: Upload to blob + enqueue for async worker processing
      const formData = new FormData();
      formData.append('file', file);
      formData.append('engagementId', eid);

      const uploadRes = await fetch('/api/sampling/upload-bank-statement', {
        method: 'POST',
        body: formData,
      });

      if (!uploadRes.ok) {
        const err = await uploadRes.json().catch(() => ({ error: 'Upload failed' }));
        throw new Error(err.error || 'Failed to upload bank statement');
      }

      const { populationId } = await uploadRes.json();

      // Show background task dot
      const taskId = `bank-stmt-${populationId}`;
      addTask({
        id: taskId,
        clientName: selectedClient?.clientName || '',
        activity: 'Bank Statement Extraction',
        status: 'running',
        toolPath: '/tools/sampling',
      });

      // Step 2: Poll for worker completion
      let attempts = 0;
      const maxAttempts = 200; // 5 minutes at 1.5s intervals
      while (attempts < maxAttempts) {
        await new Promise(r => setTimeout(r, 1500));
        attempts++;

        const statusRes = await fetch(`/api/sampling/population-status?populationId=${populationId}`);
        if (!statusRes.ok) continue;

        const status = await statusRes.json();

        if (status.status === 'failed') {
          updateTask(taskId, { status: 'error', error: status.error || 'Parsing failed' });
          throw new Error(status.error || 'Bank statement parsing failed');
        }

        if (status.status === 'complete') {
          updateTask(taskId, { status: 'completed' });
          const { rows, columns, metadata } = status as {
            rows: Record<string, unknown>[];
            columns: string[];
            metadata: Record<string, unknown>;
          };

          setUploadedColumns(columns);
          setUploadedPreview(rows.slice(0, 5));
          setUploadedFileName(file.name);
          setPopulationCount(rows.length);
          setFullPopulationData(rows);
          setBankStatementMeta(metadata);

          // Auto-map bank statement columns
          setColumnMapping({
            transactionId: 'Transaction ID',
            date: 'Date',
            amount: 'Amount',
            description: 'Description',
          });

          setStep('map');
          setBankStatementParsing(false);
          return;
        }
        // status === 'parsing' — keep polling
      }

      throw new Error('Bank statement parsing timed out. Please try again.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse bank statement');
    }
    setBankStatementParsing(false);
  }

  // ─── Check accounting connection (handled by XeroFetchPopulation) ───────

  // ─── Handle spreadsheet paste ──────────────────────────────────────────

  function handleSpreadsheetPaste(e: React.ClipboardEvent) {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    if (!text.trim()) return;

    const rows = text.split('\n').map(row => row.split('\t'));
    // Ensure at least as many columns as the widest row
    const maxCols = Math.max(...rows.map(r => r.length), 5);
    const normalized = rows.map(r => {
      while (r.length < maxCols) r.push('');
      return r;
    });

    setSpreadsheetData(normalized);

    // Auto-detect columns from first row (header)
    if (normalized.length > 1) {
      const headers = normalized[0];
      setUploadedColumns(headers);
      const dataRows: Record<string, unknown>[] = [];
      for (let i = 1; i < normalized.length; i++) {
        const row: Record<string, unknown> = {};
        headers.forEach((h, j) => { row[h] = normalized[i][j] || ''; });
        dataRows.push(row);
      }
      setUploadedPreview(dataRows.slice(0, 5));
      setUploadedFileName('Pasted data');
      setPopulationCount(dataRows.length);
      setFullPopulationData(dataRows);
      applyAutoMapping(headers);
      setStep('map');
    }
  }

  function handleSpreadsheetCellChange(row: number, col: number, value: string) {
    setSpreadsheetData(prev => {
      const updated = prev.map(r => [...r]);
      // Expand rows if needed
      while (updated.length <= row) updated.push(new Array(updated[0]?.length || 5).fill(''));
      // Expand cols if needed
      if (col >= (updated[0]?.length || 0)) {
        updated.forEach(r => { while (r.length <= col) r.push(''); });
      }
      updated[row][col] = value;
      return updated;
    });
  }

  function processSpreadsheetData() {
    if (spreadsheetData.length < 2) {
      setError('Please enter at least a header row and one data row');
      return;
    }
    const headers = spreadsheetData[0].map(h => h.trim()).filter(h => h);
    if (headers.length === 0) {
      setError('First row must contain column headers');
      return;
    }
    setUploadedColumns(headers);
    const dataRows: Record<string, unknown>[] = [];
    for (let i = 1; i < spreadsheetData.length; i++) {
      const row: Record<string, unknown> = {};
      let hasData = false;
      headers.forEach((h, j) => {
        const v = spreadsheetData[i][j] || '';
        row[h] = v;
        if (v.trim()) hasData = true;
      });
      if (hasData) dataRows.push(row);
    }
    if (dataRows.length === 0) {
      setError('No data rows found');
      return;
    }
    setUploadedPreview(dataRows.slice(0, 5));
    setUploadedFileName('Pasted data');
    setPopulationCount(dataRows.length);
    setFullPopulationData(dataRows);
    applyAutoMapping(headers);
    setStep('map');
  }

  // ─── Assess fixed sample size justification ────────────────────────────

  // ─── Shared AI defensibility assessment ─────────────────────────────────
  // Used by fixed sample size, composite threshold, judgemental, and stratification

  async function assessDefensibility(
    type: 'fixed_size' | 'composite_threshold' | 'judgemental' | 'stratification',
    justification: string,
    description?: string,
    callbacks?: {
      setResult: (v: 'defensible' | 'weak' | 'indefensible' | null) => void;
      setFeedback: (v: string) => void;
      setAssessing: (v: boolean) => void;
    },
  ) {
    const setResult = callbacks?.setResult || setJustificationResult;
    const setFeedback = callbacks?.setFeedback || setJustificationFeedback;
    const setAssessing = callbacks?.setAssessing || setJustificationAssessing;

    if (!justification.trim() || justification.length < 10) {
      setResult('indefensible');
      setFeedback('Justification is too brief. Please provide a detailed explanation referencing audit risk, materiality, or the nature of the population.');
      return;
    }

    setAssessing(true);
    setResult(null);
    setFeedback('');

    try {
      const res = await fetch('/api/sampling/assess-justification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          justification,
          description,
          context: {
            method: samplingMethod,
            sampleSize: fixedSampleSize,
            populationSize: populationCount,
            threshold: compositeThreshold,
            dataType: auditData.dataType,
            materiality: auditData.performanceMateriality,
          },
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const verdict = data.verdict === 'potentially_weak' ? 'weak' : data.verdict;
        setResult(verdict as 'defensible' | 'weak' | 'indefensible');
        const parts: string[] = [];
        if (data.assessment) parts.push(data.assessment);
        if (data.concerns?.length) parts.push('Concerns: ' + data.concerns.join('; '));
        if (data.suggestions?.length) parts.push('Suggestions: ' + data.suggestions.join('; '));
        setFeedback(parts.join('\n'));
      } else {
        setResult('weak');
        setFeedback('Could not complete AI assessment. Please review manually.');
      }
    } catch {
      setResult('weak');
      setFeedback('Assessment service unavailable. Please review manually.');
    }
    setAssessing(false);
  }

  async function assessJustification() {
    await assessDefensibility('fixed_size', fixedJustification);
  }

  // ─── Auto-map columns by name matching ──────────────────────────────────

  function autoMapColumns(columns: string[]): Partial<ColumnMapping> {
    const lower = columns.map(c => c.toLowerCase().trim());
    const mapping: Partial<ColumnMapping> = {};

    // Try to match each required field
    const patterns: { field: keyof ColumnMapping; matches: string[] }[] = [
      { field: 'transactionId', matches: ['transaction id', 'trans id', 'id', 'reference', 'ref', 'invoice', 'invoice no', 'doc no', 'document id', 'entry id', 'txn id'] },
      { field: 'date', matches: ['date', 'transaction date', 'trans date', 'posting date', 'invoice date', 'entry date', 'doc date'] },
      { field: 'amount', matches: ['amount', 'value', 'total', 'net', 'gross', 'debit', 'balance', 'sum'] },
      { field: 'description', matches: ['description', 'desc', 'narrative', 'memo', 'details', 'name', 'particulars', 'text'] },
      { field: 'preparer', matches: ['preparer', 'user', 'created by', 'entered by', 'posted by', 'processor'] },
      { field: 'vendorCustomer', matches: ['vendor', 'customer', 'supplier', 'client', 'counterparty', 'debtor', 'creditor', 'contact'] },
      { field: 'glCode', matches: ['gl code', 'account code', 'account', 'gl', 'nominal', 'nominal code', 'ledger code', 'account number'] },
      { field: 'overrideFlag', matches: ['override', 'manual override', 'override flag'] },
      { field: 'exceptionFlag', matches: ['exception', 'error', 'exception flag', 'rework'] },
    ];

    for (const { field, matches } of patterns) {
      const idx = lower.findIndex(col => matches.some(m => col === m || col.includes(m)));
      if (idx >= 0 && !Object.values(mapping).includes(columns[idx])) {
        mapping[field] = columns[idx];
      }
    }

    return mapping;
  }

  function loadSavedMapping(clientId: string) {
    const key = `sampling-mapping-${clientId}`;
    try {
      const stored = localStorage.getItem(key);
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<ColumnMapping>;
        setSavedMappings(prev => ({ ...prev, [clientId]: parsed }));
        return parsed;
      }
    } catch { /* silent */ }
    return null;
  }

  function saveMapping(clientId: string, mapping: Partial<ColumnMapping>) {
    const key = `sampling-mapping-${clientId}`;
    try {
      localStorage.setItem(key, JSON.stringify(mapping));
      setMappingSaved(true);
      setTimeout(() => setMappingSaved(false), 2000);
    } catch { /* silent */ }
  }

  function applyAutoMapping(columns: string[]) {
    // Try saved mapping first, then auto-detect
    const saved = selectedClient ? loadSavedMapping(selectedClient.id) : null;
    if (saved) {
      // Only apply fields that match current columns
      const valid: Partial<ColumnMapping> = {};
      for (const [field, col] of Object.entries(saved)) {
        if (col && columns.includes(col as string)) {
          (valid as Record<string, string>)[field] = col as string;
        }
      }
      if (Object.keys(valid).length > 0) {
        setColumnMapping(valid);
        return;
      }
    }
    // Fall back to auto-detection
    setColumnMapping(autoMapColumns(columns));
  }

  // ─── Validate mapping ─────────────────────────────────────────────────────

  function validateMapping(): boolean {
    const errors: string[] = [];
    if (!columnMapping.transactionId) errors.push('Transaction ID column is required');
    if (!columnMapping.date) errors.push('Date column is required');
    if (!columnMapping.amount) errors.push('Amount column is required');
    if (!columnMapping.description) errors.push('Description column is required');
    setMappingErrors(errors);
    return errors.length === 0;
  }

  function proceedToMethod() {
    if (!validateMapping()) return;

    // Compute population total from the amount column using full dataset
    const amountCol = columnMapping.amount!;
    const total = fullPopulationData.reduce((sum, r) => sum + (parseFloat(String(r[amountCol])) || 0), 0);
    setPopulationTotal(Math.round(total * 100) / 100);
    setPopulationCount(fullPopulationData.length);

    // Save internal data quality for engine use (not shown to user as a step)
    const idCol = columnMapping.transactionId!;
    const ids = fullPopulationData.map(r => String(r[idCol]));
    const uniqueIds = new Set(ids);
    const duplicates = ids.length - uniqueIds.size;

    if (duplicates > 0) {
      setError(`${duplicates} duplicate Transaction IDs found. Please fix your data before proceeding.`);
      return;
    }

    setError('');
    setStep('method');
  }

  // ─── Run Auto Select ────────────────────────────────────────────────────

  async function runAutoSelect() {
    if (!selectedClient || !selectedPeriod || fullPopulationData.length === 0) return;
    setRunningSelection(true);
    setError('');

    try {
      // Create engagement if needed
      let eid = engagementId;
      if (!eid) {
        const engRes = await fetch('/api/sampling/engagement', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientId: selectedClient.id,
            periodId: selectedPeriod.id,
            auditArea: auditData.dataType,
            testingType: 'test_of_details',
            auditData,
          }),
        });
        if (!engRes.ok) {
          const err = await engRes.json().catch(() => null);
          throw new Error(err?.error || 'Failed to create engagement');
        }
        const eng = await engRes.json();
        eid = eng.id;
        setEngagementId(eng.id);
      }

      // Run sampling
      const runRes = await fetch('/api/sampling/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          engagementId: eid,
          populationData: fullPopulationData,
          columnMapping,
          method: samplingMethod,
          stratification,
          errorMetric: randomBasis,
          sampleSizeStrategy,
          sampleSize: fixedSampleSize,
          confidence: (firmConfig?.confidenceLevel || 95) / 100,
          tolerableMisstatement: auditData.tolerableMisstatement,
          kFactor: firmConfig?.riskMatrix
            ? firmConfig.riskMatrix[['Low', 'Medium', 'High'].indexOf(inherentRisk)]?.[['Low', 'Medium', 'High'].indexOf(specificRisk)] || 20
            : 20,
          // Method-specific params
          systematicBasis,
          confidenceFactor: 3.0,
          compositeThreshold,
          compositeResidualMethod,
          // Mode B params
          ...(stratification === 'stratified' ? {
            method: 'stratified',
            stratificationFeatures: aiStratSuggestion?.features
              ?? (columnMapping.amount
                ? [
                    { name: 'Amount', column: columnMapping.amount, type: 'numeric', weight: 1 },
                    ...(columnMapping.preparer ? [{ name: 'Preparer', column: columnMapping.preparer, type: 'categorical', weight: 0.5 }] : []),
                    ...(columnMapping.overrideFlag ? [{ name: 'Override', column: columnMapping.overrideFlag, type: 'flag', weight: 1 }] : []),
                    ...(columnMapping.exceptionFlag ? [{ name: 'Exception', column: columnMapping.exceptionFlag, type: 'flag', weight: 1 }] : []),
                  ]
                : []),
            allocationRule,
            allocationParams: {
              mediumPct: 30,
              lowPct: 10,
              totalN: ruleBTotal,
              highN: ruleCHigh,
              mediumN: ruleCMedium,
              lowN: ruleCLow,
            },
            explainabilityLevel: 'detailed',
          } : {}),
        }),
      });

      if (!runRes.ok) {
        const err = await runRes.json().catch(() => null);
        throw new Error(err?.error || 'Sampling failed');
      }

      const result = await runRes.json();
      setRunId(result.runId);
      setSelectedIndices(new Set(result.selectedIndices as number[]));
      setSampleTotal(result.sampleTotal);
      setCoverage(result.coverage);
      setSelectionSeed(result.seed);
      setPlanningRationale(result.planningRationale || '');
      setPopulationTotal(result.populationTotal);
      setDetailedAuditTrail(result.auditTrail || null);
      if (result.auditTrail?.strata) {
        setStratificationResults({ strata: result.auditTrail.strata });
      }
      if (result.auditTrail?.itemProfiles) {
        setItemProfiles(result.auditTrail.itemProfiles);
      }

      // Update the fixed sample size display to match actual
      if (sampleSizeStrategy !== 'fixed') {
        setFixedSampleSize(result.sampleSize);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Auto Select failed');
    }
    setRunningSelection(false);
  }

  // ─── Render helpers ────────────────────────────────────────────────────────

  const filteredClients = assignedClients.filter(c =>
    c.clientName.toLowerCase().includes(clientSearch.toLowerCase())
  );

  const confidenceLevel = firmConfig?.confidenceLevel ?? 95;

  // ═════════════════════════════════════════════════════════════════════════════
  // STEP: Client & Period Selection
  // ═════════════════════════════════════════════════════════════════════════════

  if (step === 'client') {
    return (
      <div className="container mx-auto px-4 py-8 max-w-3xl">
        <h1 className="text-2xl font-bold text-slate-800 mb-1">Sample Calculator</h1>
        <p className="text-sm text-slate-500 mb-6">Select a client and accounting period to begin.</p>

        {/* Client selector */}
        <div className="bg-white rounded-lg border border-slate-200 p-5 mb-4">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Select Client</h3>
          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={clientSearch}
              onChange={(e) => setClientSearch(e.target.value)}
              placeholder="Search clients..."
              className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="max-h-48 overflow-y-auto space-y-1">
            {filteredClients.map(c => (
              <button
                key={c.id}
                onClick={() => handleSelectClient(c)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                  selectedClient?.id === c.id
                    ? 'bg-blue-50 border border-blue-200 text-blue-800 font-medium'
                    : 'hover:bg-slate-50 text-slate-700'
                }`}
              >
                {c.clientName}
              </button>
            ))}
            {filteredClients.length === 0 && (
              <p className="text-sm text-slate-400 py-2 text-center">No clients found</p>
            )}
          </div>
        </div>

        {/* Period selector */}
        {selectedClient && (
          <div className="bg-white rounded-lg border border-slate-200 p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-slate-700">Select Accounting Period</h3>
              <button
                onClick={() => window.open(`/clients/new-period?clientId=${selectedClient.id}`, '_blank')}
                className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700"
              >
                <Plus className="h-3 w-3" /> Add Period
              </button>
            </div>
            {periodsLoading ? (
              <div className="flex items-center gap-2 text-sm text-slate-500 py-4 justify-center">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading...
              </div>
            ) : periods.length === 0 ? (
              <p className="text-sm text-slate-400 py-4 text-center">No periods defined for this client.</p>
            ) : (
              <div className="space-y-1">
                {periods.map(p => (
                  <button
                    key={p.id}
                    onClick={() => handleSelectPeriod(p)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                      selectedPeriod?.id === p.id
                        ? 'bg-blue-50 border border-blue-200 text-blue-800 font-medium'
                        : 'hover:bg-slate-50 text-slate-700'
                    }`}
                  >
                    {formatPeriod(p.startDate, p.endDate)}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // ═════════════════════════════════════════════════════════════════════════════
  // STEP: No Access
  // ═════════════════════════════════════════════════════════════════════════════

  if (step === 'no-access') {
    return (
      <div className="container mx-auto px-4 py-8 max-w-lg text-center">
        <Lock className="h-12 w-12 text-slate-300 mx-auto mb-4" />
        <h2 className="text-lg font-semibold text-slate-800 mb-2">Access Required</h2>
        <p className="text-sm text-slate-500 mb-6">
          You do not have access to the Sample Calculator for {selectedClient?.clientName} in the selected period.
        </p>
        {accessRequestSent ? (
          <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700 mb-4">
            <CheckCircle2 className="h-4 w-4 inline mr-1" />
            Access request sent to {accessRequestSent.notifiedCount} portfolio manager{accessRequestSent.notifiedCount !== 1 ? 's' : ''}: {accessRequestSent.notifiedUsers.join(', ')}
          </div>
        ) : (
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={async () => {
                if (!selectedClient || !selectedPeriod) return;
                setAccessRequesting(true);
                try {
                  const res = await fetch('/api/sampling/request-access', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ clientId: selectedClient.id, periodId: selectedPeriod.id }),
                  });
                  if (res.ok) {
                    const data = await res.json();
                    setAccessRequestSent({ notifiedCount: data.notifiedCount, notifiedUsers: data.notifiedUsers });
                  } else {
                    const err = await res.json().catch(() => null);
                    setError(err?.error || 'Failed to send request');
                  }
                } catch { setError('Failed to send request'); }
                setAccessRequesting(false);
              }}
              disabled={accessRequesting}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 transition-colors"
            >
              {accessRequesting ? <><Loader2 className="h-4 w-4 animate-spin inline mr-1" /> Requesting...</> : 'Request Access'}
            </button>
            <button
              onClick={() => { setStep('client'); setSelectedPeriod(null); setHasAccess(null); setAccessRequestSent(null); }}
              className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800 transition-colors"
            >
              Return to Home
            </button>
          </div>
        )}
      </div>
    );
  }

  // ═════════════════════════════════════════════════════════════════════════════
  // MAIN WORKSPACE (configure, upload, map, quality, method)
  // ═════════════════════════════════════════════════════════════════════════════

  return (
    <div className="container mx-auto px-4 py-6 max-w-7xl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <button
          onClick={() => { setStep('client'); setSelectedPeriod(null); setHasAccess(null); setEngagementId(null); }}
          className="p-1 text-slate-400 hover:text-slate-600 transition-colors"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-slate-800">
            Sample Calculator — {selectedClient?.clientName}
          </h1>
          <p className="text-xs text-slate-500">
            {selectedPeriod ? formatPeriod(selectedPeriod.startDate, selectedPeriod.endDate) : ''}
            {confidenceLevel ? ` | Confidence: ${confidenceLevel}%` : ''}
          </p>
        </div>
        <button
          onClick={() => setShowResetConfirm(true)}
          className="px-3 py-1.5 text-xs text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-50 hover:text-slate-700 transition-colors"
        >
          Reset
        </button>
      </div>

      {/* Reset confirmation */}
      {showResetConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-sm mx-4 p-5">
            <h3 className="text-base font-semibold text-slate-900 mb-2">Reset All Parameters?</h3>
            <p className="text-sm text-slate-500 mb-4">This will clear all sampling parameters, audit data, population data, and results. This cannot be undone.</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowResetConfirm(false)} className="px-3 py-1.5 text-sm text-slate-600 hover:text-slate-800">Cancel</button>
              <button onClick={() => {
                setAuditData({ performanceMateriality: 0, clearlyTrivial: 0, tolerableMisstatement: 0, functionalCurrency: 'GBP', dataType: 'Revenue', testType: 'one_tail' });
                setSamplingMethod('random'); setStratification('simple'); setRandomBasis('net_signed');
                setSystematicBasis('single_stage'); setSampleSizeStrategy('calculator'); setFixedSampleSize(25);
                setInherentRisk('Medium'); setSpecificRisk('Medium');
                setCompositeThreshold(0); setCompositeJustification(''); setCompositeResidualMethod('random');
                setJudgementalDescription(''); setJudgementalJustification('');
                setFixedJustification(''); setStratRationale('');
                setSelectedIndices(new Set()); setSampleTotal(null); setCoverage(null);
                setRunId(null); setEngagementId(null);
                setAiStratSuggestion(null); setItemProfiles(null); setStratificationResults(null);
                setFullPopulationData([]); setUploadedColumns([]); setUploadedPreview([]);
                setPopulationCount(0); setPopulationTotal(0);
                setError(''); setStep('configure');
                setShowResetConfirm(false);
              }} className="px-4 py-1.5 text-sm font-medium rounded-lg bg-red-600 text-white hover:bg-red-700">Reset</button>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex items-center gap-2">
          <AlertCircle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      {/* Previous Sessions */}
      {selectedClient && selectedPeriod && (
        <div className="mb-4">
          <button
            onClick={async () => {
              setShowHistory(!showHistory);
              if (!showHistory && engagementHistory.length === 0) {
                try {
                  const res = await fetch(`/api/sampling/engagement?clientId=${selectedClient.id}&periodId=${selectedPeriod.id}`);
                  if (res.ok) setEngagementHistory(await res.json());
                } catch { /* silent */ }
              }
            }}
            className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 transition-colors"
          >
            <Clock className="h-3.5 w-3.5" />
            Previous Sessions
            {engagementHistory.length > 0 && <span className="text-slate-400">({engagementHistory.length})</span>}
            <ChevronDown className={`h-3 w-3 transition-transform ${showHistory ? 'rotate-180' : ''}`} />
          </button>
          {showHistory && engagementHistory.length > 0 && (
            <div className="mt-2 max-h-32 overflow-y-auto space-y-1 border border-slate-100 rounded-lg p-2">
              {engagementHistory.map(eng => (
                <button
                  key={eng.id}
                  onClick={() => {
                    setEngagementId(eng.id);
                    // TODO: load full engagement data (audit data, population, results)
                  }}
                  className={`w-full text-left px-2 py-1.5 rounded text-xs transition-colors ${
                    engagementId === eng.id
                      ? 'bg-blue-50 border border-blue-200 text-blue-700'
                      : 'hover:bg-slate-50 text-slate-600'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span>{new Date(eng.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                      eng.status === 'locked' ? 'bg-green-100 text-green-700'
                      : eng.status === 'complete' ? 'bg-blue-100 text-blue-700'
                      : 'bg-slate-100 text-slate-500'
                    }`}>{eng.status}</span>
                  </div>
                  <div className="text-[10px] text-slate-400 mt-0.5">
                    {eng.auditArea || '—'} | {eng._count.runs} run{eng._count.runs !== 1 ? 's' : ''}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-12 gap-6">
        {/* ─── LEFT: Audit Data + Upload ──────────────────────────────── */}
        <div className="col-span-8 space-y-4">
          {/* Audit Data Panel */}
          <div className="bg-white rounded-lg border border-slate-200 p-5">
            <h3 className="text-sm font-semibold text-slate-700 mb-3">Audit Parameters</h3>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Performance Materiality</label>
                <input
                  type="number"
                  value={auditData.performanceMateriality || ''}
                  onChange={(e) => setAuditData(prev => ({ ...prev, performanceMateriality: parseFloat(e.target.value) || 0 }))}
                  className="w-full px-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="0.00"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Clearly Trivial</label>
                <input
                  type="number"
                  value={auditData.clearlyTrivial || ''}
                  onChange={(e) => setAuditData(prev => ({ ...prev, clearlyTrivial: parseFloat(e.target.value) || 0 }))}
                  className="w-full px-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="0.00"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Tolerable Misstatement</label>
                <input
                  type="number"
                  value={auditData.tolerableMisstatement || ''}
                  onChange={(e) => setAuditData(prev => ({ ...prev, tolerableMisstatement: parseFloat(e.target.value) || 0 }))}
                  className="w-full px-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="0.00"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Functional Currency</label>
                <select
                  value={auditData.functionalCurrency}
                  onChange={(e) => setAuditData(prev => ({ ...prev, functionalCurrency: e.target.value }))}
                  className="w-full px-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Type of Data</label>
                <select
                  value={auditData.dataType}
                  onChange={(e) => {
                    const dt = e.target.value;
                    setAuditData(prev => ({ ...prev, dataType: dt, testType: defaultTestType(dt) }));
                  }}
                  className="w-full px-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {DATA_TYPES.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Type of Test</label>
                <select
                  value={auditData.testType}
                  onChange={(e) => setAuditData(prev => ({ ...prev, testType: e.target.value }))}
                  className="w-full px-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="one_tail">Single tail</option>
                  <option value="two_tail">Two tail</option>
                  <option value="multi_tail">Multi-tail</option>
                </select>
              </div>
            </div>
          </div>

          {/* Population Summary — shown once data is loaded */}
          {populationCount > 0 && (
            <div className="bg-white rounded-lg border border-slate-200 p-4">
              <h3 className="text-sm font-semibold text-slate-700 mb-2">Population Summary</h3>
              <div className="grid grid-cols-4 gap-3">
                <div className="p-2.5 bg-slate-50 rounded-lg">
                  <span className="text-[10px] text-slate-500 uppercase tracking-wider">Population Size</span>
                  <p className="text-base font-bold text-slate-800">{populationCount.toLocaleString()}</p>
                </div>
                <div className="p-2.5 bg-slate-50 rounded-lg">
                  <span className="text-[10px] text-slate-500 uppercase tracking-wider">Population Total</span>
                  <p className="text-base font-bold text-slate-800">
                    {populationTotal > 0
                      ? `${auditData.functionalCurrency} ${populationTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                      : '—'}
                  </p>
                </div>
                <div className="p-2.5 bg-blue-50 rounded-lg border border-blue-100">
                  <span className="text-[10px] text-blue-600 uppercase tracking-wider">Sample Total</span>
                  <p className="text-base font-bold text-blue-800">
                    {sampleTotal !== null
                      ? `${auditData.functionalCurrency} ${sampleTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                      : 'Unknown'}
                  </p>
                  <p className="text-[10px] text-blue-400">
                    {selectedIndices.size > 0 ? `${selectedIndices.size} items` : 'Pending selection'}
                  </p>
                </div>
                <div className="p-2.5 bg-slate-50 rounded-lg">
                  <span className="text-[10px] text-slate-500 uppercase tracking-wider">Coverage %</span>
                  <p className="text-base font-bold text-slate-800">
                    {coverage !== null
                      ? coverage.toFixed(2) + '%'
                      : '—'}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Population Data — 3 input modes */}
          {(step === 'configure' || step === 'upload') && (
            <div className="bg-white rounded-lg border border-slate-200 p-5">
              <h3 className="text-sm font-semibold text-slate-700 mb-3">Population Data</h3>

              {/* Mode tabs */}
              <div className="flex gap-1 mb-4 bg-slate-100 rounded-lg p-0.5">
                <button
                  onClick={() => setDataInputMode('upload')}
                  className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    dataInputMode === 'upload' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  <Upload className="h-3 w-3" /> Upload Spreadsheet
                </button>
                <button
                  onClick={() => setDataInputMode('paste')}
                  className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    dataInputMode === 'paste' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  <Grid3X3 className="h-3 w-3" /> Paste Data
                </button>
                <button
                  onClick={() => setDataInputMode('connect')}
                  className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    dataInputMode === 'connect' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  <Link2 className="h-3 w-3" />
                  {selectedClient?.software || 'Accounting'}
                </button>
                <button
                  onClick={() => setDataInputMode('bank')}
                  className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    dataInputMode === 'bank' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  <FileSpreadsheet className="h-3 w-3" /> Bank Statement
                </button>
              </div>

              {/* Upload mode */}
              {dataInputMode === 'upload' && (
                <div className="border-2 border-dashed border-slate-200 rounded-lg p-8 text-center">
                  <FileSpreadsheet className="h-10 w-10 text-slate-300 mx-auto mb-3" />
                  <p className="text-sm text-slate-600 mb-2">Upload Excel (.xlsx) or CSV file</p>
                  <label className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 cursor-pointer transition-colors">
                    {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                    Choose File
                    <input
                      type="file"
                      accept=".xlsx,.csv"
                      onChange={handleFileUpload}
                      className="hidden"
                      disabled={uploading}
                    />
                  </label>
                </div>
              )}

              {/* Paste / Spreadsheet mode */}
              {dataInputMode === 'paste' && (
                <div>
                  <p className="text-xs text-slate-400 mb-2">
                    Paste data from Excel or type directly. First row should be column headers.
                  </p>
                  <div
                    ref={spreadsheetRef}
                    onPaste={handleSpreadsheetPaste}
                    className="border border-slate-200 rounded-lg overflow-x-auto overflow-y-auto max-h-[400px]"
                    style={{ maxWidth: '100%' }}
                  >
                    <table className="text-xs border-collapse" style={{ minWidth: `${Math.max(spreadsheetData[0]?.length || 5, 5) * 120 + 40}px` }}>
                      <tbody>
                        {spreadsheetData.map((row, ri) => (
                          <tr key={ri} className={ri === 0 ? 'bg-slate-50 font-medium sticky top-0 z-10' : ''}>
                            <td className="w-8 min-w-[32px] px-1 py-0.5 text-center text-slate-400 border-r border-b border-slate-100 bg-slate-50 text-[10px] sticky left-0 z-10">
                              {ri + 1}
                            </td>
                            {row.map((cell, ci) => (
                              <td key={ci} className="border-r border-b border-slate-100 p-0">
                                <input
                                  type="text"
                                  value={cell}
                                  onChange={(e) => handleSpreadsheetCellChange(ri, ci, e.target.value)}
                                  className="w-[120px] px-1.5 py-1 text-xs border-0 focus:outline-none focus:bg-blue-50"
                                />
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1">
                    {spreadsheetData.length} rows × {spreadsheetData[0]?.length || 0} columns
                    {spreadsheetData.length > 1 && ` • ${spreadsheetData.length - 1} data rows`}
                  </p>
                  <div className="flex items-center gap-2 mt-2">
                    <button
                      onClick={() => setSpreadsheetData(prev => [...prev, new Array(prev[0]?.length || 5).fill('')])}
                      className="text-xs text-blue-600 hover:text-blue-700"
                    >
                      + Add Row
                    </button>
                    <button
                      onClick={() => setSpreadsheetData(prev => prev.map(r => [...r, '']))}
                      className="text-xs text-blue-600 hover:text-blue-700"
                    >
                      + Add Column
                    </button>
                    <div className="flex-1" />
                    <button
                      onClick={processSpreadsheetData}
                      className="px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                    >
                      Use This Data
                    </button>
                  </div>
                </div>
              )}

              {/* Connect to accounting system mode */}
              {dataInputMode === 'connect' && selectedClient && (
                <XeroFetchPopulation
                  clientId={selectedClient.id}
                  clientName={selectedClient.clientName}
                  software={selectedClient.software}
                  contactEmail={selectedClient.contactEmail}
                  addTask={addTask}
                  updateTask={updateTask}
                  onDataLoaded={({ rows, columns, fileName }) => {
                    setUploadedColumns(columns);
                    setUploadedPreview(rows.slice(0, 5));
                    setUploadedFileName(fileName);
                    setPopulationCount(rows.length);
                    setFullPopulationData(rows);
                    applyAutoMapping(columns);
                    setStep('map');
                  }}
                />
              )}

              {/* Bank statement PDF upload */}
              {dataInputMode === 'bank' && (
                <div className="border-2 border-dashed border-slate-200 rounded-lg p-8 text-center">
                  {bankStatementParsing ? (
                    <div className="space-y-3">
                      <Loader2 className="h-10 w-10 text-blue-500 mx-auto animate-spin" />
                      <p className="text-sm text-slate-600 font-medium">Extracting transactions from bank statement...</p>
                      <p className="text-xs text-slate-400">This may take a minute for multi-page statements</p>
                    </div>
                  ) : (
                    <>
                      <FileSpreadsheet className="h-10 w-10 text-slate-300 mx-auto mb-3" />
                      <p className="text-sm text-slate-600 mb-1">Upload a bank statement PDF</p>
                      <p className="text-xs text-slate-400 mb-3">
                        Transactions will be extracted automatically using AI and loaded into the data table
                      </p>
                      <label className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 cursor-pointer transition-colors">
                        <Upload className="h-4 w-4" />
                        Choose PDF
                        <input
                          type="file"
                          accept=".pdf"
                          onChange={handleBankStatementUpload}
                          className="hidden"
                        />
                      </label>
                    </>
                  )}
                  {bankStatementMeta && (
                    <div className="mt-4 text-left bg-green-50 border border-green-200 rounded-lg p-3 text-xs text-green-700">
                      <div className="flex items-center gap-1.5 mb-1">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        <strong>{(bankStatementMeta.transactionCount as number) || 0} transactions extracted</strong>
                      </div>
                      {bankStatementMeta.bankName ? <p>Bank: {String(bankStatementMeta.bankName)}</p> : null}
                      {bankStatementMeta.accountName ? <p>Account: {String(bankStatementMeta.accountName)}</p> : null}
                      {bankStatementMeta.statementPeriod ? <p>Period: {String(bankStatementMeta.statementPeriod)}</p> : null}
                      {bankStatementMeta.currency ? <p>Currency: {String(bankStatementMeta.currency)}</p> : null}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Column mapping */}
          {step === 'map' && (
            <div className="bg-white rounded-lg border border-slate-200 p-5">
              <h3 className="text-sm font-semibold text-slate-700 mb-1">Column Mapping</h3>
              <p className="text-xs text-slate-400 mb-3">
                Map your file columns to the required fields. File: {uploadedFileName}
              </p>

              {mappingErrors.length > 0 && (
                <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
                  {mappingErrors.map((e, i) => <div key={i}>{e}</div>)}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3 mb-4">
                {/* Required fields */}
                {(['transactionId', 'date', 'amount', 'description'] as const).map(field => (
                  <div key={field}>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      {field === 'transactionId' ? 'Transaction ID' : field.charAt(0).toUpperCase() + field.slice(1)}
                      <span className="text-red-500 ml-0.5">*</span>
                    </label>
                    <select
                      value={columnMapping[field] || ''}
                      onChange={(e) => setColumnMapping(prev => ({ ...prev, [field]: e.target.value }))}
                      className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500"
                    >
                      <option value="">— Select column —</option>
                      {uploadedColumns.map(col => (
                        <option key={col} value={col}>{col}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>

              <details className="mb-4">
                <summary className="text-xs font-medium text-slate-500 cursor-pointer hover:text-slate-700">
                  Optional fields (recommended)
                </summary>
                <div className="grid grid-cols-2 gap-3 mt-2">
                  {(['preparer', 'timestamp', 'vendorCustomer', 'glCode', 'overrideFlag', 'exceptionFlag'] as const).map(field => (
                    <div key={field}>
                      <label className="block text-xs font-medium text-slate-500 mb-1">
                        {field.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase())}
                      </label>
                      <select
                        value={columnMapping[field] || ''}
                        onChange={(e) => setColumnMapping(prev => ({ ...prev, [field]: e.target.value || undefined }))}
                        className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500"
                      >
                        <option value="">— None —</option>
                        {uploadedColumns.map(col => (
                          <option key={col} value={col}>{col}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </details>

              {/* Preview */}
              {uploadedPreview.length > 0 && (
                <div className="mb-4 overflow-x-auto border border-slate-100 rounded">
                  <table className="text-xs w-full">
                    <thead className="bg-slate-50">
                      <tr>
                        {uploadedColumns.slice(0, 8).map(col => (
                          <th key={col} className="px-2 py-1 text-left font-medium text-slate-600 truncate max-w-[120px]">{col}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {uploadedPreview.slice(0, 3).map((row, i) => (
                        <tr key={i}>
                          {uploadedColumns.slice(0, 8).map(col => (
                            <td key={col} className="px-2 py-1 text-slate-500 truncate max-w-[120px]">{String(row[col] ?? '')}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="flex items-center gap-3">
                <button
                  onClick={proceedToMethod}
                  className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                >
                  Continue
                </button>
                {selectedClient && (
                  <button
                    onClick={() => saveMapping(selectedClient.id, columnMapping)}
                    className="px-3 py-2 text-xs text-slate-600 hover:text-slate-800 border border-slate-200 rounded-lg transition-colors"
                  >
                    {mappingSaved ? '✓ Saved' : 'Save Mapping for Client'}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* ─── Data table — always visible once data is loaded ──────── */}
          {fullPopulationData.length > 0 && (step === 'map' || step === 'method') && (
            <div className="space-y-4">
              {/* Auto Select bar */}
              <div className="bg-white rounded-lg border border-slate-200 p-3 flex items-center justify-between">
                {selectedIndices.size > 0 ? (
                  <div className="flex items-center gap-2 text-sm text-green-700">
                    <CheckCircle2 className="h-4 w-4" />
                    <span><strong>{selectedIndices.size}</strong> items selected</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-sm text-slate-500">
                    <BarChart3 className="h-4 w-4" />
                    <span>{step === 'map' ? 'Complete column mapping above, then run selection.' : 'Configure method on the right, then run.'}</span>
                  </div>
                )}
                <button
                  onClick={runAutoSelect}
                  disabled={runningSelection || step === 'map'}
                  className="inline-flex items-center gap-2 px-5 py-2 text-sm font-medium rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-40 transition-colors"
                >
                  {runningSelection ? <Loader2 className="h-4 w-4 animate-spin" /> : <BarChart3 className="h-4 w-4" />}
                  {selectedIndices.size > 0 ? 'Re-select' : 'Auto Select'}
                </button>
                {fullPopulationData.length > 0 && (
                  <button
                    onClick={() => setShowDistributionModal(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
                    title="Distribution analysis"
                  >
                    <BarChart3 className="h-4 w-4" />
                    Distribution
                  </button>
                )}
              </div>

              {/* Planning rationale with detail icon */}
              {planningRationale && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-700 flex items-center justify-between">
                  <div>
                    <strong>Selection rationale:</strong> {planningRationale}
                    {selectionSeed !== null && <span className="ml-2 text-blue-400">(Seed: {selectionSeed})</span>}
                  </div>
                  <button
                    onClick={() => setShowRationalePopup(true)}
                    className="ml-3 p-1 text-blue-500 hover:text-blue-700 transition-colors shrink-0"
                    title="View detailed statistical calculations"
                  >
                    <Info className="h-4 w-4" />
                  </button>
                </div>
              )}

              {/* Population data table with selection highlighting */}
              <div className="bg-white rounded-lg border border-slate-200">
                <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <h3 className="text-sm font-semibold text-slate-700">
                      Population Data
                      {selectedIndices.size > 0 && <span className="ml-2 text-green-600 font-normal">({selectedIndices.size} selected)</span>}
                    </h3>
                    {step === 'method' && (
                      <button
                        onClick={() => setStep('map')}
                        className="text-[10px] text-blue-600 hover:text-blue-700 underline"
                      >
                        Edit Mapping
                      </button>
                    )}
                  </div>
                  {selectedIndices.size > 0 && (
                    <div className="flex items-center gap-2">
                      {runId && (
                        <>
                          <button
                            onClick={async () => {
                              const res = await fetch('/api/sampling/export', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ runId, format: 'pdf' }),
                              });
                              if (res.ok) {
                                const blob = await res.blob();
                                const url = URL.createObjectURL(blob);
                                const a = document.createElement('a');
                                a.href = url; a.download = `Sampling_Plan_${selectedClient?.clientName || 'export'}.pdf`;
                                a.click(); URL.revokeObjectURL(url);
                              }
                            }}
                            className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700"
                          >
                            <Download className="h-3 w-3" /> PDF Report
                          </button>
                          <button
                            onClick={async () => {
                              const res = await fetch('/api/sampling/export', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ runId, format: 'excel' }),
                              });
                              if (res.ok) {
                                const blob = await res.blob();
                                const url = URL.createObjectURL(blob);
                                const a = document.createElement('a');
                                a.href = url; a.download = `Sample_Schedule_${selectedClient?.clientName || 'export'}.xlsx`;
                                a.click(); URL.revokeObjectURL(url);
                              }
                            }}
                            className="inline-flex items-center gap-1 text-xs text-green-600 hover:text-green-700"
                          >
                            <FileSpreadsheet className="h-3 w-3" /> Excel Schedule
                          </button>
                        </>
                      )}
                      <button
                        onClick={() => {
                          const headers = uploadedColumns.join(',');
                          const rows = fullPopulationData
                            .filter((_, i) => selectedIndices.has(i))
                            .map(row => uploadedColumns.map(col => `"${String(row[col] || '').replace(/"/g, '""')}"`).join(','));
                          const csv = [headers, ...rows].join('\n');
                          const blob = new Blob([csv], { type: 'text/csv' });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url; a.download = `sample_${selectedClient?.clientName || 'export'}.csv`;
                          a.click(); URL.revokeObjectURL(url);
                        }}
                        className="text-xs text-slate-500 hover:text-slate-700"
                      >
                        CSV
                      </button>
                    </div>
                  )}
                </div>
                <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10">
                      <tr>
                        <th className="px-2 py-1.5 text-left font-semibold text-slate-600 w-8">#</th>
                        {selectedIndices.size > 0 && (
                          <th className="px-2 py-1.5 text-center font-semibold text-slate-600 w-8">Sel</th>
                        )}
                        {uploadedColumns.slice(0, 8).map(col => (
                          <th key={col} className="px-2 py-1.5 text-left font-semibold text-slate-600 truncate max-w-[120px]">{col}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {fullPopulationData.map((row, i) => {
                        const isSelected = selectedIndices.has(i);
                        return (
                          <tr key={i} className={isSelected ? 'bg-green-50' : ''}>
                            <td className="px-2 py-1 text-slate-400">{i + 1}</td>
                            {selectedIndices.size > 0 && (
                              <td className="px-2 py-1 text-center">
                                {isSelected && <span className="inline-block w-3.5 h-3.5 rounded-full bg-green-500" />}
                              </td>
                            )}
                            {uploadedColumns.slice(0, 8).map(col => (
                              <td key={col} className={`px-2 py-1 truncate max-w-[120px] ${isSelected ? 'text-green-800 font-medium' : 'text-slate-500'}`}>
                                {String(row[col] ?? '')}
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ─── RIGHT: Sampling Method Panel ───────────────────────────── */}
        <div className="col-span-4 space-y-4">
          <div className="bg-white rounded-lg border border-slate-200 p-5">
            <h3 className="text-sm font-semibold text-slate-700 mb-3">Sampling Method</h3>

            {/* Simple / Stratified toggle */}
            <div className="flex gap-1 mb-4 bg-slate-100 rounded-lg p-0.5">
              {(['simple', 'stratified'] as const).map(s => (
                <button
                  key={s}
                  onClick={() => setStratification(s)}
                  className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    stratification === s ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </button>
              ))}
            </div>

            {/* Mode B: Stratification config when Stratified is selected */}
            {stratification === 'stratified' && (
              <div className="space-y-3 mb-4">
                <div className="p-3 bg-purple-50 border border-purple-200 rounded-lg text-xs text-purple-700">
                  <strong>AI Risk Stratification</strong> — Population will be segmented into High/Medium/Low risk strata using outlier detection, clustering, and rule-based scoring.
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1.5">Allocation Rule</label>
                  <div className="space-y-1">
                    {[
                      { key: 'rule_a' as const, label: 'Rule A: 100% High, 30% Medium, 10% Low' },
                      { key: 'rule_b' as const, label: 'Rule B: Fixed total, proportional by risk' },
                      { key: 'rule_c' as const, label: 'Rule C: Custom per stratum' },
                    ].map(opt => (
                      <label key={opt.key} className="flex items-center gap-2 text-xs text-slate-700">
                        <input type="radio" name="allocationRule" checked={allocationRule === opt.key} onChange={() => setAllocationRule(opt.key)} className="text-purple-600" />
                        {opt.label}
                      </label>
                    ))}
                  </div>
                </div>

                {allocationRule === 'rule_b' && (
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">Total sample size</label>
                    <input type="number" min={1} value={ruleBTotal} onChange={(e) => setRuleBTotal(parseInt(e.target.value) || 50)} className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-purple-500" />
                  </div>
                )}

                {allocationRule === 'rule_c' && (
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="block text-[10px] font-medium text-red-600 mb-1">High</label>
                      <input type="number" min={0} value={ruleCHigh} onChange={(e) => setRuleCHigh(parseInt(e.target.value) || 0)} className="w-full px-2 py-1 text-xs border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-red-400" />
                    </div>
                    <div>
                      <label className="block text-[10px] font-medium text-amber-600 mb-1">Medium</label>
                      <input type="number" min={0} value={ruleCMedium} onChange={(e) => setRuleCMedium(parseInt(e.target.value) || 0)} className="w-full px-2 py-1 text-xs border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-amber-400" />
                    </div>
                    <div>
                      <label className="block text-[10px] font-medium text-green-600 mb-1">Low</label>
                      <input type="number" min={0} value={ruleCLow} onChange={(e) => setRuleCLow(parseInt(e.target.value) || 0)} className="w-full px-2 py-1 text-xs border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-green-400" />
                    </div>
                  </div>
                )}

                <AISuggestStratification
                  columnMapping={columnMapping}
                  fullPopulationData={fullPopulationData}
                  auditData={{ performanceMateriality: auditData.performanceMateriality, tolerableMisstatement: auditData.tolerableMisstatement, dataType: auditData.dataType }}
                  disabled={fullPopulationData.length === 0}
                  onAccept={(s) => {
                    setAiStratSuggestion(s);
                    setAllocationRule(s.allocationRule);
                    if (s.allocationRule === 'rule_b' && s.allocationParams.totalN) setRuleBTotal(s.allocationParams.totalN);
                    if (s.allocationRule === 'rule_c') {
                      if (s.allocationParams.highN != null) setRuleCHigh(s.allocationParams.highN);
                      if (s.allocationParams.mediumN != null) setRuleCMedium(s.allocationParams.mediumN);
                      if (s.allocationParams.lowN != null) setRuleCLow(s.allocationParams.lowN);
                    }
                  }}
                />

                {/* Stratification results */}
                {stratificationResults && (
                  <div className="space-y-2">
                    <h4 className="text-xs font-semibold text-slate-600">Stratification Results</h4>
                    {stratificationResults.strata.map(s => (
                      <div key={s.level} className={`p-2 rounded-lg text-xs ${
                        s.level === 'high' ? 'bg-red-50 border border-red-200 text-red-700'
                        : s.level === 'medium' ? 'bg-amber-50 border border-amber-200 text-amber-700'
                        : 'bg-green-50 border border-green-200 text-green-700'
                      }`}>
                        <div className="flex justify-between mb-0.5">
                          <strong>{s.name}</strong>
                          <span>{s.sampleSize}/{s.itemCount} sampled</span>
                        </div>
                        <div className="text-[10px] opacity-75">
                          Value: {auditData.functionalCurrency} {s.totalValue.toLocaleString()}
                        </div>
                        {s.topDrivers.length > 0 && (
                          <div className="mt-1 text-[10px] opacity-75">
                            Top drivers: {s.topDrivers.map(d => d.feature).join(', ')}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Stratification rationale + defensibility */}
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">
                    Stratification Rationale <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    value={stratRationale}
                    onChange={(e) => { setStratRationale(e.target.value); setStratDefResult(null); }}
                    rows={3}
                    className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-purple-500"
                    placeholder="Explain why stratification is appropriate for this population, referencing risk characteristics, value distribution, or the nature of the data..."
                  />
                  <button
                    onClick={() => assessDefensibility('stratification', stratRationale, undefined, {
                      setResult: setStratDefResult, setFeedback: setStratDefFeedback, setAssessing: setStratDefAssessing,
                    })}
                    disabled={stratDefAssessing || !stratRationale.trim()}
                    className="mt-1.5 inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md bg-purple-700 text-white hover:bg-purple-800 disabled:opacity-40 transition-colors"
                  >
                    {stratDefAssessing ? <><Loader2 className="h-3 w-3 animate-spin" /> Assessing...</> : <><MessageSquare className="h-3 w-3" /> Assess Defensibility</>}
                  </button>
                  {stratDefResult && (
                    <div className={`mt-2 p-2 rounded-lg text-xs ${
                      stratDefResult === 'defensible' ? 'bg-green-50 border border-green-200 text-green-700'
                      : stratDefResult === 'weak' ? 'bg-amber-50 border border-amber-200 text-amber-700'
                      : 'bg-red-50 border border-red-200 text-red-700'
                    }`}>
                      <span className="font-semibold">{stratDefResult === 'defensible' ? 'Defensible' : stratDefResult === 'weak' ? 'Potentially Weak' : 'Indefensible'}</span>
                      {stratDefFeedback && <p className="mt-0.5 whitespace-pre-line">{stratDefFeedback}</p>}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Method selection (Mode A only) */}
            {stratification === 'simple' && (<>
              <div className="space-y-1.5 mb-4">
              {SAMPLING_METHODS.map(m => (
                <button
                  key={m.key}
                  onClick={() => setSamplingMethod(m.key)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                    samplingMethod === m.key
                      ? 'bg-blue-50 border border-blue-200 text-blue-800 font-medium'
                      : 'border border-slate-100 hover:bg-slate-50 text-slate-700'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>

            {/* Sub-options based on method */}
            {samplingMethod === 'random' && (
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1.5">Random Sampling Basis</label>
                <div className="space-y-1">
                  {RANDOM_BASIS_OPTIONS.map(opt => (
                    <label key={opt.key} className="flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="radio"
                        name="randomBasis"
                        checked={randomBasis === opt.key}
                        onChange={() => setRandomBasis(opt.key)}
                        className="text-blue-600"
                      />
                      {opt.label}
                    </label>
                  ))}
                </div>
              </div>
            )}

            {samplingMethod === 'systematic' && (
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1.5">Systematic Basis</label>
                <div className="space-y-1">
                  {SYSTEMATIC_BASIS_OPTIONS.map(opt => (
                    <label key={opt.key} className="flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="radio"
                        name="systematicBasis"
                        checked={systematicBasis === opt.key}
                        onChange={() => setSystematicBasis(opt.key)}
                        className="text-blue-600"
                      />
                      {opt.label}
                    </label>
                  ))}
                </div>
              </div>
            )}

            {samplingMethod === 'composite' && (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Large Item Threshold</label>
                  <input
                    type="number"
                    value={compositeThreshold || ''}
                    onChange={(e) => { setCompositeThreshold(parseFloat(e.target.value) || 0); setCompositeDefResult(null); }}
                    className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500"
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Justification <span className="text-red-500">*</span></label>
                  <textarea
                    value={compositeJustification}
                    onChange={(e) => { setCompositeJustification(e.target.value); setCompositeDefResult(null); }}
                    rows={3}
                    className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500"
                    placeholder="Explain why this threshold is appropriate, with reference to audit risk, materiality, and the nature of the population..."
                  />
                  <button
                    onClick={() => assessDefensibility('composite_threshold', compositeJustification, undefined, {
                      setResult: setCompositeDefResult, setFeedback: setCompositeDefFeedback, setAssessing: setCompositeDefAssessing,
                    })}
                    disabled={compositeDefAssessing || !compositeJustification.trim()}
                    className="mt-1.5 inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md bg-slate-700 text-white hover:bg-slate-800 disabled:opacity-40 transition-colors"
                  >
                    {compositeDefAssessing ? <><Loader2 className="h-3 w-3 animate-spin" /> Assessing...</> : <><MessageSquare className="h-3 w-3" /> Assess Defensibility</>}
                  </button>
                  {compositeDefResult && (
                    <div className={`mt-2 p-2 rounded-lg text-xs ${
                      compositeDefResult === 'defensible' ? 'bg-green-50 border border-green-200 text-green-700'
                      : compositeDefResult === 'weak' ? 'bg-amber-50 border border-amber-200 text-amber-700'
                      : 'bg-red-50 border border-red-200 text-red-700'
                    }`}>
                      <span className="font-semibold">{compositeDefResult === 'defensible' ? 'Defensible' : compositeDefResult === 'weak' ? 'Potentially Weak' : 'Indefensible'}</span>
                      {compositeDefFeedback && <p className="mt-0.5 whitespace-pre-line">{compositeDefFeedback}</p>}
                    </div>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Residual Population Method</label>
                  <select
                    value={compositeResidualMethod}
                    onChange={(e) => setCompositeResidualMethod(e.target.value)}
                    className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="random">Random</option>
                    <option value="systematic">Systematic</option>
                    <option value="mus">Monetary Unit Sampling</option>
                    <option value="judgemental">Judgemental</option>
                  </select>
                </div>
                {/* Residual method sub-options */}
                {compositeResidualMethod === 'random' && (
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1">Residual — Random Basis</label>
                    <div className="space-y-1">
                      {[{ key: 'net_signed', label: 'Net (signed) misstatement' }, { key: 'overstatement_only', label: 'Overstatement-only' }, { key: 'absolute_error', label: 'Absolute error / gross error' }].map(opt => (
                        <label key={opt.key} className="flex items-center gap-2 text-xs text-slate-600">
                          <input type="radio" name="compositeResidualBasis" checked={compositeResidualBasis === opt.key} onChange={() => setCompositeResidualBasis(opt.key)} className="text-blue-600" />
                          {opt.label}
                        </label>
                      ))}
                    </div>
                  </div>
                )}
                {compositeResidualMethod === 'systematic' && (
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1">Residual — Systematic Basis</label>
                    <div className="space-y-1">
                      {[{ key: 'single_stage', label: 'Single Stage' }, { key: 'two_stage', label: '2 Stage' }].map(opt => (
                        <label key={opt.key} className="flex items-center gap-2 text-xs text-slate-600">
                          <input type="radio" name="compositeResidualSys" checked={compositeResidualSystematic === opt.key} onChange={() => setCompositeResidualSystematic(opt.key)} className="text-blue-600" />
                          {opt.label}
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {samplingMethod === 'judgemental' && (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">
                    Selection Criteria <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    value={judgementalDescription}
                    onChange={(e) => { setJudgementalDescription(e.target.value); setJudgementalDefResult(null); }}
                    rows={3}
                    className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500"
                    placeholder="Describe what the agent should do to select the sample (e.g. select all invoices above £25k and all year-end transactions)..."
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">
                    Justification <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    value={judgementalJustification}
                    onChange={(e) => { setJudgementalJustification(e.target.value); setJudgementalDefResult(null); }}
                    rows={3}
                    className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500"
                    placeholder="Justify why this sampling approach is appropriate for the audit objective..."
                  />
                  <button
                    onClick={() => assessDefensibility('judgemental', judgementalJustification, judgementalDescription, {
                      setResult: setJudgementalDefResult, setFeedback: setJudgementalDefFeedback, setAssessing: setJudgementalDefAssessing,
                    })}
                    disabled={judgementalDefAssessing || !judgementalJustification.trim() || !judgementalDescription.trim()}
                    className="mt-1.5 inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md bg-slate-700 text-white hover:bg-slate-800 disabled:opacity-40 transition-colors"
                  >
                    {judgementalDefAssessing ? <><Loader2 className="h-3 w-3 animate-spin" /> Assessing...</> : <><MessageSquare className="h-3 w-3" /> Assess Defensibility</>}
                  </button>
                  {judgementalDefResult && (
                    <div className={`mt-2 p-2 rounded-lg text-xs ${
                      judgementalDefResult === 'defensible' ? 'bg-green-50 border border-green-200 text-green-700'
                      : judgementalDefResult === 'weak' ? 'bg-amber-50 border border-amber-200 text-amber-700'
                      : 'bg-red-50 border border-red-200 text-red-700'
                    }`}>
                      <span className="font-semibold">{judgementalDefResult === 'defensible' ? 'Defensible' : judgementalDefResult === 'weak' ? 'Potentially Weak' : 'Indefensible'}</span>
                      {judgementalDefFeedback && <p className="mt-0.5 whitespace-pre-line">{judgementalDefFeedback}</p>}
                    </div>
                  )}
                </div>
                <p className="text-[10px] text-slate-400">Users can also manually select items in the data table.</p>
              </div>
            )}
            </>)}
          </div>

          {/* Sample size strategy (Mode A only) */}
          {stratification === 'simple' && (
          <div className="bg-white rounded-lg border border-slate-200 p-5">
            <h3 className="text-sm font-semibold text-slate-700 mb-3">Sample Size</h3>

            <div className="flex gap-1 mb-3 bg-slate-100 rounded-lg p-0.5">
              {(['calculator', 'fixed'] as const).map(s => (
                <button
                  key={s}
                  onClick={() => setSampleSizeStrategy(s)}
                  className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    sampleSizeStrategy === s ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {s === 'calculator' ? 'Calculate' : 'Fixed'}
                </button>
              ))}
            </div>

            {sampleSizeStrategy === 'fixed' ? (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Sample Size (n)</label>
                  <input
                    type="number"
                    min={1}
                    value={fixedSampleSize}
                    onChange={(e) => setFixedSampleSize(parseInt(e.target.value) || 1)}
                    className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">
                    Justification <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    value={fixedJustification}
                    onChange={(e) => { setFixedJustification(e.target.value); setJustificationResult(null); }}
                    rows={3}
                    className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500"
                    placeholder="Explain why this fixed sample size is appropriate, with reference to audit risk, materiality, and the nature of the population..."
                  />
                  <button
                    onClick={assessJustification}
                    disabled={justificationAssessing || !fixedJustification.trim()}
                    className="mt-1.5 inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md bg-slate-700 text-white hover:bg-slate-800 disabled:opacity-40 transition-colors"
                  >
                    {justificationAssessing ? (
                      <><Loader2 className="h-3 w-3 animate-spin" /> Assessing...</>
                    ) : (
                      <><MessageSquare className="h-3 w-3" /> Assess Defensibility</>
                    )}
                  </button>
                  {justificationResult && (
                    <div className={`mt-2 p-2 rounded-lg text-xs ${
                      justificationResult === 'defensible'
                        ? 'bg-green-50 border border-green-200 text-green-700'
                        : justificationResult === 'weak'
                        ? 'bg-amber-50 border border-amber-200 text-amber-700'
                        : 'bg-red-50 border border-red-200 text-red-700'
                    }`}>
                      <span className="font-semibold">
                        {justificationResult === 'defensible' ? 'Defensible' :
                         justificationResult === 'weak' ? 'Potentially Weak' : 'Indefensible'}
                      </span>
                      {justificationFeedback && <p className="mt-0.5">{justificationFeedback}</p>}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Inherent Risk</label>
                  <select
                    value={inherentRisk}
                    onChange={(e) => setInherentRisk(e.target.value as 'Low' | 'Medium' | 'High')}
                    className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="Low">Low</option>
                    <option value="Medium">Medium</option>
                    <option value="High">High</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Specific Risk</label>
                  <select
                    value={specificRisk}
                    onChange={(e) => setSpecificRisk(e.target.value as 'Low' | 'Medium' | 'High')}
                    className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="Low">Low</option>
                    <option value="Medium">Medium</option>
                    <option value="High">High</option>
                  </select>
                </div>
                {firmConfig?.riskMatrix && (
                  <div className="p-2 bg-slate-50 rounded text-xs text-slate-600">
                    k = {firmConfig.riskMatrix[['Low', 'Medium', 'High'].indexOf(inherentRisk)]?.[['Low', 'Medium', 'High'].indexOf(specificRisk)] ?? '—'}%
                  </div>
                )}
              </div>
            )}
          </div>
          )}
        </div>
      </div>

      {/* ─── Review & Sign-off Panel ─────────────────────────────────────── */}
      {runId && selectedIndices.size > 0 && (
        <div className="mt-6 bg-white rounded-lg border border-slate-200 p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Review & Sign-off</h3>

          {/* Prepared by */}
          <div className="flex items-center gap-4 mb-4 p-3 bg-slate-50 rounded-lg">
            <div>
              <span className="text-xs font-medium text-slate-500">Prepared by</span>
              <p className="text-sm font-medium text-slate-800">{userName}</p>
            </div>
            <div>
              <span className="text-xs font-medium text-slate-500">Date</span>
              <p className="text-sm text-slate-800">{new Date().toLocaleDateString('en-GB')}</p>
            </div>
            {runLocked && (
              <div className="ml-auto flex items-center gap-1 text-green-600">
                <Lock className="h-4 w-4" />
                <span className="text-xs font-medium">Locked</span>
              </div>
            )}
          </div>

          {/* Previous reviews */}
          {reviews.length > 0 && (
            <div className="mb-4 space-y-2">
              <span className="text-xs font-medium text-slate-500">Review History</span>
              {reviews.map(r => (
                <div key={r.id} className={`p-3 rounded-lg border text-sm ${
                  r.decision === 'approved' ? 'bg-green-50 border-green-200' :
                  r.decision === 'rejected' ? 'bg-red-50 border-red-200' :
                  'bg-amber-50 border-amber-200'
                }`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium">
                      {r.reviewer.name} ({r.reviewer.displayId})
                    </span>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded ${
                      r.decision === 'approved' ? 'bg-green-100 text-green-700' :
                      r.decision === 'rejected' ? 'bg-red-100 text-red-700' :
                      'bg-amber-100 text-amber-700'
                    }`}>
                      {r.decision === 'needs_revision' ? 'Needs Revision' : r.decision.charAt(0).toUpperCase() + r.decision.slice(1)}
                    </span>
                  </div>
                  {r.notes && <p className="text-slate-600 text-xs mt-1">{r.notes}</p>}
                  <p className="text-[10px] text-slate-400 mt-1">{new Date(r.createdAt).toLocaleString('en-GB')}</p>
                </div>
              ))}
            </div>
          )}

          {/* Submit review */}
          {!runLocked && (
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Review Notes</label>
              <textarea
                value={reviewNotes}
                onChange={(e) => setReviewNotes(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 mb-3"
                placeholder="Add review comments..."
              />
              <div className="flex items-center gap-2">
                <button
                  onClick={async () => {
                    if (!runId) return;
                    setReviewSubmitting(true);
                    try {
                      const res = await fetch('/api/sampling/review', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ runId, decision: 'approved', notes: reviewNotes }),
                      });
                      if (res.ok) {
                        const review = await res.json();
                        setReviews(prev => [review, ...prev]);
                        setRunLocked(true);
                        setReviewNotes('');
                      } else {
                        const err = await res.json().catch(() => null);
                        setError(err?.error || 'Review failed');
                      }
                    } catch { setError('Review failed'); }
                    setReviewSubmitting(false);
                  }}
                  disabled={reviewSubmitting}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-40 transition-colors"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" /> Approve & Lock
                </button>
                <button
                  onClick={async () => {
                    if (!runId) return;
                    setReviewSubmitting(true);
                    try {
                      const res = await fetch('/api/sampling/review', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ runId, decision: 'needs_revision', notes: reviewNotes }),
                      });
                      if (res.ok) {
                        const review = await res.json();
                        setReviews(prev => [review, ...prev]);
                        setReviewNotes('');
                      } else {
                        const err = await res.json().catch(() => null);
                        setError(err?.error || 'Review failed');
                      }
                    } catch { setError('Review failed'); }
                    setReviewSubmitting(false);
                  }}
                  disabled={reviewSubmitting}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium rounded-lg border border-amber-300 text-amber-700 hover:bg-amber-50 disabled:opacity-40 transition-colors"
                >
                  <AlertCircle className="h-3.5 w-3.5" /> Request Revision
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── Rationale Detail Popup ────────────────────────────────────────── */}
      {showRationalePopup && detailedAuditTrail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-2xl mx-4 max-h-[85vh] flex flex-col">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
              <h3 className="text-base font-semibold text-slate-900">Selection Rationale — Detailed Calculations</h3>
              <button onClick={() => setShowRationalePopup(false)} className="p-1 text-slate-400 hover:text-slate-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div ref={rationaleRef} className="px-5 py-4 overflow-y-auto flex-1 text-sm space-y-4">
              {/* Method summary */}
              <div>
                <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Sampling Method</h4>
                <p className="text-slate-700">
                  {(detailedAuditTrail as Record<string, unknown>).algorithm as string || 'Simple Random Sampling Without Replacement (SRSWOR)'}
                </p>
              </div>

              {/* Parameters */}
              <div>
                <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Parameters</h4>
                <table className="w-full text-xs">
                  <tbody className="divide-y divide-slate-100">
                    <tr><td className="py-1 text-slate-500 w-48">Population size (N)</td><td className="py-1 font-medium">{String((detailedAuditTrail as Record<string, unknown>).populationSize ?? '—')}</td></tr>
                    <tr><td className="py-1 text-slate-500">Sample size (n)</td><td className="py-1 font-medium">{String((detailedAuditTrail as Record<string, unknown>).sampleSize ?? '—')}</td></tr>
                    <tr><td className="py-1 text-slate-500">Confidence level</td><td className="py-1 font-medium">{((Number((detailedAuditTrail as Record<string, unknown>).confidence) || 0.95) * 100).toFixed(1)}%</td></tr>
                    <tr><td className="py-1 text-slate-500">Tolerable misstatement (TM)</td><td className="py-1 font-medium">{auditData.functionalCurrency} {String((detailedAuditTrail as Record<string, unknown>).tolerableMisstatement ?? '—')}</td></tr>
                    <tr><td className="py-1 text-slate-500">Error metric</td><td className="py-1 font-medium">{String((detailedAuditTrail as Record<string, unknown>).errorMetric ?? '—').replace(/_/g, ' ')}</td></tr>
                    <tr><td className="py-1 text-slate-500">PRNG seed</td><td className="py-1 font-mono">{String((detailedAuditTrail as Record<string, unknown>).seed ?? '—')}</td></tr>
                    <tr><td className="py-1 text-slate-500">Tool version</td><td className="py-1 font-medium">{String((detailedAuditTrail as Record<string, unknown>).toolVersion ?? '1.0')}</td></tr>
                  </tbody>
                </table>
              </div>

              {/* Statistical formulas */}
              <div>
                <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Statistical Methodology</h4>
                <div className="bg-slate-50 rounded-lg p-3 text-xs text-slate-700 space-y-2 font-mono">
                  <p>Finite Population Correction: FPC = √((N − n) / N)</p>
                  <p>Standard Error: SE = (s / √n) × FPC</p>
                  <p>Upper Confidence Limit (mean): UCL(μ) = x̄ + t(α, n−1) × SE</p>
                  <p>Upper Confidence Limit (total): UCL(T) = N × UCL(μ)</p>
                  <p>Decision: UCL(T) ≤ TM → PASS</p>
                </div>
              </div>

              {/* Planning rationale */}
              <div>
                <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Sample Size Rationale</h4>
                <p className="text-slate-700">{planningRationale}</p>
              </div>

              {/* Population totals */}
              <div>
                <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Coverage</h4>
                <table className="w-full text-xs">
                  <tbody className="divide-y divide-slate-100">
                    <tr><td className="py-1 text-slate-500 w-48">Population total</td><td className="py-1 font-medium">{auditData.functionalCurrency} {populationTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td></tr>
                    <tr><td className="py-1 text-slate-500">Sample total</td><td className="py-1 font-medium">{sampleTotal !== null ? `${auditData.functionalCurrency} ${sampleTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}</td></tr>
                    <tr><td className="py-1 text-slate-500">Value coverage</td><td className="py-1 font-medium">{coverage !== null ? `${coverage.toFixed(2)}%` : '—'}</td></tr>
                  </tbody>
                </table>
              </div>

              {/* Judgement details (for judgemental, composite, fixed, or stratified methods) */}
              {(samplingMethod === 'judgemental' || samplingMethod === 'composite' || sampleSizeStrategy === 'fixed' || stratification === 'stratified') && (
                <div>
                  <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Professional Judgement</h4>
                  <div className="bg-slate-50 rounded-lg p-3 text-xs space-y-2">
                    {samplingMethod === 'judgemental' && (
                      <>
                        <div>
                          <span className="font-semibold text-slate-600">Selection Criteria:</span>
                          <p className="text-slate-700 mt-0.5">{judgementalDescription || '—'}</p>
                        </div>
                        <div>
                          <span className="font-semibold text-slate-600">Justification:</span>
                          <p className="text-slate-700 mt-0.5">{judgementalJustification || '—'}</p>
                        </div>
                        {judgementalDefResult && (
                          <div className={`p-2 rounded ${judgementalDefResult === 'defensible' ? 'bg-green-50 text-green-700' : judgementalDefResult === 'weak' ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700'}`}>
                            <span className="font-semibold">AI Assessment: {judgementalDefResult === 'defensible' ? 'Defensible' : judgementalDefResult === 'weak' ? 'Potentially Weak' : 'Indefensible'}</span>
                            {judgementalDefFeedback && <p className="mt-0.5 whitespace-pre-line">{judgementalDefFeedback}</p>}
                          </div>
                        )}
                      </>
                    )}
                    {samplingMethod === 'composite' && (
                      <>
                        <div>
                          <span className="font-semibold text-slate-600">Threshold Justification:</span>
                          <p className="text-slate-700 mt-0.5">{compositeJustification || '—'}</p>
                        </div>
                        {compositeDefResult && (
                          <div className={`p-2 rounded ${compositeDefResult === 'defensible' ? 'bg-green-50 text-green-700' : compositeDefResult === 'weak' ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700'}`}>
                            <span className="font-semibold">AI Assessment: {compositeDefResult === 'defensible' ? 'Defensible' : compositeDefResult === 'weak' ? 'Potentially Weak' : 'Indefensible'}</span>
                            {compositeDefFeedback && <p className="mt-0.5 whitespace-pre-line">{compositeDefFeedback}</p>}
                          </div>
                        )}
                      </>
                    )}
                    {sampleSizeStrategy === 'fixed' && (
                      <>
                        <div>
                          <span className="font-semibold text-slate-600">Fixed Size Justification:</span>
                          <p className="text-slate-700 mt-0.5">{fixedJustification || '—'}</p>
                        </div>
                        {justificationResult && (
                          <div className={`p-2 rounded ${justificationResult === 'defensible' ? 'bg-green-50 text-green-700' : justificationResult === 'weak' ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700'}`}>
                            <span className="font-semibold">AI Assessment: {justificationResult === 'defensible' ? 'Defensible' : justificationResult === 'weak' ? 'Potentially Weak' : 'Indefensible'}</span>
                            {justificationFeedback && <p className="mt-0.5 whitespace-pre-line">{justificationFeedback}</p>}
                          </div>
                        )}
                      </>
                    )}
                    {stratification === 'stratified' && (
                      <>
                        <div>
                          <span className="font-semibold text-slate-600">Stratification Rationale:</span>
                          <p className="text-slate-700 mt-0.5">{stratRationale || '—'}</p>
                        </div>
                        {stratDefResult && (
                          <div className={`p-2 rounded ${stratDefResult === 'defensible' ? 'bg-green-50 text-green-700' : stratDefResult === 'weak' ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700'}`}>
                            <span className="font-semibold">AI Assessment: {stratDefResult === 'defensible' ? 'Defensible' : stratDefResult === 'weak' ? 'Potentially Weak' : 'Indefensible'}</span>
                            {stratDefFeedback && <p className="mt-0.5 whitespace-pre-line">{stratDefFeedback}</p>}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* Audit trail hashes */}
              <div>
                <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Audit Trail</h4>
                <table className="w-full text-xs">
                  <tbody className="divide-y divide-slate-100">
                    <tr><td className="py-1 text-slate-500 w-48">Population hash (SHA-256)</td><td className="py-1 font-mono text-[10px] break-all">{String((detailedAuditTrail as Record<string, unknown>).populationHash ?? '—')}</td></tr>
                    <tr><td className="py-1 text-slate-500">Timestamp</td><td className="py-1 font-medium">{String((detailedAuditTrail as Record<string, unknown>).timestamp ?? '—')}</td></tr>
                    <tr><td className="py-1 text-slate-500">Algorithm</td><td className="py-1 font-medium">{String((detailedAuditTrail as Record<string, unknown>).algorithm ?? '—')}</td></tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* Actions */}
            <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-end gap-2 shrink-0">
              <button
                onClick={() => {
                  // Print the rationale
                  const printWin = window.open('', '_blank');
                  if (printWin && rationaleRef.current) {
                    printWin.document.write(`<html><head><title>Sampling Rationale — ${selectedClient?.clientName || ''}</title><style>body{font-family:Arial,sans-serif;font-size:12px;padding:20px;color:#333}h4{font-size:11px;color:#666;text-transform:uppercase;letter-spacing:0.05em;margin:16px 0 4px}table{width:100%;border-collapse:collapse}td{padding:4px 0;border-bottom:1px solid #eee}.font-mono{font-family:monospace}</style></head><body>`);
                    printWin.document.write(rationaleRef.current.innerHTML);
                    printWin.document.write('</body></html>');
                    printWin.document.close();
                    printWin.print();
                  }
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
              >
                <Printer className="h-3.5 w-3.5" /> Print
              </button>
              <button
                onClick={() => {
                  // Save as JSON
                  const data = {
                    ...detailedAuditTrail,
                    planningRationale,
                    populationTotal,
                    sampleTotal,
                    coverage,
                    client: selectedClient?.clientName,
                    period: selectedPeriod ? `${selectedPeriod.startDate} - ${selectedPeriod.endDate}` : '',
                  };
                  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url; a.download = `sampling_rationale_${selectedClient?.clientName || 'export'}.json`;
                  a.click(); URL.revokeObjectURL(url);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
              >
                <Download className="h-3.5 w-3.5" /> Save
              </button>
              <button
                onClick={() => setShowRationalePopup(false)}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Distribution Analysis Modal (D2) */}
      <DistributionAnalysisModal
        open={showDistributionModal}
        onClose={() => setShowDistributionModal(false)}
        fullPopulationData={fullPopulationData}
        selectedIndices={selectedIndices}
        amountColumn={columnMapping.amount || ''}
        stratificationResults={stratificationResults}
        itemProfiles={itemProfiles}
        currency={auditData.functionalCurrency}
      />
    </div>
  );
}
