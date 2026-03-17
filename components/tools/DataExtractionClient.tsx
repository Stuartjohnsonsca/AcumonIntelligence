'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Upload, FileText, Loader2, Download, ChevronDown, ChevronRight,
  CheckCircle2, XCircle, AlertCircle, Search, UserPlus, Plus,
  Database, RefreshCw, Mail, X, Table, Link2, Calendar, Eye,
  History, ArrowLeftRight
} from 'lucide-react';
import { DocumentViewer } from '@/components/tools/DocumentViewer';

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

interface ComparisonResult {
  matchedExtracted: Set<string>;
  matchedLeftRows: Set<number>;
  unmatchedExtracted: string[];
  unmatchedLeftRows: number[];
  totalMatched: number;
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
}

interface ExtractionFile {
  id: string;
  originalName: string;
  status: string;
  errorMessage: string | null;
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

type ActiveTab = 'document-details' | 'extraction-details' | 'summary-totals';
type LeftPanelMode = 'idle' | 'spreadsheet' | 'blank';

interface SpreadsheetRow {
  [key: string]: string;
}

const ACCOUNTING_COLUMNS = [
  'Date', 'Reference', 'Contact', 'Description', 'Account Code',
  'Net', 'Tax', 'Gross',
];

interface XeroAccount {
  AccountID: string;
  Code: string;
  Name: string;
  Type: string;
  Status: string;
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

export function DataExtractionClient({
  userName, firmName, assignedClients, unassignedClients
}: Props) {
  const [clientSearch, setClientSearch] = useState('');
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [showUnassigned, setShowUnassigned] = useState(false);
  const [requestingAccess, setRequestingAccess] = useState<string | null>(null);
  const [requestMessage, setRequestMessage] = useState<{ id: string; text: string; ok: boolean } | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>('document-details');
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

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

  // Comparison state
  const [comparisonResult, setComparisonResult] = useState<ComparisonResult | null>(null);

  // Left panel state
  const [leftPanelMode, setLeftPanelMode] = useState<LeftPanelMode>('idle');
  const [leftPanelData, setLeftPanelData] = useState<SpreadsheetRow[]>([]);
  const [leftPanelColumns, setLeftPanelColumns] = useState<string[]>(ACCOUNTING_COLUMNS);
  const [leftPanelFileName, setLeftPanelFileName] = useState<string | null>(null);
  const leftSpreadsheetRef = useRef<HTMLInputElement>(null);

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

  // Progress tracking
  const [progress, setProgress] = useState<{
    total: number;
    extracted: number;
    failed: number;
    duplicated: number;
    complete: boolean;
  } | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const filteredAssigned = assignedClients.filter(c =>
    c.clientName.toLowerCase().includes(clientSearch.toLowerCase())
  );
  const filteredUnassigned = unassignedClients.filter(c =>
    c.clientName.toLowerCase().includes(clientSearch.toLowerCase())
  );

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
      } catch {
        // Polling failure is non-fatal; next tick will retry
      }
    }, 1500);
  }

  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, []);

  async function handleUploadAndProcess() {
    if (!selectedClient || !uploadedFiles.length) return;
    setUploading(true);
    setError('');
    setProgress(null);
    setJobResult(null);

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
      if (res.ok) {
        const data = await res.json();
        setPreviousJobs(data);
      }
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
        setComparisonResult(null);
      }
    } catch { /* non-fatal */ }
    finally { setLoadingSession(null); }
  }

  useEffect(() => {
    if (selectedClient) {
      loadPreviousJobs(selectedClient.id);
    }
  }, [selectedClient]);

  // ─── Comparison logic ────────────────────────────────────────────

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

  function runComparison() {
    if (!jobResult || leftPanelData.length === 0) return;

    const matchedExtracted = new Set<string>();
    const matchedLeftRows = new Set<number>();

    const grossColName = leftPanelColumns.find(c => c.toLowerCase().includes('gross'));
    const netColName = leftPanelColumns.find(c => c.toLowerCase().includes('net'));
    const dateColName = leftPanelColumns.find(c => c.toLowerCase().includes('date'));
    const refColName = leftPanelColumns.find(c =>
      c.toLowerCase().includes('ref') || c.toLowerCase().includes('reference') || c.toLowerCase().includes('invoice')
    );

    const usedLeftRows = new Set<number>();

    for (const record of jobResult.records) {
      let bestRowIdx = -1;
      let bestScore = 0;

      for (let ri = 0; ri < leftPanelData.length; ri++) {
        if (usedLeftRows.has(ri)) continue;
        const row = leftPanelData[ri];
        let score = 0;

        if (grossColName && record.grossTotal != null) {
          const leftGross = parseNumber(row[grossColName]);
          if (leftGross != null && Math.abs(leftGross - record.grossTotal) < 0.02) score += 3;
        }
        if (netColName && record.netTotal != null) {
          const leftNet = parseNumber(row[netColName]);
          if (leftNet != null && Math.abs(leftNet - record.netTotal) < 0.02) score += 2;
        }
        if (dateColName && record.documentDate) {
          const leftDate = normalizeDate(row[dateColName]);
          const recordDate = normalizeDate(record.documentDate);
          if (leftDate && recordDate && leftDate === recordDate) score += 2;
        }
        if (refColName && record.documentRef) {
          const leftRef = (row[refColName] || '').trim().toLowerCase();
          const docRef = record.documentRef.trim().toLowerCase();
          if (leftRef && docRef && (leftRef.includes(docRef) || docRef.includes(leftRef))) score += 2;
        }

        if (score > bestScore) {
          bestScore = score;
          bestRowIdx = ri;
        }
      }

      if (bestScore >= 3 && bestRowIdx >= 0) {
        matchedExtracted.add(record.id);
        matchedLeftRows.add(bestRowIdx);
        usedLeftRows.add(bestRowIdx);
      }
    }

    const nonEmptyLeftRows = leftPanelData
      .map((row, i) => ({ row, i }))
      .filter(({ row }) => Object.values(row).some(v => v && v.trim()));

    const unmatchedExtracted = jobResult.records
      .filter(r => !matchedExtracted.has(r.id))
      .map(r => r.id);
    const unmatchedLeftRows = nonEmptyLeftRows
      .filter(({ i }) => !matchedLeftRows.has(i))
      .map(({ i }) => i);

    setComparisonResult({
      matchedExtracted,
      matchedLeftRows,
      unmatchedExtracted,
      unmatchedLeftRows,
      totalMatched: matchedExtracted.size,
    });
  }

  // ─── Left panel handlers ────────────────────────────────────────────

  async function handleUploadSpreadsheet(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setLeftPanelFileName(file.name);

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
    if (!category) {
      setXeroSelectedCodes(new Set());
      return;
    }

    const active = xeroAccounts.filter(a => a.Status === 'ACTIVE');
    let filtered: XeroAccount[] = [];

    const isStaffAccount = (acc: XeroAccount) =>
      STAFF_COST_KEYWORDS.some(kw => acc.Name.toLowerCase().includes(kw));

    switch (category) {
      case 'sales':
        filtered = active.filter(a => a.Type === 'REVENUE' || a.Type === 'SALES');
        break;
      case 'direct_costs':
        filtered = active.filter(a =>
          (a.Type === 'DIRECTCOSTS' || a.Type === 'DIRECT COSTS') && !isStaffAccount(a)
        );
        break;
      case 'overheads':
        filtered = active.filter(a =>
          (a.Type === 'OVERHEADS' || a.Type === 'OVERHEAD' || a.Type === 'EXPENSE') && !isStaffAccount(a)
        );
        break;
      case 'stock':
        filtered = active.filter(a =>
          a.Type === 'INVENTORY' || a.Name.toLowerCase().includes('stock') || a.Name.toLowerCase().includes('inventory')
        );
        break;
      case 'fixed_assets':
        filtered = active.filter(a =>
          a.Type === 'FIXED' || a.Type === 'NONCURRENT' ||
          a.Name.toLowerCase().includes('fixed asset') || a.Name.toLowerCase().includes('capital')
        );
        break;
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
        if (accData.accounts) {
          setXeroAccounts(accData.accounts);
        }

        setXeroCategory('');
        setXeroSelectedCodes(new Set());
        setXeroShowModal(true);
      } else {
        window.location.href = `/api/accounting/xero/connect?clientId=${selectedClient.id}`;
      }
    } catch (err) {
      setXeroError(err instanceof Error ? err.message : 'Failed to check Xero connection');
    } finally {
      setXeroLoading(false);
    }
  }

  function toggleXeroCode(code: string) {
    setXeroSelectedCodes(prev => {
      const next = new Set(prev);
      next.has(code) ? next.delete(code) : next.add(code);
      return next;
    });
  }

  async function handleXeroFetchData() {
    if (!selectedClient) return;
    if (!xeroDateFrom || !xeroDateTo) {
      setXeroError('Please select both from and to dates');
      return;
    }

    setXeroLoading(true);
    setXeroError('');

    try {
      const codes = Array.from(xeroSelectedCodes).join(',');
      const params = new URLSearchParams({
        clientId: selectedClient.id,
        type: 'transactions',
        accountCodes: codes,
        dateFrom: xeroDateFrom,
        dateTo: xeroDateTo,
      });
      if (xeroCategory) {
        params.set('excludeManualJournals', 'true');
      }

      const res = await fetch(`/api/accounting/xero/data?${params}`);
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || 'Failed to fetch Xero data');

      const cols = ['Date', 'Reference', 'Contact', 'Type', 'Description', 'Account Code', 'Net', 'Tax', 'Total'];
      const rows: SpreadsheetRow[] = [];

      for (const txn of data.rows) {
        if (txn.lineItems && txn.lineItems.length > 0) {
          for (const li of txn.lineItems) {
            rows.push({
              'Date': txn.date ? new Date(txn.date).toLocaleDateString('en-GB') : '',
              'Reference': txn.reference || '',
              'Contact': txn.contact || '',
              'Type': txn.type || '',
              'Description': li.description || '',
              'Account Code': li.accountCode || '',
              'Net': li.lineAmount != null ? String(li.lineAmount) : '',
              'Tax': li.taxAmount != null ? String(li.taxAmount) : '',
              'Total': li.lineAmount != null && li.taxAmount != null
                ? String(li.lineAmount + li.taxAmount)
                : '',
            });
          }
        } else {
          rows.push({
            'Date': txn.date ? new Date(txn.date).toLocaleDateString('en-GB') : '',
            'Reference': txn.reference || '',
            'Contact': txn.contact || '',
            'Type': txn.type || '',
            'Description': '',
            'Account Code': '',
            'Net': String(txn.subtotal ?? ''),
            'Tax': String(txn.tax ?? ''),
            'Total': String(txn.total ?? ''),
          });
        }
      }

      setLeftPanelColumns(cols);
      setLeftPanelData(rows);
      setLeftPanelFileName(`Xero - ${xeroOrgName || 'Data'}`);
      setLeftPanelMode('spreadsheet');
      setXeroShowModal(false);
    } catch (err) {
      setXeroError(err instanceof Error ? err.message : 'Failed to fetch data from Xero');
    } finally {
      setXeroLoading(false);
    }
  }

  const formatCurrency = (v: number | null) =>
    v != null ? `£${v.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';

  // ─── Client selection screen ────────────────────────────────────────────
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
            <Input
              placeholder="Search clients..."
              value={clientSearch}
              onChange={e => setClientSearch(e.target.value)}
              className="pl-9 h-11"
            />
          </div>

          <div className="space-y-2 mb-6">
            {filteredAssigned.length === 0 && !showUnassigned && (
              <p className="text-slate-400 text-sm text-center py-4">No assigned clients found.</p>
            )}
            {filteredAssigned.map(c => (
              <button
                key={c.id}
                onClick={() => setSelectedClient(c)}
                className="w-full text-left p-4 bg-white border border-slate-200 rounded-xl hover:border-blue-400 hover:bg-blue-50 transition-all group"
              >
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
              <UserPlus className="h-4 w-4 mr-2" />
              {showUnassigned ? 'Hide' : 'Request Access to Another Client'}
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
                      <p className={`text-xs mt-1 ${requestMessage.ok ? 'text-green-600' : 'text-red-600'}`}>
                        {requestMessage.text}
                      </p>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={requestingAccess === c.id}
                    onClick={() => handleRequestAccess(c.id)}
                  >
                    {requestingAccess === c.id ? (
                      <><Loader2 className="h-3 w-3 animate-spin mr-1" />Sending...</>
                    ) : (
                      'Request Access'
                    )}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ─── Main tool screen ───────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Top bar */}
      <div className="bg-white border-b border-slate-200 px-6 py-3 flex-shrink-0">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => { setSelectedClient(null); setJobResult(null); setUploadedFiles([]); setCurrentJobId(null); }}
              className="text-sm text-blue-600 hover:underline">← Back</button>
            <span className="text-slate-300">|</span>
            <div>
              <span className="font-semibold text-slate-800">{selectedClient.clientName}</span>
              <span className="text-slate-400 text-sm ml-2">· {selectedClient.contactName}</span>
            </div>
          </div>
          {jobResult && (
            <div className="flex gap-2">
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
            </div>
          )}
        </div>
      </div>

      {/* Client info strip */}
      <div className="bg-white border-b border-slate-100 px-6 py-2">
        <div className="max-w-7xl mx-auto flex gap-6 text-sm">
          <span><span className="text-slate-400">Client:</span> <span className="font-medium">{selectedClient.clientName}</span></span>
          {selectedClient.contactName && <span><span className="text-slate-400">Contact:</span> <span className="font-medium">{selectedClient.contactName}</span></span>}
          <span><span className="text-slate-400">Accounting System:</span> <span className="font-medium">{selectedClient.software || 'Not set'}</span></span>
        </div>
      </div>

      {/* Split screen */}
      <div className="flex-1 flex overflow-hidden">

        {/* LEFT: Accounting System */}
        <div className="w-1/2 border-r border-slate-200 bg-white flex flex-col">
          <div className="px-6 py-4 border-b border-slate-100">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
                  <Database className="h-5 w-5 text-blue-500" />
                  {selectedClient.software || 'Accounting System'}
                </h2>
                <p className="text-sm text-slate-500 mt-1">
                  {leftPanelMode !== 'idle'
                    ? `${leftPanelData.length} rows loaded${leftPanelFileName ? ` — ${leftPanelFileName}` : ''}`
                    : 'Load comparison data from accounting system or upload a file'}
                </p>
              </div>
              {leftPanelMode !== 'idle' && (
                <Button size="sm" variant="ghost" onClick={() => { setLeftPanelMode('idle'); setLeftPanelData([]); setLeftPanelFileName(null); }}>
                  <X className="h-4 w-4 mr-1" />Clear
                </Button>
              )}
            </div>
          </div>

          {leftPanelMode === 'idle' ? (
            <div className="p-6 space-y-3 flex-1 overflow-y-auto">
              <input
                ref={leftSpreadsheetRef}
                type="file"
                accept=".xlsx,.csv"
                className="hidden"
                onChange={handleUploadSpreadsheet}
              />
              <Button className="w-full justify-start" variant="outline"
                onClick={() => leftSpreadsheetRef.current?.click()}>
                <Upload className="h-4 w-4 mr-2" />Upload Spreadsheet (.xlsx / .csv)
              </Button>
              <Button className="w-full justify-start" variant="outline"
                onClick={handleXeroButtonClick}
                disabled={xeroLoading}>
                {xeroLoading
                  ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Connecting...</>
                  : <><Link2 className="h-4 w-4 mr-2" />
                    Collate data from {selectedClient.software || 'Accounting System'}
                    {!selectedClient.software && <span className="ml-2 text-xs text-slate-400">(will connect)</span>}
                  </>}
              </Button>
              <Button className="w-full justify-start" variant="outline"
                onClick={handleLoadBlankSpreadsheet}>
                <Table className="h-4 w-4 mr-2" />Load Blank Spreadsheet (paste data)
              </Button>

              {xeroError && (
                <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3 flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 flex-shrink-0" />{xeroError}
                </div>
              )}
            </div>
          ) : (
            <div className="flex-1 overflow-auto">
              <table className="w-full text-xs border-collapse" onPaste={handlePaste}>
                <thead className="bg-slate-50 sticky top-0 z-10">
                  <tr>
                    <th className="px-1 py-1.5 text-center text-slate-400 font-normal w-8">#</th>
                    {leftPanelColumns.map(col => (
                      <th key={col} className="px-2 py-1.5 text-left font-semibold text-slate-600 whitespace-nowrap border-b border-slate-200">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {leftPanelData.map((row, ri) => {
                    const isMatched = comparisonResult?.matchedLeftRows.has(ri);
                    const isUnmatched = comparisonResult && !isMatched && Object.values(row).some(v => v && v.trim());
                    const rowBg = isMatched ? 'bg-green-50' : isUnmatched ? 'bg-amber-50' : '';
                    return (
                    <tr key={ri} className={`border-b border-slate-100 hover:bg-blue-50/30 ${rowBg}`}>
                      <td className="px-1 py-0.5 text-center text-slate-300 text-[10px]">
                        {isMatched && <CheckCircle2 className="h-2.5 w-2.5 text-green-500 inline mr-0.5" />}
                        {ri + 1}
                      </td>
                      {leftPanelColumns.map((col, ci) => (
                        <td key={col} className="px-0 py-0">
                          <input
                            type="text"
                            value={row[col] || ''}
                            onChange={e => handleCellEdit(ri, col, e.target.value)}
                            data-row={ri}
                            data-col={ci}
                            className="w-full px-2 py-1 text-xs bg-transparent border-0 focus:bg-white focus:ring-1 focus:ring-blue-300 outline-none"
                          />
                        </td>
                      ))}
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
            </div>
          )}
        </div>

        {/* Xero Fetch Modal */}
        {xeroShowModal && (
          <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col">
              <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-slate-800">Fetch from Xero</h3>
                  {xeroOrgName && <p className="text-sm text-slate-500">{xeroOrgName}</p>}
                </div>
                <button onClick={() => setXeroShowModal(false)} className="text-slate-400 hover:text-slate-600">
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="p-6 space-y-4 overflow-y-auto flex-1">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-sm font-medium text-slate-700 mb-1 block">
                      <Calendar className="h-3.5 w-3.5 inline mr-1" />Date From
                    </label>
                    <Input type="date" value={xeroDateFrom} onChange={e => setXeroDateFrom(e.target.value)} />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-slate-700 mb-1 block">
                      <Calendar className="h-3.5 w-3.5 inline mr-1" />Date To
                    </label>
                    <Input type="date" value={xeroDateTo} onChange={e => setXeroDateTo(e.target.value)} />
                  </div>
                </div>

                <div>
                  <label className="text-sm font-medium text-slate-700 mb-2 block">
                    Transaction Category
                  </label>
                  <select
                    value={xeroCategory}
                    onChange={(e) => handleXeroCategoryChange(e.target.value)}
                    className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                  >
                    {XERO_CATEGORIES.map(cat => (
                      <option key={cat.value} value={cat.value}>{cat.label}</option>
                    ))}
                  </select>
                  {xeroCategory && (
                    <p className="text-xs text-slate-500 mt-1">
                      Manual journals will be excluded. {xeroSelectedCodes.size} account code{xeroSelectedCodes.size !== 1 ? 's' : ''} selected.
                    </p>
                  )}
                </div>

                <div>
                  <label className="text-sm font-medium text-slate-700 mb-2 block">
                    Account Codes {xeroCategory ? '(auto-selected by category — adjust if needed)' : '(optional — leave blank for all)'}
                  </label>
                  {xeroAccounts.length > 0 ? (
                    <div className="max-h-48 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
                      {xeroAccounts.filter(a => a.Status === 'ACTIVE').map(acc => (
                        <label key={acc.AccountID}
                          className="flex items-center gap-2 px-3 py-2 hover:bg-slate-50 cursor-pointer text-sm">
                          <input
                            type="checkbox"
                            checked={xeroSelectedCodes.has(acc.Code)}
                            onChange={() => toggleXeroCode(acc.Code)}
                            className="rounded border-slate-300"
                          />
                          <span className="font-mono text-slate-600 w-12">{acc.Code}</span>
                          <span className="text-slate-800 truncate">{acc.Name}</span>
                          <span className="text-slate-400 text-xs ml-auto">{acc.Type}</span>
                        </label>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-slate-400">Loading accounts...</p>
                  )}
                </div>

                {xeroError && (
                  <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">
                    {xeroError}
                  </div>
                )}
              </div>
              <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-2">
                <Button variant="outline" onClick={() => setXeroShowModal(false)}>Cancel</Button>
                <Button onClick={handleXeroFetchData} disabled={xeroLoading}>
                  {xeroLoading
                    ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Fetching...</>
                    : <><RefreshCw className="h-4 w-4 mr-2" />Fetch Transactions</>}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* RIGHT: Documents */}
        <div className="w-1/2 bg-white flex flex-col">
          <div className="px-6 py-4 border-b border-slate-100">
            <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
              <FileText className="h-5 w-5 text-green-500" />Documents
            </h2>
            <p className="text-sm text-slate-500 mt-1">Upload documents for AI extraction</p>
          </div>
          <div className="p-6 flex-1 overflow-y-auto space-y-4">
            {/* File drop zone */}
            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-slate-300 rounded-xl p-8 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-all"
            >
              <Upload className="h-8 w-8 text-slate-400 mx-auto mb-2" />
              <p className="font-medium text-slate-700">Click to select files</p>
              <p className="text-sm text-slate-400 mt-1">PDF, images, or ZIP files. Multiple files supported.</p>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,.jpg,.jpeg,.png,.webp,.zip"
                className="hidden"
                onChange={handleFileSelect}
              />
            </div>

            {/* File list */}
            {uploadedFiles.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium text-slate-700">{uploadedFiles.length} file(s) selected:</p>
                {uploadedFiles.map((f, i) => (
                  <div key={i} className="flex items-center justify-between p-2 bg-slate-50 rounded-lg text-sm">
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-slate-400" />
                      <span className="text-slate-700 truncate max-w-xs">{f.name}</span>
                      <span className="text-slate-400">{Math.round(f.size / 1024)}KB</span>
                      {f.name.endsWith('.zip') && <Badge variant="secondary" className="text-xs">ZIP</Badge>}
                    </div>
                    <button onClick={() => removeFile(i)} className="text-slate-400 hover:text-red-500 ml-2">✕</button>
                  </div>
                ))}
              </div>
            )}

            {error && (
              <div className="flex items-center gap-2 text-red-700 bg-red-50 border border-red-200 rounded-lg p-3 text-sm">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />{error}
              </div>
            )}

            {/* Progress bar during processing */}
            {processing && progress && progress.total > 0 && (
              <div className="space-y-3 bg-slate-50 border border-slate-200 rounded-xl p-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-slate-700 flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                    Extracting with AI...
                  </span>
                  <span className="text-slate-500 font-mono text-xs">
                    {progress.extracted + progress.failed} / {progress.total} unique files
                  </span>
                </div>

                <div className="w-full h-3 bg-slate-200 rounded-full overflow-hidden flex">
                  {progress.extracted > 0 && (
                    <div
                      className="h-full bg-green-500 transition-all duration-500 ease-out"
                      style={{ width: `${(progress.extracted / progress.total) * 100}%` }}
                    />
                  )}
                  {progress.failed > 0 && (
                    <div
                      className="h-full bg-red-500 transition-all duration-500 ease-out"
                      style={{ width: `${(progress.failed / progress.total) * 100}%` }}
                    />
                  )}
                </div>

                <div className="flex items-center gap-4 text-xs flex-wrap">
                  <span className="flex items-center gap-1 text-green-700">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    {progress.extracted} extracted
                  </span>
                  {progress.failed > 0 && (
                    <span className="flex items-center gap-1 text-red-600">
                      <XCircle className="h-3.5 w-3.5" />
                      {progress.failed} failed
                    </span>
                  )}
                  {progress.duplicated > 0 && (
                    <span className="flex items-center gap-1 text-slate-500">
                      <AlertCircle className="h-3.5 w-3.5" />
                      {progress.duplicated} duplicates skipped
                    </span>
                  )}
                  <span className="text-slate-400 ml-auto">
                    {Math.round(((progress.extracted + progress.failed) / progress.total) * 100)}%
                  </span>
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <Button
                className="flex-1 bg-blue-600 hover:bg-blue-700"
                disabled={!uploadedFiles.length || uploading || processing}
                onClick={handleUploadAndProcess}
              >
                {uploading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Uploading...</>
                  : processing ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Processing...</>
                    : <><RefreshCw className="mr-2 h-4 w-4" />Upload & Extract</>}
              </Button>
              {selectedClient.software && (
                <Button
                  className="flex-1"
                  variant="outline"
                  disabled={uploading || processing}
                  onClick={handleXeroButtonClick}
                >
                  <Database className="mr-2 h-4 w-4" />
                  Extract from {selectedClient.software}
                </Button>
              )}
            </div>

            {/* Previous sessions */}
            {previousJobs.length > 0 && (
              <div className="border-t border-slate-100 pt-4 mt-4">
                <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2 mb-3">
                  <History className="h-4 w-4 text-slate-400" />
                  Previous Sessions
                </h3>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {previousJobs.map(job => {
                    const isActive = currentJobId === job.id;
                    const isExpired = job.status === 'expired';
                    const dateStr = job.extractedAt
                      ? new Date(job.extractedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                      : new Date(job.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
                    return (
                      <button
                        key={job.id}
                        onClick={() => !isActive && loadSession(job.id)}
                        disabled={!!loadingSession}
                        className={`w-full text-left p-3 rounded-lg border text-sm transition-colors ${
                          isActive
                            ? 'border-blue-300 bg-blue-50'
                            : isExpired
                              ? 'border-slate-200 bg-slate-50 opacity-60'
                              : 'border-slate-200 hover:border-blue-300 hover:bg-blue-50/50'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-slate-700">
                            {dateStr}
                          </span>
                          <div className="flex items-center gap-2">
                            {isExpired && <Badge variant="secondary" className="text-[10px]">Expired</Badge>}
                            {isActive && <Badge className="text-[10px] bg-blue-600">Active</Badge>}
                            {loadingSession === job.id && <Loader2 className="h-3 w-3 animate-spin" />}
                          </div>
                        </div>
                        <div className="flex gap-3 mt-1 text-xs text-slate-500">
                          <span>{job.processedCount} extracted</span>
                          {job.failedCount > 0 && <span className="text-red-500">{job.failedCount} failed</span>}
                          <span>{job.totalFiles} files</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {loadingJobs && (
              <div className="flex items-center gap-2 text-sm text-slate-400 mt-2">
                <Loader2 className="h-3 w-3 animate-spin" />Loading sessions...
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Results area — full width below split */}
      {jobResult && (
        <div className="border-t border-slate-200 bg-white flex-shrink-0">
          {/* Expiry warning banner */}
          {(() => {
            if (jobResult.status === 'expired') {
              return (
                <div className="bg-red-50 border-b border-red-200 px-6 py-3 flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-red-600" />
                  <span className="text-red-800 text-sm font-medium">
                    This extraction has expired. Documents are no longer available for download.
                  </span>
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
                      Documents expire in {daysLeft} day{daysLeft !== 1 ? 's' : ''}. Please export your project before expiry.
                    </span>
                    <Button size="sm" variant="outline" className="ml-auto" onClick={handleExportZip} disabled={exportingZip}>
                      {exportingZip ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Download className="h-3 w-3 mr-1" />}
                      Export Now
                    </Button>
                  </div>
                );
              }
            }
            return null;
          })()}
          {/* Tab bar */}
          <div className="flex items-center gap-0 border-b border-slate-200 px-6">
            {([
              ['document-details', 'Document Details'],
              ['extraction-details', 'Extraction Details'],
              ['summary-totals', 'Interpreted Summary Totals'],
            ] as [ActiveTab, string][]).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === key
                    ? 'border-blue-600 text-blue-700'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                {label}
              </button>
            ))}
            <div className="ml-auto flex gap-2 py-2">
              {leftPanelData.length > 0 && (
                <Button size="sm" variant={comparisonResult ? 'default' : 'outline'}
                  onClick={() => comparisonResult ? setComparisonResult(null) : runComparison()}>
                  <ArrowLeftRight className="h-3 w-3 mr-1" />
                  {comparisonResult ? 'Clear Comparison' : 'Compare'}
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={handleExportExcel}>
                <Download className="h-3 w-3 mr-1" />Export Excel
              </Button>
              <Button size="sm" variant="outline" onClick={handleExportZip} disabled={exportingZip}>
                {exportingZip ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Download className="h-3 w-3 mr-1" />}
                Export Project
              </Button>
            </div>
          </div>

          {/* Comparison summary */}
          {comparisonResult && (
            <div className="bg-blue-50 border-b border-blue-200 px-6 py-2 flex items-center gap-4 text-sm">
              <ArrowLeftRight className="h-4 w-4 text-blue-600" />
              <span className="font-medium text-blue-800">Comparison Results:</span>
              <span className="text-green-700">
                <CheckCircle2 className="h-3.5 w-3.5 inline mr-0.5" />
                {comparisonResult.totalMatched} matched
              </span>
              {comparisonResult.unmatchedExtracted.length > 0 && (
                <span className="text-amber-700">
                  <AlertCircle className="h-3.5 w-3.5 inline mr-0.5" />
                  {comparisonResult.unmatchedExtracted.length} extracted not in accounting
                </span>
              )}
              {comparisonResult.unmatchedLeftRows.length > 0 && (
                <span className="text-amber-700">
                  <AlertCircle className="h-3.5 w-3.5 inline mr-0.5" />
                  {comparisonResult.unmatchedLeftRows.length} accounting not matched
                </span>
              )}
            </div>
          )}

          {/* Tab content */}
          <div className="max-h-[50vh] overflow-y-auto">

            {/* Document Details Tab */}
            {activeTab === 'document-details' && (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 sticky top-0 border-b border-slate-200">
                    <tr>
                      {['Ref', 'Doc Ref', 'Date', 'Due Date', 'Seller', 'Purchaser', 'Net', 'Tax', 'Gross', 'Category', 'Lines'].map(h => (
                        <th key={h} className="px-3 py-2 text-left font-semibold text-slate-600 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {jobResult.records.map(record => {
                      const isCompared = !!comparisonResult;
                      const isMatchedToLeft = comparisonResult?.matchedExtracted.has(record.id);
                      const isComplete = !!(record.grossTotal && record.documentDate && record.sellerName);
                      const rowHighlight = isCompared
                        ? (isMatchedToLeft ? 'bg-green-50' : 'bg-amber-50')
                        : (isComplete ? 'bg-green-50' : '');
                      const expanded = expandedRows.has(record.id);
                      const hasLocations = record.fieldLocations && Object.keys(record.fieldLocations).length > 0;
                      const fieldCell = (value: string | number | null, fieldName: string, format?: (v: number | null) => string) => {
                        const display = format && typeof value === 'number' ? format(value) : (value || '—');
                        return hasLocations ? (
                          <button
                            onClick={() => openDocumentViewer(record, fieldName)}
                            className="text-blue-600 hover:text-blue-800 hover:underline cursor-pointer text-left"
                            title="View in document"
                          >
                            {display}
                          </button>
                        ) : (
                          <span>{display}</span>
                        );
                      };
                      return (
                        <>
                          <tr key={record.id} className={`hover:bg-slate-50 ${rowHighlight}`}>
                            <td className="px-3 py-2 font-mono font-medium">
                              <div className="flex items-center gap-1">
                                {isCompared && (
                                  isMatchedToLeft
                                    ? <span title="Matched to accounting data"><CheckCircle2 className="h-3 w-3 text-green-500" /></span>
                                    : <span title="No match found"><AlertCircle className="h-3 w-3 text-amber-500" /></span>
                                )}
                                {hasLocations && (
                                  <button onClick={() => openDocumentViewer(record, null)}
                                    className="text-blue-500 hover:text-blue-700" title="View document">
                                    <Eye className="h-3 w-3" />
                                  </button>
                                )}
                                <span className="text-blue-700">{record.referenceId}</span>
                              </div>
                            </td>
                            <td className="px-3 py-2">{fieldCell(record.documentRef, 'documentRef')}</td>
                            <td className="px-3 py-2 whitespace-nowrap">{fieldCell(record.documentDate, 'documentDate')}</td>
                            <td className="px-3 py-2 whitespace-nowrap">{fieldCell(record.dueDate, 'dueDate')}</td>
                            <td className="px-3 py-2 max-w-[140px] truncate">{fieldCell(record.sellerName, 'sellerName')}</td>
                            <td className="px-3 py-2 max-w-[140px] truncate">{fieldCell(record.purchaserName, 'purchaserName')}</td>
                            <td className="px-3 py-2 text-right whitespace-nowrap">{fieldCell(record.netTotal, 'netTotal', formatCurrency)}</td>
                            <td className="px-3 py-2 text-right whitespace-nowrap">{fieldCell(record.taxTotal, 'taxTotal', formatCurrency)}</td>
                            <td className="px-3 py-2 text-right font-medium whitespace-nowrap">{fieldCell(record.grossTotal, 'grossTotal', formatCurrency)}</td>
                            <td className="px-3 py-2">
                              <span className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded text-xs">
                                {record.accountCategory || '—'}
                              </span>
                            </td>
                            <td className="px-3 py-2">
                              {record.lineItems?.length > 0 && (
                                <button onClick={() => toggleRowExpand(record.id)}
                                  className="text-blue-600 hover:text-blue-800 flex items-center gap-1">
                                  {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                                  {record.lineItems.length}
                                </button>
                              )}
                            </td>
                          </tr>
                          {expanded && record.lineItems?.map((item, i) => (
                            <tr key={`${record.id}-line-${i}`} className="bg-blue-50/40">
                              <td className="px-3 py-1.5 pl-8 text-slate-400" colSpan={2}>↳ Line {i + 1}</td>
                              <td className="px-3 py-1.5 text-slate-500" colSpan={3}>{item.description}</td>
                              <td className="px-3 py-1.5 text-slate-500">Qty: {item.quantity ?? '—'}</td>
                              <td className="px-3 py-1.5 text-right">{formatCurrency(item.net)}</td>
                              <td className="px-3 py-1.5 text-right">{formatCurrency(item.tax)}</td>
                              <td className="px-3 py-1.5 text-right">{formatCurrency(item.net && item.tax ? item.net + item.tax : null)}</td>
                              <td colSpan={2} className="px-3 py-1.5 text-slate-400 text-xs">{item.productId}</td>
                            </tr>
                          ))}
                        </>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Extraction Details Tab */}
            {activeTab === 'extraction-details' && (
              <div className="p-6 space-y-6 max-w-4xl">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  {[
                    ['User Name', jobResult.user.name],
                    ['Date & Time', jobResult.extractedAt ? new Date(jobResult.extractedAt).toLocaleString('en-GB') : '—'],
                    ['Client Name', jobResult.client.clientName],
                    ['Accounting System', jobResult.client.software || 'N/A'],
                  ].map(([k, v]) => (
                    <div key={k} className="flex gap-2">
                      <span className="font-medium text-slate-600 w-40 flex-shrink-0">{k}:</span>
                      <span className="text-slate-800">{v}</span>
                    </div>
                  ))}
                </div>

                {(() => {
                  const extractedFiles = jobResult.files.filter(f => f.status === 'extracted');
                  const failedFiles = jobResult.files.filter(f => f.status === 'failed');
                  const duplicateFiles = jobResult.files.filter(f => f.status === 'duplicate');
                  const uniqueFiles = jobResult.files.filter(f => f.status !== 'duplicate');
                  return (
                    <>
                      <div className="bg-slate-50 rounded-lg p-4 text-sm text-slate-600 leading-relaxed border border-slate-200">
                        <p className="font-medium text-slate-800 mb-2">Extraction Summary</p>
                        <p>
                          This extraction was performed by <strong>{jobResult.user.name}</strong> on{' '}
                          <strong>{jobResult.extractedAt ? new Date(jobResult.extractedAt).toLocaleString('en-GB') : 'N/A'}</strong> for
                          client <strong>{jobResult.client.clientName}</strong>. A total of <strong>{jobResult.files.length}</strong> document(s)
                          were submitted. Of these, <strong>{duplicateFiles.length}</strong> were identified as duplicates and skipped.
                          Of the <strong>{uniqueFiles.length}</strong> unique files, <strong>{extractedFiles.length}</strong> were
                          successfully extracted and <strong>{failedFiles.length}</strong> failed.
                          The extraction used the Acumon Intelligence AI engine to identify financial data
                          including supplier details, document references, dates, and monetary totals. All data has been stored securely.
                          This process was conducted for the purpose of audit and assurance work and results should be reviewed by a qualified
                          professional before reliance.
                        </p>
                      </div>

                      <div>
                        <p className="font-medium text-slate-800 mb-3">Files Processed ({uniqueFiles.length} unique)</p>
                        <div className="divide-y border rounded-lg">
                          {uniqueFiles.map(file => (
                            <div key={file.id} className="px-4 py-2.5 text-sm">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  {file.status === 'extracted'
                                    ? <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
                                    : <XCircle className="h-4 w-4 text-red-500 flex-shrink-0" />}
                                  <span className="text-slate-700">{file.originalName}</span>
                                </div>
                                <Badge variant={file.status === 'extracted' ? 'default' : 'secondary'}
                                  className={file.status === 'extracted' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}>
                                  {file.status === 'extracted' ? 'Extracted' : 'Failed'}
                                </Badge>
                              </div>
                              {file.status === 'failed' && file.errorMessage && (
                                <div className="mt-1.5 ml-6 text-xs text-red-600 bg-red-50 border border-red-100 rounded px-2.5 py-1.5 font-mono break-all">
                                  {file.errorMessage}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>

                      {duplicateFiles.length > 0 && (
                        <div>
                          <p className="font-medium text-slate-800 mb-3">Duplicates Skipped ({duplicateFiles.length})</p>
                          <div className="divide-y border border-slate-200 rounded-lg bg-slate-50">
                            {duplicateFiles.map(file => (
                              <div key={file.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                                <div className="flex items-center gap-2">
                                  <AlertCircle className="h-4 w-4 text-slate-400 flex-shrink-0" />
                                  <span className="text-slate-500">{file.originalName}</span>
                                </div>
                                <Badge variant="secondary" className="bg-slate-200 text-slate-600">Duplicate</Badge>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            )}

            {/* Summary Totals Tab */}
            {activeTab === 'summary-totals' && (
              <div className="p-6 space-y-6 max-w-4xl">
                {/* Category summary */}
                {(() => {
                  const cats: Record<string, { count: number; net: number; tax: number; gross: number }> = {};
                  for (const r of jobResult.records) {
                    const cat = r.accountCategory || 'Uncategorised';
                    if (!cats[cat]) cats[cat] = { count: 0, net: 0, tax: 0, gross: 0 };
                    cats[cat].count += 1;
                    cats[cat].net += r.netTotal || 0;
                    cats[cat].tax += r.taxTotal || 0;
                    cats[cat].gross += r.grossTotal || 0;
                  }
                  return (
                    <>
                      <div>
                        <p className="font-semibold text-slate-800 mb-3">Summary by Account Category</p>
                        <table className="w-full text-sm border rounded-lg overflow-hidden">
                          <thead className="bg-slate-800 text-white">
                            <tr>
                              {['Account Category', 'Documents', 'Net Total', 'Tax Total', 'Gross Total'].map(h => (
                                <th key={h} className="px-4 py-2 text-left font-medium">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {Object.entries(cats).map(([cat, t]) => (
                              <tr key={cat} className="hover:bg-slate-50">
                                <td className="px-4 py-2 font-medium">{cat}</td>
                                <td className="px-4 py-2">{t.count}</td>
                                <td className="px-4 py-2 text-right">{formatCurrency(t.net)}</td>
                                <td className="px-4 py-2 text-right">{formatCurrency(t.tax)}</td>
                                <td className="px-4 py-2 text-right font-medium">{formatCurrency(t.gross)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <p className="text-xs text-slate-400 italic">
                        Context Interpreted by Acumon Intelligence (an AI engine) and subject to the terms and conditions on www.acumonintelligence.com
                      </p>
                    </>
                  );
                })()}
              </div>
            )}
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
