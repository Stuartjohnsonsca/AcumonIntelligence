'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Plus, Send, Check, AlertTriangle, Loader2, ChevronDown, Users, ArrowRight, CheckCircle2 } from 'lucide-react';
import { setCurrentLocation, subscribeNav, consumePendingNav } from '@/lib/engagement-nav';

interface TaxChat {
  id: string;
  taxCategory: string;
  chatNumber: number;
  status: string;
  businessBackground: string | null;
  conclusion: string | null;
  conclusionStatus: string | null;
  createdByName: string;
  assignedToName: string | null;
  assignedToType: string;
  delegatedToName: string | null;
  messages: { id: string; userId: string; userName: string; role: string; message: string; createdAt: string }[];
  createdAt: string;
}

interface Props {
  engagementId: string;
  clientName?: string;
}

const DEFAULT_CATEGORIES = [
  'Value Added Tax', 'Corporation Tax', 'Employment Taxes', 'Capital Allowances',
  'Chargeable Gains', 'Stamp Duty Land Tax', 'Stamp Duty Reserve Tax', 'Trade Losses Utilisation/Surrender',
];

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

export function TaxTechnicalTab({ engagementId, clientName }: Props) {
  const [categories, setCategories] = useState<string[]>(DEFAULT_CATEGORIES);
  const [activeCategory, setActiveCategory] = useState('');
  const [chats, setChats] = useState<TaxChat[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [newMessage, setNewMessage] = useState('');
  const [showNewChat, setShowNewChat] = useState(false);
  const [newChatForm, setNewChatForm] = useState({ background: '', message: '', assignedTo: '', assignedType: 'internal' as 'internal' | 'external' });
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Load tax categories from methodology template
  useEffect(() => {
    fetch(`/api/methodology-admin/templates?templateType=tax_technical_categories&engagementId=${encodeURIComponent(engagementId)}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        const items = data?.template?.items;
        if (Array.isArray(items) && items.length > 0) {
          // Items might be strings (section defaults) or TemplateQuestion objects
          const cats = items.map((item: any) => typeof item === 'string' ? item : item.sectionKey || item.questionText || '').filter(Boolean);
          if (cats.length > 0) setCategories(cats);
        }
      })
      .catch(() => {});
  }, []);

  // Set first category as active
  useEffect(() => {
    if (!activeCategory && categories.length > 0) setActiveCategory(categories[0]);
  }, [categories, activeCategory]);

  // Tab-level overall sign-off — same data shape as Walkthroughs so
  // the EngagementTabs PF-section loader can read it without bespoke
  // plumbing. Stored under PF section 'tax_technical_overall_signoffs'.
  const [overallSignOffs, setOverallSignOffs] = useState<{ reviewer?: { name: string; at: string }; ri?: { name: string; at: string } }>({});
  useEffect(() => {
    fetch(`/api/engagements/${engagementId}/permanent-file?section=tax_technical_overall_signoffs`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { const data = d?.data || d?.answers; if (data) setOverallSignOffs(data); })
      .catch(() => {});
  }, [engagementId]);
  function toggleOverallSignOff(role: 'reviewer' | 'ri') {
    const current = overallSignOffs[role];
    // Build the next state with no `undefined` values — these get
    // dropped by JSON.stringify and combined with the server's
    // default merge semantics would mean un-signing a role never
    // actually clears it. See WalkthroughsTab.toggleOverallSignOff
    // for the same fix and a longer note on the bug.
    const next: typeof overallSignOffs = {};
    if (role === 'reviewer') {
      if (!current) next.reviewer = { name: 'Current User', at: new Date().toISOString() };
      if (overallSignOffs.ri) next.ri = overallSignOffs.ri;
    } else {
      if (overallSignOffs.reviewer) next.reviewer = overallSignOffs.reviewer;
      if (!current) next.ri = { name: 'Current User', at: new Date().toISOString() };
    }
    setOverallSignOffs(next);
    fetch(`/api/engagements/${engagementId}/permanent-file`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sectionKey: 'tax_technical_overall_signoffs', data: next, replace: true }),
    }).then(() => {
      try { window.dispatchEvent(new CustomEvent('engagement:signoffs-changed')); } catch {}
    }).catch(() => {});
  }

  // Engagement-nav wiring — push the active tax category as our
  // sub-tab so a back-link from elsewhere (e.g. an RI matter raised
  // on a specific tax category) lands in that category.
  useEffect(() => {
    if (activeCategory) {
      setCurrentLocation({ tab: 'tax-technical', subTab: activeCategory, label: `Tax Technical › ${activeCategory}` });
    }
  }, [activeCategory]);
  useEffect(() => {
    const claimed = consumePendingNav(loc => loc.tab === 'tax-technical');
    if (claimed?.subTab && categories.includes(claimed.subTab)) {
      setActiveCategory(claimed.subTab);
    }
  // Run when categories list lands (it loads async).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categories]);
  useEffect(() => {
    const unsub = subscribeNav((target) => {
      if (target.tab !== 'tax-technical' || !target.subTab) return;
      if (categories.includes(target.subTab)) setActiveCategory(target.subTab);
    });
    return unsub;
  }, [categories]);

  // Load chats for active category
  const loadChats = useCallback(async () => {
    if (!activeCategory) return;
    setLoading(true);
    try {
      const slug = slugify(activeCategory);
      const res = await fetch(`/api/engagements/${engagementId}/tax-technical?category=${slug}`);
      if (res.ok) {
        const data = await res.json();
        setChats(data.chats || []);
      }
    } catch (err) {
      console.error('Failed to load tax chats:', err);
    } finally {
      setLoading(false);
    }
  }, [engagementId, activeCategory]);

  useEffect(() => { loadChats(); setActiveChatId(null); }, [loadChats]);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeChatId, chats]);

  const activeChat = chats.find(c => c.id === activeChatId);

  // Create new chat
  const handleCreateChat = async () => {
    if (!newChatForm.message.trim()) return;
    setSending(true);
    try {
      const res = await fetch(`/api/engagements/${engagementId}/tax-technical`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          taxCategory: slugify(activeCategory),
          businessBackground: newChatForm.background || null,
          assignedToName: newChatForm.assignedTo || null,
          assignedToType: newChatForm.assignedType,
          initialMessage: newChatForm.message,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setActiveChatId(data.chat.id);
        setShowNewChat(false);
        setNewChatForm({ background: '', message: '', assignedTo: '', assignedType: 'internal' });
        await loadChats();
      }
    } finally {
      setSending(false);
    }
  };

  // Send message
  const handleSendMessage = async () => {
    if (!newMessage.trim() || !activeChatId) return;
    setSending(true);
    try {
      await fetch(`/api/engagements/${engagementId}/tax-technical`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'message', chatId: activeChatId, message: newMessage }),
      });
      setNewMessage('');
      await loadChats();
    } finally {
      setSending(false);
    }
  };

  // Conclude chat
  const handleConclude = async (conclusionStatus: string, conclusion: string) => {
    if (!activeChatId) return;
    await fetch(`/api/engagements/${engagementId}/tax-technical`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'conclude', chatId: activeChatId, conclusionStatus, conclusion }),
    });
    await loadChats();
  };

  return (
    <div className="flex flex-col h-full">
      {/* Category sub-tabs + overall sign-off */}
      <div className="flex items-center gap-3 mb-3 shrink-0">
        <div className="flex gap-0.5 bg-slate-100 rounded p-0.5 overflow-x-auto flex-1">
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => { setActiveCategory(cat); setActiveChatId(null); }}
              className={`px-2.5 py-1 text-[10px] font-medium rounded whitespace-nowrap transition-colors ${
                activeCategory === cat ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
        {/* Overall sign-off — same layout as Walkthroughs so the user
            sees consistent dot UI across tabs. Reviewer + RI; an RI
            sign-off cascades to fill the Reviewer dot too. */}
        <div className="shrink-0 inline-flex items-center gap-2 border-l border-slate-200 pl-3">
          <span className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">Tab sign-off</span>
          <button
            onClick={() => toggleOverallSignOff('reviewer')}
            className="flex items-center gap-1"
            title={overallSignOffs.reviewer ? `Reviewed by ${overallSignOffs.reviewer.name} — click to unsign` : 'Click to sign off as Reviewer'}
          >
            <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${overallSignOffs.reviewer ? 'bg-green-500 border-green-500' : 'border-green-400 hover:bg-green-50'}`}>
              {overallSignOffs.reviewer && <CheckCircle2 className="h-3 w-3 text-white" />}
            </div>
            <span className="text-[9px] text-slate-500">R</span>
          </button>
          <button
            onClick={() => toggleOverallSignOff('ri')}
            className="flex items-center gap-1"
            title={overallSignOffs.ri ? `RI signed by ${overallSignOffs.ri.name} — click to unsign` : 'Click to sign off as RI'}
          >
            <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${overallSignOffs.ri ? 'bg-green-500 border-green-500' : 'border-green-400 hover:bg-green-50'}`}>
              {overallSignOffs.ri && <CheckCircle2 className="h-3 w-3 text-white" />}
            </div>
            <span className="text-[9px] text-slate-500">RI</span>
          </button>
        </div>
      </div>

      <div className="flex flex-1 gap-3 min-h-0">
        {/* Chat list sidebar */}
        <div className="w-56 shrink-0 border rounded-lg overflow-hidden flex flex-col">
          <div className="flex items-center justify-between px-3 py-2 bg-slate-50 border-b">
            <span className="text-[10px] font-semibold text-slate-500 uppercase">{activeCategory}</span>
            <button onClick={() => setShowNewChat(true)} className="p-0.5 text-blue-500 hover:text-blue-700 hover:bg-blue-50 rounded">
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {loading && <div className="p-3 text-center"><Loader2 className="h-4 w-4 animate-spin text-slate-300 mx-auto" /></div>}
            {!loading && chats.length === 0 && (
              <div className="p-3 text-center text-[10px] text-slate-400">No conversations yet.</div>
            )}
            {chats.map(chat => (
              <button
                key={chat.id}
                onClick={() => setActiveChatId(chat.id)}
                className={`w-full text-left px-3 py-2 border-b border-slate-50 transition-colors ${
                  activeChatId === chat.id ? 'bg-blue-50' : 'hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-medium text-slate-700">#{chat.chatNumber}</span>
                  <span className={`text-[8px] px-1.5 py-0.5 rounded-full font-medium ${
                    chat.status === 'concluded' ? 'bg-green-100 text-green-700' :
                    chat.status === 'referred' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'
                  }`}>{chat.status}</span>
                </div>
                <div className="text-[9px] text-slate-400 mt-0.5 truncate">
                  {chat.assignedToName ? `→ ${chat.assignedToName}` : 'Unassigned'}
                  {chat.assignedToType === 'external' && ' (ext)'}
                </div>
                <div className="text-[9px] text-slate-300 mt-0.5">{chat.messages.length} message{chat.messages.length !== 1 ? 's' : ''}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Chat area */}
        <div className="flex-1 border rounded-lg overflow-hidden flex flex-col">
          {!activeChatId && !showNewChat ? (
            <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
              Select a conversation or start a new one
            </div>
          ) : showNewChat ? (
            /* New chat form */
            <div className="flex-1 p-4 space-y-3 overflow-y-auto">
              <h3 className="text-sm font-semibold text-slate-700">New {activeCategory} Conversation</h3>
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">Business Background</label>
                <textarea
                  value={newChatForm.background}
                  onChange={e => setNewChatForm(f => ({ ...f, background: e.target.value }))}
                  className="w-full border border-slate-200 rounded-md px-2.5 py-1.5 text-xs min-h-[80px] focus:outline-none focus:border-blue-300"
                  placeholder={`Describe the client's ${activeCategory.toLowerCase()} position and any specific areas of concern...`}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-600 block mb-1">Assign To</label>
                  <input
                    type="text"
                    value={newChatForm.assignedTo}
                    onChange={e => setNewChatForm(f => ({ ...f, assignedTo: e.target.value }))}
                    className="w-full border border-slate-200 rounded-md px-2.5 py-1.5 text-xs focus:outline-none focus:border-blue-300"
                    placeholder="Tax specialist name"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-600 block mb-1">Type</label>
                  <select
                    value={newChatForm.assignedType}
                    onChange={e => setNewChatForm(f => ({ ...f, assignedType: e.target.value as 'internal' | 'external' }))}
                    className="w-full border border-slate-200 rounded-md px-2 py-1.5 text-xs bg-white focus:outline-none focus:border-blue-300"
                  >
                    <option value="internal">Internal (Team Member)</option>
                    <option value="external">External (Via Portal)</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">Initial Question / Request</label>
                <textarea
                  value={newChatForm.message}
                  onChange={e => setNewChatForm(f => ({ ...f, message: e.target.value }))}
                  className="w-full border border-slate-200 rounded-md px-2.5 py-1.5 text-xs min-h-[60px] focus:outline-none focus:border-blue-300"
                  placeholder="What do you need the tax specialist to review?"
                />
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleCreateChat}
                  disabled={sending || !newChatForm.message.trim()}
                  className="inline-flex items-center gap-1 text-xs px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 font-medium"
                >
                  {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                  Start Conversation
                </button>
                <button onClick={() => setShowNewChat(false)} className="text-xs text-slate-400 hover:text-slate-600">Cancel</button>
              </div>
            </div>
          ) : activeChat ? (
            /* Active chat view */
            <>
              {/* Chat header */}
              <div className="px-4 py-2 bg-slate-50 border-b flex items-center justify-between">
                <div>
                  <span className="text-xs font-semibold text-slate-700">{activeCategory} #{activeChat.chatNumber}</span>
                  {activeChat.assignedToName && (
                    <span className="text-[10px] text-slate-400 ml-2">
                      <Users className="h-3 w-3 inline mr-0.5" />
                      {activeChat.assignedToName}
                      {activeChat.assignedToType === 'external' && ' (external)'}
                      {activeChat.delegatedToName && <span className="text-amber-500"> → {activeChat.delegatedToName}</span>}
                    </span>
                  )}
                </div>
                {activeChat.status === 'open' && (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => {
                        const conclusion = prompt('Enter conclusion:');
                        if (conclusion) handleConclude('correct', conclusion);
                      }}
                      className="text-[10px] px-2 py-0.5 bg-green-50 text-green-700 border border-green-200 rounded hover:bg-green-100 font-medium"
                    >
                      <Check className="h-3 w-3 inline mr-0.5" />Conclude
                    </button>
                  </div>
                )}
                {activeChat.status === 'concluded' && activeChat.conclusion && (
                  <div className={`text-[10px] px-2 py-0.5 rounded font-medium ${
                    activeChat.conclusionStatus === 'correct' ? 'bg-green-100 text-green-700' :
                    activeChat.conclusionStatus === 'incorrect' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                  }`}>
                    {activeChat.conclusionStatus === 'correct' ? 'Treatment Correct' :
                     activeChat.conclusionStatus === 'incorrect' ? 'Needs Adjustment' : 'Inconclusive'}
                  </div>
                )}
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {activeChat.messages.map((msg: any) => (
                  <div key={msg.id} className={`flex ${msg.role === 'audit_team' ? 'justify-end' : msg.role === 'system' ? 'justify-center' : 'justify-start'}`}>
                    {msg.role === 'system' ? (
                      <div className="px-3 py-1.5 bg-slate-100 rounded-lg text-[10px] text-slate-500 max-w-[80%] whitespace-pre-wrap">{msg.message}</div>
                    ) : (
                      <div className={`max-w-[75%] ${msg.role === 'audit_team' ? 'bg-blue-50 border-blue-100' : 'bg-green-50 border-green-100'} border rounded-lg px-3 py-2`}>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[9px] font-semibold text-slate-600">{msg.userName}</span>
                          <span className={`text-[8px] px-1 py-0 rounded ${msg.role === 'audit_team' ? 'bg-blue-100 text-blue-600' : 'bg-green-100 text-green-600'}`}>
                            {msg.role === 'audit_team' ? 'Audit' : 'Tax'}
                          </span>
                          <span className="text-[8px] text-slate-300">{new Date(msg.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                        <p className="text-xs text-slate-700 whitespace-pre-wrap">{msg.message}</p>
                      </div>
                    )}
                  </div>
                ))}
                {activeChat.conclusion && (
                  <div className="flex justify-center">
                    <div className={`px-4 py-2 rounded-lg border text-xs font-medium ${
                      activeChat.conclusionStatus === 'correct' ? 'bg-green-50 border-green-200 text-green-700' :
                      activeChat.conclusionStatus === 'incorrect' ? 'bg-red-50 border-red-200 text-red-700' : 'bg-amber-50 border-amber-200 text-amber-700'
                    }`}>
                      <Check className="h-3.5 w-3.5 inline mr-1" />
                      Conclusion: {activeChat.conclusion}
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Message input */}
              {activeChat.status === 'open' && (
                <div className="border-t px-3 py-2 flex items-center gap-2">
                  <input
                    type="text"
                    value={newMessage}
                    onChange={e => setNewMessage(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSendMessage()}
                    className="flex-1 border border-slate-200 rounded-md px-2.5 py-1.5 text-xs focus:outline-none focus:border-blue-300"
                    placeholder="Type a message..."
                  />
                  <button
                    onClick={handleSendMessage}
                    disabled={sending || !newMessage.trim()}
                    className="p-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                  >
                    {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                  </button>
                </div>
              )}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
