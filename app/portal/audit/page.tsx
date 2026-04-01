'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Upload, CheckCircle2, AlertCircle, Loader2, X, FileText, Mail, MapPin, ArrowLeft,
} from 'lucide-react';
import Link from 'next/link';
import { OutstandingTab } from '@/components/portal/OutstandingTab';
import { RespondedTab } from '@/components/portal/RespondedTab';
import { ExplanationsTab } from '@/components/portal/ExplanationsTab';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ClientInfo {
  id: string;
  clientName: string;
}

interface PeriodInfo {
  id: string;
  startDate: string;
  endDate: string;
  engagementId: string;
  status: string;
}

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
  clientId?: string;
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

const AUDIT_SUB_TABS = [
  { key: 'outstanding', label: 'Outstanding' },
  { key: 'explanations', label: 'Explanations' },
  { key: 'responded', label: 'Responded' },
  { key: 'evidence', label: 'Evidence' },
  { key: 'concerns', label: 'Concerns' },
  { key: 'confirmations', label: 'Confirmations' },
  { key: 'errors', label: 'Errors Identified' },
];

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

export default function PortalAuditPage() {
  const [clients, setClients] = useState<ClientInfo[]>([]);
  const [activeClientId, setActiveClientId] = useState('');
  const [periods, setPeriods] = useState<PeriodInfo[]>([]);
  const [activePeriodId, setActivePeriodId] = useState('');
  const [periodsLoading, setPeriodsLoading] = useState(false);
  const [activeSubTab, setActiveSubTab] = useState('outstanding');
  const [viewMode, setViewMode] = useState<'my' | 'team'>('my');
  const [portalUserName, setPortalUserName] = useState('');
  const [outstandingCount, setOutstandingCount] = useState(0);
  const [explanationsCount, setExplanationsCount] = useState(0);
  const [unacceptedCount, setUnacceptedCount] = useState(0);
  // Per-tab status counts: { tabKey: { outstanding, unaccepted, verified } }
  const [tabCounts, setTabCounts] = useState<Record<string, { outstanding: number; unaccepted: number; verified: number }>>({});
  const [clientOutstandingCounts, setClientOutstandingCounts] = useState<Record<string, number>>({});
  const [periodOutstandingCounts, setPeriodOutstandingCounts] = useState<Record<string, number>>({});
  const [requests, setRequests] = useState<EvidenceRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [uploadingKey, setUploadingKey] = useState<string | null>(null);
  const [showBulkUpload, setShowBulkUpload] = useState(false);
  const [bulkFiles, setBulkFiles] = useState<{ file: File; mappedRequestId: string }[]>([]);

  // Confirmation popup state
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

  // Load data
  const loadData = useCallback(async () => {
    try {
      const res = await fetch(`/api/portal/evidence?token=${token}`);
      if (!res.ok) throw new Error('Failed to load requests');
      const data = await res.json();
      setRequests(data);

      // Extract unique clients from requests
      const clientMap = new Map<string, string>();
      for (const req of data) {
        if (req.clientId && req.clientName) {
          clientMap.set(req.clientId, req.clientName);
        }
      }
      // Also try loading from my-details endpoint
      try {
        const clientsRes = await fetch(`/api/portal/my-details?token=${token}`);
        if (clientsRes.ok) {
          const clientsData = await clientsRes.json();
          if (clientsData.clients) {
            for (const c of clientsData.clients) {
              clientMap.set(c.id, c.clientName);
            }
          }
        }
      } catch {}

      const clientList = Array.from(clientMap.entries()).map(([id, name]) => ({ id, clientName: name }));
      setClients(clientList);
      // Only auto-select if there's exactly 1 client
      if (clientList.length === 1 && !activeClientId) {
        setActiveClientId(clientList[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    }
    setLoading(false);
  }, [token, activeClientId]);

  useEffect(() => {
    if (token) {
      loadData();
      // Load portal user name
      fetch(`/api/portal/my-details?token=${token}`)
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d?.user?.name) setPortalUserName(d.user.name); })
        .catch(() => {});
    }
    else { setError('No authentication token'); setLoading(false); }
  }, [token, loadData]);

  // Load open periods when client changes
  useEffect(() => {
    if (!activeClientId || !token) { setPeriods([]); setActivePeriodId(''); return; }
    setPeriodsLoading(true);
    fetch(`/api/portal/periods?token=${token}&clientId=${activeClientId}`)
      .then(r => r.ok ? r.json() : { periods: [] })
      .then(data => {
        const p = data.periods || [];
        setPeriods(p);
        if (p.length === 1) setActivePeriodId(p[0].id);
        else setActivePeriodId('');
      })
      .catch(() => setPeriods([]))
      .finally(() => setPeriodsLoading(false));
  }, [activeClientId, token]);

  // Load outstanding counts per client for red dots
  useEffect(() => {
    if (clients.length === 0) return;
    async function loadCounts() {
      const counts: Record<string, number> = {};
      for (const c of clients) {
        try {
          const res = await fetch(`/api/portal/requests?clientId=${c.id}&status=outstanding`);
          if (res.ok) {
            const data = await res.json();
            counts[c.id] = (data.requests || []).length;
          }
        } catch {}
      }
      setClientOutstandingCounts(counts);
    }
    loadCounts();
  }, [clients]);

  // Load per-tab status counts
  useEffect(() => {
    if (!activeClientId || !activePeriodId) { setTabCounts({}); return; }
    const engId = periods.find(p => p.id === activePeriodId)?.engagementId || '';
    if (!engId) return;
    async function loadTabCounts() {
      try {
        const res = await fetch(`/api/portal/requests?clientId=${activeClientId}&status=all&engagementId=${engId}`);
        if (!res.ok) return;
        const data = await res.json();
        const allReqs = data.requests || [];

        // Map section to tab key
        const sectionToTab: Record<string, string> = {
          questions: 'outstanding',
          explanations: 'explanations',
          evidence: 'evidence',
          connections: 'outstanding',
          calculations: 'outstanding',
        };

        const counts: Record<string, { outstanding: number; unaccepted: number; verified: number }> = {};
        for (const tab of AUDIT_SUB_TABS) {
          counts[tab.key] = { outstanding: 0, unaccepted: 0, verified: 0 };
        }

        for (const req of allReqs) {
          const tabKey = sectionToTab[req.section] || 'outstanding';
          if (!counts[tabKey]) counts[tabKey] = { outstanding: 0, unaccepted: 0, verified: 0 };
          if (req.status === 'outstanding') {
            counts[tabKey].outstanding++;
          } else if (req.status === 'responded' || req.status === 'verified') {
            counts[tabKey].unaccepted++;
          } else if (req.status === 'committed') {
            counts[tabKey].verified++;
          }
        }

        setTabCounts(counts);
      } catch {}
    }
    loadTabCounts();
  }, [activeClientId, activePeriodId, periods, outstandingCount, explanationsCount, unacceptedCount]);

  // Get engagement ID for selected period
  const activeEngagementId = useMemo(() => {
    if (!activePeriodId) return '';
    const period = periods.find(p => p.id === activePeriodId);
    return period?.engagementId || '';
  }, [activePeriodId, periods]);

  // Filter requests by active client and period/engagement
  const filteredRequests = useMemo(() => {
    let filtered = requests;
    if (activeClientId) filtered = filtered.filter(r => r.clientId === activeClientId);
    if (activeEngagementId) {
      filtered = filtered.filter(r => {
        const engId = (r as any).run?.engagement?.id || (r as any).engagementId;
        return !engId || engId === activeEngagementId;
      });
    }
    return filtered;
  }, [requests, activeClientId, activeEngagementId]);

  // Upload handler
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
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    }
    setUploadingKey(null);
  };

  const handleDotClick = (req: EvidenceRequest, colKey: string, colLabel: string) => {
    const status = getStatusForColumn(req, colKey);
    if (status === 'green') return;
    if (CONFIRMATION_TYPES.has(colKey)) {
      setConfirmPopup({ requestId: req.id, evidenceType: colKey, label: colLabel });
      setConfirmMode('email');
      setConfirmContact(req.contact || '');
      setConfirmEmail('');
      setConfirmAddress({ line1: '', line2: '', city: '', postcode: '', country: '' });
      return;
    }
    setPendingUpload({ requestId: req.id, evidenceType: colKey });
    setTimeout(() => fileInputRef.current?.click(), 50);
  };

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
      await loadData();
      setConfirmPopup(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submission failed');
    }
    setConfirmSending(false);
  };

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 text-blue-500 animate-spin" /></div>;
  if (error && requests.length === 0) return <div className="text-center py-20"><AlertCircle className="h-10 w-10 text-red-400 mx-auto mb-3" /><p className="text-sm text-red-600">{error}</p></div>;

  return (
    <div className="space-y-4">
      {/* Hidden file input */}
      <input ref={fileInputRef} type="file" className="hidden" onChange={e => {
        const file = e.target.files?.[0];
        if (file && pendingUpload) {
          handleUpload(pendingUpload.requestId, pendingUpload.evidenceType, file);
          setPendingUpload(null);
        }
        e.target.value = '';
      }} />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href={`/portal/dashboard?token=${token}`} className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1">
            <ArrowLeft className="h-3 w-3" /> Home
          </Link>
          <h1 className="text-xl font-bold text-slate-900">Audit Client Support</h1>
        </div>
      </div>

      {/* Client + Period selector */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-slate-600">Client:</label>
          <select
            value={activeClientId}
            onChange={(e) => setActiveClientId(e.target.value)}
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white min-w-[250px] focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Select a client...</option>
            {clients.map(client => (
              <option key={client.id} value={client.id}>{client.clientName}</option>
            ))}
          </select>
        </div>
        {activeClientId && (
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-slate-600">Period:</label>
            {outstandingCount > 0 && (
              <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[9px] font-bold">
                {outstandingCount}
              </span>
            )}
            <select
              value={activePeriodId}
              onChange={(e) => setActivePeriodId(e.target.value)}
              disabled={periodsLoading || periods.length === 0}
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white min-w-[220px] focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
            >
              <option value="">
                {periodsLoading ? 'Loading...' : periods.length === 0 ? 'No open periods' : 'Select period...'}
              </option>
              {periods.map(p => (
                <option key={p.id} value={p.id}>
                  {new Date(p.startDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                  {' \u2013 '}
                  {new Date(p.endDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* No client/period selected */}
      {(!activeClientId || !activePeriodId) && (
        <div className="text-center py-16">
          <p className="text-sm text-slate-500">
            {!activeClientId ? 'Please select a client' : 'Please select a period'} from the dropdown{!activeClientId ? 's' : ''} above to view audit details.
          </p>
        </div>
      )}

      {/* View mode toggle: My Items / Team View */}
      {activeClientId && activePeriodId && (
        <div className="flex items-center justify-between">
          <div className="flex bg-blue-100 rounded-lg p-0.5">
            <button onClick={() => setViewMode('my')} className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${viewMode === 'my' ? 'bg-white text-blue-900 shadow-sm' : 'text-blue-600'}`}>
              My Items
            </button>
            <button onClick={() => setViewMode('team')} className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${viewMode === 'team' ? 'bg-white text-blue-900 shadow-sm' : 'text-blue-600'}`}>
              Team View
            </button>
          </div>
          {viewMode === 'my' && portalUserName && (
            <span className="text-[10px] text-slate-400">Showing items assigned to or created by {portalUserName}</span>
          )}
        </div>
      )}

      {/* Sub-tabs — only show when client selected */}
      {activeClientId && activePeriodId && <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
        {AUDIT_SUB_TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveSubTab(tab.key)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5 ${
              activeSubTab === tab.key
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {tab.label}
            {/* Per-tab status dots */}
            {(() => {
              const tc = tabCounts[tab.key];
              if (!tc) return null;
              return (
                <span className="inline-flex items-center gap-0.5">
                  {tc.outstanding > 0 && (
                    <span className="inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[8px] font-bold" title="Outstanding">
                      {tc.outstanding}
                    </span>
                  )}
                  {tc.unaccepted > 0 && (
                    <span className="inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-orange-400 text-white text-[8px] font-bold" title="Responded, not verified">
                      {tc.unaccepted}
                    </span>
                  )}
                  {tc.verified > 0 && (
                    <span className="inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-green-500 text-white text-[8px] font-bold" title="Verified">
                      {tc.verified}
                    </span>
                  )}
                </span>
              );
            })()}
          </button>
        ))}
      </div>}

      {/* Sub-tab content — only when client AND period selected */}
      {activeSubTab === 'evidence' && activeClientId && activePeriodId && (
        <div className="space-y-4">
          {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}

          <div className="flex justify-end">
            <button onClick={() => setShowBulkUpload(true)} className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700">
              <Upload className="h-3.5 w-3.5" /> Bulk Upload
            </button>
          </div>

          {/* Evidence table */}
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
                  {filteredRequests.map(req => (
                    <tr key={req.id}>
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
                                title={status === 'red' ? `Click to upload ${col.label}` : status === 'orange' ? `Pending verification` : `Verified`}
                                className={`w-3.5 h-3.5 rounded-full mx-auto block transition-all ${DOT_STYLES[status]}`}
                              />
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  {filteredRequests.length === 0 && (
                    <tr><td colSpan={11} className="px-4 py-8 text-center text-slate-400 text-sm">No evidence requests for this client.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex items-center gap-4 text-[10px] text-slate-500">
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-red-600" />Click to upload</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-amber-300" />Uploaded (pending)</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-green-500" />Verified</span>
          </div>
        </div>
      )}

      {activeSubTab === 'outstanding' && activeClientId && activePeriodId && (
        <OutstandingTab clientId={activeClientId} token={token} engagementId={activeEngagementId} onCountChange={setOutstandingCount} viewMode={viewMode} portalUserName={portalUserName} />
      )}

      {activeSubTab === 'explanations' && activeClientId && activePeriodId && (
        <ExplanationsTab clientId={activeClientId} token={token} engagementId={activeEngagementId} viewMode={viewMode} portalUserName={portalUserName} />
      )}

      {activeSubTab === 'responded' && activeClientId && activePeriodId && (
        <RespondedTab clientId={activeClientId} token={token} engagementId={activeEngagementId} onUnacceptedCount={setUnacceptedCount} />
      )}

      {activeSubTab === 'concerns' && activeClientId && activePeriodId && (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
          <h3 className="text-sm font-semibold text-slate-700 mb-2">Concerns</h3>
          <p className="text-xs text-slate-400">Going concern assessments, risk flags, and areas of concern identified during the audit.</p>
          <p className="text-xs text-slate-300 mt-4 italic">Coming soon</p>
        </div>
      )}

      {activeSubTab === 'confirmations' && activeClientId && activePeriodId && (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
          <h3 className="text-sm font-semibold text-slate-700 mb-2">Confirmations</h3>
          <p className="text-xs text-slate-400">Third-party confirmation requests and responses — banks, debtors, suppliers, legal.</p>
          <p className="text-xs text-slate-300 mt-4 italic">Coming soon</p>
        </div>
      )}

      {activeSubTab === 'errors' && activeClientId && activePeriodId && (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
          <h3 className="text-sm font-semibold text-slate-700 mb-2">Errors Identified</h3>
          <p className="text-xs text-slate-400">Misstatements, errors, and adjustments identified during the audit process.</p>
          <p className="text-xs text-slate-300 mt-4 italic">Coming soon</p>
        </div>
      )}

      {/* Confirmation popup + Bulk upload modals omitted for brevity — same as original */}
      {confirmPopup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">{confirmPopup.label} Request</h3>
              <button onClick={() => setConfirmPopup(null)} className="text-slate-400 hover:text-slate-600"><X className="h-5 w-5" /></button>
            </div>
            <div className="px-5 py-4 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Contact Name</label>
                <input type="text" value={confirmContact} onChange={e => setConfirmContact(e.target.value)} className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="flex gap-1 bg-slate-100 rounded-lg p-0.5">
                <button onClick={() => setConfirmMode('email')} className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md ${confirmMode === 'email' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}><Mail className="h-3 w-3" /> Email</button>
                <button onClick={() => setConfirmMode('postal')} className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md ${confirmMode === 'postal' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}><MapPin className="h-3 w-3" /> Postal</button>
              </div>
              {confirmMode === 'email' ? (
                <input type="email" value={confirmEmail} onChange={e => setConfirmEmail(e.target.value)} placeholder="email@example.com" className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
              ) : (
                <div className="space-y-2">
                  <input type="text" value={confirmAddress.line1} onChange={e => setConfirmAddress(p => ({...p, line1: e.target.value}))} placeholder="Address Line 1" className="w-full px-3 py-1.5 text-sm border rounded-lg" />
                  <input type="text" value={confirmAddress.line2} onChange={e => setConfirmAddress(p => ({...p, line2: e.target.value}))} placeholder="Address Line 2" className="w-full px-3 py-1.5 text-sm border rounded-lg" />
                  <div className="grid grid-cols-2 gap-2">
                    <input type="text" value={confirmAddress.city} onChange={e => setConfirmAddress(p => ({...p, city: e.target.value}))} placeholder="City" className="px-3 py-1.5 text-sm border rounded-lg" />
                    <input type="text" value={confirmAddress.postcode} onChange={e => setConfirmAddress(p => ({...p, postcode: e.target.value}))} placeholder="Postcode" className="px-3 py-1.5 text-sm border rounded-lg" />
                  </div>
                </div>
              )}
            </div>
            <div className="px-5 py-3 border-t border-slate-100 flex justify-end gap-2">
              <button onClick={() => setConfirmPopup(null)} className="px-4 py-1.5 text-xs font-medium text-slate-600 bg-slate-100 rounded-md hover:bg-slate-200">Cancel</button>
              <button onClick={handleSubmitConfirmation} disabled={confirmSending || !confirmContact} className="px-4 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-40">
                {confirmSending ? <Loader2 className="h-3 w-3 animate-spin inline mr-1" /> : null}Submit
              </button>
            </div>
          </div>
        </div>
      )}

      {showBulkUpload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[80vh] flex flex-col">
            <div className="px-5 py-4 border-b flex items-center justify-between">
              <h3 className="text-sm font-semibold">Bulk Upload</h3>
              <button onClick={() => { setShowBulkUpload(false); setBulkFiles([]); }}><X className="h-5 w-5 text-slate-400" /></button>
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
              {bulkFiles.map((bf, i) => (
                <div key={i} className="flex items-center gap-2 p-2 border rounded-lg">
                  <FileText className="h-4 w-4 text-slate-400" />
                  <span className="text-xs truncate flex-1">{bf.file.name}</span>
                  <select value={bf.mappedRequestId} onChange={e => setBulkFiles(prev => prev.map((f, j) => j === i ? { ...f, mappedRequestId: e.target.value } : f))} className="text-xs border rounded px-2 py-1 w-48">
                    <option value="">— Map to request —</option>
                    {filteredRequests.map(r => <option key={r.id} value={r.id}>{r.description?.slice(0, 40)}</option>)}
                  </select>
                  <button onClick={() => setBulkFiles(prev => prev.filter((_, j) => j !== i))}><X className="h-3.5 w-3.5 text-red-400" /></button>
                </div>
              ))}
            </div>
            <div className="px-5 py-3 border-t flex justify-end gap-2">
              <button onClick={() => { setShowBulkUpload(false); setBulkFiles([]); }} className="px-4 py-1.5 text-xs bg-slate-100 rounded-md">Cancel</button>
              <button
                onClick={async () => {
                  for (const bf of bulkFiles) {
                    if (!bf.mappedRequestId) continue;
                    const req = filteredRequests.find(r => r.id === bf.mappedRequestId);
                    if (!req) continue;
                    const neededType = EVIDENCE_COLUMNS.find(col => getStatusForColumn(req, col.key) === 'red');
                    if (neededType) await handleUpload(bf.mappedRequestId, neededType.key, bf.file);
                  }
                  setShowBulkUpload(false); setBulkFiles([]);
                }}
                disabled={bulkFiles.length === 0 || bulkFiles.some(f => !f.mappedRequestId)}
                className="px-4 py-1.5 text-xs bg-blue-600 text-white rounded-md disabled:opacity-40"
              >Upload</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
