'use client';

import { useState, useCallback, useRef } from 'react';
import {
  Upload, FileSpreadsheet, CloudDownload, FileText, ChevronDown, ChevronUp,
  CheckCircle2, Circle, AlertTriangle, Loader2, Plus, Trash2, Download, Mail, Printer,
} from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────────

interface Period { id: string; startDate: string; endDate: string }
interface AssignedClient {
  id: string; clientName: string; software?: string | null;
  periods: Period[];
  accountingSystem: string | null;
}
interface COAItem { id: string; accountCode: string; accountName: string; categoryType: string; sortOrder: number }

const ASSERTIONS = [
  'Completeness', 'Occurrence & Accuracy', 'Cut Off', 'Classification',
  'Presentation', 'Existence', 'Valuation', 'Rights and Obligations',
] as const;

const CURRENCIES = [
  { value: 'GBP', label: 'GBP - British Pound' },
  { value: 'USD', label: 'USD - US Dollar' },
  { value: 'EUR', label: 'EUR - Euro' },
  { value: 'CHF', label: 'CHF - Swiss Franc' },
  { value: 'JPY', label: 'JPY - Japanese Yen' },
  { value: 'AUD', label: 'AUD - Australian Dollar' },
  { value: 'CAD', label: 'CAD - Canadian Dollar' },
];

const DEFAULT_AUDIT_TESTS = [
  { key: 'check_balance_tb', label: 'Check Balance to TB' },
  { key: 'unusual_txn', label: 'Unusual Bank transaction Review' },
  { key: 'subsequent_receipts', label: 'Bank Statement Subsequent Receipts Review' },
  { key: 'subsequent_payments', label: 'Bank Statement Subsequent Payments Review' },
  { key: 'capital_txn', label: 'Identification of capital transactions' },
  { key: 'transfers_match', label: 'Transfers match' },
  { key: 'page_continuity', label: 'Page continuity' },
];

interface AuditTestState {
  key: string;
  label: string;
  isChecked: boolean;
  status: 'pending' | 'running' | 'completed' | 'error';
  progress: number;
  resultData: Record<string, unknown> | null;
  errorMsg: string | null;
}

interface CustomTestBox {
  id: string;
  label: string;
}

// ── Props ────────────────────────────────────────────────────────────────────

export interface BankAuditClientProps {
  userId: string;
  userName: string;
  firmId: string;
  firmName: string;
  assignedClients: AssignedClient[];
  isFirmAdmin: boolean;
  chartOfAccounts: COAItem[];
  bankAssertions: unknown;
}

// ── Component ────────────────────────────────────────────────────────────────

