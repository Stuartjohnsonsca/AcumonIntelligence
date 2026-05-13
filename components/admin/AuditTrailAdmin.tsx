'use client';

/**
 * Super Admin → Audit Trail tab.
 *
 * Reads `engagement_action_logs` via /api/admin/audit-log and shows
 * every recorded action across firms (schedule-action fires, portal
 * messages, document requests, template generation, etc.) with
 * Client + Period filters. The view is read-only and Super-Admin
 * gated server-side; this component just renders the table.
 */

import { Fragment, useEffect, useMemo, useState } from 'react';
import { Loader2, RefreshCcw, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ClientOption { id: string; name: string }
interface PeriodOption { id: string; startDate: string | null; endDate: string | null }
interface ActionOption { slug: string; count: number }

interface AuditRow {
  id: string;
  /// 'engagement' = engagement_action_logs row (existing); 'user' =
  /// user_action_logs row (new — login, 2FA, password reset, etc.).
  source: 'engagement' | 'user';
  occurredAt: string;
  actorName: string;
  actorUserId: string | null;
  /// 'firm' / 'portal' for user rows; null for engagement rows.
  userKind: 'firm' | 'portal' | null;
  action: string;
  summary: string;
  targetType: string | null;
  targetId: string | null;
  metadata: any;
  engagementId: string | null;
  firmId: string | null;
  client: { id: string; name: string } | null;
  period: { id: string; startDate: string | null; endDate: string | null } | null;
  auditType: string | null;
  ipAddress: string | null;
}

interface ApiResponse {
  total: number;
  engagementTotal?: number;
  userTotal?: number;
  rows: AuditRow[];
  clients: ClientOption[];
  periods: PeriodOption[];
  actions: ActionOption[];
}

const DEFAULT_LIMIT = 100;

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}

function formatPeriod(p: PeriodOption | null): string {
  if (!p) return '';
  const end = p.endDate ? new Date(p.endDate).toLocaleDateString('en-GB') : '';
  return end ? `Period ended ${end}` : '(period dates missing)';
}

