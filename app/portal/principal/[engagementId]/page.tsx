'use client';

/**
 * Portal Principal dashboard — per-engagement view.
 *
 * Sections:
 *   Header: client / period / SLA summary + "Open setup" link
 *   KPI tiles: outstanding / overdue / escalated / clean-first-time %
 *   Filter bar: status / FS Line / assignee / text search
 *   Charts (inline SVG, zero deps):
 *     - Stacked bar showing 30-day outstanding + responded trend
 *     - Response time per staff (horizontal bars for mean/median/p90)
 *   Request list: paginated table with per-row status badge, assignee,
 *                 FS Line pill, "returned for more" flag, time-to-
 *                 respond, click-to-open (reserved for future detail).
 *
 * Charts are deliberately plain SVG — avoids pulling in a charting lib
 * just for this, keeps bundle size flat, and renders fine on the
 * portal's typical client environment.
 */

import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { AlertTriangle, Clock, CheckCircle2, TrendingUp, RefreshCw, Settings, Loader2, Filter, ChevronDown, ChevronRight, X } from 'lucide-react';

interface PrincipalDashboardData {
  engagementId: string;
  sla: { days1: number; days2: number; days3: number; source: string };
  totals: {
    all: number; outstanding: number; responded: number; verified: number;
    overdue: number; escalated: number; cleanFirstTime: number; returnedForMore: number;
  };
  responseStats: {
    overall: { n: number; meanHours: number | null; medianHours: number | null; p90Hours: number | null };
    perStaff: Array<{ userId: string; name: string; n: number; meanHours: number | null; medianHours: number | null; p90Hours: number | null }>;
  };
  trend: Array<{ date: string; outstanding: number; responded: number }>;
  filters: {
    fsLines: Array<{
      id: string;
      name: string;
      tbCodes: Array<{ accountCode: string; description: string }>;
    }>;
    staff: Array<{ id: string; name: string }>;
  };
  list: {
    rows: Array<{
      id: string; section: string; question: string; status: string;
      requestedAt: string; respondedAt?: string | null;
      respondedByName?: string | null;
      escalationLevel: number; assignedPortalUserId: string | null;
      assignedPortalUserName: string | null;
      routingFsLineId: string | null; routingFsLineName: string | null;
      routingTbAccountCode: string | null;
      isReturned: boolean;
    }>;
    total: number; limit: number; offset: number;
  };
}

interface PrincipalClientSummary {
  id: string;
  clientName: string;
  auditType: string;
  periodStart?: string | null;
  periodEnd?: string | null;
  setupCompletedAt?: string | null;
}

