'use client';

import { useState, useEffect, useMemo } from 'react';
import { ChevronDown, ChevronRight, Loader2, Send, CheckCircle2, UserPlus, Search, ArrowUpDown, ArrowUp, ArrowDown, Filter } from 'lucide-react';
import { PasteAwareTextarea } from './PasteAwareTextarea';

interface TeamMember {
  id: string;
  email: string;
  name: string;
  role: string | null;
  isActive: boolean;
}

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
  respondedAt?: string | null;
  chatHistory?: ChatMessage[];
  // Joined fields populated server-side
  fsLineName?: string | null;
  assignedTo?: string | null;
}

interface Props {
  clientId: string;
  token: string;
  engagementId?: string;
  onCountChange?: (count: number) => void;
  viewMode?: 'my' | 'team';
  portalUserName?: string;
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
  outstanding:   { label: 'Outstanding',   cls: 'bg-red-100 text-red-700 border border-red-200' },
  chat_replied:  { label: 'Awaiting reply', cls: 'bg-amber-100 text-amber-700 border border-amber-200' },
  responded:     { label: 'Responded',     cls: 'bg-blue-100 text-blue-700 border border-blue-200' },
  verified:      { label: 'Verified',      cls: 'bg-green-100 text-green-700 border border-green-200' },
  committed:     { label: 'Committed',     cls: 'bg-green-100 text-green-700 border border-green-200' },
};

type SortKey = 'subject' | 'requestedAt' | 'lastActionAt' | 'status' | 'source';
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

/** "Last Action Date" = newest of (requestedAt, respondedAt, latest
 * chatHistory.timestamp). Falls back to requestedAt for never-touched
 * items so the column never reads "—". */
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
 * `[bracketed]` tag the request was created with, then the section
 * label as a last resort so the column always has something to read. */
function getSourceDisplay(item: PortalRequestItem, fallbackSource: string | null): { primary: string; secondary?: string } {
  const sectionLabel = SECTIONS.find(s => s.key === item.section)?.label ?? item.section;
  if (item.fsLineName) return { primary: item.fsLineName, secondary: sectionLabel };
  if (fallbackSource) return { primary: fallbackSource, secondary: sectionLabel };
  return { primary: sectionLabel };
}

