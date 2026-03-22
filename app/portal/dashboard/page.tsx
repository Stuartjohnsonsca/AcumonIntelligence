'use client';

import { useState, useEffect, useCallback } from 'react';
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
  { key: 'paymentRequired', label: 'Payment' },
  { key: 'supplierConfirmation', label: 'Supplier' },
  { key: 'debtorConfirmation', label: 'Debtor' },
  { key: 'contractRequired', label: 'Contract' },
  { key: 'intercompanyRequired', label: 'Interco' },
  { key: 'directorMatters', label: 'Director' },
] as const;

// ─── Component ───────────────────────────────────────────────────────────────

export default function PortalDashboardPage() {
  const [requests, setRequests] = useState<EvidenceRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [showBulkUpload, setShowBulkUpload] = useState(false);
  const [bulkFiles, setBulkFiles] = useState<{ file: File; mappedRequestId: string }[]>([]);

  // Get token from URL (simple auth for now)
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

  // ─── Single file upload ───────────────────────────────────────────────
  const handleUpload = async (requestId: string, evidenceType: string, file: File) => {
    setUploadingId(requestId);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('requestId', requestId);
      formData.append('evidenceType', evidenceType);
      formData.append('token', token);

      const res = await fetch('/api/portal/evidence/upload', {
        method: 'POST',
        body: formData,
      });

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

  // ─── Get status dot color ─────────────────────────────────────────────
  const getStatusColor = (request: EvidenceRequest, key: string) => {
    if (!(request as unknown as Record<string, unknown>)[key]) return 'bg-slate-200'; // Not required
    const uploads = request.uploads.filter(u => u.evidenceType === key);
    if (uploads.length === 0) return 'bg-slate-300'; // Required but not uploaded
    const latest = uploads[uploads.length - 1];
    if (latest.firmAccepted === false) return 'bg-slate-300'; // Rejected, needs re-upload
    if (latest.aiVerified === true || latest.firmAccepted === true) return 'bg-green-500'; // Verified
    return 'bg-orange-400'; // Uploaded, pending verification
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  if (error && requests.length === 0) {
    return (
      <div className="text-center py-20">
        <AlertCircle className="h-10 w-10 text-red-400 mx-auto mb-3" />
        <p className="text-sm text-red-600">{error}</p>
      </div>
    );
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

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>
      )}

      {/* Bulk upload button */}
      <div className="flex justify-end">
        <button
          onClick={() => setShowBulkUpload(true)}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Upload className="h-4 w-4" /> Bulk Upload
        </button>
      </div>

      {/* Evidence request table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-3 py-2.5 text-left font-semibold text-slate-600 w-8">Upload</th>
                <th className="px-3 py-2.5 text-left font-semibold text-slate-600">Transaction</th>
                <th className="px-3 py-2.5 text-left font-semibold text-slate-600">Description</th>
                <th className="px-3 py-2.5 text-right font-semibold text-slate-600">Amount</th>
                <th className="px-3 py-2.5 text-left font-semibold text-slate-600">Date</th>
                {EVIDENCE_COLUMNS.map(col => (
                  <th key={col.key} className="px-2 py-2.5 text-center font-semibold text-slate-600 w-16">{col.label}</th>
                ))}
                <th className="px-3 py-2.5 text-center font-semibold text-slate-600 w-16">Actioned</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {requests.map(req => {
                const allDone = EVIDENCE_COLUMNS.every(col => {
                  if (!(req as Record<string, unknown>)[col.key]) return true;
                  return req.uploads.some(u => u.evidenceType === col.key && (u.aiVerified || u.firmAccepted));
                });
                return (
                  <tr key={req.id} className={allDone ? 'bg-green-50/50' : ''}>
                    {/* Upload button */}
                    <td className="px-3 py-2">
                      <label className={`cursor-pointer ${uploadingId === req.id ? 'opacity-50' : ''}`}>
                        {uploadingId === req.id
                          ? <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />
                          : <Upload className="h-4 w-4 text-blue-500 hover:text-blue-700" />}
                        <input
                          type="file"
                          className="hidden"
                          onChange={e => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            // Find first required but not-yet-uploaded type
                            const neededType = EVIDENCE_COLUMNS.find(col =>
                              (req as Record<string, unknown>)[col.key] &&
                              !req.uploads.some(u => u.evidenceType === col.key && (u.aiVerified !== false))
                            );
                            if (neededType) handleUpload(req.id, neededType.key, file);
                          }}
                        />
                      </label>
                    </td>
                    <td className="px-3 py-2 font-mono text-slate-600">{req.transactionId}</td>
                    <td className="px-3 py-2 text-slate-700 max-w-[200px] truncate">{req.description}</td>
                    <td className="px-3 py-2 text-right font-medium">{req.amount?.toLocaleString() || '—'}</td>
                    <td className="px-3 py-2 text-slate-500">{req.date || '—'}</td>
                    {EVIDENCE_COLUMNS.map(col => (
                      <td key={col.key} className="px-2 py-2 text-center">
                        <div className={`w-3 h-3 rounded-full mx-auto ${getStatusColor(req, col.key)}`} />
                      </td>
                    ))}
                    <td className="px-3 py-2 text-center">
                      {allDone ? (
                        <CheckCircle2 className="h-4 w-4 text-green-600 mx-auto" />
                      ) : (
                        <span className="text-slate-400">—</span>
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
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-slate-200" />Not required</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-slate-300" />Awaiting upload</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-orange-400" />Uploaded (pending)</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-green-500" />Verified</span>
      </div>

      {/* Bulk Upload Modal */}
      {showBulkUpload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[80vh] flex flex-col">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">Bulk Upload</h3>
              <button onClick={() => { setShowBulkUpload(false); setBulkFiles([]); }} className="text-slate-400 hover:text-slate-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="px-5 py-4 overflow-y-auto flex-1 space-y-4">
              <div className="border-2 border-dashed border-slate-200 rounded-lg p-6 text-center">
                <FileText className="h-8 w-8 text-slate-300 mx-auto mb-2" />
                <label className="cursor-pointer text-sm text-blue-600 hover:text-blue-700 font-medium">
                  Choose files
                  <input
                    type="file"
                    multiple
                    className="hidden"
                    onChange={e => {
                      const files = Array.from(e.target.files || []);
                      setBulkFiles(prev => [
                        ...prev,
                        ...files.map(file => ({ file, mappedRequestId: '' })),
                      ]);
                    }}
                  />
                </label>
              </div>

              {bulkFiles.length > 0 && (
                <div className="space-y-2">
                  {bulkFiles.map((bf, i) => (
                    <div key={i} className="flex items-center gap-2 p-2 border border-slate-200 rounded-lg">
                      <FileText className="h-4 w-4 text-slate-400 shrink-0" />
                      <span className="text-xs text-slate-700 truncate flex-1">{bf.file.name}</span>
                      <select
                        value={bf.mappedRequestId}
                        onChange={e => {
                          setBulkFiles(prev => prev.map((f, j) =>
                            j === i ? { ...f, mappedRequestId: e.target.value } : f
                          ));
                        }}
                        className="text-xs border border-slate-200 rounded px-2 py-1 w-40"
                      >
                        <option value="">— Map to request —</option>
                        {requests.map(r => (
                          <option key={r.id} value={r.id}>{r.transactionId} — {r.description?.slice(0, 30)}</option>
                        ))}
                      </select>
                      <button onClick={() => setBulkFiles(prev => prev.filter((_, j) => j !== i))} className="text-red-400 hover:text-red-600">
                        <X className="h-3.5 w-3.5" />
                      </button>
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
              <button
                onClick={() => { setShowBulkUpload(false); setBulkFiles([]); }}
                className="px-4 py-1.5 text-xs font-medium text-slate-600 bg-slate-100 rounded-md hover:bg-slate-200"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  if (bulkFiles.some(f => !f.mappedRequestId)) return;
                  for (const bf of bulkFiles) {
                    const req = requests.find(r => r.id === bf.mappedRequestId);
                    if (!req) continue;
                    const neededType = EVIDENCE_COLUMNS.find(col =>
                      (req as Record<string, unknown>)[col.key] &&
                      !req.uploads.some(u => u.evidenceType === col.key)
                    );
                    if (neededType) await handleUpload(bf.mappedRequestId, neededType.key, bf.file);
                  }
                  setShowBulkUpload(false);
                  setBulkFiles([]);
                }}
                disabled={bulkFiles.length === 0 || bulkFiles.some(f => !f.mappedRequestId)}
                className="px-4 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-40"
              >
                Upload
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