export default function PortalPrincipalDashboardPage({ params }: { params: Promise<{ engagementId: string }> }) {
  const { engagementId } = use(params);
  const searchParams = useSearchParams();
  const token = searchParams.get('token') || '';

  const [data, setData] = useState<PrincipalDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Multi-client multi-select: when the Portal Principal covers more
  // than one engagement, surface every one as a toggleable pill at the
  // top of the dashboard so they can aggregate metrics across clients
  // (or just focus on one). Loaded once from /api/portal/my-engagements.
  // The URL's engagementId is always the "anchor" and is included by
  // default; additional engagements layer on via the `engagementIds`
  // query param passed to the API.
  const [principalEngagements, setPrincipalEngagements] = useState<PrincipalClientSummary[]>([]);
  const [selectedEngagementIds, setSelectedEngagementIds] = useState<Set<string>>(new Set([engagementId]));
  useEffect(() => {
    if (!token) return;
    fetch(`/api/portal/my-engagements?token=${token}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (Array.isArray(d?.principalFor)) {
          setPrincipalEngagements(d.principalFor.filter((e: PrincipalClientSummary) => e.setupCompletedAt));
        }
      })
      .catch(() => {});
  }, [token]);
  // Load the caller's saved searches + the firm's featured searches
  // once per mount. Featured chips render alongside user saved chips
  // on the dashboard, visually distinguished.
  useEffect(() => {
    if (!token) return;
    fetch(`/api/portal/ai-search/saved?token=${encodeURIComponent(token)}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (Array.isArray(d?.saved)) setSavedSearches(d.saved); })
      .catch(() => {});
    fetch(`/api/portal/ai-search/featured?token=${encodeURIComponent(token)}&engagementId=${encodeURIComponent(engagementId)}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (Array.isArray(d?.featured)) setFeaturedSearches(d.featured); })
      .catch(() => {});
  }, [token, engagementId]);

  // Apply an interpreted-filter object to the dashboard's filter
  // state. Shared by "run AI search" and "replay saved search".
  function applyInterpreted(i: any) {
    setFilterStatus(i?.status || '');
    setFilterFsLineIds(new Set(Array.isArray(i?.fsLineIds) ? i.fsLineIds : []));
    setFilterTbCodes(new Set(Array.isArray(i?.tbAccountCodes) ? i.tbAccountCodes : []));
    setFilterAssignee(Array.isArray(i?.assigneeIds) && i.assigneeIds[0] ? i.assigneeIds[0] : '');
    setFilterText(i?.textMatch || '');
    setAiInterpreted(i);
    setOffset(0);
  }

  async function runAiSearch() {
    if (!aiQuery.trim()) return;
    setAiSearching(true); setAiError(null);
    try {
      const r = await fetch(`/api/portal/ai-search?token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          engagementIds: [...selectedEngagementIds],
          query: aiQuery,
        }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d?.error || `Search failed (${r.status})`);
      }
      const d = await r.json();
      applyInterpreted(d.interpreted);
      setAiLogId(d.logId || null);
    } catch (err: any) {
      setAiError(err?.message || 'Search failed');
    } finally {
      setAiSearching(false);
    }
  }

  function clearAiSearch() {
    setAiQuery('');
    setAiInterpreted(null);
    setAiLogId(null);
    setAiError(null);
    setFilterStatus('');
    setFilterFsLineIds(new Set());
    setFilterTbCodes(new Set());
    setFilterAssignee('');
    setFilterText('');
    setOffset(0);
  }

  async function saveCurrentSearch() {
    if (!aiLogId || !saveLabelDraft.trim()) return;
    try {
      const r = await fetch(`/api/portal/ai-search/saved?token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logId: aiLogId, label: saveLabelDraft.trim() }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || 'Save failed');
      const d = await r.json();
      setSavedSearches(prev => [d.saved, ...prev.filter(s => s.id !== d.saved.id)]);
      setSaveLabelDraft('');
      setShowSaveDialog(false);
    } catch (err: any) {
      setAiError(err?.message || 'Save failed');
    }
  }

  async function deleteSavedSearch(id: string) {
    try {
      const r = await fetch(`/api/portal/ai-search/saved/${id}?token=${encodeURIComponent(token)}`, { method: 'DELETE' });
      if (!r.ok) throw new Error('Delete failed');
      setSavedSearches(prev => prev.filter(s => s.id !== id));
    } catch (err: any) {
      setAiError(err?.message || 'Delete failed');
    }
  }

  function runSavedSearch(s: SavedSearch) {
    // Zero-AI replay — apply the cached interpretation directly.
    setAiQuery(s.query);
    applyInterpreted(s.interpretedFilters);
  }

  function toggleEngagement(id: string) {
    setSelectedEngagementIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        // Don't allow deselecting the anchor engagement — the URL
        // represents the caller's "home" dashboard. If they want a
        // different anchor they can click its pill which routes to
        // /portal/principal/<thatId>.
        if (id === engagementId) return prev;
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
    setOffset(0);
  }

  const [filterStatus, setFilterStatus] = useState<string>('');
  // Multi-select: Sets of selected FS Line IDs + TB account codes.
  // Drives a popover filter rather than a simple dropdown, because
  // TB codes live underneath their FS Lines and a flat list would
  // be too long / unclear.
  const [filterFsLineIds, setFilterFsLineIds] = useState<Set<string>>(new Set());
  const [filterTbCodes, setFilterTbCodes] = useState<Set<string>>(new Set());
  const [filterAssignee, setFilterAssignee] = useState<string>('');
  const [filterText, setFilterText] = useState('');

  // AI-powered natural-language search. The search box no longer
  // filters as-you-type — users hit Enter (or click Search) and the
  // query goes to /api/portal/ai-search, which returns a structured
  // filter object + interpretation. The filter layers on top of the
  // other filters (status / multi-select / etc), so a user can e.g.
  // narrow by Revenue FS Line AND ask "anything about bank statements".
  const [aiQuery, setAiQuery] = useState('');
  const [aiSearching, setAiSearching] = useState(false);
  const [aiInterpreted, setAiInterpreted] = useState<any>(null);      // last interpretation
  const [aiLogId, setAiLogId] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  // Per-user saved searches (zero-AI replays).
  interface SavedSearch { id: string; query: string; savedLabel: string; interpretedFilters: any; }
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([]);
  const [saveLabelDraft, setSaveLabelDraft] = useState('');
  const [showSaveDialog, setShowSaveDialog] = useState(false);

  // Firm-featured searches — promoted by Methodology Admin. Also
  // zero-AI replay (interpretedFilters cached on the log row).
  interface FeaturedSearch { id: string; query: string; featuredLabel: string; interpretedFilters: any; }
  const [featuredSearches, setFeaturedSearches] = useState<FeaturedSearch[]>([]);
  // Drill-down dimension: when set by clicking a chart, narrows the
  // list view to the chart segment. Orthogonal to the dropdown filters
  // so a user can stack them.
  const [drillDown, setDrillDown] = useState<
    | { kind: 'day'; date: string; metric: 'outstanding' | 'responded' }
    | { kind: 'staff'; userId: string; name: string }
    | null
  >(null);
  const [offset, setOffset] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qp = new URLSearchParams({ token, engagementId, offset: String(offset), limit: '50' });
      // When more than the anchor engagement is selected, pass the
      // full list so the API aggregates. The anchor is always present
      // in selectedEngagementIds (see toggleEngagement guard).
      if (selectedEngagementIds.size > 1) {
        qp.set('engagementIds', [...selectedEngagementIds].join(','));
      }
      if (filterStatus) qp.set('status', filterStatus);
      if (filterFsLineIds.size > 0) qp.set('fsLineIds', [...filterFsLineIds].join(','));
      if (filterTbCodes.size > 0) qp.set('tbAccountCodes', [...filterTbCodes].join(','));
      if (filterAssignee) qp.set('assigneeId', filterAssignee);
      if (filterText) qp.set('q', filterText);
      if (drillDown?.kind === 'day') {
        qp.set('day', drillDown.date);
        qp.set('dayMetric', drillDown.metric);
      }
      if (drillDown?.kind === 'staff') qp.set('assigneeId', drillDown.userId);
      const r = await fetch(`/api/portal/principal-dashboard?${qp.toString()}`, { cache: 'no-store' });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d?.error || `Failed (${r.status})`);
      }
      setData(await r.json());
    } catch (err: any) {
      setError(err?.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [token, engagementId, offset, filterStatus, filterFsLineIds, filterTbCodes, filterAssignee, filterText, drillDown, selectedEngagementIds]);

  useEffect(() => { load(); }, [load]);

  if (loading && !data) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-slate-500 inline-flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />Loading dashboard…</div>
      </div>
    );
  }
  if (error && !data) {
    return (
      <div className="min-h-screen bg-slate-50 p-6">
        <div className="max-w-2xl mx-auto bg-white border border-red-200 rounded-lg p-6 text-sm text-red-700">{error}</div>
      </div>
    );
  }
  if (!data) return null;

  const { totals, sla, responseStats, trend } = data;
  const cleanRate = (totals.cleanFirstTime + totals.returnedForMore) > 0
    ? Math.round(100 * totals.cleanFirstTime / (totals.cleanFirstTime + totals.returnedForMore))
    : null;

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-6xl mx-auto space-y-5">
        {/* Header — client name + SLA + action buttons on the right. */}
        {/* The current engagement's client name is pulled from the     */}
        {/* principalEngagements list (loaded separately) so we can     */}
        {/* label the page clearly when the user Principals for multiple */}
        {/* clients.                                                    */}
        {(() => {
          const currentEngagement = principalEngagements.find(e => e.id === engagementId);
          return (
            <div className="flex items-start justify-between bg-white border border-slate-200 rounded-lg p-5">
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-wide">Portal Principal Dashboard</p>
                <h1 className="text-xl font-semibold text-slate-800 mt-0.5">
                  {currentEngagement?.clientName || 'Engagement requests & responses'}
                </h1>
                <p className="text-xs text-slate-500 mt-1">
                  SLA: <strong className="text-slate-700">{sla.days1}</strong> / <strong className="text-slate-700">{sla.days2}</strong> / <strong className="text-slate-700">{sla.days3}</strong> days
                  <span className="ml-2 text-slate-400">({sla.source.replace('-', ' ')})</span>
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Link href={`/portal/setup/${engagementId}?token=${token}`} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-slate-300 text-sm hover:bg-slate-50">
                  <Settings className="w-4 h-4" />Setup
                </Link>
                <button onClick={() => load()} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-blue-600 text-white text-sm hover:bg-blue-700" disabled={loading}>
                  <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />Refresh
                </button>
              </div>
            </div>
          );
        })()}

        {/* Multi-select of clients — when the Portal Principal covers  */}
        {/* more than one engagement they can tick multiple and the     */}
        {/* dashboard aggregates: totals sum, filter options union,     */}
        {/* list shows requests across every selected engagement. The   */}
        {/* URL always carries a single anchor engagementId for         */}
        {/* bookmark stability; the multi-select layers additional     */}
        {/* engagements on top via a query param.                       */}
        {principalEngagements.length > 1 && (
          <div className="bg-white border border-slate-200 rounded-lg p-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-medium text-slate-600 mr-1">Clients:</span>
              {principalEngagements.map(e => {
                const isSelected = selectedEngagementIds.has(e.id);
                return (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => toggleEngagement(e.id)}
                    className={`inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border transition-colors ${isSelected ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-slate-50 border-slate-300 text-slate-700 hover:bg-slate-100'}`}
                    title={`${e.clientName} · ${e.auditType}`}
                  >
                    {isSelected && <span className="inline-block w-1.5 h-1.5 rounded-full bg-white" />}
                    {e.clientName}
                  </button>
                );
              })}
              {selectedEngagementIds.size > 1 && (
                <span className="text-[11px] text-slate-500 ml-2">
                  Aggregating across {selectedEngagementIds.size} engagements
                </span>
              )}
            </div>
          </div>
        )}

        {/* KPI tiles — each one is a click-through to the list with the */}
        {/* matching status filter applied, so the whole header acts as a  */}
        {/* drill-down surface.                                            */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KpiTile
            label="Outstanding" value={totals.outstanding}
            icon={<Clock className="w-4 h-4" />} tone="blue"
            onClick={() => { setFilterStatus('outstanding'); setDrillDown(null); setOffset(0); }}
            active={filterStatus === 'outstanding'}
          />
          <KpiTile
            label="Overdue (SLA breached)" value={totals.overdue}
            icon={<AlertTriangle className="w-4 h-4" />} tone={totals.overdue > 0 ? 'amber' : 'slate'}
            onClick={() => { setFilterStatus('overdue'); setDrillDown(null); setOffset(0); }}
            active={filterStatus === 'overdue'}
          />
          <KpiTile
            label="Escalated" value={totals.escalated}
            icon={<TrendingUp className="w-4 h-4" />} tone={totals.escalated > 0 ? 'red' : 'slate'}
            onClick={() => { setFilterStatus('escalated'); setDrillDown(null); setOffset(0); }}
            active={filterStatus === 'escalated'}
          />
          <KpiTile
            label="Clean-first-time rate"
            value={cleanRate == null ? '—' : `${cleanRate}%`}
            icon={<CheckCircle2 className="w-4 h-4" />}
            tone={cleanRate != null && cleanRate >= 80 ? 'emerald' : cleanRate != null && cleanRate >= 60 ? 'amber' : 'slate'}
            subtitle={cleanRate == null ? 'No responses yet' : `${totals.cleanFirstTime} / ${totals.cleanFirstTime + totals.returnedForMore}`}
          />
        </div>

        {/* Drill-down chip — shows when a chart click is scoping the list */}
        {drillDown && (
          <div className="inline-flex items-center gap-2 bg-indigo-50 border border-indigo-200 text-indigo-800 text-xs rounded-full px-3 py-1.5">
            <span>
              Drilled into: {drillDown.kind === 'day'
                ? `${drillDown.metric === 'outstanding' ? 'Outstanding on' : 'Responded on'} ${drillDown.date}`
                : `Assigned to ${drillDown.name}`}
            </span>
            <button onClick={() => { setDrillDown(null); setOffset(0); }} className="text-indigo-600 hover:text-indigo-900 font-semibold">Clear</button>
          </div>
        )}

        {/* Charts row — both drill down into the list view. */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Trend chart */}
          <div className="bg-white border border-slate-200 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-slate-800">30-day activity</h3>
              <p className="text-[11px] text-slate-500">Click a bar or point to drill in</p>
            </div>
            <TrendChart
              trend={trend}
              onDay={(date, metric) => {
                setDrillDown({ kind: 'day', date, metric });
                setOffset(0);
              }}
            />
          </div>

          {/* Per-staff response times */}
          <div className="bg-white border border-slate-200 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-slate-800">Response speed by staff</h3>
              <p className="text-[11px] text-slate-500">Click a row to drill into that assignee</p>
            </div>
            <StaffSpeedChart
              staff={responseStats.perStaff}
              overall={responseStats.overall}
              onStaff={(userId, name) => {
                setDrillDown({ kind: 'staff', userId, name });
                setOffset(0);
              }}
            />
          </div>
        </div>

        {/* AI search bar — natural-language, grounded on the engagement's
            actual FS Lines / TB codes / staff (so the model can only
            emit IDs that exist). Hitting Enter or clicking Search
            sends one AI request, caches the interpretation so it can
            be re-run for free later, and applies the resulting filter
            on top of the dropdown filters below. */}
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <Filter className="w-4 h-4 text-slate-500" />
            <span className="text-sm font-medium text-slate-700">Search requests</span>
            <span className="text-[11px] text-slate-400">— ask in plain English: &quot;overdue from Alice&quot;, &quot;bank statements outstanding&quot;, etc.</span>
          </div>
          <div className="flex gap-2">
            <input
              value={aiQuery}
              onChange={e => setAiQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') runAiSearch(); }}
              placeholder="What are you looking for?"
              disabled={aiSearching}
              className="flex-1 text-sm border border-slate-300 rounded-md px-3 py-1.5"
            />
            <button
              onClick={runAiSearch}
              disabled={aiSearching || !aiQuery.trim()}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {aiSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Filter className="w-4 h-4" />}
              Search
            </button>
            {aiInterpreted && (
              <>
                <button
                  onClick={() => { setShowSaveDialog(v => !v); setSaveLabelDraft(''); }}
                  disabled={!aiLogId}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-md border border-emerald-300 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                  title="Save this search for quick re-use"
                >
                  Save
                </button>
                <button
                  onClick={clearAiSearch}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50"
                >Clear</button>
              </>
            )}
          </div>

          {/* AI interpretation pill + save dialog */}
          {aiInterpreted?.reasoning && (
            <div className="mt-2 text-[11px] text-indigo-700 bg-indigo-50 border border-indigo-200 rounded px-3 py-1.5">
              <strong>Interpreted as:</strong> {aiInterpreted.reasoning}
            </div>
          )}
          {aiError && (
            <div className="mt-2 text-[11px] text-red-700 bg-red-50 border border-red-200 rounded px-3 py-1.5">{aiError}</div>
          )}
          {showSaveDialog && aiLogId && (
            <div className="mt-2 flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded p-2">
              <span className="text-xs text-emerald-800 font-medium">Name this search:</span>
              <input
                autoFocus
                value={saveLabelDraft}
                onChange={e => setSaveLabelDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') saveCurrentSearch(); }}
                placeholder="e.g. Overdue bank items for Alice"
                className="flex-1 text-xs border border-emerald-300 rounded px-2 py-1"
              />
              <button
                onClick={saveCurrentSearch}
                disabled={!saveLabelDraft.trim()}
                className="text-xs bg-emerald-600 text-white px-3 py-1 rounded hover:bg-emerald-700 disabled:opacity-50"
              >Save</button>
              <button
                onClick={() => { setShowSaveDialog(false); setSaveLabelDraft(''); }}
                className="text-xs text-slate-600 hover:text-slate-900"
              >Cancel</button>
            </div>
          )}

          {/* Firm-featured chips (promoted by Methodology Admin) — */}
          {/*   indigo, with a small star marker to distinguish from */}
          {/*   user-saved chips. Same zero-AI replay mechanism.     */}
          {featuredSearches.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-medium text-indigo-600">Featured by your audit team:</span>
              {featuredSearches.map(s => (
                <button
                  key={s.id}
                  onClick={() => {
                    setAiQuery(s.query);
                    applyInterpreted(s.interpretedFilters);
                  }}
                  className="inline-flex items-center gap-1 text-xs bg-indigo-50 border border-indigo-300 rounded-full px-2.5 py-1 text-indigo-800 hover:bg-indigo-100"
                  title={`Replay: ${s.query}`}
                >
                  <span className="text-indigo-500">★</span>{s.featuredLabel}
                </button>
              ))}
            </div>
          )}

          {/* Per-user saved-search chips — zero-AI replay. */}
          {savedSearches.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-medium text-slate-500">Your saved searches:</span>
              {savedSearches.map(s => (
                <span key={s.id} className="inline-flex items-center gap-1 text-xs bg-slate-100 border border-slate-300 rounded-full px-2.5 py-1 text-slate-700">
                  <button
                    onClick={() => runSavedSearch(s)}
                    className="hover:text-blue-700"
                    title={`Replay: ${s.query}`}
                  >{s.savedLabel}</button>
                  <button
                    onClick={() => deleteSavedSearch(s.id)}
                    className="text-slate-400 hover:text-red-600"
                    title="Remove"
                  ><X className="w-3 h-3" /></button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Filter bar — dropdowns compose ON TOP of AI search. Users */}
        {/*  can pick a natural-language search AND tweak dropdowns.   */}
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <Filter className="w-4 h-4 text-slate-500" />
            <span className="text-sm font-medium text-slate-700">Narrow further</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
            <select value={filterStatus} onChange={e => { setFilterStatus(e.target.value); setOffset(0); }} className="text-sm border border-slate-300 rounded-md px-3 py-1.5">
              <option value="">All statuses</option>
              <option value="outstanding">Outstanding</option>
              <option value="overdue">Overdue (SLA breached)</option>
              <option value="escalated">Escalated</option>
              <option value="responded">Responded</option>
            </select>
            <FsLineTbMultiSelect
              fsLines={data.filters.fsLines}
              selectedFsLineIds={filterFsLineIds}
              selectedTbCodes={filterTbCodes}
              onChange={(fs, tb) => { setFilterFsLineIds(fs); setFilterTbCodes(tb); setOffset(0); }}
            />
            <select value={filterAssignee} onChange={e => { setFilterAssignee(e.target.value); setOffset(0); }} className="text-sm border border-slate-300 rounded-md px-3 py-1.5">
              <option value="">All assignees</option>
              {data.filters.staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <input
              value={filterText}
              onChange={e => { setFilterText(e.target.value); setOffset(0); }}
              placeholder="Extra text filter (optional)"
              className="text-sm border border-slate-300 rounded-md px-3 py-1.5"
            />
          </div>
        </div>

        {/* AI-suggested chart — rendered when the search interpretation
             includes a chart spec (type !== 'none'). Data is computed
             client-side from the filtered list on the dashboard, so
             the chart is always consistent with what the table shows. */}
        {aiInterpreted?.chart && aiInterpreted.chart.type !== 'none' && data.list.rows.length > 0 && (
          <AiQueryChart spec={aiInterpreted.chart} rows={data.list.rows} staff={data.filters.staff} fsLines={data.filters.fsLines} />
        )}

        {/* Request list */}
        <div className="bg-white border border-slate-200 rounded-lg">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-slate-500 border-b border-slate-200">
                <th className="text-left font-medium px-4 py-2">Status</th>
                <th className="text-left font-medium">Question</th>
                <th className="text-left font-medium">FS Line / TB</th>
                <th className="text-left font-medium">Assignee</th>
                <th className="text-right font-medium">Age</th>
                <th className="text-right font-medium pr-4">Response</th>
              </tr>
            </thead>
            <tbody>
              {data.list.rows.map(r => (
                <tr key={r.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  <td className="px-4 py-2">
                    <StatusBadge status={r.status} escalationLevel={r.escalationLevel} isReturned={r.isReturned} />
                  </td>
                  <td className="text-slate-700 max-w-md truncate" title={r.question}>{r.question}</td>
                  <td className="text-slate-600">
                    {r.routingFsLineName ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 text-[11px]">
                        {r.routingFsLineName}{r.routingTbAccountCode ? ` · ${r.routingTbAccountCode}` : ''}
                      </span>
                    ) : <span className="text-[11px] text-slate-400">—</span>}
                  </td>
                  <td className="text-slate-600 text-xs">{r.assignedPortalUserName || <span className="text-slate-400">unassigned</span>}</td>
                  <td className="text-right text-xs text-slate-500 whitespace-nowrap">{ageLabel(r.requestedAt)}</td>
                  <td className="text-right text-xs pr-4 whitespace-nowrap">
                    {r.respondedAt ? (
                      <span className="text-slate-700">{responseTime(r.requestedAt, r.respondedAt)}</span>
                    ) : <span className="text-slate-400">—</span>}
                  </td>
                </tr>
              ))}
              {data.list.rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-xs text-slate-500 italic">No requests match the current filters.</td>
                </tr>
              )}
            </tbody>
          </table>
          <ListPaginator total={data.list.total} offset={data.list.offset} limit={data.list.limit} onOffset={setOffset} />
        </div>
      </div>
    </div>
  );
}

// ─── KPI tile ──────────────────────────────────────────────────────

function KpiTile({ label, value, icon, tone, subtitle, onClick, active }: { label: string; value: number | string; icon: React.ReactNode; tone: 'blue' | 'amber' | 'red' | 'emerald' | 'slate'; subtitle?: string; onClick?: () => void; active?: boolean }) {
  const toneClass =
    tone === 'blue'    ? 'bg-blue-50 border-blue-200 text-blue-800'
    : tone === 'amber' ? 'bg-amber-50 border-amber-200 text-amber-800'
    : tone === 'red'   ? 'bg-red-50 border-red-200 text-red-800'
    : tone === 'emerald' ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
    : 'bg-slate-50 border-slate-200 text-slate-700';
  const activeRing = active ? 'ring-2 ring-offset-1 ring-indigo-400' : '';
  const body = (
    <>
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide">
        {icon}{label}
      </div>
      <div className="text-2xl font-semibold mt-2">{value}</div>
      {subtitle && <div className="text-[11px] opacity-80 mt-0.5">{subtitle}</div>}
    </>
  );
  if (onClick) {
    return (
      <button onClick={onClick} className={`text-left border rounded-lg p-4 ${toneClass} ${activeRing} hover:shadow-sm transition-all`}>
        {body}
      </button>
    );
  }
  return <div className={`border rounded-lg p-4 ${toneClass}`}>{body}</div>;
}

// ─── Status badge ──────────────────────────────────────────────────

function StatusBadge({ status, escalationLevel, isReturned }: { status: string; escalationLevel: number; isReturned: boolean }) {
  if (status === 'responded' || status === 'verified' || status === 'committed') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] bg-emerald-50 border-emerald-200 text-emerald-700">
        Responded{isReturned ? ' · returned' : ''}
      </span>
    );
  }
  if (escalationLevel >= 3) {
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] bg-red-50 border-red-200 text-red-700">Escalated to you</span>;
  }
  if (escalationLevel > 0) {
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] bg-amber-50 border-amber-200 text-amber-700">Escalated · col {escalationLevel + 1}</span>;
  }
  return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] bg-slate-50 border-slate-200 text-slate-700">Outstanding</span>;
}

