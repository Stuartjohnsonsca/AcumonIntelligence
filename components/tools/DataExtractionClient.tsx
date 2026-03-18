'use client';

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Upload, FileText, Loader2, Download, ChevronDown, ChevronRight,
  CheckCircle2, XCircle, AlertCircle, Search, UserPlus, Plus,
  Database, RefreshCw, Mail, X, Table, Link2, Unlink, Calendar, Eye,
  History, Shuffle, MousePointer2, Square
} from 'lucide-react';
import { DocumentViewer } from '@/components/tools/DocumentViewer';
import { useBackgroundTasks } from '@/components/BackgroundTaskProvider';

// ─── Interfaces ──────────────────────────────────────────────────────────────

interface PreviousJob {
  id: string;
  status: string;
  totalFiles: number;
  processedCount: number;
  failedCount: number;
  createdAt: string;
  extractedAt: string | null;
  expiresAt: string | null;
}

interface Client {
  id: string;
  clientName: string;
  software: string | null;
  contactName: string | null;
  contactEmail: string | null;
}

interface LineItem {
  description: string;
  quantity: number | null;
  productId: string | null;
  net: number | null;
  tax: number | null;
  duty: number | null;
}

interface FieldLocation {
  page: number;
  bbox: [number, number, number, number];
}

interface ExtractedRecord {
  id: string;
  fileId: string;
  referenceId: string;
  purchaserName: string | null;
  purchaserTaxId: string | null;
  purchaserCountry: string | null;
  sellerName: string | null;
  sellerTaxId: string | null;
  sellerCountry: string | null;
  documentRef: string | null;
  documentDate: string | null;
  dueDate: string | null;
  netTotal: number | null;
  dutyTotal: number | null;
  taxTotal: number | null;
  grossTotal: number | null;
  lineItems: LineItem[];
  accountCategory: string | null;
  fieldLocations: Record<string, FieldLocation> | null;
  currency?: string | null;
}

interface ExtractionFile {
  id: string;
  originalName: string;
  status: string;
  errorMessage: string | null;
  duplicateOfId: string | null;
}

interface JobResult {
  jobId: string;
  files: ExtractionFile[];
  records: ExtractedRecord[];
  client: { clientName: string; software: string | null };
  user: { name: string };
  extractedAt: string | null;
  status: string;
  expiresAt: string | null;
}

type LeftPanelMode = 'idle' | 'spreadsheet' | 'blank';

interface SpreadsheetRow {
  [key: string]: string;
}

const ACCOUNTING_COLUMNS = [
  'Date', 'Reference', 'Contact', 'Description', 'Account Code',
  'Net', 'Tax', 'Gross',
];

const UPLOADED_DOC_COLUMNS_BASE = [
  'Ref', 'Doc Ref', 'Date', 'Due Date', 'Seller', 'Purchaser',
  'Net', 'Tax', 'Gross',
];

const AUDIT_VERIFY_COLUMNS = ['Amount', 'Date', 'Period', 'Consistency'];

const CURRENCY_LIST = [
  'GBP', 'USD', 'EUR', 'JPY', 'CHF', 'CAD', 'AUD', 'NZD', 'CNY',
  'HKD', 'SGD', 'SEK', 'NOK', 'DKK', 'ZAR', 'INR', 'BRL', 'MXN',
  'KRW', 'TWD', 'THB', 'MYR', 'AED', 'SAR', 'TRY', 'PLN', 'CZK',
  'HUF', 'ILS', 'PHP', 'IDR', 'RUB',
];

interface XeroAccount {
  AccountID: string;
  Code: string;
  Name: string;
  Type: string;
  Status: string;
}

interface RowMatch {
  record: ExtractedRecord;
  confidence: 'high' | 'uncertain';
  matchedLineIdx?: number;
  fxRate?: number;
  fxSource?: string;
  convertedAmount?: number;
}

interface AuditVerification {
  amountDiff: number | null;
  dateDiffDays: number | null;
  periodResult: { text: string; inPeriod: boolean } | null;
  consistencyResult: { text: string; consistent: boolean } | null;
}

interface Props {
  userId: string;
  userName: string;
  firmName: string;
  assignedClients: Client[];
  unassignedClients: Client[];
  isFirmAdmin: boolean;
  isPortfolioOwner: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseNumber(val: string | undefined): number | null {
  if (!val) return null;
  const cleaned = val.replace(/[£$€,\s]/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

function normalizeDate(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  const cleaned = dateStr.trim();
  const isoMatch = cleaned.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return isoMatch[0];
  const ukMatch = cleaned.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (ukMatch) {
    const y = ukMatch[3].length === 2 ? '20' + ukMatch[3] : ukMatch[3];
    return `${y}-${ukMatch[2].padStart(2, '0')}-${ukMatch[1].padStart(2, '0')}`;
  }
  return null;
}

function daysBetween(d1: string, d2: string): number {
  const a = new Date(d1);
  const b = new Date(d2);
  return Math.round((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24));
}

function formatCurrencyVal(v: number | null, symbol = '£'): string {
  if (v == null) return '—';
  return `${symbol}${v.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatAttachmentProgress(p: { phase: string; current: number; total: number; downloaded?: number; extracted?: number }): string {
  if (p.phase === 'listing') {
    return `Listing transactions... ${p.current}/${p.total}`;
  }
  if (p.phase === 'downloading') {
    const parts = [`Downloaded ${p.downloaded ?? p.current}/${p.total}`];
    if (p.extracted && p.extracted > 0) parts.push(`Extracted ${p.extracted}`);
    return parts.join(' · ');
  }
  if (p.phase === 'extracting') {
    return `Extracting... ${p.current}/${p.total}${p.downloaded ? ` (${p.downloaded} downloaded)` : ''}`;
  }
  return `${p.phase}... ${p.current}/${p.total}`;
}

const currencySymbols: Record<string, string> = {
  GBP: '£', USD: '$', EUR: '€', JPY: '¥', CNY: '¥', CHF: 'CHF ',
};

// ─── Component ───────────────────────────────────────────────────────────────

export function DataExtractionClient({
  userName, firmName, assignedClients, unassignedClients
}: Props) {
  const { addTask, updateTask } = useBackgroundTasks();
  const [clientSearch, setClientSearch] = useState('');
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [showUnassigned, setShowUnassigned] = useState(false);
  const [requestingAccess, setRequestingAccess] = useState<string | null>(null);
  const [requestMessage, setRequestMessage] = useState<{ id: string; text: string; ok: boolean } | null>(null);

  // Document viewer state
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerFileId, setViewerFileId] = useState('');
  const [viewerActiveField, setViewerActiveField] = useState<string | null>(null);
  const [viewerFieldLocations, setViewerFieldLocations] = useState<Record<string, FieldLocation>>({});
  const [viewerExtractedValues, setViewerExtractedValues] = useState<Record<string, unknown>>({});

  // Upload state
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [jobResult, setJobResult] = useState<JobResult | null>(null);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [exportingZip, setExportingZip] = useState(false);

  // Previous sessions state
  const [previousJobs, setPreviousJobs] = useState<PreviousJob[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [loadingSession, setLoadingSession] = useState<string | null>(null);

  // Left panel state
  const [leftPanelMode, setLeftPanelMode] = useState<LeftPanelMode>('idle');
  const [leftPanelData, setLeftPanelData] = useState<SpreadsheetRow[]>([]);
  const [leftPanelColumns, setLeftPanelColumns] = useState<string[]>(ACCOUNTING_COLUMNS);
  const [leftPanelFileName, setLeftPanelFileName] = useState<string | null>(null);
  const [leftPanelFromAccounting, setLeftPanelFromAccounting] = useState(false);
  const leftSpreadsheetRef = useRef<HTMLInputElement>(null);

  // Audit setup state
  const [auditPeriodFrom, setAuditPeriodFrom] = useState('');
  const [auditPeriodTo, setAuditPeriodTo] = useState('');
  const [functionalCurrency, setFunctionalCurrency] = useState('GBP');
  const [clearlyTrivial, setClearlyTrivial] = useState<number | null>(null);
  const [totalPopulationValue, setTotalPopulationValue] = useState<number | null>(null);
  const [showPopulationPrompt, setShowPopulationPrompt] = useState(false);
  const [populationInput, setPopulationInput] = useState('');

  // Sampling state
  const [sampledRows, setSampledRows] = useState<Set<number>>(new Set());
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [showSampleDialog, setShowSampleDialog] = useState(false);
  const [sampleSizeInput, setSampleSizeInput] = useState('10');

  // Matching state
  const [rowMatches, setRowMatches] = useState<Map<number, RowMatch>>(new Map());
  const [unmatchedRecords, setUnmatchedRecords] = useState<ExtractedRecord[]>([]);

  // Transaction metadata for Xero attachment extraction
  const [txnMetadata, setTxnMetadata] = useState<{ id: string; type: string; hasAttachments: boolean }[]>([]);
  const [extractingAttachments, setExtractingAttachments] = useState(false);
  const [attachmentProgress, setAttachmentProgress] = useState<{ phase: string; current: number; total: number; downloaded?: number; extracted?: number } | null>(null);
  const [noDocsTxnIds, setNoDocsTxnIds] = useState<Set<string>>(new Set());
  const [sampleExtracted, setSampleExtracted] = useState(false);
  const [extractedTxnIds, setExtractedTxnIds] = useState<Set<string>>(new Set());

  // FX rate cache
  const fxCache = useRef<Map<string, { rate: number; source: string }>>(new Map());

  // Xero connection state
  const [xeroConnected, setXeroConnected] = useState(false);
  const [xeroOrgName, setXeroOrgName] = useState<string | null>(null);
  const [xeroShowModal, setXeroShowModal] = useState(false);
  const [xeroAccounts, setXeroAccounts] = useState<XeroAccount[]>([]);
  const [xeroSelectedCodes, setXeroSelectedCodes] = useState<Set<string>>(new Set());
  const [xeroDateFrom, setXeroDateFrom] = useState('');
  const [xeroDateTo, setXeroDateTo] = useState('');
  const [xeroLoading, setXeroLoading] = useState(false);
  const [xeroCategory, setXeroCategory] = useState('');
  const [xeroError, setXeroError] = useState('');

  // Xero delegated access request state
  const [xeroRequestSending, setXeroRequestSending] = useState(false);
  const [xeroRequestStatus, setXeroRequestStatus] = useState<{
    status: string;
    recipientEmail: string;
    createdAt: string;
  } | null>(null);

  // Progress tracking
  const [progress, setProgress] = useState<{
    total: number;
    extracted: number;
    failed: number;
    duplicated: number;
    complete: boolean;
  } | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef(false);
  const activeServerTaskRef = useRef<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const filteredAssigned = assignedClients.filter(c =>
    c.clientName.toLowerCase().includes(clientSearch.toLowerCase())
  );
  const filteredUnassigned = unassignedClients.filter(c =>
    c.clientName.toLowerCase().includes(clientSearch.toLowerCase())
  );

  const sym = currencySymbols[functionalCurrency] || functionalCurrency + ' ';

  // Determine if we need line-item columns or FX columns
  const hasLineItems = useMemo(() => {
    for (const [, m] of rowMatches) {
      if (m.matchedLineIdx != null) return true;
      if (m.record.lineItems?.length > 1) return true;
    }
    return false;
  }, [rowMatches]);

  const hasForeignCurrency = useMemo(() => {
    for (const [, m] of rowMatches) {
      if (m.fxRate && m.fxRate !== 1) return true;
    }
    return false;
  }, [rowMatches]);

  const uploadedDocColumns = useMemo(() => {
    const cols = [...UPLOADED_DOC_COLUMNS_BASE];
    if (hasLineItems) cols.push('Line No', 'Line Total');
    if (hasForeignCurrency) cols.push('FX Rate', `Amount (${functionalCurrency})`);
    return cols;
  }, [hasLineItems, hasForeignCurrency, functionalCurrency]);

  // ─── Audit verification computation ──────────────────────────────────────

  function computeVerification(rowIdx: number): AuditVerification | null {
    const match = rowMatches.get(rowIdx);
    if (!match) return null;
    const row = leftPanelData[rowIdx];

    const grossCol = leftPanelColumns.find(c => c.toLowerCase().includes('gross') || c.toLowerCase() === 'total');
    const dateCol = leftPanelColumns.find(c => c.toLowerCase().includes('date'));
    const descCol = leftPanelColumns.find(c => c.toLowerCase().includes('description') || c.toLowerCase().includes('desc'));
    const contactCol = leftPanelColumns.find(c => c.toLowerCase().includes('contact'));

    // Amount check
    let amountDiff: number | null = null;
    const leftGross = grossCol ? parseNumber(row[grossCol]) : null;
    let matchedAmount: number | null = null;
    if (match.matchedLineIdx != null) {
      const li = match.record.lineItems?.[match.matchedLineIdx];
      matchedAmount = li ? ((li.net || 0) + (li.tax || 0)) : null;
    } else {
      matchedAmount = match.convertedAmount ?? match.record.grossTotal;
    }
    if (leftGross != null && matchedAmount != null) {
      amountDiff = Math.round((leftGross - matchedAmount) * 100) / 100;
    }

    // Date check
    let dateDiffDays: number | null = null;
    const leftDate = dateCol ? normalizeDate(row[dateCol]) : null;
    const matchedDate = normalizeDate(match.record.documentDate);
    if (leftDate && matchedDate) {
      dateDiffDays = daysBetween(leftDate, matchedDate);
    }

    // Period check
    let periodResult: { text: string; inPeriod: boolean } | null = null;
    if (matchedDate && auditPeriodFrom && auditPeriodTo) {
      const docDate = new Date(matchedDate);
      const from = new Date(auditPeriodFrom);
      const to = new Date(auditPeriodTo);
      const inPeriod = docDate >= from && docDate <= to;
      periodResult = {
        text: `${docDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} — ${inPeriod ? 'Within period' : 'Outside period'}`,
        inPeriod,
      };
    }

    // Consistency check
    let consistencyResult: { text: string; consistent: boolean } | null = null;
    const leftDesc = descCol ? (row[descCol] || '').toLowerCase().trim() : '';
    const leftContact = contactCol ? (row[contactCol] || '').toLowerCase().trim() : '';
    const recSeller = (match.record.sellerName || '').toLowerCase().trim();
    const recPurchaser = (match.record.purchaserName || '').toLowerCase().trim();
    const issues: string[] = [];
    if (leftContact) {
      const contactMatchesSeller = recSeller && (leftContact.includes(recSeller) || recSeller.includes(leftContact));
      const contactMatchesPurchaser = recPurchaser && (leftContact.includes(recPurchaser) || recPurchaser.includes(leftContact));
      if (!contactMatchesSeller && !contactMatchesPurchaser && (recSeller || recPurchaser)) {
        issues.push(`Contact "${row[contactCol!]}" does not match seller "${match.record.sellerName || '—'}" or purchaser "${match.record.purchaserName || '—'}"`);
      }
    }
    if (leftDesc && match.record.lineItems?.length) {
      const lineDescs = match.record.lineItems.map(l => (l.description || '').toLowerCase());
      const anyDescMatch = lineDescs.some(ld => ld && (leftDesc.includes(ld) || ld.includes(leftDesc)));
      if (!anyDescMatch && leftDesc.length > 3) {
        // Only flag if description is meaningful
      }
    }
    consistencyResult = {
      text: issues.length > 0 ? issues.join('; ') : 'Consistent',
      consistent: issues.length === 0,
    };

    return { amountDiff, dateDiffDays, periodResult, consistencyResult };
  }

  // ─── Audit summary computation ──────────────────────────────────────────

  const auditSummary = useMemo(() => {
    if (leftPanelData.length === 0) return null;

    const grossCol = leftPanelColumns.find(c => c.toLowerCase().includes('gross') || c.toLowerCase() === 'total');

    let sampleTotal = 0;
    let errorTotal = 0;

    for (const ri of sampledRows) {
      const row = leftPanelData[ri];
      if (!row) continue;
      const leftGross = grossCol ? parseNumber(row[grossCol]) : null;
      if (leftGross != null) sampleTotal += Math.abs(leftGross);

      const match = rowMatches.get(ri);
      if (match) {
        const v = computeVerification(ri);
        if (v?.amountDiff != null) errorTotal += Math.abs(v.amountDiff);
      }
    }

    const A = totalPopulationValue ?? 0;
    const B = sampleTotal;
    const C = errorTotal;
    const D = B > 0 ? (C / B) * 100 : 0;
    const E = B > 0 ? (C / B) * A : 0;

    let conclusion: { text: string; color: string };
    if (C === 0) {
      conclusion = { text: 'No Errors Found', color: 'text-green-700' };
    } else if (clearlyTrivial != null && E < clearlyTrivial) {
      conclusion = { text: 'No Material Error', color: 'text-green-700' };
    } else {
      conclusion = { text: 'Potential Error', color: 'text-red-700' };
    }

    return { A, B, C, D: Math.round(D * 100) / 100, E: Math.round(E * 100) / 100, conclusion };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sampledRows, rowMatches, leftPanelData, leftPanelColumns, totalPopulationValue, clearlyTrivial, auditPeriodFrom, auditPeriodTo]);

  // ─── Document viewer helper ──────────────────────────────────────────

  function openDocumentViewer(record: ExtractedRecord, fieldName: string | null) {
    if (!record.fileId) return;
    const values: Record<string, unknown> = {
      purchaserName: record.purchaserName,
      purchaserTaxId: record.purchaserTaxId,
      purchaserCountry: record.purchaserCountry,
      sellerName: record.sellerName,
      sellerTaxId: record.sellerTaxId,
      sellerCountry: record.sellerCountry,
      documentRef: record.documentRef,
      documentDate: record.documentDate,
      dueDate: record.dueDate,
      netTotal: record.netTotal,
      dutyTotal: record.dutyTotal,
      taxTotal: record.taxTotal,
      grossTotal: record.grossTotal,
    };
    setViewerFileId(record.fileId);
    setViewerActiveField(fieldName);
    setViewerFieldLocations(record.fieldLocations || {});
    setViewerExtractedValues(values);
    setViewerOpen(true);
  }

  // ─── Access request ──────────────────────────────────────────────────

  async function handleRequestAccess(clientId: string) {
    setRequestingAccess(clientId);
    setRequestMessage(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/request-access`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setRequestMessage({ id: clientId, text: data.message || 'Request sent!', ok: true });
      } else {
        setRequestMessage({ id: clientId, text: data.error || 'Failed to send request.', ok: false });
      }
    } catch {
      setRequestMessage({ id: clientId, text: 'Network error. Please try again.', ok: false });
    } finally {
      setRequestingAccess(null);
    }
  }

