'use client';

/**
 * MonitoringReportsModal — saved questions + scheduled InterrogateBot
 * runs.
 *
 * Auditor flow:
 *   1. Open the modal from the Audit File panel.
 *   2. See a sidebar of existing reports (e.g. "Weekly status").
 *   3. Pick one to view its question list, frequency, run history and
 *      latest answers; or click "New report" to create one.
 *   4. Hit "Run now" for an on-demand snapshot regardless of cadence.
 *
 * The cron at /api/cron/audit-file-monitoring fires every hour and
 * runs reports whose nextRunAt has passed. Answers stream through the
 * existing InterrogateBot so they're file-only and citation-rich.
 */

import { useEffect, useState, useCallback } from 'react';
import {
  X, Plus, Loader2, Play, Calendar, Trash2, Edit3, Mail, History,
  AlertTriangle, Sparkles, CheckCircle2, ChevronRight, ChevronDown,
} from 'lucide-react';

interface RunSummary {
  id: string;
  runAt: string;
  status: 'ok' | 'partial' | 'failed';
  trigger: 'manual' | 'scheduled';
}
interface AnswerRow { question: string; answer: string; error?: string }
interface RunDetail extends RunSummary {
  answers: AnswerRow[];
  errorMessage?: string | null;
  emailedTo?: string[] | null;
}
interface Report {
  id: string;
  name: string;
  questions: string[];
  frequency: 'manual' | 'daily' | 'weekly' | 'monthly';
  isActive: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  emailRecipients: string[] | null;
  createdByName: string | null;
  createdAt: string;
  runs: RunSummary[];
}

interface Props {
  engagementId: string;
  onClose: () => void;
}

const SUGGESTED_QUESTIONS = [
  'How quickly is the client responding to portal queries on average, and which queries are still outstanding?',
  'Which methodology tests assigned to this engagement have no executions recorded yet?',
  'Summarise the latest sign-off status across the file — Reviewer and RI dots that are still pending.',
  'List the highest-risk RMM rows that have no testing approach set in the audit plan.',
  'What outstanding items have an SLA breach in the next 7 days?',
];

const FREQUENCY_LABELS: Record<Report['frequency'], string> = {
  manual: 'Manual only',
  daily: 'Daily (08:00 UTC)',
  weekly: 'Weekly (Mon 08:00 UTC)',
  monthly: 'Monthly (1st, 08:00 UTC)',
};