// ─── Helpers ───────────────────────────────────────────────────────

function ageLabel(iso: string): string {
  const hours = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  if (hours < 1) return '< 1h';
  if (hours < 24) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}

function responseTime(requested: string, responded: string): string {
  const hours = (new Date(responded).getTime() - new Date(requested).getTime()) / 3_600_000;
  if (hours < 1) return '< 1h';
  if (hours < 24) return `${Math.round(hours * 10) / 10}h`;
  return `${Math.round(hours / 24 * 10) / 10}d`;
}

// ─── Trend chart (inline SVG) ─────────────────────────────────────

function TrendChart({ trend, onDay }: { trend: Array<{ date: string; outstanding: number; responded: number }>; onDay?: (date: string, metric: 'outstanding' | 'responded') => void }) {
  const w = 560;
  const h = 160;
  const pad = { top: 10, bottom: 20, left: 28, right: 8 };
  const innerW = w - pad.left - pad.right;
  const innerH = h - pad.top - pad.bottom;
  const maxOut = Math.max(1, ...trend.map(t => t.outstanding));
  const maxResp = Math.max(1, ...trend.map(t => t.responded));
  const yScale = (v: number, max: number) => innerH - (v / max) * innerH;
  const xStep = innerW / Math.max(1, trend.length - 1);
  const barW = innerW / trend.length * 0.7;
  const linePoints = trend.map((t, i) => `${pad.left + i * xStep},${pad.top + yScale(t.outstanding, maxOut)}`).join(' ');

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-[160px]">
      <text x={2} y={pad.top + 4} fontSize={9} fill="#94a3b8">{maxOut}</text>
      <text x={2} y={pad.top + innerH} fontSize={9} fill="#94a3b8">0</text>
      {/* Bars — responded per day (click drills into responses on that day) */}
      {trend.map((t, i) => {
        const height = (t.responded / maxResp) * (innerH * 0.5);
        return (
          <rect
            key={t.date}
            x={pad.left + i * xStep - barW / 2}
            y={pad.top + innerH - height}
            width={barW}
            height={Math.max(1, height)}
            fill="#93c5fd"
            style={{ cursor: onDay && t.responded > 0 ? 'pointer' : 'default' }}
            onClick={onDay && t.responded > 0 ? () => onDay(t.date, 'responded') : undefined}
          >
            <title>{`${t.date}: ${t.responded} responded${onDay && t.responded > 0 ? ' — click to filter' : ''}`}</title>
          </rect>
        );
      })}
      {/* Line + clickable dots — outstanding-on-day drill-down */}
      <polyline points={linePoints} fill="none" stroke="#1d4ed8" strokeWidth={1.5} />
      {trend.map((t, i) => (
        <circle
          key={t.date}
          cx={pad.left + i * xStep}
          cy={pad.top + yScale(t.outstanding, maxOut)}
          r={3}
          fill="#1d4ed8"
          style={{ cursor: onDay && t.outstanding > 0 ? 'pointer' : 'default' }}
          onClick={onDay && t.outstanding > 0 ? () => onDay(t.date, 'outstanding') : undefined}
        >
          <title>{`${t.date}: ${t.outstanding} outstanding${onDay && t.outstanding > 0 ? ' — click to filter' : ''}`}</title>
        </circle>
      ))}
      <text x={pad.left} y={h - 4} fontSize={9} fill="#94a3b8">{trend[0]?.date?.slice(5)}</text>
      <text x={w - pad.right} y={h - 4} fontSize={9} fill="#94a3b8" textAnchor="end">{trend[trend.length - 1]?.date?.slice(5)}</text>
    </svg>
  );
}

