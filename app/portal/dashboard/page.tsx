'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Upload, CheckCircle2, AlertCircle, Loader2, X, FileText,
} from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface EvidenceRequest {
  id: string;
  transactionId: string;
  description: string;
  amount: number | null;
  date: string | null;
  reference: string | null;
  contact: string | null;
  invoiceRequired: boolean;
  paymentRequired: boolean;
  supplierConfirmation: boolean;
  debtorConfirmation: boolean;
  contractRequired: boolean;
  intercompanyRequired: boolean;
  directorMatters: boolean;
  status: string;
  // Data source info from sampling
  run?: { engagement?: { auditArea?: string } };
  uploads: {
    id: string;
    evidenceType: string;
    aiVerified: boolean | null;
    firmAccepted: boolean | null;
    originalName: string;
    createdAt: string;
  }[];
}

const EVIDENCE_COLUMNS = [
  { key: 'invoiceRequired', label: 'Invoice' },
  { key: 'paymentRequired', label: 'Payment / Receipt' },
  { key: 'supplierConfirmation', label: 'Supplier Confirmation' },
  { key: 'debtorConfirmation', label: 'Debtor Confirmation' },
  { key: 'contractRequired', label: 'Contract' },
  { key: 'intercompanyRequired', label: 'Intercompany' },
  { key: 'directorMatters', label: 'Director Matters' },
] as const;

type EvidenceKey = (typeof EVIDENCE_COLUMNS)[number]['key'];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getStatusForColumn(request: EvidenceRequest, key: string): 'blank' | 'red' | 'orange' | 'green' {
  const required = (request as unknown as Record<string, unknown>)[key];
  if (!required) return 'blank';
  const uploads = request.uploads.filter(u => u.evidenceType === key);
  if (uploads.length === 0) return 'red'; // Required, not uploaded
  const latest = uploads[uploads.length - 1];
  if (latest.firmAccepted === false) return 'red'; // Rejected
  if (latest.aiVerified === true || latest.firmAccepted === true) return 'green'; // Verified
  return 'orange'; // Uploaded, pending verification
}

const DOT_COLORS = {
  blank: '',
  red: 'bg-red-500',
  orange: 'bg-orange-400',
  green: 'bg-green-500',
};

// ─── Component ───────────────────────────────────────────────────────────────

