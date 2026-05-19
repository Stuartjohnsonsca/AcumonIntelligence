'use client';

import { useState, useEffect, useMemo } from 'react';
import { Loader2, CheckCircle2, Clock, BarChart3, ChevronDown, ChevronRight, Search, ArrowUpDown, ArrowUp, ArrowDown, Filter } from 'lucide-react';

interface ChatMessage {
  from: 'firm' | 'client';
  name: string;
  message: string;
  timestamp: string;
  attachments?: { name: string; url?: string; uploadId?: string; storagePath?: string }[];
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
  // Joined fields populated server-side (see app/api/portal/requests/route.ts)
  fsLineName?: string | null;
  assignedTo?: string | null;
}

interface Props {
  clientId: string;
  token: string;
  engagementId?: string;
  onUnacceptedCount?: (count: number) => void;
  /** When true: render only the response-time analytics card (no list).
   *  Used by the parent page to show analytics below all tabs while
   *  the list-view instance of RespondedTab lives inside a tab. */
  analyticsOnly?: boolean;
}

const SECTIONS = [
  { key: 'questions', label: 'Questions & Answers' },
  { key: 'ri_matters', label: 'Senior Reviewer Queries' },
  { key: 'review_points', label: 'Review Queries' },
  { key: 'error_approvals', label: 'Audit Adjustments to Approve' },
  { key: 'walkthroughs', label: 'Walkthrough Documentation' },
  { key: 'calculations', label: 'Financial Calculations' },
  { key: 'vat_returns', label: 'VAT Returns' },
  { key: 'evidence', label: 'Evidence' },
  { key: 'connections', label: 'Connections' },
];

const STATUS_META: Record<string, { label: string; cls: string }> = {
  responded:    { label: 'Responded',     cls: 'bg-blue-100 text-blue-700 border border-blue-200' },
  chat_replied: { label: 'Awaiting reply', cls: 'bg-amber-100 text-amber-700 border border-amber-200' },
  verified:     { label: 'Verified',      cls: 'bg-green-100 text-green-700 border border-green-200' },
  committed:    { label: 'Committed',     cls: 'bg-green-100 text-green-700 border border-green-200' },
  outstanding:  { label: 'Outstanding',   cls: 'bg-red-100 text-red-700 border border-red-200' },
};

type SortKey = 'subject' | 'requestedAt' | 'lastActionAt' | 'status' | 'source' | 'duration';
type SortDir = 'asc' | 'desc';

function cleanQuestion(text: string): { subject: string; body: string; source: string | null } {
  let rest = String(text ?? '');
  let source: string | null = null;
  const tag = rest.match(/^\[(.+?)\]\s*/);
  if (tag) { source = tag[1]; rest = rest.slice(tag[0].length); }
  rest = rest.replace(/\r\n/g, '\n').trim();
  let subject = '';
  let body = '';
  const blankIdx = rest.indexOf('\n\n');
  if (blankIdx >= 0) {
    subject = rest.slice(0, blankIdx).trim();
    body = rest.slice(blankIdx + 2).trim();
  } else {
    const nlIdx = rest.indexOf('\n');
    if (nlIdx >= 0) {
      subject = rest.slice(0, nlIdx).trim();
      body = rest.slice(nlIdx + 1).trim();
    } else {
      subject = rest;
    }
  }
  body = body.replace(/^Audit:[^\n]+\n\n?/i, '').trim();
  return { subject, body, source };
}

function formatDate(iso?: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });
  } catch { return '—'; }
}

function formatDateTime(iso?: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return '—'; }
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

/** Last action = newest of (respondedAt, latest chatHistory.timestamp, requestedAt).
 *  Mirrors OutstandingTab's logic so both tabs read the same column. */
function getLastActionAt(item: PortalRequestItem): string {
  let latest = item.requestedAt;
  if (item.respondedAt && item.respondedAt > latest) latest = item.respondedAt;
  if (item.chatHistory && item.chatHistory.length > 0) {
    for (const m of item.chatHistory) {
      if (m.timestamp && m.timestamp > latest) latest = m.timestamp;
    }
  }
  return latest;
}

/** Source column display — prefer the routing FS Line name, then any
 *  `[bracketed]` tag the request was created with, then the section
 *  label as a last resort. Same shape OutstandingTab uses. */
function getSourceDisplay(item: PortalRequestItem, fallbackSource: string | null): { primary: string; secondary?: string } {
  const sectionLabel = SECTIONS.find(s => s.key === item.section)?.label ?? item.section;
  if (item.fsLineName) return { primary: item.fsLineName, secondary: sectionLabel };
  if (fallbackSource) return { primary: fallbackSource, secondary: sectionLabel };
  return { primary: sectionLabel };
}