export function AuditTrailAdmin() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filter state
  const [clientId, setClientId] = useState('');
  const [periodId, setPeriodId] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [actorFilter, setActorFilter] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [source, setSource] = useState<'' | 'engagement' | 'user'>('');
  const [offset, setOffset] = useState(0);

  /** Range presets — set startDate without touching endDate so "Last
   *  7 days" means "today and the previous 6 days." Useful for super
   *  admins reviewing patterns over standard windows. */
  function applyRangePreset(days: number | 'all') {
    if (days === 'all') {
      setStartDate(''); setEndDate(''); setOffset(0); return;
    }
    const now = new Date();
    const from = new Date(now); from.setDate(now.getDate() - (days - 1));
    setStartDate(from.toISOString().slice(0, 10));
    setEndDate(now.toISOString().slice(0, 10));
    setOffset(0);
  }

  function downloadCsv() {
    const params = new URLSearchParams();
    if (clientId) params.set('clientId', clientId);
    if (periodId) params.set('periodId', periodId);
    if (actionFilter) params.set('action', actionFilter);
    if (actorFilter) params.set('actor', actorFilter);
    if (startDate) params.set('startDate', startDate);
    if (endDate) params.set('endDate', endDate);
    if (source) params.set('source', source);
    params.set('format', 'csv');
    // Trigger the download via a hidden anchor so the browser uses
    // the Content-Disposition filename the API sends.
    const url = `/api/admin/audit-log?${params.toString()}`;
    const a = document.createElement('a');
    a.href = url;
    a.download = ''; // server sets the filename
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  // Detail row expansion (click row to see metadata JSON)
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (clientId) params.set('clientId', clientId);
      if (periodId) params.set('periodId', periodId);
      if (actionFilter) params.set('action', actionFilter);
      if (actorFilter) params.set('actor', actorFilter);
      if (startDate) params.set('startDate', startDate);
      if (endDate) params.set('endDate', endDate);
      if (source) params.set('source', source);
      params.set('limit', String(DEFAULT_LIMIT));
      params.set('offset', String(offset));
      const res = await fetch(`/api/admin/audit-log?${params.toString()}`);
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail?.error || `HTTP ${res.status}`);
      }
      setData(await res.json());
    } catch (err: any) {
      setError(err?.message || 'Failed to load audit log');
    } finally {
      setLoading(false);
    }
  };

  // Auto-load on mount and when any filter changes (Period filter
  // depends on Client, so changing Client resets Period).
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, periodId, actionFilter, actorFilter, startDate, endDate, source, offset]);

  // Reset Period when Client changes — server's period list is
  // scoped per client and would otherwise carry a stale id.
  useEffect(() => { setPeriodId(''); setOffset(0); }, [clientId]);

  const totalPages = data ? Math.ceil(data.total / DEFAULT_LIMIT) : 0;
  const currentPage = Math.floor(offset / DEFAULT_LIMIT) + 1;

  const filteredCount = data?.total ?? 0;

  // Memoize the action options sorted by count desc — most-used first
  // helps super admin spot anomalies.
  const sortedActions = useMemo(() => {
    return (data?.actions || []).slice().sort((a, b) => b.count - a.count);
  }, [data?.actions]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-800">Audit Trail</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Every recorded action across the platform, for every user, going back years.
          Engagement-level actions (portal messages, document requests, audit-point commits, schedule actions)
          and user-level actions (login, 2FA, password reset, profile edits) are shown together.
          Read-only. Filter and export to CSV for offline review.
        </p>
      </div>

      {/* Range presets — quick scopes for the most common reviews.
          "All time" clears both startDate + endDate so years-old
          actions surface. */}
      <div className="flex items-center gap-2 flex-wrap text-xs">
        <span className="text-slate-500">Range:</span>
        {[
          { label: 'Last 24h', days: 1 },
          { label: 'Last 7 days', days: 7 },
          { label: 'Last 30 days', days: 30 },
          { label: 'Last 90 days', days: 90 },
          { label: 'Last year', days: 365 },
          { label: 'All time', days: 'all' as const },
        ].map(preset => (
          <button
            key={preset.label}
            type="button"
            onClick={() => applyRangePreset(preset.days as any)}
            className="px-2.5 py-1 bg-white border border-slate-300 rounded hover:bg-slate-50"
          >{preset.label}</button>
        ))}
      </div>

      {/* Filter bar */}
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-2 items-end p-3 bg-slate-50 border border-slate-200 rounded">
        <div>
          <label className="block text-[10px] font-medium text-slate-600 mb-1">Client</label>
          <select
            value={clientId}
            onChange={e => setClientId(e.target.value)}
            className="w-full text-xs border border-slate-300 rounded px-2 py-1.5 bg-white"
          >
            <option value="">All clients</option>
            {(data?.clients || []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[10px] font-medium text-slate-600 mb-1">Period</label>
          <select
            value={periodId}
            onChange={e => setPeriodId(e.target.value)}
            disabled={!clientId}
            className="w-full text-xs border border-slate-300 rounded px-2 py-1.5 bg-white disabled:bg-slate-100"
          >
            <option value="">{clientId ? 'All periods' : 'Pick a client first'}</option>
            {(data?.periods || []).map(p => (
              <option key={p.id} value={p.id}>{formatPeriod(p)}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[10px] font-medium text-slate-600 mb-1">Action</label>
          <select
            value={actionFilter}
            onChange={e => setActionFilter(e.target.value)}
            className="w-full text-xs border border-slate-300 rounded px-2 py-1.5 bg-white"
          >
            <option value="">All actions</option>
            {sortedActions.map(a => (
              <option key={a.slug} value={a.slug}>{a.slug} ({a.count})</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[10px] font-medium text-slate-600 mb-1">Actor</label>
          <input
            type="text"
            value={actorFilter}
            onChange={e => setActorFilter(e.target.value)}
            placeholder="Name or email…"
            className="w-full text-xs border border-slate-300 rounded px-2 py-1.5"
          />
        </div>
        <div>
          <label className="block text-[10px] font-medium text-slate-600 mb-1">From</label>
          <input
            type="date"
            value={startDate}
            onChange={e => setStartDate(e.target.value)}
            className="w-full text-xs border border-slate-300 rounded px-2 py-1.5"
          />
        </div>
        <div>
          <label className="block text-[10px] font-medium text-slate-600 mb-1">To</label>
          <input
            type="date"
            value={endDate}
            onChange={e => setEndDate(e.target.value)}
            className="w-full text-xs border border-slate-300 rounded px-2 py-1.5"
          />
        </div>
        {/* Source — engagement actions, user actions, or both. The
            default is the merged feed so the SuperAdmin sees
            everything in chronological order. */}
        <div>
          <label className="block text-[10px] font-medium text-slate-600 mb-1">Source</label>
          <select
            value={source}
            onChange={e => setSource(e.target.value as any)}
            className="w-full text-xs border border-slate-300 rounded px-2 py-1.5 bg-white"
          >
            <option value="">Both</option>
            <option value="engagement">Engagement actions</option>
            <option value="user">User actions (login / 2FA / etc.)</option>
          </select>
        </div>
      </div>

      {/* Status row */}
      <div className="flex items-center justify-between text-xs text-slate-500">
        <div>
          {loading ? (
            <span className="inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Loading…</span>
          ) : error ? (
            <span className="text-red-600">Error: {error}</span>
          ) : (
            <span>
              {filteredCount.toLocaleString()} action{filteredCount === 1 ? '' : 's'}
              {/* Show the breakdown when both sources are in the
                  result. Helps the SuperAdmin spot e.g. an unusual
                  burst of failed logins vs engagement traffic. */}
              {typeof data?.engagementTotal === 'number' && typeof data?.userTotal === 'number' && data.engagementTotal > 0 && data.userTotal > 0 && (
                <> · {data.engagementTotal.toLocaleString()} engagement / {data.userTotal.toLocaleString()} user</>
              )}
              {totalPages > 1 && <> · page {currentPage} of {totalPages}</>}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load()}
            disabled={loading}
            className="text-xs"
          >
            <RefreshCcw className="h-3 w-3 mr-1" /> Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={downloadCsv}
            disabled={loading}
            className="text-xs"
            title="Download up to 10,000 matching rows as CSV"
          >
            <Download className="h-3 w-3 mr-1" /> Export CSV
          </Button>
          {(clientId || periodId || actionFilter || actorFilter || startDate || endDate || source) && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setClientId(''); setPeriodId(''); setActionFilter(''); setActorFilter(''); setStartDate(''); setEndDate(''); setSource(''); setOffset(0); }}
              className="text-xs"
            >
              Clear filters
            </Button>
          )}
        </div>
      </div>

      {/* Results table */}
      <div className="border border-slate-200 rounded overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-slate-100">
            <tr className="text-left text-slate-600">
              <th className="px-2 py-1.5 font-semibold">When</th>
              <th className="px-2 py-1.5 font-semibold">Source</th>
              <th className="px-2 py-1.5 font-semibold">Actor</th>
              <th className="px-2 py-1.5 font-semibold">Action</th>
              <th className="px-2 py-1.5 font-semibold">Summary</th>
              <th className="px-2 py-1.5 font-semibold">Client</th>
              <th className="px-2 py-1.5 font-semibold">Period</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(data?.rows || []).length === 0 && !loading && (
              <tr>
                <td colSpan={7} className="px-2 py-6 text-center text-slate-400 italic">
                  No actions match the current filters.
                </td>
              </tr>
            )}
            {(data?.rows || []).map(r => (
              <Fragment key={`${r.source}-${r.id}`}>
                <tr
                  className={`hover:bg-slate-50 cursor-pointer ${expandedId === r.id ? 'bg-blue-50/40' : ''}`}
                  onClick={() => setExpandedId(prev => prev === r.id ? null : r.id)}
                >
                  <td className="px-2 py-1.5 text-slate-700 whitespace-nowrap">{formatDateTime(r.occurredAt)}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap">
                    {/* Visual hint at a glance: engagement actions are
                        the bulk of activity; user actions (login, 2FA,
                        etc.) get a distinct chip colour so the
                        SuperAdmin can spot auth anomalies quickly. */}
                    {r.source === 'engagement' ? (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700">
                        Engagement
                      </span>
                    ) : (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${r.userKind === 'portal' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                        {r.userKind === 'portal' ? 'Portal user' : 'Firm user'}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-slate-700 whitespace-nowrap">{r.actorName}</td>
                  <td className="px-2 py-1.5">
                    <code className="bg-slate-100 px-1 py-0.5 rounded text-[10px]">{r.action}</code>
                  </td>
                  <td className="px-2 py-1.5 text-slate-600 max-w-md truncate">{r.summary}</td>
                  <td className="px-2 py-1.5 text-slate-700 whitespace-nowrap">{r.client?.name || '—'}</td>
                  <td className="px-2 py-1.5 text-slate-600 whitespace-nowrap">{formatPeriod(r.period)}</td>
                </tr>
                {expandedId === r.id && (
                  <tr className="bg-slate-50">
                    <td colSpan={7} className="px-3 py-2 text-[11px] text-slate-700 space-y-1">
                      {r.engagementId && <div><strong>Engagement:</strong> <code className="bg-white px-1 rounded">{r.engagementId}</code></div>}
                      {r.targetType && <div><strong>Target:</strong> {r.targetType} <code className="bg-white px-1 rounded">{r.targetId}</code></div>}
                      {r.auditType && <div><strong>Audit type:</strong> {r.auditType}</div>}
                      {r.ipAddress && <div><strong>IP:</strong> <code className="bg-white px-1 rounded">{r.ipAddress}</code></div>}
                      {r.metadata && (
                        <div>
                          <strong>Metadata:</strong>
                          <pre className="mt-1 p-2 bg-white border border-slate-200 rounded text-[10px] overflow-x-auto whitespace-pre-wrap break-all">
                            {JSON.stringify(r.metadata, null, 2)}
                          </pre>
                        </div>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setOffset(o => Math.max(0, o - DEFAULT_LIMIT))}
            disabled={offset === 0 || loading}
            className="text-xs"
          >
            ← Previous
          </Button>
          <span className="text-slate-500">Page {currentPage} of {totalPages}</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setOffset(o => o + DEFAULT_LIMIT)}
            disabled={currentPage >= totalPages || loading}
            className="text-xs"
          >
            Next →
          </Button>
        </div>
      )}
    </div>
  );
}