// ─── Per-staff speed chart ────────────────────────────────────────

function StaffSpeedChart({ staff, overall, onStaff }: { staff: Array<{ userId: string; name: string; n: number; meanHours: number | null; medianHours: number | null; p90Hours: number | null }>; overall: { n: number; meanHours: number | null; medianHours: number | null; p90Hours: number | null }; onStaff?: (userId: string, name: string) => void }) {
  const nonZero = staff.filter(s => s.n > 0);
  if (nonZero.length === 0) {
    return <p className="text-xs text-slate-500 italic">No responses yet — charts will populate once requests start being answered.</p>;
  }
  const maxHours = Math.max(1, ...nonZero.map(s => s.p90Hours || s.meanHours || 0));

  return (
    <div className="space-y-3">
      <div className="text-[11px] text-slate-500">Overall: mean {overall.meanHours ?? '—'}h · median {overall.medianHours ?? '—'}h · p90 {overall.p90Hours ?? '—'}h · n={overall.n}</div>
      {nonZero.map(s => (
        <button
          key={s.userId}
          onClick={onStaff ? () => onStaff(s.userId, s.name) : undefined}
          className={`w-full text-left rounded-md px-2 py-1 -mx-2 ${onStaff ? 'hover:bg-slate-50 cursor-pointer' : 'cursor-default'}`}
          title={onStaff ? 'Click to drill into this assignee' : undefined}
        >
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-700 truncate" title={s.name}>{s.name}</span>
            <span className="text-slate-500 font-mono text-[11px] whitespace-nowrap">median {s.medianHours}h · n={s.n}</span>
          </div>
          <div className="relative h-3 bg-slate-100 rounded-full mt-1 overflow-hidden">
            <div className="absolute inset-y-0 left-0 bg-blue-200 rounded-full" style={{ width: `${((s.p90Hours || 0) / maxHours) * 100}%` }} />
            <div className="absolute inset-y-0 left-0 bg-blue-600 rounded-full" style={{ width: `${((s.meanHours || 0) / maxHours) * 100}%` }} />
            <div className="absolute top-0 h-full w-0.5 bg-slate-700" style={{ left: `${((s.medianHours || 0) / maxHours) * 100}%` }} />
          </div>
        </button>
      ))}
      <div className="text-[10px] text-slate-400">Dark = mean hours · light = p90 · tick = median. All bars scaled to {Math.round(maxHours)}h.</div>
    </div>
  );
}

