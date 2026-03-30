'use client';

import { useState, useEffect, useMemo } from 'react';
import { Loader2, CheckCircle2, Clock, BarChart3 } from 'lucide-react';

interface PortalRequestItem {
  id: string;
  section: string;
  question: string;
  response: string | null;
  status: string;
  requestedByName: string;
  requestedAt: string;
  respondedByName: string | null;
  respondedAt: string | null;
}

interface Props {
  clientId: string;
  token: string;
}

const SECTION_LABELS: Record<string, string> = {
  questions: 'Questions & Answers',
  calculations: 'Financial Calculations',
  evidence: 'Evidence',
  connections: 'Connections',
};

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function durationBetween(start: string, end: string): number {
  return new Date(end).getTime() - new Date(start).getTime();
}

function formatDuration(ms: number): string {
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  if (days > 0) return `${days}d ${remainingHours}h`;
  const mins = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

export function RespondedTab({ clientId, token }: Props) {
  const [items, setItems] = useState<PortalRequestItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/portal/requests?clientId=${clientId}&status=responded`);
        if (res.ok) {
          const data = await res.json();
          setItems(data.requests || []);
        }
      } catch {}
      setLoading(false);
    }
    load();
  }, [clientId]);

  // Analytics
  const analytics = useMemo(() => {
    const withTimes = items.filter(i => i.requestedAt && i.respondedAt);
    if (withTimes.length === 0) return null;

    const durations = withTimes.map(i => durationBetween(i.requestedAt, i.respondedAt!));
    const sorted = [...durations].sort((a, b) => a - b);
    const avg = durations.reduce((sum, d) => sum + d, 0) / durations.length;
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const median = sorted.length % 2 === 0
      ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
      : sorted[Math.floor(sorted.length / 2)];

    // Distribution buckets
    const within1h = durations.filter(d => d < 60 * 60 * 1000).length;
    const within24h = durations.filter(d => d < 24 * 60 * 60 * 1000).length;
    const within3d = durations.filter(d => d < 3 * 24 * 60 * 60 * 1000).length;

    return {
      total: withTimes.length,
      avg, min, max, median,
      within1h, within24h, within3d,
    };
  }, [items]);

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 text-blue-500 animate-spin" /></div>;

  return (
    <div className="space-y-4">
      {items.length === 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
          <Clock className="h-10 w-10 text-slate-300 mx-auto mb-3" />
          <p className="text-sm text-slate-500">No responses recorded yet.</p>
        </div>
      )}

      {/* Responded items grouped by section */}
      {Object.entries(SECTION_LABELS).map(([sectionKey, sectionLabel]) => {
        const sectionItems = items.filter(i => i.section === sectionKey);
        if (sectionItems.length === 0) return null;
        return (
          <div key={sectionKey} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-5 py-3 bg-slate-50 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                <span className="text-sm font-semibold text-slate-800">{sectionLabel}</span>
                <span className="text-[10px] px-1.5 py-0.5 bg-green-100 text-green-700 rounded-full font-medium">{sectionItems.length}</span>
              </div>
            </div>
            <div className="divide-y divide-slate-100">
              {sectionItems.map(item => {
                const duration = item.respondedAt ? durationBetween(item.requestedAt, item.respondedAt) : null;
                return (
                  <div key={item.id} className="px-5 py-3">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <p className="text-sm text-slate-800 font-medium">{item.question}</p>
                        <div className="mt-2 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                          <p className="text-sm text-green-900">{item.response}</p>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 mt-2 text-[10px] text-slate-400">
                      <span>Requested: {formatDate(item.requestedAt)} by {item.requestedByName}</span>
                      <span>Responded: {item.respondedAt ? formatDate(item.respondedAt) : '—'} by {item.respondedByName || '—'}</span>
                      {duration !== null && (
                        <span className={`font-medium ${duration < 24 * 60 * 60 * 1000 ? 'text-green-600' : duration < 3 * 24 * 60 * 60 * 1000 ? 'text-amber-600' : 'text-red-500'}`}>
                          Response time: {formatDuration(duration)}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Response time analytics */}
      {analytics && (
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 className="h-4 w-4 text-blue-600" />
            <h3 className="text-sm font-semibold text-slate-800">Response Time Analytics</h3>
          </div>

          <div className="grid grid-cols-4 gap-4 mb-4">
            <div className="bg-slate-50 rounded-lg p-3 text-center">
              <p className="text-lg font-bold text-slate-800">{formatDuration(analytics.avg)}</p>
              <p className="text-[10px] text-slate-500 mt-0.5">Average</p>
            </div>
            <div className="bg-slate-50 rounded-lg p-3 text-center">
              <p className="text-lg font-bold text-slate-800">{formatDuration(analytics.median)}</p>
              <p className="text-[10px] text-slate-500 mt-0.5">Median</p>
            </div>
            <div className="bg-green-50 rounded-lg p-3 text-center">
              <p className="text-lg font-bold text-green-700">{formatDuration(analytics.min)}</p>
              <p className="text-[10px] text-green-600 mt-0.5">Fastest</p>
            </div>
            <div className="bg-red-50 rounded-lg p-3 text-center">
              <p className="text-lg font-bold text-red-700">{formatDuration(analytics.max)}</p>
              <p className="text-[10px] text-red-500 mt-0.5">Slowest</p>
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium text-slate-600">Response Distribution</p>
            {[
              { label: 'Within 1 hour', count: analytics.within1h, color: 'bg-green-500' },
              { label: 'Within 24 hours', count: analytics.within24h, color: 'bg-blue-500' },
              { label: 'Within 3 days', count: analytics.within3d, color: 'bg-amber-500' },
              { label: 'Total responses', count: analytics.total, color: 'bg-slate-400' },
            ].map(row => (
              <div key={row.label} className="flex items-center gap-3">
                <span className="text-xs text-slate-500 w-28">{row.label}</span>
                <div className="flex-1 bg-slate-100 rounded-full h-3 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${row.color}`}
                    style={{ width: `${analytics.total > 0 ? (row.count / analytics.total) * 100 : 0}%` }}
                  />
                </div>
                <span className="text-xs font-medium text-slate-700 w-12 text-right">{row.count} / {analytics.total}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
