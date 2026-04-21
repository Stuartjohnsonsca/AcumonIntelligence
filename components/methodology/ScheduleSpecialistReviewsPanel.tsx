'use client';

import { useEffect, useRef, useState } from 'react';
import { Send, CheckCircle2, XCircle, Clock, Loader2, UserCheck, X, ChevronDown } from 'lucide-react';
import { useSignOff } from './SignOffHeader';

/**
 * Compact specialist-review control shown in the schedule's sticky
 * header, roughly level with the sign-off (green) dots. Replaces the
 * old bottom-of-schedule panel so auditors can see and trigger
 * specialist reviews without scrolling.
 *
 * The control is a button displaying review count + overall status:
 *   - No reviews yet          → "Specialist Reviews"
 *   - 1 pending               → amber pill "Specialist Reviews · 1 pending"
 *   - 2 accepted, 1 pending   → mixed-state pill showing counts
 *   - rejections present      → red pill (rejections trump everything)
 *
 * Clicking opens a popover below the button containing:
 *   - "Send for specialist review" button (only when Reviewer sign-off
 *     exists on this schedule AND at least one role is configured)
 *   - Full history list, newest first, with timestamps + comments.
 *
 * The popover closes on outside-click / Escape. The send modal
 * opens in a fixed overlay independent of the popover so the user
 * can see both if they want.
 *
 * Hidden entirely when:
 *   - No reviews exist AND
 *   - Reviewer sign-off is absent (nothing to do, nothing to show).
 */

interface Review {
  id: string;
  scheduleKey: string;
  role: string;
  assigneeName: string;
  assigneeEmail: string;
  status: 'pending' | 'accepted' | 'rejected';
  comments: string | null;
  sentByName: string | null;
  sentAt: string;
  decidedAt: string | null;
}

interface SpecialistRole {
  key: string;
  label: string;
  name: string;
  email: string;
  isActive: boolean;
}

