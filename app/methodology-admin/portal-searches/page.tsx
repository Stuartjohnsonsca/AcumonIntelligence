'use client';

/**
 * Methodology Admin — Portal Searches
 *
 * Lists every free-text search the firm's portal users have run,
 * aggregated by normalised query. Each row shows:
 *   - query text + AI interpretation (what status / FS Lines / TB
 *     codes / assignees / text match the model chose)
 *   - run count, distinct users, average result count, last-run
 *   - a "Feature" toggle + editable label
 *
 * Featuring a search promotes it to a firm-wide quick-filter chip
 * on every Principal Dashboard — portal users click once to replay
 * it (zero AI cost, the interpretation is cached on the log row).
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Search, Star, Loader2, RefreshCw } from 'lucide-react';

interface AggregatedSearch {
  representativeId: string;
  query: string;
  queryNormalised: string | null;
  runCount: number;
  avgResults: number;
  firstRunAt: string;
  lastRunAt: string;
  distinctUsers: number;
  featured: boolean;
  featuredLabel: string | null;
  featuredAt: string | null;
  interpretedFilters: any;
}

export default function PortalSearchesAdminPage() {
  const [rows, setRows] = useState<AggregatedSearch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [featuredOnly, setFeaturedOnly] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [draftLabels, setDraftLabels] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const qp = new URLSearchParams({ limit: '100' });
      if (featuredOnly) qp.set('featuredOnly', 'true');
      const r = await fetch(`/api/methodology-admin/portal-searches?${qp.toString()}`, { cache: 'no-store' });
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || `Failed (${r.status})`);
      const d = await r.json();
      setRows(Array.isArray(d?.searches) ? d.searches : []);
    } catch (err: any) {
      setError(err?.message || 'Load failed');
    } finally {
      setLoading(false);
    }
  }, [featuredOnly]);

  useEffect(() => { load(); }, [load]);

  async function toggleFeatured(row: AggregatedSearch, featured: boolean, label?: string) {
    setSavingId(row.representativeId);
    try {
      const r = await fetch(`/api/methodology-admin/portal-searches/${row.representativeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ featured, label: label ?? row.featuredLabel ?? row.query }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || 'Save failed');
      await load();
    } catch (err: any) {
      setError(err?.message || 'Save failed');
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      <div className="mb-6">
        <Link href="/methodology-admin" className="text-sm text-slate-600 hover:text-slate-900 inline-flex items-center gap-1">
          <ArrowLeft className="w-4 h-4" />Back to Methodology Admin
        </Link>
        <div className="flex items-start justify-between mt-2">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
              <Search className="w-6 h-6 text-cyan-600" />Portal Searches
            </h1>
            <p className="text-sm text-slate-600 mt-1">
              Every free-text search your portal users run on their dashboards, aggregated by normalised query.
              Promote useful searches to featured quick-filter chips that appear on every Principal Dashboard.
              Featured searches replay with <strong>zero AI cost</strong> — the interpretation is cached at the
              time the search was first run.
            </p>
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-md border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />Refresh
          </button>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-4 mb-4 flex items-center gap-3">
        <label className="inline-flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
          <input type="checkbox" checked={featuredOnly} onChange={e => setFeaturedOnly(e.target.checked)} />
          Featured only
        </label>
        <span className="text-xs text-slate-500">{rows.length} {featuredOnly ? 'featured' : 'distinct'} search{rows.length === 1 ? '' : 'es'}</span>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700 mb-4">{error}</div>
      )}

      {loading && !rows.length ? (
        <div className="flex items-center justify-center py-12 text-slate-500">
          <Loader2 className="w-4 h-4 animate-spin mr-2" />Loading searches…
        </div>
      ) : rows.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-lg p-10 text-center text-sm text-slate-500 italic">
          No portal searches yet. They&apos;ll appear here as your users start using the search box on their dashboards.
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map(row => {
            const interp = row.interpretedFilters || {};
            const currentLabel = draftLabels[row.representativeId] ?? row.featuredLabel ?? '';
            return (
              <div key={row.representativeId} className={`border rounded-lg p-4 ${row.featured ? 'bg-indigo-50 border-indigo-200' : 'bg-white border-slate-200'}`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      {row.featured && <Star className="w-4 h-4 text-indigo-500 fill-indigo-500" />}
                      <span className="text-sm font-medium text-slate-900">&ldquo;{row.query}&rdquo;</span>
                    </div>
                    {interp?.reasoning && (
                      <p className="text-[11px] text-slate-500 mt-1 italic">
                        AI interpreted: {interp.reasoning}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {interp?.status && (
                        <span className="text-[10px] bg-blue-100 text-blue-800 border border-blue-200 rounded-full px-2 py-0.5">
                          status: {interp.status}
                        </span>
                      )}
                      {Array.isArray(interp?.fsLineIds) && interp.fsLineIds.length > 0 && (
                        <span className="text-[10px] bg-slate-100 text-slate-700 border border-slate-200 rounded-full px-2 py-0.5">
                          {interp.fsLineIds.length} FS Line{interp.fsLineIds.length === 1 ? '' : 's'}
                        </span>
                      )}
                      {Array.isArray(interp?.tbAccountCodes) && interp.tbAccountCodes.length > 0 && (
                        <span className="text-[10px] bg-slate-100 text-slate-700 border border-slate-200 rounded-full px-2 py-0.5">
                          {interp.tbAccountCodes.length} TB code{interp.tbAccountCodes.length === 1 ? '' : 's'}
                        </span>
                      )}
                      {Array.isArray(interp?.assigneeIds) && interp.assigneeIds.length > 0 && (
                        <span className="text-[10px] bg-slate-100 text-slate-700 border border-slate-200 rounded-full px-2 py-0.5">
                          {interp.assigneeIds.length} assignee{interp.assigneeIds.length === 1 ? '' : 's'}
                        </span>
                      )}
                      {interp?.textMatch && (
                        <span className="text-[10px] bg-slate-100 text-slate-700 border border-slate-200 rounded-full px-2 py-0.5">
                          text: &ldquo;{interp.textMatch}&rdquo;
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-500 mt-2">
                      Run {row.runCount}× · {row.distinctUsers} user{row.distinctUsers === 1 ? '' : 's'} · avg {row.avgResults} result{row.avgResults === 1 ? '' : 's'} · last {new Date(row.lastRunAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {row.featured ? (
                      <>
                        <input
                          value={currentLabel}
                          onChange={e => setDraftLabels(d => ({ ...d, [row.representativeId]: e.target.value }))}
                          onBlur={() => {
                            const newLabel = draftLabels[row.representativeId];
                            if (newLabel !== undefined && newLabel !== row.featuredLabel) {
                              toggleFeatured(row, true, newLabel);
                            }
                          }}
                          className="text-xs border border-slate-300 rounded px-2 py-1 w-48"
                          placeholder="Chip label"
                        />
                        <button
                          onClick={() => toggleFeatured(row, false)}
                          disabled={savingId === row.representativeId}
                          className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                        >
                          {savingId === row.representativeId ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Un-feature'}
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => toggleFeatured(row, true)}
                        disabled={savingId === row.representativeId}
                        className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
                      >
                        {savingId === row.representativeId ? <Loader2 className="w-3 h-3 animate-spin" /> : <><Star className="w-3 h-3" />Feature</>}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
