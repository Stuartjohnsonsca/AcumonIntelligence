'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import {
  Upload, FileText, Loader2, Download, ChevronLeft, ChevronRight,
  Mail, CheckCircle2, XCircle, AlertCircle, Search, BookOpen
} from 'lucide-react';
import { useBackgroundTasks } from '@/components/BackgroundTaskProvider';

// ─── Interfaces ──────────────────────────────────────────────────────────────

interface Client {
  id: string;
  clientName: string;
  software: string | null;
  contactName: string | null;
  contactEmail: string | null;
}

interface Finding {
  id: string;
  fileId: string;
  area: string;
  finding: string;
  clauseReference: string | null;
  isSignificantRisk: boolean;
  aiSignificantRisk: boolean;
}

interface FileProgress {
  batchesDone: number;
  batchesTotal: number;
  pagesDone: number;
  pagesTotal: number;
  message?: string;
}

interface DocFile {
  id: string;
  originalName: string;
  status: 'uploading' | 'uploaded' | 'processing' | 'analysed' | 'failed';
  errorMessage: string | null;
  progress?: FileProgress | null;
}

interface StatusResponse {
  jobId: string;
  files: DocFile[];
  findings: Finding[];  // API returns flat array, client groups by fileId
  status: string;
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

// ─── Component ───────────────────────────────────────────────────────────────

export function DocSummaryClient({
  userName, firmName, assignedClients, unassignedClients,
}: Props) {
  const { addTask, updateTask } = useBackgroundTasks();

  // Client selector state
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [clientSearch, setClientSearch] = useState('');
  const [showUnassigned, setShowUnassigned] = useState(false);

  // Job state
  const [jobId, setJobId] = useState<string | null>(null);
  const [files, setFiles] = useState<DocFile[]>([]);
  const [hiddenFileIds, setHiddenFileIds] = useState<Set<string>>(new Set());
  const [findings, setFindings] = useState<Record<string, Finding[]>>({});
  const [activeDocIndex, setActiveDocIndex] = useState(0);

  // Upload / processing state
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState('');
  const bgTaskIdRef = useRef<string | null>(null);

  // Email modal state
  const [emailModalOpen, setEmailModalOpen] = useState(false);
  const [emailRecipientName, setEmailRecipientName] = useState('');
  const [emailAddress, setEmailAddress] = useState('');
  const [emailSending, setEmailSending] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  // Drag state
  const [isDragging, setIsDragging] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ─── Derived ─────────────────────────────────────────────────────────────

  const visibleFiles = files.filter(f => !hiddenFileIds.has(f.id));
  const activeFile = visibleFiles[activeDocIndex] ?? null;
  const activeFindings = activeFile ? (findings[activeFile.id] ?? []) : [];
  const hasAnalysedDocs = files.some(f => f.status === 'analysed');

  const filteredAssigned = assignedClients.filter(c =>
    c.clientName.toLowerCase().includes(clientSearch.toLowerCase())
  );
  const filteredUnassigned = unassignedClients.filter(c =>
    c.clientName.toLowerCase().includes(clientSearch.toLowerCase())
  );

  // ─── Polling ─────────────────────────────────────────────────────────────

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  const startPolling = useCallback((jId: string) => {
    stopPolling();
    setIsProcessing(true);

    pollingRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/doc-summary/status?jobId=${encodeURIComponent(jId)}`);
        if (!res.ok) return;
        const data: StatusResponse = await res.json();

        const safeFiles = Array.isArray(data.files) ? data.files.map(f => ({
          ...f,
          errorMessage: f.errorMessage ?? null,
          status: (['uploading', 'uploaded', 'processing', 'analysed', 'failed'].includes(f.status)
            ? f.status : 'uploaded') as DocFile['status'],
        })) : [];

        if (safeFiles.length > 0) setFiles(safeFiles);

        // Group findings by fileId (API returns flat array)
        const rawFindings = data.findings;
        if (Array.isArray(rawFindings)) {
          const grouped: Record<string, Finding[]> = {};
          for (const f of rawFindings) {
            if (!grouped[f.fileId]) grouped[f.fileId] = [];
            grouped[f.fileId].push(f);
          }
          setFindings(grouped);
        } else if (rawFindings && typeof rawFindings === 'object') {
          setFindings(rawFindings as Record<string, Finding[]>);
        }

        const allDone = safeFiles.length > 0 && safeFiles.every(f => f.status === 'analysed' || f.status === 'failed');
        if (allDone) {
          stopPolling();
          setIsProcessing(false);
          // Update background task dot
          if (bgTaskIdRef.current) {
            const hasFailed = data.files.some(f => f.status === 'failed');
            updateTask(bgTaskIdRef.current, {
              status: hasFailed ? 'error' : 'completed',
              error: hasFailed ? 'Some files failed analysis' : undefined,
            });
            bgTaskIdRef.current = null;
          }
        }
      } catch {
        // Silently retry on next interval
      }
    }, 2500);
  }, [stopPolling, updateTask]);

  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  // ─── Remove file handler ────────────────────────────────────────────────
  const handleRemoveFile = useCallback(async (fileId: string, fileStatus: string) => {
    if (fileStatus === 'analysed' || fileStatus === 'failed') {
      // Already processed — just hide from view, keep findings/data intact
      setHiddenFileIds(prev => new Set(prev).add(fileId));
      // Adjust active index if needed
      const visibleAfter = files.filter(f => !hiddenFileIds.has(f.id) && f.id !== fileId);
      if (activeDocIndex >= visibleAfter.length) {
        setActiveDocIndex(Math.max(0, visibleAfter.length - 1));
      }
    } else {
      // Not yet analysed — actually delete from DB and blob
      try {
        await fetch('/api/doc-summary/remove-file', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileId }),
        });
        setFiles(prev => prev.filter(f => f.id !== fileId));
        setActiveDocIndex(prev => Math.max(0, prev - 1));
      } catch {
        // Silent fail — file will remain in list
      }
    }
  }, [files, hiddenFileIds, activeDocIndex]);

  // ─── Upload flow ─────────────────────────────────────────────────────────

  /** Upload a single file to Azure Blob via SAS URL with progress tracking */
  const uploadFileViaSas = useCallback(
    (file: File, sasUrl: string): Promise<void> =>
      new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', sasUrl, true);
        xhr.setRequestHeader('x-ms-blob-type', 'BlockBlob');
        xhr.setRequestHeader('Content-Type', file.type || 'application/pdf');

        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            const pct = Math.round((e.loaded / e.total) * 100);
            setUploadProgress(prev => ({ ...prev, [file.name]: pct }));
          }
        });

        xhr.addEventListener('load', () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
          } else {
            reject(new Error(`Azure upload failed (${xhr.status}): ${xhr.responseText?.substring(0, 200)}`));
          }
        });

        xhr.addEventListener('error', () => reject(new Error('Network error during upload')));
        xhr.addEventListener('abort', () => reject(new Error('Upload aborted')));
        xhr.send(file);
      }),
    [],
  );

  const handleUpload = useCallback(async (fileList: FileList | File[]) => {
    if (!selectedClient) {
      setError('Please select a client first.');
      return;
    }

    let fileArr = Array.from(fileList);
    if (fileArr.length === 0) return;

    // Enforce 50 MB per-file size limit
    const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
    for (const file of fileArr) {
      if (file.size > MAX_FILE_SIZE) {
        setError(`"${file.name}" exceeds the 50 MB file size limit.`);
        return;
      }
    }

    // Check for duplicate file names against already-uploaded files
    const filesToUpload: File[] = [];
    for (const file of fileArr) {
      const existing = files.find(f => f.originalName === file.name);
      if (existing) {
        const replace = window.confirm(`File "${file.name}" already exists. Replace existing?`);
        if (replace) {
          await handleRemoveFile(existing.id, existing.status);
          filesToUpload.push(file);
        }
        // If not replacing, skip this file
      } else {
        filesToUpload.push(file);
      }
    }
    fileArr = filesToUpload;
    if (fileArr.length === 0) return;

    setError('');
    setIsUploading(true);
    setUploadProgress({});

    let currentJobId = jobId;
    const uploadedFiles: DocFile[] = [];

    try {
      for (const file of fileArr) {
        // 1. Get SAS URL from the server
        const urlRes = await fetch('/api/doc-summary/upload-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientId: selectedClient.id,
            fileName: file.name,
            fileSize: file.size,
            jobId: currentJobId ?? undefined,
          }),
        });

        if (!urlRes.ok) {
          const body = await urlRes.json().catch(() => null);
          throw new Error(body?.error || `Failed to get upload URL for "${file.name}"`);
        }

        const { sasUrl, fileId, jobId: returnedJobId } = await urlRes.json();

        // Keep jobId consistent across files
        if (!currentJobId) currentJobId = returnedJobId;

        // 2. Upload directly to Azure Blob via SAS URL
        await uploadFileViaSas(file, sasUrl);

        // 3. Notify server that upload is complete
        const completeRes = await fetch('/api/doc-summary/upload-complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileId, jobId: returnedJobId }),
        });

        if (!completeRes.ok) {
          const body = await completeRes.json().catch(() => null);
          throw new Error(body?.error || `Failed to register upload for "${file.name}"`);
        }

        uploadedFiles.push({ id: fileId, originalName: file.name, status: 'uploaded', errorMessage: null });
      }

      setJobId(currentJobId);
      setFiles(prev => [...prev, ...uploadedFiles]);

      // Register background task for status dots
      const taskId = `doc-summary-${currentJobId}`;
      addTask({
        id: taskId,
        clientName: selectedClient.clientName,
        activity: 'Document Summary',
        status: 'running',
        toolPath: '/tools/doc-summary',
      });

      // Trigger analysis
      const analyseRes = await fetch('/api/doc-summary/analyse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: currentJobId }),
      });

      if (!analyseRes.ok) {
        const body = await analyseRes.json().catch(() => null);
        updateTask(taskId, { status: 'error', error: body?.error || 'Analysis failed' });
        throw new Error(body?.error || 'Analysis failed to start');
      }

      // Store taskId for polling updates
      bgTaskIdRef.current = taskId;
      startPolling(currentJobId!);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[DocSummary] Upload error:', msg);
      setError(msg || 'Upload failed');
    } finally {
      setIsUploading(false);
      setUploadProgress({});
    }
  }, [selectedClient, jobId, files, startPolling, addTask, updateTask, handleRemoveFile, uploadFileViaSas]);

  // ─── Risk toggle ─────────────────────────────────────────────────────────

  const toggleRisk = useCallback(async (findingId: string, currentValue: boolean) => {
    // Optimistic update
    setFindings(prev => {
      const updated = { ...prev };
      for (const fileId of Object.keys(updated)) {
        updated[fileId] = updated[fileId].map(f =>
          f.id === findingId ? { ...f, isSignificantRisk: !currentValue } : f
        );
      }
      return updated;
    });

    try {
      await fetch('/api/doc-summary/update-finding', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ findingId, isSignificantRisk: !currentValue }),
      });
    } catch {
      // Revert on failure
      setFindings(prev => {
        const updated = { ...prev };
        for (const fileId of Object.keys(updated)) {
          updated[fileId] = updated[fileId].map(f =>
            f.id === findingId ? { ...f, isSignificantRisk: currentValue } : f
          );
        }
        return updated;
      });
    }
  }, []);

  // ─── Export actions ──────────────────────────────────────────────────────

  const downloadPdf = useCallback(async (fileId?: string) => {
    if (!jobId) return;
    try {
      let url = `/api/doc-summary/export-pdf?jobId=${encodeURIComponent(jobId)}`;
      if (fileId) url += `&fileId=${encodeURIComponent(fileId)}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `doc-summary-${jobId}${fileId ? `-${fileId}` : ''}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(blobUrl);
    } catch {
      setError('Failed to download PDF');
    }
  }, [jobId]);

  const downloadPortfolio = useCallback(async () => {
    if (!jobId) return;
    try {
      const url = `/api/doc-summary/export-portfolio?jobId=${encodeURIComponent(jobId)}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `portfolio-report-${jobId}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(blobUrl);
    } catch {
      setError('Failed to download portfolio report');
    }
  }, [jobId]);

  const [emailError, setEmailError] = useState('');

  const sendEmail = useCallback(async () => {
    if (!jobId || !emailAddress) return;
    setEmailSending(true);
    setEmailError('');
    try {
      const res = await fetch('/api/doc-summary/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, recipientEmail: emailAddress, recipientName: emailRecipientName }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || 'Send failed');
      }
      setEmailSent(true);
      setTimeout(() => {
        setEmailModalOpen(false);
        setEmailSent(false);
        setEmailAddress('');
        setEmailRecipientName('');
        setEmailError('');
      }, 2000);
    } catch (err) {
      setEmailError(err instanceof Error ? err.message : 'Failed to send email');
    } finally {
      setEmailSending(false);
    }
  }, [jobId, emailAddress, emailRecipientName]);

  // ─── Drag & drop handlers ───────────────────────────────────────────────

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0) {
      handleUpload(e.dataTransfer.files);
    }
  }, [handleUpload]);

  // ─── File status helpers ─────────────────────────────────────────────────

  function fileStatusBg(status: string): string {
    switch (status) {
      case 'uploaded': return 'bg-slate-100';
      case 'processing': return 'bg-orange-100';
      case 'analysed': return 'bg-green-100';
      case 'failed': return 'bg-red-100';
      default: return 'bg-slate-50';
    }
  }

  function fileStatusIcon(status: string) {
    switch (status) {
      case 'analysed':
        return <CheckCircle2 className="h-3.5 w-3.5 text-green-600 flex-shrink-0" />;
      case 'failed':
        return <XCircle className="h-3.5 w-3.5 text-red-600 flex-shrink-0" />;
      case 'processing':
        return <Loader2 className="h-3.5 w-3.5 text-orange-600 animate-spin flex-shrink-0" />;
      default:
        return <FileText className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />;
    }
  }

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-4">
        <div className="max-w-[1600px] mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Document Summary</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              {firmName} &middot; {userName}
            </p>
          </div>
          {selectedClient && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-600 font-medium">{selectedClient.clientName}</span>
              <button
                onClick={() => {
                  setSelectedClient(null);
                  setJobId(null);
                  setFiles([]);
                  setFindings({});
                  setActiveDocIndex(0);
                  stopPolling();
                  setIsProcessing(false);
                  setError('');
                }}
                className="text-xs text-slate-400 hover:text-slate-600 underline"
              >
                Change
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="max-w-[1600px] mx-auto px-6 pt-3">
          <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-4 py-2.5 text-sm text-red-700">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            <span>{error}</span>
            <button onClick={() => setError('')} className="ml-auto text-red-400 hover:text-red-600 font-medium">
              Dismiss
            </button>
          </div>
        </div>
      )}

      <div className="max-w-[1600px] mx-auto px-6 py-6">
        {/* Client selector (shown when no client selected) */}
        {!selectedClient ? (
          <div className="max-w-lg mx-auto">
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100">
                <h2 className="text-base font-semibold text-slate-900">Select Client</h2>
                <p className="text-sm text-slate-500 mt-0.5">Choose a client to start analysing documents</p>
              </div>

              {/* Search */}
              <div className="px-5 py-3 border-b border-slate-100">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Search clients..."
                    value={clientSearch}
                    onChange={e => setClientSearch(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              </div>

              {/* Assigned clients */}
              <div className="max-h-72 overflow-y-auto">
                {filteredAssigned.length === 0 && !showUnassigned && (
                  <div className="px-5 py-8 text-center text-sm text-slate-400">
                    No clients found
                  </div>
                )}
                {filteredAssigned.map(client => (
                  <button
                    key={client.id}
                    onClick={() => {
                      setSelectedClient(client);
                      setClientSearch('');
                    }}
                    className="w-full text-left px-5 py-3 hover:bg-slate-50 border-b border-slate-50 transition-colors"
                  >
                    <div className="text-sm font-medium text-slate-800">{client.clientName}</div>
                    {client.contactName && (
                      <div className="text-xs text-slate-400 mt-0.5">{client.contactName}</div>
                    )}
                  </button>
                ))}
              </div>

              {/* Show unassigned toggle */}
              {unassignedClients.length > 0 && (
                <div className="border-t border-slate-200">
                  <button
                    onClick={() => setShowUnassigned(!showUnassigned)}
                    className="w-full text-left px-5 py-2.5 text-xs text-slate-500 hover:bg-slate-50 transition-colors"
                  >
                    {showUnassigned ? 'Hide' : 'Show'} unassigned clients ({unassignedClients.length})
                  </button>
                  {showUnassigned && (
                    <div className="max-h-48 overflow-y-auto border-t border-slate-100">
                      {filteredUnassigned.map(client => (
                        <button
                          key={client.id}
                          onClick={() => {
                            setSelectedClient(client);
                            setClientSearch('');
                            setShowUnassigned(false);
                          }}
                          className="w-full text-left px-5 py-3 hover:bg-slate-50 border-b border-slate-50 transition-colors"
                        >
                          <div className="text-sm font-medium text-slate-600">{client.clientName}</div>
                          {client.contactName && (
                            <div className="text-xs text-slate-400 mt-0.5">{client.contactName}</div>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ) : (
          /* Main workspace (client selected) */
          <div className="flex gap-6 items-start">
            {/* ─── Left panel: Upload + File list ─────────────────────────── */}
            <div className="w-72 flex-shrink-0 space-y-4">
              {/* Upload zone */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-100">
                  <h3 className="text-sm font-semibold text-slate-800">Upload Documents</h3>
                </div>

                <div
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  className={`mx-4 my-3 border-2 border-dashed rounded-lg p-5 text-center transition-colors cursor-pointer ${
                    isDragging
                      ? 'border-blue-400 bg-blue-50'
                      : 'border-slate-200 hover:border-slate-300 bg-slate-50'
                  }`}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="h-6 w-6 mx-auto text-slate-400 mb-2" />
                  <p className="text-xs text-slate-500">
                    Drag files here or <span className="text-blue-600 font-medium">browse</span>
                  </p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.csv"
                    className="hidden"
                    onChange={e => {
                      if (e.target.files && e.target.files.length > 0) {
                        handleUpload(e.target.files);
                        e.target.value = '';
                      }
                    }}
                  />
                </div>

                {isUploading && (
                  <div className="px-4 pb-3 space-y-1.5">
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Uploading...
                    </div>
                    {Object.entries(uploadProgress).map(([name, pct]) => (
                      <div key={name} className="space-y-0.5">
                        <div className="text-[10px] text-slate-400 truncate">{name}</div>
                        <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-blue-500 rounded-full transition-all duration-200"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* File list */}
              {visibleFiles.length > 0 && (
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-100">
                    <h3 className="text-sm font-semibold text-slate-800">
                      Documents ({visibleFiles.length})
                    </h3>
                  </div>
                  <div className="max-h-80 overflow-y-auto">
                    {visibleFiles.map((file, idx) => (
                      <div
                        key={file.id}
                        className={`flex items-center border-b border-slate-50 transition-colors ${
                          fileStatusBg(file.status)
                        } ${idx === activeDocIndex ? 'ring-1 ring-inset ring-blue-400' : 'hover:brightness-95'}`}
                      >
                        <button
                          onClick={() => setActiveDocIndex(idx)}
                          className="flex-1 text-left px-4 py-2.5 flex items-center gap-2.5 min-w-0"
                        >
                          <span className="flex items-center justify-center h-5 w-5 rounded-full bg-white border border-slate-200 text-[10px] font-bold text-slate-600 flex-shrink-0">
                            {idx + 1}
                          </span>
                          {fileStatusIcon(file.status)}
                          <span className="text-xs text-slate-700 truncate flex-1" title={file.originalName}>
                            {file.originalName}
                            {file.status === 'processing' && file.progress && (
                              <span className="block mt-1">
                                <span className="flex items-center gap-1.5">
                                  <span className="flex-1 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                                    <span
                                      className="block h-full bg-orange-400 rounded-full transition-all duration-500"
                                      style={{ width: `${file.progress.batchesTotal > 0 ? Math.round((file.progress.batchesDone / file.progress.batchesTotal) * 100) : 0}%` }}
                                    />
                                  </span>
                                  <span className="text-[9px] text-slate-400 whitespace-nowrap">
                                    {file.progress.pagesDone}/{file.progress.pagesTotal} pages
                                  </span>
                                </span>
                              </span>
                            )}
                          </span>
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleRemoveFile(file.id, file.status); }}
                          className="px-2 py-1 mr-1 text-slate-400 hover:text-red-500 transition-colors flex-shrink-0"
                          title={file.status === 'analysed' || file.status === 'failed' ? 'Hide from list' : 'Remove file'}
                        >
                          <XCircle className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* ─── Center: Results table ───────────────────────────────────── */}
            <div className="flex-1 min-w-0">
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                {/* Document navigation bar */}
                {visibleFiles.length > 0 && (
                  <div className="px-5 py-3 border-b border-slate-100">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setActiveDocIndex(Math.max(0, activeDocIndex - 1))}
                          disabled={activeDocIndex === 0}
                          className="p-1 rounded hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                          <ChevronLeft className="h-4 w-4 text-slate-600" />
                        </button>
                        <h3 className="text-sm font-semibold text-slate-800 truncate max-w-md" title={activeFile?.originalName}>
                          {activeFile?.originalName ?? 'No document selected'}
                        </h3>
                        <button
                          onClick={() => setActiveDocIndex(Math.min(visibleFiles.length - 1, activeDocIndex + 1))}
                          disabled={activeDocIndex >= visibleFiles.length - 1}
                          className="p-1 rounded hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                          <ChevronRight className="h-4 w-4 text-slate-600" />
                        </button>
                      </div>
                      <span className="text-xs text-slate-400">
                        {visibleFiles.length > 0 ? `${activeDocIndex + 1} of ${visibleFiles.length}` : ''}
                      </span>
                    </div>

                    {/* Navigation dots */}
                    {visibleFiles.length > 1 && (
                      <div className="flex items-center gap-1.5 mt-2">
                        {visibleFiles.map((file, idx) => (
                          <button
                            key={file.id}
                            onClick={() => setActiveDocIndex(idx)}
                            className={`h-2 w-2 rounded-full transition-colors ${
                              idx === activeDocIndex
                                ? 'bg-blue-600'
                                : 'bg-slate-300 hover:bg-slate-400'
                            }`}
                            title={file.originalName}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Table or empty state */}
                {visibleFiles.length === 0 ? (
                  <div className="px-5 py-20 text-center">
                    <FileText className="h-10 w-10 mx-auto text-slate-300 mb-3" />
                    <p className="text-sm text-slate-500">Upload and analyse documents to see findings</p>
                  </div>
                ) : activeFile && (activeFile.status === 'processing' || activeFile.status === 'uploaded') ? (
                  <div className="px-5 py-20 text-center">
                    <Loader2 className="h-8 w-8 mx-auto text-blue-500 animate-spin mb-3" />
                    <p className="text-sm text-slate-500">Processing...</p>
                    <p className="text-xs text-slate-400 mt-1">{activeFile.originalName}</p>
                  </div>
                ) : activeFile && activeFile.status === 'failed' ? (
                  <div className="px-5 py-20 text-center">
                    <XCircle className="h-8 w-8 mx-auto text-red-400 mb-3" />
                    <p className="text-sm text-red-600">Analysis failed</p>
                    <p className="text-xs text-slate-400 mt-1">{activeFile.errorMessage || 'Unknown error'}</p>
                  </div>
                ) : activeFindings.length === 0 ? (
                  <div className="px-5 py-20 text-center">
                    <CheckCircle2 className="h-8 w-8 mx-auto text-green-400 mb-3" />
                    <p className="text-sm text-slate-500">No findings for this document</p>
                  </div>
                ) : (
                  <div className="overflow-auto max-h-[calc(100vh-320px)]">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 z-10">
                        <tr className="bg-slate-50 border-b border-slate-200">
                          <th className="text-left px-4 py-2.5 font-semibold text-slate-700 w-[20%]">Area</th>
                          <th className="text-left px-4 py-2.5 font-semibold text-slate-700 w-[45%]">Finding</th>
                          <th className="text-center px-4 py-2.5 font-semibold text-slate-700 w-[15%]">Clause Ref</th>
                          <th className="text-center px-4 py-2.5 font-semibold text-slate-700 w-[10%]">Significant Risk</th>
                        </tr>
                      </thead>
                      <tbody>
                        {activeFindings.map(finding => (
                          <tr
                            key={finding.id}
                            className={`border-b border-slate-100 ${
                              finding.isSignificantRisk ? 'bg-orange-100' : 'hover:bg-slate-50'
                            }`}
                          >
                            <td className="px-4 py-2.5 text-slate-700 align-top">{finding.area}</td>
                            <td className="px-4 py-2.5 text-slate-700 align-top whitespace-pre-wrap">{finding.finding}</td>
                            <td className="px-4 py-2.5 text-slate-500 text-center align-top">{finding.clauseReference || '—'}</td>
                            <td className="px-4 py-2.5 text-center align-top">
                              <div className="flex items-center justify-center gap-1">
                                <input
                                  type="checkbox"
                                  checked={finding.isSignificantRisk}
                                  onChange={() => toggleRisk(finding.id, finding.isSignificantRisk)}
                                  className="h-4 w-4 rounded border-slate-300 text-orange-600 focus:ring-orange-500 cursor-pointer"
                                />
                                {finding.aiSignificantRisk != null && finding.aiSignificantRisk !== finding.isSignificantRisk && (
                                  <span className="text-[10px] text-slate-400" title="AI original assessment">
                                    (AI: {finding.aiSignificantRisk ? 'Yes' : 'No'})
                                  </span>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ─── Bottom action bar ───────────────────────────────────────────────── */}
      {selectedClient && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 px-6 py-3 z-20">
          <div className="max-w-[1600px] mx-auto flex items-center justify-end gap-3">
            <button
              onClick={() => downloadPdf()}
              disabled={!hasAnalysedDocs}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-sm"
            >
              <Download className="h-4 w-4" />
              Download PDF
            </button>
            <button
              onClick={downloadPortfolio}
              disabled={files.filter(f => f.status === 'analysed').length < 2}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-sm"
            >
              <BookOpen className="h-4 w-4" />
              Portfolio Report
            </button>
            <button
              onClick={() => activeFile && downloadPdf(activeFile.id)}
              disabled={!activeFile || activeFile.status !== 'analysed'}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-sm"
            >
              <Download className="h-4 w-4" />
              Download This Document
            </button>
            <button
              onClick={() => setEmailModalOpen(true)}
              disabled={!hasAnalysedDocs}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-sm"
            >
              <Mail className="h-4 w-4" />
              Email PDF
            </button>
          </div>
        </div>
      )}

      {/* ─── Email modal ─────────────────────────────────────────────────────── */}
      {emailModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-sm mx-4">
            <div className="px-5 py-4 border-b border-slate-100">
              <h3 className="text-base font-semibold text-slate-900">Email PDF Report</h3>
            </div>
            <div className="px-5 py-4">
              {emailSent ? (
                <div className="flex items-center gap-2 text-green-600 text-sm">
                  <CheckCircle2 className="h-4 w-4" />
                  Email sent successfully
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">
                      Recipient name
                    </label>
                    <input
                      type="text"
                      placeholder="John Smith"
                      value={emailRecipientName}
                      onChange={e => setEmailRecipientName(e.target.value)}
                      className="w-full px-3 py-2 h-20 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">
                      Recipient email
                    </label>
                    <input
                      type="email"
                      placeholder="name@example.com"
                      value={emailAddress}
                      onChange={e => setEmailAddress(e.target.value)}
                      className="w-full px-3 py-2 h-20 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                  {emailError && (
                    <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                      <AlertCircle className="h-4 w-4 flex-shrink-0" />
                      <span>{emailError}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-end gap-2">
              <button
                onClick={() => {
                  setEmailModalOpen(false);
                  setEmailAddress('');
                  setEmailRecipientName('');
                  setEmailSent(false);
                  setEmailError('');
                }}
                className="px-3 py-1.5 text-sm text-slate-600 hover:text-slate-800 transition-colors"
              >
                Cancel
              </button>
              {!emailSent && (
                <button
                  onClick={sendEmail}
                  disabled={!emailAddress || emailSending}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {emailSending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Mail className="h-3.5 w-3.5" />
                  )}
                  Send
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
