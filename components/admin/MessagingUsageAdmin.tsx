'use client';

/**
 * Super Admin → Messaging Usage tab.
 *
 * Renders a per-firm / per-client / per-engagement / per-channel
 * rollup of outbound messages over a date range. The numbers feed
 * the aggregator-style invoice Acumon raises against each firm for
 * SMS / WhatsApp / Telegram / WeCom usage.
 *
 * Date range defaults to the current calendar month so the
 * SuperAdmin opens the tab into "this month so far". Three buttons
 * shortcut This Month / Last Month / Last 90 Days; the user can also
 * pick any from/to via the native date inputs.
 *
 * CSV download mirrors the table verbatim — one row per
 * (firm, client, engagement, channel, direction) — for ingestion
 * into the billing spreadsheet / accounting system.
 */

import { useEffect, useMemo, useState } from 'react';
import { Loader2, Download, MessageSquare } from 'lucide-react';

interface UsageRow {
  firmId: string | null;
  firmName: string;
  clientId: string | null;
  clientName: string;
  auditEngagementId: string | null;
  auditEngagementLabel: string;
  channel: string;
  direction: string;
  messageCount: number;
  billableUnits: number;
}

interface UsageResponse {
  from: string;
  to: string;
  rows: UsageRow[];
  totals: { messageCount: number; billableUnits: number };
}

function toInput(d: Date) {
  // <input type="date"> takes YYYY-MM-DD. Use UTC to avoid a
  // half-day off when the SuperAdmin's local TZ is non-UTC.
  return d.toISOString().slice(0, 10);
}

function startOfMonth(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}
function startOfPrevMonth(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
}