// ─── Paginator ─────────────────────────────────────────────────────

function ListPaginator({ total, offset, limit, onOffset }: { total: number; offset: number; limit: number; onOffset: (n: number) => void }) {
  if (total <= limit) return null;
  const start = offset + 1;
  const end = Math.min(offset + limit, total);
  return (
    <div className="flex items-center justify-between px-4 py-2 border-t border-slate-100 text-xs text-slate-500">
      <span>Showing {start}–{end} of {total}</span>
      <div className="flex items-center gap-2">
        <button
          onClick={() => onOffset(Math.max(0, offset - limit))}
          disabled={offset === 0}
          className="px-2 py-1 border border-slate-300 rounded disabled:opacity-40 hover:bg-slate-50"
        >Prev</button>
        <button
          onClick={() => onOffset(offset + limit)}
          disabled={end >= total}
          className="px-2 py-1 border border-slate-300 rounded disabled:opacity-40 hover:bg-slate-50"
        >Next</button>
      </div>
    </div>
  );
}

// ─── AI-suggested chart ───────────────────────────────────────────
//
// Aggregates the currently-filtered list against the AI's chart
// spec and renders a simple SVG visualisation. The chart spec is
// validated server-side (allow-listed type / groupBy / metric)
// so anything that reaches here is safe to render. Zero external
// chart library — matches the other SVG charts on this page.

