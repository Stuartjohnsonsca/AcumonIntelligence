'use client';

/**
 * Methodology Admin → Reset Tab Data.
 *
 * UI for /api/methodology-admin/data-purge. Loads the tab registry on
 * mount, lets the admin pick a tab, requires the literal string
 * "DELETE" in a text field to enable the Commit Delete button, posts
 * the request, and shows the per-table delete counts that came back.
 *
 * Intentional friction: every step requires a deliberate action — no
 * single-click destruction. Each successful purge writes per-engagement
 * rows to engagement_action_logs so the audit trail records the wipe.
 */

import { useEffect, useState } from 'react';
import { AlertTriangle, Loader2, Trash2, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface TabOption {
  key: string;
  label: string;
  description: string;
}

interface PurgeResult {
  ok: boolean;
  tab: string;
  label: string;
  targets: Array<{ model: string; count: number }>;
  totalDeleted: number;
  engagementCount: number;
}

export function DataPurgeClient() {
  const [tabs, setTabs] = useState<TabOption[]>([]);
  const [loadingTabs, setLoadingTabs] = useState(true);
  const [tabKey, setTabKey] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PurgeResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/methodology-admin/data-purge');
        if (!cancelled && res.ok) {
          const data = await res.json();
          setTabs(Array.isArray(data?.tabs) ? data.tabs : []);
        }
      } finally {
        if (!cancelled) setLoadingTabs(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const selectedTab = tabs.find(t => t.key === tabKey);
  const canCommit = !!tabKey && confirmation === 'DELETE' && !submitting;

  async function handleCommit() {
    if (!canCommit) return;
    setError(null);
    setResult(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/methodology-admin/data-purge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tab: tabKey, confirmation }),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail?.error || `HTTP ${res.status}`);
      }
      const json = (await res.json()) as PurgeResult;
      setResult(json);
      // Clear the confirmation so a follow-up purge can't fire by
      // accident — the admin has to retype DELETE each time.
      setConfirmation('');
    } catch (err: any) {
      setError(err?.message || 'Purge failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Warning banner — destructive operation, irreversible */}
      <div className="flex items-start gap-3 p-3 bg-red-50 border border-red-200 rounded">
        <AlertTriangle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
        <div className="text-sm text-red-900">
          <strong>This deletes data permanently across every engagement in your firm.</strong> There is no
          undo. The Methodology Admin audit trail will record who triggered the wipe, when, and how many
          rows were deleted.
        </div>
      </div>

      {/* Tab dropdown */}
      <div>
        <label className="block text-xs font-medium text-slate-700 mb-1">Select tab to wipe</label>
        <select
          value={tabKey}
          onChange={e => { setTabKey(e.target.value); setResult(null); setError(null); }}
          disabled={loadingTabs || submitting}
          className="w-full text-sm border border-slate-300 rounded px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">{loadingTabs ? 'Loading…' : '— Pick a tab —'}</option>
          {tabs.map(t => (
            <option key={t.key} value={t.key}>{t.label}</option>
          ))}
        </select>
        {selectedTab && (
          <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">{selectedTab.description}</p>
        )}
      </div>

      {/* Confirmation field */}
      <div>
        <label className="block text-xs font-medium text-slate-700 mb-1">
          Type <code className="bg-slate-100 px-1 py-0.5 rounded text-[11px]">DELETE</code> to confirm
        </label>
        <input
          type="text"
          value={confirmation}
          onChange={e => setConfirmation(e.target.value)}
          disabled={!tabKey || submitting}
          placeholder="DELETE"
          className="w-full text-sm border border-slate-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-red-500 disabled:bg-slate-50"
        />
      </div>

      {/* Commit button */}
      <div className="flex items-center gap-3">
        <Button
          onClick={handleCommit}
          disabled={!canCommit}
          className="bg-red-600 hover:bg-red-700 text-white disabled:opacity-50"
        >
          {submitting ? (
            <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Deleting…</>
          ) : (
            <><Trash2 className="h-4 w-4 mr-2" /> Commit Delete</>
          )}
        </Button>
        {!canCommit && tabKey && confirmation !== 'DELETE' && !submitting && (
          <span className="text-xs text-slate-500">Type DELETE exactly to enable.</span>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-800">
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* Success result */}
      {result && (
        <div className="p-3 bg-green-50 border border-green-200 rounded text-sm space-y-2">
          <div className="flex items-center gap-2 text-green-800 font-semibold">
            <CheckCircle2 className="h-4 w-4" />
            Wiped &ldquo;{result.label}&rdquo; — {result.totalDeleted.toLocaleString()} rows across {result.engagementCount} engagement{result.engagementCount === 1 ? '' : 's'}.
          </div>
          <div className="text-xs text-slate-700">
            <strong>Per-table breakdown:</strong>
            <ul className="mt-1 space-y-0.5 ml-4 list-disc">
              {result.targets.map(t => (
                <li key={t.model}>
                  <code className="bg-white px-1 rounded">{t.model}</code> — {t.count >= 0 ? `${t.count} row${t.count === 1 ? '' : 's'}` : <span className="text-red-700">failed</span>}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
