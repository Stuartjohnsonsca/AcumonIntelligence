'use client';

import { useState, useEffect, useMemo } from 'react';
import { Loader2, CheckCircle2, Clock, BarChart3, ChevronDown, ChevronRight } from 'lucide-react';

interface ChatMessage {
  from: 'firm' | 'client';
  name: string;
  message: string;
  timestamp: string;
  attachments?: { name: string }[];
}

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
  chatHistory?: ChatMessage[];
}

interface Props {
  clientId: string;
  token: string;
  engagementId?: string;
  onUnacceptedCount?: (count: number) => void;
  analyticsOnly?: boolean;
}

const SECTION_LABELS: Record<string, string> = {
  questions: 'Questions & Answers',
  calculations: 'Financial Calculations',
  evidence: 'Evidence',
  connections: 'Connections',
};

function cleanQuestion(text: string): { question: string; source: string | null } {
  const match = text.match(/^\[(.+?)\]\s*(.+)$/);
  if (match) return { source: match[1], question: match[2] };
  return { source: null, question: text };
}

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

export function RespondedTab({ clientId, token, engagementId, onUnacceptedCount, analyticsOnly }: Props) {
  const [items, setItems] = useState<PortalRequestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        let url = `/api/portal/requests?clientId=${clientId}&status=responded`;
        if (engagementId) url += `&engagementId=${engagementId}`;
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          const reqs = data.requests || [];
          setItems(reqs);
          const unaccepted = reqs.filter((r: PortalRequestItem) => r.status !== 'committed' && r.status !== 'verified').length;
          onUnacceptedCount?.(unaccepted);
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
    const avg = durations.reduce((s, d) => s + d, 0) / durations.length;
    const median = sorted.length % 2 === 0 ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2 : sorted[Math.floor(sorted.length / 2)];
    return { total: withTimes.length, avg, min: sorted[0], max: sorted[sorted.length - 1], median,
      within1h: durations.filter(d => d < 3600000).length,
      within24h: durations.filter(d => d < 86400000).length,
      within3d: durations.filter(d => d < 259200000).length,
    };
  }, [items]);

  if (loading) return analyticsOnly ? null : <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 text-blue-500 animate-spin" /></div>;

  // Analytics-only mode: just render the collapsible analytics section
  if (analyticsOnly) {
    if (!analytics) return null;
    return (
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden mt-4">
        <button onClick={() => setAnalyticsOpen(!analyticsOpen)} className="w-full flex items-center justify-between px-5 py-3 hover:bg-slate-50 transition-colors">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-blue-600" />
            <span className="text-sm font-semibold text-slate-800">Response Time Analytics</span>
            <span className="text-[10px] text-slate-400">{analytics.total} responses</span>
          </div>
          {analyticsOpen ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
        </button>
        {analyticsOpen && (
          <div className="px-5 pb-5 border-t border-slate-100 pt-4">
            <div className="grid grid-cols-4 gap-4 mb-4">
              <div className="bg-slate-50 rounded-lg p-3 text-center"><p className="text-lg font-bold text-slate-800">{formatDuration(analytics.avg)}</p><p className="text-[10px] text-slate-500 mt-0.5">Average</p></div>
              <div className="bg-slate-50 rounded-lg p-3 text-center"><p className="text-lg font-bold text-slate-800">{formatDuration(analytics.median)}</p><p className="text-[10px] text-slate-500 mt-0.5">Median</p></div>
              <div className="bg-green-50 rounded-lg p-3 text-center"><p className="text-lg font-bold text-green-700">{formatDuration(analytics.min)}</p><p className="text-[10px] text-green-600 mt-0.5">Fastest</p></div>
              <div className="bg-red-50 rounded-lg p-3 text-center"><p className="text-lg font-bold text-red-700">{formatDuration(analytics.max)}</p><p className="text-[10px] text-red-500 mt-0.5">Slowest</p></div>
            </div>
            <div className="space-y-2">
              {[{ label: 'Within 1 hour', count: analytics.within1h, color: 'bg-green-500' },{ label: 'Within 24 hours', count: analytics.within24h, color: 'bg-blue-500' },{ label: 'Within 3 days', count: analytics.within3d, color: 'bg-amber-500' },{ label: 'Total', count: analytics.total, color: 'bg-slate-400' }].map(row => (
                <div key={row.label} className="flex items-center gap-3">
                  <span className="text-xs text-slate-500 w-28">{row.label}</span>
                  <div className="flex-1 bg-slate-100 rounded-full h-3 overflow-hidden"><div className={`h-full rounded-full ${row.color}`} style={{ width: `${analytics.total > 0 ? (row.count / analytics.total) * 100 : 0}%` }} /></div>
                  <span className="text-xs font-medium text-slate-700 w-12 text-right">{row.count}/{analytics.total}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

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
                const { question, source } = cleanQuestion(item.question);
                const duration = item.respondedAt ? durationBetween(item.requestedAt, item.respondedAt) : null;
                const chatMsgs = (item.chatHistory || []).filter(m => m.name !== 'System');
                return (
                  <div key={item.id} className="px-5 py-3">
                    <div className="flex-1">
                      <p className="text-sm text-slate-800 font-medium">{question}</p>
                      {source && <span className="text-[9px] px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded inline-block mt-0.5">{source}</span>}

                      {/* Chat history thread */}
                      {chatMsgs.length > 0 && (
                        <div className="mt-2 space-y-1 pl-2 border-l-2 border-slate-200">
                          {chatMsgs.map((msg, mi) => (
                            <div key={mi} className={`px-2 py-1 rounded text-xs ${msg.from === 'client' ? 'bg-blue-50' : 'bg-slate-50'}`}>
                              <span className="font-semibold text-[10px] text-slate-600">{msg.name}</span>
                              <span className="text-[9px] text-slate-400 ml-1">{new Date(msg.timestamp).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                              <p className="text-slate-700 mt-0.5">{msg.message}</p>
                              {msg.attachments && msg.attachments.length > 0 && (
                                <div className="flex gap-1 mt-0.5">{msg.attachments.map((a: any, ai: number) => <button key={ai} onClick={async () => {
                                  try {
                                    const params = a.uploadId ? `uploadId=${a.uploadId}` : a.storagePath ? `storagePath=${encodeURIComponent(a.storagePath)}` : '';
                                    if (!params && a.url) { window.open(a.url, '_blank'); return; }
                                    const res = await fetch(`/api/portal/download?${params}`);
                                    if (res.ok) { const data = await res.json(); window.open(data.url, '_blank'); }
                                  } catch {}
                                }} className="text-[9px] text-blue-600 hover:text-blue-800 hover:underline cursor-pointer">📎 {a.name}</button>)}</div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Final response */}
                      {item.response && (() => {
                        const isVerified = item.status === 'committed' || item.status === 'verified';
                        return (
                          <div className={`mt-2 rounded-lg px-3 py-2 border ${isVerified ? 'bg-green-50 border-green-200' : 'bg-blue-50 border-blue-200'}`}>
                            <p className={`text-sm ${isVerified ? 'text-green-900' : 'text-blue-900'}`}>{item.response}</p>
                          </div>
                        );
                      })()}
                    </div>
                    <div className="flex items-center gap-4 mt-2 text-[10px] text-slate-400">
                      <span>Requested: {formatDate(item.requestedAt)} by {item.requestedByName}</span>
                      <span>Responded: {item.respondedAt ? formatDate(item.respondedAt) : '—'} by {item.respondedByName || '—'}</span>
                      {duration !== null && (
                        <span className={`font-medium ${duration < 86400000 ? 'text-green-600' : duration < 259200000 ? 'text-amber-600' : 'text-red-500'}`}>
                          {formatDuration(duration)}
                        </span>
                      )}
                      {(() => {
                        const isVerified = item.status === 'committed' || item.status === 'verified';
                        return (
                          <span className={`font-semibold px-2 py-0.5 rounded-full ${isVerified ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
                            {isVerified ? '✓ Verified' : 'Unaccepted'}
                          </span>
                        );
                      })()}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Analytics moved to page level — rendered below all tabs */}
    </div>
  );
}