export function BankAuditClient({
  userId, userName, assignedClients, chartOfAccounts,
}: BankAuditClientProps) {

  // Client / Period selection
  const [selectedClientId, setSelectedClientId] = useState('');
  const [selectedPeriodId, setSelectedPeriodId] = useState('');
  const selectedClient = assignedClients.find(c => c.id === selectedClientId) ?? null;
  const selectedPeriod = selectedClient?.periods.find(p => p.id === selectedPeriodId) ?? null;

  // Materiality
  const [performanceMateriality, setPerformanceMateriality] = useState('');
  const [clearlyTrivial, setClearlyTrivial] = useState('');
  const [tolerableError, setTolerableError] = useState('');
  const [currency, setCurrency] = useState('GBP');

  // Assertions
  const [leftAssertions, setLeftAssertions] = useState<string[]>([
    'Completeness', 'Occurrence & Accuracy', 'Existence', 'Valuation',
  ]);
  const [rightAssertions, setRightAssertions] = useState<string[]>([
    'Cut Off', 'Classification', 'Presentation', 'Rights and Obligations',
  ]);
  const lockedAssertions = ['Completeness', 'Occurrence & Accuracy', 'Existence', 'Valuation']; // from FS Assertions Mapping

  // Data ingestion
  const [dataSource, setDataSource] = useState<'none' | 'upload' | 'extract' | 'import' | 'blank'>('none');
  const [bankData, setBankData] = useState<Record<string, unknown>[]>([]);
  const [dataLoading, setDataLoading] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<{ name: string; status: string; progress: number }[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const extractInputRef = useRef<HTMLInputElement>(null);

  // Audit tests
  const [auditTests, setAuditTests] = useState<AuditTestState[]>(
    DEFAULT_AUDIT_TESTS.map(t => ({ ...t, isChecked: false, status: 'pending' as const, progress: 0, resultData: null, errorMsg: null }))
  );
  const [customTests, setCustomTests] = useState<CustomTestBox[]>([]);
  const [testsRunning, setTestsRunning] = useState(false);
  const [testsCompleted, setTestsCompleted] = useState(false);
  const [bankDataCollapsed, setBankDataCollapsed] = useState(false);

  // Import modal
  const [showImportModal, setShowImportModal] = useState(false);
  const [importFromDate, setImportFromDate] = useState('');
  const [importToDate, setImportToDate] = useState('');

  // Session
  const [sessionId, setSessionId] = useState<string | null>(null);

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleClientChange = useCallback((clientId: string) => {
    setSelectedClientId(clientId);
    setSelectedPeriodId('');
    setSessionId(null);
    setBankData([]);
    setTestsCompleted(false);
    setDataSource('none');
  }, []);

  const handlePeriodChange = useCallback(async (periodId: string) => {
    setSelectedPeriodId(periodId);
    // Create or load session
    try {
      const res = await fetch('/api/bank-audit/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: selectedClientId, periodId }),
      });
      if (res.ok) {
        const data = await res.json();
        setSessionId(data.sessionId);
        if (data.session) {
          setPerformanceMateriality(data.session.performanceMateriality?.toString() || '');
          setClearlyTrivial(data.session.clearlyTrivial?.toString() || '');
          setTolerableError(data.session.tolerableError?.toString() || '');
          setCurrency(data.session.functionalCurrency || 'GBP');
          if (data.session.bankData) setBankData(data.session.bankData as Record<string, unknown>[]);
        }
        // Set import from date to period start
        const period = selectedClient?.periods.find(p => p.id === periodId);
        if (period) setImportFromDate(period.startDate.split('T')[0]);
      }
    } catch { /* ignore */ }
  }, [selectedClientId, selectedClient]);

  const moveAssertionLeft = (assertion: string) => {
    setRightAssertions(prev => prev.filter(a => a !== assertion));
    setLeftAssertions(prev => [...prev, assertion]);
  };

  const moveAssertionRight = (assertion: string) => {
    if (lockedAssertions.includes(assertion)) return;
    setLeftAssertions(prev => prev.filter(a => a !== assertion));
    setRightAssertions(prev => [...prev, assertion]);
  };

  const handleUploadSpreadsheet = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length || !sessionId) return;
    setDataSource('upload');
    setDataLoading(true);
    const formData = new FormData();
    formData.append('file', files[0]);
    formData.append('sessionId', sessionId);
    formData.append('source', 'upload');
    try {
      const res = await fetch('/api/bank-audit/ingest', { method: 'POST', body: formData });
      if (res.ok) {
        const data = await res.json();
        setBankData(data.transactions || []);
      }
    } catch { /* ignore */ }
    setDataLoading(false);
  };

  const handleExtractFromStatements = () => {
    extractInputRef.current?.click();
  };

  const handleExtractFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length || !sessionId) return;
    setDataSource('extract');
    setDataLoading(true);
    const fileList = Array.from(files);
    setUploadedFiles(fileList.map(f => ({ name: f.name, status: 'uploading', progress: 0 })));

    const formData = new FormData();
    fileList.forEach(f => formData.append('files', f));
    formData.append('sessionId', sessionId);
    formData.append('source', 'extract');

    try {
      const res = await fetch('/api/bank-audit/ingest', { method: 'POST', body: formData });
      if (res.ok) {
        const data = await res.json();
        setBankData(data.transactions || []);
        setUploadedFiles(prev => prev.map(f => ({ ...f, status: 'completed', progress: 100 })));
      }
    } catch {
      setUploadedFiles(prev => prev.map(f => ({ ...f, status: 'error', progress: 0 })));
    }
    setDataLoading(false);
  };

  const handleImportFromAccounting = () => {
    if (!selectedClient?.accountingSystem) return;
    setShowImportModal(true);
  };

  const handleImportConfirm = async () => {
    if (!sessionId) return;
    setShowImportModal(false);
    setDataSource('import');
    setDataLoading(true);
    try {
      const res = await fetch('/api/bank-audit/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          source: 'import',
          clientId: selectedClientId,
          fromDate: importFromDate,
          toDate: importToDate,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setBankData(data.transactions || []);
      }
    } catch { /* ignore */ }
    setDataLoading(false);
  };

  const handleLoadBlank = () => {
    setDataSource('blank');
    setBankData([]);
  };

  const toggleAuditTest = (key: string) => {
    setAuditTests(prev => prev.map(t => t.key === key ? { ...t, isChecked: !t.isChecked } : t));
  };

  const addCustomTest = () => {
    setCustomTests(prev => [...prev, { id: crypto.randomUUID(), label: 'Describe transactions' }]);
  };

  const removeCustomTest = (id: string) => {
    setCustomTests(prev => prev.filter(t => t.id !== id));
  };

  const handleActionTests = async () => {
    if (!sessionId) return;
    setTestsRunning(true);
    setBankDataCollapsed(true);

    const checkedTests = auditTests.filter(t => t.isChecked);
    const allTests = [...checkedTests, ...customTests.map(ct => ({
      key: `custom_${ct.id}`, label: ct.label, isChecked: true,
      status: 'pending' as const, progress: 0, resultData: null, errorMsg: null,
    }))];

    // Update all checked tests to running
    setAuditTests(prev => prev.map(t =>
      t.isChecked ? { ...t, status: 'running' as const, progress: 0 } : t
    ));

    try {
      const res = await fetch('/api/bank-audit/run-tests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          tests: allTests.map(t => ({ key: t.key, label: t.label })),
          performanceMateriality: parseFloat(performanceMateriality) || 0,
          clearlyTrivial: parseFloat(clearlyTrivial) || 0,
          tolerableError: parseFloat(tolerableError) || 0,
          currency,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setAuditTests(prev => prev.map(t => {
          const result = (data.results as { key: string; status: string; resultData: Record<string, unknown>; errorMsg: string | null }[])
            ?.find((r) => r.key === t.key);
          if (result) {
            return { ...t, status: result.status as AuditTestState['status'], progress: 100, resultData: result.resultData, errorMsg: result.errorMsg };
          }
          return t;
        }));
      }
    } catch { /* ignore */ }
    setTestsRunning(false);
    setTestsCompleted(true);
  };

  const handleReviewApprove = async () => {
    if (!sessionId) return;
    await fetch('/api/bank-audit/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, userName, userId }),
    });
  };

  // ── Render ───────────────────────────────────────────────────────────────

  const hasSession = !!selectedClientId && !!selectedPeriodId;
  const hasData = bankData.length > 0 || dataSource === 'blank';

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Sticky Client / Period selector */}
      <div className="sticky top-16 z-40 bg-white border-b shadow-sm px-6 py-3">
        <div className="flex items-center gap-4 max-w-7xl mx-auto">
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-slate-600">Client</label>
            <select
              value={selectedClientId}
              onChange={e => handleClientChange(e.target.value)}
              className="rounded-md border-slate-300 text-sm py-1.5 px-3 bg-white shadow-sm"
            >
              <option value="">Select client...</option>
              {assignedClients.map(c => (
                <option key={c.id} value={c.id}>{c.clientName}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-slate-600">Period</label>
            <select
              value={selectedPeriodId}
              onChange={e => handlePeriodChange(e.target.value)}
              disabled={!selectedClientId}
              className="rounded-md border-slate-300 text-sm py-1.5 px-3 bg-white shadow-sm disabled:opacity-50"
            >
              <option value="">Select period...</option>
              {selectedClient?.periods.map(p => (
                <option key={p.id} value={p.id}>
                  {new Date(p.startDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                  {' – '}
                  {new Date(p.endDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                </option>
              ))}
            </select>
          </div>
          {selectedClient && selectedPeriod && (
            <div className="ml-auto text-xs text-slate-400">
              {selectedClient.accountingSystem && (
                <span className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded">
                  {selectedClient.accountingSystem}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {!hasSession ? (
        <div className="flex items-center justify-center h-[calc(100vh-12rem)]">
          <div className="text-center text-slate-500">
            <p className="text-lg font-medium">Bank Audit</p>
            <p className="mt-2 text-sm">Select a client and period to begin.</p>
          </div>
        </div>
      ) : (
        <div className="max-w-7xl mx-auto px-6 py-6 space-y-6">

          {/* Materiality & Currency */}
          <div className="bg-white rounded-lg border shadow-sm p-5">
            <div className="grid grid-cols-4 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Performance Materiality</label>
                <input
                  type="number" value={performanceMateriality}
                  onChange={e => setPerformanceMateriality(e.target.value)}
                  className="w-full rounded-md border-slate-300 text-sm py-1.5 px-3 shadow-sm"
                  placeholder="0.00"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Clearly Trivial</label>
                <input
                  type="number" value={clearlyTrivial}
                  onChange={e => setClearlyTrivial(e.target.value)}
                  className="w-full rounded-md border-slate-300 text-sm py-1.5 px-3 shadow-sm"
                  placeholder="0.00"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Tolerable Error</label>
                <input
                  type="number" value={tolerableError}
                  onChange={e => setTolerableError(e.target.value)}
                  className="w-full rounded-md border-slate-300 text-sm py-1.5 px-3 shadow-sm"
                  placeholder="0.00"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Functional Currency</label>
                <select
                  value={currency}
                  onChange={e => setCurrency(e.target.value)}
                  className="w-full rounded-md border-slate-300 text-sm py-1.5 px-3 shadow-sm bg-white"
                >
                  {CURRENCIES.map(c => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Assertions panel */}
          <div className="bg-white rounded-lg border shadow-sm p-5">
            <h3 className="text-sm font-semibold text-slate-700 mb-3">Relevant Assertions (Cash / Bank)</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="border rounded-md p-3 bg-green-50 min-h-[120px]">
                <p className="text-xs font-medium text-green-700 mb-2">Active Assertions</p>
                <div className="flex flex-wrap gap-1.5">
                  {leftAssertions.map(a => (
                    <button
                      key={a}
                      onClick={() => moveAssertionRight(a)}
                      disabled={lockedAssertions.includes(a)}
                      className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                        lockedAssertions.includes(a)
                          ? 'bg-green-200 text-green-800 border-green-300 cursor-not-allowed'
                          : 'bg-white text-green-700 border-green-300 hover:bg-red-50 hover:text-red-700 hover:border-red-300 cursor-pointer'
                      }`}
                    >
                      {a} {!lockedAssertions.includes(a) && '×'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="border rounded-md p-3 bg-slate-50 min-h-[120px]">
                <p className="text-xs font-medium text-slate-500 mb-2">Unused Assertions</p>
                <div className="flex flex-wrap gap-1.5">
                  {rightAssertions.map(a => (
                    <button
                      key={a}
                      onClick={() => moveAssertionLeft(a)}
                      className="text-xs px-2.5 py-1 rounded-full border bg-white text-slate-600 border-slate-300 hover:bg-green-50 hover:text-green-700 hover:border-green-300 cursor-pointer transition-colors"
                    >
                      + {a}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Data Ingestion Options */}
          <div className="bg-white rounded-lg border shadow-sm p-5">
            <h3 className="text-sm font-semibold text-slate-700 mb-3">Bank Data</h3>
            <div className="grid grid-cols-4 gap-3">
              <button
                onClick={handleUploadSpreadsheet}
                disabled={dataLoading}
                className="flex flex-col items-center gap-2 p-4 rounded-lg border-2 border-dashed border-slate-300 hover:border-blue-400 hover:bg-blue-50 transition-colors"
              >
                <Upload className="h-6 w-6 text-slate-500" />
                <span className="text-xs font-medium text-slate-600">Upload Spreadsheet</span>
              </button>
              <button
                onClick={handleExtractFromStatements}
                disabled={dataLoading}
                className="flex flex-col items-center gap-2 p-4 rounded-lg border-2 border-dashed border-slate-300 hover:border-blue-400 hover:bg-blue-50 transition-colors"
              >
                <FileText className="h-6 w-6 text-slate-500" />
                <span className="text-xs font-medium text-slate-600">Extract from Bank Statements</span>
              </button>
              <button
                onClick={handleImportFromAccounting}
                disabled={dataLoading || !selectedClient?.accountingSystem}
                className="flex flex-col items-center gap-2 p-4 rounded-lg border-2 border-dashed border-slate-300 hover:border-blue-400 hover:bg-blue-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <CloudDownload className="h-6 w-6 text-slate-500" />
                <span className="text-xs font-medium text-slate-600">
                  Import from {selectedClient?.accountingSystem || 'Accounting System'}
                </span>
              </button>
              <button
                onClick={handleLoadBlank}
                disabled={dataLoading}
                className="flex flex-col items-center gap-2 p-4 rounded-lg border-2 border-dashed border-slate-300 hover:border-blue-400 hover:bg-blue-50 transition-colors"
              >
                <FileSpreadsheet className="h-6 w-6 text-slate-500" />
                <span className="text-xs font-medium text-slate-600">Load Blank (Paste Data)</span>
              </button>
            </div>

            {/* Hidden file inputs */}
            <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={handleFileSelected} />
            <input ref={extractInputRef} type="file" accept=".pdf,image/*" multiple className="hidden" onChange={handleExtractFiles} />

            {/* Upload progress */}
            {uploadedFiles.length > 0 && (
              <div className="mt-4 space-y-2">
                {uploadedFiles.map((f, i) => (
                  <div key={i} className="flex items-center gap-3 text-xs">
                    <span className="truncate w-48 text-slate-600">{f.name}</span>
                    <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all duration-500 rounded-full ${
                          f.status === 'error' ? 'bg-red-500' : 'bg-green-500'
                        }`}
                        style={{ width: `${f.progress}%` }}
                      />
                    </div>
                    <span className="text-slate-400 w-20 text-right">{f.status}</span>
                  </div>
                ))}
              </div>
            )}

            {dataLoading && (
              <div className="mt-4 flex items-center gap-2 text-sm text-blue-600">
                <Loader2 className="h-4 w-4 animate-spin" />
                Processing data...
              </div>
            )}

            {/* Bank data spreadsheet (collapsible) */}
            {hasData && (
              <div className="mt-4">
                <button
                  onClick={() => setBankDataCollapsed(!bankDataCollapsed)}
                  className="flex items-center gap-1 text-sm font-medium text-slate-700 mb-2"
                >
                  {bankDataCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
                  Bank Transactions ({bankData.length} rows)
                </button>
                {!bankDataCollapsed && (
                  <div className="border rounded-md overflow-auto max-h-[400px]">
                    {dataSource === 'blank' ? (
                      <div className="p-4">
                        <textarea
                          className="w-full h-64 font-mono text-xs border rounded p-2 resize-y"
                          placeholder="Paste bank transaction data here (tab-separated or CSV format)..."
                          onPaste={async (e) => {
                            const text = e.clipboardData.getData('text');
                            const rows = text.split('\n').filter(r => r.trim()).map(r => {
                              const cols = r.split('\t');
                              return { date: cols[0], description: cols[1], amount: cols[2], type: cols[3] };
                            });
                            setBankData(rows);
                          }}
                        />
                      </div>
                    ) : (
                      <table className="w-full text-xs">
                        <thead className="bg-slate-50 sticky top-0">
                          <tr>
                            {bankData[0] && Object.keys(bankData[0]).map(key => (
                              <th key={key} className="px-3 py-2 text-left font-medium text-slate-600 border-b">{key}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {bankData.map((row, i) => (
                            <tr key={i} className="border-b hover:bg-slate-50">
                              {Object.values(row).map((val, j) => (
                                <td key={j} className="px-3 py-1.5 text-slate-700">{String(val ?? '')}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Audit Tests */}
          {hasData && (
            <div className="bg-white rounded-lg border shadow-sm p-5">
              <h3 className="text-sm font-semibold text-slate-700 mb-3">Audit Tests</h3>
              <div className="space-y-2">
                {auditTests.map(test => (
                  <label key={test.key} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-slate-50 rounded px-2 py-1">
                    <input
                      type="checkbox"
                      checked={test.isChecked}
                      onChange={() => toggleAuditTest(test.key)}
                      className="rounded border-slate-300 text-blue-600"
                    />
                    <span className="text-slate-700">{test.label}</span>
                    {test.status === 'completed' && <CheckCircle2 className="h-4 w-4 text-green-500 ml-auto" />}
                    {test.status === 'running' && <Loader2 className="h-4 w-4 text-blue-500 animate-spin ml-auto" />}
                    {test.status === 'error' && <AlertTriangle className="h-4 w-4 text-red-500 ml-auto" />}
                  </label>
                ))}

                {/* Custom test boxes */}
                {customTests.map(ct => (
                  <div key={ct.id} className="flex items-center gap-2 px-2 py-1">
                    <input type="checkbox" defaultChecked className="rounded border-slate-300 text-blue-600" />
                    <input
                      type="text"
                      value={ct.label}
                      onChange={e => setCustomTests(prev => prev.map(t => t.id === ct.id ? { ...t, label: e.target.value } : t))}
                      className="flex-1 text-sm border-b border-slate-200 bg-transparent focus:border-blue-400 focus:outline-none py-0.5"
                    />
                    <button onClick={() => removeCustomTest(ct.id)} className="text-slate-400 hover:text-red-500">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}

                <button
                  onClick={addCustomTest}
                  className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 px-2 py-1"
                >
                  <Plus className="h-3.5 w-3.5" /> Add custom test
                </button>
              </div>

              <button
                onClick={handleActionTests}
                disabled={testsRunning || !auditTests.some(t => t.isChecked)}
                className="mt-4 px-6 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {testsRunning ? (
                  <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Running Tests...</span>
                ) : (
                  'Action Tests'
                )}
              </button>
            </div>
          )}

          {/* Test Results */}
          {testsCompleted && (
            <div className="space-y-4">
              {auditTests.filter(t => t.isChecked && t.status !== 'pending').map(test => (
                <div key={test.key} className={`bg-white rounded-lg border shadow-sm p-5 ${test.status === 'error' ? 'border-red-300 ring-2 ring-red-100' : ''}`}>
                  <div className="flex items-center gap-2 mb-3">
                    {test.status === 'completed' ? (
                      <CheckCircle2 className="h-5 w-5 text-green-500" />
                    ) : test.status === 'error' ? (
                      <AlertTriangle className="h-5 w-5 text-red-500" />
                    ) : (
                      <Circle className="h-5 w-5 text-slate-300" />
                    )}
                    <h4 className="text-sm font-semibold text-slate-700">{test.label}</h4>
                  </div>

                  {/* Progress bar */}
                  <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden mb-3">
                    <div
                      className={`h-full rounded-full transition-all duration-700 ${
                        test.status === 'error' ? 'bg-red-500' : 'bg-green-500'
                      }`}
                      style={{ width: `${test.progress}%` }}
                    />
                  </div>

                  {test.errorMsg && (
                    <p className="text-sm text-red-600 bg-red-50 rounded p-2">{test.errorMsg}</p>
                  )}

                  {test.resultData && (
                    <div className="text-xs font-mono bg-slate-50 rounded p-3 max-h-60 overflow-auto">
                      <pre>{JSON.stringify(test.resultData, null, 2)}</pre>
                    </div>
                  )}
                </div>
              ))}

              {/* Actions */}
              <div className="flex gap-3">
                <button
                  onClick={handleReviewApprove}
                  className="flex items-center gap-2 px-5 py-2 bg-green-600 text-white text-sm font-medium rounded-md hover:bg-green-700"
                >
                  <CheckCircle2 className="h-4 w-4" /> Review and Approve
                </button>
                <button className="flex items-center gap-2 px-5 py-2 bg-slate-100 text-slate-700 text-sm font-medium rounded-md border hover:bg-slate-200">
                  <Printer className="h-4 w-4" /> Print / Save
                </button>
                <button className="flex items-center gap-2 px-5 py-2 bg-slate-100 text-slate-700 text-sm font-medium rounded-md border hover:bg-slate-200">
                  <Mail className="h-4 w-4" /> Send
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Import Modal */}
      {showImportModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-[400px]">
            <h3 className="text-sm font-semibold text-slate-700 mb-4">
              Import from {selectedClient?.accountingSystem}
            </h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">From Date</label>
                <input
                  type="date" value={importFromDate}
                  onChange={e => setImportFromDate(e.target.value)}
                  className="w-full rounded-md border-slate-300 text-sm py-1.5 px-3 shadow-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">To Date</label>
                <input
                  type="date" value={importToDate}
                  onChange={e => setImportToDate(e.target.value)}
                  className="w-full rounded-md border-slate-300 text-sm py-1.5 px-3 shadow-sm"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => setShowImportModal(false)}
                className="px-4 py-1.5 text-sm text-slate-600 rounded-md border hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={handleImportConfirm}
                className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700"
              >
                Import
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
