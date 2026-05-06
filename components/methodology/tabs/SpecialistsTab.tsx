'use client';

/**
 * Specialists tab — replaces the old Tax Technical tab. The tab key
 * is still 'tax-technical' for storage / sign-off-section back-compat;
 * the user-visible label is "Specialists".
 *
 * Sub-tabs are sourced from the engagement's specialist assignments
 * (the dropdown rows on the Opening tab → TeamPanel). Each sub-tab
 * holds an item list — chats, reports, conclusions — that the
 * auditor expands to read or sign off.
 *
 * Sign-off semantics:
 *   - Per-item P / R / RI dots (clickable; the sign-off-helpers
 *     gate by team role).
 *   - Per-sub-tab aggregate: a role's dot is "all" only when every
 *     item in that sub-tab is signed for that role; "some" when one
 *     or more (but not all) are signed; "none" otherwise.
 *   - Tab-label aggregate: "all" only when every populated sub-tab
 *     is "all"; "some" if any sub-tab has any sign-off; "none"
 *     otherwise. Reviewer and RI are computed independently.
 *
 * The tab-label aggregate is broadcast by writing a derived state
 * blob to the existing PF section `tax_technical_overall_signoffs`
 * with extra `partial` markers, so the EngagementTabs custom loader
 * (added below in the same change) can render hollow / solid dots.
 */

import { useState, useEffect, useCallback, useRef, useMemo, type ReactNode } from 'react';
import { Plus, ChevronDown, ChevronRight, MessageSquare, FileText, CheckCircle2, Trash2, Send } from 'lucide-react';
import { SignOffDots } from '../SignOffDots';
import type { TeamMemberLite } from '@/lib/sign-off-helpers';

// ─── Types ─────────────────────────────────────────────────────────

interface EngagementSpecialistRef {
  id: string;
  /** specialistType holds the firm's role key (e.g. 'tax_technical', 'mrlo'). */
  specialistType: string;
  name: string;
  email?: string;
}

interface SignOffRecord { userId?: string; userName?: string; timestamp?: string }
type SignOffMap = Record<string, SignOffRecord | undefined>;

interface ChatMessage {
  id: string;
  userId: string;
  userName: string;
  role: string;
  message: string;
  createdAt: string;
  attachments?: { id: string; name: string; url?: string }[];
}

type ItemKind = 'chat' | 'report' | 'conclusion';

interface SpecialistItem {
  id: string;
  kind: ItemKind;
  title: string;
  createdAt: string;
  createdByName: string;
  // Plain-text body for reports/conclusions; used as the seed
  // narrative + final write-up area when a chat completes.
  body: string;
  // Chat history. Reports/conclusions ignore this.
  messages: ChatMessage[];
  // Per-item sign-offs. Same shape as Communication's signOffs map.
  signOffs: SignOffMap;
  // 'open' | 'completed' — once 'completed', a chat's messages are
  // archived and the item moves into "report" mode (chat history
  // shown read-only).
  status: 'open' | 'completed';
}

interface RoleItems { items: SpecialistItem[] }
type SpecialistsState = Record<string, RoleItems>; // keyed by specialistType (role key)

interface Props {
  engagementId: string;
  specialists: EngagementSpecialistRef[];
  teamMembers: TeamMemberLite[];
  currentUserId: string | undefined;
  currentUserName: string | undefined;
}

const ITEM_KIND_LABEL: Record<ItemKind, string> = {
  chat: 'Chat',
  report: 'Report',
  conclusion: 'Conclusion',
};

const ITEM_KIND_ICON: Record<ItemKind, ReactNode> = {
  chat: <MessageSquare className="h-3 w-3" />,
  report: <FileText className="h-3 w-3" />,
  conclusion: <CheckCircle2 className="h-3 w-3" />,
};

// ─── Aggregation helpers ───────────────────────────────────────────

type AggregateState = 'all' | 'some' | 'none';

function aggregateForRole(items: SpecialistItem[], roleKey: string): AggregateState {
  if (items.length === 0) return 'none';
  let signed = 0;
  for (const it of items) {
    if (it.signOffs[roleKey]?.timestamp) signed++;
  }
  if (signed === 0) return 'none';
  if (signed === items.length) return 'all';
  return 'some';
}