interface ListRow {
  id: string; section: string; question: string; status: string;
  requestedAt: string; respondedAt?: string | null;
  escalationLevel: number; assignedPortalUserId: string | null;
  assignedPortalUserName: string | null;
  routingFsLineId: string | null; routingFsLineName: string | null;
  routingTbAccountCode: string | null;
  isReturned: boolean;
}

function AiQueryChart({ spec, rows, staff, fsLines }: {
  spec: { type: 'bar' | 'line' | 'pie' | 'none'; groupBy: string | null; metric: string; title: string };
  rows: ListRow[];
  staff: Array<{ id: string; name: string }>;
  fsLines: Array<{ id: string; name: string }>;
}) {
  if (spec.type === 'none' || !spec.groupBy) return null;

  // Key extraction — map each row to the grouping key + label for
  // the chart's x-axis / slice labels. Keys are used for aggregation,
  // labels for display. We prefer human-readable labels when we have
  // them (staff name, FS Line name), falling back to the raw id.
  const staffName = new Map(staff.map(s => [s.id, s.name]));
  const fsName = new Map(fsLines.map(f => [f.id, f.name]));
  function keyFor(r: ListRow): { key: string; label: string } | null {
    switch (spec.groupBy) {
      case 'assignee': {
        const id = r.assignedPortalUserId || 'unassigned';
        const label = r.assignedPortalUserName || staffName.get(id) || (id === 'unassigned' ? '(unassigned)' : id);
        return { key: id, label };
      }
      case 'fsLine': {
        const id = r.routingFsLineId || 'unknown';
        const label = r.routingFsLineName || fsName.get(id) || (id === 'unknown' ? '(no FS Line)' : id);
        return { key: id, label };
      }
      case 'status': {
        if (r.escalationLevel >= 3) return { key: 'escalated-to-principal', label: 'Escalated to Principal' };
        if (r.respondedAt) return { key: 'responded', label: 'Responded' };
        if (r.escalationLevel > 0) return { key: 'escalated', label: 'Escalated' };
        return { key: 'outstanding', label: 'Outstanding' };
      }
      case 'escalationLevel': {
        const lvl = Math.max(0, Math.min(3, r.escalationLevel ?? 0));
        return { key: String(lvl), label: lvl === 0 ? 'Column 1' : lvl === 1 ? 'Column 2' : lvl === 2 ? 'Column 3' : 'Principal' };
      }
      case 'day': {
        const d = new Date(r.requestedAt);
        if (Number.isNaN(d.getTime())) return null;
        const k = d.toISOString().slice(0, 10);
        return { key: k, label: k.slice(5) };
      }
      case 'tbCode': {
        const code = r.routingTbAccountCode || 'none';
        return { key: code, label: code === 'none' ? '(no TB code)' : code };
      }
      case 'returnedForMore': {
        return r.isReturned ? { key: 'returned', label: 'Returned for more' } : { key: 'clean', label: 'Clean first time' };
      }
      default: return null;
    }
  }

  // Metric — computed per-group. `count` is trivial; time metrics
  // need assignedAt → respondedAt deltas and are skipped when the
  // row has no response yet.
  interface Bucket { key: string; label: string; rows: ListRow[]; }
  const buckets = new Map<string, Bucket>();
  for (const r of rows) {
    const k = keyFor(r);
    if (!k) continue;
    if (!buckets.has(k.key)) buckets.set(k.key, { key: k.key, label: k.label, rows: [] });
    buckets.get(k.key)!.rows.push(r);
  }

  function valueFor(b: Bucket): number {
    switch (spec.metric) {
      case 'count': return b.rows.length;
      case 'overdueCount': return b.rows.filter(r => r.escalationLevel > 0).length;
      case 'avgResponseHours': {
        const hrs: number[] = [];
        for (const r of b.rows) {
          if (!r.respondedAt) continue;
          hrs.push((new Date(r.respondedAt).getTime() - new Date(r.requestedAt).getTime()) / 3_600_000);
        }
        return hrs.length === 0 ? 0 : Math.round((hrs.reduce((s, v) => s + v, 0) / hrs.length) * 10) / 10;
      }
      case 'medianResponseHours': {
        const hrs: number[] = [];
        for (const r of b.rows) {
          if (!r.respondedAt) continue;
          hrs.push((new Date(r.respondedAt).getTime() - new Date(r.requestedAt).getTime()) / 3_600_000);
        }
        if (hrs.length === 0) return 0;
        hrs.sort((a, b) => a - b);
        return Math.round(hrs[Math.floor(hrs.length / 2)] * 10) / 10;
      }
      default: return b.rows.length;
    }
  }

  let series = [...buckets.values()].map(b => ({ label: b.label, value: valueFor(b), count: b.rows.length }));
  // Sort: bar/pie by descending value; line (day) by key ascending.
  if (spec.type === 'line' && spec.groupBy === 'day') {
    series.sort((a, b) => a.label.localeCompare(b.label));
  } else {
    series.sort((a, b) => b.value - a.value);
  }
  // Cap to 15 categories so labels stay readable — overflow lumped
  // into "Other" on bar/pie.
  if (series.length > 15 && spec.type !== 'line') {
    const top = series.slice(0, 14);
    const rest = series.slice(14);
    top.push({ label: `Other (${rest.length})`, value: rest.reduce((s, x) => s + x.value, 0), count: rest.reduce((s, x) => s + x.count, 0) });
    series = top;
  }

  const metricLabel = spec.metric === 'count' ? 'Count'
    : spec.metric === 'overdueCount' ? 'Overdue count'
    : spec.metric === 'avgResponseHours' ? 'Avg response (h)'
    : 'Median response (h)';

  const title = spec.title || `${metricLabel} by ${spec.groupBy}`;

  return (
    <div className="bg-white border border-indigo-200 rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
          <span className="text-indigo-500 text-xs">★ AI chart</span>
          {title}
        </h3>
        <p className="text-[11px] text-slate-500">{series.length} group{series.length === 1 ? '' : 's'} · from filtered list</p>
      </div>
      {spec.type === 'bar' && <HorizBarChart series={series} metricLabel={metricLabel} />}
      {spec.type === 'line' && <LineChart series={series} metricLabel={metricLabel} />}
      {spec.type === 'pie' && <PieChart series={series} />}
    </div>
  );
}

