'use client';

import { useEffect, useState } from 'react';
import { UserCheck, Loader2, X, Paperclip, AlertOctagon, ListChecks, FileWarning, Check } from 'lucide-react';

/**
 * Engagement-level Specialist Requests hub.
 *
 * Sits next to the RI Matters button. Aggregates every specialist
 * review request for the engagement (across all schedules), shows red
 * (unactioned) / green (actioned) count dots, and opens a modal that
 * lists each request + the specialist's response + any attachments,
 * with three spawn buttons per row:
 *
 *   • Create RI Matter   — POST audit-points (pointType='ri_matter')
 *   • Create Review Point — POST audit-points (pointType='review_point')
 *   • Create Error       — POST error-schedule (asks for amount + FS line)
 *
 * Spawning marks the request "actioned" so the dot turns from red to
 * green and the auditor knows the response has been dealt with.
 */

interface Attachment {
  fileName?: string;
  storagePath?: string;
  fileSize?: number;
  mimeType?: string;
  uploadedAt?: string;
}

interface SpecialistRequest {
  id: string;
  scheduleKey: string;
  role: string;
  assigneeName: string;
  assigneeEmail: string;
  status: 'pending' | 'accepted' | 'rejected' | string;
  comments: string | null;
  attachments: Attachment[];
  sentByName: string | null;
  sentAt: string;
  decidedAt: string | null;
  actioned: boolean;
  actionedAt: string | null;
  actionedByName: string | null;
}

interface Counts {
  outstanding: number;
  closed: number;
  pending: number;
  total: number;
}

interface Props {
  engagementId: string;
  /** Notify EngagementTabs when counts change so it can refresh other
   *  side panels (audit-points etc.) if needed. Optional. */
  onCountsChange?: (counts: Counts) => void;
}