export function MessagingUsageAdmin() {
  const today = new Date();
  const [from, setFrom] = useState<string>(toInput(startOfMonth(today)));
  const [to, setTo] = useState<string>(toInput(today));
  const [data, setData] = useState<UsageResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      // The endpoint takes ISO datetimes; pad the to-date so the
      // "to" filter includes the whole day the user picked. The
      // server still does `< to` so this is an exclusive upper
      // bound at midnight of the day AFTER the picked date.
      const fromDt = new Date(from + 'T00:00:00Z').toISOString();
      const toDt = new Date(new Date(to + 'T00:00:00Z').getTime() + 24 * 60 * 60_000).toISOString();
      const url = `/api/admin/messaging-usage?from=${encodeURIComponent(fromDt)}&to=${encodeURIComponent(toDt)}`;
      const res = await fetch(url);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `Load failed (${res.status})`);
      }
      setData(await res.json());
    } catch (e: any) {
      setError(e?.message || 'Failed to load usage');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, []); // initial load only — explicit Refresh button picks up later filter changes

  // Group rows by firm so the table shows a clear hierarchy. Within
  // each firm, sub-group by client → engagement. The aggregation API
  // already orders by these dimensions so a simple linear walk
  // produces the right shape.
  const grouped = useMemo(() => {
    if (!data) return [];
    const byFirm = new Map<string, {
      firmId: string | null; firmName: string;
      rows: UsageRow[];
      totals: { messageCount: number; billableUnits: number };
    }>();
    for (const r of data.rows) {
      const key = r.firmId ?? '__unassigned__';
      let g = byFirm.get(key);
      if (!g) {
        g = { firmId: r.firmId, firmName: r.firmName, rows: [], totals: { messageCount: 0, billableUnits: 0 } };
        byFirm.set(key, g);
      }
      g.rows.push(r);
      g.totals.messageCount += r.messageCount;
      g.totals.billableUnits += r.billableUnits;
    }
    return Array.from(byFirm.values());
  }, [data]);

  function downloadCsv() {
    if (!data) return;
    const header = ['Firm', 'Client', 'Engagement period', 'Channel', 'Direction', 'Message count', 'Billable units'];
    const escape = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
    const lines = [header.map(escape).join(',')];
    for (const r of data.rows) {
      lines.push([
        escape(r.firmName),
        escape(r.clientName),
        escape(r.auditEngagementLabel),
        escape(r.channel),
        escape(r.direction),
        String(r.messageCount),
        String(r.billableUnits),
      ].join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `messaging-usage-${from}-to-${to}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function preset(kind: 'this' | 'last' | '90d') {
    const now = new Date();
    if (kind === 'this') {
      setFrom(toInput(startOfMonth(now)));
      setTo(toInput(now));
    } else if (kind === 'last') {
      const start = startOfPrevMonth(now);
      const end = new Date(startOfMonth(now).getTime() - 24 * 60 * 60_000);
      setFrom(toInput(start));
      setTo(toInput(end));
    } else {
      const start = new Date(now.getTime() - 90 * 24 * 60 * 60_000);
      setFrom(toInput(start));
      setTo(toInput(now));
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-emerald-700" /> Messaging Usage
        </h2>
        <p className="text-xs text-slate-500">
          Per-Client / per-Period tally of outbound SMS / WhatsApp / Telegram / WeCom messages, ready for billing back to each firm. <strong>Billable units</strong> sum to one per outbound send by default; multi-segment SMS and media-heavy WhatsApp can carry a higher weight set by the orchestrator. Inbound messages are recorded but not billed.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3 p-3 bg-slate-50 border border-slate-200 rounded-lg">
        <div>
          <label className="block text-[11px] font-medium text-slate-600 mb-1">From</label>
          <input
            type="date"
            value={from}
            onChange={e => setFrom(e.target.value)}
            className="text-xs border border-slate-300 rounded px-2 py-1"
          />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-slate-600 mb-1">To</label>
          <input
            type="date"
            value={to}
            onChange={e => setTo(e.target.value)}
            className="text-xs border border-slate-300 rounded px-2 py-1"
          />
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => preset('this')} className="text-[11px] px-2 py-1 border border-slate-300 rounded hover:bg-slate-100">This month</button>
          <button type="button" onClick={() => preset('last')} className="text-[11px] px-2 py-1 border border-slate-300 rounded hover:bg-slate-100">Last month</button>
          <button type="button" onClick={() => preset('90d')} className="text-[11px] px-2 py-1 border border-slate-300 rounded hover:bg-slate-100">Last 90 days</button>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          className="text-xs px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-300 text-white rounded"
        >
          {loading ? <Loader2 className="h-3 w-3 animate-spin inline mr-1" /> : null}
          Refresh
        </button>
        <button
          type="button"
          onClick={downloadCsv}
          disabled={!data || loading}
          className="text-xs px-3 py-1.5 border border-slate-300 rounded hover:bg-slate-100 disabled:opacity-50 inline-flex items-center gap-1"
          title="Download the rollup as CSV for billing import"
        >
          <Download className="h-3 w-3" /> CSV
        </button>
        {data && (
          <div className="ml-auto text-[11px] text-slate-600">
            <strong>{data.totals.messageCount.toLocaleString('en-GB')}</strong> messages,{' '}
            <strong>{data.totals.billableUnits.toLocaleString('en-GB')}</strong> billable units
          </div>
        )}
      </div>

      {error && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-3">{error}</div>
      )}

      {loading && !data && (
        <div className="text-center py-10 text-slate-400"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>
      )}

      {data && grouped.length === 0 && !loading && (
        <div className="text-sm text-slate-500 italic p-6 text-center bg-white border border-slate-200 rounded-lg">
          No outbound messages in this date range.
        </div>
      )}

      {grouped.map(g => (
        <div key={g.firmId ?? '__unassigned__'} className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2 bg-slate-50 border-b border-slate-200">
            <h3 className="text-sm font-semibold text-slate-800">{g.firmName}</h3>
            <div className="text-[11px] text-slate-600">
              {g.totals.messageCount.toLocaleString('en-GB')} messages,{' '}
              <strong>{g.totals.billableUnits.toLocaleString('en-GB')} billable</strong>
            </div>
          </div>
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="text-left px-4 py-1.5 font-medium">Client</th>
                <th className="text-left px-4 py-1.5 font-medium">Engagement period</th>
                <th className="text-left px-4 py-1.5 font-medium">Channel</th>
                <th className="text-left px-4 py-1.5 font-medium">Direction</th>
                <th className="text-right px-4 py-1.5 font-medium">Messages</th>
                <th className="text-right px-4 py-1.5 font-medium">Billable</th>
              </tr>
            </thead>
            <tbody>
              {g.rows.map((r, i) => (
                <tr key={i} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-1.5 text-slate-700">{r.clientName}</td>
                  <td className="px-4 py-1.5 text-slate-700">{r.auditEngagementLabel}</td>
                  <td className="px-4 py-1.5 text-slate-700 capitalize">{r.channel}</td>
                  <td className="px-4 py-1.5 text-slate-500">{r.direction}</td>
                  <td className="px-4 py-1.5 text-right tabular-nums">{r.messageCount.toLocaleString('en-GB')}</td>
                  <td className="px-4 py-1.5 text-right tabular-nums font-medium">{r.billableUnits.toLocaleString('en-GB')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
