'use client';

import { useState, useEffect } from 'react';
import {
  MapPin, FileCheck, MessageSquare, CheckCircle2, Loader2, X,
  ArrowUpRight, MessageCircle, ChevronUp, UserPlus, Send,
  History, ChevronDown, AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { expandZipFiles } from '@/lib/client-unzip';

interface ChatMessage {
  from: 'firm' | 'client';
  name: string;
  message: string;
  timestamp: string;
  attachments?: { name: string; url?: string; uploadId?: string; storagePath?: string; size?: number }[];
}

interface OutstandingItem {
  id: string;
  type: 'client' | 'team' | 'technical';
  question: string;
  response: string | null;
  status: string;
  requestedByName: string;
  requestedAt: string;
  respondedByName?: string;
  respondedAt?: string;
  assignedTo?: string;
  engagementId?: string;
  chatHistory?: ChatMessage[];
}

interface Props {
  engagementId: string;
  clientId: string;
  currentUserId: string;
  currentUserRole?: string;
  teamMembers?: { userId: string; userName: any; role: string }[];
  specialists?: { name: string; specialistType: string }[];
  onCountsChange?: (team: number, client: number) => void;
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function cleanQuestion(text: string): { question: string; source: string | null } {
  const match = text.match(/^\[(.+?)\]\s*(.+)$/);
  if (match) return { source: match[1], question: match[2] };
  return { source: null, question: text };
}

const TYPE_COLORS = {
  client: 'bg-blue-100 text-blue-700 border-blue-200',
  team: 'bg-orange-100 text-orange-700 border-orange-200',
  technical: 'bg-red-100 text-red-700 border-red-200',
};

export function EngagementOutstandingTab({ engagementId, clientId, currentUserId, currentUserRole, teamMembers = [], specialists = [] }: Props) {
  // Left panel: client responses waiting for team action
  const [teamItems, setTeamItems] = useState<OutstandingItem[]>([]);
  // Right panel: items sent to client, awaiting their response
  const [clientPending, setClientPending] = useState<OutstandingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [chatOpen, setChatOpen] = useState<string | null>(null);
  const [chatText, setChatText] = useState('');
  const [chatFiles, setChatFiles] = useState<File[]>([]);
  const [sending, setSending] = useState<string | null>(null);
  const [assignOpen, setAssignOpen] = useState<string | null>(null);
  const [assignNote, setAssignNote] = useState('');

  // Audit-trail panel state. The log captures every button-triggered
  // decision on the engagement (send to RMM, send for specialist
  // review, specialist accept/reject, etc.) — specifically those that
  // bypass the green-dot sign-off flow — so the firm has a record of
  // who did what. See /api/engagements/[id]/action-log for the source.
  interface ActionLogEntry {
    id: string;
    actorUserId: string | null;
    actorName: string;
    action: string;
    summary: string;
    targetType: string | null;
    targetId: string | null;
    occurredAt: string;
    metadata?: Record<string, unknown> | null;
  }
  const [auditEntries, setAuditEntries] = useState<ActionLogEntry[]>([]);
  const [auditLoading, setAuditLoading] = useState(true);
  const [auditMigrationPending, setAuditMigrationPending] = useState(false);
  const [auditExpanded, setAuditExpanded] = useState(true);
  const [auditFilter, setAuditFilter] = useState<string>('');

  // Keep backward compat — items = teamItems for action handlers
  const items = teamItems;
  const setItems = setTeamItems;

  useEffect(() => { loadItems(); }, [engagementId, clientId]);

  // Load the engagement's audit trail once on mount and whenever we
  // refresh the outstanding lists. Runs in parallel with loadItems —
  // audit-trail data has no dependency on portal requests.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setAuditLoading(true);
      try {
        const res = await fetch(`/api/engagements/${engagementId}/action-log?limit=500`);
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setAuditEntries(Array.isArray(data.entries) ? data.entries : []);
        setAuditMigrationPending(!!data.migrationPending);
      } catch { /* silent — log isn't critical */ }
      finally { if (!cancelled) setAuditLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [engagementId]);

  async function loadItems() {
    setLoading(true);
    try {
      const [respondedRes, outstandingRes] = await Promise.all([
        // Left: client responses waiting for team to verify
        fetch(`/api/portal/requests?clientId=${clientId}&status=responded&engagementId=${engagementId}`),
        // Right: items sent to client, still outstanding
        fetch(`/api/portal/requests?clientId=${clientId}&status=outstanding&engagementId=${engagementId}`),
      ]);

      if (respondedRes.ok) {
        const data = await respondedRes.json();
        setTeamItems((data.requests || []).map((r: any) => {
          // Merge PortalUpload records into chat history attachments as fallback
          const chatHistory = (r.chatHistory || []).map((msg: any) => {
            if (msg.attachments?.length > 0) return msg;
            return msg;
          });
          // If chat history has no attachments but uploads exist, inject them into the last client message
          const uploads = (r.uploads || []).map((u: any) => ({ name: u.originalName, uploadId: u.id, storagePath: u.storagePath }));
          const hasHistoryAttachments = chatHistory.some((m: any) => m.attachments?.length > 0);
          if (uploads.length > 0 && !hasHistoryAttachments) {
            const lastClientMsg = [...chatHistory].reverse().find((m: any) => m.from === 'client');
            if (lastClientMsg) lastClientMsg.attachments = uploads;
          }
          return {
            id: r.id, type: 'client' as const, question: r.question, response: r.response,
            status: r.status, requestedByName: r.requestedByName, requestedAt: r.requestedAt,
            respondedByName: r.respondedByName, respondedAt: r.respondedAt,
            assignedTo: r.assignedTo, engagementId: r.engagementId, chatHistory,
          };
        }));
      }

      if (outstandingRes.ok) {
        const data = await outstandingRes.json();
        setClientPending((data.requests || []).map((r: any) => ({
          id: r.id, type: 'client' as const, question: r.question, response: null,
          status: r.status, requestedByName: r.requestedByName, requestedAt: r.requestedAt,
          respondedByName: null, respondedAt: null,
          assignedTo: null, engagementId: r.engagementId, chatHistory: r.chatHistory || [],
        })));
      }
    } catch {}
    setLoading(false);
  }

  // All team items visible — no toggle needed with split view

  // Action: Commit — push response to the Communication tab
  async function handleCommit(item: OutstandingItem) {
    setSending(item.id);
    try {
      await fetch(`/api/portal/requests`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: item.id, action: 'commit' }),
      });
      setItems(prev => prev.filter(i => i.id !== item.id));
    } catch {}
    setSending(null);
  }

  // Action: Chat — send reply with optional files
  async function handleChatSend(item: OutstandingItem) {
    if (!chatText.trim() && chatFiles.length === 0) return;
    setSending(item.id);
    try {
      // Build attachment metadata (files would be uploaded separately in production)
      const attachments = chatFiles.map(f => ({ name: f.name, url: '', size: f.size }));

      await fetch(`/api/portal/requests`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: item.id,
          action: 'chat',
          message: chatText.trim(),
          fromUserId: currentUserId,
          fromUserName: currentUserRole || 'Audit Team',
          itemType: item.type,
          attachments,
        }),
      });
      setChatText('');
      setChatFiles([]);
      await loadItems();
    } catch {}
    setSending(null);
  }

  // Action: Elevate — move to next senior role
  async function handleElevate(item: OutstandingItem) {
    setSending(item.id);
    try {
      const roleHierarchy = ['Junior', 'Manager', 'RI'];
      const currentIdx = roleHierarchy.indexOf(currentUserRole || 'Junior');
      const nextRole = currentIdx < roleHierarchy.length - 1 ? roleHierarchy[currentIdx + 1] : null;
      const nextPerson = nextRole ? teamMembers.find(m => m.role === nextRole) : null;

      await fetch(`/api/portal/requests`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: item.id,
          action: 'elevate',
          assignTo: nextPerson?.userId,
          assignToName: nextPerson?.userName,
          fromRole: currentUserRole,
          toRole: nextRole,
        }),
      });
      await loadItems();
    } catch {}
    setSending(null);
  }

  // Action: Assign — send to a specialist
  async function handleAssign(item: OutstandingItem, specialistName: string) {
    setSending(item.id);
    try {
      await fetch(`/api/portal/requests`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: item.id,
          action: 'assign',
          assignToSpecialist: specialistName,
          note: assignNote,
        }),
      });
      setAssignOpen(null);
      setAssignNote('');
      await loadItems();
    } catch {}
    setSending(null);
  }

  if (loading) {
    return <div className="flex items-center justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-slate-400 mr-2" /><span className="text-sm text-slate-500">Loading...</span></div>;
  }

  // Action-slug → human label mapping for the audit-trail filter
  // dropdown and per-row icon. Keep in sync with the `action` strings
  // written in lib/engagement-action-log.ts's call sites.
  const ACTION_LABELS: Record<string, string> = {
    'rmm.send-from-par': 'PAR → RMM',
    'specialist.send': 'Specialist review sent',
    'specialist.decide': 'Specialist decision',
    'signoff.sign': 'Sign-off',
    'signoff.unsign': 'Unsign-off',
    'template.generate': 'Template generated',
    'portal.publish': 'Portal publish',
  };
  const filteredAuditEntries = auditFilter
    ? auditEntries.filter(e => e.action === auditFilter)
    : auditEntries;
  const auditActionsInUse = Array.from(new Set(auditEntries.map(e => e.action)));

  return (
    <div className="space-y-6">
    <div className="grid grid-cols-2 gap-4">
      {/* LEFT: Team Action Required — client responses waiting for verification */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <h3 className="text-sm font-semibold text-slate-800">Team Action Required</h3>
          <span className={`inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[10px] font-bold ${
            teamItems.length === 0 ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
          }`}>{teamItems.length}</span>
        </div>

        {teamItems.length === 0 ? (
          <div className="border rounded-lg p-6 text-center">
            <CheckCircle2 className="h-6 w-6 mx-auto mb-2 text-green-400" />
            <p className="text-xs text-slate-500">No responses awaiting action</p>
          </div>
        ) : teamItems.map(item => {
        const typeColor = TYPE_COLORS[item.type] || TYPE_COLORS.team;
        return (
          <div key={item.id} className={`border rounded-lg bg-white overflow-hidden ${item.type === 'technical' ? 'border-red-200' : ''}`}>
            {/* Header */}
            <div className="px-4 py-3">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold border ${typeColor}`}>
                      {item.type === 'client' ? 'Client' : item.type === 'technical' ? 'Technical' : 'Team'}
                    </span>
                    <span className="text-[10px] text-slate-400">{formatDate(item.requestedAt)}</span>
                  </div>
                  {(() => { const { question, source } = cleanQuestion(item.question); return (<>
                    <p className="text-sm text-slate-800 font-medium">{question}</p>
                    {source && <span className="text-[9px] px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded inline-block mt-0.5">{source}</span>}
                  </>); })()}
                  {item.response && (() => {
                    // Strip [Attachments: ...] text from response and show actual file links
                    const cleanResponse = item.response.replace(/\n?\[Attachments:.*?\]/g, '').trim();
                    // Collect attachments from chat history
                    const allAttachments = (item.chatHistory || [])
                      .flatMap(m => m.attachments || [])
                      .filter(a => a.name);
                    return (
                      <div className="mt-2 px-3 py-2 bg-blue-50 rounded-lg border border-blue-100">
                        <p className="text-[10px] text-blue-500 font-medium mb-0.5">
                          {item.respondedByName || 'Response'} &middot; {item.respondedAt ? formatDate(item.respondedAt) : ''}
                        </p>
                        {cleanResponse && <p className="text-xs text-slate-700">{cleanResponse}</p>}
                        {allAttachments.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {allAttachments.map((a, ai) => (
                              <button key={ai} onClick={async () => {
                                try {
                                  const params = a.uploadId ? `uploadId=${a.uploadId}` : a.storagePath ? `storagePath=${encodeURIComponent(a.storagePath)}` : '';
                                  if (!params && a.url) { window.open(a.url, '_blank'); return; }
                                  if (!params) return;
                                  const res = await fetch(`/api/portal/download?${params}`);
                                  if (res.ok) { const d = await res.json(); window.open(d.url, '_blank'); }
                                } catch {}
                              }} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-white rounded text-[9px] text-blue-600 border border-blue-200 hover:bg-blue-50 cursor-pointer">
                                📎 {a.name}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-1.5 mt-3">
                <button
                  onClick={() => handleCommit(item)}
                  disabled={sending === item.id}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-[10px] font-medium bg-green-50 text-green-700 border border-green-200 rounded-md hover:bg-green-100"
                >
                  <CheckCircle2 className="h-3 w-3" /> Commit
                </button>
                <button
                  onClick={() => setChatOpen(chatOpen === item.id ? null : item.id)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-[10px] font-medium bg-blue-50 text-blue-700 border border-blue-200 rounded-md hover:bg-blue-100"
                >
                  <MessageCircle className="h-3 w-3" /> Chat
                </button>
                <button
                  onClick={() => handleElevate(item)}
                  disabled={sending === item.id || currentUserRole === 'RI'}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-[10px] font-medium bg-amber-50 text-amber-700 border border-amber-200 rounded-md hover:bg-amber-100 disabled:opacity-40"
                >
                  <ChevronUp className="h-3 w-3" /> Elevate
                </button>
                <button
                  onClick={() => setAssignOpen(assignOpen === item.id ? null : item.id)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-[10px] font-medium bg-purple-50 text-purple-700 border border-purple-200 rounded-md hover:bg-purple-100"
                >
                  <UserPlus className="h-3 w-3" /> Assign
                </button>
              </div>
            </div>

            {/* Chat panel with history */}
            {chatOpen === item.id && (
              <div className="px-4 py-2 bg-slate-50 border-t">
                {/* Chat history thread */}
                {item.chatHistory && item.chatHistory.length > 0 && (
                  <div className="mb-2 max-h-48 overflow-y-auto space-y-1.5">
                    {item.chatHistory.map((msg, mi) => (
                      <div key={mi} className={`flex ${msg.from === 'firm' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[75%] px-2.5 py-1.5 rounded-lg text-xs ${
                          msg.from === 'firm' ? 'bg-blue-100 text-blue-900' : 'bg-white border text-slate-800'
                        }`}>
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <span className="font-semibold text-[10px]">{msg.name}</span>
                            <span className="text-[9px] text-slate-400">{new Date(msg.timestamp).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                          </div>
                          <p>{msg.message}</p>
                          {msg.attachments && msg.attachments.length > 0 && (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {msg.attachments.map((a, ai) => (
                                <button key={ai} onClick={async () => {
                                  try {
                                    const params = a.uploadId ? `uploadId=${a.uploadId}` : a.storagePath ? `storagePath=${encodeURIComponent(a.storagePath)}` : '';
                                    if (!params && a.url) { window.open(a.url, '_blank'); return; }
                                    if (!params) return;
                                    const res = await fetch(`/api/portal/download?${params}`);
                                    if (res.ok) { const data = await res.json(); window.open(data.url, '_blank'); }
                                  } catch {}
                                }} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-white/50 rounded text-[9px] text-blue-600 border hover:bg-blue-50 hover:border-blue-300 cursor-pointer">
                                  📎 {a.name}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {/* New message input + file attachment */}
                <div className="flex gap-2">
                  <div className="flex-1">
                    <textarea
                      value={chatText}
                      onChange={e => setChatText(e.target.value)}
                      placeholder={item.type === 'client' ? 'Reply to client...' : 'Message to team member...'}
                      rows={2}
                      className="w-full px-3 py-1.5 text-xs border rounded-md resize-none focus:outline-none focus:ring-1 focus:ring-blue-400"
                    />
                    {chatFiles.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {chatFiles.map((f, fi) => (
                          <span key={fi} className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-slate-200 rounded text-[9px]">
                            📎 {f.name}
                            <button onClick={() => setChatFiles(prev => prev.filter((_, i) => i !== fi))} className="text-red-400 hover:text-red-600">×</button>
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="flex items-center gap-2 mt-1">
                      <label className="text-[10px] text-blue-600 hover:text-blue-800 cursor-pointer font-medium">
                        + Attach file
                        <input type="file" multiple accept="*,.zip" className="hidden" onChange={async e => {
                          const files = await expandZipFiles(Array.from(e.target.files || []));
                          setChatFiles(prev => [...prev, ...files]);
                          e.target.value = '';
                        }} />
                      </label>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1 self-end">
                    <button
                      onClick={() => handleChatSend(item)}
                      disabled={(!chatText.trim() && chatFiles.length === 0) || sending === item.id}
                      className="px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-40"
                    >
                      <Send className="h-3 w-3" />
                    </button>
                  </div>
                </div>
                {/* Close & Commit — resolves the chat thread */}
                <div className="flex justify-end mt-2 pt-2 border-t border-slate-200">
                  <button
                    onClick={() => { handleCommit(item); setChatOpen(null); }}
                    disabled={sending === item.id}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-[10px] font-semibold bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-40"
                  >
                    <CheckCircle2 className="h-3 w-3" /> Close Chat & Commit to Communication
                  </button>
                </div>
              </div>
            )}

            {/* Assign panel */}
            {assignOpen === item.id && (
              <div className="px-4 py-2 bg-slate-50 border-t space-y-2">
                {specialists.length > 0 && (
                  <div>
                    <p className="text-[10px] text-slate-500 font-medium mb-1">Specialists</p>
                    <div className="flex flex-wrap gap-1.5">
                      {specialists.map((s, i) => (
                        <button
                          key={`s-${i}`}
                          onClick={() => handleAssign(item, s.name)}
                          disabled={sending === item.id}
                          className="px-2.5 py-1 text-[10px] font-medium bg-white border border-purple-200 rounded-md hover:bg-purple-50 text-purple-700"
                        >
                          {s.name} <span className="text-purple-400">({s.specialistType})</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div>
                  <p className="text-[10px] text-slate-500 font-medium mb-1">Team Members</p>
                  <div className="flex flex-wrap gap-1.5">
                    {teamMembers.filter(m => m.userId !== currentUserId).map((m, i) => (
                      <button
                        key={`t-${i}`}
                        onClick={() => handleAssign(item, m.userName)}
                        disabled={sending === item.id}
                        className="px-2.5 py-1 text-[10px] font-medium bg-white border border-blue-200 rounded-md hover:bg-blue-50 text-blue-700"
                      >
                        {m.userName} <span className="text-blue-400">({m.role})</span>
                      </button>
                    ))}
                    {teamMembers.filter(m => m.userId !== currentUserId).length === 0 && <span className="text-[10px] text-slate-400 italic">No other team members</span>}
                  </div>
                </div>
                {specialists.length === 0 && teamMembers.length <= 1 && <span className="text-[10px] text-slate-400 italic">No specialists or team members to assign to</span>}
                <input
                  type="text"
                  value={assignNote}
                  onChange={e => setAssignNote(e.target.value)}
                  placeholder="Add a note (optional)..."
                  className="w-full px-2 py-1 text-xs border rounded-md"
                />
              </div>
            )}
          </div>
        );
      })}
      </div>

      {/* RIGHT: Sent to Client — awaiting their response */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <h3 className="text-sm font-semibold text-slate-800">Awaiting Client Response</h3>
          <span className={`inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[10px] font-bold ${
            clientPending.length === 0 ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'
          }`}>{clientPending.length}</span>
        </div>

        {clientPending.length === 0 ? (
          <div className="border rounded-lg p-6 text-center">
            <CheckCircle2 className="h-6 w-6 mx-auto mb-2 text-green-400" />
            <p className="text-xs text-slate-500">No items awaiting client response</p>
          </div>
        ) : (
          <div className="space-y-2">
            {clientPending.map(item => {
              const { question, source } = cleanQuestion(item.question);
              const chatMsgs = (item.chatHistory || []).filter((m: ChatMessage) => m.name !== 'System');
              const daysSent = Math.floor((Date.now() - new Date(item.requestedAt).getTime()) / (1000 * 60 * 60 * 24));
              return (
                <div key={item.id} className="border rounded-lg bg-white p-3">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold border bg-orange-100 text-orange-700 border-orange-200">
                          Pending
                        </span>
                        <span className="text-[10px] text-slate-400">{formatDate(item.requestedAt)}</span>
                        <span className={`text-[10px] font-bold ${daysSent > 7 ? 'text-red-600' : daysSent > 3 ? 'text-amber-600' : 'text-slate-500'}`}>
                          {daysSent}d ago
                        </span>
                      </div>
                      <p className="text-xs text-slate-800 font-medium">{question}</p>
                      {source && <span className="text-[9px] px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded inline-block mt-0.5">{source}</span>}
                      <p className="text-[10px] text-slate-400 mt-0.5">Sent by {item.requestedByName}</p>
                    </div>
                  </div>
                  {/* Show chat history if any back-and-forth */}
                  {chatMsgs.length > 0 && (
                    <div className="mt-2 space-y-1 pl-2 border-l-2 border-slate-200 max-h-24 overflow-y-auto">
                      {chatMsgs.map((msg, mi) => (
                        <div key={mi} className={`px-2 py-0.5 rounded text-[10px] ${msg.from === 'firm' ? 'bg-blue-50' : 'bg-slate-50'}`}>
                          <span className="font-semibold">{msg.name}</span>
                          <span className="text-slate-400 ml-1 text-[9px]">{new Date(msg.timestamp).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                          <p className="text-slate-700">{msg.message}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>

    {/* ── Audit trail ─────────────────────────────────────────────────
        Full history of button-triggered actions on this engagement,
        newest first. Captures the decisions that bypass the green-dot
        sign-off flow (send to RMM, send for specialist review,
        specialist accept/reject, etc.) so the firm has a "who did
        what, when" record. Collapsible but open by default — this is
        the primary audit artefact the outstanding tab surfaces. */}
    <div className="border border-slate-200 rounded-lg bg-white overflow-hidden">
      <button
        onClick={() => setAuditExpanded(e => !e)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50"
      >
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-indigo-500" />
          <h3 className="text-sm font-semibold text-slate-800">Audit trail</h3>
          <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700">
            {auditEntries.length}
          </span>
          {auditMigrationPending && (
            <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-amber-700">
              <AlertTriangle className="h-3 w-3" />
              migration pending
            </span>
          )}
        </div>
        <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${auditExpanded ? 'rotate-180' : ''}`} />
      </button>
      {auditExpanded && (
        <div className="border-t border-slate-100">
          {/* Action filter dropdown — scoped to the set of actions
              that have actually been recorded so empty categories
              don't appear. */}
          {auditActionsInUse.length > 1 && (
            <div className="px-4 py-2 flex items-center gap-2 border-b border-slate-100 bg-slate-50/60">
              <span className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">Filter</span>
              <select
                value={auditFilter}
                onChange={e => setAuditFilter(e.target.value)}
                className="text-xs border border-slate-200 rounded px-2 py-1 bg-white"
              >
                <option value="">All actions ({auditEntries.length})</option>
                {auditActionsInUse.map(a => {
                  const count = auditEntries.filter(e => e.action === a).length;
                  const label = ACTION_LABELS[a] || a;
                  return <option key={a} value={a}>{label} ({count})</option>;
                })}
              </select>
              {auditFilter && (
                <button
                  onClick={() => setAuditFilter('')}
                  className="text-[10px] text-blue-600 hover:underline"
                >Clear</button>
              )}
            </div>
          )}

          {auditLoading ? (
            <div className="px-4 py-6 text-center text-xs text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin mx-auto mb-1" />
              Loading audit trail…
            </div>
          ) : auditMigrationPending ? (
            <div className="px-4 py-6 text-xs text-amber-700 bg-amber-50/40">
              The audit-trail table doesn&rsquo;t exist on this environment yet.
              Apply the <code className="font-mono text-[11px] bg-amber-100 px-1 rounded">2026-04-22-engagement-action-log.sql</code>
              migration and refresh.
            </div>
          ) : filteredAuditEntries.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-slate-400 italic">
              No actions recorded yet. Things like &ldquo;Send to RMM&rdquo;, &ldquo;Send for specialist review&rdquo;,
              and the specialist&rsquo;s accept/reject decision will appear here.
            </div>
          ) : (
            <div className="divide-y divide-slate-100 max-h-[60vh] overflow-y-auto">
              {filteredAuditEntries.map(entry => {
                const actionLabel = ACTION_LABELS[entry.action] || entry.action;
                // Colour the left rail by the broad action family so
                // reviewers can scan the log. Specialist decisions get
                // a distinctive indigo; RMM / PAR handoffs get blue.
                const railClass =
                  entry.action === 'specialist.decide' ? 'border-l-indigo-500'
                  : entry.action === 'specialist.send' ? 'border-l-indigo-300'
                  : entry.action.startsWith('rmm.') ? 'border-l-blue-400'
                  : entry.action.startsWith('signoff.') ? 'border-l-green-400'
                  : 'border-l-slate-300';
                return (
                  <div key={entry.id} className={`px-4 py-2 border-l-2 ${railClass} hover:bg-slate-50/60`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[10px] uppercase tracking-wide font-semibold text-slate-500">
                            {actionLabel}
                          </span>
                          <span className="text-xs font-medium text-slate-800">{entry.actorName}</span>
                          {entry.actorUserId === null && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
                              external
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-700 mt-0.5 whitespace-pre-wrap">{entry.summary}</p>
                      </div>
                      <span className="text-[10px] text-slate-400 whitespace-nowrap flex-shrink-0">
                        {formatDate(entry.occurredAt)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
    </div>
  );
}