export function ScheduleSpecialistReviewsPanel({ engagementId, scheduleKey }: { engagementId: string; scheduleKey: string }) {
  const { signOffs } = useSignOff();
  const reviewerSigned = !!signOffs.reviewer;

  const [reviews, setReviews] = useState<Review[]>([]);
  const [roles, setRoles] = useState<SpecialistRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [pickedRole, setPickedRole] = useState<string>('');
  const [customMessage, setCustomMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [revRes, rolesRes] = await Promise.all([
        fetch(`/api/engagements/${engagementId}/schedule-reviews?scheduleKey=${encodeURIComponent(scheduleKey)}`),
        fetch('/api/methodology-admin/specialist-roles'),
      ]);
      if (revRes.ok) {
        const data = await revRes.json();
        setReviews(Array.isArray(data.reviews) ? data.reviews : []);
      }
      if (rolesRes.ok) {
        const data = await rolesRes.json();
        setRoles(Array.isArray(data.roles) ? data.roles.filter((r: any) => r.isActive !== false) : []);
      }
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [engagementId, scheduleKey]);

  // Close popover on outside click / Escape. Modal lives outside the
  // popover (in a <Portal>-style fixed overlay) so clicks inside the
  // modal don't register as outside — we check !popoverRef.contains
  // AND that the click wasn't inside any [data-specialist-modal].
  useEffect(() => {
    if (!popoverOpen) return;
    function handleClick(e: MouseEvent) {
      const target = e.target as Node | null;
      if (!target) return;
      if (popoverRef.current?.contains(target)) return;
      const modal = document.querySelector('[data-specialist-modal]');
      if (modal?.contains(target)) return;
      setPopoverOpen(false);
    }
    function handleKey(e: KeyboardEvent) { if (e.key === 'Escape' && !modalOpen) setPopoverOpen(false); }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [popoverOpen, modalOpen]);

  async function handleSend() {
    if (!pickedRole) return;
    setSending(true);
    setSendError(null);
    try {
      const res = await fetch(`/api/engagements/${engagementId}/schedule-reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduleKey, role: pickedRole, customMessage }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSendError(data.error || `Send failed (${res.status})`);
      } else {
        setModalOpen(false);
        setPickedRole('');
        setCustomMessage('');
        await load();
      }
    } catch (err: any) {
      setSendError(err?.message || 'Send failed');
    } finally {
      setSending(false);
    }
  }

  const roleLabel = (key: string) => roles.find(r => r.key === key)?.label || key.replace(/_/g, ' ');

  // ── Overall status for the header pill ─────────────────────────────
  // Rejections dominate (auditor needs to notice them); then pending
  // (action required); then accepted (happy path). When there's a mix,
  // the pill colour reflects the most-severe status, with counts shown
  // alongside. Kept to one line so it fits next to the sign-off dots.
  const counts = {
    accepted: reviews.filter(r => r.status === 'accepted').length,
    rejected: reviews.filter(r => r.status === 'rejected').length,
    pending: reviews.filter(r => r.status === 'pending').length,
  };
  const hasAny = reviews.length > 0;
  const pillTone = counts.rejected > 0
    ? 'bg-red-50 border-red-300 text-red-700 hover:bg-red-100'
    : counts.pending > 0
      ? 'bg-amber-50 border-amber-300 text-amber-700 hover:bg-amber-100'
      : counts.accepted > 0
        ? 'bg-green-50 border-green-300 text-green-700 hover:bg-green-100'
        : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50';
  const pillIcon = counts.rejected > 0
    ? <XCircle className="h-3.5 w-3.5" />
    : counts.pending > 0
      ? <Clock className="h-3.5 w-3.5" />
      : counts.accepted > 0
        ? <CheckCircle2 className="h-3.5 w-3.5" />
        : <UserCheck className="h-3.5 w-3.5 text-indigo-500" />;
  const pillText = !hasAny
    ? 'Specialist Reviews'
    : `Specialists · ${[
        counts.accepted && `${counts.accepted} ✓`,
        counts.pending && `${counts.pending} ⏳`,
        counts.rejected && `${counts.rejected} ✗`,
      ].filter(Boolean).join('  ')}`;

  // Hide entirely when there's nothing to do AND nothing to show.
  // Matches the old behaviour so quiet schedules stay quiet.
  if (loading) return null;
  if (!hasAny && !reviewerSigned) return null;

  return (
    <div ref={popoverRef} className="relative">
      <button
        type="button"
        onClick={() => setPopoverOpen(o => !o)}
        className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${pillTone}`}
        title="Specialist reviews for this schedule"
      >
        {pillIcon}
        <span>{pillText}</span>
        <ChevronDown className={`h-3 w-3 transition-transform ${popoverOpen ? 'rotate-180' : ''}`} />
      </button>

      {popoverOpen && (
        <div
          className="absolute right-0 top-full mt-2 w-[420px] max-w-[90vw] bg-white border border-slate-200 rounded-lg shadow-lg z-20"
          // Stop click-propagation so the outside-click handler above
          // doesn't immediately fire from a click inside the panel.
          onMouseDown={e => e.stopPropagation()}
        >
          <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between">
            <h4 className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
              <UserCheck className="h-3.5 w-3.5 text-indigo-500" /> Specialist Reviews
            </h4>
            {reviewerSigned && roles.length > 0 && (
              <button
                onClick={() => { setModalOpen(true); setSendError(null); }}
                className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1 bg-indigo-600 text-white rounded hover:bg-indigo-700 font-medium"
              >
                <Send className="h-3 w-3" /> Send
              </button>
            )}
          </div>

          <div className="max-h-[50vh] overflow-y-auto p-3 space-y-2">
            {!reviewerSigned && !hasAny && (
              <p className="text-[11px] text-slate-400 italic px-1 py-2">
                Reviewer sign-off required before a specialist can be asked to review.
              </p>
            )}
            {reviewerSigned && !hasAny && (
              <p className="text-[11px] text-slate-500 px-1 py-2">
                No specialist reviews requested yet. Click <strong>Send</strong> to refer this schedule.
              </p>
            )}
            {reviews.map(r => (
              <div
                key={r.id}
                className={`border rounded-md p-2.5 ${
                  r.status === 'accepted' ? 'border-green-200 bg-green-50/50'
                  : r.status === 'rejected' ? 'border-red-200 bg-red-50/50'
                  : 'border-amber-200 bg-amber-50/30'
                }`}
              >
                <div className="flex items-start gap-2">
                  {r.status === 'accepted' ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600 flex-shrink-0 mt-0.5" />
                    : r.status === 'rejected' ? <XCircle className="h-3.5 w-3.5 text-red-600 flex-shrink-0 mt-0.5" />
                    : <Clock className="h-3.5 w-3.5 text-amber-500 flex-shrink-0 mt-0.5" />}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-xs font-semibold text-slate-800">{roleLabel(r.role)}</span>
                      <span className="text-[11px] text-slate-600">{r.assigneeName}</span>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium uppercase tracking-wide ${
                        r.status === 'accepted' ? 'bg-green-100 text-green-700'
                        : r.status === 'rejected' ? 'bg-red-100 text-red-700'
                        : 'bg-amber-100 text-amber-700'
                      }`}>{r.status}</span>
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5">
                      Sent by {r.sentByName || '—'} on {new Date(r.sentAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}
                      {r.decidedAt && <> · Decided {new Date(r.decidedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</>}
                    </div>
                    {r.comments && (
                      <div className="mt-1.5 text-[11px] text-slate-700 whitespace-pre-wrap leading-relaxed bg-white border border-slate-200 rounded px-2 py-1.5">
                        {r.comments}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Send modal ─────────────────────────────────────────────── */}
      {modalOpen && (
        <div
          data-specialist-modal
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4"
          onClick={() => !sending && setModalOpen(false)}
        >
          <div className="bg-white rounded-lg shadow-xl w-full max-w-lg" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-3 border-b flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
                <Send className="h-4 w-4 text-indigo-600" /> Send for specialist review
              </h3>
              <button onClick={() => setModalOpen(false)} disabled={sending} className="text-slate-400 hover:text-slate-600">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">Specialist role</label>
                <select
                  value={pickedRole}
                  onChange={e => setPickedRole(e.target.value)}
                  className="w-full text-sm border border-slate-200 rounded px-2 py-1.5"
                >
                  <option value="">— Pick a role —</option>
                  {roles.map(r => (
                    <option key={r.key} value={r.key}>
                      {r.label}{r.name ? ` — ${r.name}` : ''}{r.email ? ` <${r.email}>` : ''}
                    </option>
                  ))}
                </select>
                {pickedRole && roles.find(r => r.key === pickedRole)?.email === '' && (
                  <p className="text-[10px] text-amber-600 mt-1">No email configured for this role — ask the Methodology Admin to set it in Specialist Roles.</p>
                )}
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">Optional message to the specialist</label>
                <textarea
                  value={customMessage}
                  onChange={e => setCustomMessage(e.target.value)}
                  rows={3}
                  className="w-full text-sm border border-slate-200 rounded px-2 py-1.5"
                  placeholder="Any specific points you'd like them to look at…"
                />
              </div>
              {sendError && (
                <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">{sendError}</div>
              )}
            </div>
            <div className="px-5 py-3 border-t flex justify-end gap-2">
              <button onClick={() => setModalOpen(false)} disabled={sending}
                className="text-sm px-3 py-1.5 text-slate-600 hover:text-slate-800">Cancel</button>
              <button onClick={handleSend} disabled={sending || !pickedRole}
                className="inline-flex items-center gap-1.5 text-sm px-4 py-1.5 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50 font-medium">
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