export function OutstandingTab({ clientId, token, engagementId, onCountChange, viewMode = 'team', portalUserName }: Props) {
  const [items, setItems] = useState<PortalRequestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [responseFiles, setResponseFiles] = useState<Record<string, File[]>>({});
  const [approvalChecks, setApprovalChecks] = useState<Record<string, Set<string>>>({});
  const [submitting, setSubmitting] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [successes, setSuccesses] = useState<Set<string>>(new Set());
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [assignees, setAssignees] = useState<Record<string, string>>({});

  // List UI state — filters, search, sort, row expansion
  const [filterSection, setFilterSection] = useState<string>('all');
  const [filterFsLine, setFilterFsLine] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [searchText, setSearchText] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('requestedAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => { loadItems(); }, [clientId, engagementId]);

  async function loadItems() {
    setLoading(true);
    try {
      let url = `/api/portal/requests?clientId=${clientId}&status=outstanding`;
      if (engagementId) url += `&engagementId=${engagementId}`;
      const [res, teamRes] = await Promise.all([
        fetch(url),
        fetch(`/api/portal/users?clientId=${clientId}`),
      ]);
      if (res.ok) {
        const data = await res.json();
        const reqs: PortalRequestItem[] = data.requests || [];
        setItems(reqs);
        onCountChange?.(reqs.length);
        const seeded: Record<string, string> = {};
        for (const r of reqs) {
          if (r.assignedTo) seeded[r.id] = r.assignedTo;
        }
        setAssignees(seeded);
      }
      if (teamRes.ok) {
        const users = await teamRes.json();
        setTeamMembers((Array.isArray(users) ? users : []).filter((u: any) => u.isActive));
      }
    } catch (err) { console.error('[OutstandingTab] Error:', err); }
    setLoading(false);
  }

  async function handleAssign(itemId: string, assigneeName: string) {
    setAssignees(prev => ({ ...prev, [itemId]: assigneeName }));
    try {
      await fetch('/api/portal/requests', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: itemId, action: 'assign_portal', assignTo: assigneeName }),
      });
    } catch { /* refresh will re-sync */ }
  }

  async function handleSubmitItem(item: PortalRequestItem) {
    const response = responses[item.id]?.trim();
    const files = responseFiles[item.id] || [];
    if (!response && files.length === 0) return;

    setSubmitting(prev => ({ ...prev, [item.id]: true }));
    setErrors(prev => { const n = { ...prev }; delete n[item.id]; return n; });

    try {
      const uploadedFiles: { name: string; url: string; uploadId: string }[] = [];
      for (const file of files) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('requestId', item.id);
        const uploadRes = await fetch('/api/portal/upload', { method: 'POST', body: formData });
        if (uploadRes.ok) {
          const uploadData = await uploadRes.json();
          uploadedFiles.push({ name: file.name, url: uploadData.url || '', uploadId: uploadData.uploadId });
        }
      }

      const fileNames = uploadedFiles.map(f => f.name);
      const fullResponse = fileNames.length > 0
        ? `${response || ''}${response ? '\n' : ''}[Attachments: ${fileNames.join(', ')}]`
        : (response || '');

      const res = await fetch('/api/portal/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: item.id,
          response: fullResponse,
          respondedByName: 'Portal User',
          attachments: uploadedFiles,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrors(prev => ({ ...prev, [item.id]: data.error || 'Submission failed' }));
      } else {
        setSuccesses(prev => new Set(prev).add(item.id));
        setResponses(prev => { const n = { ...prev }; delete n[item.id]; return n; });
        setResponseFiles(prev => { const n = { ...prev }; delete n[item.id]; return n; });
        onCountChange?.(items.filter(i => !successes.has(i.id) && i.id !== item.id).length);
      }
    } catch {
      setErrors(prev => ({ ...prev, [item.id]: 'Network error' }));
    }
    setSubmitting(prev => ({ ...prev, [item.id]: false }));
  }

  // Pre-clean once so we can search/sort without re-parsing every render
  const enriched = useMemo(() => {
    return items
      .filter(i => !successes.has(i.id))
      .map(i => {
        const { subject, body, source } = cleanQuestion(i.question);
        const lastActionAt = getLastActionAt(i);
        const src = getSourceDisplay(i, source);
        return { item: i, subject, body, source, lastActionAt, src };
      });
  }, [items, successes]);

  // Distinct FS Lines present in the data — drives the FS Line filter
  // dropdown so the user only sees options that actually have items.
  const fsLineOptions = useMemo(() => {
    const set = new Set<string>();
    for (const e of enriched) if (e.item.fsLineName) set.add(e.item.fsLineName);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [enriched]);

  // Distinct statuses actually present — keeps the status filter focused
  const statusOptions = useMemo(() => {
    const set = new Set<string>();
    for (const e of enriched) set.add(e.item.status);
    return Array.from(set);
  }, [enriched]);

  const filtered = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    return enriched.filter(e => {
      // viewMode filter — "my" view shows only items assigned to this
      // portal user or unassigned ones (so nothing falls through cracks)
      if (viewMode === 'my' && portalUserName) {
        const a = e.item.assignedTo || '';
        if (a && a !== portalUserName && !a.includes(portalUserName)) return false;
      }
      if (filterSection !== 'all' && e.item.section !== filterSection) return false;
      if (filterFsLine !== 'all') {
        if (filterFsLine === '__none__') { if (e.item.fsLineName) return false; }
        else if (e.item.fsLineName !== filterFsLine) return false;
      }
      if (filterStatus !== 'all' && e.item.status !== filterStatus) return false;
      if (q) {
        const hay = `${e.subject} ${e.body} ${e.item.requestedByName} ${e.src.primary} ${e.src.secondary ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [enriched, viewMode, portalUserName, filterSection, filterFsLine, filterStatus, searchText]);

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

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 text-blue-500 animate-spin" /></div>;

  if (items.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
        <CheckCircle2 className="h-10 w-10 text-green-400 mx-auto mb-3" />
        <p className="text-sm text-slate-600 font-medium">No outstanding items</p>
        <p className="text-xs text-slate-400 mt-1">All requests have been responded to.</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      {/* Toolbar — search + filters. Compact on one row at md+. */}
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

      {/* Column headers — match the row template grid below */}
      <div className="grid grid-cols-[1.6fr_110px_110px_120px_180px_28px] gap-3 px-4 py-2 bg-slate-100/60 border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
        <button onClick={() => toggleSort('subject')}      className="text-left flex items-center hover:text-slate-900">Subject<SortIcon k="subject" /></button>
        <button onClick={() => toggleSort('requestedAt')}  className="text-left flex items-center hover:text-slate-900">Date Received<SortIcon k="requestedAt" /></button>
        <button onClick={() => toggleSort('lastActionAt')} className="text-left flex items-center hover:text-slate-900">Last Action<SortIcon k="lastActionAt" /></button>
        <button onClick={() => toggleSort('status')}       className="text-left flex items-center hover:text-slate-900">Status<SortIcon k="status" /></button>
        <button onClick={() => toggleSort('source')}       className="text-left flex items-center hover:text-slate-900">Source<SortIcon k="source" /></button>
        <span />
      </div>

      {/* Rows */}
      {sorted.length === 0 ? (
        <div className="px-5 py-8 text-center text-xs text-slate-400 italic">
          No items match the current filters.
        </div>
      ) : (
        <div className="divide-y divide-slate-100">
          {sorted.map(({ item, subject, body, source, lastActionAt, src }) => {
            const isExpanded = expandedId === item.id;
            const statusMeta = STATUS_META[item.status] ?? { label: item.status, cls: 'bg-slate-100 text-slate-700 border border-slate-200' };
            return (
              <div key={item.id} className={isExpanded ? 'bg-blue-50/30' : 'hover:bg-slate-50/60'}>
                {/* Compact row */}
                <button
                  onClick={() => setExpandedId(prev => prev === item.id ? null : item.id)}
                  className="w-full grid grid-cols-[1.6fr_110px_110px_120px_180px_28px] gap-3 px-4 py-2.5 items-center text-left"
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
                  <div className="text-slate-400 flex justify-end">
                    {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </div>
                </button>

                {/* Expanded panel — full chat + response controls */}
                {isExpanded && (
                  <div className="px-4 pb-4 pt-1 border-t border-slate-100">
                    {/* Full body (compact row shows one-line truncation) */}
                    {body && (
                      <p className="text-xs text-slate-700 whitespace-pre-wrap leading-relaxed mb-2">{body}</p>
                    )}

                    <div className="flex items-center gap-2 mb-3 flex-wrap text-[10px] text-slate-500">
                      <span>Requested by <span className="text-slate-700 font-medium">{item.requestedByName}</span> on {formatDateTime(item.requestedAt)}</span>
                      {source && (
                        <span className="px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded">{source}</span>
                      )}
                      {/* Assign-to dropdown — only when client has more than one portal user */}
                      {teamMembers.length > 1 && (
                        <span className="inline-flex items-center gap-1 ml-auto">
                          <UserPlus className="h-3 w-3 text-slate-400" />
                          <span>Assign to:</span>
                          <select
                            value={assignees[item.id] || ''}
                            onChange={e => handleAssign(item.id, e.target.value)}
                            className="text-[10px] border border-slate-200 rounded px-1.5 py-0.5 bg-white"
                            onClick={e => e.stopPropagation()}
                          >
                            <option value="">— Unassigned —</option>
                            {teamMembers.map(m => (
                              <option key={m.id} value={m.name}>{m.name}{m.role ? ` (${m.role})` : ''}</option>
                            ))}
                          </select>
                        </span>
                      )}
                      {assignees[item.id] && teamMembers.length <= 1 && (
                        <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded font-medium">
                          Assigned: {assignees[item.id]}
                        </span>
                      )}
                    </div>

                    {/* Chat history */}
                    {item.chatHistory && item.chatHistory.length > 0 && (
                      <div className="mb-3 space-y-1.5 max-h-60 overflow-y-auto">
                        {item.chatHistory.map((msg, mi) => (
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

                    {/* Error-approvals: checkbox list + single Submit */}
                    {item.section === 'error_approvals' ? (() => {
                      const firstChat = item.chatHistory?.[0] as any;
                      const approvalItems: Array<{ errorId: string; fsLine: string; accountCode: string | null; description: string; errorAmount: number; errorType: string }> =
                        Array.isArray(firstChat?.errorApprovalsRequest?.items) ? firstChat.errorApprovalsRequest.items : [];
                      const checked = approvalChecks[item.id] || new Set<string>();
                      const toggle = (id: string) => {
                        setApprovalChecks(prev => {
                          const next: Record<string, Set<string>> = { ...prev };
                          const s = new Set(next[item.id] || []);
                          if (s.has(id)) s.delete(id); else s.add(id);
                          next[item.id] = s;
                          return next;
                        });
                      };
                      const allTicked = approvalItems.length > 0 && approvalItems.every(a => checked.has(a.errorId));
                      const setAll = (on: boolean) => {
                        setApprovalChecks(prev => ({
                          ...prev,
                          [item.id]: on ? new Set(approvalItems.map(a => a.errorId)) : new Set(),
                        }));
                      };
                      const fmtAmt = (n: number) => Math.abs(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                      return (
                        <div className="space-y-2">
                          {approvalItems.length === 0 ? (
                            <div className="text-xs text-slate-400 italic">No items to approve.</div>
                          ) : (
                            <>
                              <div className="flex items-center justify-between text-[11px]">
                                <span className="text-slate-600">Tick the items you accept and have adjusted.</span>
                                <button onClick={() => setAll(!allTicked)} className="text-blue-600 hover:underline">
                                  {allTicked ? 'Untick all' : 'Tick all'}
                                </button>
                              </div>
                              <div className="border border-slate-200 rounded divide-y divide-slate-100 bg-white">
                                {approvalItems.map(a => {
                                  const isChecked = checked.has(a.errorId);
                                  const isDr = a.errorAmount >= 0;
                                  return (
                                    <label key={a.errorId} className={`flex items-start gap-2 px-3 py-2 cursor-pointer ${isChecked ? 'bg-blue-50/50' : 'hover:bg-slate-50'}`}>
                                      <input type="checkbox" checked={isChecked} onChange={() => toggle(a.errorId)} className="mt-0.5" />
                                      <div className="flex-1 min-w-0">
                                        <div className="text-xs text-slate-700 truncate">
                                          <span className="font-medium">{a.fsLine}</span>
                                          {a.accountCode && <span className="text-slate-400 font-mono ml-1">· {a.accountCode}</span>}
                                        </div>
                                        <div className="text-[11px] text-slate-500">{a.description}</div>
                                      </div>
                                      <div className="text-right text-xs font-mono tabular-nums whitespace-nowrap">
                                        {isDr ? `Dr ${fmtAmt(a.errorAmount)}` : `Cr ${fmtAmt(a.errorAmount)}`}
                                      </div>
                                    </label>
                                  );
                                })}
                              </div>
                              <div className="flex items-center justify-end gap-2">
                                <span className="text-[11px] text-slate-500">{checked.size}/{approvalItems.length} ticked</span>
                                <button
                                  onClick={async () => {
                                    const approvedErrorIds = Array.from(checked);
                                    const payload = JSON.stringify({ approvedErrorIds, decidedAt: new Date().toISOString() });
                                    setResponses(prev => ({ ...prev, [item.id]: payload }));
                                    await Promise.resolve();
                                    await handleSubmitItem({ ...item } as any);
                                  }}
                                  disabled={submitting[item.id]}
                                  className="px-4 py-2 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 transition-colors flex items-center gap-1"
                                >
                                  {submitting[item.id] ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                                  Submit response
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      );
                    })() : (
                      <div className="flex gap-2">
                        <div className="flex-1">
                          <PasteAwareTextarea
                            value={responses[item.id] || ''}
                            onChange={text => setResponses(prev => ({ ...prev, [item.id]: text }))}
                            onFilesAdded={newFiles => setResponseFiles(prev => ({ ...prev, [item.id]: [...(prev[item.id] || []), ...newFiles] }))}
                            placeholder={item.chatHistory?.length ? "Continue the conversation... (paste supported)" : "Enter your response... (you can paste from Excel, Word, or screenshots)"}
                            rows={2}
                          />
                          {(responseFiles[item.id]?.length || 0) > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {responseFiles[item.id].map((f, fi) => (
                                <span key={fi} className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-100 rounded text-[10px] text-slate-600">
                                  📎 {f.name}
                                  <button onClick={() => setResponseFiles(prev => ({ ...prev, [item.id]: prev[item.id].filter((_, i) => i !== fi) }))} className="text-red-400 hover:text-red-600">×</button>
                                </span>
                              ))}
                            </div>
                          )}
                          <label className="inline-flex items-center gap-1 mt-1 text-[10px] text-blue-600 hover:text-blue-800 cursor-pointer font-medium">
                            + Attach file
                            <input type="file" multiple className="hidden" onChange={e => {
                              const files = Array.from(e.target.files || []);
                              setResponseFiles(prev => ({ ...prev, [item.id]: [...(prev[item.id] || []), ...files] }));
                              e.target.value = '';
                            }} />
                          </label>
                        </div>
                        <button
                          onClick={() => handleSubmitItem(item)}
                          disabled={!responses[item.id]?.trim() || submitting[item.id]}
                          className="self-end px-4 py-2 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 transition-colors flex items-center gap-1"
                        >
                          {submitting[item.id] ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                          Submit
                        </button>
                      </div>
                    )}

                    {errors[item.id] && (
                      <p className="text-xs text-red-500 mt-2">{errors[item.id]}</p>
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
