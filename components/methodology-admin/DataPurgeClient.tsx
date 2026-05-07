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
  cascade: string[];
  expandedKeys: string[];
}

interface ClientOption { id: string; name: string }
interface PeriodOption { id: string; startDate: string | null; endDate: string | null }

interface PurgeResult {
  ok: boolean;
  tab: string;
  label: string;
  cascadedKeys: string[];
  targets: Array<{ model: string; count: number; extraWhere?: Record<string, unknown> }>;
  totalDeleted: number;
  engagementCount: number;
  clientId: string;
  periodId: string;
}

function formatPeriod(p: PeriodOption | undefined | null): string {
  if (!p) return '';
  const end = p.endDate ? new Date(p.endDate).toLocaleDateString('en-GB') : '';
  return end ? `Period ended ${end}` : '(period dates missing)';
}

export function DataPurgeClient() {
  const [tabs, setTabs] = useState<TabOption[]>([]);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [periods, setPeriods] = useState<PeriodOption[]>([]);
  const [loadingTabs, setLoadingTabs] = useState(true);
  const [tabKey, setTabKey] = useState('');
  const [clientId, setClientId] = useState('');
  const [periodId, setPeriodId] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PurgeResult | null>(null);

  // Initial load — tabs + client list (no clientId yet so periods
  // come back empty).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/methodology-admin/data-purge');
        if (!cancelled && res.ok) {
          const data = await res.json();
          setTabs(Array.isArray(data?.tabs) ? data.tabs : []);
          setClients(Array.isArray(data?.clients) ? data.clients : []);
        }
      } finally {
        if (!cancelled) setLoadingTabs(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Load periods when the client changes. Wipe periodId so a stale
  // selection from another client can't be submitted.
  useEffect(() => {
    setPeriodId('');
    setPeriods([]);
    if (!clientId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/methodology-admin/data-purge?clientId=${encodeURIComponent(clientId)}`);
        if (!cancelled && res.ok) {
          const data = await res.json();
          setPeriods(Array.isArray(data?.periods) ? data.periods : []);
        }
      } catch { /* tolerant */ }
    })();
    return () => { cancelled = true; };
  }, [clientId]);

  const selectedTab = tabs.find(t => t.key === tabKey);
  const selectedClient = clients.find(c => c.id === clientId);
  const selectedPeriod = periods.find(p => p.id === periodId);
  const canCommit = !!tabKey && !!clientId && !!periodId && confirmation === 'DELETE' && !submitting;

  async function handleCommit() {
    if (!canCommit) return;
    setError(null);
    setResult(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/methodology-admin/data-purge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tab: tabKey, clientId, periodId, confirmation }),
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
          <strong>This deletes data permanently for the selected Client + Period.</strong> All
          engagements under that period (e.g. SME and GROUP audit types of the same client+period)
          are affected. There is no undo. The audit trail records who triggered the wipe, when,
          and how many rows were deleted.
        </div>
      </div>

      {/* Client + Period scope */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-3 bg-slate-50 border border-slate-200 rounded">
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Client</label>
          <select
            value={clientId}
            onChange={e => { setClientId(e.target.value); setResult(null); setError(null); }}
            disabled={loadingTabs || submitting}
            className="w-full text-sm border border-slate-300 rounded px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">{loadingTabs ? 'Loading…' : '— Pick a client —'}</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Period</label>
          <select
            value={periodId}
            onChange={e => { setPeriodId(e.target.value); setResult(null); setError(null); }}
            disabled={!clientId || submitting}
            className="w-full text-sm border border-slate-300 rounded px-3 py-2 bg-white disabled:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">{!clientId ? 'Pick a client first' : (periods.length === 0 ? 'No periods with engagements' : '— Pick a period —')}</option>
            {periods.map(p => (
              <option key={p.id} value={p.id}>{formatPeriod(p)}</option>
            ))}
          </select>
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
          <div className="mt-1.5 space-y-1.5">
            <p className="text-xs text-slate-600 leading-relaxed">{selectedTab.description}</p>
            {selectedTab.expandedKeys.length > 1 && (
              <div className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                <strong>Cascade:</strong> this purge also wipes data for {selectedTab.expandedKeys.length - 1} dependent tab{selectedTab.expandedKeys.length === 2 ? '' : 's'} so triggers can refire cleanly:
                <ul className="list-disc ml-4 mt-1 space-y-0.5">
                  {selectedTab.expandedKeys.filter(k => k !== selectedTab.key).map(k => (
                    <li key={k}><code className="bg-white px-1 rounded">{k}</code></li>
                  ))}
                </ul>
              </div>
            )}
          </div>
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
        {!canCommit && !submitting && (
          <span className="text-xs text-slate-500">
            {(!clientId || !periodId) && 'Pick a Client + Period. '}
            {tabKey && (clientId && periodId) && confirmation !== 'DELETE' && 'Type DELETE exactly to enable.'}
            {!tabKey && (clientId && periodId) && 'Pick a tab.'}
          </span>
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
            Wiped &ldquo;{result.label}&rdquo; for {selectedClient?.name || 'client'} · {formatPeriod(selectedPeriod)} — {result.totalDeleted.toLocaleString()} rows across {result.engagementCount} engagement{result.engagementCount === 1 ? '' : 's'}.
          </div>
          <div className="text-xs text-slate-700">
            <strong>Per-table breakdown:</strong>
            <ul className="mt-1 space-y-0.5 ml-4 list-disc">
              {result.targets.map((t, i) => {
                const extraSuffix = t.extraWhere && Object.keys(t.extraWhere).length > 0
                  ? ` (where ${Object.entries(t.extraWhere).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', ')})`
                  : '';
                return (
                  <li key={`${t.model}-${i}`}>
                    <code className="bg-white px-1 rounded">{t.model}</code>{extraSuffix} — {t.count >= 0 ? `${t.count} row${t.count === 1 ? '' : 's'}` : <span className="text-red-700">failed</span>}
                  </li>
                );
              })}
            </ul>
          </div>
          {result.cascadedKeys && result.cascadedKeys.length > 1 && (
            <div className="text-xs text-slate-600">
              <strong>Cascaded tabs purged:</strong> {result.cascadedKeys.join(', ')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