function HorizBarChart({ series, metricLabel }: { series: Array<{ label: string; value: number; count: number }>; metricLabel: string }) {
  const max = Math.max(1, ...series.map(s => s.value));
  return (
    <div className="space-y-1.5">
      {series.map((s, i) => (
        <div key={i} className="flex items-center gap-2 text-xs">
          <span className="w-40 truncate text-slate-700" title={s.label}>{s.label}</span>
          <div className="relative flex-1 h-4 bg-slate-100 rounded">
            <div
              className="absolute inset-y-0 left-0 bg-indigo-500 rounded"
              style={{ width: `${(s.value / max) * 100}%` }}
            />
            <span className="absolute inset-0 flex items-center justify-end pr-2 text-[10px] font-mono text-slate-700">
              {s.value}
            </span>
          </div>
        </div>
      ))}
      <div className="text-[10px] text-slate-400 mt-1">{metricLabel}, across {series.reduce((s, x) => s + x.count, 0)} request{series.reduce((s, x) => s + x.count, 0) === 1 ? '' : 's'}</div>
    </div>
  );
}

function LineChart({ series, metricLabel }: { series: Array<{ label: string; value: number; count: number }>; metricLabel: string }) {
  const w = 560, h = 180;
  const pad = { top: 10, bottom: 22, left: 36, right: 10 };
  const innerW = w - pad.left - pad.right;
  const innerH = h - pad.top - pad.bottom;
  const max = Math.max(1, ...series.map(s => s.value));
  const xStep = series.length > 1 ? innerW / (series.length - 1) : 0;
  const pts = series.map((s, i) => `${pad.left + i * xStep},${pad.top + innerH - (s.value / max) * innerH}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-[180px]">
      <text x={2} y={pad.top + 4} fontSize={9} fill="#94a3b8">{max}</text>
      <text x={2} y={pad.top + innerH} fontSize={9} fill="#94a3b8">0</text>
      <polyline points={pts} fill="none" stroke="#6366f1" strokeWidth={1.5} />
      {series.map((s, i) => (
        <g key={i}>
          <circle cx={pad.left + i * xStep} cy={pad.top + innerH - (s.value / max) * innerH} r={3} fill="#6366f1">
            <title>{`${s.label}: ${s.value}${metricLabel.startsWith('Avg') || metricLabel.startsWith('Median') ? 'h' : ''}`}</title>
          </circle>
          {i % Math.ceil(series.length / 10) === 0 && (
            <text x={pad.left + i * xStep} y={h - 6} fontSize={8} fill="#64748b" textAnchor="middle">{s.label}</text>
          )}
        </g>
      ))}
    </svg>
  );
}

function PieChart({ series }: { series: Array<{ label: string; value: number; count: number }> }) {
  const total = series.reduce((s, x) => s + x.value, 0);
  if (total === 0) return <p className="text-xs text-slate-500 italic">No data.</p>;
  const r = 70;
  const cx = 90;
  const cy = 90;
  const colours = ['#6366f1', '#2563eb', '#10b981', '#f59e0b', '#ef4444', '#a855f7', '#06b6d4', '#84cc16', '#f97316', '#0ea5e9', '#dc2626', '#9333ea', '#14b8a6', '#eab308', '#64748b'];
  let acc = 0;
  return (
    <div className="flex items-center gap-6">
      <svg viewBox="0 0 180 180" className="w-[180px] h-[180px] flex-shrink-0">
        {series.map((s, i) => {
          const start = (acc / total) * 2 * Math.PI;
          acc += s.value;
          const end = (acc / total) * 2 * Math.PI;
          const x1 = cx + r * Math.sin(start);
          const y1 = cy - r * Math.cos(start);
          const x2 = cx + r * Math.sin(end);
          const y2 = cy - r * Math.cos(end);
          const largeArc = end - start > Math.PI ? 1 : 0;
          const d = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`;
          return <path key={i} d={d} fill={colours[i % colours.length]} stroke="#fff" strokeWidth={1}><title>{`${s.label}: ${s.value} (${Math.round((s.value / total) * 100)}%)`}</title></path>;
        })}
      </svg>
      <ul className="text-xs space-y-1">
        {series.map((s, i) => (
          <li key={i} className="flex items-center gap-2">
            <span className="inline-block w-3 h-3 rounded-sm" style={{ background: colours[i % colours.length] }} />
            <span className="truncate max-w-[220px]" title={s.label}>{s.label}</span>
            <span className="text-slate-500 font-mono">{s.value}</span>
            <span className="text-slate-400">({Math.round((s.value / total) * 100)}%)</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── FS Line + TB code multi-select popover ───────────────────────

interface FsLineTbMultiSelectProps {
  fsLines: Array<{ id: string; name: string; tbCodes: Array<{ accountCode: string; description: string }> }>;
  selectedFsLineIds: Set<string>;
  selectedTbCodes: Set<string>;
  onChange: (fsLineIds: Set<string>, tbCodes: Set<string>) => void;
}

/**
 * Drop-in replacement for the single-select FS Line filter. Renders
 * as a button showing selection count; clicking opens a popover
 * with each FS Line expandable to reveal its TB codes. Both FS
 * Lines and TB codes are checkable independently — picking the
 * FS Line filters all requests tagged to that line, picking a TB
 * code filters just that account, and picking both shows the
 * union.
 *
 * Ticking an FS Line auto-ticks every TB code below it for
 * visual consistency but the filter logic on the server treats
 * them as independent ORs so it doesn't affect the result set.
 */
function FsLineTbMultiSelect({ fsLines, selectedFsLineIds, selectedTbCodes, onChange }: FsLineTbMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Close on outside-click.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const totalSelected = selectedFsLineIds.size + selectedTbCodes.size;
  const label =
    totalSelected === 0 ? 'All FS Lines / TB codes' :
    totalSelected === 1 && selectedFsLineIds.size === 1
      ? (fsLines.find(f => selectedFsLineIds.has(f.id))?.name || '1 selected') :
    `${totalSelected} selected`;

  const norm = (s: string) => s.toLowerCase();
  const matches = search.trim()
    ? fsLines.filter(f =>
        norm(f.name).includes(norm(search)) ||
        f.tbCodes.some(tb => norm(tb.accountCode).includes(norm(search)) || norm(tb.description).includes(norm(search))),
      )
    : fsLines;

  function toggleFsLine(id: string) {
    const next = new Set(selectedFsLineIds);
    const fs = fsLines.find(f => f.id === id);
    if (next.has(id)) {
      next.delete(id);
      // Also untick every TB code under this FS Line so the UI
      // reflects a clean "all off" state for the row.
      const nextTb = new Set(selectedTbCodes);
      for (const tb of fs?.tbCodes || []) nextTb.delete(tb.accountCode);
      onChange(next, nextTb);
    } else {
      next.add(id);
      onChange(next, selectedTbCodes);
    }
  }

  function toggleTb(fsLineId: string, accountCode: string) {
    const next = new Set(selectedTbCodes);
    if (next.has(accountCode)) next.delete(accountCode); else next.add(accountCode);
    onChange(selectedFsLineIds, next);
  }

  function clear() {
    onChange(new Set(), new Set());
  }

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full text-left text-sm border border-slate-300 rounded-md px-3 py-1.5 bg-white flex items-center justify-between hover:bg-slate-50"
      >
        <span className={totalSelected === 0 ? 'text-slate-500' : 'text-slate-800'}>{label}</span>
        <ChevronDown className="w-4 h-4 text-slate-500 flex-shrink-0 ml-2" />
      </button>

      {open && (
        <div className="absolute z-20 mt-1 w-[360px] max-w-[90vw] bg-white border border-slate-200 rounded-md shadow-lg max-h-[60vh] overflow-hidden flex flex-col">
          <div className="p-2 border-b border-slate-100">
            <input
              autoFocus
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search FS Lines or TB codes…"
              className="w-full text-sm border border-slate-300 rounded px-2 py-1"
            />
          </div>
          <div className="overflow-y-auto flex-1">
            {matches.length === 0 ? (
              <div className="px-3 py-4 text-xs text-slate-500 italic">No matches.</div>
            ) : matches.map(fs => {
              const isExp = expanded.has(fs.id);
              const fsChecked = selectedFsLineIds.has(fs.id);
              const anyTbChecked = fs.tbCodes.some(tb => selectedTbCodes.has(tb.accountCode));
              return (
                <div key={fs.id} className="border-b border-slate-50 last:border-0">
                  <div className="flex items-center gap-1 px-2 py-1.5 hover:bg-slate-50">
                    {fs.tbCodes.length > 0 ? (
                      <button
                        type="button"
                        onClick={() => {
                          setExpanded(prev => {
                            const n = new Set(prev);
                            if (n.has(fs.id)) n.delete(fs.id); else n.add(fs.id);
                            return n;
                          });
                        }}
                        className="text-slate-400 hover:text-slate-700 p-0.5"
                      >
                        {isExp ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                      </button>
                    ) : <span className="w-4" />}
                    <label className="flex-1 flex items-center gap-2 cursor-pointer text-sm">
                      <input
                        type="checkbox"
                        checked={fsChecked}
                        onChange={() => toggleFsLine(fs.id)}
                        className="rounded border-slate-300"
                      />
                      <span className={fsChecked ? 'font-medium text-slate-800' : 'text-slate-700'}>{fs.name}</span>
                      {fs.tbCodes.length > 0 && (
                        <span className="text-[11px] text-slate-400">({fs.tbCodes.length})</span>
                      )}
                      {anyTbChecked && !fsChecked && (
                        <span className="ml-auto text-[10px] text-blue-600">partial</span>
                      )}
                    </label>
                  </div>
                  {isExp && fs.tbCodes.map(tb => {
                    const tbChecked = selectedTbCodes.has(tb.accountCode);
                    return (
                      <label key={tb.accountCode} className="flex items-start gap-2 pl-9 pr-2 py-1 text-xs cursor-pointer hover:bg-slate-50">
                        <input
                          type="checkbox"
                          checked={tbChecked}
                          onChange={() => toggleTb(fs.id, tb.accountCode)}
                          className="rounded border-slate-300 mt-0.5"
                        />
                        <span className="flex-1">
                          <span className="font-mono text-slate-500 mr-2">{tb.accountCode}</span>
                          <span className={tbChecked ? 'text-slate-800 font-medium' : 'text-slate-600'}>{tb.description}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              );
            })}
          </div>
          <div className="p-2 border-t border-slate-100 flex items-center justify-between">
            <span className="text-[11px] text-slate-500">{totalSelected} selected</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={clear}
                disabled={totalSelected === 0}
                className="text-xs text-slate-600 hover:text-red-600 disabled:opacity-40 inline-flex items-center gap-1"
              >
                <X className="w-3 h-3" />Clear
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-xs bg-blue-600 text-white px-2 py-1 rounded hover:bg-blue-700"
              >Done</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
