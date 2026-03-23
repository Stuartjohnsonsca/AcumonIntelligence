'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Upload, CheckCircle2, AlertCircle, Loader2, X, FileText, Mail, MapPin,
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

const CONFIRMATION_TYPES = new Set(['supplierConfirmation', 'debtorConfirmation']);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getStatusForColumn(request: EvidenceRequest, key: string): 'blank' | 'red' | 'orange' | 'green' {
  const required = (request as unknown as Record<string, unknown>)[key];
  if (!required) return 'blank';
  const uploads = request.uploads.filter(u => u.evidenceType === key);
  if (uploads.length === 0) return 'red';
  const latest = uploads[uploads.length - 1];
  if (latest.firmAccepted === false) return 'red';
  if (latest.aiVerified === true || latest.firmAccepted === true) return 'green';
  return 'orange';
}

const DOT_STYLES = {
  blank: '',
  red: 'bg-red-600 hover:bg-red-700 cursor-pointer ring-2 ring-transparent hover:ring-red-200',
  orange: 'bg-amber-300 hover:bg-amber-400 cursor-pointer ring-2 ring-transparent hover:ring-amber-200',
  green: 'bg-green-500',
};

// ─── Component ───────────────────────────────────────────────────────────────

export default function PortalDashboardPage() {
  const [requests, setRequests] = useState<EvidenceRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [uploadingKey, setUploadingKey] = useState<string | null>(null); // "reqId:colKey"
  const [showBulkUpload, setShowBulkUpload] = useState(false);
  const [bulkFiles, setBulkFiles] = useState<{ file: File; mappedRequestId: string }[]>([]);
  const [activeTab, setActiveTab] = useState('all');

  // Confirmation popup state (for supplier/debtor)
  const [confirmPopup, setConfirmPopup] = useState<{ requestId: string; evidenceType: string; label: string } | null>(null);
  const [confirmMode, setConfirmMode] = useState<'email' | 'postal'>('email');
  const [confirmContact, setConfirmContact] = useState('');
  const [confirmEmail, setConfirmEmail] = useState('');
  const [confirmAddress, setConfirmAddress] = useState({ line1: '', line2: '', city: '', postcode: '', country: '' });
  const [confirmSending, setConfirmSending] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingUpload, setPendingUpload] = useState<{ requestId: string; evidenceType: string } | null>(null);

  const token = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('token') || ''
    : '';

  const loadRequests = useCallback(async () => {
    try {
      const res = await fetch(`/api/portal/evidence?token=${token}`);
      if (!res.ok) throw new Error('Failed to load requests');
      setRequests(await res.json());
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

  // ─── File upload handler ──────────────────────────────────────────────
  const handleUpload = async (requestId: string, evidenceType: string, file: File) => {
    const key = `${requestId}:${evidenceType}`;
    setUploadingKey(key);
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
    setUploadingKey(null);
  };

  // ─── Dot click handler ────────────────────────────────────────────────
  const handleDotClick = (req: EvidenceRequest, colKey: string, colLabel: string) => {
    const status = getStatusForColumn(req, colKey);
    if (status === 'green') return; // Already verified, no action

    // Supplier/Debtor confirmation opens contact popup
    if (CONFIRMATION_TYPES.has(colKey)) {
      setConfirmPopup({ requestId: req.id, evidenceType: colKey, label: colLabel });
      setConfirmMode('email');
      setConfirmContact(req.contact || '');
      setConfirmEmail('');
      setConfirmAddress({ line1: '', line2: '', city: '', postcode: '', country: '' });
      return;
    }

    // All other types open file picker
    setPendingUpload({ requestId: req.id, evidenceType: colKey });
    setTimeout(() => fileInputRef.current?.click(), 50);
  };

  // ─── Submit confirmation request ──────────────────────────────────────
  const handleSubmitConfirmation = async () => {
    if (!confirmPopup) return;
    setConfirmSending(true);
    try {
      const formData = new FormData();
      const details = confirmMode === 'email'
        ? `Contact: ${confirmContact}\nEmail: ${confirmEmail}`
        : `Contact: ${confirmContact}\nAddress: ${confirmAddress.line1}, ${confirmAddress.line2}, ${confirmAddress.city}, ${confirmAddress.postcode}, ${confirmAddress.country}`;
      const blob = new Blob([details], { type: 'text/plain' });
      formData.append('file', blob, `${confirmPopup.evidenceType}_request.txt`);
      formData.append('requestId', confirmPopup.requestId);
      formData.append('evidenceType', confirmPopup.evidenceType);
      formData.append('token', token);
      const res = await fetch('/api/portal/evidence/upload', { method: 'POST', body: formData });
      if (!res.ok) throw new Error('Failed to submit confirmation request');
      await loadRequests();
      setConfirmPopup(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submission failed');
    }
    setConfirmSending(false);
  };

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 text-blue-500 animate-spin" /></div>;
  if (error && requests.length === 0) return <div className="text-center py-20"><AlertCircle className="h-10 w-10 text-red-400 mx-auto mb-3" /><p className="text-sm text-red-600">{error}</p></div>;

  return (
    <div className="space-y-6">
      {/* Hidden file input for dot-click uploads */}
      <input ref={fileInputRef} type="file" className="hidden" onChange={e => {
        const file = e.target.files?.[0];
        if (file && pendingUpload) {
          handleUpload(pendingUpload.requestId, pendingUpload.evidenceType, file);
          setPendingUpload(null);
        }
        e.target.value = '';
      }} />

      <div>
        <h1 className="text-xl font-bold text-slate-900">Audit Team Requests</h1>
        <p className="text-sm text-slate-500 mt-1">
          Below are the audit evidence items requested by your audit team. Click a <span className="text-red-500 font-medium">red dot</span> to upload evidence for that category.
        </p>
      </div>

      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}

      {/* Tabs with dots underneath */}
      <div className="flex items-end gap-3 flex-wrap">
        {[...dataTypes.entries()].map(([type, reqs]) => {
          const counts = getTabCounts(reqs);
          const isActive = activeTab === type;
          return (
            <button key={type} onClick={() => setActiveTab(type)}
              className={`flex flex-col items-center gap-1 px-4 py-1.5 text-xs font-medium rounded-lg transition-colors ${isActive ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
              <span>{type === 'all' ? 'All' : type}</span>
              <span className="flex flex-col items-center gap-0.5">
                {counts.red > 0 && <span className="flex items-center gap-0.5"><span className="w-2 h-2 rounded-full bg-red-600" /><span className={`text-[9px] ${isActive ? 'text-red-200' : 'text-red-600'}`}>{counts.red}</span></span>}
                {counts.orange > 0 && <span className="flex items-center gap-0.5"><span className="w-2 h-2 rounded-full bg-amber-300" /><span className={`text-[9px] ${isActive ? 'text-amber-200' : 'text-amber-400'}`}>{counts.orange}</span></span>}
                {counts.green > 0 && <span className="flex items-center gap-0.5"><span className="w-2 h-2 rounded-full bg-green-500" /><span className={`text-[9px] ${isActive ? 'text-green-200' : 'text-green-600'}`}>{counts.green}</span></span>}
                {counts.red === 0 && counts.orange === 0 && counts.green === 0 && <span className="text-[9px] opacity-50">—</span>}
              </span>
            </button>
          );
        })}
        <div className="ml-auto">
          <button onClick={() => setShowBulkUpload(true)} className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
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
                    <div className="text-[9px] font-semibold text-slate-500" style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', whiteSpace: 'nowrap', height: '70px', display: 'flex', alignItems: 'center' }}>
                      {col.label}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredRequests.map(req => {
                const allDone = EVIDENCE_COLUMNS.every(col => {
                  if (!(req as unknown as Record<string, unknown>)[col.key]) return true;
                  return req.uploads.some(u => u.evidenceType === col.key && (u.aiVerified || u.firmAccepted));
                });
                return (
                  <tr key={req.id} className={allDone ? 'bg-green-50/30' : ''}>
                    <td className="px-3 py-2 font-mono text-slate-600 text-[10px]">{req.transactionId?.slice(0, 12)}</td>
                    <td className="px-3 py-2 text-slate-700 max-w-[220px] truncate">{req.description}</td>
                    <td className="px-3 py-2 text-right font-medium">{req.amount != null ? req.amount.toLocaleString(undefined, { minimumFractionDigits: 2 }) : '—'}</td>
                    <td className="px-3 py-2 text-slate-500">{req.date || '—'}</td>
                    {EVIDENCE_COLUMNS.map(col => {
                      const status = getStatusForColumn(req, col.key);
                      const isUploading = uploadingKey === `${req.id}:${col.key}`;
                      return (
                        <td key={col.key} className="px-1 py-2 text-center">
                          {status === 'blank' ? null : isUploading ? (
                            <Loader2 className="h-3 w-3 text-blue-500 animate-spin mx-auto" />
                          ) : (
                            <button
                              onClick={() => handleDotClick(req, col.key, col.label)}
                              disabled={status === 'green'}
                              title={status === 'red' ? `Click to upload ${col.label}` : status === 'orange' ? `${col.label} uploaded, pending verification` : `${col.label} verified`}
                              className={`w-3.5 h-3.5 rounded-full mx-auto block transition-all ${DOT_STYLES[status]}`}
                            />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-[10px] text-slate-500">
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-red-600" />Click to upload</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-amber-300" />Uploaded (pending)</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-green-500" />Verified</span>
      </div>

      {/* ─── Supplier/Debtor Confirmation Popup ─────────────────────────── */}
      {confirmPopup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 flex flex-col">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">{confirmPopup.label} Request</h3>
              <button onClick={() => setConfirmPopup(null)} className="text-slate-400 hover:text-slate-600"><X className="h-5 w-5" /></button>
            </div>
            <div className="px-5 py-4 space-y-4">
              <p className="text-xs text-slate-500">
                Enter the contact details for the {confirmPopup.label.toLowerCase()} request.
              </p>

              {/* Contact name */}
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Contact Name</label>
                <input type="text" value={confirmContact} onChange={e => setConfirmContact(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Contact name" />
              </div>

              {/* Email / Postal toggle */}
              <div className="flex gap-1 bg-slate-100 rounded-lg p-0.5">
                <button onClick={() => setConfirmMode('email')}
                  className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    confirmMode === 'email' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>
                  <Mail className="h-3 w-3" /> Email
                </button>
                <button onClick={() => setConfirmMode('postal')}
                  className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    confirmMode === 'postal' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>
                  <MapPin className="h-3 w-3" /> Postal
                </button>
              </div>

              {confirmMode === 'email' ? (
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Email Address</label>
                  <input type="email" value={confirmEmail} onChange={e => setConfirmEmail(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="email@example.com" />
                </div>
              ) : (
                <div className="space-y-2">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Address Line 1</label>
                    <input type="text" value={confirmAddress.line1} onChange={e => setConfirmAddress(prev => ({ ...prev, line1: e.target.value }))}
                      className="w-full px-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Address Line 2</label>
                    <input type="text" value={confirmAddress.line2} onChange={e => setConfirmAddress(prev => ({ ...prev, line2: e.target.value }))}
                      className="w-full px-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500" />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">City</label>
                      <input type="text" value={confirmAddress.city} onChange={e => setConfirmAddress(prev => ({ ...prev, city: e.target.value }))}
                        className="w-full px-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">Postcode</label>
                      <input type="text" value={confirmAddress.postcode} onChange={e => setConfirmAddress(prev => ({ ...prev, postcode: e.target.value }))}
                        className="w-full px-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Country</label>
                    <input type="text" value={confirmAddress.country} onChange={e => setConfirmAddress(prev => ({ ...prev, country: e.target.value }))}
                      className="w-full px-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500"
                      placeholder="United Kingdom" />
                  </div>
                </div>
              )}
            </div>
            <div className="px-5 py-3 border-t border-slate-100 flex justify-end gap-2">
              <button onClick={() => setConfirmPopup(null)} className="px-4 py-1.5 text-xs font-medium text-slate-600 bg-slate-100 rounded-md hover:bg-slate-200">Cancel</button>
              <button onClick={handleSubmitConfirmation} disabled={confirmSending || !confirmContact || (confirmMode === 'email' ? !confirmEmail : !confirmAddress.line1)}
                className="px-4 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-40">
                {confirmSending ? <Loader2 className="h-3 w-3 animate-spin inline mr-1" /> : null}
                Submit Request
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Bulk Upload Modal ──────────────────────────────────────────── */}
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
                    <div className="p-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">All files must be mapped to a request before uploading.</div>
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
