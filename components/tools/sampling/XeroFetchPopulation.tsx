'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Loader2, CheckCircle2, Link2, Unlink, AlertCircle, X, RefreshCw, Calendar,
} from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface XeroAccount {
  AccountID: string;
  Code: string;
  Name: string;
  Type: string;
  Status: string;
}

interface FetchProgress {
  message: string;
  step?: number;
  totalSteps?: number;
  recordCount?: number;
}

interface Props {
  clientId: string;
  clientName: string;
  software: string | null;
  contactEmail: string | null;
  onDataLoaded: (data: { rows: Record<string, unknown>[]; columns: string[]; fileName: string }) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  addTask: (task: any) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  updateTask: (id: string, update: any) => void;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const XERO_CATEGORIES = [
  { value: '', label: '— Select a category —' },
  { value: 'sales', label: 'All Sales (excl. manual journals)' },
  { value: 'direct_costs', label: 'All Direct Costs (excl. manual journals & staff costs)' },
  { value: 'overheads', label: 'All Overheads (excl. manual journals & staff costs)' },
  { value: 'stock', label: 'All Stock / Inventory Costs (excl. manual journals)' },
  { value: 'fixed_assets', label: 'All Fixed Asset Purchases (excl. manual journals)' },
];

const STAFF_COST_KEYWORDS = [
  'wage', 'salary', 'salaries', 'payroll', 'paye', 'nic', 'national insurance',
  'pension', 'employment tax', 'employer', 'staff cost', 'staff costs',
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseXeroDate(dateStr: string | undefined | null): string {
  if (!dateStr) return '';
  const msMatch = dateStr.match(/\/Date\((\d+)([+-]\d+)?\)\//);
  if (msMatch) {
    const d = new Date(parseInt(msMatch[1], 10));
    if (!isNaN(d.getTime())) return d.toLocaleDateString('en-GB');
  }
  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) return d.toLocaleDateString('en-GB');
  return dateStr;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function XeroFetchPopulation({
  clientId, clientName, software, contactEmail, onDataLoaded, addTask, updateTask,
}: Props) {
  // Connection state
  const [xeroConnected, setXeroConnected] = useState(false);
  const [xeroOrgName, setXeroOrgName] = useState('');
  const [checkingConnection, setCheckingConnection] = useState(true);

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [xeroAccounts, setXeroAccounts] = useState<XeroAccount[]>([]);
  const [xeroSelectedCodes, setXeroSelectedCodes] = useState<Set<string>>(new Set());
  const [xeroDateFrom, setXeroDateFrom] = useState('');
  const [xeroDateTo, setXeroDateTo] = useState('');
  const [xeroCategory, setXeroCategory] = useState('');

  // Fetch state
  const [xeroFetching, setXeroFetching] = useState(false);
  const [xeroFetchProgress, setXeroFetchProgress] = useState<FetchProgress | null>(null);
  const [xeroError, setXeroError] = useState('');
  const xeroFetchAbortRef = useRef(false);
  const accountsPreloadAbortRef = useRef<AbortController | null>(null);

  // Delegated access request
  const [requestSending, setRequestSending] = useState(false);
  const [requestStatus, setRequestStatus] = useState<{ status: string; recipientEmail: string; createdAt: string } | null>(null);

  // ─── Check connection + pre-load on mount ─────────────────────────────

  const checkConnection = useCallback(async () => {
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
  }, [clientId]);

  useEffect(() => {
    checkConnection();

    // Check delegated request status
    fetch(`/api/accounting/xero/request-access?clientId=${clientId}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.request) setRequestStatus(data.request); })
      .catch(() => {});

    // Pre-load accounts from cache
    accountsPreloadAbortRef.current?.abort();
    const ctrl = new AbortController();
    accountsPreloadAbortRef.current = ctrl;

    (async () => {
      await new Promise(r => setTimeout(r, 300));
      if (ctrl.signal.aborted) return;
      try {
        const res = await fetch(`/api/accounting/xero/accounts?clientId=${clientId}`, { signal: ctrl.signal });
        if (res.ok) {
          const data = await res.json();
          if (data?.accounts?.length > 0) setXeroAccounts(data.accounts);
        }
      } catch { /* non-fatal */ }
    })();

    return () => { ctrl.abort(); };
  }, [clientId, checkConnection]);

  // ─── Category filter ──────────────────────────────────────────────────

  function handleCategoryChange(category: string) {
    setXeroCategory(category);
    if (!category) { setXeroSelectedCodes(new Set()); return; }
    const active = xeroAccounts.filter(a => a.Status === 'ACTIVE');
    const isStaffAccount = (acc: XeroAccount) =>
      STAFF_COST_KEYWORDS.some(kw => acc.Name.toLowerCase().includes(kw));
    let filtered: XeroAccount[] = [];
    switch (category) {
      case 'sales': filtered = active.filter(a => a.Type === 'REVENUE' || a.Type === 'SALES'); break;
      case 'direct_costs': filtered = active.filter(a => (a.Type === 'DIRECTCOSTS' || a.Type === 'DIRECT COSTS') && !isStaffAccount(a)); break;
      case 'overheads': filtered = active.filter(a => (a.Type === 'OVERHEADS' || a.Type === 'OVERHEAD' || a.Type === 'EXPENSE') && !isStaffAccount(a)); break;
      case 'stock': filtered = active.filter(a => a.Type === 'INVENTORY' || a.Name.toLowerCase().includes('stock') || a.Name.toLowerCase().includes('inventory')); break;
      case 'fixed_assets': filtered = active.filter(a => a.Type === 'FIXED' || a.Type === 'NONCURRENT' || a.Name.toLowerCase().includes('fixed asset') || a.Name.toLowerCase().includes('capital')); break;
    }
    setXeroSelectedCodes(new Set(filtered.map(a => a.Code)));
  }

  function toggleCode(code: string) {
    setXeroSelectedCodes(prev => {
      const next = new Set(prev);
      next.has(code) ? next.delete(code) : next.add(code);
      return next;
    });
  }

  // ─── Load accounts ────────────────────────────────────────────────────

  async function loadAccounts() {
    try {
      const res = await fetch(`/api/accounting/xero/accounts?clientId=${clientId}`);
      if (res.ok) {
        const data = await res.json();
        if (data?.accounts?.length > 0) setXeroAccounts(data.accounts);
      }
    } catch { /* non-fatal */ }
  }

  // ─── Button click ─────────────────────────────────────────────────────

  async function handleButtonClick() {
    setXeroError('');

    // Already connected — open modal immediately
    if (xeroConnected) {
      setXeroCategory('');
      setXeroSelectedCodes(new Set());
      setShowModal(true);
      if (xeroAccounts.length === 0) loadAccounts();
      return;
    }

    // Not connected — check status then request access
    setCheckingConnection(true);
    try {
      const statusRes = await fetch(`/api/accounting/xero/status?clientId=${clientId}`);
      const statusData = await statusRes.json();
      if (statusData.connected) {
        setXeroConnected(true);
        setXeroOrgName(statusData.orgName);
        setXeroCategory('');
        setXeroSelectedCodes(new Set());
        setShowModal(true);
        loadAccounts();
      } else {
        await handleRequestAccess();
      }
    } catch (err) {
      setXeroError(err instanceof Error ? err.message : 'Failed to check connection');
    } finally {
      setCheckingConnection(false);
    }
  }

  // ─── Disconnect ───────────────────────────────────────────────────────

  async function handleDisconnect() {
    if (!confirm(`Disconnect ${xeroOrgName || 'Xero'} from ${clientName}? You will need to re-authorise to reconnect.`)) return;
    try {
      const res = await fetch('/api/accounting/xero/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId }),
      });
      if (!res.ok) {
        const data = await res.json();
        setXeroError(data.error || 'Failed to disconnect');
        return;
      }
      setXeroConnected(false);
      setXeroOrgName('');
      setRequestStatus(null);
      setXeroError('');
    } catch {
      setXeroError('Failed to disconnect from Xero');
    }
  }

  // ─── Request delegated access ─────────────────────────────────────────

  async function handleRequestAccess() {
    setRequestSending(true);
    setXeroError('');
    try {
      const res = await fetch('/api/accounting/xero/request-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId }),
      });
      let data;
      try { data = await res.json(); } catch { throw new Error(`Server error (${res.status}).`); }
      if (!res.ok) throw new Error(data.error || 'Failed to send request');
      setRequestStatus({
        status: 'pending',
        recipientEmail: contactEmail || '',
        createdAt: new Date().toISOString(),
      });
      setXeroError('');
    } catch (err) {
      setXeroError(err instanceof Error ? err.message : 'Failed to send access request');
    } finally {
      setRequestSending(false);
    }
  }

  // ─── Transform & load data ────────────────────────────────────────────

  function loadPopulationData(data: { rows: Array<Record<string, unknown>> }) {
    const rows: Record<string, unknown>[] = [];
    for (const txn of data.rows) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const t = txn as Record<string, any>;
      rows.push({
        'Transaction ID': t.transactionId || t.reference || '',
        'Date': parseXeroDate(t.date),
        'Amount': t.lineAmount ?? t.total ?? '',
        'Description': t.description || '',
        'Reference': t.reference || '',
        'Invoice No': t.invoiceNumber || '',
        'Contact': t.contact || '',
        'Contact Group': t.contactGroup || '',
        'Type': t.type || '',
        'Status': t.status || '',
        'Account Code': t.accountCode || '',
        'Account Name': t.accountName || '',
        'Bank Account': t.bankAccountName || '',
        'Bank Account Code': t.bankAccountCode || '',
        'Item Code': t.itemCode || '',
        'Quantity': t.quantity != null ? String(t.quantity) : '',
        'Unit Amount': t.unitAmount != null ? String(t.unitAmount) : '',
        'Discount %': t.discountRate != null ? `${t.discountRate}%` : '',
        'Net': t.lineAmount != null ? String(t.lineAmount) : String(t.subtotal ?? ''),
        'Tax': t.taxAmount != null ? String(t.taxAmount) : String(t.tax ?? ''),
        'VAT Rate': t.vatRate != null ? `${t.vatRate}%` : '',
        'Tax Type': t.taxType || '',
        'Total': t.lineAmount != null && t.taxAmount != null ? String(t.lineAmount + t.taxAmount) : String(t.total ?? ''),
        'Tracking': t.tracking || '',
        'Subtotal': t.subtotal != null ? String(t.subtotal) : '',
        'Total Tax': t.tax != null ? String(t.tax) : '',
        'Grand Total': t.total != null ? String(t.total) : '',
        'Amount Due': t.amountDue != null ? String(t.amountDue) : '',
        'Amount Paid': t.amountPaid != null ? String(t.amountPaid) : '',
        'Amount Credited': t.amountCredited != null ? String(t.amountCredited) : '',
        'Currency': t.currencyCode || '',
        'Currency Rate': t.currencyRate != null ? String(t.currencyRate) : '',
        'Line Amount Types': t.lineAmountTypes || '',
        'Payments': t.paymentCount != null && t.paymentCount > 0 ? String(t.paymentCount) : '',
        'Payment Total': t.paymentTotal != null ? String(t.paymentTotal) : '',
        'Last Payment Date': parseXeroDate(t.lastPaymentDate),
        'Credit Notes': t.creditNoteCount != null && t.creditNoteCount > 0 ? String(t.creditNoteCount) : '',
        'Credit Note Total': t.creditNoteTotal != null ? String(t.creditNoteTotal) : '',
        'Created By': t.createdBy || '',
        'Approved By': t.approvedBy || '',
        'Due Date': parseXeroDate(t.dueDate),
        'Expected Payment Date': parseXeroDate(t.expectedPaymentDate),
        'Fully Paid Date': parseXeroDate(t.fullyPaidOnDate),
        'Reconciled': t.isReconciled != null ? (t.isReconciled ? 'Yes' : 'No') : '',
        'Sent to Contact': t.sentToContact != null ? (t.sentToContact ? 'Yes' : 'No') : '',
        'Source': t.source || '',
        'Process Date': parseXeroDate(t.processDateTime),
        'Has Attachments': t.hasAttachments ? 'Yes' : 'No',
      });
    }
    const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
    onDataLoaded({ rows, columns, fileName: `Xero - ${xeroOrgName || 'Data'}` });
  }

  // ─── Fetch data (background task + polling) ───────────────────────────

  async function handleFetchData() {
    if (xeroFetching) return;
    if (!xeroDateFrom || !xeroDateTo) { setXeroError('Please select both from and to dates'); return; }
    setXeroError('');
    setShowModal(false);
    setXeroFetching(true);
    setXeroFetchProgress({ message: 'Starting...' });
    xeroFetchAbortRef.current = false;

    accountsPreloadAbortRef.current?.abort();

    const bgTaskId = `xero-sampling-${clientId}-${Date.now()}`;
    addTask({
      id: bgTaskId,
      clientName,
      activity: `Fetching population from ${software || 'Xero'}`,
      status: 'running',
      toolPath: '/tools/sampling',
    });

    try {
      const codes = Array.from(xeroSelectedCodes).join(',');
      const startRes = await fetch('/api/accounting/xero/fetch-background', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId,
          accountCodes: codes,
          dateFrom: xeroDateFrom,
          dateTo: xeroDateTo,
          excludeManualJournals: !!xeroCategory,
        }),
      });
      const startData = await startRes.json();
      if (!startRes.ok) throw new Error(startData.error || 'Failed to start fetch');

      const serverTaskId = startData.taskId;
      const clientIdAtStart = clientId;

      const poll = async () => {
        const maxPolls = 240;
        for (let i = 0; i < maxPolls; i++) {
          await new Promise(r => setTimeout(r, 1500));
          if (xeroFetchAbortRef.current) {
            setXeroFetching(false);
            setXeroFetchProgress(null);
            return;
          }
          try {
            const statusRes = await fetch(`/api/accounting/xero/fetch-background?taskId=${serverTaskId}`);
            const statusData = await statusRes.json();

            if (statusData.progress) {
              setXeroFetchProgress({
                message: statusData.progress.message || 'Working...',
                step: statusData.progress.step,
                totalSteps: statusData.progress.totalSteps,
                recordCount: statusData.progress.recordCount,
              });
            }

            if (statusData.status === 'completed') {
              updateTask(bgTaskId, { status: 'completed', completedAt: Date.now() });
              if (clientId === clientIdAtStart) {
                loadPopulationData(statusData.data);
              }
              setXeroFetching(false);
              setXeroFetchProgress(null);
              return;
            }

            if (statusData.status === 'error') {
              updateTask(bgTaskId, { status: 'error', error: statusData.error, completedAt: Date.now() });
              setXeroError(statusData.error || 'Unknown error');
              setXeroFetching(false);
              setXeroFetchProgress(null);
              return;
            }
          } catch { /* network blip, keep polling */ }
        }
        updateTask(bgTaskId, { status: 'error', error: 'Timed out', completedAt: Date.now() });
        setXeroError('Timed out waiting for data');
        setXeroFetching(false);
        setXeroFetchProgress(null);
      };

      poll();
    } catch (err) {
      updateTask(bgTaskId, { status: 'error', error: err instanceof Error ? err.message : 'Failed', completedAt: Date.now() });
      setXeroError(err instanceof Error ? err.message : 'Failed to start fetch');
      setXeroFetching(false);
      setXeroFetchProgress(null);
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────

  const softwareLabel = software || 'Xero';

  return (
    <>
      <div className="py-4 space-y-3">
        {/* Connection status */}
        {checkingConnection ? (
          <div className="flex items-center gap-2 text-sm text-slate-500 justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin" /> Checking connection...
          </div>
        ) : xeroConnected ? (
          <div className="text-center space-y-3">
            <CheckCircle2 className="h-8 w-8 text-green-500 mx-auto" />
            <div>
              <p className="text-sm font-medium text-green-700">
                Connected to {xeroOrgName || softwareLabel}
              </p>
              <p className="text-xs text-slate-400 mt-0.5">
                Fetch population data directly from the accounting system.
              </p>
            </div>
            <button
              onClick={handleButtonClick}
              disabled={xeroFetching}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-40 transition-colors"
            >
              <RefreshCw className="h-3.5 w-3.5 inline mr-1.5" />
              Fetch from {softwareLabel}
            </button>
          </div>
        ) : (
          <div className="text-center space-y-3">
            <Link2 className="h-8 w-8 text-slate-300 mx-auto" />
            <div>
              <p className="text-sm text-slate-600">
                No active connection to {softwareLabel} for this client.
              </p>
              <p className="text-xs text-slate-400 mt-0.5">
                Connect to import population data directly.
              </p>
            </div>
            <button
              onClick={() => window.open(`/api/accounting/xero/connect?clientId=${clientId}`, '_blank')}
              disabled={requestSending}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 transition-colors"
            >
              Connect to {softwareLabel}
            </button>
          </div>
        )}

        {/* Connected org badge + disconnect */}
        {xeroConnected && xeroOrgName && (
          <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded-lg px-3 py-2">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-green-500" />
              <span className="text-xs text-green-700 font-medium">{xeroOrgName}</span>
            </div>
            <button
              onClick={handleDisconnect}
              className="text-xs text-red-500 hover:text-red-700 flex items-center gap-1 transition-colors"
              title={`Disconnect ${softwareLabel}`}
            >
              <Unlink className="h-3 w-3" />Disconnect
            </button>
          </div>
        )}

        {/* Fetch progress */}
        {xeroFetching && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 text-blue-600 animate-spin" />
                <span className="text-sm text-blue-800 font-medium">
                  {xeroFetchProgress?.step && xeroFetchProgress?.totalSteps
                    ? `Step ${xeroFetchProgress.step} of ${xeroFetchProgress.totalSteps}`
                    : 'Fetching data...'}
                </span>
                {xeroFetchProgress?.recordCount != null && (
                  <span className="text-xs text-blue-500 ml-1">
                    ({xeroFetchProgress.recordCount} records)
                  </span>
                )}
              </div>
              <button
                onClick={() => { xeroFetchAbortRef.current = true; }}
                className="text-xs text-red-600 hover:text-red-800 font-medium px-2 py-1 rounded hover:bg-red-50 transition-colors"
              >
                Cancel
              </button>
            </div>
            {xeroFetchProgress && (
              <p className="text-xs text-blue-600">{xeroFetchProgress.message}</p>
            )}
            <div className="h-1.5 bg-blue-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full transition-all duration-500"
                style={{
                  width: xeroFetchProgress?.step && xeroFetchProgress?.totalSteps
                    ? `${(xeroFetchProgress.step / xeroFetchProgress.totalSteps) * 100}%`
                    : '5%',
                }}
              />
            </div>
          </div>
        )}

        {/* Delegated access request status */}
        {software && contactEmail && !xeroConnected && (
          <div className="text-center">
            <button
              onClick={handleRequestAccess}
              disabled={requestSending}
              className="text-xs text-blue-600 hover:text-blue-700 underline"
            >
              {requestSending ? 'Sending...' : `Send ${softwareLabel} access request to client`}
            </button>
          </div>
        )}

        {requestStatus && requestStatus.status === 'pending' && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-700 space-y-1">
            <div className="flex items-center gap-1.5">
              <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
              <span className="font-medium">{softwareLabel} access request sent</span>
            </div>
            <p>
              An email has been sent to <strong>{requestStatus.recipientEmail}</strong> asking them to authorise
              read-only access. The link expires in 7 days.
            </p>
            <button
              onClick={async () => {
                try {
                  const res = await fetch(`/api/accounting/xero/request-access?clientId=${clientId}`);
                  if (res.ok) {
                    const data = await res.json();
                    if (data.request) setRequestStatus(data.request);
                  }
                  await checkConnection();
                } catch { /* non-fatal */ }
              }}
              className="text-amber-800 underline hover:text-amber-900"
            >
              Check status
            </button>
          </div>
        )}

        {requestStatus && requestStatus.status === 'authorised' && !xeroConnected && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-2.5 text-xs text-green-700">
            {softwareLabel} access has been authorised. Click &quot;Fetch from {softwareLabel}&quot; above to fetch transactions.
          </div>
        )}

        {/* Error */}
        {xeroError && (
          <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />{xeroError}
          </div>
        )}
      </div>

      {/* ─── Fetch Modal ──────────────────────────────────────────────── */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-800">Fetch Population from {softwareLabel}</h3>
                {xeroOrgName && <p className="text-xs text-slate-500">{xeroOrgName}</p>}
              </div>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-5 space-y-4 overflow-y-auto flex-1">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-700 mb-1 block">
                    <Calendar className="h-3 w-3 inline mr-1" />Date From
                  </label>
                  <input
                    type="date"
                    value={xeroDateFrom}
                    onChange={e => setXeroDateFrom(e.target.value)}
                    className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-700 mb-1 block">
                    <Calendar className="h-3 w-3 inline mr-1" />Date To
                  </label>
                  <input
                    type="date"
                    value={xeroDateTo}
                    onChange={e => setXeroDateTo(e.target.value)}
                    className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-700 mb-1.5 block">Transaction Category</label>
                <select
                  value={xeroCategory}
                  onChange={e => handleCategoryChange(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
                >
                  {XERO_CATEGORIES.map(cat => <option key={cat.value} value={cat.value}>{cat.label}</option>)}
                </select>
                {xeroCategory && (
                  <p className="text-[10px] text-slate-500 mt-1">
                    Manual journals excluded. {xeroSelectedCodes.size} account code{xeroSelectedCodes.size !== 1 ? 's' : ''} selected.
                  </p>
                )}
              </div>
              <div>
                <label className="text-xs font-medium text-slate-700 mb-1.5 block">
                  Account Codes {xeroCategory ? '(auto-selected — adjust if needed)' : '(optional)'}
                </label>
                {xeroAccounts.length > 0 ? (
                  <div className="max-h-48 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
                    {xeroAccounts.filter(a => a.Status === 'ACTIVE').map(acc => (
                      <label key={acc.AccountID} className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-50 cursor-pointer text-xs">
                        <input
                          type="checkbox"
                          checked={xeroSelectedCodes.has(acc.Code)}
                          onChange={() => toggleCode(acc.Code)}
                          className="rounded border-slate-300"
                        />
                        <span className="font-mono text-slate-600 w-12">{acc.Code}</span>
                        <span className="text-slate-800 truncate">{acc.Name}</span>
                        <span className="text-slate-400 text-[10px] ml-auto">{acc.Type}</span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <div className="flex items-center gap-2 py-4 justify-center">
                    <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />
                    <p className="text-xs text-slate-400">Loading accounts...</p>
                  </div>
                )}
              </div>
              {xeroError && (
                <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg p-2.5">{xeroError}</div>
              )}
            </div>
            <div className="px-5 py-3 border-t border-slate-200 flex justify-end gap-2">
              <button
                onClick={() => setShowModal(false)}
                className="px-3 py-1.5 text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleFetchData}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 transition-colors"
              >
                <RefreshCw className="h-3.5 w-3.5" /> Fetch Transactions
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
