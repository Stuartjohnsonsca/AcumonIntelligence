'use client';

import { useEffect, useState } from 'react';
import { Send, CheckCircle2, XCircle, Clock, Loader2, UserCheck, X } from 'lucide-react';
import { useSignOff } from './SignOffHeader';

/**
 * Panel shown at the bottom of every schedule (inside
 * DynamicAppendixForm). Two halves:
 *
 *   1. "Send for specialist review" button + dropdown — appears ONLY
 *      when the Reviewer sign-off is set on this schedule. Clicking
 *      opens a tiny modal: pick a role, optional custom message,
 *      then Send. The server looks up the role's name + email from
 *      the firm's specialist_roles config, creates a review record
 *      with a fresh magic-link token, and emails the specialist.
 *
 *   2. Existing reviews list — every review request ever sent on
 *      this engagement's schedule, with status, comments, sender,
 *      and timestamps. Read-only to auditors (except the specialist
 *      themselves via the magic link).
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
  const [modalOpen, setModalOpen] = useState(false);
  const [pickedRole, setPickedRole] = useState<string>('');
  const [customMessage, setCustomMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

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

  // Only render anything if there are existing reviews to show OR the
  // auditor can send a new one. Keeps noise off schedules that don't
  // use this feature.
  if (loading) return null;
  if (reviews.length === 0 && !reviewerSigned) return null;

  return (
    <div className="mt-6 border-t-2 border-dashed border-slate-200 pt-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
          <UserCheck className="h-4 w-4 text-indigo-500" /> Specialist Reviews
        </h4>
        {reviewerSigned && roles.length > 0 && (
          <button
            onClick={() => { setModalOpen(true); setSendError(null); }}
            className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 bg-indigo-600 text-white rounded hover:bg-indigo-700 font-medium"
          >
            <Send className="h-3.5 w-3.5" /> Send for specialist review
          </button>
        )}
      </div>

      {!reviewerSigned && reviews.length === 0 && (
        <p className="text-xs text-slate-400 italic">Reviewer sign-off required before a specialist can be asked to review.</p>
      )}

      {reviews.length > 0 && (
        <div className="space-y-2">
          {reviews.map(r => (
            <div
              key={r.id}
              className={`border rounded-lg p-3 ${
                r.status === 'accepted' ? 'border-green-200 bg-green-50/50'
                : r.status === 'rejected' ? 'border-red-200 bg-red-50/50'
                : 'border-amber-200 bg-amber-50/30'
              }`}
            >
              <div className="flex items-start gap-2">
                {r.status === 'accepted' ? <CheckCircle2 className="h-4 w-4 text-green-600 flex-shrink-0 mt-0.5" />
                  : r.status === 'rejected' ? <XCircle className="h-4 w-4 text-red-600 flex-shrink-0 mt-0.5" />
                  : <Clock className="h-4 w-4 text-amber-500 flex-shrink-0 mt-0.5" />}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-slate-800">{roleLabel(r.role)}</span>
                    <span className="text-xs text-slate-600">{r.assigneeName}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium uppercase tracking-wide ${
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
                    <div className="mt-2 text-xs text-slate-700 whitespace-pre-wrap leading-relaxed bg-white border border-slate-200 rounded p-2">
                      {r.comments}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Send modal ─────────────────────────────────────────────── */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4" onClick={() => !sending && setModalOpen(false)}>
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
