'use client';

import { useState, useEffect } from 'react';
import {
  MapPin, FileCheck, MessageSquare, CheckCircle2, Loader2, X,
  ArrowUpRight, MessageCircle, ChevronUp, UserPlus, Send,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ChatMessage {
  from: 'firm' | 'client';
  name: string;
  message: string;
  timestamp: string;
  attachments?: { name: string; url: string; size?: number }[];
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
  teamMembers?: { userId: string; userName: string; role: string }[];
  specialists?: { name: string; specialistType: string }[];
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
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
  const [items, setItems] = useState<OutstandingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'my' | 'team'>('my');
  const [chatOpen, setChatOpen] = useState<string | null>(null);
  const [chatText, setChatText] = useState('');
  const [chatFiles, setChatFiles] = useState<File[]>([]);
  const [sending, setSending] = useState<string | null>(null);
  const [assignOpen, setAssignOpen] = useState<string | null>(null);
  const [assignNote, setAssignNote] = useState('');

  useEffect(() => { loadItems(); }, [engagementId, clientId]);

  async function loadItems() {
    setLoading(true);
    try {
      // Load responded portal requests (client responses)
      const res = await fetch(`/api/portal/requests?clientId=${clientId}&status=responded`);
      if (res.ok) {
        const data = await res.json();
        const clientItems: OutstandingItem[] = (data.requests || []).map((r: any) => ({
          id: r.id,
          type: 'client' as const,
          question: r.question,
          response: r.response,
          status: r.status,
          requestedByName: r.requestedByName,
          requestedAt: r.requestedAt,
          respondedByName: r.respondedByName,
          respondedAt: r.respondedAt,
          assignedTo: r.assignedTo,
          engagementId: r.engagementId,
          chatHistory: r.chatHistory || [],
        }));
        setItems(clientItems);
      }
    } catch {}
    setLoading(false);
  }

  // My Items = all team items (every team member sees everything) — "Team" is the same view
  // The toggle filters to just items assigned/relevant to the current user
  const myItems = items; // Every team item is a My Item
  const filteredItems = view === 'team'
    ? items // Team: show all
    : items.filter(i =>
        i.assignedTo === currentUserId ||
        i.requestedByName === currentUserId ||
        !i.assignedTo // Unassigned items visible to everyone
      );

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

  return (
    <div className="space-y-3">
      {/* Toggle: My Items / Team Items */}
      <div className="flex items-center gap-2">
        <div className="flex bg-slate-100 rounded-lg p-0.5">
          <button onClick={() => setView('my')} className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${view === 'my' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>
            My Items
          </button>
          <button onClick={() => setView('team')} className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${view === 'team' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>
            Team Items
          </button>
        </div>
        <span className="text-xs text-slate-400">{filteredItems.length} item{filteredItems.length !== 1 ? 's' : ''}</span>
      </div>

      {filteredItems.length === 0 && (
        <div className="border rounded-lg p-8 text-center">
          <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-green-400" />
          <p className="text-sm text-slate-500">No outstanding items</p>
        </div>
      )}

      {filteredItems.map(item => {
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
                  {item.response && (
                    <div className="mt-2 px-3 py-2 bg-blue-50 rounded-lg border border-blue-100">
                      <p className="text-[10px] text-blue-500 font-medium mb-0.5">
                        {item.respondedByName || 'Response'} &middot; {item.respondedAt ? formatDate(item.respondedAt) : ''}
                      </p>
                      <p className="text-xs text-slate-700">{item.response}</p>
                    </div>
                  )}
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
                                <a key={ai} href={a.url || '#'} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-white/50 rounded text-[9px] text-blue-600 border hover:bg-blue-50 hover:border-blue-300 cursor-pointer">
                                  📎 {a.name}
                                </a>
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
                        <input type="file" multiple className="hidden" onChange={e => {
                          const files = Array.from(e.target.files || []);
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
  );
}