export default function PortalDashboardPage() {
  const [requests, setRequests] = useState<EvidenceRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [showBulkUpload, setShowBulkUpload] = useState(false);
  const [bulkFiles, setBulkFiles] = useState<{ file: File; mappedRequestId: string }[]>([]);
  const [activeTab, setActiveTab] = useState('all');

  const token = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('token') || ''
    : '';

  const loadRequests = useCallback(async () => {
    try {
      const res = await fetch(`/api/portal/evidence?token=${token}`);
      if (!res.ok) throw new Error('Failed to load requests');
      const data = await res.json();
      setRequests(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    }
    setLoading(false);
  }, [token]);

  useEffect(() => {
    if (token) loadRequests();
    else { setError('No authentication token'); setLoading(false); }
  }, [token, loadRequests]);

  // ─── Data type tabs ───────────────────────────────────────────────────
  const dataTypes = useMemo(() => {
    const types = new Map<string, EvidenceRequest[]>();
    types.set('all', requests);
    for (const req of requests) {
      const area = req.run?.engagement?.auditArea || 'Other';
      if (!types.has(area)) types.set(area, []);
      types.get(area)!.push(req);
    }
    return types;
  }, [requests]);

  const filteredRequests = dataTypes.get(activeTab) || requests;

  // ─── Summary counts per tab ───────────────────────────────────────────
  function getTabCounts(reqs: EvidenceRequest[]) {
    let red = 0, orange = 0, green = 0;
    for (const req of reqs) {
      for (const col of EVIDENCE_COLUMNS) {
        const s = getStatusForColumn(req, col.key);
        if (s === 'red') red++;
        else if (s === 'orange') orange++;
        else if (s === 'green') green++;
      }
    }
    return { red, orange, green };
  }

  // ─── Upload handler ───────────────────────────────────────────────────
  const handleUpload = async (requestId: string, evidenceType: string, file: File) => {
    setUploadingId(requestId);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('requestId', requestId);
      formData.append('evidenceType', evidenceType);
      formData.append('token', token);

      const res = await fetch('/api/portal/evidence/upload', { method: 'POST', body: formData });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error || 'Upload failed');
      }
      await loadRequests();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    }
    setUploadingId(null);
  };

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 text-blue-500 animate-spin" /></div>;
  }

  if (error && requests.length === 0) {
    return <div className="text-center py-20"><AlertCircle className="h-10 w-10 text-red-400 mx-auto mb-3" /><p className="text-sm text-red-600">{error}</p></div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Audit Team Requests</h1>
        <p className="text-sm text-slate-500 mt-1">
          Below are the audit evidence items requested by your audit team. Please upload the relevant
          documents for each item. Once uploaded, the system will verify the document matches the request.
        </p>
      </div>

      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}

      {/* Data type tabs with status dot summaries underneath */}
      <div className="flex items-end gap-3 flex-wrap">
        {[...dataTypes.entries()].map(([type, reqs]) => {
          const counts = getTabCounts(reqs);
          const isActive = activeTab === type;
          return (
            <button
              key={type}
              onClick={() => setActiveTab(type)}
              className={`flex flex-col items-center gap-1 px-4 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                isActive ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              <span>{type === 'all' ? 'All' : type}</span>
              <span className="flex items-center gap-1.5">
                {counts.red > 0 && <span className="flex items-center gap-0.5"><span className="w-2 h-2 rounded-full bg-red-500" /><span className={`text-[9px] ${isActive ? 'text-red-200' : 'text-red-500'}`}>{counts.red}</span></span>}
                {counts.orange > 0 && <span className="flex items-center gap-0.5"><span className="w-2 h-2 rounded-full bg-orange-400" /><span className={`text-[9px] ${isActive ? 'text-orange-200' : 'text-orange-500'}`}>{counts.orange}</span></span>}
                {counts.green > 0 && <span className="flex items-center gap-0.5"><span className="w-2 h-2 rounded-full bg-green-500" /><span className={`text-[9px] ${isActive ? 'text-green-200' : 'text-green-600'}`}>{counts.green}</span></span>}
                {counts.red === 0 && counts.orange === 0 && counts.green === 0 && <span className="text-[9px] opacity-50">—</span>}
              </span>
            </button>
          );
        })}
        <div className="ml-auto">
          <button
            onClick={() => setShowBulkUpload(true)}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Upload className="h-3.5 w-3.5" /> Bulk Upload
          </button>
        </div>
      </div>

      {/* Evidence request table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-3 py-2.5 text-left font-semibold text-slate-600">Transaction</th>
                <th className="px-3 py-2.5 text-left font-semibold text-slate-600">Description</th>
                <th className="px-3 py-2.5 text-right font-semibold text-slate-600">Amount</th>
                <th className="px-3 py-2.5 text-left font-semibold text-slate-600">Date</th>
                {EVIDENCE_COLUMNS.map(col => (
                  <th key={col.key} className="px-1 py-2.5 text-center w-8">
                    <div className="writing-mode-vertical text-[9px] font-semibold text-slate-500" style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', whiteSpace: 'nowrap', height: '70px', display: 'flex', alignItems: 'center' }}>
                      {col.label}
                    </div>
                  </th>
                ))}
                <th className="px-2 py-2.5 text-center font-semibold text-slate-600 w-20">Upload</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredRequests.map(req => {
                const allDone = EVIDENCE_COLUMNS.every(col => {
                  if (!(req as unknown as Record<string, unknown>)[col.key]) return true;
                  return req.uploads.some(u => u.evidenceType === col.key && (u.aiVerified || u.firmAccepted));
                });
                // Find the first evidence type that still needs uploading
                const neededType = EVIDENCE_COLUMNS.find(col => {
                  const s = getStatusForColumn(req, col.key);
                  return s === 'red';
                });
                return (
                  <tr key={req.id} className={allDone ? 'bg-green-50/30' : ''}>
                    <td className="px-3 py-2 font-mono text-slate-600 text-[10px]">{req.transactionId?.slice(0, 12)}</td>
                    <td className="px-3 py-2 text-slate-700 max-w-[220px] truncate">{req.description}</td>
                    <td className="px-3 py-2 text-right font-medium">{req.amount != null ? req.amount.toLocaleString(undefined, { minimumFractionDigits: 2 }) : '—'}</td>
                    <td className="px-3 py-2 text-slate-500">{req.date || '—'}</td>
                    {EVIDENCE_COLUMNS.map(col => {
                      const status = getStatusForColumn(req, col.key);
                      return (
                        <td key={col.key} className="px-1 py-2 text-center">
                          {status !== 'blank' && (
                            <div className={`w-3 h-3 rounded-full mx-auto ${DOT_COLORS[status]}`} />
                          )}
                        </td>
                      );
                    })}
                    <td className="px-2 py-2 text-center">
                      {allDone ? (
                        <CheckCircle2 className="h-4 w-4 text-green-600 mx-auto" />
                      ) : neededType ? (
                        <label className={`inline-flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded cursor-pointer transition-colors ${
                          uploadingId === req.id
                            ? 'bg-slate-100 text-slate-400'
                            : 'bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200'
                        }`}>
                          {uploadingId === req.id
                            ? <Loader2 className="h-3 w-3 animate-spin" />
                            : <Upload className="h-3 w-3" />}
                          Upload
                          <input
                            type="file"
                            className="hidden"
                            disabled={uploadingId === req.id}
                            onChange={e => {
                              const file = e.target.files?.[0];
                              if (file && neededType) handleUpload(req.id, neededType.key, file);
                            }}
                          />
                        </label>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-[10px] text-slate-500">
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-red-500" />Awaiting upload</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-orange-400" />Uploaded (pending verification)</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-green-500" />Verified</span>
      </div>

      {/* Bulk Upload Modal */}
      {showBulkUpload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[80vh] flex flex-col">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">Bulk Upload</h3>
              <button onClick={() => { setShowBulkUpload(false); setBulkFiles([]); }} className="text-slate-400 hover:text-slate-600"><X className="h-5 w-5" /></button>
            </div>
            <div className="px-5 py-4 overflow-y-auto flex-1 space-y-4">
              <div className="border-2 border-dashed border-slate-200 rounded-lg p-6 text-center">
                <FileText className="h-8 w-8 text-slate-300 mx-auto mb-2" />
                <label className="cursor-pointer text-sm text-blue-600 hover:text-blue-700 font-medium">
                  Choose files
                  <input type="file" multiple className="hidden" onChange={e => {
                    const files = Array.from(e.target.files || []);
                    setBulkFiles(prev => [...prev, ...files.map(file => ({ file, mappedRequestId: '' }))]);
                  }} />
                </label>
              </div>
              {bulkFiles.length > 0 && (
                <div className="space-y-2">
                  {bulkFiles.map((bf, i) => (
                    <div key={i} className="flex items-center gap-2 p-2 border border-slate-200 rounded-lg">
                      <FileText className="h-4 w-4 text-slate-400 shrink-0" />
                      <span className="text-xs text-slate-700 truncate flex-1">{bf.file.name}</span>
                      <select value={bf.mappedRequestId} onChange={e => setBulkFiles(prev => prev.map((f, j) => j === i ? { ...f, mappedRequestId: e.target.value } : f))} className="text-xs border border-slate-200 rounded px-2 py-1 w-48">
                        <option value="">— Map to request —</option>
                        {requests.map(r => <option key={r.id} value={r.id}>{r.description?.slice(0, 40)} ({r.amount?.toLocaleString() || '—'})</option>)}
                      </select>
                      <button onClick={() => setBulkFiles(prev => prev.filter((_, j) => j !== i))} className="text-red-400 hover:text-red-600"><X className="h-3.5 w-3.5" /></button>
                    </div>
                  ))}
                  {bulkFiles.some(f => !f.mappedRequestId) && (
                    <div className="p-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
                      All files must be mapped to a request before uploading.
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="px-5 py-3 border-t border-slate-100 flex justify-end gap-2">
              <button onClick={() => { setShowBulkUpload(false); setBulkFiles([]); }} className="px-4 py-1.5 text-xs font-medium text-slate-600 bg-slate-100 rounded-md hover:bg-slate-200">Cancel</button>
              <button
                onClick={async () => {
                  if (bulkFiles.some(f => !f.mappedRequestId)) return;
                  for (const bf of bulkFiles) {
                    const req = requests.find(r => r.id === bf.mappedRequestId);
                    if (!req) continue;
                    const neededType = EVIDENCE_COLUMNS.find(col => getStatusForColumn(req, col.key) === 'red');
                    if (neededType) await handleUpload(bf.mappedRequestId, neededType.key, bf.file);
                  }
                  setShowBulkUpload(false); setBulkFiles([]);
                }}
                disabled={bulkFiles.length === 0 || bulkFiles.some(f => !f.mappedRequestId)}
                className="px-4 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-40"
              >Upload</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
