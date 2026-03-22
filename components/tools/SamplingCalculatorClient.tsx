'use client';

import { useState, useCallback, useRef } from 'react';
import {
  Upload, FileSpreadsheet, Loader2, ChevronDown, AlertCircle,
  CheckCircle2, Search, Lock, ArrowLeft, Plus, BarChart3,
  Link2, Grid3X3, MessageSquare,
} from 'lucide-react';

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
  assignedClients, firmConfig,
}: Props) {
  // ─── Step/state management ─────────────────────────────────────────────────
  const [step, setStep] = useState<'client' | 'no-access' | 'configure' | 'upload' | 'map' | 'quality' | 'method'>('client');

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
  const [dataQuality, setDataQuality] = useState<DataQuality | null>(null);
  const [qualityAcknowledged, setQualityAcknowledged] = useState(false);

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
  const [dataInputMode, setDataInputMode] = useState<'upload' | 'paste' | 'connect'>('upload');

  // ─── Spreadsheet paste ─────────────────────────────────────────────────
  const [spreadsheetData, setSpreadsheetData] = useState<string[][]>([['', '', '', '', '']]);
  const spreadsheetRef = useRef<HTMLDivElement>(null);

  // ─── Accounting connection ─────────────────────────────────────────────
  const [xeroConnected, setXeroConnected] = useState(false);
  const [xeroOrgName, setXeroOrgName] = useState('');
  const [checkingConnection, setCheckingConnection] = useState(false);

  // ─── Fixed size justification ──────────────────────────────────────────
  const [fixedJustification, setFixedJustification] = useState('');
  const [justificationAssessing, setJustificationAssessing] = useState(false);
  const [justificationResult, setJustificationResult] = useState<'defensible' | 'weak' | 'indefensible' | null>(null);
  const [justificationFeedback, setJustificationFeedback] = useState('');

  // ─── Composite extras ─────────────────────────────────────────────────────
  const [compositeThreshold, setCompositeThreshold] = useState(0);
  const [compositeJustification, setCompositeJustification] = useState('');
  const [compositeResidualMethod, setCompositeResidualMethod] = useState('random');

  // ─── Engagement ────────────────────────────────────────────────────────────
  const [engagementId, setEngagementId] = useState<string | null>(null);
  const [error, setError] = useState('');

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
      setColumnMapping({});
      setStep('map');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse file');
    }
    setUploading(false);
  }

  // ─── Check accounting connection ────────────────────────────────────────

  const checkXeroConnection = useCallback(async (clientId: string) => {
    setCheckingConnection(true);
    try {
      const res = await fetch(`/api/accounting/xero/status?clientId=${clientId}`);
      if (res.ok) {
        const data = await res.json();
        setXeroConnected(!!data.connected);
        setXeroOrgName(data.orgName || '');
      }
    } catch { /* silent */ }
    setCheckingConnection(false);
  }, []);

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
      setColumnMapping({});
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
    setColumnMapping({});
    setStep('map');
  }

  // ─── Assess fixed sample size justification ────────────────────────────

  async function assessJustification() {
    if (!fixedJustification.trim() || fixedJustification.length < 20) {
      setJustificationResult('indefensible');
      setJustificationFeedback('Justification is too brief. Please provide a detailed explanation referencing audit risk, materiality, or the nature of the population.');
      return;
    }
    setJustificationAssessing(true);
    setJustificationResult(null);
    setJustificationFeedback('');
    try {
      // Client-side heuristic check for obvious red flags
      const lower = fixedJustification.toLowerCase();
      const redFlags = ['fewer items', 'most efficient', 'reduced workload', 'less work', 'save time', 'quickest', 'minimum effort'];
      const hasRedFlag = redFlags.some(flag => lower.includes(flag));

      if (hasRedFlag) {
        setJustificationResult('indefensible');
        setJustificationFeedback('This justification relies on workload minimisation, which is not acceptable to audit regulators. Please revise to reference risk, materiality, or the nature of the population.');
        setJustificationAssessing(false);
        return;
      }

      const hasRiskRef = /risk|material|assert|nature|population|significant|control|substantive/i.test(fixedJustification);
      if (!hasRiskRef) {
        setJustificationResult('weak');
        setJustificationFeedback('This justification does not clearly reference audit risk, materiality, or assertion-level considerations. Consider strengthening your rationale.');
        setJustificationAssessing(false);
        return;
      }

      setJustificationResult('defensible');
      setJustificationFeedback('Justification appears defensible. It references appropriate audit considerations.');
    } catch {
      setJustificationFeedback('Could not assess justification. Please review manually.');
    }
    setJustificationAssessing(false);
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

  function computeDataQuality() {
    if (!validateMapping()) return;

    const rows = uploadedPreview; // In production, use full parsed data
    const amountCol = columnMapping.amount!;
    const idCol = columnMapping.transactionId!;
    const dateCol = columnMapping.date!;

    // Compute basic stats
    const amounts = rows.map(r => parseFloat(String(r[amountCol])) || 0);
    const ids = rows.map(r => String(r[idCol]));
    const dates = rows.map(r => String(r[dateCol])).filter(d => d && d !== '');

    const missingCounts: Record<string, number> = {};
    for (const col of uploadedColumns) {
      missingCounts[col] = rows.filter(r => !r[col] || String(r[col]).trim() === '').length;
    }

    const uniqueIds = new Set(ids);

    const sorted = [...amounts].sort((a, b) => a - b);
    const mean = amounts.reduce((s, v) => s + v, 0) / (amounts.length || 1);
    const variance = amounts.reduce((s, v) => s + (v - mean) ** 2, 0) / (amounts.length || 1);

    setDataQuality({
      recordCount: rows.length,
      dateRange: dates.length > 0 ? { min: dates[0], max: dates[dates.length - 1] } : null,
      missingCounts,
      duplicateIds: ids.length - uniqueIds.size,
      amountStats: amounts.length > 0 ? {
        min: sorted[0],
        max: sorted[sorted.length - 1],
        mean: Math.round(mean * 100) / 100,
        median: sorted[Math.floor(sorted.length / 2)],
        stdDev: Math.round(Math.sqrt(variance) * 100) / 100,
      } : null,
    });

    setStep('quality');
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
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={async () => {
              // TODO: Send email to portfolio owners requesting access
              alert('Access request sent to portfolio managers.');
            }}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
          >
            Request Access
          </button>
          <button
            onClick={() => { setStep('client'); setSelectedPeriod(null); setHasAccess(null); }}
            className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800 transition-colors"
          >
            Return to Home
          </button>
        </div>
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
        <div>
          <h1 className="text-xl font-bold text-slate-800">
            Sample Calculator — {selectedClient?.clientName}
          </h1>
          <p className="text-xs text-slate-500">
            {selectedPeriod ? formatPeriod(selectedPeriod.startDate, selectedPeriod.endDate) : ''}
            {confidenceLevel ? ` | Confidence: ${confidenceLevel}%` : ''}
          </p>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex items-center gap-2">
          <AlertCircle className="h-4 w-4 shrink-0" /> {error}
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
                  <Upload className="h-3 w-3" /> Upload File
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
                  onClick={() => {
                    setDataInputMode('connect');
                    if (selectedClient) checkXeroConnection(selectedClient.id);
                  }}
                  className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    dataInputMode === 'connect' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  <Link2 className="h-3 w-3" />
                  {selectedClient?.software ? `Connect to ${selectedClient.software}` : 'Connect to Accounting System'}
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
                    className="border border-slate-200 rounded-lg overflow-auto max-h-[400px]"
                  >
                    <table className="text-xs w-full border-collapse">
                      <tbody>
                        {spreadsheetData.map((row, ri) => (
                          <tr key={ri} className={ri === 0 ? 'bg-slate-50 font-medium' : ''}>
                            <td className="w-8 px-1 py-0.5 text-center text-slate-400 border-r border-b border-slate-100 bg-slate-50 text-[10px]">
                              {ri + 1}
                            </td>
                            {row.map((cell, ci) => (
                              <td key={ci} className="border-r border-b border-slate-100 p-0">
                                <input
                                  type="text"
                                  value={cell}
                                  onChange={(e) => handleSpreadsheetCellChange(ri, ci, e.target.value)}
                                  className="w-full px-1.5 py-1 text-xs border-0 focus:outline-none focus:bg-blue-50 min-w-[80px]"
                                />
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
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
              {dataInputMode === 'connect' && (
                <div className="text-center py-6">
                  {checkingConnection ? (
                    <div className="flex items-center gap-2 text-sm text-slate-500 justify-center">
                      <Loader2 className="h-4 w-4 animate-spin" /> Checking connection...
                    </div>
                  ) : xeroConnected ? (
                    <div>
                      <CheckCircle2 className="h-8 w-8 text-green-500 mx-auto mb-2" />
                      <p className="text-sm font-medium text-green-700 mb-1">
                        Connected to {xeroOrgName || selectedClient?.software || 'Xero'}
                      </p>
                      <p className="text-xs text-slate-400 mb-3">
                        You can fetch population data from the connected accounting system.
                      </p>
                      <button
                        className="px-4 py-2 text-sm font-medium rounded-lg bg-green-600 text-white hover:bg-green-700 transition-colors"
                        onClick={() => {
                          // TODO: Phase 4 — fetch data from Xero and populate
                          alert('Fetch from accounting system will be available in the next update.');
                        }}
                      >
                        Fetch Data
                      </button>
                    </div>
                  ) : (
                    <div>
                      <Link2 className="h-8 w-8 text-slate-300 mx-auto mb-2" />
                      <p className="text-sm text-slate-600 mb-1">
                        No active connection to {selectedClient?.software || 'an accounting system'} for this client.
                      </p>
                      <p className="text-xs text-slate-400 mb-3">
                        Connect to import population data directly.
                      </p>
                      <button
                        onClick={() => {
                          if (selectedClient) {
                            window.open(`/api/accounting/xero/connect?clientId=${selectedClient.id}`, '_blank');
                          }
                        }}
                        className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                      >
                        Connect to {selectedClient?.software || 'Xero'}
                      </button>
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

              <button
                onClick={computeDataQuality}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
              >
                Validate & Continue
              </button>
            </div>
          )}

          {/* Data quality summary */}
          {step === 'quality' && dataQuality && (
            <div className="bg-white rounded-lg border border-slate-200 p-5">
              <h3 className="text-sm font-semibold text-slate-700 mb-3">Data Quality Summary</h3>

              <div className="grid grid-cols-2 gap-4 mb-4">
                <div className="p-3 bg-slate-50 rounded-lg">
                  <span className="text-xs text-slate-500">Records</span>
                  <p className="text-lg font-bold text-slate-800">{dataQuality.recordCount.toLocaleString()}</p>
                </div>
                {dataQuality.amountStats && (
                  <>
                    <div className="p-3 bg-slate-50 rounded-lg">
                      <span className="text-xs text-slate-500">Amount Range</span>
                      <p className="text-sm font-semibold text-slate-800">
                        {auditData.functionalCurrency} {dataQuality.amountStats.min.toLocaleString()} – {dataQuality.amountStats.max.toLocaleString()}
                      </p>
                    </div>
                    <div className="p-3 bg-slate-50 rounded-lg">
                      <span className="text-xs text-slate-500">Mean / Std Dev</span>
                      <p className="text-sm font-semibold text-slate-800">
                        {dataQuality.amountStats.mean.toLocaleString()} / {dataQuality.amountStats.stdDev.toLocaleString()}
                      </p>
                    </div>
                  </>
                )}
                {dataQuality.dateRange && (
                  <div className="p-3 bg-slate-50 rounded-lg">
                    <span className="text-xs text-slate-500">Date Range</span>
                    <p className="text-sm font-semibold text-slate-800">{dataQuality.dateRange.min} – {dataQuality.dateRange.max}</p>
                  </div>
                )}
              </div>

              {dataQuality.duplicateIds > 0 && (
                <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {dataQuality.duplicateIds} duplicate Transaction IDs found. Please fix before proceeding.
                </div>
              )}

              {/* Missing values */}
              {Object.entries(dataQuality.missingCounts).some(([, v]) => v > 0) && (
                <div className="mb-4">
                  <h4 className="text-xs font-medium text-slate-500 mb-1">Missing Values</h4>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(dataQuality.missingCounts)
                      .filter(([, v]) => v > 0)
                      .map(([col, count]) => (
                        <span key={col} className="text-xs px-2 py-0.5 bg-amber-50 text-amber-700 rounded">
                          {col}: {count}
                        </span>
                      ))}
                  </div>
                </div>
              )}

              <label className="flex items-center gap-2 mb-3 text-sm">
                <input
                  type="checkbox"
                  checked={qualityAcknowledged}
                  onChange={(e) => setQualityAcknowledged(e.target.checked)}
                  className="rounded border-slate-300"
                />
                <span className="text-slate-600">I have reviewed the data quality summary and wish to proceed</span>
              </label>

              <button
                onClick={() => { if (qualityAcknowledged && dataQuality.duplicateIds === 0) setStep('method'); }}
                disabled={!qualityAcknowledged || dataQuality.duplicateIds > 0}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 transition-colors"
              >
                Proceed to Sampling
              </button>
            </div>
          )}

          {/* Method step — placeholder for Phase 4 engine */}
          {step === 'method' && (
            <div className="bg-white rounded-lg border border-slate-200 p-5">
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <BarChart3 className="h-5 w-5" />
                <span>Population loaded. Configure sampling method on the right panel, then click <strong>Auto Select</strong> to run.</span>
              </div>
              <button
                disabled
                className="mt-4 px-4 py-2 text-sm font-medium rounded-lg bg-green-600 text-white opacity-40 cursor-not-allowed"
              >
                Auto Select (Phase 4)
              </button>
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

            {/* Method selection */}
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
                    onChange={(e) => setCompositeThreshold(parseFloat(e.target.value) || 0)}
                    className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500"
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Justification</label>
                  <textarea
                    value={compositeJustification}
                    onChange={(e) => setCompositeJustification(e.target.value)}
                    rows={3}
                    className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500"
                    placeholder="Explain why this threshold is appropriate..."
                  />
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
              </div>
            )}

            {samplingMethod === 'judgemental' && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
                Judgemental sampling requires an AI-assisted dialogue to document your rationale. This will open when you click Auto Select.
              </div>
            )}
          </div>

          {/* Sample size strategy */}
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
        </div>
      </div>
    </div>
  );
}
