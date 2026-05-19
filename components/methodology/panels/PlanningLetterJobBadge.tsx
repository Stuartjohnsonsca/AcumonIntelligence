'use client';

import { useEffect, useState, useCallback } from 'react';
import { AlertTriangle, Loader2, X } from 'lucide-react';

/**
 * PlanningLetterJobBadge — orange chip that appears on the RMM tab
 * whenever the background Planning Letter processor produced a
 * failed (or partially-failed) job the auditor hasn't yet
 * acknowledged. Hovering reveals the error + timestamp + per-recipient
 * breakdown. Clicking the × marks the job as acknowledged (server-side)
 * so the badge disappears — re-sending and succeeding produces no
 * new failure row, so the indicator stays clear until the next
 * problem.
 *
 * Polling pattern: a single fetch on mount + on window focus + every
 * 30s while the tab is visible. Cheap (one indexed query, small JSON)
 * and consistent with how the rest of the engagement state refreshes.
 */

interface FailedJob {
  id: string;
  status: string;
  errorMessage: string | null;
  fileName: string | null;
  createdAt: string;
  completedAt: string | null;
  recipients?: Array<{ id: string; name: string; email: string; status: string; error?: string }>;
}

interface Props {
  engagementId: string;
  /** Optional callback fired when the badge dismisses the last failure,
   *  in case a parent wants to react (e.g. recolour the surrounding
   *  tab back to its default state). */
  onCleared?: () => void;
}

export function PlanningLetterJobBadge({ engagementId, onCleared }: Props) {
  const [failures, setFailures] = useState<FailedJob[]>([]);
  const [processing, setProcessing] = useState(0);
  const [openTip, setOpenTip] = useState(false);
  const [dismissing, setDismissing] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/engagements/${engagementId}/planning-letter-jobs?onlyUnacknowledged=1`);
      if (!res.ok) return;
      const data = await res.json();
      const jobs: FailedJob[] = Array.isArray(data?.jobs) ? data.jobs : [];
      setFailures(jobs.filter(j => j.status === 'failed'));
      setProcessing(jobs.filter(j => j.status === 'queued' || j.status === 'processing').length);
    } catch { /* silent — next tick will retry */ }
  }, [engagementId]);

  useEffect(() => {
    refresh();
    function onFocus() { refresh(); }
    window.addEventListener('focus', onFocus);
    const t = setInterval(refresh, 30000);
    return () => {
      window.removeEventListener('focus', onFocus);
      clearInterval(t);
    };
  }, [refresh]);

  async function dismissAll() {
    if (failures.length === 0) return;
    setDismissing(true);
    try {
      await fetch(`/api/engagements/${engagementId}/planning-letter-jobs`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobIds: failures.map(f => f.id) }),
      });
      setFailures([]);
      setOpenTip(false);
      onCleared?.();
    } finally {
      setDismissing(false);
    }
  }

  // Show nothing when there are no relevant signals — keeps the tab
  // header clean in the happy path.
  if (failures.length === 0 && processing === 0) return null;

  // Processing chip — neutral blue, no hover tooltip needed, simply
  // tells the auditor "your last send is still going out".
  if (failures.length === 0) {
    return (
      <span
        className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded border border-blue-300 bg-blue-50 text-blue-700"
        title={`${processing} Planning Letter send${processing === 1 ? '' : 's'} in progress in the background`}
      >
        <Loader2 className="h-3 w-3 animate-spin" />
        Sending Planning Letter…
      </span>
    );
  }

  // At least one failure — orange chip with hover detail.
  const latest = failures[0];
  return (
    <span className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpenTip(v => !v)}
        onMouseEnter={() => setOpenTip(true)}
        onMouseLeave={() => setOpenTip(false)}
        className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded border border-orange-300 bg-orange-100 text-orange-800 hover:bg-orange-200"
        title="Planning Letter send had a problem — click for details"
      >
        <AlertTriangle className="h-3 w-3" />
        Planning Letter — {failures.length} failure{failures.length === 1 ? '' : 's'}
      </button>
      {openTip && (
        <div
          className="absolute z-50 top-full mt-1 right-0 w-[320px] rounded-md border border-orange-200 bg-white shadow-lg p-3 text-[11px] text-slate-700"
          onMouseEnter={() => setOpenTip(true)}
          onMouseLeave={() => setOpenTip(false)}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="font-semibold text-orange-800 flex items-center gap-1">
              <AlertTriangle className="h-3.5 w-3.5" /> Planning Letter send failed
            </span>
            <button
              onClick={dismissAll}
              disabled={dismissing}
              className="inline-flex items-center gap-0.5 text-[10px] text-slate-500 hover:text-slate-800"
              title="Mark these failures as acknowledged"
            >
              {dismissing ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
              Dismiss
            </button>
          </div>
          {failures.slice(0, 3).map(f => (
            <div key={f.id} className="mb-2 last:mb-0 border-t border-slate-100 pt-1.5 first:border-t-0 first:pt-0">
              <div className="font-medium text-slate-800">
                {f.fileName || 'Planning Letter'}
                <span className="text-slate-400 ml-1 font-normal">
                  · {new Date(f.completedAt || f.createdAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              <div className="text-orange-700 mt-0.5">{f.errorMessage || 'Send failed.'}</div>
              {Array.isArray(f.recipients) && f.recipients.length > 0 && (
                <ul className="mt-1 space-y-0.5">
                  {f.recipients
                    .filter(r => r.status === 'failed')
                    .slice(0, 4)
                    .map(r => (
                      <li key={r.id} className="text-red-600">
                        ✕ {r.name} &lt;{r.email}&gt; — {r.error || 'failed'}
                      </li>
                    ))}
                </ul>
              )}
              <div className="text-[10px] text-slate-400 mt-1">
                Re-send when fixed; this notice clears once you dismiss or send succeeds.
              </div>
            </div>
          ))}
          {failures.length > 3 && (
            <div className="text-[10px] text-slate-400 mt-1">…and {failures.length - 3} more.</div>
          )}
          <div className="mt-2 text-[10px] text-slate-400 inline-flex items-center gap-1">
            {/* Identical to the latest job's timestamp but explicit so a
                hover-only user knows when the badge last refreshed. */}
            Latest:&nbsp;<span className="font-medium text-slate-600">{new Date(latest.completedAt || latest.createdAt).toLocaleString('en-GB')}</span>
          </div>
        </div>
      )}
    </span>
  );
}