function aggregateAcrossSubTabs(states: AggregateState[]): AggregateState {
  // Tab-label rule: solid green only when every populated sub-tab
  // is fully signed, hollow when any sign-off exists, blank when
  // nothing is signed anywhere.
  if (states.length === 0) return 'none';
  if (states.every(s => s === 'all')) return 'all';
  if (states.some(s => s !== 'none')) return 'some';
  return 'none';
}

// ─── Component ─────────────────────────────────────────────────────

export function SpecialistsTab({ engagementId, specialists, teamMembers, currentUserId, currentUserName }: Props) {
  const [state, setState] = useState<SpecialistsState>({});
  const [loading, setLoading] = useState(true);
  const [activeRoleKey, setActiveRoleKey] = useState<string>('');
  const [expandedItemIds, setExpandedItemIds] = useState<Set<string>>(new Set());
  const [showNewItemFor, setShowNewItemFor] = useState<string | null>(null);
  const [newItemKind, setNewItemKind] = useState<ItemKind>('report');
  const [newItemTitle, setNewItemTitle] = useState('');
  const [newItemBody, setNewItemBody] = useState('');
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Persist state under PF section 'specialists_items'. The legacy
  // tax-technical chat data lives in its own section + DB rows; we
  // don't migrate it automatically — the new Specialists workflow
  // starts fresh per engagement.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/engagements/${engagementId}/permanent-file?section=specialists_items`);
        if (!cancelled && res.ok) {
          const data = await res.json();
          const blob = data?.data || data?.answers || {};
          if (blob && typeof blob === 'object') setState(blob as SpecialistsState);
        }
      } catch { /* tolerant */ } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [engagementId]);

  // Pick the first specialist as active on mount / when the list
  // first lands.
  useEffect(() => {
    if (!activeRoleKey && specialists.length > 0) {
      setActiveRoleKey(specialists[0].specialistType);
    }
  }, [specialists, activeRoleKey]);

  // Debounced auto-save. We also write a derived blob to
  // `tax_technical_overall_signoffs` so the EngagementTabs tab-bar
  // dots reflect the new aggregate without needing every consumer
  // to re-implement the rule.
  const persist = useCallback((next: SpecialistsState) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      try {
        await fetch(`/api/engagements/${engagementId}/permanent-file`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sectionKey: 'specialists_items', data: next, replace: true }),
        });

        // Write the aggregate sign-off summary (used by the
        // tab-bar custom loader). Per-role state is 'all' / 'some'
        // / 'none' — the loader translates those to signed /
        // stale / none.
        const reviewerStates = Object.values(next).map(r => aggregateForRole(r.items, 'reviewer'));
        const riStates = Object.values(next).map(r => aggregateForRole(r.items, 'ri'));
        const summary = {
          reviewer: aggregateAcrossSubTabs(reviewerStates),
          ri: aggregateAcrossSubTabs(riStates),
          partial: true, // marker so the loader knows to honour the per-role state field
        };
        await fetch(`/api/engagements/${engagementId}/permanent-file`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sectionKey: 'tax_technical_overall_signoffs', data: summary, replace: true }),
        });
        try { window.dispatchEvent(new CustomEvent('engagement:signoffs-changed')); } catch {}
      } catch { /* tolerant */ }
    }, 800);
  }, [engagementId]);

  function applyState(next: SpecialistsState) {
    setState(next);
    persist(next);
  }

  function getItemsFor(roleKey: string): SpecialistItem[] {
    return state[roleKey]?.items || [];
  }

  function addItem(roleKey: string) {
    if (!newItemTitle.trim()) return;
    const item: SpecialistItem = {
      id: `it_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      kind: newItemKind,
      title: newItemTitle.trim(),
      createdAt: new Date().toISOString(),
      createdByName: currentUserName || 'User',
      body: newItemBody.trim(),
      messages: [],
      signOffs: {},
      status: 'open',
    };
    const next: SpecialistsState = {
      ...state,
      [roleKey]: { items: [...(state[roleKey]?.items || []), item] },
    };
    applyState(next);
    setExpandedItemIds(prev => { const n = new Set(prev); n.add(item.id); return n; });
    setNewItemTitle('');
    setNewItemBody('');
    setShowNewItemFor(null);
  }

  function removeItem(roleKey: string, itemId: string) {
    if (!confirm('Remove this item? This cannot be undone.')) return;
    const next: SpecialistsState = {
      ...state,
      [roleKey]: { items: (state[roleKey]?.items || []).filter(i => i.id !== itemId) },
    };
    applyState(next);
  }

  function toggleSignOff(roleKey: string, itemId: string, dotRole: string) {
    if (!currentUserId) return;
    const items = state[roleKey]?.items || [];
    const idx = items.findIndex(i => i.id === itemId);
    if (idx < 0) return;
    const item = items[idx];
    const existing = item.signOffs[dotRole];
    const isSelf = existing?.userId === currentUserId;
    const nextSignOffs: SignOffMap = { ...item.signOffs };
    if (existing && isSelf) {
      // Toggle off — only the same user can clear their own signoff.
      delete nextSignOffs[dotRole];
    } else if (!existing) {
      nextSignOffs[dotRole] = {
        userId: currentUserId,
        userName: currentUserName || 'User',
        timestamp: new Date().toISOString(),
      };
    }
    const nextItems = items.slice();
    nextItems[idx] = { ...item, signOffs: nextSignOffs };
    applyState({ ...state, [roleKey]: { items: nextItems } });
  }

  function appendChatMessage(roleKey: string, itemId: string, message: string) {
    if (!message.trim() || !currentUserId) return;
    const items = state[roleKey]?.items || [];
    const idx = items.findIndex(i => i.id === itemId);
    if (idx < 0) return;
    const item = items[idx];
    const teamRole = teamMembers.find(t => t.userId === currentUserId)?.role || 'User';
    const next: SpecialistItem = {
      ...item,
      messages: [...item.messages, {
        id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        userId: currentUserId,
        userName: currentUserName || 'User',
        role: teamRole,
        message: message.trim(),
        createdAt: new Date().toISOString(),
      }],
    };
    const nextItems = items.slice();
    nextItems[idx] = next;
    applyState({ ...state, [roleKey]: { items: nextItems } });
  }

  function completeChat(roleKey: string, itemId: string) {
    const items = state[roleKey]?.items || [];
    const idx = items.findIndex(i => i.id === itemId);
    if (idx < 0) return;
    const item = items[idx];
    if (item.kind !== 'chat') return;
    const transcript = item.messages
      .map(m => `[${new Date(m.createdAt).toLocaleString('en-GB')}] ${m.userName}: ${m.message}`)
      .join('\n');
    const nextItems = items.slice();
    nextItems[idx] = {
      ...item,
      status: 'completed',
      // Move chat history into the body so it reads as a report.
      body: item.body
        ? `${item.body}\n\n--- Chat transcript ---\n${transcript}`
        : transcript,
    };
    applyState({ ...state, [roleKey]: { items: nextItems } });
  }

  function toggleExpanded(itemId: string) {
    setExpandedItemIds(prev => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId); else next.add(itemId);
      return next;
    });
  }

  // ─── Sub-tab dot rendering ──────────────────────────────────────
  // Per the spec: blank, hollow, or solid green — Reviewer and RI
  // are independent. The "hollow" state is rendered as a green
  // ring with transparent fill.
  function renderAggregateDot(state: AggregateState): ReactNode {
    if (state === 'all') return <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />;
    if (state === 'some') return <span className="w-2 h-2 rounded-full border border-green-500 bg-transparent inline-block" />;
    return <span className="w-2 h-2 rounded-full border border-slate-300 bg-transparent inline-block" />;
  }

  // ─── Render ─────────────────────────────────────────────────────

  if (loading) {
    return <div className="py-10 text-center text-xs text-slate-400 animate-pulse">Loading specialists…</div>;
  }
  if (specialists.length === 0) {
    return (
      <div className="py-12 text-center">
        <p className="text-sm text-slate-500 mb-1">No specialists assigned yet</p>
        <p className="text-xs text-slate-400">Add specialists on the Opening tab to populate this section.</p>
      </div>
    );
  }

  const activeRole = specialists.find(s => s.specialistType === activeRoleKey) || specialists[0];
  const activeItems = getItemsFor(activeRole.specialistType);

  return (
    <div className="space-y-4">
      {/* Sub-tab strip — one tab per assigned specialist. Each
          carries Reviewer + RI aggregate dots. */}
      <div className="flex flex-wrap gap-1 border-b border-slate-200">
        {specialists.map(spec => {
          const items = getItemsFor(spec.specialistType);
          const reviewer = aggregateForRole(items, 'reviewer');
          const ri = aggregateForRole(items, 'ri');
          const isActive = spec.specialistType === activeRole.specialistType;
          return (
            <button
              key={spec.id || spec.specialistType}
              onClick={() => setActiveRoleKey(spec.specialistType)}
              className={`px-3 py-1.5 text-xs font-medium border-b-2 inline-flex items-center gap-1.5 transition-colors ${
                isActive
                  ? 'border-blue-500 text-blue-700'
                  : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
              }`}
            >
              <span>{spec.specialistType.replace(/_/g, ' ')}</span>
              {spec.name && <span className="text-[10px] text-slate-400">· {spec.name}</span>}
              <span className="inline-flex items-center gap-0.5 ml-1" title={`Reviewer: ${reviewer} · RI: ${ri}`}>
                {renderAggregateDot(reviewer)}
                {renderAggregateDot(ri)}
              </span>
            </button>
          );
        })}
      </div>

      {/* Active sub-tab content */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">{activeRole.specialistType.replace(/_/g, ' ')}</h3>
            <p className="text-xs text-slate-500">
              {activeRole.name}{activeRole.email ? ` · ${activeRole.email}` : ''} —
              <span className="ml-1">{activeItems.length} item{activeItems.length === 1 ? '' : 's'}</span>
            </p>
          </div>
          <button
            onClick={() => setShowNewItemFor(showNewItemFor === activeRole.specialistType ? null : activeRole.specialistType)}
            className="text-xs px-3 py-1.5 bg-blue-50 text-blue-700 border border-blue-200 rounded hover:bg-blue-100 inline-flex items-center gap-1"
          >
            <Plus className="h-3 w-3" /> Add item
          </button>
        </div>

        {/* Add-item form */}
        {showNewItemFor === activeRole.specialistType && (
          <div className="mb-3 border border-blue-200 bg-blue-50/40 rounded-lg p-3 space-y-2">
            <div className="flex items-center gap-2">
              <label className="text-[10px] font-medium text-slate-600">Type:</label>
              <select
                value={newItemKind}
                onChange={e => setNewItemKind(e.target.value as ItemKind)}
                className="text-xs border border-slate-300 rounded px-2 py-1 bg-white"
              >
                <option value="chat">Chat</option>
                <option value="report">Report</option>
                <option value="conclusion">Conclusion</option>
              </select>
              <input
                type="text"
                value={newItemTitle}
                onChange={e => setNewItemTitle(e.target.value)}
                placeholder="Title"
                className="flex-1 text-xs border border-slate-300 rounded px-2 py-1"
              />
            </div>
            <textarea
              value={newItemBody}
              onChange={e => setNewItemBody(e.target.value)}
              placeholder={
                newItemKind === 'chat' ? 'Optional opening message / brief…' :
                newItemKind === 'report' ? 'Report body…' :
                'Conclusion body…'
              }
              rows={3}
              className="w-full text-xs border border-slate-300 rounded px-2 py-1 resize-y"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setShowNewItemFor(null); setNewItemTitle(''); setNewItemBody(''); }}
                className="text-xs px-3 py-1 text-slate-500 hover:text-slate-700"
              >Cancel</button>
              <button
                onClick={() => addItem(activeRole.specialistType)}
                disabled={!newItemTitle.trim()}
                className="text-xs px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
              >Add</button>
            </div>
          </div>
        )}

        {/* Item list */}
        {activeItems.length === 0 ? (
          <p className="text-xs text-slate-400 italic py-6 text-center">No items yet for this specialist.</p>
        ) : (
          <div className="space-y-2">
            {activeItems.map(item => {
              const isExpanded = expandedItemIds.has(item.id);
              return (
                <div key={item.id} className="border border-slate-200 rounded-lg overflow-hidden bg-white">
                  <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 hover:bg-slate-100 transition-colors">
                    <button
                      onClick={() => toggleExpanded(item.id)}
                      className="flex-1 flex items-center gap-2 text-left"
                    >
                      {isExpanded ? <ChevronDown className="h-3.5 w-3.5 text-slate-400" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-400" />}
                      <span className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold inline-flex items-center gap-1">
                        {ITEM_KIND_ICON[item.kind]}
                        {ITEM_KIND_LABEL[item.kind]}
                      </span>
                      <span className="text-xs font-medium text-slate-800 truncate">{item.title}</span>
                      {item.status === 'completed' && (
                        <span className="text-[9px] px-1.5 py-0.5 bg-green-100 text-green-700 rounded">Completed</span>
                      )}
                      <span className="text-[10px] text-slate-400 ml-auto whitespace-nowrap">
                        {item.createdByName} · {new Date(item.createdAt).toLocaleDateString('en-GB')}
                      </span>
                    </button>
                    <SignOffDots
                      signOffs={item.signOffs}
                      teamMembers={teamMembers}
                      currentUserId={currentUserId}
                      onToggle={role => toggleSignOff(activeRole.specialistType, item.id, role)}
                      size="sm"
                      hideRoleLabels
                    />
                    <button
                      onClick={() => removeItem(activeRole.specialistType, item.id)}
                      className="text-slate-400 hover:text-red-600"
                      title="Remove item"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                  {isExpanded && (
                    <div className="p-3 space-y-2">
                      {item.body && (
                        <div className="text-xs text-slate-700 whitespace-pre-wrap break-words bg-slate-50 rounded p-2">
                          {item.body}
                        </div>
                      )}
                      {item.kind === 'chat' && item.status === 'open' && (
                        <ChatPanel
                          messages={item.messages}
                          onSend={msg => appendChatMessage(activeRole.specialistType, item.id, msg)}
                          onComplete={() => completeChat(activeRole.specialistType, item.id)}
                        />
                      )}
                      {item.kind === 'chat' && item.status === 'completed' && item.messages.length > 0 && (
                        <div className="text-[10px] text-slate-400 italic">
                          Chat completed — {item.messages.length} message{item.messages.length === 1 ? '' : 's'} archived into the report body above.
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
    </div>
  );
}

// ─── Chat panel (open-state only) ──────────────────────────────────

function ChatPanel({ messages, onSend, onComplete }: { messages: ChatMessage[]; onSend: (msg: string) => void; onComplete: () => void }) {
  const [draft, setDraft] = useState('');
  return (
    <div className="space-y-2">
      <div className="space-y-1.5 max-h-[300px] overflow-auto border border-slate-200 rounded p-2 bg-white">
        {messages.length === 0 ? (
          <p className="text-[10px] text-slate-400 italic text-center py-2">No messages yet.</p>
        ) : messages.map(m => (
          <div key={m.id} className="text-xs">
            <div className="flex items-baseline gap-1.5">
              <span className="font-medium text-slate-700">{m.userName}</span>
              <span className="text-[9px] text-slate-400">{m.role}</span>
              <span className="text-[9px] text-slate-400 ml-auto">{new Date(m.createdAt).toLocaleString('en-GB')}</span>
            </div>
            <p className="text-slate-700 whitespace-pre-wrap break-words ml-1 mt-0.5">{m.message}</p>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <textarea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder="Type a message…"
          rows={2}
          className="flex-1 text-xs border border-slate-300 rounded px-2 py-1 resize-y"
          onKeyDown={e => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              if (draft.trim()) { onSend(draft); setDraft(''); }
            }
          }}
        />
        <div className="flex flex-col gap-1">
          <button
            onClick={() => { if (draft.trim()) { onSend(draft); setDraft(''); } }}
            disabled={!draft.trim()}
            className="text-xs px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 inline-flex items-center gap-1"
          >
            <Send className="h-3 w-3" /> Send
          </button>
          <button
            onClick={onComplete}
            className="text-[10px] px-2 py-1 bg-green-50 text-green-700 border border-green-200 rounded hover:bg-green-100"
            title="Mark this chat complete and migrate the transcript into the report body"
          >
            Complete
          </button>
        </div>
      </div>
    </div>
  );
}

export default SpecialistsTab;
