'use client';

import { useEffect, useState } from 'react';
import { ShieldAlert, Loader2, AlertOctagon, CheckCircle2 } from 'lucide-react';

/**
 * Full-screen Independence gate.
 *
 * Sits between the engagement-phase header and <EngagementTabs/> — when
 * the server says the current user has an outstanding / declined
 * independence row for this engagement, this component takes over the
 * entire content area so the user cannot view or interact with anything
 * else.
 *
 * Children are only rendered once the user has confirmed their
 * independence. A declined state keeps them locked out permanently until
 * an admin intervenes.
 */

interface IndependenceQuestion {
  id: string;
  text: string;
  helpText?: string;
  answerType?: 'boolean' | 'text';
  requiresNotesOnNo?: boolean;
  hardFail?: boolean;
}

interface StatusResponse {
  status: 'outstanding' | 'confirmed' | 'declined';
  isIndependent: boolean | null;
  confirmedAt: string | null;
  required: boolean;
  started: boolean;
  questions: IndependenceQuestion[];
  isAdminViewer: boolean;
  isTeamMember: boolean;
}

interface Props {
  engagementId: string;
  children: React.ReactNode;
}

export function IndependenceGate({ engagementId, children }: Props) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<StatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, { answer: boolean | string; notes: string }>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/engagements/${engagementId}/independence`);
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          if (!cancelled) setError(d.error || `Failed (${res.status})`);
          return;
        }
        const d: StatusResponse = await res.json();
        if (!cancelled) setData(d);
      } catch (err: any) {
        if (!cancelled) setError(err?.message || 'Failed to load independence status');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [engagementId]);

  // Not gated — render children immediately.
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="max-w-xl mx-auto my-20 bg-red-50 border border-red-200 rounded-lg p-6 text-sm text-red-800">
        <strong>Could not load independence status:</strong> {error}
      </div>
    );
  }
  if (!data || !data.required) {
    return <>{children}</>;
  }

  // Declined path — user is locked out, not even the questionnaire is re-offered
  // because the decision has already been made and routed to the RI / Ethics Partner.
  if (data.status === 'declined') {
    return (
      <div className="max-w-2xl mx-auto my-16 bg-white border border-red-200 rounded-xl shadow-sm p-8">
        <div className="flex items-center gap-3 mb-4">
          <div className="h-12 w-12 rounded-full bg-red-100 flex items-center justify-center">
            <AlertOctagon className="h-6 w-6 text-red-600" />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-slate-900">Engagement access blocked — Independence declined</h2>
            <p className="text-sm text-slate-500 mt-1">You indicated you are not independent for this engagement.</p>
          </div>
        </div>
        <p className="text-sm text-slate-700 mb-3">
          The Responsible Individual and Ethics Partner have been notified and will review the circumstances.
          Until they resolve the matter you cannot view or interact with this engagement.
        </p>
        <p className="text-sm text-slate-600">
          If you believe this is a mistake, contact your RI or Ethics Partner directly — they can override the lockout.
        </p>
      </div>
    );
  }

  async function submit(forceDecline: boolean) {
    if (!data) return;
    setSubmitError(null);

    // Validate — every question must have an answer (either Yes/No for
    // boolean, or non-empty text for text). For any "No" on a question
    // that requires notes, notes must be supplied.
    const payload: Array<{ questionId: string; questionText: string; answer: boolean | string; notes?: string }> = [];
    if (!forceDecline) {
      for (const q of data.questions) {
        const a = answers[q.id];
        if (!a) { setSubmitError(`Please answer every question — missing: "${q.text}"`); return; }
        if (q.answerType === 'text') {
          if (typeof a.answer !== 'string' || !a.answer.trim()) { setSubmitError(`Please answer: "${q.text}"`); return; }
          payload.push({ questionId: q.id, questionText: q.text, answer: a.answer.trim(), notes: a.notes || undefined });
        } else {
          if (typeof a.answer !== 'boolean') { setSubmitError(`Please answer Yes or No: "${q.text}"`); return; }
          if (a.answer === false && q.requiresNotesOnNo && !(a.notes || '').trim()) {
            setSubmitError(`Please add notes for: "${q.text}"`); return;
          }
          payload.push({ questionId: q.id, questionText: q.text, answer: a.answer, notes: a.notes || undefined });
        }
      }
    }

    if (forceDecline && !confirm('Confirm that you are declaring yourself NOT independent on this engagement. The RI and Ethics Partner will be notified and you will be locked out of the engagement.')) return;

    setSubmitting(true);
    try {
      const res = await fetch(`/api/engagements/${engagementId}/independence`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers: payload, isIndependent: !forceDecline }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setSubmitError(d.error || `Submit failed (${res.status})`);
        return;
      }
      const d = await res.json();
      if (d.isIndependent) {
        // Success — reload status so children render.
        const again = await fetch(`/api/engagements/${engagementId}/independence`);
        setData(await again.json());
      } else {
        setData(prev => prev ? { ...prev, status: 'declined', isIndependent: false } : prev);
      }
    } catch (err: any) {
      setSubmitError(err?.message || 'Submit failed');
    } finally {
      setSubmitting(false);
    }
  }

  const confirmedCount = Object.values(answers).filter(a => a.answer !== undefined).length;

  return (
    <div className="max-w-3xl mx-auto my-10 bg-white border border-amber-200 rounded-xl shadow-sm overflow-hidden">
      <div className="bg-amber-50 px-6 py-4 border-b border-amber-200 flex items-start gap-3">
        <ShieldAlert className="h-6 w-6 text-amber-600 flex-none mt-0.5" />
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Confirm your independence on this engagement</h2>
          <p className="text-sm text-slate-700 mt-1">
            You cannot view or interact with this engagement until you confirm your independence. Please answer every
            question honestly. Answering &ldquo;No&rdquo; to a question marked as critical will automatically notify the
            Responsible Individual and Ethics Partner.
          </p>
        </div>
      </div>

      <div className="px-6 py-5 space-y-5">
        {data.questions.length === 0 && (
          <div className="text-sm text-slate-600 bg-slate-50 border border-slate-200 rounded p-4">
            No independence questions have been configured for your firm. Please ask your Methodology Admin to set these up
            under <strong>Firm-Wide Assumptions → Independence Questions</strong>.
          </div>
        )}

        {data.questions.map((q, i) => {
          const a = answers[q.id] || { answer: undefined as any, notes: '' };
          return (
            <div key={q.id} className="border border-slate-200 rounded-lg p-4">
              <div className="flex items-start gap-2 mb-2">
                <span className="text-xs font-semibold text-slate-400 w-6 mt-0.5">{i + 1}.</span>
                <div className="flex-1">
                  <p className="text-sm text-slate-800">
                    {q.text}
                    {q.hardFail && <span className="ml-2 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-red-100 text-red-700 font-semibold">Critical</span>}
                  </p>
                  {q.helpText && <p className="text-xs text-slate-500 mt-1">{q.helpText}</p>}
                </div>
              </div>
              {q.answerType === 'text' ? (
                <textarea
                  value={typeof a.answer === 'string' ? a.answer : ''}
                  onChange={e => setAnswers(prev => ({ ...prev, [q.id]: { ...(prev[q.id] || {}), answer: e.target.value, notes: (prev[q.id] || {}).notes || '' } }))}
                  rows={3}
                  className="w-full text-sm border border-slate-200 rounded px-2 py-1.5"
                  placeholder="Your response"
                />
              ) : (
                <div className="flex items-center gap-3 ml-8">
                  <label className="inline-flex items-center gap-1.5 text-sm">
                    <input
                      type="radio"
                      name={`q_${q.id}`}
                      checked={a.answer === true}
                      onChange={() => setAnswers(prev => ({ ...prev, [q.id]: { answer: true, notes: (prev[q.id] || {}).notes || '' } }))}
                    />
                    Yes
                  </label>
                  <label className="inline-flex items-center gap-1.5 text-sm">
                    <input
                      type="radio"
                      name={`q_${q.id}`}
                      checked={a.answer === false}
                      onChange={() => setAnswers(prev => ({ ...prev, [q.id]: { answer: false, notes: (prev[q.id] || {}).notes || '' } }))}
                    />
                    No
                  </label>
                  {a.answer === false && q.requiresNotesOnNo && (
                    <span className="text-[11px] text-amber-700">Notes required below</span>
                  )}
                </div>
              )}
              {q.answerType !== 'text' && (a.answer === false || q.requiresNotesOnNo) && (
                <textarea
                  value={a.notes || ''}
                  onChange={e => setAnswers(prev => ({ ...prev, [q.id]: { answer: (prev[q.id] || {}).answer, notes: e.target.value } }))}
                  rows={2}
                  className="w-full mt-2 text-xs border border-slate-200 rounded px-2 py-1.5"
                  placeholder={q.requiresNotesOnNo ? 'Required — please explain' : 'Optional notes'}
                />
              )}
            </div>
          );
        })}

        {submitError && (
          <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-3">
            {submitError}
          </div>
        )}

        <div className="flex items-center justify-between pt-2 border-t border-slate-100">
          <button
            onClick={() => submit(true)}
            disabled={submitting}
            className="text-xs text-red-700 hover:text-red-900 underline disabled:opacity-50"
            title="Declare that you are not independent — RI and Ethics Partner will be notified"
          >
            I am NOT independent on this engagement
          </button>
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-400">{confirmedCount} of {data.questions.length} answered</span>
            <button
              onClick={() => submit(false)}
              disabled={submitting || data.questions.length === 0}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm font-medium disabled:opacity-50"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Confirm independence
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