export function SpecialistRequestsPanel({ engagementId, onCountsChange }: Props) {
  const [open, setOpen] = useState(false);
  const [requests, setRequests] = useState<SpecialistRequest[] | null>(null);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch counts on mount + every time the modal closes — keeps the
  // dots up to date without polling.
  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engagementId]);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/engagements/${engagementId}/specialist-requests`);
      if (res.ok) {
        const data = await res.json();
        setRequests(data.requests || []);
        setCounts(data.counts);
        onCountsChange?.(data.counts);
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data?.error || `Failed (${res.status})`);
      }
    } catch (err: any) {
      setError(err?.message || 'Failed');
    } finally {
      setLoading(false);
    }
  }

  // Total count to show on the button — outstanding + pending + closed.
  // Hide the button entirely until at least one request has been sent
  // so engagements without specialists stay clean.
  const total = counts?.total ?? 0;
  if (total === 0 && !loading) return null;

  return (
    <>
      <button
        onClick={() => { setOpen(true); refresh(); }}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-medium bg-violet-50 text-violet-700 border border-violet-200 rounded hover:bg-violet-100 transition-colors"
        title="Specialist review requests + responses"
      >
        <UserCheck className="h-3 w-3" />
        Specialist
        {/* Red = unactioned responses (outstanding) — needs the auditor's
            attention. Green = actioned (a follow-up has been spawned).
            Pending (still awaiting the specialist's decision) gets an
            amber dot so it's visually distinct from the
            "responded but not yet acted on" state. */}
        {counts && counts.outstanding > 0 && (
          <span className="inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded-full bg-red-600 text-white text-[9px] font-bold leading-none">
            {counts.outstanding}
          </span>
        )}
        {counts && counts.pending > 0 && (
          <span className="inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded-full bg-amber-500 text-white text-[9px] font-bold leading-none" title="Pending — awaiting specialist decision">
            {counts.pending}
          </span>
        )}
        {counts && counts.closed > 0 && (
          <span className="inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded-full bg-green-600 text-white text-[9px] font-bold leading-none">
            {counts.closed}
          </span>
        )}
      </button>

      {open && (
        <SpecialistRequestsModal
          engagementId={engagementId}
          requests={requests || []}
          loading={loading}
          error={error}
          onClose={() => setOpen(false)}
          onChanged={refresh}
        />
      )}
    </>
  );
}

interface ModalProps {
  engagementId: string;
  requests: SpecialistRequest[];
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onChanged: () => void;
}

function SpecialistRequestsModal({ engagementId, requests, loading, error, onClose, onChanged }: ModalProps) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errorState, setErrorState] = useState<string | null>(null);
  const [errorFormFor, setErrorFormFor] = useState<string | null>(null);
  const [errorAmount, setErrorAmount] = useState('');
  const [errorFsLine, setErrorFsLine] = useState('');
  const [errorDescription, setErrorDescription] = useState('');

  async function markActioned(reviewId: string) {
    await fetch(`/api/engagements/${engagementId}/specialist-requests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: reviewId }),
    });
  }

  function descriptionFor(req: SpecialistRequest, kind: 'ri_matter' | 'review_point' | 'error'): string {
    const decision = req.status === 'accepted' ? 'accepted' : req.status === 'rejected' ? 'rejected' : 'reviewed';
    const head = `From specialist review (${humaniseRole(req.role)}, ${humaniseSchedule(req.scheduleKey)}) — ${decision} by ${req.assigneeName}.`;
    const body = req.comments ? `\n\nSpecialist comments:\n${req.comments}` : '';
    if (kind === 'error') return `${req.assigneeName} flagged an error during specialist review of ${humaniseSchedule(req.scheduleKey)}.${body}`;
    return `${head}${body}`;
  }

  async function spawnAuditPoint(req: SpecialistRequest, pointType: 'ri_matter' | 'review_point') {
    setBusyId(req.id);
    setErrorState(null);
    try {
      const res = await fetch(`/api/engagements/${engagementId}/audit-points`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pointType,
          description: descriptionFor(req, pointType),
          reference: `specialist-review:${req.id}`,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setErrorState(data?.error || `Create failed (${res.status})`);
        return;
      }
      await markActioned(req.id);
      onChanged();
    } catch (err: any) {
      setErrorState(err?.message || 'Create failed');
    } finally {
      setBusyId(null);
    }
  }

  function openErrorForm(req: SpecialistRequest) {
    setErrorFormFor(req.id);
    setErrorAmount('');
    setErrorFsLine('');
    setErrorDescription(descriptionFor(req, 'error'));
    setErrorState(null);
  }

  async function spawnError(req: SpecialistRequest) {
    const amt = Number(errorAmount);
    if (!Number.isFinite(amt) || amt === 0) {
      setErrorState('Enter a non-zero error amount');
      return;
    }
    if (!errorFsLine.trim()) {
      setErrorState('FS line is required');
      return;
    }
    setBusyId(req.id);
    setErrorState(null);
    try {
      const res = await fetch(`/api/engagements/${engagementId}/error-schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fsLine: errorFsLine.trim(),
          description: errorDescription.trim() || `Specialist-flagged misstatement (${humaniseSchedule(req.scheduleKey)})`,
          errorAmount: amt,
          errorType: 'judgemental',
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setErrorState(data?.error || `Create failed (${res.status})`);
        return;
      }
      await markActioned(req.id);
      setErrorFormFor(null);
      onChanged();
    } catch (err: any) {
      setErrorState(err?.message || 'Create failed');
    } finally {
      setBusyId(null);
    }
  }

  // Sort: unactioned-with-decision first, then pending, then actioned.
  const sorted = [...requests].sort((a, b) => {
    const score = (r: SpecialistRequest) =>
      r.actioned ? 2 : r.status === 'pending' ? 1 : 0;
    return score(a) - score(b);
  });

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center" onClick={onClose}>
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[80vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <UserCheck className="h-4 w-4 text-violet-600" />
            Specialist Requests &amp; Responses
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {loading && (
            <p className="text-xs text-slate-400 italic flex items-center gap-1.5">
              <Loader2 className="h-3 w-3 animate-spin" /> Loading…
            </p>
          )}
          {error && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">{error}</div>
          )}
          {errorState && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">{errorState}</div>
          )}

          {sorted.length === 0 && !loading && (
            <p className="text-sm text-slate-500 italic">No specialist requests on this engagement yet.</p>
          )}

          {sorted.map(req => (
            <div
              key={req.id}
              className={`border rounded-lg overflow-hidden ${
                req.actioned
                  ? 'border-green-200 bg-green-50/40'
                  : req.status === 'pending'
                  ? 'border-amber-200 bg-amber-50/40'
                  : 'border-red-200 bg-red-50/40'
              }`}
            >
              <div className="px-3 py-2 border-b border-slate-200 bg-white/60 flex items-center gap-2 text-xs">
                <strong className="text-slate-800">{humaniseSchedule(req.scheduleKey)}</strong>
                <span className="text-slate-500">·</span>
                <span className="text-slate-700">{humaniseRole(req.role)}</span>
                <span className="text-slate-400">→</span>
                <span className="text-slate-700">{req.assigneeName}</span>
                <span className="flex-1" />
                <StatusPill status={req.status} actioned={req.actioned} />
              </div>

              <div className="px-3 py-2 text-xs space-y-2">
                <div className="text-[10px] text-slate-500">
                  Sent {new Date(req.sentAt).toLocaleString('en-GB')}
                  {req.sentByName ? <> by {req.sentByName}</> : null}
                  {req.decidedAt ? <> · Decided {new Date(req.decidedAt).toLocaleString('en-GB')}</> : null}
                </div>

                {req.status !== 'pending' && (
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-0.5">Response</div>
                    <p className="bg-white border border-slate-200 rounded p-2 whitespace-pre-wrap">
                      {req.comments && req.comments.trim() ? req.comments : <em className="text-slate-400">(no written comments)</em>}
                    </p>
                  </div>
                )}

                {req.attachments.length > 0 && (
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-0.5 flex items-center gap-1">
                      <Paperclip className="h-3 w-3" /> Attachments
                    </div>
                    <ul className="space-y-1">
                      {req.attachments.map((a, i) => (
                        <li key={i} className="flex items-center gap-2">
                          <a
                            href={`/api/engagements/${engagementId}/specialist-requests/${req.id}/attachments/${i}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-700 hover:text-blue-900 hover:underline truncate"
                            title={a.fileName}
                          >
                            {a.fileName || `Attachment ${i + 1}`}
                          </a>
                          {a.fileSize ? <span className="text-[10px] text-slate-400">{formatSize(a.fileSize)}</span> : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Action buttons — only meaningful when the specialist has responded */}
                {req.status !== 'pending' && (
                  <div className="flex items-center gap-1.5 pt-2 border-t border-slate-200">
                    <span className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold mr-1">
                      {req.actioned ? 'Already actioned' : 'Spawn:'}
                    </span>
                    <button
                      onClick={() => spawnAuditPoint(req, 'ri_matter')}
                      disabled={busyId === req.id || req.actioned}
                      className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
                    >
                      <AlertOctagon className="h-3 w-3" /> RI Matter
                    </button>
                    <button
                      onClick={() => spawnAuditPoint(req, 'review_point')}
                      disabled={busyId === req.id || req.actioned}
                      className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 bg-amber-600 text-white rounded hover:bg-amber-700 disabled:opacity-50"
                    >
                      <ListChecks className="h-3 w-3" /> Review Point
                    </button>
                    <button
                      onClick={() => openErrorForm(req)}
                      disabled={busyId === req.id || req.actioned}
                      className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 bg-orange-600 text-white rounded hover:bg-orange-700 disabled:opacity-50"
                    >
                      <FileWarning className="h-3 w-3" /> Error
                    </button>
                    {req.actioned && (
                      <span className="text-[10px] text-green-700 ml-1 flex items-center gap-0.5">
                        <Check className="h-3 w-3" />
                        {req.actionedByName ? `by ${req.actionedByName}` : ''}
                      </span>
                    )}
                  </div>
                )}

                {/* Error mini-form — slides in below the action buttons */}
                {errorFormFor === req.id && (
                  <div className="mt-2 p-2 bg-white border border-orange-200 rounded space-y-1.5">
                    <div className="text-[10px] uppercase tracking-wide text-orange-700 font-semibold">Create Error</div>
                    <div className="grid grid-cols-2 gap-1.5">
                      <input
                        type="text"
                        value={errorFsLine}
                        onChange={e => setErrorFsLine(e.target.value)}
                        placeholder="FS line (e.g. Revenue)"
                        className="text-xs border border-slate-300 rounded px-2 py-1"
                      />
                      <input
                        type="number"
                        value={errorAmount}
                        onChange={e => setErrorAmount(e.target.value)}
                        placeholder="Error amount (£)"
                        className="text-xs border border-slate-300 rounded px-2 py-1"
                      />
                    </div>
                    <textarea
                      value={errorDescription}
                      onChange={e => setErrorDescription(e.target.value)}
                      rows={2}
                      placeholder="Description"
                      className="w-full text-xs border border-slate-300 rounded px-2 py-1"
                    />
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        onClick={() => setErrorFormFor(null)}
                        className="text-[10px] px-2 py-1 bg-slate-100 text-slate-700 rounded hover:bg-slate-200"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => spawnError(req)}
                        disabled={busyId === req.id}
                        className="inline-flex items-center gap-1 text-[10px] px-2 py-1 bg-orange-600 text-white rounded hover:bg-orange-700 disabled:opacity-50"
                      >
                        {busyId === req.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileWarning className="h-3 w-3" />}
                        Create Error
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatusPill({ status, actioned }: { status: string; actioned: boolean }) {
  if (status === 'pending') {
    return <span className="text-[9px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 border border-amber-200">Pending</span>;
  }
  if (actioned) {
    return <span className="text-[9px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded bg-green-100 text-green-700 border border-green-200">Actioned</span>;
  }
  if (status === 'accepted') {
    return <span className="text-[9px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 border border-emerald-200">Accepted</span>;
  }
  if (status === 'rejected') {
    return <span className="text-[9px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded bg-red-100 text-red-700 border border-red-200">Rejected</span>;
  }
  return <span className="text-[9px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200">{status}</span>;
}

function humaniseSchedule(key: string): string {
  return key.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function humaniseRole(role: string): string {
  return role.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
