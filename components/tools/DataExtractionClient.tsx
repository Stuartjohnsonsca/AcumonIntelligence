'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Upload, FileText, Loader2, Download, ChevronDown, ChevronRight,
  CheckCircle2, XCircle, AlertCircle, Search, UserPlus, Plus,
  Database, RefreshCw, Mail
} from 'lucide-react';

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

interface ExtractedRecord {
  id: string;
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
}

type ActiveTab = 'document-details' | 'extraction-details' | 'summary-totals';

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
  const [activeTab, setActiveTab] = useState<ActiveTab>('document-details');
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  // Upload state
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [jobResult, setJobResult] = useState<JobResult | null>(null);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [error, setError] = useState('');

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
                  </div>
                  <Button size="sm" variant="outline">Request Access</Button>
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
            <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
              <Database className="h-5 w-5 text-blue-500" />
              {selectedClient.software || 'Accounting System'}
            </h2>
            <p className="text-sm text-slate-500 mt-1">Load comparison data from accounting system or upload a file</p>
          </div>
          <div className="p-6 space-y-3 flex-1 overflow-y-auto">
            <Button className="w-full justify-start" variant="outline">
              <Upload className="h-4 w-4 mr-2" />Upload Spreadsheet (.xlsx / .csv)
            </Button>
            <Button className="w-full justify-start" variant="outline" disabled={!selectedClient.software}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Collate data from {selectedClient.software || 'Accounting System'}
              {!selectedClient.software && <span className="ml-2 text-xs text-slate-400">(not connected)</span>}
            </Button>
            <Button className="w-full justify-start" variant="outline">
              <FileText className="h-4 w-4 mr-2" />Load Blank Spreadsheet (paste data)
            </Button>
          </div>
        </div>

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

            <Button
              className="w-full bg-blue-600 hover:bg-blue-700"
              disabled={!uploadedFiles.length || uploading || processing}
              onClick={handleUploadAndProcess}
            >
              {uploading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Uploading...</>
                : processing ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Processing...</>
                  : <><RefreshCw className="mr-2 h-4 w-4" />Upload & Extract</>}
            </Button>
          </div>
        </div>
      </div>

      {/* Results area — full width below split */}
      {jobResult && (
        <div className="border-t border-slate-200 bg-white flex-shrink-0">
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
              <Button size="sm" variant="outline" onClick={handleExportExcel}>
                <Download className="h-3 w-3 mr-1" />Export Excel
              </Button>
            </div>
          </div>

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
                      const isMatch = !!(record.grossTotal && record.documentDate && record.sellerName);
                      const expanded = expandedRows.has(record.id);
                      return (
                        <>
                          <tr key={record.id} className={`hover:bg-slate-50 ${isMatch ? 'bg-green-50' : ''}`}>
                            <td className="px-3 py-2 font-mono font-medium text-blue-700">{record.referenceId}</td>
                            <td className="px-3 py-2 text-slate-600">{record.documentRef || '—'}</td>
                            <td className="px-3 py-2 whitespace-nowrap">{record.documentDate || '—'}</td>
                            <td className="px-3 py-2 whitespace-nowrap">{record.dueDate || '—'}</td>
                            <td className="px-3 py-2 max-w-[140px] truncate">{record.sellerName || '—'}</td>
                            <td className="px-3 py-2 max-w-[140px] truncate">{record.purchaserName || '—'}</td>
                            <td className="px-3 py-2 text-right whitespace-nowrap">{formatCurrency(record.netTotal)}</td>
                            <td className="px-3 py-2 text-right whitespace-nowrap">{formatCurrency(record.taxTotal)}</td>
                            <td className="px-3 py-2 text-right font-medium whitespace-nowrap">{formatCurrency(record.grossTotal)}</td>
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
    </div>
  );
}
