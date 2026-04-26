'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { AlertTriangle } from 'lucide-react';

/**
 * Audit Test Summary Results — Completion view.
 *
 * Per spec ("In Completion under Test Summary Results should list out
 * all tests in the Audit Plan, although with any tests done in
 * planning…"):
 *
 *   - Flat row-per-test list across the engagement.
 *   - Two dot columns:
 *       PROGRESS — completed (green) | partially / in-progress (orange) |
 *                  failed-to-complete (red).
 *       RESULT   — no error or < Clearly Trivial (green) |
 *                  between CT and Performance Materiality (orange) |
 *                  > Performance Materiality (red).
 *   - Duration column showing time from request to completion as
 *     Hh Mm (or H:MM when shorter than an hour).
 *
 * Tests not yet executed don't have an execution record, so they
 * don't appear here yet — clicking "Run All" in the Audit Plan tab
 * surfaces them, then they show up with a Progress dot the moment
 * they start.
 *
 * Planning-stage tests (e.g. agreeing prior year TB to accounts):
 * those don't currently flow through the test-execution / test-
 * conclusion pipeline, so they're not in this list yet. Surfacing
 * them needs a separate data source — flagged with the user.
 */

interface TestExecution {
  id: string;
  testDescription: string;
  fsLine: string;
  status: string;            // running | paused | completed | failed | cancelled
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
}

interface TestConclusion {
  id: string;
  fsLine: string;
  testDescription: string;
  accountCode: string | null;
  conclusion: string | null; // green | orange | red | failed
  status: string;            // pending | concluded | reviewed | signed_off
  totalErrors: number;
  extrapolatedError: number;
  reviewedByName: string | null;
  reviewedAt: string | null;
  riSignedByName: string | null;
  riSignedAt: string | null;
  executionId?: string | null;
}

interface Props {
  engagementId: string;
  userRole?: string;
  userId?: string;
}

type Dot = 'green' | 'orange' | 'red' | 'pending';

interface SummaryRow {
  key: string;
  testDescription: string;
  fsLine: string;
  accountCode: string | null;
  progress: Dot;
  result: Dot;
  durationMs: number | null;
  totalErrors: number;
  status: string;
  conclusionId: string | null;
  executionId: string | null;
  riSignedByName: string | null;
}

const DOT_BG: Record<Dot, string> = {
  green: 'bg-green-500',
  orange: 'bg-orange-500',
  red: 'bg-red-500',
  pending: 'bg-slate-300',
};

const PROGRESS_TITLE: Record<Dot, string> = {
  green: 'Completed',
  orange: 'In progress / partially complete',
  red: 'Failed to complete',
  pending: 'Not yet started',
};

const RESULT_TITLE: Record<Dot, string> = {
  green: 'No error or below Clearly Trivial',
  orange: 'Error between Clearly Trivial and Performance Materiality',
  red: 'Error above Performance Materiality',
  pending: 'Result pending',
};

