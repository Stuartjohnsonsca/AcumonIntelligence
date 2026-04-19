'use client';

import { useEffect, useState } from 'react';
import { Loader2, CheckCircle2, XCircle, AlertTriangle, ShieldCheck } from 'lucide-react';

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

interface Engagement {
  id: string;
  firmName: string;
  clientName: string;
  periodStart: string | null;
  periodEnd: string | null;
}

export function SpecialistReviewClient({ token }: { token: string }) {
  const [review, setReview] = useState<Review | null>(null);
  const [engagement, setEngagement] = useState<Engagement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Local draft state for the form
  const [comments, setComments] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<'accepted' | 'rejected' | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/schedule-reviews/${token}`);
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || `Failed to load review (${res.status})`);
        } else {
          setReview(data.review);
          setEngagement(data.engagement);
          setComments(data.review?.comments || '');
          if (data.review?.status && data.review.status !== 'pending') {
            setSubmitted(data.review.status);
          }
        }
      } catch (err: any) {
        setError(err?.message || 'Network error');
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  async function submit(decision: 'accepted' | 'rejected') {
    if (!review) return;
    if (!confirm(`Are you sure you want to ${decision === 'accepted' ? 'ACCEPT' : 'REJECT'} this schedule? You can't change this decision once submitted.`)) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/schedule-reviews/${token}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: decision, comments }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || `Submit failed (${res.status})`);
      } else {
        setSubmitted(decision);
      }
    } catch (err: any) {
      setError(err?.message || 'Network error');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="bg-white rounded-lg border border-slate-200 p-12 text-center">
        <Loader2 className="h-6 w-6 text-blue-500 animate-spin mx-auto" />
        <p className="text-sm text-slate-500 mt-3">Loading review…</p>
      </div>
    );
  }
  if (error || !review) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
        <AlertTriangle className="h-6 w-6 text-red-500 mx-auto mb-2" />
        <p className="text-sm font-semibold text-red-800">{error || 'Review not found'}</p>
        <p className="text-xs text-red-600 mt-2">If you believe this is an error, please contact the auditor who sent you the link.</p>
      </div>
    );
  }

  const periodLabel = engagement?.periodEnd
    ? `Year ended ${new Date(engagement.periodEnd).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`
    : '';

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg border border-slate-200 p-6">
        <div className="flex items-center gap-2 mb-1">
          <ShieldCheck className="h-5 w-5 text-indigo-500" />
          <h1 className="text-lg font-bold text-slate-900">Specialist Review</h1>
        </div>
        <p className="text-xs text-slate-500 mb-4">{engagement?.firmName}</p>
        <div className="grid grid-cols-2 gap-3 text-sm mb-4">
          <div>
            <span className="text-[10px] text-slate-500 uppercase tracking-wide block">Client</span>
            <span className="text-slate-800 font-medium">{engagement?.clientName || '—'}</span>
          </div>
          <div>
            <span className="text-[10px] text-slate-500 uppercase tracking-wide block">Period</span>
            <span className="text-slate-700">{periodLabel || '—'}</span>
          </div>
          <div>
            <span className="text-[10px] text-slate-500 uppercase tracking-wide block">Schedule</span>
            <span className="text-slate-700 font-mono text-xs">{review.scheduleKey}</span>
          </div>
          <div>
            <span className="text-[10px] text-slate-500 uppercase tracking-wide block">Your role</span>
            <span className="text-slate-700 capitalize">{review.role.replace(/_/g, ' ')}</span>
          </div>
          <div>
            <span className="text-[10px] text-slate-500 uppercase tracking-wide block">Requested by</span>
            <span className="text-slate-700">{review.sentByName || '—'}</span>
          </div>
          <div>
            <span className="text-[10px] text-slate-500 uppercase tracking-wide block">Sent</span>
            <span className="text-slate-700">{new Date(review.sentAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</span>
          </div>
        </div>

        <p className="text-xs text-slate-600 leading-relaxed">
          You&rsquo;ve been asked to review the schedule above on this engagement. Use the comments box below to
          record your feedback, then choose <strong>Accept</strong> or <strong>Reject</strong>. Your decision
          will appear at the bottom of the schedule in the audit team&rsquo;s workspace. Once submitted, the
          decision cannot be changed &mdash; ask the auditor to send a fresh link if you need a rethink.
        </p>
      </div>

      {submitted ? (
        <div className={`rounded-lg border-2 p-6 text-center ${submitted === 'accepted' ? 'bg-green-50 border-green-300' : 'bg-red-50 border-red-300'}`}>
          {submitted === 'accepted'
            ? <CheckCircle2 className="h-10 w-10 text-green-500 mx-auto mb-2" />
            : <XCircle className="h-10 w-10 text-red-500 mx-auto mb-2" />}
          <p className={`text-lg font-bold ${submitted === 'accepted' ? 'text-green-800' : 'text-red-800'}`}>
            {submitted === 'accepted' ? 'Schedule Accepted' : 'Schedule Rejected'}
          </p>
          <p className="text-xs text-slate-600 mt-2">
            Your decision has been recorded. You can close this page.
          </p>
          {comments && (
            <div className="mt-4 text-left text-xs bg-white border border-slate-200 rounded p-3 whitespace-pre-wrap">
              <span className="block text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-1">Your comments</span>
              {comments}
            </div>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-slate-200 p-6">
          <label className="block text-xs font-semibold text-slate-700 mb-1.5">Comments</label>
          <textarea
            value={comments}
            onChange={e => setComments(e.target.value)}
            rows={6}
            className="w-full text-sm border border-slate-200 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
            placeholder="Optional — record any reasoning, required changes, or conditions of acceptance."
          />
          {error && (
            <div className="mt-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">{error}</div>
          )}
          <div className="mt-4 flex gap-2 justify-end">
            <button
              onClick={() => submit('rejected')}
              disabled={submitting}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />} Reject
            </button>
            <button
              onClick={() => submit('accepted')}
              disabled={submitting}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Accept
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