  function toggleRowExpand(id: string) {
    setExpandedRows(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    setUploadedFiles(prev => [...prev, ...files]);
    setError('');
  }, []);

  const removeFile = useCallback((index: number) => {
    setUploadedFiles(prev => prev.filter((_, i) => i !== index));
  }, []);

  // ─── Polling ────────────────────────────────────────────────────────────

  function startPolling(jobId: string) {
    if (pollingRef.current) clearInterval(pollingRef.current);
    pollingRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/extraction/status?jobId=${jobId}`);
        if (!res.ok) return;
        const data = await res.json();
        setProgress({ total: data.total, extracted: data.extracted, failed: data.failed, duplicated: data.duplicated || 0, complete: data.complete });
        if (data.complete) {
          if (pollingRef.current) clearInterval(pollingRef.current);
          pollingRef.current = null;
          const jobRes = await fetch(`/api/extraction/process?jobId=${jobId}`);
          const jobData = await jobRes.json();
          setJobResult(jobData);
          setProcessing(false);
        }
      } catch { /* non-fatal */ }
    }, 1500);
  }

  useEffect(() => () => { if (pollingRef.current) clearInterval(pollingRef.current); }, []);

  // ─── Upload & process ─────────────────────────────────────────────────

  async function handleUploadAndProcess() {
    if (!selectedClient || !uploadedFiles.length) return;
    setUploading(true);
    setError('');
    setProgress(null);
    setJobResult(null);
    setRowMatches(new Map());
    setUnmatchedRecords([]);
    try {
      const formData = new FormData();
      formData.append('clientId', selectedClient.id);
      uploadedFiles.forEach(f => formData.append('files', f));
      const uploadRes = await fetch('/api/extraction/upload', { method: 'POST', body: formData });
      const uploadData = await uploadRes.json();
      if (!uploadRes.ok) throw new Error(uploadData.error || 'Upload failed');
      setCurrentJobId(uploadData.jobId);
      setUploading(false);
      setProcessing(true);
      const processRes = await fetch('/api/extraction/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: uploadData.jobId }),
      });
      const processData = await processRes.json();
      if (!processRes.ok) throw new Error(processData.error || 'Processing failed');
      setProgress({ total: processData.totalFiles, extracted: 0, failed: 0, duplicated: uploadData.duplicatesSkipped || 0, complete: false });
      startPolling(uploadData.jobId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
      setUploading(false);
      setProcessing(false);
    }
  }

  // ─── Export handlers ────────────────────────────────────────────────

  async function handleExportExcel() {
    if (!currentJobId) return;
    const res = await fetch(`/api/extraction/export?jobId=${currentJobId}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `extraction-${currentJobId.substring(0, 8)}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleExportZip() {
    if (!currentJobId) return;
    setExportingZip(true);
    try {
      const res = await fetch(`/api/extraction/${currentJobId}/export`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Export failed' }));
        throw new Error(data.error || 'Export failed');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `extraction_project_${currentJobId.substring(0, 8)}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExportingZip(false);
    }
  }

  // ─── Previous sessions ────────────────────────────────────────────

  async function loadPreviousJobs(clientId: string) {
    setLoadingJobs(true);
    try {
      const res = await fetch(`/api/extraction/jobs?clientId=${clientId}`);
      if (res.ok) setPreviousJobs(await res.json());
    } catch { /* non-fatal */ }
    finally { setLoadingJobs(false); }
  }

  async function loadSession(jobId: string) {
    setLoadingSession(jobId);
    try {
      const res = await fetch(`/api/extraction/process?jobId=${jobId}`);
      if (res.ok) {
        const data = await res.json();
        setJobResult(data);
        setCurrentJobId(jobId);
        setRowMatches(new Map());
        setUnmatchedRecords([]);
      }
    } catch { /* non-fatal */ }
    finally { setLoadingSession(null); }
  }

  useEffect(() => {
    if (selectedClient) loadPreviousJobs(selectedClient.id);
  }, [selectedClient]);

  // ─── FX rate fetch helper ──────────────────────────────────────────

  async function fetchFxRate(from: string, to: string, date?: string): Promise<{ rate: number; source: string } | null> {
    const key = `${from}-${to}-${date || 'latest'}`;
    if (fxCache.current.has(key)) return fxCache.current.get(key)!;
    try {
      const params = new URLSearchParams({ from, to });
      if (date) params.set('date', date);
      const res = await fetch(`/api/fx-rate?${params}`);
      if (res.ok) {
        const data = await res.json();
        if (data.rate) {
          const result = { rate: data.rate, source: data.source };
          fxCache.current.set(key, result);
          return result;
        }
      }
    } catch { /* non-fatal */ }
    return null;
  }

  // ─── Matching logic ────────────────────────────────────────────────

  async function runAuditMatch() {
    if (!jobResult || leftPanelData.length === 0) return;

    const grossCol = leftPanelColumns.find(c => c.toLowerCase().includes('gross') || c.toLowerCase() === 'total');
    const netCol = leftPanelColumns.find(c => c.toLowerCase().includes('net'));
    const dateCol = leftPanelColumns.find(c => c.toLowerCase().includes('date'));
    const refCol = leftPanelColumns.find(c =>
      c.toLowerCase().includes('ref') || c.toLowerCase().includes('reference') || c.toLowerCase().includes('invoice')
    );

    const newMatches = new Map<number, RowMatch>();
    const usedLeftRows = new Set<number>();
    const usedRecords = new Set<string>();

    for (const record of jobResult.records) {
      let bestRowIdx = -1;
      let bestScore = 0;

      for (let ri = 0; ri < leftPanelData.length; ri++) {
        if (usedLeftRows.has(ri)) continue;
        const row = leftPanelData[ri];
        const hasData = Object.values(row).some(v => v && v.trim());
        if (!hasData) continue;

        let score = 0;
        if (grossCol && record.grossTotal != null) {
          const leftGross = parseNumber(row[grossCol]);
          if (leftGross != null && Math.abs(leftGross - record.grossTotal) < 0.02) score += 3;
        }
        if (netCol && record.netTotal != null) {
          const leftNet = parseNumber(row[netCol]);
          if (leftNet != null && Math.abs(leftNet - record.netTotal) < 0.02) score += 2;
        }
        if (dateCol && record.documentDate) {
          const ld = normalizeDate(row[dateCol]);
          const rd = normalizeDate(record.documentDate);
          if (ld && rd && ld === rd) score += 2;
        }
        if (refCol && record.documentRef) {
          const lr = (row[refCol] || '').trim().toLowerCase();
          const dr = record.documentRef.trim().toLowerCase();
          if (lr && dr && (lr.includes(dr) || dr.includes(lr))) score += 2;
        }

        if (score > bestScore) {
          bestScore = score;
          bestRowIdx = ri;
        }
      }

      // Also check line items for amount matching if no direct gross match
      if (bestScore < 3 && record.lineItems?.length > 0 && grossCol) {
        for (let ri = 0; ri < leftPanelData.length; ri++) {
          if (usedLeftRows.has(ri)) continue;
          const row = leftPanelData[ri];
          const leftGross = parseNumber(row[grossCol]);
          if (leftGross == null) continue;

          for (let li = 0; li < record.lineItems.length; li++) {
            const lineTotal = (record.lineItems[li].net || 0) + (record.lineItems[li].tax || 0);
            if (Math.abs(leftGross - lineTotal) < 0.02) {
              const lineScore = 3;
              const dateScore = dateCol && record.documentDate
                ? (normalizeDate(row[dateCol]) === normalizeDate(record.documentDate) ? 2 : 0)
                : 0;
              const totalScore = lineScore + dateScore;
              if (totalScore > bestScore) {
                bestScore = totalScore;
                bestRowIdx = ri;
              }
            }
          }
        }
      }

      if (bestScore >= 3 && bestRowIdx >= 0) {
        // Check for FX
        const recCurrency = record.currency?.toUpperCase() || functionalCurrency;
        let fxRate: number | undefined;
        let fxSource: string | undefined;
        let convertedAmount: number | undefined;
        if (recCurrency !== functionalCurrency && record.grossTotal != null) {
          const dateStr = normalizeDate(record.documentDate) || undefined;
          const fx = await fetchFxRate(recCurrency, functionalCurrency, dateStr);
          if (fx) {
            fxRate = fx.rate;
            fxSource = fx.source;
            convertedAmount = Math.round(record.grossTotal * fx.rate * 100) / 100;
          }
        }

        // Determine if line-item match
        let matchedLineIdx: number | undefined;
        if (record.lineItems?.length > 1 && grossCol) {
          const leftGross = parseNumber(leftPanelData[bestRowIdx][grossCol]);
          if (leftGross != null && record.grossTotal != null && Math.abs(leftGross - record.grossTotal) >= 0.02) {
            for (let li = 0; li < record.lineItems.length; li++) {
              const lineTotal = (record.lineItems[li].net || 0) + (record.lineItems[li].tax || 0);
              if (Math.abs(leftGross - lineTotal) < 0.02) {
                matchedLineIdx = li;
                break;
              }
            }
          }
        }

        newMatches.set(bestRowIdx, {
          record,
          confidence: bestScore >= 5 ? 'high' : 'uncertain',
          matchedLineIdx,
          fxRate,
          fxSource,
          convertedAmount,
        });
        usedLeftRows.add(bestRowIdx);
        usedRecords.add(record.id);
      }
    }

    setRowMatches(newMatches);
    setUnmatchedRecords(jobResult.records.filter(r => !usedRecords.has(r.id)));
  }

  // Auto-match when extraction completes and left panel has data
  useEffect(() => {
    if (jobResult && leftPanelData.length > 0 && leftPanelMode !== 'idle') {
      runAuditMatch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobResult]);

  // Auto-calculate population value from accounting system data
  useEffect(() => {
    if (leftPanelFromAccounting && leftPanelData.length > 0) {
      const grossCol = leftPanelColumns.find(c => c.toLowerCase().includes('gross') || c.toLowerCase() === 'total');
      if (grossCol) {
        let total = 0;
        for (const row of leftPanelData) {
          const v = parseNumber(row[grossCol]);
          if (v != null) total += v;
        }
        setTotalPopulationValue(Math.round(total * 100) / 100);
      }
    }
  }, [leftPanelFromAccounting, leftPanelData, leftPanelColumns]);

  // ─── Sampling ──────────────────────────────────────────────────────

  function handleMakeSelectionSample() {
    if (selectedRows.size === 0) return;
    setSampledRows(prev => {
      const next = new Set(prev);
      for (const ri of selectedRows) next.add(ri);
      return next;
    });
    setSelectedRows(new Set());
  }

  function handleMakeSample(size: number) {
    const nonEmptyIndices: number[] = [];
    for (let i = 0; i < leftPanelData.length; i++) {
      const row = leftPanelData[i];
      if (Object.values(row).some(v => v && v.trim())) {
        nonEmptyIndices.push(i);
      }
    }
    const shuffled = [...nonEmptyIndices].sort(() => Math.random() - 0.5);
    const picked = shuffled.slice(0, Math.min(size, shuffled.length));
    setSampledRows(new Set(picked));
    setShowSampleDialog(false);
  }

  function toggleRowSelect(ri: number) {
    setSelectedRows(prev => {
      const next = new Set(prev);
      next.has(ri) ? next.delete(ri) : next.add(ri);
      return next;
    });
  }

  // ─── Left panel handlers ────────────────────────────────────────────

  async function handleUploadSpreadsheet(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setLeftPanelFileName(file.name);
    setLeftPanelFromAccounting(false);

    if (file.name.endsWith('.csv')) {
      const text = await file.text();
      const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
      if (lines.length === 0) return;
      const headers = lines[0].split(',').map(h => h.replace(/^"|"$/g, '').trim());
      setLeftPanelColumns(headers);
      const rows = lines.slice(1).map(line => {
        const vals = line.split(',').map(v => v.replace(/^"|"$/g, '').trim());
        const row: SpreadsheetRow = {};
        headers.forEach((h, i) => { row[h] = vals[i] || ''; });
        return row;
      });
      setLeftPanelData(rows);
      setLeftPanelMode('spreadsheet');
    } else {
      try {
        const ExcelJS = await import('exceljs');
        const workbook = new ExcelJS.Workbook();
        const buffer = await file.arrayBuffer();
        await workbook.xlsx.load(buffer);
        const sheet = workbook.worksheets[0];
        if (!sheet) return;
        const headers: string[] = [];
        sheet.getRow(1).eachCell((cell, colNum) => {
          headers[colNum - 1] = String(cell.value || `Column ${colNum}`);
        });
        setLeftPanelColumns(headers);
        const rows: SpreadsheetRow[] = [];
        sheet.eachRow((row, rowNum) => {
          if (rowNum === 1) return;
          const r: SpreadsheetRow = {};
          headers.forEach((h, i) => {
            const cell = row.getCell(i + 1);
            r[h] = cell.value != null ? String(cell.value) : '';
          });
          rows.push(r);
        });
        setLeftPanelData(rows);
        setLeftPanelMode('spreadsheet');
      } catch (err) {
        setError(`Failed to parse spreadsheet: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    }
    if (leftSpreadsheetRef.current) leftSpreadsheetRef.current.value = '';
  }

  function handleLoadBlankSpreadsheet() {
    setLeftPanelColumns(ACCOUNTING_COLUMNS);
    const emptyRows: SpreadsheetRow[] = Array.from({ length: 50 }, () => {
      const row: SpreadsheetRow = {};
      ACCOUNTING_COLUMNS.forEach(c => { row[c] = ''; });
      return row;
    });
    setLeftPanelData(emptyRows);
    setLeftPanelFileName(null);
    setLeftPanelFromAccounting(false);
    setLeftPanelMode('blank');
  }

  function addEmptyRows(count: number) {
    setLeftPanelData(prev => {
      const newRows: SpreadsheetRow[] = Array.from({ length: count }, () => {
        const row: SpreadsheetRow = {};
        leftPanelColumns.forEach(c => { row[c] = ''; });
        return row;
      });
      return [...prev, ...newRows];
    });
  }

  function handleCellEdit(rowIdx: number, col: string, value: string) {
    setLeftPanelData(prev => {
      const updated = [...prev];
      updated[rowIdx] = { ...updated[rowIdx], [col]: value };
      if (rowIdx >= updated.length - 3 && value) {
        const newRows: SpreadsheetRow[] = Array.from({ length: 50 }, () => {
          const row: SpreadsheetRow = {};
          leftPanelColumns.forEach(c => { row[c] = ''; });
          return row;
        });
        return [...updated, ...newRows];
      }
      return updated;
    });
  }

  function handlePaste(e: React.ClipboardEvent<HTMLTableElement>) {
    const text = e.clipboardData.getData('text/plain');
    if (!text) return;
    const activeEl = document.activeElement;
    if (!activeEl || !(activeEl instanceof HTMLInputElement)) return;
    const rowIdx = parseInt(activeEl.dataset.row || '-1', 10);
    const colIdx = parseInt(activeEl.dataset.col || '-1', 10);
    if (rowIdx < 0 || colIdx < 0) return;
    e.preventDefault();
    const pastedRows = text.split('\n').map(l => l.split('\t'));
    setLeftPanelData(prev => {
      const updated = [...prev];
      for (let r = 0; r < pastedRows.length; r++) {
        const targetRow = rowIdx + r;
        if (targetRow >= updated.length) {
          const newRow: SpreadsheetRow = {};
          leftPanelColumns.forEach(c => { newRow[c] = ''; });
          updated.push(newRow);
        }
        for (let c = 0; c < pastedRows[r].length; c++) {
          const targetCol = colIdx + c;
          if (targetCol < leftPanelColumns.length) {
            updated[targetRow] = { ...updated[targetRow], [leftPanelColumns[targetCol]]: pastedRows[r][c].trim() };
          }
        }
      }
      return updated;
    });
  }

  // ─── Xero ──────────────────────────────────────────────────────────

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

  function handleXeroCategoryChange(category: string) {
    setXeroCategory(category);
    if (!category) { setXeroSelectedCodes(new Set()); return; }
    const active = xeroAccounts.filter(a => a.Status === 'ACTIVE');
    let filtered: XeroAccount[] = [];
    const isStaffAccount = (acc: XeroAccount) =>
      STAFF_COST_KEYWORDS.some(kw => acc.Name.toLowerCase().includes(kw));
    switch (category) {
      case 'sales': filtered = active.filter(a => a.Type === 'REVENUE' || a.Type === 'SALES'); break;
      case 'direct_costs': filtered = active.filter(a => (a.Type === 'DIRECTCOSTS' || a.Type === 'DIRECT COSTS') && !isStaffAccount(a)); break;
      case 'overheads': filtered = active.filter(a => (a.Type === 'OVERHEADS' || a.Type === 'OVERHEAD' || a.Type === 'EXPENSE') && !isStaffAccount(a)); break;
      case 'stock': filtered = active.filter(a => a.Type === 'INVENTORY' || a.Name.toLowerCase().includes('stock') || a.Name.toLowerCase().includes('inventory')); break;
      case 'fixed_assets': filtered = active.filter(a => a.Type === 'FIXED' || a.Type === 'NONCURRENT' || a.Name.toLowerCase().includes('fixed asset') || a.Name.toLowerCase().includes('capital')); break;
    }
    setXeroSelectedCodes(new Set(filtered.map(a => a.Code)));
  }

  async function handleXeroButtonClick() {
    if (!selectedClient) return;
    setXeroLoading(true);
    setXeroError('');
    try {
      const statusRes = await fetch(`/api/accounting/xero/status?clientId=${selectedClient.id}`);
      const statusData = await statusRes.json();
      if (statusData.connected) {
        setXeroConnected(true);
        setXeroOrgName(statusData.orgName);
        const accRes = await fetch(`/api/accounting/xero/data?clientId=${selectedClient.id}&type=accounts`);
        const accData = await accRes.json();
        if (accData.accounts) setXeroAccounts(accData.accounts);
        setXeroCategory('');
        setXeroSelectedCodes(new Set());
        setXeroShowModal(true);
      } else {
        await handleRequestXeroAccess();
      }
    } catch (err) {
      setXeroError(err instanceof Error ? err.message : 'Failed to check Xero connection');
    } finally {
      setXeroLoading(false);
    }
  }

  async function handleXeroDisconnect() {
    if (!selectedClient) return;
    if (!confirm(`Disconnect ${xeroOrgName || 'Xero'} from ${selectedClient.clientName}? You will need to re-authorise to reconnect.`)) return;
    try {
      const res = await fetch('/api/accounting/xero/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: selectedClient.id }),
      });
      if (!res.ok) {
        const data = await res.json();
        setXeroError(data.error || 'Failed to disconnect');
        return;
      }
      setXeroConnected(false);
      setXeroOrgName(null);
      setXeroRequestStatus(null);
      setXeroError('');
    } catch {
      setXeroError('Failed to disconnect from Xero');
    }
  }

  async function handleRequestXeroAccess() {
    if (!selectedClient) return;
    setXeroRequestSending(true);
    setXeroError('');
    try {
      const res = await fetch('/api/accounting/xero/request-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: selectedClient.id }),
      });
      let data;
      try {
        data = await res.json();
      } catch {
        throw new Error(`Server error (${res.status}). Please check the server logs.`);
      }
      if (!res.ok) throw new Error(data.error || 'Failed to send request');
      console.log('[Xero] Email send result:', data);
      setXeroRequestStatus({
        status: 'pending',
        recipientEmail: selectedClient.contactEmail || '',
        createdAt: new Date().toISOString(),
      });
      setXeroError('');
    } catch (err) {
      setXeroError(err instanceof Error ? err.message : 'Failed to send Xero access request');
    } finally {
      setXeroRequestSending(false);
    }
  }

  async function checkXeroRequestStatus() {
    if (!selectedClient) return;
    try {
      const res = await fetch(`/api/accounting/xero/request-access?clientId=${selectedClient.id}`);
      if (res.ok) {
        const data = await res.json();
        setXeroRequestStatus(data.request || null);
      }
    } catch { /* non-fatal */ }
  }

  useEffect(() => {
    if (selectedClient) {
      checkXeroRequestStatus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClient]);

  function toggleXeroCode(code: string) {
    setXeroSelectedCodes(prev => {
      const next = new Set(prev);
      next.has(code) ? next.delete(code) : next.add(code);
      return next;
    });
  }

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

  function loadXeroResultIntoSpreadsheet(data: { rows: Array<Record<string, unknown>> }) {
    const cols = ['Date', 'Reference', 'Contact', 'Type', 'Description', 'Account Code', 'Net', 'Tax', 'Total'];
    const rows: SpreadsheetRow[] = [];
    const meta: { id: string; type: string; hasAttachments: boolean }[] = [];
    for (const txn of data.rows) {
      const t = txn as { date?: string; reference?: string; contact?: string; type?: string; description?: string; accountCode?: string; lineAmount?: number | null; taxAmount?: number | null; subtotal?: number; tax?: number; total?: number; transactionId?: string; transactionType?: string; hasAttachments?: boolean };
      rows.push({
        'Date': parseXeroDate(t.date),
        'Reference': t.reference || '',
        'Contact': t.contact || '',
        'Type': t.type || '',
        'Description': t.description || '',
        'Account Code': t.accountCode || '',
        'Net': t.lineAmount != null ? String(t.lineAmount) : String(t.subtotal ?? ''),
        'Tax': t.taxAmount != null ? String(t.taxAmount) : String(t.tax ?? ''),
        'Total': t.lineAmount != null && t.taxAmount != null ? String(t.lineAmount + t.taxAmount) : String(t.total ?? ''),
      });
      meta.push({
        id: t.transactionId || '',
        type: t.transactionType || 'Invoice',
        hasAttachments: t.hasAttachments ?? false,
      });
    }
    setLeftPanelColumns(cols);
    setLeftPanelData(rows);
    setTxnMetadata(meta);
    setLeftPanelFileName(`Xero - ${xeroOrgName || 'Data'}`);
    setLeftPanelFromAccounting(true);
    setLeftPanelMode('spreadsheet');
    setNoDocsTxnIds(new Set());
  }

  async function handleXeroFetchData() {
    if (!selectedClient) return;
    if (!xeroDateFrom || !xeroDateTo) { setXeroError('Please select both from and to dates'); return; }
    setXeroError('');
    setXeroShowModal(false);

    const taskId = `xero-${selectedClient.id}-${Date.now()}`;
    const clientName = selectedClient.clientName;

    addTask({
      id: taskId,
      clientName,
      activity: `Fetching data from ${selectedClient.software || 'Xero'}`,
      status: 'running',
      toolPath: '/tools/data-extraction',
    });

    try {
      const codes = Array.from(xeroSelectedCodes).join(',');
      const startRes = await fetch('/api/accounting/xero/fetch-background', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: selectedClient.id,
          accountCodes: codes,
          dateFrom: xeroDateFrom,
          dateTo: xeroDateTo,
          excludeManualJournals: !!xeroCategory,
        }),
      });
      const startData = await startRes.json();
      if (!startRes.ok) throw new Error(startData.error || 'Failed to start fetch');

      const serverTaskId = startData.taskId;

      const poll = async () => {
        const maxPolls = 120;
        for (let i = 0; i < maxPolls; i++) {
          await new Promise(r => setTimeout(r, 3000));
          try {
            const statusRes = await fetch(`/api/accounting/xero/fetch-background?taskId=${serverTaskId}`);
            const statusData = await statusRes.json();

            if (statusData.status === 'completed') {
              updateTask(taskId, {
                status: 'completed',
                completedAt: Date.now(),
                result: statusData.data,
              });
              if (selectedClient?.id === clientId_at_start) {
                loadXeroResultIntoSpreadsheet(statusData.data);
              }
              return;
            }

            if (statusData.status === 'error') {
              updateTask(taskId, {
                status: 'error',
                error: statusData.error || 'Unknown error',
                completedAt: Date.now(),
              });
              return;
            }
          } catch {
            /* network blip, keep polling */
          }
        }
        updateTask(taskId, { status: 'error', error: 'Timed out waiting for data', completedAt: Date.now() });
      };

      const clientId_at_start = selectedClient.id;
      poll();

    } catch (err) {
      updateTask(taskId, {
        status: 'error',
        error: err instanceof Error ? err.message : 'Failed to start fetch',
        completedAt: Date.now(),
      });
    }
  }

  // ─── Extract Xero attachments ───────────────────────────────────────────

  async function handleExtractXeroAttachments(sampleOnly?: boolean) {
    if (!selectedClient || txnMetadata.length === 0) return;
    setExtractingAttachments(true);
    setAttachmentProgress(null);
    setError('');

    const uniqueTxns = new Map<string, { id: string; type: string; hasAttachments: boolean }>();
    for (const m of txnMetadata) {
      if (m.id && !uniqueTxns.has(m.id)) uniqueTxns.set(m.id, m);
    }

    let txnsToExtract: { id: string; type: string; hasAttachments: boolean }[];

    if (sampleOnly && sampledRows.size > 0) {
      const sampledTxnIds = new Set<string>();
      for (const ri of sampledRows) {
        const meta = txnMetadata[ri];
        if (meta?.id) sampledTxnIds.add(meta.id);
      }
      txnsToExtract = Array.from(uniqueTxns.values()).filter(t => sampledTxnIds.has(t.id));
    } else {
      txnsToExtract = Array.from(uniqueTxns.values()).filter(t => !extractedTxnIds.has(t.id));
    }

    if (txnsToExtract.length === 0) {
      setExtractingAttachments(false);
      return;
    }

    const taskId = `xero-attach-${selectedClient.id}-${Date.now()}`;
    const activityLabel = sampleOnly
      ? `Extracting sample documents from ${selectedClient.software || 'Xero'}`
      : `Extracting all documents from ${selectedClient.software || 'Xero'}`;
    addTask({
      id: taskId,
      clientName: selectedClient.clientName,
      activity: activityLabel,
      status: 'running',
      toolPath: '/tools/data-extraction',
    });

    abortRef.current = false;

    try {
      const startRes = await fetch('/api/accounting/xero/fetch-attachments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: selectedClient.id,
          transactions: txnsToExtract,
        }),
      });
      const startData = await startRes.json();
      if (!startRes.ok) throw new Error(startData.error || 'Failed to start attachment extraction');

      const serverTaskId = startData.taskId;
      activeServerTaskRef.current = serverTaskId;
      const clientIdAtStart = selectedClient.id;

      const poll = async () => {
        const maxPolls = 400;
        for (let i = 0; i < maxPolls; i++) {
          await new Promise(r => setTimeout(r, 3000));
          if (abortRef.current) {
            updateTask(taskId, { status: 'error', error: 'Stopped by user', completedAt: Date.now() });
            setExtractingAttachments(false);
            setAttachmentProgress(null);
            activeServerTaskRef.current = null;
            return;
          }
          try {
            const statusRes = await fetch(`/api/accounting/xero/fetch-attachments?taskId=${serverTaskId}`);
            if (!statusRes.ok) continue;
            const statusData = await statusRes.json();

            if (statusData.progress) {
              setAttachmentProgress(statusData.progress);
            }

            if (statusData.status === 'completed') {
              updateTask(taskId, { status: 'completed', completedAt: Date.now() });
              setExtractingAttachments(false);
              setAttachmentProgress(null);
              activeServerTaskRef.current = null;

              if (statusData.data?.noDocsTxnIds) {
                setNoDocsTxnIds(prev => {
                  const next = new Set(prev);
                  for (const id of statusData.data.noDocsTxnIds) next.add(id);
                  return next;
                });
              }

              setExtractedTxnIds(prev => {
                const next = new Set(prev);
                for (const t of txnsToExtract) next.add(t.id);
                return next;
              });

              if (sampleOnly) setSampleExtracted(true);

              if (statusData.data?.jobId && selectedClient?.id === clientIdAtStart) {
                const jobRes = await fetch(`/api/extraction/process?jobId=${statusData.data.jobId}`);
                if (jobRes.ok) {
                  const jobData = await jobRes.json();
                  setJobResult(prev => {
                    if (!prev) return jobData;
                    return {
                      ...prev,
                      files: [...prev.files, ...(jobData.files || [])],
                      records: [...prev.records, ...(jobData.records || [])],
                    };
                  });
                  setCurrentJobId(statusData.data.jobId);
                }
              }
              return;
            }

            if (statusData.status === 'error') {
              updateTask(taskId, { status: 'error', error: statusData.error, completedAt: Date.now() });
              setExtractingAttachments(false);
              setAttachmentProgress(null);
              activeServerTaskRef.current = null;
              setError(statusData.error || 'Attachment extraction failed');
              return;
            }
          } catch { /* network blip, keep polling */ }
        }
        updateTask(taskId, { status: 'error', error: 'Timed out', completedAt: Date.now() });
        setExtractingAttachments(false);
        setAttachmentProgress(null);
      };

      poll();
    } catch (err) {
      updateTask(taskId, {
        status: 'error',
        error: err instanceof Error ? err.message : 'Failed',
        completedAt: Date.now(),
      });
      setExtractingAttachments(false);
      setAttachmentProgress(null);
      setError(err instanceof Error ? err.message : 'Failed to extract attachments');
    }
  }

  // ─── Stop all background processing ─────────────────────────────────

  async function handleStop() {
    abortRef.current = true;

    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }

    if (activeServerTaskRef.current) {
      try {
        await fetch('/api/accounting/xero/fetch-attachments/cancel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskId: activeServerTaskRef.current }),
        });
      } catch { /* best-effort */ }
      activeServerTaskRef.current = null;
    }

    setExtractingAttachments(false);
    setAttachmentProgress(null);
    setProcessing(false);
    setUploading(false);
    setProgress(null);
  }

  const isAnythingRunning = extractingAttachments || processing || uploading || xeroLoading;

  // ─── Client selection screen ──────────────────────────────────────────

  if (!selectedClient) {
    return (
      <div className="min-h-screen bg-slate-50">
        <div className="bg-white border-b border-slate-200 px-6 py-4">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold text-slate-900">Financial Data Extraction</h1>
              <p className="text-sm text-slate-500">{firmName} · {userName}</p>
            </div>
            <Badge className="bg-blue-100 text-blue-700">Acumon Intelligence</Badge>
          </div>
        </div>
        <div className="max-w-3xl mx-auto px-6 py-12">
          <h2 className="text-2xl font-bold text-slate-900 mb-2">Select a Client</h2>
          <p className="text-slate-500 mb-6">Choose the client whose documents you want to process.</p>
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input placeholder="Search clients..." value={clientSearch} onChange={e => setClientSearch(e.target.value)} className="pl-9 h-11" />
          </div>
          <div className="space-y-2 mb-6">
            {filteredAssigned.length === 0 && !showUnassigned && (
              <p className="text-slate-400 text-sm text-center py-4">No assigned clients found.</p>
            )}
            {filteredAssigned.map(c => (
              <button key={c.id} onClick={() => setSelectedClient(c)}
                className="w-full text-left p-4 bg-white border border-slate-200 rounded-xl hover:border-blue-400 hover:bg-blue-50 transition-all group">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-semibold text-slate-800 group-hover:text-blue-700">{c.clientName}</div>
                    <div className="text-sm text-slate-500">
                      {c.software && <span className="mr-3">{c.software}</span>}
                      {c.contactName && <span>{c.contactName}</span>}
                    </div>
                  </div>
                  <ChevronRight className="h-5 w-5 text-slate-300 group-hover:text-blue-400" />
                </div>
              </button>
            ))}
          </div>
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => setShowUnassigned(!showUnassigned)}>
              <UserPlus className="h-4 w-4 mr-2" />{showUnassigned ? 'Hide' : 'Request Access to Another Client'}
            </Button>
            <Button variant="outline" onClick={() => window.location.href = '/my-account?tab=clients'}>
              <Plus className="h-4 w-4 mr-2" />Add New Client
            </Button>
          </div>
          {showUnassigned && filteredUnassigned.length > 0 && (
            <div className="mt-4 space-y-2">
              <p className="text-sm font-medium text-slate-600 mb-2">Other firm clients (request access):</p>
              {filteredUnassigned.map(c => (
                <div key={c.id} className="flex items-center justify-between p-4 bg-slate-50 border border-slate-200 rounded-xl">
                  <div>
                    <div className="font-medium text-slate-700">{c.clientName}</div>
                    <div className="text-sm text-slate-400">{c.software}</div>
                    {requestMessage?.id === c.id && (
                      <p className={`text-xs mt-1 ${requestMessage.ok ? 'text-green-600' : 'text-red-600'}`}>{requestMessage.text}</p>
                    )}
                  </div>
                  <Button size="sm" variant="outline" disabled={requestingAccess === c.id} onClick={() => handleRequestAccess(c.id)}>
                    {requestingAccess === c.id
                      ? <><Loader2 className="h-3 w-3 animate-spin mr-1" />Sending...</>
                      : 'Request Access'}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ─── Render helpers ──────────────────────────────────────────────────

  function renderDocCellValue(match: RowMatch, colName: string): React.ReactNode {
    const r = match.record;
    const li = match.matchedLineIdx != null ? r.lineItems?.[match.matchedLineIdx] : null;
    let val: string | null = null;
    let fieldName: string | null = null;

    switch (colName) {
      case 'Ref': val = r.referenceId; fieldName = null; break;
      case 'Doc Ref': val = r.documentRef; fieldName = 'documentRef'; break;
      case 'Date': val = r.documentDate; fieldName = 'documentDate'; break;
      case 'Due Date': val = r.dueDate; fieldName = 'dueDate'; break;
      case 'Seller': val = r.sellerName; fieldName = 'sellerName'; break;
      case 'Purchaser': val = r.purchaserName; fieldName = 'purchaserName'; break;
      case 'Net': val = formatCurrencyVal(li ? li.net : r.netTotal, sym); fieldName = 'netTotal'; break;
      case 'Tax': val = formatCurrencyVal(li ? li.tax : r.taxTotal, sym); fieldName = 'taxTotal'; break;
      case 'Gross': val = formatCurrencyVal(li ? ((li.net || 0) + (li.tax || 0)) : r.grossTotal, sym); fieldName = 'grossTotal'; break;
      case 'Line No': val = match.matchedLineIdx != null ? String(match.matchedLineIdx + 1) : ''; break;
      case 'Line Total': val = li ? formatCurrencyVal((li.net || 0) + (li.tax || 0), sym) : ''; break;
      case 'FX Rate': val = match.fxRate ? match.fxRate.toFixed(4) : ''; break;
      case `Amount (${functionalCurrency})`: val = match.convertedAmount != null ? formatCurrencyVal(match.convertedAmount, sym) : ''; break;
      default: val = '';
    }

    if (!val || val === '—') return <span className="text-slate-300">—</span>;

    if (fieldName && r.fieldLocations && Object.keys(r.fieldLocations).length > 0) {
      return (
        <button onClick={() => openDocumentViewer(r, fieldName)}
          className="text-blue-600 hover:text-blue-800 hover:underline text-left" title="View in document">
          {val}
        </button>
      );
    }

    if (colName === 'FX Rate' && match.fxSource) {
      return <span title={`Source: ${match.fxSource}`}>{val}</span>;
    }

    return <span>{val}</span>;
  }

  // ─── Main tool screen ──────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Top bar */}
      <div className="bg-white border-b border-slate-200 px-6 py-3 flex-shrink-0">
        <div className="max-w-full mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => { setSelectedClient(null); setJobResult(null); setUploadedFiles([]); setCurrentJobId(null); setRowMatches(new Map()); setUnmatchedRecords([]); setSampledRows(new Set()); }}
              className="text-sm text-blue-600 hover:underline">← Back</button>
            <span className="text-slate-300">|</span>
            <div>
              <span className="font-semibold text-slate-800">{selectedClient.clientName}</span>
              <span className="text-slate-400 text-sm ml-2">· {selectedClient.contactName}</span>
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => {
              setJobResult(null); setUploadedFiles([]); setCurrentJobId(null);
              setRowMatches(new Map()); setUnmatchedRecords([]); setSampledRows(new Set());
              setSelectedRows(new Set()); setLeftPanelData([]); setLeftPanelColumns([]);
              setLeftPanelMode('idle'); setLeftPanelFileName(null); setLeftPanelFromAccounting(false);
              setTxnMetadata([]); setNoDocsTxnIds(new Set());
              setSampleExtracted(false); setExtractedTxnIds(new Set());
              loadPreviousJobs(selectedClient.id);
            }}>
              <Plus className="h-4 w-4 mr-1" />New Session
            </Button>
            {isAnythingRunning && (
              <Button size="sm" variant="destructive" onClick={handleStop} className="bg-red-600 hover:bg-red-700">
                <Square className="h-3.5 w-3.5 mr-1 fill-current" />Stop
              </Button>
            )}
            {jobResult && (
              <>
                <Button size="sm" variant="outline" onClick={handleExportExcel}>
                  <Download className="h-4 w-4 mr-1" />Export Excel
                </Button>
                <Button size="sm" variant="outline" onClick={handleExportZip} disabled={exportingZip}>
                  {exportingZip ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Download className="h-4 w-4 mr-1" />}
                  Export Project
                </Button>
                <Button size="sm" variant="outline">
                  <Mail className="h-4 w-4 mr-1" />Send by Email
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Audit Setup bar */}
      <div className="bg-white border-b border-slate-200 px-6 py-3">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-slate-500 whitespace-nowrap">Audit Period</label>
            <Input type="date" value={auditPeriodFrom} onChange={e => setAuditPeriodFrom(e.target.value)} className="h-8 text-xs w-36" />
            <span className="text-slate-400 text-xs">to</span>
            <Input type="date" value={auditPeriodTo} onChange={e => setAuditPeriodTo(e.target.value)} className="h-8 text-xs w-36" />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-slate-500 whitespace-nowrap">Currency</label>
            <select value={functionalCurrency} onChange={e => setFunctionalCurrency(e.target.value)}
              className="h-8 text-xs border border-slate-300 rounded-md px-2 bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none">
              {CURRENCY_LIST.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-slate-500 whitespace-nowrap">Clearly Trivial</label>
            <div className="relative">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-slate-400">{sym}</span>
              <Input type="number" step="0.01" min="0" value={clearlyTrivial ?? ''} placeholder="0.00"
                onChange={e => setClearlyTrivial(e.target.value ? parseFloat(e.target.value) : null)}
                className="h-8 text-xs w-28 pl-6" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-slate-500 whitespace-nowrap">Accounting System</label>
            <span className="text-xs font-medium text-slate-700">{selectedClient.software || 'Not set'}</span>
          </div>
        </div>
      </div>

      {/* Expiry warning banner */}
      {jobResult && (() => {
        if (jobResult.status === 'expired') {
          return (
            <div className="bg-red-50 border-b border-red-200 px-6 py-3 flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-red-600" />
              <span className="text-red-800 text-sm font-medium">This extraction has expired. Documents are no longer available.</span>
            </div>
          );
        }
        if (jobResult.expiresAt) {
          const daysLeft = Math.ceil((new Date(jobResult.expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
          if (daysLeft <= 30) {
            return (
              <div className={`${daysLeft <= 10 ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'} border-b px-6 py-3 flex items-center gap-2`}>
                <AlertCircle className={`h-4 w-4 ${daysLeft <= 10 ? 'text-red-600' : 'text-amber-600'}`} />
                <span className={`${daysLeft <= 10 ? 'text-red-800' : 'text-amber-800'} text-sm font-medium`}>
                  Documents expire in {daysLeft} day{daysLeft !== 1 ? 's' : ''}.
                </span>
                <Button size="sm" variant="outline" className="ml-auto" onClick={handleExportZip} disabled={exportingZip}>
                  {exportingZip ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Download className="h-3 w-3 mr-1" />}Export Now
                </Button>
              </div>
            );
          }
        }
        return null;
      })()}

      {/* Main split panel */}
      <div className="flex-1 flex overflow-hidden">

        {/* LEFT PANEL — Unified audit working paper (~75%) */}
        <div className="w-3/4 border-r border-slate-200 bg-white flex flex-col">

          {/* Left panel header / idle state */}
          {leftPanelMode === 'idle' ? (
            <div className="flex-1 flex flex-col">
              <div className="px-6 py-4 border-b border-slate-100">
                <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
                  <Database className="h-5 w-5 text-blue-500" />
                  {selectedClient.software || 'Accounting System'}
                </h2>
                <p className="text-sm text-slate-500 mt-1">Load comparison data from accounting system or upload a file</p>
              </div>
              <div className="p-6 space-y-3 flex-1 overflow-y-auto">
                <input ref={leftSpreadsheetRef} type="file" accept=".xlsx,.csv" className="hidden" onChange={handleUploadSpreadsheet} />
                <Button className="w-full justify-start" variant="outline" onClick={() => leftSpreadsheetRef.current?.click()}>
                  <Upload className="h-4 w-4 mr-2" />Upload Spreadsheet (.xlsx / .csv)
                </Button>
                <Button className="w-full justify-start" variant="outline" onClick={handleXeroButtonClick}
                  disabled={xeroLoading || xeroRequestSending}>
                  {xeroLoading || xeroRequestSending
                    ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />{xeroRequestSending ? 'Sending request...' : 'Connecting...'}</>
                    : <><Link2 className="h-4 w-4 mr-2" />{xeroConnected ? 'Fetch from' : 'Connect to'} {selectedClient.software || 'Accounting System'}</>}
                </Button>
                {xeroConnected && xeroOrgName && (
                  <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded-lg px-3 py-2 -mt-1">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-2 rounded-full bg-green-500" />
                      <span className="text-xs text-green-700 font-medium">{xeroOrgName}</span>
                    </div>
                    <button
                      onClick={handleXeroDisconnect}
                      className="text-xs text-red-500 hover:text-red-700 flex items-center gap-1 transition-colors"
                      title="Disconnect Xero"
                    >
                      <Unlink className="h-3 w-3" />Disconnect
                    </button>
                  </div>
                )}
                {selectedClient.software && selectedClient.contactEmail && !xeroConnected && (
                  <p className="text-xs text-gray-500 -mt-2 ml-1">
                    Access request will be sent to <strong>{selectedClient.contactEmail}</strong>
                  </p>
                )}
                <Button className="w-full justify-start" variant="outline" onClick={handleLoadBlankSpreadsheet}>
                  <Table className="h-4 w-4 mr-2" />Load Blank Spreadsheet (paste data)
                </Button>
                {xeroRequestStatus && xeroRequestStatus.status === 'pending' && (
                  <div className="text-sm text-blue-700 bg-blue-50 border border-blue-200 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <Mail className="h-4 w-4 flex-shrink-0" />
                      <span className="font-medium">Xero access request sent</span>
                    </div>
                    <p className="text-xs text-blue-600 ml-6">
                      An email has been sent to <strong>{xeroRequestStatus.recipientEmail}</strong> asking them to authorise
                      read-only Xero access. The link expires in 7 days.
                    </p>
                    <p className="text-[10px] text-blue-400 ml-6 mt-1">
                      Sent: {new Date(xeroRequestStatus.createdAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </p>
                    <div className="mt-2 ml-6">
                      <Button size="sm" variant="outline" className="text-xs h-7" onClick={async () => {
                        await checkXeroRequestStatus();
                        const statusRes = await fetch(`/api/accounting/xero/status?clientId=${selectedClient.id}`);
                        const statusData = await statusRes.json();
                        if (statusData.connected) {
                          setXeroConnected(true);
                          setXeroOrgName(statusData.orgName);
                          setXeroError('');
                        }
                      }}>
                        <RefreshCw className="h-3 w-3 mr-1" />Check Status
                      </Button>
                    </div>
                  </div>
                )}
                {xeroRequestStatus && xeroRequestStatus.status === 'authorised' && !xeroConnected && (
                  <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg p-3 flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                    <span>Xero access has been authorised. Click &quot;Fetch from Xero&quot; above to fetch transactions.</span>
                  </div>
                )}
                {xeroError && (
                  <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3 flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 flex-shrink-0" />{xeroError}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Toolbar */}
              <div className="px-4 py-2 border-b border-slate-100 flex items-center justify-between gap-2 flex-shrink-0 bg-slate-50">
                <div className="flex items-center gap-3">
                  <span className="text-xs text-slate-500">
                    {leftPanelData.filter(r => Object.values(r).some(v => v && v.trim())).length} rows
                    {leftPanelFileName ? ` — ${leftPanelFileName}` : ''}
                  </span>
                  {!leftPanelFromAccounting && totalPopulationValue == null && (
                    <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => setShowPopulationPrompt(true)}>
                      Set Population Value
                    </Button>
                  )}
                  {totalPopulationValue != null && (
                    <span className="text-xs text-slate-600 bg-white border border-slate-200 rounded px-2 py-0.5">
                      Population: {formatCurrencyVal(totalPopulationValue, sym)}
                      {leftPanelFromAccounting && <span className="text-slate-400 ml-1">(from {selectedClient.software})</span>}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" className="text-xs h-7" onClick={handleMakeSelectionSample}
                    disabled={selectedRows.size === 0}>
                    <MousePointer2 className="h-3 w-3 mr-1" />Make Selection Sample{selectedRows.size > 0 ? ` (${selectedRows.size})` : ''}
                  </Button>
                  <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => setShowSampleDialog(true)}>
                    <Shuffle className="h-3 w-3 mr-1" />Make Sample
                  </Button>
                  {sampledRows.size > 0 && (
                    <Button size="sm" variant="ghost" className="text-xs h-7 text-red-500" onClick={() => setSampledRows(new Set())}>
                      Clear Sample ({sampledRows.size})
                    </Button>
                  )}
                  {jobResult && leftPanelData.length > 0 && (
                    <Button size="sm" variant="outline" className="text-xs h-7" onClick={runAuditMatch}>
                      <RefreshCw className="h-3 w-3 mr-1" />Re-match
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" className="h-7"
                    onClick={() => { setLeftPanelMode('idle'); setLeftPanelData([]); setLeftPanelFileName(null); setLeftPanelFromAccounting(false); setRowMatches(new Map()); setSampledRows(new Set()); setSelectedRows(new Set()); }}>
                    <X className="h-3 w-3 mr-1" />Clear
                  </Button>
                </div>
              </div>

              {/* Unified spreadsheet — contained scroll area */}
              <div className="flex-1 overflow-auto min-h-0">
                <table className="text-[11px] border-collapse" onPaste={handlePaste}>
                  <thead className="sticky top-0 z-20">
                    {/* Row 1: merged group headers */}
                    <tr className="bg-slate-100">
                      <th className="w-7 border-b border-slate-300" rowSpan={2}></th>
                      <th className="w-7 border-b border-slate-300" rowSpan={2}>#</th>
                      <th colSpan={leftPanelColumns.length}
                        className="px-2 py-1.5 text-center font-bold text-slate-700 bg-blue-50 border-b border-slate-300 border-r border-blue-200">
                        From: {leftPanelFileName || selectedClient.software || 'Data'}
                      </th>
                      <th className="w-4 border-b border-slate-300" rowSpan={2}></th>
                      <th colSpan={uploadedDocColumns.length}
                        className="px-2 py-1.5 text-center font-bold text-slate-700 bg-green-50 border-b border-slate-300 border-r border-green-200">
                        Uploaded Documents
                      </th>
                      <th className="w-4 border-b border-slate-300" rowSpan={2}></th>
                      <th colSpan={AUDIT_VERIFY_COLUMNS.length}
                        className="px-2 py-1.5 text-center font-bold text-slate-700 bg-amber-50 border-b border-slate-300">
                        Audit Verification
                      </th>
                    </tr>
                    {/* Row 2: individual column headers */}
                    <tr className="bg-slate-50">
                      {leftPanelColumns.map(col => (
                        <th key={`ac-${col}`} className="px-2 py-1 text-left font-semibold text-slate-600 whitespace-nowrap border-b border-slate-200 border-r border-slate-100">
                          {col}
                        </th>
                      ))}
                      {uploadedDocColumns.map(col => (
                        <th key={`ud-${col}`} className="px-2 py-1 text-left font-semibold text-slate-600 whitespace-nowrap border-b border-slate-200 border-r border-slate-100 bg-green-50/30">
                          {col}
                        </th>
                      ))}
                      {AUDIT_VERIFY_COLUMNS.map(col => (
                        <th key={`av-${col}`} className="px-2 py-1 text-left font-semibold text-slate-600 whitespace-nowrap border-b border-slate-200 border-r border-slate-100 bg-amber-50/30">
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {leftPanelData.map((row, ri) => {
                      const match = rowMatches.get(ri);
                      const isSampled = sampledRows.has(ri);
                      const isSelected = selectedRows.has(ri);
                      const verification = match ? computeVerification(ri) : null;
                      const isUncertain = match?.confidence === 'uncertain';

                      const leftCellBg = isSampled ? 'bg-blue-50' : '';
                      const rowSelectBg = !isSampled && isSelected ? 'bg-slate-100' : '';

                      return (
                        <tr key={ri} className={`border-b border-slate-100 hover:bg-blue-50/20 ${rowSelectBg}`}>
                          {/* Checkbox */}
                          <td className={`px-1 py-0 text-center border-r border-slate-100 ${leftCellBg}`}>
                            <input type="checkbox" checked={isSelected} onChange={() => toggleRowSelect(ri)}
                              className="h-3 w-3 rounded border-slate-300 cursor-pointer" />
                          </td>
                          {/* Row number */}
                          <td className={`px-1 py-0 text-center text-slate-300 text-[10px] border-r border-slate-100 ${leftCellBg}`}>
                            {isSampled && <span className="text-blue-500 font-bold mr-0.5">S</span>}
                            {ri + 1}
                          </td>

                          {/* Accounting columns — editable */}
                          {leftPanelColumns.map((col, ci) => (
                            <td key={`ac-${col}`} className={`px-0 py-0 border-r border-slate-50 ${leftCellBg}`}>
                              <input type="text" value={row[col] || ''} onChange={e => handleCellEdit(ri, col, e.target.value)}
                                data-row={ri} data-col={ci}
                                className={`w-full px-1.5 py-0.5 text-[11px] border-0 focus:bg-white focus:ring-1 focus:ring-blue-300 outline-none ${isSampled ? 'bg-blue-50' : 'bg-transparent'}`} />
                            </td>
                          ))}

                          {/* Spacer */}
                          <td className="bg-slate-100 w-4 border-x border-slate-200"></td>

                          {/* Uploaded Documents columns — read-only */}
                          {uploadedDocColumns.map((col, colIdx) => {
                            const txnMeta = txnMetadata[ri];
                            const hasNoDoc = txnMeta && noDocsTxnIds.has(txnMeta.id);
                            const cellBg = match && isUncertain ? 'bg-orange-50' : hasNoDoc && !match ? 'bg-red-50' : '';
                            return (
                              <td key={`ud-${col}`} className={`px-1.5 py-0.5 whitespace-nowrap border-r border-slate-50 ${cellBg}`}>
                                {match ? renderDocCellValue(match, col)
                                  : hasNoDoc && colIdx === 0 ? <span className="text-[9px] text-red-400 font-medium">No docs</span>
                                  : <span className="text-slate-200">—</span>}
                              </td>
                            );
                          })}

                          {/* Spacer */}
                          <td className="bg-slate-100 w-4 border-x border-slate-200"></td>

                          {/* Audit Verification columns */}
                          {AUDIT_VERIFY_COLUMNS.map(col => {
                            if (!verification) {
                              return <td key={`av-${col}`} className="px-1.5 py-0.5 border-r border-slate-50"><span className="text-slate-200">—</span></td>;
                            }
                            let content: React.ReactNode = '—';
                            let bgColor = '';

                            switch (col) {
                              case 'Amount': {
                                if (verification.amountDiff != null) {
                                  const isZero = Math.abs(verification.amountDiff) < 0.005;
                                  bgColor = isZero ? 'bg-green-100' : 'bg-red-100';
                                  content = formatCurrencyVal(verification.amountDiff, sym);
                                }
                                break;
                              }
                              case 'Date': {
                                if (verification.dateDiffDays != null) {
                                  const isZero = verification.dateDiffDays === 0;
                                  bgColor = isZero ? 'bg-green-100' : 'bg-red-100';
                                  content = `${verification.dateDiffDays} day${Math.abs(verification.dateDiffDays) !== 1 ? 's' : ''}`;
                                }
                                break;
                              }
                              case 'Period': {
                                if (verification.periodResult) {
                                  bgColor = verification.periodResult.inPeriod ? 'bg-green-100' : 'bg-red-100';
                                  content = verification.periodResult.text;
                                }
                                break;
                              }
                              case 'Consistency': {
                                if (verification.consistencyResult) {
                                  bgColor = verification.consistencyResult.consistent ? 'bg-green-100' : 'bg-red-100';
                                  content = verification.consistencyResult.text;
                                }
                                break;
                              }
                            }

                            return (
                              <td key={`av-${col}`} className={`px-1.5 py-0.5 whitespace-nowrap border-r border-slate-50 text-[10px] ${bgColor}`}>
                                {content}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div className="p-3 border-t border-slate-100 flex items-center gap-3">
                  <Button size="sm" variant="outline" onClick={() => addEmptyRows(100)}>
                    <Plus className="h-3 w-3 mr-1" />Add 100 rows
                  </Button>
                  <span className="text-xs text-slate-400">{leftPanelData.length} rows total</span>
                </div>

                {/* Unmatched extracted records */}
                {unmatchedRecords.length > 0 && (
                  <div className="border-t border-slate-200 p-4">
                    <h4 className="text-xs font-semibold text-amber-700 mb-2 flex items-center gap-1">
                      <AlertCircle className="h-3.5 w-3.5" />
                      {unmatchedRecords.length} extracted record{unmatchedRecords.length !== 1 ? 's' : ''} not matched to accounting data
                    </h4>
                    <div className="overflow-x-auto">
                      <table className="text-[10px] border-collapse w-full">
                        <thead className="bg-amber-50">
                          <tr>
                            {['Ref', 'Doc Ref', 'Date', 'Seller', 'Purchaser', 'Net', 'Tax', 'Gross'].map(h => (
                              <th key={h} className="px-2 py-1 text-left font-semibold text-amber-800 whitespace-nowrap border-b border-amber-200">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {unmatchedRecords.map(r => (
                            <tr key={r.id} className="border-b border-amber-100 hover:bg-amber-50/50">
                              <td className="px-2 py-1">
                                <div className="flex items-center gap-1">
                                  {r.fieldLocations && Object.keys(r.fieldLocations).length > 0 && (
                                    <button onClick={() => openDocumentViewer(r, null)} className="text-blue-500 hover:text-blue-700">
                                      <Eye className="h-3 w-3" />
                                    </button>
                                  )}
                                  <span className="text-blue-700 font-mono">{r.referenceId}</span>
                                </div>
                              </td>
                              <td className="px-2 py-1">{r.documentRef || '—'}</td>
                              <td className="px-2 py-1 whitespace-nowrap">{r.documentDate || '—'}</td>
                              <td className="px-2 py-1 max-w-[120px] truncate">{r.sellerName || '—'}</td>
                              <td className="px-2 py-1 max-w-[120px] truncate">{r.purchaserName || '—'}</td>
                              <td className="px-2 py-1 text-right">{formatCurrencyVal(r.netTotal, sym)}</td>
                              <td className="px-2 py-1 text-right">{formatCurrencyVal(r.taxTotal, sym)}</td>
                              <td className="px-2 py-1 text-right font-medium">{formatCurrencyVal(r.grossTotal, sym)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>

              {/* Session tabs — pinned at bottom of left panel */}
              {previousJobs.length > 0 && (
                <div className="flex-shrink-0 border-t border-slate-200 bg-slate-50">
                  <div className="flex items-center overflow-x-auto scrollbar-thin">
                    {previousJobs.map(job => {
                      const isActive = currentJobId === job.id;
                      const isExpired = job.status === 'expired';
                      const dateStr = (job.extractedAt ? new Date(job.extractedAt) : new Date(job.createdAt))
                        .toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
                      return (
                        <button
                          key={job.id}
                          onClick={() => !isActive && !isExpired && loadSession(job.id)}
                          disabled={!!loadingSession || isExpired}
                          className={`flex-shrink-0 px-3 py-1.5 text-[10px] border-r border-slate-200 flex items-center gap-1.5 transition-colors whitespace-nowrap ${
                            isActive
                              ? 'bg-white text-blue-700 font-semibold border-t-2 border-t-blue-500'
                              : isExpired
                                ? 'text-slate-400 bg-slate-100 cursor-not-allowed'
                                : 'text-slate-600 hover:bg-white hover:text-blue-600 border-t-2 border-t-transparent'
                          }`}
                          title={`${job.processedCount} extracted${job.failedCount > 0 ? `, ${job.failedCount} failed` : ''}${isExpired ? ' (expired)' : ''}`}
                        >
                          {loadingSession === job.id
                            ? <Loader2 className="h-2.5 w-2.5 animate-spin" />
                            : <History className="h-2.5 w-2.5" />}
                          <span>{dateStr}</span>
                          <span className="text-[8px] text-slate-400">({job.processedCount})</span>
                          {isExpired && <span className="text-[8px] text-red-400">expired</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* RIGHT PANEL — Compact upload & summary (~25%) */}
        <div className="w-1/4 bg-white flex flex-col overflow-y-auto">

          {/* Audit Summary — only shown after documents are matched and verification is populated */}
          {auditSummary && sampledRows.size > 0 && jobResult && rowMatches.size > 0 && (
            <div className="border-b border-slate-200 p-4 space-y-2">
              <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">Audit Summary</h3>
              <div className="space-y-1 text-xs">
                <div className="flex justify-between"><span className="text-slate-500">Total Population Value:</span><span className="font-medium">{formatCurrencyVal(auditSummary.A, sym)}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Sample Total:</span><span className="font-medium">{formatCurrencyVal(auditSummary.B, sym)}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Sampled Error Total:</span><span className="font-medium">{formatCurrencyVal(auditSummary.C, sym)}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Error %:</span><span className="font-medium">{auditSummary.D.toFixed(2)}%</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Extrapolated Error:</span><span className="font-medium">{formatCurrencyVal(auditSummary.E, sym)}</span></div>
              </div>
              <div className={`text-sm font-bold mt-2 pt-2 border-t border-slate-200 ${auditSummary.conclusion.color}`}>
                Conclusion: {auditSummary.conclusion.text}
              </div>
            </div>
          )}

          {/* Extract from accounting system */}
          {leftPanelFromAccounting && selectedClient.software && txnMetadata.length > 0 && (
            <div className="px-4 pt-4 pb-0 space-y-2">
              {/* Phase 1: Extract sample documents (when sample exists and hasn't been extracted yet) */}
              {sampledRows.size > 0 && !sampleExtracted && (
                <Button
                  className="w-full text-xs h-9 bg-green-600 hover:bg-green-700 ring-2 ring-slate-800 ring-offset-1"
                  disabled={extractingAttachments || uploading || processing}
                  onClick={() => handleExtractXeroAttachments(true)}
                >
                  {extractingAttachments ? (
                    <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      {attachmentProgress ? formatAttachmentProgress(attachmentProgress) : 'Starting...'}</>
                  ) : (
                    <><Database className="mr-1.5 h-3.5 w-3.5" />Extract Sample Documents ({sampledRows.size} rows)</>
                  )}
                </Button>
              )}
              {/* Phase 2: Extract all remaining (or all if no sample) */}
              {(sampleExtracted || sampledRows.size === 0) && (
                <Button
                  className="w-full text-xs h-9 bg-green-600 hover:bg-green-700"
                  disabled={extractingAttachments || uploading || processing}
                  onClick={() => handleExtractXeroAttachments(false)}
                >
                  {extractingAttachments ? (
                    <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      {attachmentProgress ? formatAttachmentProgress(attachmentProgress) : 'Starting...'}</>
                  ) : (
                    <><Database className="mr-1.5 h-3.5 w-3.5" />Extract {sampleExtracted ? 'ALL Remaining' : 'ALL'} Documents from {selectedClient.software}</>
                  )}
                </Button>
              )}
              {sampleExtracted && !extractingAttachments && (
                <p className="text-[10px] text-green-600 text-center font-medium">
                  Sample documents extracted — click above to extract all remaining
                </p>
              )}
              {txnMetadata.length > 0 && (
                <p className="text-[10px] text-slate-500 text-center">
                  {txnMetadata.filter((m, i, a) => a.findIndex(x => x.id === m.id) === i).filter(m => m.hasAttachments).length} of{' '}
                  {txnMetadata.filter((m, i, a) => a.findIndex(x => x.id === m.id) === i).length} transactions have attachments
                  {extractedTxnIds.size > 0 && <span className="text-green-600"> · {extractedTxnIds.size} processed</span>}
                </p>
              )}
            </div>
          )}

          {/* Upload zone */}
          <div className="p-4 space-y-3 flex-1">
            <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5 text-green-500" />Documents
            </h3>

            <div onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-slate-300 rounded-lg p-4 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-all">
              <Upload className="h-5 w-5 text-slate-400 mx-auto mb-1" />
              <p className="text-xs font-medium text-slate-600">Click to select files</p>
              <p className="text-[10px] text-slate-400 mt-0.5">PDF, images, or ZIP files</p>
              <input ref={fileInputRef} type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp,.zip" className="hidden" onChange={handleFileSelect} />
            </div>

            {uploadedFiles.length > 0 && (
              <div className="space-y-1">
                <p className="text-[10px] font-medium text-slate-500">{uploadedFiles.length} file(s):</p>
                <div className="max-h-32 overflow-y-auto space-y-1">
                  {uploadedFiles.map((f, i) => (
                    <div key={i} className="flex items-center justify-between p-1.5 bg-slate-50 rounded text-[10px]">
                      <div className="flex items-center gap-1 truncate">
                        <FileText className="h-3 w-3 text-slate-400 flex-shrink-0" />
                        <span className="text-slate-700 truncate">{f.name}</span>
                      </div>
                      <button onClick={() => removeFile(i)} className="text-slate-400 hover:text-red-500 ml-1 flex-shrink-0">✕</button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {error && (
              <div className="flex items-center gap-1 text-red-700 bg-red-50 border border-red-200 rounded-lg p-2 text-[10px]">
                <AlertCircle className="h-3 w-3 flex-shrink-0" />{error}
              </div>
            )}

            {/* Progress bar */}
            {processing && progress && progress.total > 0 && (
              <div className="space-y-2 bg-slate-50 border border-slate-200 rounded-lg p-3">
                <div className="flex items-center justify-between text-[10px]">
                  <span className="font-medium text-slate-700 flex items-center gap-1">
                    <Loader2 className="h-3 w-3 animate-spin text-blue-500" />Extracting...
                  </span>
                  <span className="text-slate-500 font-mono">{progress.extracted + progress.failed}/{progress.total}</span>
                </div>
                <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden flex">
                  {progress.extracted > 0 && (
                    <div className="h-full bg-green-500 transition-all" style={{ width: `${(progress.extracted / progress.total) * 100}%` }} />
                  )}
                  {progress.failed > 0 && (
                    <div className="h-full bg-red-500 transition-all" style={{ width: `${(progress.failed / progress.total) * 100}%` }} />
                  )}
                </div>
                <div className="flex items-center gap-2 text-[10px] flex-wrap">
                  <span className="text-green-700"><CheckCircle2 className="h-3 w-3 inline mr-0.5" />{progress.extracted}</span>
                  {progress.failed > 0 && <span className="text-red-600"><XCircle className="h-3 w-3 inline mr-0.5" />{progress.failed}</span>}
                  {progress.duplicated > 0 && <span className="text-slate-500">{progress.duplicated} dup</span>}
                </div>
              </div>
            )}

            <div className="flex flex-col gap-2">
              <Button className="w-full bg-blue-600 hover:bg-blue-700 text-xs h-8" disabled={!uploadedFiles.length || uploading || processing} onClick={handleUploadAndProcess}>
                {uploading ? <><Loader2 className="mr-1 h-3 w-3 animate-spin" />Uploading...</>
                  : processing ? <><Loader2 className="mr-1 h-3 w-3 animate-spin" />Processing...</>
                    : <><RefreshCw className="mr-1 h-3 w-3" />Upload & Extract</>}
              </Button>
              {selectedClient.software && (
                <Button className="w-full text-xs h-8" variant="outline" disabled={uploading || processing} onClick={handleXeroButtonClick}>
                  <Database className="mr-1 h-3 w-3" />Extract from {selectedClient.software}
                </Button>
              )}
            </div>

            {/* Extraction details (compact) */}
            {jobResult && (
              <div className="border-t border-slate-100 pt-3 mt-3 space-y-2">
                <details className="text-[10px]">
                  <summary className="text-xs font-semibold text-slate-600 cursor-pointer">Extraction Details</summary>
                  <div className="mt-2 space-y-1 text-slate-500">
                    <p>Extracted by {jobResult.user.name}</p>
                    <p>{jobResult.extractedAt ? new Date(jobResult.extractedAt).toLocaleString('en-GB') : '—'}</p>
                    <p>{jobResult.records.length} records from {jobResult.files.filter(f => f.status === 'extracted').length} files</p>
                    {jobResult.files.filter(f => f.status === 'failed').length > 0 && (
                      <p className="text-red-500">{jobResult.files.filter(f => f.status === 'failed').length} failed</p>
                    )}
                    {jobResult.files.filter(f => f.status === 'duplicate').length > 0 && (
                      <p className="text-slate-400">{jobResult.files.filter(f => f.status === 'duplicate').length} duplicates skipped</p>
                    )}
                  </div>
                </details>
                <details className="text-[10px]">
                  <summary className="text-xs font-semibold text-slate-600 cursor-pointer">Files ({jobResult.files.filter(f => f.status !== 'duplicate').length})</summary>
                  <div className="mt-2 max-h-32 overflow-y-auto space-y-1">
                    {jobResult.files.filter(f => f.status !== 'duplicate').map(file => (
                      <div key={file.id} className="text-slate-600">
                        <div className="flex items-center gap-1">
                          {file.status === 'extracted'
                            ? <CheckCircle2 className="h-3 w-3 text-green-500 flex-shrink-0" />
                            : <XCircle className="h-3 w-3 text-red-500 flex-shrink-0" />}
                          <span className="truncate">{file.originalName}</span>
                        </div>
                        {file.status === 'failed' && file.errorMessage && (
                          <p className="ml-4 text-red-400 text-[9px] truncate" title={file.errorMessage}>{file.errorMessage}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </details>
                {jobResult.files.filter(f => f.status === 'duplicate').length > 0 && (
                  <details className="text-[10px]">
                    <summary className="text-xs font-semibold text-slate-600 cursor-pointer">Duplicates ({jobResult.files.filter(f => f.status === 'duplicate').length})</summary>
                    <div className="mt-2 max-h-24 overflow-y-auto space-y-1">
                      {jobResult.files.filter(f => f.status === 'duplicate').map(file => {
                        const original = jobResult.files.find(o => o.id === file.duplicateOfId);
                        return (
                          <div key={file.id} className="text-slate-400 flex items-center gap-1">
                            <span className="truncate">{file.originalName}</span>
                            {original && <span className="text-[8px] flex-shrink-0">(= {original.originalName})</span>}
                          </div>
                        );
                      })}
                    </div>
                  </details>
                )}
              </div>
            )}

            {loadingJobs && (
              <div className="flex items-center gap-1 text-[10px] text-slate-400 mt-2">
                <Loader2 className="h-2 w-2 animate-spin" />Loading sessions...
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Population value prompt modal */}
      {showPopulationPrompt && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
            <h3 className="font-semibold text-slate-800 mb-3">Total Population Value</h3>
            <p className="text-sm text-slate-500 mb-4">Enter the total value of the population being sampled.</p>
            <div className="relative mb-4">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">{sym}</span>
              <Input type="number" step="0.01" value={populationInput} onChange={e => setPopulationInput(e.target.value)} placeholder="0.00" className="pl-7" />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowPopulationPrompt(false)}>Cancel</Button>
              <Button onClick={() => {
                const val = parseFloat(populationInput);
                if (!isNaN(val)) setTotalPopulationValue(Math.round(val * 100) / 100);
                setShowPopulationPrompt(false);
              }}>Set Value</Button>
            </div>
          </div>
        </div>
      )}

      {/* Sample size dialog */}
      {showSampleDialog && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-xs p-6">
            <h3 className="font-semibold text-slate-800 mb-3">Random Sample Size</h3>
            <p className="text-sm text-slate-500 mb-4">How many rows to randomly select?</p>
            <Input type="number" min="1" value={sampleSizeInput} onChange={e => setSampleSizeInput(e.target.value)} className="mb-4" />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowSampleDialog(false)}>Cancel</Button>
              <Button onClick={() => handleMakeSample(parseInt(sampleSizeInput) || 10)}>Generate Sample</Button>
            </div>
          </div>
        </div>
      )}

      {/* Xero Fetch Modal */}
      {xeroShowModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-slate-800">Fetch from Xero</h3>
                {xeroOrgName && <p className="text-sm text-slate-500">{xeroOrgName}</p>}
              </div>
              <button onClick={() => setXeroShowModal(false)} className="text-slate-400 hover:text-slate-600"><X className="h-5 w-5" /></button>
            </div>
            <div className="p-6 space-y-4 overflow-y-auto flex-1">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium text-slate-700 mb-1 block"><Calendar className="h-3.5 w-3.5 inline mr-1" />Date From</label>
                  <Input type="date" value={xeroDateFrom} onChange={e => setXeroDateFrom(e.target.value)} />
                </div>
                <div>
                  <label className="text-sm font-medium text-slate-700 mb-1 block"><Calendar className="h-3.5 w-3.5 inline mr-1" />Date To</label>
                  <Input type="date" value={xeroDateTo} onChange={e => setXeroDateTo(e.target.value)} />
                </div>
              </div>
              <div>
                <label className="text-sm font-medium text-slate-700 mb-2 block">Transaction Category</label>
                <select value={xeroCategory} onChange={e => handleXeroCategoryChange(e.target.value)}
                  className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                  {XERO_CATEGORIES.map(cat => <option key={cat.value} value={cat.value}>{cat.label}</option>)}
                </select>
                {xeroCategory && (
                  <p className="text-xs text-slate-500 mt-1">
                    Manual journals excluded. {xeroSelectedCodes.size} account code{xeroSelectedCodes.size !== 1 ? 's' : ''} selected.
                  </p>
                )}
              </div>
              <div>
                <label className="text-sm font-medium text-slate-700 mb-2 block">
                  Account Codes {xeroCategory ? '(auto-selected — adjust if needed)' : '(optional)'}
                </label>
                {xeroAccounts.length > 0 ? (
                  <div className="max-h-48 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
                    {xeroAccounts.filter(a => a.Status === 'ACTIVE').map(acc => (
                      <label key={acc.AccountID} className="flex items-center gap-2 px-3 py-2 hover:bg-slate-50 cursor-pointer text-sm">
                        <input type="checkbox" checked={xeroSelectedCodes.has(acc.Code)} onChange={() => toggleXeroCode(acc.Code)} className="rounded border-slate-300" />
                        <span className="font-mono text-slate-600 w-12">{acc.Code}</span>
                        <span className="text-slate-800 truncate">{acc.Name}</span>
                        <span className="text-slate-400 text-xs ml-auto">{acc.Type}</span>
                      </label>
                    ))}
                  </div>
                ) : <p className="text-sm text-slate-400">Loading accounts...</p>}
              </div>
              {xeroError && (
                <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">{xeroError}</div>
              )}
            </div>
            <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setXeroShowModal(false)}>Cancel</Button>
              <Button onClick={handleXeroFetchData}>
                <RefreshCw className="h-4 w-4 mr-2" />Fetch Transactions
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Document Viewer Modal */}
      {viewerOpen && viewerFileId && (
        <DocumentViewer
          fileId={viewerFileId}
          activeField={viewerActiveField}
          fieldLocations={viewerFieldLocations}
          extractedValues={viewerExtractedValues}
          onClose={() => setViewerOpen(false)}
        />
      )}
    </div>
  );
}