function formatDuration(ms: number | null): string {
  if (ms == null || ms < 0) return '—';
  const totalMinutes = Math.round(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  // < 1 minute → show seconds so a fast test doesn't render as "0:00"
  if (totalMinutes === 0) {
    const seconds = Math.max(1, Math.round(ms / 1000));
    return `0:00:${String(seconds).padStart(2, '0')}`;
  }
  return `${hours}:${String(minutes).padStart(2, '0')}`;
}

function progressFromStatus(status: string): Dot {
  if (status === 'completed') return 'green';
  if (status === 'failed' || status === 'cancelled') return 'red';
  if (status === 'running' || status === 'paused') return 'orange';
  return 'pending';
}

/**
 * Result colour. Falls back through three layers:
 *   1. The conclusion record's pre-computed conclusion field (already
 *      green/orange/red/failed when set by the test handler).
 *   2. extrapolatedError compared against materiality thresholds —
 *      reproduces the same banding the conclusion would get if it
 *      were re-derived now.
 *   3. Default to green when an execution completed cleanly with no
 *      conclusion record (matches the existing AuditPlanPanel default).
 */
function resultFromConclusion(
  conclusion: TestConclusion | null,
  execStatus: string,
  performanceMateriality: number,
  clearlyTrivial: number,
): Dot {
  if (conclusion?.conclusion === 'failed') return 'red';
  if (conclusion?.conclusion === 'red') return 'red';
  if (conclusion?.conclusion === 'orange') return 'orange';
  if (conclusion?.conclusion === 'green') return 'green';
  // Inferred from extrapolatedError when no precomputed conclusion.
  const err = Math.abs(Number(conclusion?.extrapolatedError) || 0);
  if (err > 0 && performanceMateriality > 0) {
    if (err > performanceMateriality) return 'red';
    if (err > clearlyTrivial) return 'orange';
    return 'green';
  }
  // No conclusion record at all and the execution finished cleanly →
  // default to green (matches the AuditPlanPanel default).
  if (execStatus === 'completed') return 'green';
  return 'pending';
}

export function AuditTestSummaryPanel({ engagementId, userRole, userId }: Props) {
  const [executions, setExecutions] = useState<TestExecution[]>([]);
  const [conclusions, setConclusions] = useState<TestConclusion[]>([]);
  const [performanceMateriality, setPerformanceMateriality] = useState(0);
  const [clearlyTrivial, setClearlyTrivial] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [execRes, concRes, matRes] = await Promise.all([
        fetch(`/api/engagements/${engagementId}/test-execution?lite=true`),
        fetch(`/api/engagements/${engagementId}/test-conclusions`),
        fetch(`/api/engagements/${engagementId}/materiality`),
      ]);
      if (execRes.ok) {
        const data = await execRes.json();
        setExecutions(Array.isArray(data?.executions) ? data.executions : []);
      }
      if (concRes.ok) {
        const data = await concRes.json();
        setConclusions(Array.isArray(data?.conclusions) ? data.conclusions : []);
      }
      if (matRes.ok) {
        const data = await matRes.json();
        // Materiality is stored as a free-form JSON blob; admins
        // historically wrote both flat and nested shapes. Read both.
        const m = data?.data || {};
        setPerformanceMateriality(Number(m?.materiality?.performanceMateriality ?? m?.performanceMateriality ?? 0) || 0);
        setClearlyTrivial(Number(m?.materiality?.clearlyTrivial ?? m?.clearlyTrivial ?? 0) || 0);
      }
    } finally { setLoading(false); }
  }, [engagementId]);

  useEffect(() => { void load(); }, [load]);

  // Build the per-test row list. Each TestExecution becomes one row,
  // joined to its TestConclusion when present (executionId, falling
  // back to testDescription + fsLine match for older conclusions
  // written before executionId was tracked).
  const rows = useMemo<SummaryRow[]>(() => {
    const out: SummaryRow[] = [];
    for (const e of executions) {
      const conc = conclusions.find(c => c.executionId === e.id)
        ?? conclusions.find(c => c.testDescription === e.testDescription && c.fsLine === e.fsLine)
        ?? null;
      const startedAt = e.startedAt ? new Date(e.startedAt).getTime() : null;
      const completedAt = e.completedAt ? new Date(e.completedAt).getTime() : null;
      const durationMs = startedAt != null && completedAt != null ? completedAt - startedAt : null;
      out.push({
        key: e.id,
        testDescription: e.testDescription,
        fsLine: e.fsLine,
        accountCode: conc?.accountCode || null,
        progress: progressFromStatus(e.status),
        result: resultFromConclusion(conc, e.status, performanceMateriality, clearlyTrivial),
        durationMs,
        totalErrors: conc?.totalErrors || 0,
        status: conc?.status || e.status,
        conclusionId: conc?.id || null,
        executionId: e.id,
        riSignedByName: conc?.riSignedByName || null,
      });
    }
    // Conclusions that don't have a matching execution (rare — happens
    // when a conclusion was hand-written or imported without going
    // through the execution flow). Surface them so they don't go
    // missing from the summary.
    for (const c of conclusions) {
      const alreadyShown = out.some(r => r.conclusionId === c.id || (r.testDescription === c.testDescription && r.fsLine === c.fsLine));
      if (alreadyShown) continue;
      out.push({
        key: c.id,
        testDescription: c.testDescription,
        fsLine: c.fsLine,
        accountCode: c.accountCode,
        progress: c.status === 'pending' ? 'pending' : 'green',
        result: resultFromConclusion(c, 'completed', performanceMateriality, clearlyTrivial),
        durationMs: null,
        totalErrors: c.totalErrors || 0,
        status: c.status,
        conclusionId: c.id,
        executionId: null,
        riSignedByName: c.riSignedByName,
      });
    }
    // Sort: failures first (red progress / red result), then
    // in-progress, then completed, then pending. Within each band
    // sort alphabetically by FS Line + test description so the table
    // reads consistently across loads.
    const bandRank = (r: SummaryRow) => {
      if (r.progress === 'red' || r.result === 'red') return 0;
      if (r.progress === 'orange' || r.result === 'orange') return 1;
      if (r.progress === 'green') return 2;
      return 3;
    };
    out.sort((a, b) => {
      const r = bandRank(a) - bandRank(b);
      if (r !== 0) return r;
      const fl = (a.fsLine || '').localeCompare(b.fsLine || '');
      if (fl !== 0) return fl;
      return (a.testDescription || '').localeCompare(b.testDescription || '');
    });
    return out;
  }, [executions, conclusions, performanceMateriality, clearlyTrivial]);

  async function handleRISignOff(conclusionId: string, isUnsign: boolean) {
    try {
      const res = await fetch(`/api/engagements/${engagementId}/test-conclusions`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: conclusionId, action: isUnsign ? 'ri_unsignoff' : 'ri_signoff' }),
      });
      if (res.ok) await load();
    } catch {}
  }

  if (loading) return <div className="p-6 text-center text-xs text-slate-400 animate-pulse">Loading test summary…</div>;
  if (rows.length === 0) return <div className="p-6 text-center text-xs text-slate-400">No tests recorded yet.</div>;

  // Materiality banner — useful context because the Result column
  // bands are derived from these thresholds.
  const haveThresholds = performanceMateriality > 0;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between px-1 pb-1">
        <h3 className="text-sm font-bold text-slate-700">Audit Test Summary Results</h3>
        <div className="text-[10px] text-slate-400">
          {rows.length} test{rows.length !== 1 ? 's' : ''}
          {haveThresholds && (
            <> · CT {clearlyTrivial.toLocaleString()} · PM {performanceMateriality.toLocaleString()}</>
          )}
        </div>
      </div>

      <div className="border rounded-lg overflow-hidden bg-white">
        <table className="w-full text-[11px]">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-1.5 text-left font-semibold">Test</th>
              <th className="px-2 py-1.5 text-left font-semibold w-32">FS Line</th>
              <th className="px-2 py-1.5 text-center font-semibold w-20" title="Tests completed (green) / partially complete (orange) / failed to complete (red)">Progress</th>
              <th className="px-2 py-1.5 text-center font-semibold w-20" title="No / trivial error (green) / between CT and PM (orange) / above PM (red)">Result</th>
              <th className="px-2 py-1.5 text-right font-semibold w-20" title="Hours:Minutes from start to completion">Duration</th>
              <th className="px-2 py-1.5 text-center font-semibold w-16">RI</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map(row => (
              <tr key={row.key} className={row.progress === 'red' || row.result === 'red' ? 'bg-red-50/40' : ''}>
                <td className="px-3 py-1.5 text-slate-700">
                  <div className="truncate max-w-[420px]">{row.testDescription}</div>
                  {row.totalErrors > 0 && (
                    <div className="text-[9px] text-red-600 mt-0.5 inline-flex items-center gap-0.5">
                      <AlertTriangle className="h-2.5 w-2.5" />{row.totalErrors} error{row.totalErrors !== 1 ? 's' : ''}
                    </div>
                  )}
                </td>
                <td className="px-2 py-1.5 text-slate-500 truncate">
                  {row.fsLine}
                  {row.accountCode && row.accountCode !== row.fsLine && (
                    <span className="block text-[9px] text-slate-400 font-mono">{row.accountCode}</span>
                  )}
                </td>
                <td className="px-2 py-1.5 text-center">
                  <div
                    className={`w-3 h-3 rounded-full mx-auto ${DOT_BG[row.progress]}`}
                    title={PROGRESS_TITLE[row.progress]}
                  />
                </td>
                <td className="px-2 py-1.5 text-center">
                  <div
                    className={`w-3 h-3 rounded-full mx-auto ${DOT_BG[row.result]}`}
                    title={RESULT_TITLE[row.result]}
                  />
                </td>
                <td className="px-2 py-1.5 text-right text-slate-500 tabular-nums">
                  {formatDuration(row.durationMs)}
                </td>
                <td className="px-2 py-1.5 text-center">
                  {row.conclusionId && userRole === 'RI' ? (
                    <button
                      onClick={() => handleRISignOff(row.conclusionId!, !!row.riSignedByName)}
                      className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${
                        row.riSignedByName ? 'bg-blue-100 text-blue-700 hover:bg-blue-200' : 'bg-slate-100 text-slate-400 hover:bg-slate-200'
                      }`}
                      title={row.riSignedByName ? `Signed by ${row.riSignedByName} — click to unsign` : 'Sign as RI'}
                    >
                      {row.riSignedByName ? '✓' : 'Sign'}
                    </button>
                  ) : row.riSignedByName ? (
                    <span className="text-[9px] text-blue-600" title={`Signed by ${row.riSignedByName}`}>✓</span>
                  ) : (
                    <span className="text-[9px] text-slate-300">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