export function RespondedTab({ clientId, token, engagementId, onUnacceptedCount, analyticsOnly }: Props) {
  const [items, setItems] = useState<PortalRequestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);

  // List UI state — filters, search, sort, row expansion
  const [filterSection, setFilterSection] = useState<string>('all');
  const [filterFsLine, setFilterFsLine] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [searchText, setSearchText] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('lastActionAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        let url = `/api/portal/requests?clientId=${clientId}&status=responded`;
        if (engagementId) url += `&engagementId=${engagementId}`;
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          const reqs: PortalRequestItem[] = data.requests || [];
          setItems(reqs);
          const unaccepted = reqs.filter(r => r.status !== 'committed' && r.status !== 'verified').length;
          onUnacceptedCount?.(unaccepted);
        }
      } catch {}
      setLoading(false);
    }
    load();
  }, [clientId, engagementId]);

  // Analytics — unchanged from the prior version; drives the
  // analyticsOnly card below all tabs.
  const analytics = useMemo(() => {
    const withTimes = items.filter(i => i.requestedAt && i.respondedAt);
    if (withTimes.length === 0) return null;
    const durations = withTimes.map(i => durationBetween(i.requestedAt, i.respondedAt!));
    const sorted = [...durations].sort((a, b) => a - b);
    const avg = durations.reduce((s, d) => s + d, 0) / durations.length;
    const median = sorted.length % 2 === 0 ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2 : sorted[Math.floor(sorted.length / 2)];
    return {
      total: withTimes.length, avg, min: sorted[0], max: sorted[sorted.length - 1], median,
      within1h: durations.filter(d => d < 3600000).length,
      within24h: durations.filter(d => d < 86400000).length,
      within3d: durations.filter(d => d < 259200000).length,
    };
  }, [items]);

  // Pre-process items once per render so the search/sort pipeline
  // doesn't re-parse cleanQuestion repeatedly.
  const enriched = useMemo(() => {
    return items.map(i => {
      const { subject, body, source } = cleanQuestion(i.question);
      const lastActionAt = getLastActionAt(i);
      const src = getSourceDisplay(i, source);
      const duration = i.respondedAt ? durationBetween(i.requestedAt, i.respondedAt) : null;
      return { item: i, subject, body, source, lastActionAt, src, duration };
    });
  }, [items]);

  const fsLineOptions = useMemo(() => {
    const set = new Set<string>();
    for (const e of enriched) if (e.item.fsLineName) set.add(e.item.fsLineName);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [enriched]);

  const statusOptions = useMemo(() => {
    const set = new Set<string>();
    for (const e of enriched) set.add(e.item.status);
    return Array.from(set);
  }, [enriched]);

  const filtered = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    return enriched.filter(e => {
      if (filterSection !== 'all' && e.item.section !== filterSection) return false;
      if (filterFsLine !== 'all') {
        if (filterFsLine === '__none__') { if (e.item.fsLineName) return false; }
        else if (e.item.fsLineName !== filterFsLine) return false;
      }
      if (filterStatus !== 'all' && e.item.status !== filterStatus) return false;
      if (q) {
        const hay = `${e.subject} ${e.body} ${e.item.requestedByName} ${e.item.respondedByName || ''} ${e.src.primary} ${e.src.secondary ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [enriched, filterSection, filterFsLine, filterStatus, searchText]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    const dir = sortDir === 'asc' ? 1 : -1;
    arr.sort((a, b) => {
      let av: string | number = '';
      let bv: string | number = '';
      switch (sortKey) {
        case 'subject':       av = a.subject.toLowerCase(); bv = b.subject.toLowerCase(); break;
        case 'requestedAt':   av = a.item.requestedAt;       bv = b.item.requestedAt; break;
        case 'lastActionAt':  av = a.lastActionAt;           bv = b.lastActionAt; break;
        case 'status':        av = a.item.status;            bv = b.item.status; break;
        case 'source':        av = a.src.primary.toLowerCase(); bv = b.src.primary.toLowerCase(); break;
        case 'duration':      av = a.duration ?? Number.MAX_SAFE_INTEGER; bv = b.duration ?? Number.MAX_SAFE_INTEGER; break;
      }
      if (av < bv) return -1 * dir;
      if (av > bv) return  1 * dir;
      return 0;
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir(key === 'subject' || key === 'source' ? 'asc' : 'desc');
    }
  }

  function SortIcon({ k }: { k: SortKey }) {
    if (sortKey !== k) return <ArrowUpDown className="h-3 w-3 text-slate-300 inline-block ml-1" />;
    return sortDir === 'asc'
      ? <ArrowUp   className="h-3 w-3 text-slate-600 inline-block ml-1" />
      : <ArrowDown className="h-3 w-3 text-slate-600 inline-block ml-1" />;
  }

  if (loading) return analyticsOnly ? null : <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 text-blue-500 animate-spin" /></div>;

  // Analytics-only mode: just render the collapsible analytics section.
  // Unchanged behaviour from before so the parent page's existing
  // mount keeps working.
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

  if (items.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
        <Clock className="h-10 w-10 text-slate-300 mx-auto mb-3" />
        <p className="text-sm text-slate-500">No responses recorded yet.</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      {/* Toolbar — search + filters. Same shape as OutstandingTab. */}
      <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/50">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="h-3.5 w-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              placeholder="Search subject, body, requester, source…"
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-md focus:outline-none focus:border-blue-400 bg-white"
            />
          </div>

          <div className="flex items-center gap-1">
            <Filter className="h-3 w-3 text-slate-400" />
            <select
              value={filterSection}
              onChange={e => setFilterSection(e.target.value)}
              className="text-xs border border-slate-200 rounded-md px-2 py-1.5 bg-white focus:outline-none focus:border-blue-400"
              aria-label="Filter by section"
            >
              <option value="all">All sections</option>
              {SECTIONS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </div>

          {fsLineOptions.length > 0 && (
            <select
              value={filterFsLine}
              onChange={e => setFilterFsLine(e.target.value)}
              className="text-xs border border-slate-200 rounded-md px-2 py-1.5 bg-white focus:outline-none focus:border-blue-400"
              aria-label="Filter by FS Line"
            >
              <option value="all">All FS Lines</option>
              {fsLineOptions.map(f => <option key={f} value={f}>{f}</option>)}
              <option value="__none__">— No FS Line —</option>
            </select>
          )}

          {statusOptions.length > 1 && (
            <select
              value={filterStatus}
              onChange={e => setFilterStatus(e.target.value)}
              className="text-xs border border-slate-200 rounded-md px-2 py-1.5 bg-white focus:outline-none focus:border-blue-400"
              aria-label="Filter by status"
            >
              <option value="all">All statuses</option>
              {statusOptions.map(s => <option key={s} value={s}>{STATUS_META[s]?.label ?? s}</option>)}
            </select>
          )}

          <div className="text-[11px] text-slate-500 ml-auto">
            {sorted.length} of {enriched.length}
          </div>
        </div>
      </div>

      {/* Column headers — match the row template grid below. Extra
          Duration column compared to Outstanding so the response
          latency stays visible without expanding the row. */}
      <div className="grid grid-cols-[1.6fr_100px_100px_120px_180px_90px_28px] gap-3 px-4 py-2 bg-slate-100/60 border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
        <button onClick={() => toggleSort('subject')}      className="text-left flex items-center hover:text-slate-900">Subject<SortIcon k="subject" /></button>
        <button onClick={() => toggleSort('requestedAt')}  className="text-left flex items-center hover:text-slate-900">Date Received<SortIcon k="requestedAt" /></button>
        <button onClick={() => toggleSort('lastActionAt')} className="text-left flex items-center hover:text-slate-900">Last Action<SortIcon k="lastActionAt" /></button>
        <button onClick={() => toggleSort('status')}       className="text-left flex items-center hover:text-slate-900">Status<SortIcon k="status" /></button>
        <button onClick={() => toggleSort('source')}       className="text-left flex items-center hover:text-slate-900">Source<SortIcon k="source" /></button>
        <button onClick={() => toggleSort('duration')}     className="text-left flex items-center hover:text-slate-900">Response<SortIcon k="duration" /></button>
        <span />
      </div>

      {/* Rows */}
      {sorted.length === 0 ? (
        <div className="px-5 py-8 text-center text-xs text-slate-400 italic">
          No items match the current filters.
        </div>
      ) : (
        <div className="divide-y divide-slate-100">
          {sorted.map(({ item, subject, body, source, lastActionAt, src, duration }) => {
            const isExpanded = expandedId === item.id;
            const statusMeta = STATUS_META[item.status] ?? { label: item.status, cls: 'bg-slate-100 text-slate-700 border border-slate-200' };
            const isVerified = item.status === 'committed' || item.status === 'verified';
            return (
              <div key={item.id} className={isExpanded ? 'bg-blue-50/30' : 'hover:bg-slate-50/60'}>
                {/* Compact row */}
                <button
                  onClick={() => setExpandedId(prev => prev === item.id ? null : item.id)}
                  className="w-full grid grid-cols-[1.6fr_100px_100px_120px_180px_90px_28px] gap-3 px-4 py-2.5 items-center text-left"
                >
                  <div className="min-w-0">
                    <div className="text-sm text-slate-900 font-medium truncate">{subject || '(no subject)'}</div>
                    {body && (
                      <div className="text-[11px] text-slate-500 truncate mt-0.5">{body.replace(/\n/g, ' ')}</div>
                    )}
                  </div>
                  <div className="text-xs text-slate-700 tabular-nums">{formatDate(item.requestedAt)}</div>
                  <div className="text-xs text-slate-700 tabular-nums">{formatDate(lastActionAt)}</div>
                  <div>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium ${statusMeta.cls}`}>
                      {statusMeta.label}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs text-slate-800 truncate">{src.primary}</div>
                    {src.secondary && <div className="text-[10px] text-slate-400 truncate">{src.secondary}</div>}
                  </div>
                  <div className={`text-xs tabular-nums font-medium ${
                    duration === null ? 'text-slate-300'
                    : duration < 86400000 ? 'text-green-600'
                    : duration < 259200000 ? 'text-amber-600'
                    : 'text-red-500'
                  }`}>
                    {duration === null ? '—' : formatDuration(duration)}
                  </div>
                  <div className="text-slate-400 flex justify-end">
                    {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </div>
                </button>

                {/* Expanded panel */}
                {isExpanded && (
                  <div className="px-4 pb-4 pt-1 border-t border-slate-100">
                    {body && (
                      <p className="text-xs text-slate-700 whitespace-pre-wrap leading-relaxed mb-2">{body}</p>
                    )}

                    <div className="flex items-center gap-2 mb-3 flex-wrap text-[10px] text-slate-500">
                      <span>Requested by <span className="text-slate-700 font-medium">{item.requestedByName}</span> on {formatDateTime(item.requestedAt)}</span>
                      <span>· Responded by <span className="text-slate-700 font-medium">{item.respondedByName || '—'}</span> on {formatDateTime(item.respondedAt)}</span>
                      {source && (
                        <span className="px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded">{source}</span>
                      )}
                    </div>

                    {/* Chat history — wide opposite-side indent so the
                        conversation reads as a back-and-forth */}
                    {item.chatHistory && item.chatHistory.length > 0 && (
                      <div className="mb-3 space-y-1.5 max-h-60 overflow-y-auto">
                        {item.chatHistory.filter(m => m.name !== 'System').map((msg, mi) => (
                          <div key={mi} className={`flex ${msg.from === 'client' ? 'justify-end pl-12' : 'justify-start pr-12'}`}>
                            <div className={`max-w-[80%] px-3 py-1.5 rounded-lg text-xs ${
                              msg.from === 'client' ? 'bg-blue-100 text-blue-900' : 'bg-slate-100 text-slate-800'
                            }`}>
                              <div className="flex items-center gap-1.5 mb-0.5">
                                <span className="font-semibold text-[10px]">{msg.name}</span>
                                <span className="text-[9px] text-slate-400">{formatDateTime(msg.timestamp)}</span>
                              </div>
                              <p className="whitespace-pre-wrap">{msg.message}</p>
                              {msg.attachments && msg.attachments.length > 0 && (
                                <div className="mt-1 flex flex-wrap gap-1">
                                  {msg.attachments.map((a, ai) => (
                                    <button key={ai} onClick={async () => {
                                      try {
                                        const params = a.uploadId ? `uploadId=${a.uploadId}` : a.storagePath ? `storagePath=${encodeURIComponent(a.storagePath)}` : '';
                                        if (!params && a.url) { window.open(a.url, '_blank'); return; }
                                        const res = await fetch(`/api/portal/download?${params}`);
                                        if (res.ok) { const data = await res.json(); window.open(data.url, '_blank'); }
                                      } catch {}
                                    }} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-white/50 rounded text-[9px] border text-blue-600 hover:text-blue-800 hover:bg-blue-50 cursor-pointer">📎 {a.name}</button>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Final response — coloured by verified/unaccepted */}
                    {item.response && (
                      <div className={`rounded-lg px-3 py-2 border ${isVerified ? 'bg-green-50 border-green-200' : 'bg-blue-50 border-blue-200'}`}>
                        <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide font-semibold mb-1 text-slate-600">
                          <CheckCircle2 className={`h-3 w-3 ${isVerified ? 'text-green-500' : 'text-blue-500'}`} />
                          Final response
                          <span className={`ml-auto px-2 py-0.5 rounded-full text-[10px] font-semibold ${isVerified ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
                            {isVerified ? '✓ Verified' : 'Unaccepted'}
                          </span>
                        </div>
                        <p className={`text-sm whitespace-pre-wrap ${isVerified ? 'text-green-900' : 'text-blue-900'}`}>{item.response}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