export function MonitoringReportsModal({ engagementId, onClose }: Props) {
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // New / edit form
  const [draft, setDraft] = useState<{
    id?: string;
    name: string;
    questions: string[];
    frequency: Report['frequency'];
    emailRecipients: string;
  } | null>(null);

  // Latest-run detail for the active report — separate fetch so the
  // list call stays small.
  const [activeRun, setActiveRun] = useState<RunDetail | null>(null);
  const [activeRunLoading, setActiveRunLoading] = useState(false);
  const [expandedRunIds, setExpandedRunIds] = useState<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/engagements/${engagementId}/monitoring-reports`);
      if (!res.ok) throw new Error(`Failed to load (${res.status})`);
      const data = await res.json();
      const list = (data.reports || []).map((r: any) => ({
        ...r,
        questions: Array.isArray(r.questions) ? r.questions : [],
        emailRecipients: Array.isArray(r.emailRecipients) ? r.emailRecipients : null,
      })) as Report[];
      setReports(list);
      if (!activeId && list.length > 0) setActiveId(list[0].id);
    } catch (e: any) {
      setError(e?.message || 'Load failed');
    } finally {
      setLoading(false);
    }
  }, [engagementId, activeId]);

  useEffect(() => { refresh(); }, [refresh]);

  // Pull the latest run's answers whenever the active report changes.
  useEffect(() => {
    if (!activeId) { setActiveRun(null); return; }
    setActiveRunLoading(true);
    fetch(`/api/engagements/${engagementId}/monitoring-reports/${activeId}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        const runs = data?.report?.runs || [];
        if (runs.length > 0) {
          setActiveRun({
            ...runs[0],
            answers: Array.isArray(runs[0].answers) ? runs[0].answers : [],
            emailedTo: Array.isArray(runs[0].emailedTo) ? runs[0].emailedTo : null,
          });
        } else {
          setActiveRun(null);
        }
      })
      .catch(() => setActiveRun(null))
      .finally(() => setActiveRunLoading(false));
  }, [activeId, engagementId]);

  const active = reports.find(r => r.id === activeId) || null;

  function startCreate() {
    setCreating(true);
    setDraft({ name: '', questions: [], frequency: 'weekly', emailRecipients: '' });
  }
  function startEdit(report: Report) {
    setCreating(false);
    setDraft({
      id: report.id,
      name: report.name,
      questions: [...report.questions],
      frequency: report.frequency,
      emailRecipients: (report.emailRecipients || []).join(', '),
    });
  }
  function cancelDraft() {
    setCreating(false);
    setDraft(null);
  }

  async function saveDraft() {
    if (!draft) return;
    const trimmedQs = draft.questions.map(q => q.trim()).filter(Boolean);
    const recipients = draft.emailRecipients
      .split(/[,;\n]/)
      .map(s => s.trim())
      .filter(s => /\S+@\S+\.\S+/.test(s));
    const body = {
      name: draft.name.trim(),
      questions: trimmedQs,
      frequency: draft.frequency,
      emailRecipients: recipients,
    };
    if (!body.name) { setError('Name is required'); return; }

    try {
      let res;
      if (draft.id) {
        res = await fetch(`/api/engagements/${engagementId}/monitoring-reports/${draft.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      } else {
        res = await fetch(`/api/engagements/${engagementId}/monitoring-reports`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      }
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `Save failed (${res.status})`);
      }
      const data = await res.json();
      await refresh();
      setActiveId(data.report.id);
      setDraft(null);
      setCreating(false);
    } catch (e: any) {
      setError(e?.message || 'Save failed');
    }
  }

  async function removeReport(id: string) {
    if (!confirm('Delete this monitoring report and its history?')) return;
    try {
      const res = await fetch(`/api/engagements/${engagementId}/monitoring-reports/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`Delete failed (${res.status})`);
      if (activeId === id) setActiveId(null);
      await refresh();
    } catch (e: any) {
      setError(e?.message || 'Delete failed');
    }
  }

  async function runNow(id: string) {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch(`/api/engagements/${engagementId}/monitoring-reports/${id}/run`, { method: 'POST' });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || 'Run failed');
      }
      const data = await res.json();
      setActiveRun({
        ...data.run,
        answers: Array.isArray(data.run.answers) ? data.run.answers : [],
      });
      await refresh();
    } catch (e: any) {
      setError(e?.message || 'Run failed');
    } finally {
      setRunning(false);
    }
  }

  async function toggleActive(report: Report) {
    try {
      const res = await fetch(`/api/engagements/${engagementId}/monitoring-reports/${report.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !report.isActive }),
      });
      if (!res.ok) throw new Error('Toggle failed');
      await refresh();
    } catch (e: any) {
      setError(e?.message || 'Toggle failed');
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/70 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-lg shadow-2xl w-full max-w-6xl h-[85vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-indigo-600" />
            <h2 className="text-sm font-semibold text-slate-800">Audit File Monitoring</h2>
            <span className="text-[10px] text-slate-500 ml-2">Scheduled questions answered by InterrogateBot</span>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1">
            <X className="h-4 w-4" />
          </button>
        </div>

        {error && (
          <div className="px-4 py-2 bg-red-50 border-b border-red-200 text-xs text-red-700 inline-flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5" /> {error}
          </div>
        )}

        <div className="flex-1 flex min-h-0">
          {/* Sidebar — list of reports */}
          <div className="w-64 border-r border-slate-200 overflow-y-auto bg-slate-50/50">
            <div className="p-2 sticky top-0 bg-slate-50/95 border-b border-slate-200">
              <button
                onClick={startCreate}
                className="w-full inline-flex items-center justify-center gap-1 text-xs px-3 py-1.5 bg-indigo-600 text-white rounded hover:bg-indigo-700"
              >
                <Plus className="h-3 w-3" /> New report
              </button>
            </div>
            {loading ? (
              <div className="p-3 text-center text-xs text-slate-400">
                <Loader2 className="h-4 w-4 animate-spin mx-auto" />
              </div>
            ) : reports.length === 0 ? (
              <p className="px-3 py-4 text-[11px] italic text-slate-500">No monitoring reports yet. Add one to start.</p>
            ) : (
              <ul>
                {reports.map(r => (
                  <li key={r.id}>
                    <button
                      onClick={() => { setActiveId(r.id); setDraft(null); setCreating(false); }}
                      className={`w-full text-left px-3 py-2 border-b border-slate-100 transition-colors ${
                        activeId === r.id ? 'bg-indigo-50 border-l-2 border-l-indigo-500' : 'hover:bg-slate-100'
                      }`}
                    >
                      <div className="text-xs font-medium text-slate-800 truncate">{r.name}</div>
                      <div className="text-[10px] text-slate-500 mt-0.5 flex items-center gap-1">
                        <Calendar className="h-2.5 w-2.5" />
                        {FREQUENCY_LABELS[r.frequency]}
                        {!r.isActive && <span className="text-amber-600">· paused</span>}
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5">
                        {r.questions.length} question{r.questions.length === 1 ? '' : 's'} ·{' '}
                        {r.lastRunAt ? `last ${new Date(r.lastRunAt).toLocaleDateString('en-GB')}` : 'never run'}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Main pane */}
          <div className="flex-1 overflow-y-auto p-5">
            {draft ? (
              <DraftEditor
                draft={draft}
                setDraft={setDraft}
                onSave={saveDraft}
                onCancel={cancelDraft}
                isNew={!draft.id}
              />
            ) : !active ? (
              <div className="text-center text-sm text-slate-400 py-20">
                <Sparkles className="h-8 w-8 mx-auto mb-2 text-slate-300" />
                Pick a report on the left or click <strong>New report</strong> to define one.
                <p className="text-xs mt-4 max-w-md mx-auto">
                  Monitoring reports let you save a list of questions about this engagement
                  (e.g. <em>"How fast is the client responding?"</em> or <em>"Which tests have no executions yet?"</em>)
                  and have the InterrogateBot re-answer them on a schedule.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Header row with actions */}
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-base font-semibold text-slate-900">{active.name}</h3>
                    <div className="text-xs text-slate-500 mt-1 flex flex-wrap items-center gap-3">
                      <span className="inline-flex items-center gap-1"><Calendar className="h-3 w-3" />{FREQUENCY_LABELS[active.frequency]}</span>
                      {active.nextRunAt && active.isActive && active.frequency !== 'manual' && (
                        <span>Next: {new Date(active.nextRunAt).toLocaleString('en-GB')}</span>
                      )}
                      {active.lastRunAt && <span>Last: {new Date(active.lastRunAt).toLocaleString('en-GB')}</span>}
                      {active.emailRecipients && active.emailRecipients.length > 0 && (
                        <span className="inline-flex items-center gap-1"><Mail className="h-3 w-3" />{active.emailRecipients.join(', ')}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button
                      onClick={() => runNow(active.id)}
                      disabled={running}
                      className="inline-flex items-center gap-1 text-xs px-3 py-1.5 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
                    >
                      {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                      Run now
                    </button>
                    <button
                      onClick={() => startEdit(active)}
                      className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 bg-white border border-slate-200 rounded hover:bg-slate-50"
                    >
                      <Edit3 className="h-3 w-3" /> Edit
                    </button>
                    <button
                      onClick={() => toggleActive(active)}
                      className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 bg-white border border-slate-200 rounded hover:bg-slate-50"
                    >
                      {active.isActive ? 'Pause' : 'Resume'}
                    </button>
                    <button
                      onClick={() => removeReport(active.id)}
                      className="text-slate-400 hover:text-red-600 p-1.5"
                      title="Delete report"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {/* Question list (read-only here; edit opens DraftEditor) */}
                <div className="border border-slate-200 rounded-lg p-3 bg-slate-50/40">
                  <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-2">Questions</p>
                  {active.questions.length === 0 ? (
                    <p className="text-xs italic text-slate-400">No questions yet — click Edit to add some.</p>
                  ) : (
                    <ol className="space-y-1.5 list-decimal list-inside text-xs text-slate-700">
                      {active.questions.map((q, i) => <li key={i}>{q}</li>)}
                    </ol>
                  )}
                </div>

                {/* Latest run answers */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">
                      Latest run {activeRun ? `· ${new Date(activeRun.runAt).toLocaleString('en-GB')}` : ''}
                    </p>
                    {activeRun && (
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                        activeRun.status === 'ok' ? 'bg-green-100 text-green-700' :
                        activeRun.status === 'partial' ? 'bg-amber-100 text-amber-700' :
                        'bg-red-100 text-red-700'
                      }`}>
                        {activeRun.status}{activeRun.trigger === 'manual' ? ' · manual' : ''}
                      </span>
                    )}
                  </div>
                  {activeRunLoading ? (
                    <div className="text-center py-6 text-xs text-slate-400">
                      <Loader2 className="h-4 w-4 animate-spin mx-auto" />
                    </div>
                  ) : !activeRun ? (
                    <p className="text-xs italic text-slate-400 py-4">No run yet. Click <strong>Run now</strong> to generate the first report.</p>
                  ) : (
                    <div className="space-y-2">
                      {activeRun.answers.map((row, i) => (
                        <div key={i} className="border border-slate-200 rounded-lg p-3 bg-white">
                          <p className="text-xs font-semibold text-slate-700 mb-1.5">{row.question}</p>
                          {row.error ? (
                            <p className="text-xs text-red-600 inline-flex items-center gap-1">
                              <AlertTriangle className="h-3 w-3" /> {row.error}
                            </p>
                          ) : (
                            <p className="text-xs text-slate-700 whitespace-pre-wrap leading-relaxed">{row.answer}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Run history — collapsible row per prior run */}
                {active.runs.length > 1 && (
                  <div>
                    <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-2 flex items-center gap-1">
                      <History className="h-3 w-3" /> Run history
                    </p>
                    <ul className="space-y-1 border border-slate-200 rounded-lg overflow-hidden">
                      {active.runs.slice(1).map(r => (
                        <li key={r.id} className="border-b last:border-b-0 border-slate-100">
                          <button
                            onClick={() => setExpandedRunIds(prev => {
                              const next = new Set(prev);
                              if (next.has(r.id)) next.delete(r.id); else next.add(r.id);
                              return next;
                            })}
                            className="w-full text-left px-3 py-1.5 text-xs hover:bg-slate-50 flex items-center gap-2"
                          >
                            {expandedRunIds.has(r.id) ? <ChevronDown className="h-3 w-3 text-slate-400" /> : <ChevronRight className="h-3 w-3 text-slate-400" />}
                            <span className="text-slate-700">{new Date(r.runAt).toLocaleString('en-GB')}</span>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                              r.status === 'ok' ? 'bg-green-100 text-green-700' :
                              r.status === 'partial' ? 'bg-amber-100 text-amber-700' :
                              'bg-red-100 text-red-700'
                            }`}>{r.status}</span>
                            <span className="text-[10px] text-slate-400">· {r.trigger}</span>
                          </button>
                          {expandedRunIds.has(r.id) && (
                            <HistoricRun engagementId={engagementId} reportId={active.id} runId={r.id} />
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function HistoricRun({ engagementId, reportId, runId }: { engagementId: string; reportId: string; runId: string }) {
  const [run, setRun] = useState<RunDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/engagements/${engagementId}/monitoring-reports/${reportId}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        const match = (data?.report?.runs || []).find((r: RunDetail) => r.id === runId);
        if (match) {
          setRun({ ...match, answers: Array.isArray(match.answers) ? match.answers : [] });
        }
      })
      .finally(() => setLoading(false));
  }, [engagementId, reportId, runId]);

  if (loading) {
    return <div className="px-4 py-3 text-xs text-slate-400"><Loader2 className="h-3 w-3 animate-spin inline" /> Loading…</div>;
  }
  if (!run) return <div className="px-4 py-3 text-xs italic text-slate-400">Run not found.</div>;

  return (
    <div className="px-4 py-3 space-y-2 bg-slate-50/40">
      {run.answers.map((row, i) => (
        <div key={i} className="border border-slate-200 rounded p-2 bg-white">
          <p className="text-[11px] font-semibold text-slate-700 mb-1">{row.question}</p>
          {row.error ? (
            <p className="text-[11px] text-red-600">{row.error}</p>
          ) : (
            <p className="text-[11px] text-slate-700 whitespace-pre-wrap">{row.answer}</p>
          )}
        </div>
      ))}
    </div>
  );
}

function DraftEditor({
  draft, setDraft, onSave, onCancel, isNew,
}: {
  draft: { id?: string; name: string; questions: string[]; frequency: Report['frequency']; emailRecipients: string };
  setDraft: (next: NonNullable<typeof draft>) => void;
  onSave: () => void;
  onCancel: () => void;
  isNew: boolean;
}) {
  function setField<K extends keyof typeof draft>(key: K, value: typeof draft[K]) {
    setDraft({ ...draft, [key]: value });
  }
  function setQ(idx: number, value: string) {
    const next = [...draft.questions];
    next[idx] = value;
    setField('questions', next as any);
  }
  function addQuestion(prefill = '') {
    setField('questions', [...draft.questions, prefill] as any);
  }
  function removeQuestion(idx: number) {
    const next = draft.questions.filter((_, i) => i !== idx);
    setField('questions', next as any);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-slate-900">{isNew ? 'New monitoring report' : 'Edit report'}</h3>
        <div className="flex items-center gap-2">
          <button onClick={onCancel} className="text-xs px-3 py-1.5 text-slate-500 hover:text-slate-700">Cancel</button>
          <button onClick={onSave} className="inline-flex items-center gap-1 text-xs px-3 py-1.5 bg-indigo-600 text-white rounded hover:bg-indigo-700">
            <CheckCircle2 className="h-3 w-3" /> Save
          </button>
        </div>
      </div>

      <div>
        <label className="text-[11px] font-semibold text-slate-600 block mb-1">Name</label>
        <input
          type="text"
          value={draft.name}
          onChange={e => setField('name', e.target.value)}
          placeholder="e.g. Weekly status digest"
          className="w-full border border-slate-300 rounded px-3 py-1.5 text-xs focus:outline-none focus:border-blue-300"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[11px] font-semibold text-slate-600 block mb-1">Frequency</label>
          <select
            value={draft.frequency}
            onChange={e => setField('frequency', e.target.value as Report['frequency'])}
            className="w-full border border-slate-300 rounded px-2 py-1.5 text-xs bg-white"
          >
            <option value="manual">Manual only</option>
            <option value="daily">Daily (08:00 UTC)</option>
            <option value="weekly">Weekly (Mon 08:00 UTC)</option>
            <option value="monthly">Monthly (1st, 08:00 UTC)</option>
          </select>
        </div>
        <div>
          <label className="text-[11px] font-semibold text-slate-600 block mb-1">Email recipients (optional)</label>
          <input
            type="text"
            value={draft.emailRecipients}
            onChange={e => setField('emailRecipients', e.target.value)}
            placeholder="e.g. me@firm.co.uk, partner@firm.co.uk"
            className="w-full border border-slate-300 rounded px-3 py-1.5 text-xs focus:outline-none focus:border-blue-300"
          />
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-[11px] font-semibold text-slate-600">Questions</label>
          <button onClick={() => addQuestion()} className="text-xs inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-700">
            <Plus className="h-3 w-3" /> Add question
          </button>
        </div>
        <div className="space-y-2">
          {draft.questions.map((q, i) => (
            <div key={i} className="flex items-start gap-2">
              <textarea
                value={q}
                onChange={e => setQ(i, e.target.value)}
                rows={2}
                placeholder="e.g. Which tests assigned to this engagement still have no executions recorded?"
                className="flex-1 border border-slate-300 rounded px-3 py-1.5 text-xs focus:outline-none focus:border-blue-300 resize-y"
              />
              <button onClick={() => removeQuestion(i)} className="text-slate-400 hover:text-red-600 p-1 mt-0.5" title="Remove question">
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>

        {/* Suggested questions — click to copy into the draft. */}
        {draft.questions.length === 0 && (
          <div className="mt-3 border border-dashed border-slate-300 rounded-lg p-3 bg-slate-50/60">
            <p className="text-[11px] font-semibold text-slate-600 mb-2">Try one of these to start:</p>
            <ul className="space-y-1">
              {SUGGESTED_QUESTIONS.map((s, i) => (
                <li key={i}>
                  <button
                    onClick={() => addQuestion(s)}
                    className="text-left text-[11px] text-indigo-700 hover:text-indigo-900 hover:underline"
                  >
                    + {s}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
