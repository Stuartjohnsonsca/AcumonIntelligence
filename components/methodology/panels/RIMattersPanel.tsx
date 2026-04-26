'use client';

import { useState, useEffect, useMemo, useRef, cloneElement, isValidElement } from 'react';
import {
  Plus, Loader2, X, ChevronDown, ChevronRight, Send, Shield,
  AlertOctagon, FileWarning, MessageCircle, Sparkles, Check, ExternalLink,
  History, ClipboardCheck,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { LucideIcon } from 'lucide-react';
import {
  encodeNavReference, decodeNavReference, getCurrentLocation, navigateTo,
} from '@/lib/engagement-nav';

/**
 * Generic audit-points panel — used for both RI Matters and Review
 * Points. Behaviour and layout are identical (per spec — Review Points
 * should mirror RI Matters); the differences are theming, labels, and
 * the pointType used in the API calls.
 *
 * UX rules:
 *   - Collapsible list; each item is a compact row by default, click
 *     to expand and see the chat / actions.
 *   - Newest / most recently updated items at the top.
 *   - User can traffic-light each item (green / amber / red / clear).
 *   - Status badges: new | open | closed.
 *   - Everyone can CREATE / RESPOND.
 *   - Only the RI (or Partner) can CLOSE — enforced server-side.
 *   - RI-only actions: Send to Portal / Technical / Ethics; Raise as
 *     Error / Management / Representation.
 *
 * To avoid breaking imports in EngagementTabs, RIMattersPanel is kept
 * as the wrapper-with-default-config, and ReviewPointsPanel imports
 * the same generic component with pointType='review_point'.
 */

export type AuditPointType = 'ri_matter' | 'review_point';

interface PanelConfig {
  pointType: AuditPointType;
  title: string;             // header — "RI Matters" / "Review Points"
  itemSingularCap: string;    // "Matter" / "Point" — for "New Matter"/"New Point"
  describeNoun: string;       // "RI matter" / "review point" — for placeholder/confirm text
  emptyText: string;
  actionsLabel: string;       // "RI actions:" / "Reviewer actions:"
  modalPrefix: string;        // "RI matter" / "Review point" — used in modal titles
  icon: LucideIcon;
  // Tailwind class strings for the header/create theme. Can't be
  // synthesised at runtime because Tailwind's JIT only sees literal
  // strings; that's why we have one full record per theme.
  theme: {
    headerBg: string;             // 'bg-red-50/60'
    headerIconColor: string;      // 'text-red-600'
    headerTitleColor: string;     // 'text-red-800'
    headerSubtitleColor: string;  // 'text-red-600/80'
    createBg: string;             // 'bg-red-50/20'
    createInputBorder: string;    // 'border-red-200'
    spinnerColor: string;         // 'text-red-500'
    createButtonBg: string;       // 'bg-red-600 hover:bg-red-700'
    errorBox: string;             // 'text-red-700 bg-red-50 border-red-200'
  };
}

const PANEL_CONFIGS: Record<AuditPointType, PanelConfig> = {
  ri_matter: {
    pointType: 'ri_matter',
    title: 'RI Matters',
    itemSingularCap: 'Matter',
    describeNoun: 'RI matter',
    emptyText: 'No RI matters raised yet.',
    actionsLabel: 'RI actions:',
    modalPrefix: 'RI matter',
    icon: Shield,
    theme: {
      headerBg: 'bg-red-50/60',
      headerIconColor: 'text-red-600',
      headerTitleColor: 'text-red-800',
      headerSubtitleColor: 'text-red-600/80',
      createBg: 'bg-red-50/20',
      createInputBorder: 'border-red-200',
      spinnerColor: 'text-red-500',
      createButtonBg: 'bg-red-600 hover:bg-red-700',
      errorBox: 'text-red-700 bg-red-50 border-red-200',
    },
  },
  review_point: {
    pointType: 'review_point',
    title: 'Review Points',
    itemSingularCap: 'Point',
    describeNoun: 'review point',
    emptyText: 'No review points yet.',
    actionsLabel: 'Reviewer actions:',
    modalPrefix: 'Review point',
    icon: ClipboardCheck,
    theme: {
      headerBg: 'bg-amber-50/60',
      headerIconColor: 'text-amber-600',
      headerTitleColor: 'text-amber-800',
      headerSubtitleColor: 'text-amber-600/80',
      createBg: 'bg-amber-50/20',
      createInputBorder: 'border-amber-200',
      spinnerColor: 'text-amber-500',
      createButtonBg: 'bg-amber-600 hover:bg-amber-700',
      errorBox: 'text-amber-700 bg-amber-50 border-amber-200',
    },
  },
};

interface Response {
  id: string;
  userId: string;
  userName: string;
  message: string;
  attachments?: Array<{ name: string; url?: string }>;
  createdAt: string;
}

interface Matter {
  id: string;
  chatNumber: number;
  status: 'new' | 'open' | 'closed' | string;
  colour: string | null;
  description: string;
  reference: string | null;
  createdById: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  closedByName: string | null;
  closedAt: string | null;
  responses: Response[] | null;
  attachments: any;
}

interface Props {
  engagementId: string;
  userId: string;
  userRole?: string; // Junior | Manager | RI | Partner
  onClose: () => void;
  onAction?: (action: string, pointId: string) => void;
  // Defaults to 'ri_matter' so existing call sites (RIMattersPanel
  // alias) keep working unchanged. ReviewPointsPanel passes
  // 'review_point' through.
  pointType?: AuditPointType;
}

// Action-log entry attributed to a specific matter. Built from
// /action-log entries by normalising the various ways an entry can
// reference its source RI matter (target id vs. metadata).
interface MatterActionLogEntry {
  id: string;
  matterId: string;
  action: string;       // 'audit-point.send-portal' | '...close' | etc.
  summary: string;
  actorName: string;
  occurredAt: string;
}

// Friendly label for each action slug. Anything unrecognised falls
// back to the slug itself, which is still better than nothing.
const ACTION_LABELS: Record<string, string> = {
  'audit-point.close': 'Closed',
  'audit-point.send-portal': 'Sent to Client Portal',
  'audit-point.send-technical': 'Sent to Technical',
  'audit-point.send-ethics': 'Sent to Ethics Partner',
  'audit-point.raise-error': 'Raised as Error',
  'audit-point.raise-management': 'Raised as Management Point',
  'audit-point.raise-representation': 'Raised as Representation Point',
};

const COLOUR_STYLES: Record<string, { bg: string; border: string; text: string; dot: string }> = {
  green: { bg: 'bg-green-50', border: 'border-green-300', text: 'text-green-800', dot: 'bg-green-500' },
  amber: { bg: 'bg-amber-50', border: 'border-amber-300', text: 'text-amber-800', dot: 'bg-amber-500' },
  red:   { bg: 'bg-red-50',   border: 'border-red-300',   text: 'text-red-800',   dot: 'bg-red-500' },
};
const STATUS_STYLES: Record<string, string> = {
  new:    'bg-blue-100 text-blue-700 border-blue-200',
  open:   'bg-amber-100 text-amber-700 border-amber-200',
  closed: 'bg-slate-200 text-slate-600 border-slate-300',
};

export function RIMattersPanel({ engagementId, userId, userRole, onClose, onAction, pointType = 'ri_matter' }: Props) {
  const config = PANEL_CONFIGS[pointType];
  const Icon = config.icon;
  const [matters, setMatters] = useState<Matter[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newDesc, setNewDesc] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  // Action-log entries already attributed to specific matters. Loaded
  // alongside the matters list and refreshed every time a write that
  // logs (close/send-*/raise-*) completes, so the history popover
  // shows newly-performed actions immediately.
  const [actionLog, setActionLog] = useState<MatterActionLogEntry[]>([]);
  // Which matter's history popover is currently open (id, or null).
  const [openHistoryFor, setOpenHistoryFor] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [replyDraft, setReplyDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null); // matter id currently being mutated
  const [sendModal, setSendModal] = useState<null | { matter: Matter; target: 'portal' | 'technical' | 'ethics' }>(null);
  const [raiseModal, setRaiseModal] = useState<null | { matter: Matter; target: 'error' | 'management' | 'representation' }>(null);

  // "RI" in the user's permission sense = someone who can close + do
  // the specialist/portal/raise actions. RI and Partner both qualify
  // (a Partner on the engagement will always be able to operate like
  // an RI — spec explicitly calls out close permission but the rest
  // of the RI actions map naturally too).
  const isRI = userRole === 'RI' || userRole === 'Partner';

  useEffect(() => { void load(); void loadActionLog(); }, [engagementId]);

  // Close the history popover on any click outside it. The popover
  // and its trigger button stop propagation, so this only fires for
  // truly-outside clicks.
  useEffect(() => {
    if (!openHistoryFor) return;
    const onDocClick = () => setOpenHistoryFor(null);
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, [openHistoryFor]);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/engagements/${engagementId}/audit-points?type=${pointType}`);
      if (res.ok) {
        const data = await res.json();
        const list: Matter[] = (data.points || []).map((p: any) => ({
          ...p,
          responses: Array.isArray(p.responses) ? p.responses : [],
          colour: p.colour || null,
        }));
        // Newest-activity first. updatedAt ticks on every response /
        // colour change, so items with fresh chatter bubble to the
        // top regardless of when they were first raised.
        list.sort((a, b) => {
          // Closed matters always below open/new, regardless of recency.
          if (a.status === 'closed' && b.status !== 'closed') return 1;
          if (a.status !== 'closed' && b.status === 'closed') return -1;
          return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
        });
        setMatters(list);
      }
    } finally { setLoading(false); }
  }

  // Pulls the engagement-wide action log and keeps the entries that
  // belong to RI-matter button presses. Three attribution patterns:
  //   - close / send-technical / send-ethics: targetType='audit_point',
  //     targetId is the matter id directly (or metadata.riMatterId).
  //   - send-portal: targetType='portal_request', metadata.riMatterId
  //     names the matter.
  //   - raise-*: targetType='error_schedule' or 'audit_point', targetId
  //     is the NEW record, metadata.raisedFromRiMatterId names the
  //     matter the raise originated on.
  // Normalises all three into matterId so the renderer doesn't need
  // to know about the schema.
  async function loadActionLog() {
    try {
      const res = await fetch(`/api/engagements/${engagementId}/action-log`);
      if (!res.ok) return;
      const data = await res.json();
      const entries: any[] = Array.isArray(data?.entries) ? data.entries : [];
      const mapped: MatterActionLogEntry[] = [];
      for (const e of entries) {
        if (typeof e?.action !== 'string' || !e.action.startsWith('audit-point.')) continue;
        const meta = e.metadata && typeof e.metadata === 'object' ? e.metadata : {};
        // Accept both the new generic keys (raisedFromPointId / pointId)
        // and the older RI-matter-specific keys for backwards compat
        // with action-log entries written before the review-point
        // generalisation. Falls through to targetId for direct
        // audit_point targets (close / send-technical / send-ethics).
        const matterId =
          meta?.raisedFromPointId
          || meta?.pointId
          || meta?.raisedFromRiMatterId
          || meta?.riMatterId
          || (e.targetType === 'audit_point' ? e.targetId : null);
        if (!matterId || typeof matterId !== 'string') continue;
        mapped.push({
          id: e.id,
          matterId,
          action: e.action,
          summary: typeof e.summary === 'string' ? e.summary : '',
          actorName: typeof e.actorName === 'string' ? e.actorName : '',
          occurredAt: typeof e.occurredAt === 'string' ? e.occurredAt : (e.createdAt || ''),
        });
      }
      setActionLog(mapped);
    } catch { /* informational popover — silently leave previous state */ }
  }

  // Quick id → entries[] index, sorted oldest-first so the popover
  // reads as a chronological story (raised → sent → closed).
  const actionsByMatter = useMemo(() => {
    const map = new Map<string, MatterActionLogEntry[]>();
    for (const e of actionLog) {
      const arr = map.get(e.matterId) || [];
      arr.push(e);
      map.set(e.matterId, arr);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());
    }
    return map;
  }, [actionLog]);

  const counts = useMemo(() => ({
    total: matters.length,
    open: matters.filter(m => m.status === 'open' || m.status === 'new').length,
    closed: matters.filter(m => m.status === 'closed').length,
  }), [matters]);

  async function createMatter() {
    if (!newDesc.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      // Capture the user's current tab/sub-tab so the back-link on the
      // matter can drop a reviewer right back where it was raised. Falls
      // back to a plain URL if no nav location was registered (older
      // tabs that haven't been wired into the registry yet).
      const navLoc = getCurrentLocation();
      const url = typeof window !== 'undefined' ? window.location.href : undefined;
      const reference = navLoc ? encodeNavReference(navLoc, url) : (url ?? null);
      const res = await fetch(`/api/engagements/${engagementId}/audit-points`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pointType, description: newDesc.trim(), reference }),
      });
      if (res.ok) {
        setNewDesc(''); setShowCreate(false);
        await load();
      } else {
        // Surface the server error instead of silently keeping the
        // modal open — saves a debug round-trip when something has
        // drifted server-side (e.g. unmigrated columns).
        const data = await res.json().catch(() => ({}));
        setCreateError(data?.error || `Create failed (HTTP ${res.status})`);
      }
    } catch (err: any) {
      setCreateError(err?.message || 'Create failed');
    } finally { setCreating(false); }
  }

  async function respond(matter: Matter) {
    const message = (replyDraft[matter.id] || '').trim();
    if (!message) return;
    setBusy(matter.id);
    try {
      await fetch(`/api/engagements/${engagementId}/audit-points`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: matter.id, action: 'respond', message }),
      });
      setReplyDraft(d => ({ ...d, [matter.id]: '' }));
      await load();
    } finally { setBusy(null); }
  }

  async function close(matter: Matter) {
    if (!confirm(`Close ${config.describeNoun} #${matter.chatNumber}? Only you can reopen via a new ${config.describeNoun} referencing this one.`)) return;
    setBusy(matter.id);
    try {
      const res = await fetch(`/api/engagements/${engagementId}/audit-points`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: matter.id, action: 'close' }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || 'Close failed');
      }
      await Promise.all([load(), loadActionLog()]);
    } finally { setBusy(null); }
  }

  async function setColour(matter: Matter, colour: string | null) {
    setBusy(matter.id);
    try {
      await fetch(`/api/engagements/${engagementId}/audit-points`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: matter.id, action: 'colour', colour: colour ?? '' }),
      });
      await load();
    } finally { setBusy(null); }
  }

  function toggle(id: string) {
    setExpanded(s => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // ── Floating window: position + drag ───────────────────────────
  // The panel needs to coexist with the page underneath so the user
  // can click a Source link, navigate to that tab, and still see the
  // matter context. So no backdrop, no modal-dim — the outer div is
  // pointer-events-none and only the panel itself catches clicks. The
  // user drags by the header to reposition out of the way.
  const PANEL_WIDTH = 920;
  const PANEL_INITIAL_TOP = 60;
  const [pos, setPos] = useState<{ x: number; y: number }>(() => {
    if (typeof window === 'undefined') return { x: 100, y: PANEL_INITIAL_TOP };
    const x = Math.max(20, Math.round((window.innerWidth - PANEL_WIDTH) / 2));
    return { x, y: PANEL_INITIAL_TOP };
  });
  const [minimised, setMinimised] = useState(false);
  // Drag state lives in a ref so the document-level listeners read
  // the latest start values without re-binding on every render.
  const dragRef = useRef<{ startX: number; startY: number; startPosX: number; startPosY: number } | null>(null);
  function onHeaderMouseDown(e: React.MouseEvent) {
    // Only left mouse button; ignore clicks that originated on the
    // close/minimise buttons (those should fire their own onClick).
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('button')) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, startPosX: pos.x, startPosY: pos.y };
    document.body.style.userSelect = 'none';
    function onMove(ev: MouseEvent) {
      if (!dragRef.current) return;
      const dx = ev.clientX - dragRef.current.startX;
      const dy = ev.clientY - dragRef.current.startY;
      setPos({
        x: Math.max(0, Math.min(window.innerWidth - 200, dragRef.current.startPosX + dx)),
        y: Math.max(0, Math.min(window.innerHeight - 60,  dragRef.current.startPosY + dy)),
      });
    }
    function onUp() {
      dragRef.current = null;
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  return (
    <>
    {/* pointer-events-none so the page underneath stays interactive.
        The inner panel re-enables pointer events on itself only. */}
    <div className="fixed inset-0 z-[60] pointer-events-none">
      <div
        className={`absolute bg-white rounded-xl shadow-2xl border border-slate-300 flex flex-col pointer-events-auto ${minimised ? '' : 'max-h-[88vh]'}`}
        style={{ left: pos.x, top: pos.y, width: `min(${PANEL_WIDTH}px, 95vw)` }}
      >
        {/* Header — also the drag handle */}
        <div
          className={`flex items-center justify-between px-4 py-3 border-b ${config.theme.headerBg} rounded-t-xl cursor-move select-none`}
          onMouseDown={onHeaderMouseDown}
        >
          <div className="flex items-center gap-2">
            <Icon className={`h-4 w-4 ${config.theme.headerIconColor}`} />
            <div>
              <h2 className={`text-sm font-bold ${config.theme.headerTitleColor}`}>{config.title}</h2>
              <p className={`text-[10px] ${config.theme.headerSubtitleColor}`}>
                {counts.total} total · {counts.open} open · {counts.closed} closed · drag header to move
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!minimised && (
              <Button onClick={() => setShowCreate(s => !s)} size="sm" variant="outline">
                <Plus className="h-3.5 w-3.5 mr-1" /> New {config.itemSingularCap}
              </Button>
            )}
            <button
              onClick={() => setMinimised(m => !m)}
              className="p-1.5 hover:bg-slate-100 rounded"
              title={minimised ? 'Expand' : 'Minimise'}
            >
              {minimised
                ? <ChevronDown className="h-4 w-4 text-slate-500" />
                : <ChevronRight className="h-4 w-4 text-slate-500 rotate-90" />}
            </button>
            <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded" title="Close">
              <X className="h-5 w-5 text-slate-400" />
            </button>
          </div>
        </div>

        {/* Body — hidden when minimised so the user sees just the header bar */}
        {!minimised && (<>
        {/* Create row */}
        {showCreate && (
          <div className={`px-4 py-3 border-b ${config.theme.createBg}`}>
            <textarea
              value={newDesc}
              onChange={e => setNewDesc(e.target.value)}
              placeholder={`Describe the ${config.describeNoun}…`}
              className={`w-full border ${config.theme.createInputBorder} rounded px-3 py-2 text-sm min-h-[70px]`}
              rows={3}
              autoFocus
            />
            {createError && (
              <div className={`mt-2 text-xs ${config.theme.errorBox} border rounded p-2`}>
                {createError}
              </div>
            )}
            <div className="flex justify-end gap-2 mt-2">
              <Button onClick={() => { setShowCreate(false); setCreateError(null); }} size="sm" variant="outline">Cancel</Button>
              <Button
                onClick={() => void createMatter()}
                size="sm"
                disabled={!newDesc.trim() || creating}
                className={config.theme.createButtonBg}
              >
                {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null} Create
              </Button>
            </div>
          </div>
        )}

        {/* List */}
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
          {loading ? (
            <div className="text-center py-12"><Loader2 className={`h-5 w-5 animate-spin ${config.theme.spinnerColor} mx-auto`} /></div>
          ) : matters.length === 0 ? (
            <div className="text-center py-12 text-slate-400 text-sm">{config.emptyText}</div>
          ) : (
            matters.map(matter => {
              const isExpanded = expanded.has(matter.id);
              const colourStyle = matter.colour && COLOUR_STYLES[matter.colour] ? COLOUR_STYLES[matter.colour] : null;
              const statusLabel = matter.status === 'new' ? 'new' : matter.status === 'open' ? 'open' : 'closed';
              const statusStyle = STATUS_STYLES[statusLabel] || STATUS_STYLES.open;
              const responses = matter.responses || [];
              const lastActivity = new Date(matter.updatedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
              return (
                <div
                  key={matter.id}
                  className={`border rounded-lg transition-colors ${colourStyle ? `${colourStyle.bg} ${colourStyle.border}` : 'bg-white border-slate-200'}`}
                >
                  {/* Collapsed row */}
                  <button
                    type="button"
                    onClick={() => toggle(matter.id)}
                    className="w-full flex items-start gap-2 px-3 py-2.5 text-left hover:bg-white/40"
                  >
                    {isExpanded
                      ? <ChevronDown className="h-4 w-4 text-slate-400 flex-shrink-0 mt-0.5" />
                      : <ChevronRight className="h-4 w-4 text-slate-400 flex-shrink-0 mt-0.5" />}
                    <span className={`flex-shrink-0 inline-block w-2.5 h-2.5 rounded-full mt-1.5 ${colourStyle?.dot || 'bg-slate-300'}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-semibold text-slate-700">#{matter.chatNumber}</span>
                        <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold uppercase tracking-wide border ${statusStyle}`}>
                          {statusLabel}
                        </span>
                        {responses.length > 0 && (
                          <span className="inline-flex items-center gap-0.5 text-[10px] text-slate-500">
                            <MessageCircle className="h-3 w-3" />{responses.length}
                          </span>
                        )}
                        {(() => {
                          const acts = actionsByMatter.get(matter.id) || [];
                          if (acts.length === 0) return null;
                          const isOpen = openHistoryFor === matter.id;
                          // Plain-text fallback for native title tooltip
                          // — covers users who hover but don't click,
                          // and screen-reader summarisation.
                          const plainList = acts
                            .map(a => `${ACTION_LABELS[a.action] || a.action}${a.actorName ? ` — ${a.actorName}` : ''}${a.occurredAt ? ` (${new Date(a.occurredAt).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })})` : ''}`)
                            .join('\n');
                          return (
                            <span className="relative inline-flex">
                              <button
                                type="button"
                                onClick={(e) => {
                                  // Stop the row's collapse/expand
                                  // toggle from firing — the badge is
                                  // a separate control.
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setOpenHistoryFor(prev => prev === matter.id ? null : matter.id);
                                }}
                                title={`Actions performed on this matter:\n${plainList}`}
                                className="inline-flex items-center gap-0.5 text-[10px] text-slate-500 hover:text-slate-800 px-1 py-0.5 rounded hover:bg-slate-100"
                              >
                                <History className="h-3 w-3" />{acts.length}
                              </button>
                              {isOpen && (
                                <div
                                  className="absolute left-0 top-full mt-1 z-20 w-72 max-h-64 overflow-y-auto bg-white border border-slate-200 rounded-md shadow-lg p-2 text-left"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <div className="flex items-center justify-between mb-1.5 pb-1 border-b border-slate-100">
                                    <span className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">History</span>
                                    <button
                                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpenHistoryFor(null); }}
                                      className="text-slate-400 hover:text-slate-600"
                                      title="Close"
                                    >
                                      <X className="h-3 w-3" />
                                    </button>
                                  </div>
                                  <ul className="space-y-1.5">
                                    {acts.map(a => (
                                      <li key={a.id} className="text-[11px] leading-tight">
                                        <div className="font-medium text-slate-700">{ACTION_LABELS[a.action] || a.action}</div>
                                        <div className="text-[10px] text-slate-500">
                                          {a.actorName || 'Unknown'}{a.occurredAt ? ` · ${new Date(a.occurredAt).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}` : ''}
                                        </div>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </span>
                          );
                        })()}
                        <span className="text-[10px] text-slate-400 ml-auto whitespace-nowrap">{lastActivity}</span>
                      </div>
                      <p className="text-xs text-slate-700 mt-0.5 line-clamp-2">{matter.description}</p>
                      <p className="text-[10px] text-slate-500 mt-0.5">by {matter.createdByName}</p>
                    </div>
                  </button>

                  {/* Expanded detail */}
                  {isExpanded && (
                    <div className="px-4 pb-4 pt-1 border-t border-slate-100/70">
                      {/* Colour + close toolbar */}
                      <div className="flex items-center gap-2 flex-wrap mb-3">
                        <span className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">Colour</span>
                        {(['green', 'amber', 'red'] as const).map(c => (
                          <button
                            key={c}
                            onClick={() => void setColour(matter, matter.colour === c ? null : c)}
                            disabled={busy === matter.id}
                            title={c}
                            className={`w-5 h-5 rounded-full border-2 transition-all ${
                              matter.colour === c ? 'ring-2 ring-offset-1 ring-slate-500 scale-110' : 'hover:scale-105'
                            } ${COLOUR_STYLES[c].dot} ${COLOUR_STYLES[c].border}`}
                          />
                        ))}
                        {matter.colour && (
                          <button
                            onClick={() => void setColour(matter, null)}
                            disabled={busy === matter.id}
                            className="text-[10px] text-slate-500 underline hover:text-slate-700"
                          >Clear</button>
                        )}
                        <div className="ml-auto flex items-center gap-2">
                          {matter.status !== 'closed' && isRI && (
                            <Button
                              onClick={() => void close(matter)}
                              size="sm" variant="outline"
                              className="text-[10px] h-6 border-green-300 text-green-700 hover:bg-green-50"
                            >
                              <Check className="h-3 w-3 mr-1" /> Close
                            </Button>
                          )}
                          {matter.status === 'closed' && (
                            <span className="text-[10px] text-slate-500 italic">
                              Closed by {matter.closedByName} {matter.closedAt ? `on ${new Date(matter.closedAt).toLocaleDateString('en-GB')}` : ''}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Source back-link — captured at create time so a
                          reviewer can jump back to the tab/sub-tab the
                          matter was raised on. Falls back to the plain
                          URL form for matters created before this. */}
                      {(() => {
                        const decoded = decodeNavReference(matter.reference);
                        if (decoded) {
                          return (
                            <button
                              type="button"
                              onClick={() => {
                                // Navigate without closing — the panel
                                // is now a draggable floating window
                                // so the reviewer can examine the
                                // source content while keeping the
                                // matter visible. Drag the header to
                                // move it out of the way.
                                navigateTo(decoded.loc);
                                if (minimised) setMinimised(false);
                              }}
                              className="inline-flex items-center gap-1 text-[11px] text-blue-700 hover:text-blue-900 hover:underline mb-3"
                              title="Open the tab/sub-tab where this matter was raised — drag the panel header to move it out of the way"
                            >
                              <ExternalLink className="h-3 w-3" />
                              Source: {decoded.loc.label || decoded.loc.tab}
                            </button>
                          );
                        }
                        if (matter.reference && (matter.reference.startsWith('http://') || matter.reference.startsWith('https://'))) {
                          return (
                            <a
                              href={matter.reference}
                              className="inline-flex items-center gap-1 text-[11px] text-blue-700 hover:text-blue-900 hover:underline mb-3"
                              title="Open the URL where this matter was raised"
                            >
                              <ExternalLink className="h-3 w-3" />
                              Source URL
                            </a>
                          );
                        }
                        return null;
                      })()}

                      {/* Full description (not truncated) */}
                      <div className="bg-white/60 border border-slate-100 rounded p-3 text-xs text-slate-800 whitespace-pre-wrap mb-3">
                        {matter.description}
                      </div>

                      {/* Chat thread */}
                      {responses.length > 0 && (
                        <div className="space-y-2 mb-3">
                          {responses.map(r => (
                            <div key={r.id} className="bg-white/80 border border-slate-100 rounded p-2.5">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-[11px] font-semibold text-slate-700">{r.userName}</span>
                                <span className="text-[10px] text-slate-400">{new Date(r.createdAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</span>
                              </div>
                              <p className="text-xs text-slate-700 whitespace-pre-wrap">{r.message}</p>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Reply box */}
                      {matter.status !== 'closed' && (
                        <div className="flex items-start gap-2 mb-3">
                          <textarea
                            value={replyDraft[matter.id] || ''}
                            onChange={e => setReplyDraft(d => ({ ...d, [matter.id]: e.target.value }))}
                            placeholder="Respond to this matter…"
                            className="flex-1 border border-slate-200 rounded px-2 py-1.5 text-xs min-h-[50px]"
                            rows={2}
                          />
                          <Button
                            onClick={() => void respond(matter)}
                            size="sm"
                            disabled={!(replyDraft[matter.id] || '').trim() || busy === matter.id}
                          >
                            {busy === matter.id ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Reply'}
                          </Button>
                        </div>
                      )}

                      {/* RI-only action row */}
                      {isRI && matter.status !== 'closed' && (
                        <div className="flex items-center gap-1.5 flex-wrap pt-2 border-t border-slate-100">
                          <span className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold mr-1">{config.actionsLabel}</span>
                          <ActionBtn onClick={() => setSendModal({ matter, target: 'portal' })} icon={<Send />} label="Send to Client Portal" tone="blue" />
                          <ActionBtn onClick={() => setSendModal({ matter, target: 'technical' })} icon={<Sparkles />} label="Send to Technical" tone="indigo" />
                          <ActionBtn onClick={() => setSendModal({ matter, target: 'ethics' })} icon={<Shield />} label="Send to Ethics Partner" tone="indigo" />
                          <span className="w-px h-4 bg-slate-200 mx-1" />
                          <ActionBtn onClick={() => setRaiseModal({ matter, target: 'error' })} icon={<AlertOctagon />} label="Raise as Error" tone="red" />
                          <ActionBtn onClick={() => setRaiseModal({ matter, target: 'management' })} icon={<FileWarning />} label="Raise as Management" tone="orange" />
                          <ActionBtn onClick={() => setRaiseModal({ matter, target: 'representation' })} icon={<FileWarning />} label="Raise as Representation" tone="purple" />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
        </>)}
      </div>
      </div>

      {/* Send / Raise modals — rendered OUTSIDE the floating-window layer
          so the parent's pointer-events:none doesn't block their backdrop
          and inputs. Each modal has its own fixed-positioned backdrop. */}
      {sendModal && (
        <SendModal
          matter={sendModal.matter}
          target={sendModal.target}
          engagementId={engagementId}
          sourceLabel={config.modalPrefix}
          onDone={(success) => {
            setSendModal(null);
            if (success) { void load(); void loadActionLog(); }
          }}
        />
      )}
      {raiseModal && (
        <RaiseModal
          matter={raiseModal.matter}
          target={raiseModal.target}
          engagementId={engagementId}
          sourceLabel={config.modalPrefix}
          onDone={(success, targetId) => {
            setRaiseModal(null);
            if (success) { void load(); void loadActionLog(); }
            if (success && targetId && onAction) onAction(`raise-${raiseModal.target}`, targetId);
          }}
        />
      )}
    </>
  );
}

// ── Small helper components ────────────────────────────────────────
function ActionBtn({ onClick, icon, label, tone }: { onClick: () => void; icon: React.ReactElement<any>; label: string; tone: 'blue' | 'indigo' | 'red' | 'orange' | 'purple' }) {
  const tones: Record<string, string> = {
    blue:   'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100',
    indigo: 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100',
    red:    'bg-red-50 text-red-700 border-red-200 hover:bg-red-100',
    orange: 'bg-orange-50 text-orange-700 border-orange-200 hover:bg-orange-100',
    purple: 'bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100',
  };
  // Clone the icon so we can force the size to match the button text —
  // lucide icons default to 24px which spills out of the small button.
  // Callers pass <Send /> etc. unsized, this is the single place we
  // pin the dimensions. Cast through Record<string, any> for the props
  // shape since lucide-react's exported icon type doesn't surface
  // className on the React.ReactElement generic parameter cleanly.
  const sizedIcon = isValidElement(icon)
    ? cloneElement(icon as React.ReactElement<{ className?: string }>, {
        className: `h-3 w-3 ${(icon.props as { className?: string })?.className || ''}`.trim(),
      })
    : icon;
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border font-medium ${tones[tone]}`}
    >
      {sizedIcon}
      {label}
    </button>
  );
}

function SendModal({
  matter, target, engagementId, onDone, sourceLabel,
}: {
  matter: Matter; target: 'portal' | 'technical' | 'ethics';
  engagementId: string;
  onDone: (success: boolean) => void;
  sourceLabel: string; // "RI matter" or "Review point" — for the header
}) {
  const [message, setMessage] = useState('');
  const [summary, setSummary] = useState('');
  const [sending, setSending] = useState(false);
  const [summarising, setSummarising] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const title = target === 'portal' ? 'Send to Client Portal'
    : target === 'technical' ? 'Send to Technical'
      : 'Send to Ethics Partner';

  async function summarise() {
    setSummarising(true); setError(null);
    try {
      const res = await fetch(`/api/engagements/${engagementId}/audit-points/summarise`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: matter.id }),
      });
      const data = await res.json();
      if (res.ok) setSummary(data.summary || '');
      else setError(data.error || 'Summary failed');
    } catch (err: any) { setError(err?.message || 'Summary failed'); }
    finally { setSummarising(false); }
  }

  async function send() {
    setSending(true); setError(null);
    try {
      const res = await fetch(`/api/engagements/${engagementId}/audit-points/send`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: matter.id, target, message: message.trim() || null, summary: summary.trim() || null }),
      });
      const data = await res.json();
      if (res.ok) onDone(true);
      else { setError(data.error || 'Send failed'); }
    } catch (err: any) { setError(err?.message || 'Send failed'); }
    finally { setSending(false); }
  }

  return (
    <div className="fixed inset-0 z-[70] bg-black/40 flex items-center justify-center p-4" onClick={() => onDone(false)}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-xl flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-800">{title} — {sourceLabel} #{matter.chatNumber}</h3>
          <button onClick={() => onDone(false)} disabled={sending} className="text-slate-400 hover:text-slate-600">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-4 pt-4 pb-2 space-y-3 overflow-y-auto">
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Covering message</label>
            <textarea
              value={message}
              onChange={e => setMessage(e.target.value)}
              rows={4}
              placeholder={target === 'portal'
                ? 'What do you want the client to respond to?'
                : 'Short note to the specialist on what you\'d like them to weigh in on.'}
              className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 min-h-[90px]"
              autoFocus
            />
          </div>
          {target !== 'portal' && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-[11px] font-semibold text-slate-600">
                  Chat summary <span className="text-slate-400 font-normal">(edit before sending)</span>
                </label>
                <button
                  onClick={() => void summarise()}
                  disabled={summarising}
                  className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 bg-fuchsia-50 text-fuchsia-700 border border-fuchsia-200 rounded hover:bg-fuchsia-100 disabled:opacity-50"
                >
                  {summarising ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                  Generate with AI
                </button>
              </div>
              <textarea
                value={summary}
                onChange={e => setSummary(e.target.value)}
                rows={5}
                placeholder="AI-generated summary appears here once you click Generate. You can edit freely."
                className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 min-h-[110px]"
              />
            </div>
          )}
          {error && <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">{error}</div>}
        </div>
        <div className="px-4 py-3 border-t flex justify-end gap-2">
          <button onClick={() => onDone(false)} disabled={sending} className="text-[11px] px-3 py-1 text-slate-600 hover:text-slate-800">Cancel</button>
          <button
            onClick={() => void send()}
            disabled={sending}
            className="inline-flex items-center gap-1 text-[11px] px-3 py-1 bg-blue-600 text-white rounded disabled:opacity-50 hover:bg-blue-700"
          >
            {sending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />} Send
          </button>
        </div>
      </div>
    </div>
  );
}

function RaiseModal({
  matter, target, engagementId, onDone, sourceLabel,
}: {
  matter: Matter; target: 'error' | 'management' | 'representation';
  engagementId: string;
  onDone: (success: boolean, targetId?: string) => void;
  sourceLabel: string; // "RI matter" or "Review point" — for the header
}) {
  const [description, setDescription] = useState(matter.description);
  // Error-specific fields
  const [fsLine, setFsLine] = useState('Unclassified');
  const [errorAmount, setErrorAmount] = useState('0');
  const [errorType, setErrorType] = useState<'factual' | 'judgemental' | 'projected'>('judgemental');
  const [raising, setRaising] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // FS Line picker — populated from the engagement's actual FS hierarchy
  // so the user picks an existing line rather than free-typing one (which
  // never matches any FS Line on the error schedule). Rendered as an
  // inline list inside the modal's DOM so it can't be confused with a
  // browser autocomplete dropdown that would be outside the modal —
  // those triggered click-outside handlers and dismissed the modal as
  // soon as the user started typing.
  const [fsOptions, setFsOptions] = useState<string[]>([]);
  const [fsQuery, setFsQuery] = useState('');
  const [fsPickerOpen, setFsPickerOpen] = useState(false);
  useEffect(() => {
    if (target !== 'error') return;
    let cancelled = false;
    fetch(`/api/engagements/${engagementId}/fs-hierarchy`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (cancelled || !d) return;
        const names: string[] = Array.isArray(d.allItems)
          ? d.allItems.map((x: any) => x?.name).filter((s: any): s is string => !!s)
          : [];
        // De-dup while preserving the API's order (already sorted by hierarchy).
        setFsOptions(Array.from(new Set(names)));
      })
      .catch(() => { /* picker still works as free-text fallback */ });
    return () => { cancelled = true; };
  }, [engagementId, target]);
  const filteredFsOptions = fsQuery.trim()
    ? fsOptions.filter(n => n.toLowerCase().includes(fsQuery.toLowerCase()))
    : fsOptions;

  const title = target === 'error' ? 'Raise as Error'
    : target === 'management' ? 'Raise as Management Point'
      : 'Raise as Representation Point';

  async function raise() {
    setRaising(true); setError(null);
    try {
      const raiseFields: Record<string, any> = { description };
      if (target === 'error') {
        raiseFields.fsLine = fsLine || 'Unclassified';
        raiseFields.errorAmount = Number(errorAmount) || 0;
        raiseFields.errorType = errorType;
      }
      const res = await fetch(`/api/engagements/${engagementId}/audit-points`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: matter.id, action: 'raise', raiseAs: target, raiseFields }),
      });
      const data = await res.json();
      if (res.ok) onDone(true, data?.raised?.id);
      else setError(data.error || 'Raise failed');
    } catch (err: any) { setError(err?.message || 'Raise failed'); }
    finally { setRaising(false); }
  }

  return (
    <div className="fixed inset-0 z-[70] bg-black/40 flex items-center justify-center p-4" onClick={() => onDone(false)}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-800">{title} — from {sourceLabel} #{matter.chatNumber}</h3>
          <button onClick={() => onDone(false)} disabled={raising} className="text-slate-400 hover:text-slate-600">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-4 pt-4 pb-2 space-y-3 overflow-y-auto">
          <p className="text-[11px] text-slate-500 italic">
            The new record will be linked back to this {sourceLabel} so reviewers can trace where it originated.
            You can tweak everything in the target panel afterwards.
          </p>
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">Description</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={4}
              className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 min-h-[90px]"
            />
          </div>
          {target === 'error' && (
            <>
              <div className="relative">
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">FS Line</label>
                {/* Combobox: text input drives a filter over the engagement's
                    actual FS Lines. The list lives in this same DOM
                    subtree (no portal, no native autocomplete) so a click
                    on an option can't be misread as "click outside the
                    modal" by the backdrop handler. */}
                <input
                  type="text"
                  value={fsPickerOpen ? fsQuery : fsLine}
                  onChange={e => { setFsQuery(e.target.value); setFsPickerOpen(true); }}
                  onFocus={() => { setFsQuery(''); setFsPickerOpen(true); }}
                  onBlur={() => {
                    // Delay the close so a click on an option below
                    // gets to fire its onMouseDown before the picker
                    // unmounts.
                    setTimeout(() => setFsPickerOpen(false), 120);
                  }}
                  placeholder={fsOptions.length ? 'Type to search FS Lines…' : 'No FS Lines loaded — type a name'}
                  autoComplete="off"
                  className="w-full text-xs border border-slate-200 rounded px-2 py-1.5"
                />
                {fsPickerOpen && filteredFsOptions.length > 0 && (
                  <ul className="absolute z-10 left-0 right-0 mt-1 max-h-44 overflow-y-auto bg-white border border-slate-200 rounded shadow-lg text-xs">
                    {filteredFsOptions.slice(0, 50).map(name => (
                      <li
                        key={name}
                        onMouseDown={(e) => {
                          // onMouseDown (not onClick) so we run before
                          // the input's onBlur fires and tears the
                          // picker down. stopPropagation is belt-and-
                          // braces against any ancestor click handlers.
                          e.preventDefault();
                          e.stopPropagation();
                          setFsLine(name);
                          setFsQuery('');
                          setFsPickerOpen(false);
                        }}
                        className={`px-2 py-1 cursor-pointer hover:bg-blue-50 ${name === fsLine ? 'bg-blue-100 font-medium' : ''}`}
                      >
                        {name}
                      </li>
                    ))}
                  </ul>
                )}
                {fsLine && !fsPickerOpen && (
                  <p className="text-[10px] text-slate-500 mt-0.5">Selected: <span className="font-medium">{fsLine}</span></p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">Error amount (£)</label>
                  <input
                    type="number"
                    value={errorAmount}
                    onChange={e => setErrorAmount(e.target.value)}
                    className="w-full text-xs border border-slate-200 rounded px-2 py-1.5"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">Type</label>
                  <select
                    value={errorType}
                    onChange={e => setErrorType(e.target.value as any)}
                    className="w-full text-xs border border-slate-200 rounded px-2 py-1.5"
                  >
                    <option value="factual">Factual</option>
                    <option value="judgemental">Judgemental</option>
                    <option value="projected">Projected</option>
                  </select>
                </div>
              </div>
            </>
          )}
          {error && <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">{error}</div>}
        </div>
        <div className="px-4 py-3 border-t flex justify-end gap-2">
          <button onClick={() => onDone(false)} disabled={raising} className="text-[11px] px-3 py-1 text-slate-600 hover:text-slate-800">Cancel</button>
          <button
            onClick={() => void raise()}
            disabled={raising || !description.trim()}
            className="inline-flex items-center gap-1 text-[11px] px-3 py-1 bg-blue-600 text-white rounded disabled:opacity-50 hover:bg-blue-700"
          >
            {raising ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Raise
          </button>
        </div>
      </div>
    </div>
  );
}
