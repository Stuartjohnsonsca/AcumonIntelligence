'use client';

/**
 * Specialist Hub — cross-engagement portal UI.
 *
 * One screen for an external specialist working across multiple
 * clients/periods. Top of page: Client dropdown + filter pills (All
 * / Unresponded / Responded / Closed) + date filters. Below: list
 * of chats matching the filters, each expandable in place with a
 * minimal composer (message, optional call-link).
 *
 * Auth: hub HMAC over the email. The page passes (email, sig) on
 * every API call.
 */

import { useEffect, useMemo, useState, Fragment } from 'react';
import { Loader2, Send, MessageSquare, FileText, CheckCircle2, ChevronDown, ChevronRight, ExternalLink, Phone, Zap } from 'lucide-react';

interface ChatAttachment {
  id: string;
  name: string;
  blobName?: string;
  mimeType?: string | null;
  size?: number;
}
interface ChatMessage {
  id: string;
  userId: string;
  userName: string;
  role: string;
  message: string;
  createdAt: string;
  attachments?: ChatAttachment[];
  callLink?: { label?: string; url: string };
}
interface SpecialistItem {
  id: string;
  kind: 'chat' | 'report' | 'conclusion';
  title: string;
  createdAt: string;
  createdByName: string;
  body: string;
  messages: ChatMessage[];
  status: 'open' | 'completed';
  sourceQuestionId?: string;
  sourceActionKey?: string;
}

interface HubItem {
  engagementId: string;
  clientId: string;
  clientName: string;
  periodId: string | null;
  periodStartDate: string | null;
  periodEndDate: string | null;
  auditType: string;
  roleKey: string;
  roleLabel: string;
  item: SpecialistItem;
  status: 'closed' | 'responded' | 'unresponded';
  initiatedAt: string;
  lastMessageAt: string;
  deepLink: string;
}

interface ClientOpt { id: string; name: string }

interface Props {
  email: string;
  sig: string;
}

type StatusFilter = 'all' | 'unresponded' | 'responded' | 'closed';

const STATUS_LABEL: Record<HubItem['status'], string> = {
  unresponded: 'Awaiting your response',
  responded: 'With audit team',
  closed: 'Closed',
};
const STATUS_COLOR: Record<HubItem['status'], string> = {
  unresponded: 'bg-amber-100 text-amber-800 border-amber-200',
  responded: 'bg-blue-100 text-blue-800 border-blue-200',
  closed: 'bg-slate-100 text-slate-700 border-slate-200',
};

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('en-GB'); } catch { return iso; }
}
function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return iso; }
}

