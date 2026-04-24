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

import { use, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { AlertTriangle, Clock, CheckCircle2, TrendingUp, RefreshCw, Settings, Loader2, Filter } from 'lucide-react';

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
  filters: { fsLines: Array<{ id: string; name: string }>; staff: Array<{ id: string; name: string }> };
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

export default function PortalPrincipalDashboardPage({ params }: { params: Promise<{ engagementId: string }> }) {
  const { engagementId } = use(params);
  const searchParams = useSearchParams();
  const token = searchParams.get('token') || '';

  const [data, setData] = useState<PrincipalDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [filterStatus, setFilterStatus] = useState<string>('');
  const [filterFsLine, setFilterFsLine] = useState<string>('');
  const [filterAssignee, setFilterAssignee] = useState<string>('');
  const [filterText, setFilterText] = useState('');
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
      if (filterStatus) qp.set('status', filterStatus);
      if (filterFsLine) qp.set('fsLineId', filterFsLine);
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
  }, [token, engagementId, offset, filterStatus, filterFsLine, filterAssignee, filterText, drillDown]);

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
        {/* Header */}
        <div className="flex items-start justify-between bg-white border border-slate-200 rounded-lg p-5">
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-wide">Portal Principal Dashboard</p>
            <h1 className="text-xl font-semibold text-slate-800 mt-0.5">Engagement requests &amp; responses</h1>
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

        {/* Filter bar */}
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <Filter className="w-4 h-4 text-slate-500" />
            <span className="text-sm font-medium text-slate-700">Filter requests</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
            <select value={filterStatus} onChange={e => { setFilterStatus(e.target.value); setOffset(0); }} className="text-sm border border-slate-300 rounded-md px-3 py-1.5">
              <option value="">All statuses</option>
              <option value="outstanding">Outstanding</option>
              <option value="overdue">Overdue (SLA breached)</option>
              <option value="escalated">Escalated</option>
              <option value="responded">Responded</option>
            </select>
            <select value={filterFsLine} onChange={e => { setFilterFsLine(e.target.value); setOffset(0); }} className="text-sm border border-slate-300 rounded-md px-3 py-1.5">
              <option value="">All FS Lines</option>
              {data.filters.fsLines.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
            <select value={filterAssignee} onChange={e => { setFilterAssignee(e.target.value); setOffset(0); }} className="text-sm border border-slate-300 rounded-md px-3 py-1.5">
              <option value="">All assignees</option>
              {data.filters.staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <input value={filterText} onChange={e => { setFilterText(e.target.value); setOffset(0); }} placeholder="Search question text" className="text-sm border border-slate-300 rounded-md px-3 py-1.5 md:col-span-2" />
          </div>
        </div>

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