export function SpecialistPortalHubClient({ email, sig }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hubItems, setHubItems] = useState<HubItem[]>([]);
  const [clients, setClients] = useState<ClientOpt[]>([]);
  const [clientId, setClientId] = useState<string>('');
  const [periodId, setPeriodId] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [initiatedFrom, setInitiatedFrom] = useState('');
  const [initiatedTo, setInitiatedTo] = useState('');
  const [lastFrom, setLastFrom] = useState('');
  const [lastTo, setLastTo] = useState('');
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  // Per-item toggle for the message thread inside an expanded card.
  // Long conversations get noisy by default; auditors can click
  // 'Show conversation' to reveal the thread separately from the
  // composer / source body. Defaults to "show" when there are <=2
  // messages so short chats don't need an extra click.
  const [conversationCollapsed, setConversationCollapsed] = useState<Record<string, boolean>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [sending, setSending] = useState<string | null>(null);
  const [callLink, setCallLink] = useState<Record<string, string>>({});

  const baseQs = new URLSearchParams({ email, sig }).toString();

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/specialist-portal/hub?${baseQs}`);
      if (res.status === 403) {
        setError('This link is no longer valid. Ask the audit team to send you a fresh link.');
        return;
      }
      if (!res.ok) {
        setError(`Failed to load hub (${res.status})`);
        return;
      }
      const data = await res.json();
      setHubItems(Array.isArray(data?.items) ? data.items : []);
      setClients(Array.isArray(data?.clients) ? data.clients : []);
    } catch (err: any) {
      setError(err?.message || 'Failed to load hub');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [email, sig]);

  // Derived: periods for the chosen client (or all clients if no
  // client picked yet). Sorted newest endDate first.
  const periods = useMemo(() => {
    const map = new Map<string, { id: string; endDate: string | null }>();
    for (const it of hubItems) {
      if (clientId && it.clientId !== clientId) continue;
      if (!it.periodId) continue;
      if (!map.has(it.periodId)) {
        map.set(it.periodId, { id: it.periodId, endDate: it.periodEndDate });
      }
    }
    return Array.from(map.values()).sort((a, b) => (b.endDate || '').localeCompare(a.endDate || ''));
  }, [hubItems, clientId]);

  // Reset Period when Client changes — a stale periodId from another
  // client would leak the wrong scope.
  useEffect(() => { setPeriodId(''); }, [clientId]);

  // Filter list. Status counts shown in the pills are computed from
  // the same scope (client + period) but ignore the date filters so
  // moving between status pills doesn't re-arrange counts.
  const scopedItems = useMemo(() => {
    return hubItems.filter(it => {
      if (clientId && it.clientId !== clientId) return false;
      if (periodId && it.periodId !== periodId) return false;
      return true;
    });
  }, [hubItems, clientId, periodId]);
  const statusCounts = useMemo(() => {
    const c: Record<HubItem['status'], number> = { unresponded: 0, responded: 0, closed: 0 };
    for (const it of scopedItems) c[it.status]++;
    return c;
  }, [scopedItems]);

  const filtered = useMemo(() => {
    return scopedItems.filter(it => {
      if (statusFilter !== 'all' && it.status !== statusFilter) return false;
      if (initiatedFrom && it.initiatedAt && it.initiatedAt < initiatedFrom) return false;
      if (initiatedTo) {
        const to = `${initiatedTo}T23:59:59.999Z`;
        if (it.initiatedAt && it.initiatedAt > to) return false;
      }
      if (lastFrom && it.lastMessageAt && it.lastMessageAt < lastFrom) return false;
      if (lastTo) {
        const to = `${lastTo}T23:59:59.999Z`;
        if (it.lastMessageAt && it.lastMessageAt > to) return false;
      }
      return true;
    });
  }, [scopedItems, statusFilter, initiatedFrom, initiatedTo, lastFrom, lastTo]);

  async function send(it: HubItem) {
    const draft = (drafts[it.item.id] || '').trim();
    const link = (callLink[it.item.id] || '').trim();
    if (!draft && !link) return;
    setSending(it.item.id);
    try {
      const body: any = { engagementId: it.engagementId, roleKey: it.roleKey, itemId: it.item.id, message: draft };
      if (link && /^https?:\/\//i.test(link)) {
        body.callLink = { url: link };
      }
      const res = await fetch(`/api/specialist-portal/hub?${baseQs}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setError(err?.error || `Send failed (${res.status})`);
        return;
      }
      setDrafts(prev => ({ ...prev, [it.item.id]: '' }));
      setCallLink(prev => ({ ...prev, [it.item.id]: '' }));
      await load();
    } finally {
      setSending(null);
    }
  }

  if (loading) return (
    <div className="py-12 text-center text-sm text-slate-500">
      <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" /> Loading your specialist hub…
    </div>
  );
  if (error) return (
    <div className="py-12 text-center">
      <p className="text-sm text-red-700">{error}</p>
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-white border border-slate-200 rounded-lg p-4">
        <h1 className="text-xl font-semibold text-slate-900">Specialist Hub</h1>
        <p className="text-xs text-slate-500 mt-0.5">
          Signed in as <code className="bg-slate-100 px-1 rounded">{email}</code> · {hubItems.length} item{hubItems.length === 1 ? '' : 's'} across {clients.length} client{clients.length === 1 ? '' : 's'}
        </p>
      </div>

      {/* Client + Period scope */}
      <div className="bg-white border border-slate-200 rounded-lg p-3 grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="block text-[11px] font-medium text-slate-600 mb-1">Client</label>
          <select
            value={clientId}
            onChange={e => setClientId(e.target.value)}
            className="w-full text-sm border border-slate-300 rounded px-2 py-1.5 bg-white"
          >
            <option value="">All clients</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[11px] font-medium text-slate-600 mb-1">Period</label>
          <select
            value={periodId}
            onChange={e => setPeriodId(e.target.value)}
            disabled={!clientId}
            className="w-full text-sm border border-slate-300 rounded px-2 py-1.5 bg-white disabled:bg-slate-100"
          >
            <option value="">{clientId ? 'All periods' : 'Pick a client first'}</option>
            {periods.map(p => (
              <option key={p.id} value={p.id}>Period ended {fmtDate(p.endDate)}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Status pills + date filters */}
      <div className="bg-white border border-slate-200 rounded-lg p-3 space-y-2">
        <div className="flex flex-wrap gap-1.5">
          {(['all', 'unresponded', 'responded', 'closed'] as StatusFilter[]).map(s => {
            const count = s === 'all'
              ? scopedItems.length
              : statusCounts[s as HubItem['status']];
            const active = statusFilter === s;
            return (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-2.5 py-1 text-xs rounded-full border ${active ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'}`}
              >
                {s === 'all' ? 'All' : STATUS_LABEL[s as HubItem['status']]} ({count})
              </button>
            );
          })}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 pt-2 border-t border-slate-100">
          <div>
            <label className="block text-[10px] text-slate-500 mb-0.5">Initiated from</label>
            <input type="date" value={initiatedFrom} onChange={e => setInitiatedFrom(e.target.value)} className="w-full text-xs border border-slate-300 rounded px-2 py-1" />
          </div>
          <div>
            <label className="block text-[10px] text-slate-500 mb-0.5">Initiated to</label>
            <input type="date" value={initiatedTo} onChange={e => setInitiatedTo(e.target.value)} className="w-full text-xs border border-slate-300 rounded px-2 py-1" />
          </div>
          <div>
            <label className="block text-[10px] text-slate-500 mb-0.5">Last response from</label>
            <input type="date" value={lastFrom} onChange={e => setLastFrom(e.target.value)} className="w-full text-xs border border-slate-300 rounded px-2 py-1" />
          </div>
          <div>
            <label className="block text-[10px] text-slate-500 mb-0.5">Last response to</label>
            <input type="date" value={lastTo} onChange={e => setLastTo(e.target.value)} className="w-full text-xs border border-slate-300 rounded px-2 py-1" />
          </div>
        </div>
        {(initiatedFrom || initiatedTo || lastFrom || lastTo || statusFilter !== 'all') && (
          <button
            onClick={() => { setInitiatedFrom(''); setInitiatedTo(''); setLastFrom(''); setLastTo(''); setStatusFilter('all'); }}
            className="text-[10px] text-slate-500 hover:text-slate-800 underline"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Item list */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        {filtered.length === 0 ? (
          <div className="py-10 text-center text-sm text-slate-400 italic">
            No items match the current filters.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filtered.map(it => {
              const key = `${it.engagementId}|${it.roleKey}|${it.item.id}`;
              const isExpanded = expandedKey === key;
              // Row tint communicates status at a glance: closed
              // chats fade back, awaiting-you chats wear an amber
              // accent stripe (matches the status pill), back-with-
              // team chats get a quieter blue, and items hovered
              // out of focus go faintly tinted.
              const rowTint =
                it.status === 'closed' ? 'bg-slate-50/80 opacity-75' :
                it.status === 'unresponded' ? 'bg-amber-50/60' :
                'bg-blue-50/40';
              const accentBar =
                it.status === 'closed' ? 'border-l-4 border-l-slate-300' :
                it.status === 'unresponded' ? 'border-l-4 border-l-amber-400' :
                'border-l-4 border-l-blue-400';
              // Default the conversation collapse to OPEN for short
              // chats (≤2 messages) and CLOSED for longer ones, so
              // expanding an item with a 30-message history doesn't
              // dump the whole thread on the screen.
              const collapseDefault = it.item.messages.length > 2;
              const conversationCollapsedNow = (key in conversationCollapsed)
                ? conversationCollapsed[key]
                : collapseDefault;
              return (
                <Fragment key={key}>
                  <div
                    className={`px-3 py-2.5 cursor-pointer transition-colors ${rowTint} ${accentBar} ${isExpanded ? 'shadow-inner' : 'hover:bg-slate-100/60'}`}
                    onClick={() => setExpandedKey(prev => prev === key ? null : key)}
                  >
                    <div className="flex items-center gap-2">
                      {isExpanded ? <ChevronDown className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />}
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border ${STATUS_COLOR[it.status]}`}>
                        {STATUS_LABEL[it.status]}
                      </span>
                      {it.item.kind === 'chat' && <MessageSquare className="h-3 w-3 text-slate-400 flex-shrink-0" />}
                      {it.item.kind === 'report' && <FileText className="h-3 w-3 text-slate-400 flex-shrink-0" />}
                      {it.item.kind === 'conclusion' && <CheckCircle2 className="h-3 w-3 text-slate-400 flex-shrink-0" />}
                      <span className={`text-sm font-medium truncate ${it.status === 'closed' ? 'text-slate-500' : 'text-slate-800'}`}>{it.item.title}</span>
                      {it.item.sourceActionKey && (
                        <span className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 bg-amber-100 text-amber-800 border border-amber-200 rounded" title="Fired by a schedule action">
                          <Zap className="h-2.5 w-2.5" /> Schedule action
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-500 mt-1 ml-5 flex flex-wrap gap-x-3 gap-y-0.5">
                      <span><strong>{it.clientName}</strong> · {it.roleLabel}{it.periodEndDate ? ` · period ended ${fmtDate(it.periodEndDate)}` : ''}</span>
                      <span>Initiated {fmtDate(it.initiatedAt)}</span>
                      <span>Last message {fmtDateTime(it.lastMessageAt)}</span>
                      <span>{it.item.messages.length} message{it.item.messages.length === 1 ? '' : 's'}</span>
                    </div>
                  </div>
                  {isExpanded && (
                    <div className="px-3 py-3 bg-white border-t border-slate-100 space-y-3">
                      {it.item.body && (
                        <div className="text-xs text-slate-700 whitespace-pre-wrap break-words bg-slate-50 border border-slate-200 rounded p-2">
                          {it.item.body}
                        </div>
                      )}
                      {/* Conversation header — separate collapse from
                          the parent card so long threads can be
                          tucked away while the composer + source
                          body stay visible. */}
                      <div>
                        <button
                          onClick={() => setConversationCollapsed(prev => ({ ...prev, [key]: !conversationCollapsedNow }))}
                          className="w-full flex items-center justify-between text-[11px] font-medium text-slate-700 px-2 py-1 bg-slate-100 hover:bg-slate-200 rounded transition-colors"
                        >
                          <span className="inline-flex items-center gap-1">
                            {conversationCollapsedNow ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                            Conversation ({it.item.messages.length} message{it.item.messages.length === 1 ? '' : 's'})
                          </span>
                          {it.item.messages.length > 0 && (
                            <span className="text-[10px] text-slate-500 font-normal">
                              Last {fmtDateTime(it.lastMessageAt)}
                            </span>
                          )}
                        </button>
                      </div>
                      {!conversationCollapsedNow && (
                        <div className="space-y-1.5 max-h-96 overflow-y-auto pr-1">
                          {it.item.messages.length === 0 ? (
                            <p className="text-[11px] italic text-slate-400 text-center py-3 bg-slate-50 rounded">No messages yet — be the first to reply.</p>
                          ) : it.item.messages.map(m => {
                            const fromMe = (m.userId || '').toLowerCase() === `external:${email.toLowerCase()}`;
                            return (
                              <div key={m.id} className={`flex ${fromMe ? 'justify-end' : 'justify-start'}`}>
                                <div className={`text-xs p-2 rounded-lg border max-w-[80%] ${fromMe ? 'bg-blue-50 border-blue-200 rounded-br-none' : 'bg-slate-50 border-slate-200 rounded-bl-none'}`}>
                                  <div className="flex items-center gap-2 text-[10px] text-slate-500 mb-1">
                                    <strong className={fromMe ? 'text-blue-800' : 'text-slate-700'}>
                                      {fromMe ? 'You' : (m.userName || 'Audit team')}
                                    </strong>
                                    {m.role && <><span>·</span><span>{m.role}</span></>}
                                    <span className="ml-auto">{fmtDateTime(m.createdAt)}</span>
                                  </div>
                                  {m.message && <div className="whitespace-pre-wrap break-words text-slate-800">{m.message}</div>}
                                  {m.callLink && (
                                    <a href={m.callLink.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 mt-1 text-[11px] px-2 py-0.5 bg-emerald-100 text-emerald-800 border border-emerald-200 rounded hover:bg-emerald-200">
                                      <Phone className="h-2.5 w-2.5" /> {m.callLink.label || 'Join call'}
                                    </a>
                                  )}
                                  {m.attachments && m.attachments.length > 0 && (
                                    <div className="mt-1 flex flex-wrap gap-1">
                                      {m.attachments.map(a => (
                                        <a
                                          key={a.id}
                                          href={`/api/engagements/${encodeURIComponent(it.engagementId)}/specialists/attachments?blob=${encodeURIComponent(a.blobName || a.id)}&roleKey=${encodeURIComponent(it.roleKey)}&${baseQs}`}
                                          target="_blank"
                                          rel="noreferrer"
                                          className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 bg-slate-100 text-slate-700 border border-slate-200 rounded hover:bg-slate-200"
                                        >
                                          📎 {a.name}
                                        </a>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                      {it.item.status === 'open' ? (
                        <div className="space-y-1.5">
                          <textarea
                            value={drafts[it.item.id] || ''}
                            onChange={e => setDrafts(prev => ({ ...prev, [it.item.id]: e.target.value }))}
                            placeholder="Type a reply…"
                            rows={3}
                            className="w-full text-xs border border-slate-300 rounded p-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              value={callLink[it.item.id] || ''}
                              onChange={e => setCallLink(prev => ({ ...prev, [it.item.id]: e.target.value }))}
                              placeholder="Optional call URL (https://…)"
                              className="flex-1 text-xs border border-slate-300 rounded p-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                            <button
                              onClick={() => void send(it)}
                              disabled={sending === it.item.id || (!drafts[it.item.id]?.trim() && !callLink[it.item.id]?.trim())}
                              className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 inline-flex items-center gap-1"
                            >
                              {sending === it.item.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                              Send
                            </button>
                          </div>
                          <a
                            href={it.deepLink}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-[10px] text-slate-500 hover:text-slate-800"
                          >
                            <ExternalLink className="h-2.5 w-2.5" /> Open in dedicated view (with file attachments)
                          </a>
                        </div>
                      ) : (
                        <p className="text-[11px] italic text-slate-500">This item is closed — read-only.</p>
                      )}
                    </div>
                  )}
                </Fragment>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
