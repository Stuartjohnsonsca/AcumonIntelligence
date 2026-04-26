'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import {
  Plus, Loader2, X, ChevronDown, ChevronRight, ExternalLink,
  CheckCircle2, XCircle, History, FileText, ClipboardList,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  encodeNavReference, decodeNavReference, getCurrentLocation, navigateTo,
} from '@/lib/engagement-nav';

/**
 * Management / Representation letter points panel.
 *
 * Replaces the older modal-style panel with a floating draggable
 * window that mirrors the RI Matters layout. Per the user spec:
 *
 *   1. Heading dropdown combines the methodology-template list AND
 *      headings already used on this engagement so previously-typed
 *      free-text headings are picked up next time.
 *   2. Source back-link (engagement-nav) — clicking on a point's
 *      "Source" line navigates the page underneath without closing
 *      the panel; user drags the panel out of the way to compare.
 *   3. Detail textarea has a red outline because the field ends up
 *      verbatim in a client document.
 *   4. Heading input has a red outline for the same reason.
 *   5. Each point exposes Commit and Reject — Commit moves the
 *      point to 'committed' (so it lands in the management /
 *      representation letter); Reject moves it to 'cancelled'
 *      (legacy backend status, displayed as "Rejected").
 *   6. Traffic-light colour picker per point (green / amber / red /
 *      clear) — same control shape as RI Matters.
 *   7. List ordered: open (sorted newest-activity first, with
 *      traffic-light colour applied) → committed → rejected.
 *      Anyone can OPEN/VIEW any point. To OVERRIDE the status of a
 *      committed/rejected point the caller's team role must be >=
 *      the role of the user who last set it (server enforces and
 *      returns a 403 with a friendly message).
 *   8. Status pills read "Open / Committed / Rejected" — the
 *      backend status string for reject is still 'cancelled' to
 *      avoid a migration; only the display label changed.
 *   9. Per-point history popover lists every action that has
 *      touched the point (created, status changes, etc.) so the
 *      trail is visible without leaving the panel.
 */

interface PointData {
  id: string;
  chatNumber: number;
  status: string;          // open | new | committed | cancelled | closed
  colour: string | null;
  heading: string | null;
  description: string;
  body: string | null;
  reference: string | null;
  createdById: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  closedById?: string | null;
  closedByName?: string | null;
  closedAt?: string | null;
}

interface ActionLogEntry {
  id: string;
  pointId: string;
  action: string;          // 'audit-point.commit' | '...reject' | etc.
  summary: string;
  actorName: string;
  occurredAt: string;
}

interface Props {
  engagementId: string;
  pointType: 'management' | 'representation';
  title: string;
  onClose: () => void;
  /** Optional override — caller can preload the template list. */
  headingOptions?: string[];
}

const ACTION_LABELS: Record<string, string> = {
  'audit-point.create': 'Created',
  'audit-point.commit': 'Committed',
  'audit-point.reject': 'Rejected',
  'audit-point.update': 'Edited',
};

const COLOUR_DOTS: Record<string, { dot: string; ring: string; bg: string; border: string }> = {
  green: { dot: 'bg-green-500', ring: 'ring-green-300', bg: 'bg-green-50',  border: 'border-green-300' },
  amber: { dot: 'bg-amber-500', ring: 'ring-amber-300', bg: 'bg-amber-50',  border: 'border-amber-300' },
  red:   { dot: 'bg-red-500',   ring: 'ring-red-300',   bg: 'bg-red-50',    border: 'border-red-300' },
};

// Theme used for the floating window header. Management = orange,
// Representation = purple — matching the EngagementTabs button colours.
const THEMES: Record<'management' | 'representation', {
  headerBg: string; iconColor: string; titleColor: string; subtitleColor: string;
  createBg: string; createBtn: string;
}> = {
  management: {
    headerBg: 'bg-orange-50/60', iconColor: 'text-orange-600',
    titleColor: 'text-orange-800', subtitleColor: 'text-orange-700/80',
    createBg: 'bg-orange-50/30', createBtn: 'bg-orange-600 hover:bg-orange-700',
  },
  representation: {
    headerBg: 'bg-purple-50/60', iconColor: 'text-purple-600',
    titleColor: 'text-purple-800', subtitleColor: 'text-purple-700/80',
    createBg: 'bg-purple-50/30', createBtn: 'bg-purple-600 hover:bg-purple-700',
  },
};

function formatDateTime(d?: string | null) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function statusLabel(status: string): string {
  if (status === 'committed') return 'Committed';
  if (status === 'cancelled' || status === 'rejected') return 'Rejected';
  return 'Open';
}
function statusPillClasses(status: string): string {
  const label = statusLabel(status);
  if (label === 'Committed') return 'bg-blue-100 text-blue-700 border-blue-200';
  if (label === 'Rejected')  return 'bg-slate-200 text-slate-600 border-slate-300';
  return 'bg-green-100 text-green-700 border-green-200';
}

export function ManagementPointPanel({ engagementId, pointType, title, onClose, headingOptions: initialHeadings = [] }: Props) {
  const theme = THEMES[pointType];
  const [points, setPoints] = useState<PointData[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [templateHeadings, setTemplateHeadings] = useState<string[]>(initialHeadings);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [actionLog, setActionLog] = useState<ActionLogEntry[]>([]);
  const [openHistoryFor, setOpenHistoryFor] = useState<string | null>(null);

  // Create-form fields
  const [heading, setHeading] = useState('');
  const [customHeading, setCustomHeading] = useState('');
  const [description, setDescription] = useState('');
  const [body, setBody] = useState('');

  useEffect(() => { void load(); void loadActionLog(); }, [engagementId, pointType]);

  // Template headings — list configured under Methodology Admin → Point
  // Headings. Only fetched when the caller didn't preload them.
  useEffect(() => {
    if (initialHeadings.length > 0) return;
    const templateType = pointType === 'management' ? 'management_headings' : 'representation_headings';
    fetch(`/api/methodology-admin/templates?type=${templateType}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        const items = data?.template?.items ?? data?.templates?.[0]?.items;
        if (Array.isArray(items)) setTemplateHeadings(items);
      })
      .catch(() => { /* fall back to free text */ });
  }, [pointType, initialHeadings.length]);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/engagements/${engagementId}/audit-points?type=${pointType}`);
      if (res.ok) {
        const data = await res.json();
        setPoints(Array.isArray(data?.points) ? data.points : []);
      }
    } finally { setLoading(false); }
  }

  // Action-log entries scoped to this pointType. Same attribution
  // logic as RIMattersPanel — accept several legacy and current
  // metadata keys, fall back to targetId for direct audit_point
  // targets (commit / reject).
  async function loadActionLog() {
    try {
      const res = await fetch(`/api/engagements/${engagementId}/action-log`);
      if (!res.ok) return;
      const data = await res.json();
      const entries: any[] = Array.isArray(data?.entries) ? data.entries : [];
      const mapped: ActionLogEntry[] = [];
      for (const e of entries) {
        if (typeof e?.action !== 'string' || !e.action.startsWith('audit-point.')) continue;
        const meta = e.metadata && typeof e.metadata === 'object' ? e.metadata : {};
        const pointId =
          meta?.raisedFromPointId
          || meta?.pointId
          || meta?.raisedFromRiMatterId
          || meta?.riMatterId
          || (e.targetType === 'audit_point' ? e.targetId : null);
        if (!pointId || typeof pointId !== 'string') continue;
        mapped.push({
          id: e.id,
          pointId,
          action: e.action,
          summary: typeof e.summary === 'string' ? e.summary : '',
          actorName: typeof e.actorName === 'string' ? e.actorName : '',
          occurredAt: typeof e.occurredAt === 'string' ? e.occurredAt : (e.createdAt || ''),
        });
      }
      setActionLog(mapped);
    } catch { /* informational popover — leave previous state */ }
  }

  // Document click closes any open history popover. The popover and
  // its trigger button stop propagation so this only fires on a
  // truly-outside click.
  useEffect(() => {
    if (!openHistoryFor) return;
    const onDocClick = () => setOpenHistoryFor(null);
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, [openHistoryFor]);

  // ── Combined heading options ────────────────────────────────────
  // Spec item 1: dropdown shows the template list AND any heading the
  // engagement has already used (so a previously-typed free-text
  // heading is reusable without retyping). De-dup case-insensitively
  // while preserving template ordering.
  const combinedHeadings = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const h of templateHeadings) {
      const k = h.trim().toLowerCase();
      if (!k || seen.has(k)) continue;
      seen.add(k); out.push(h.trim());
    }
    for (const p of points) {
      const h = (p.heading || '').trim();
      const k = h.toLowerCase();
      if (!h || seen.has(k)) continue;
      seen.add(k); out.push(h);
    }
    return out;
  }, [templateHeadings, points]);

  // Index actions by point id, oldest-first so the popover reads
  // chronologically.
  const actionsByPoint = useMemo(() => {
    const map = new Map<string, ActionLogEntry[]>();
    for (const e of actionLog) {
      const arr = map.get(e.pointId) || [];
      arr.push(e); map.set(e.pointId, arr);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());
    }
    return map;
  }, [actionLog]);

  // Sort: open (newest-activity first) → committed → rejected. Anyone
  // can view any of them; the action buttons just disable themselves
  // for closed statuses (server still enforces).
  const sortedPoints = useMemo(() => {
    const rank = (s: string) => statusLabel(s) === 'Open' ? 0 : statusLabel(s) === 'Committed' ? 1 : 2;
    return [...points].sort((a, b) => {
      const r = rank(a.status) - rank(b.status);
      if (r !== 0) return r;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
  }, [points]);

  const counts = useMemo(() => ({
    open: points.filter(p => statusLabel(p.status) === 'Open').length,
    committed: points.filter(p => statusLabel(p.status) === 'Committed').length,
    rejected: points.filter(p => statusLabel(p.status) === 'Rejected').length,
  }), [points]);

  async function createPoint() {
    const h = heading === '__custom' ? customHeading.trim() : heading;
    if (!description.trim()) return;
    setCreating(true); setCreateError(null);
    try {
      const navLoc = getCurrentLocation();
      const url = typeof window !== 'undefined' ? window.location.href : undefined;
      const reference = navLoc ? encodeNavReference(navLoc, url) : (url ?? null);
      const res = await fetch(`/api/engagements/${engagementId}/audit-points`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pointType,
          description: description.trim(),
          heading: h || null,
          body: body.trim() || null,
          reference,
        }),
      });
      if (res.ok) {
        setDescription(''); setBody(''); setHeading(''); setCustomHeading('');
        setShowCreate(false);
        await Promise.all([load(), loadActionLog()]);
      } else {
        const data = await res.json().catch(() => ({}));
        setCreateError(data?.error || `Create failed (HTTP ${res.status})`);
      }
    } catch (err: any) {
      setCreateError(err?.message || 'Create failed');
    } finally { setCreating(false); }
  }

  async function actOn(pointId: string, action: 'commit' | 'reject' | 'colour' | 'update', extra: Record<string, any> = {}) {
    setBusy(pointId);
    try {
      const res = await fetch(`/api/engagements/${engagementId}/audit-points`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: pointId, action, ...extra }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        // 403 = authority gate. Show the server's friendly message
        // rather than a generic alert.
        alert(data?.error || `Action failed (HTTP ${res.status})`);
      }
      await Promise.all([load(), loadActionLog()]);
    } finally { setBusy(null); }
  }

  function toggle(id: string) {
    setExpanded(s => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // ── Floating window: position + drag (mirrors RIMattersPanel) ───
  const PANEL_WIDTH = 920;
  const PANEL_INITIAL_TOP = 60;
  const [pos, setPos] = useState<{ x: number; y: number }>(() => {
    if (typeof window === 'undefined') return { x: 100, y: PANEL_INITIAL_TOP };
    const x = Math.max(20, Math.round((window.innerWidth - PANEL_WIDTH) / 2));
    return { x, y: PANEL_INITIAL_TOP };
  });
  const [minimised, setMinimised] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; startPosX: number; startPosY: number } | null>(null);
  function onHeaderMouseDown(e: React.MouseEvent) {
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
    <div className="fixed inset-0 z-[60] pointer-events-none">
      <div
        className={`absolute bg-white rounded-xl shadow-2xl border border-slate-300 flex flex-col pointer-events-auto ${minimised ? '' : 'max-h-[88vh]'}`}
        style={{ left: pos.x, top: pos.y, width: `min(${PANEL_WIDTH}px, 95vw)` }}
      >
        {/* Header — also the drag handle */}
        <div
          className={`flex items-center justify-between px-4 py-3 border-b ${theme.headerBg} rounded-t-xl cursor-move select-none`}
          onMouseDown={onHeaderMouseDown}
        >
          <div className="flex items-center gap-2">
            {pointType === 'management'
              ? <FileText className={`h-4 w-4 ${theme.iconColor}`} />
              : <ClipboardList className={`h-4 w-4 ${theme.iconColor}`} />}
            <div>
              <h2 className={`text-sm font-bold ${theme.titleColor}`}>{title}</h2>
              <p className={`text-[10px] ${theme.subtitleColor}`}>
                {counts.open} open · {counts.committed} committed · {counts.rejected} rejected · drag header to move
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!minimised && (
              <Button onClick={() => setShowCreate(s => !s)} size="sm" variant="outline">
                <Plus className="h-3.5 w-3.5 mr-1" /> New Point
              </Button>
            )}
            <button
              onClick={() => setMinimised(m => !m)}
              className="p-1.5 hover:bg-white/60 rounded"
              title={minimised ? 'Expand' : 'Minimise'}
            >
              {minimised
                ? <ChevronDown className="h-4 w-4 text-slate-500" />
                : <ChevronRight className="h-4 w-4 text-slate-500 rotate-90" />}
            </button>
            <button onClick={onClose} className="p-1.5 hover:bg-white/60 rounded" title="Close">
              <X className="h-5 w-5 text-slate-400" />
            </button>
          </div>
        </div>

        {!minimised && (<>
          {/* Create form */}
          {showCreate && (
            <div className={`px-4 py-3 border-b ${theme.createBg} space-y-3`}>
              <div>
                {/* Heading — red outline (spec item 4) because it ends up on a client-facing letter */}
                <label className="text-xs font-semibold text-slate-700 block mb-1">
                  Heading <span className="text-[10px] text-red-600 font-normal">(appears in client letter)</span>
                </label>
                <select
                  value={heading}
                  onChange={e => setHeading(e.target.value)}
                  className="w-full border-2 border-red-300 rounded-lg px-3 py-2 text-sm bg-white focus:border-red-500 focus:ring-1 focus:ring-red-200 outline-none"
                >
                  <option value="">Select heading…</option>
                  {combinedHeadings.map(h => <option key={h} value={h}>{h}</option>)}
                  <option value="__custom">Other (free text)</option>
                </select>
                {heading === '__custom' && (
                  <input
                    value={customHeading}
                    onChange={e => setCustomHeading(e.target.value)}
                    placeholder="Enter custom heading…"
                    className="w-full border-2 border-red-300 rounded-lg px-3 py-2 text-sm mt-2 focus:border-red-500 focus:ring-1 focus:ring-red-200 outline-none"
                  />
                )}
              </div>
              <div>
                {/* Detail — red outline (spec item 3) */}
                <label className="text-xs font-semibold text-slate-700 block mb-1">
                  Detail <span className="text-[10px] text-red-600 font-normal">(appears verbatim in client letter)</span>
                </label>
                <textarea
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="The text that will appear in the client letter…"
                  className="w-full border-2 border-red-300 rounded-lg px-3 py-2 text-sm min-h-[100px] focus:border-red-500 focus:ring-1 focus:ring-red-200 outline-none"
                  rows={4}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">Internal notes (not shown to client)</label>
                <textarea
                  value={body}
                  onChange={e => setBody(e.target.value)}
                  placeholder="Optional supporting context…"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm min-h-[60px]"
                  rows={2}
                />
              </div>
              {createError && (
                <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">{createError}</div>
              )}
              <div className="flex justify-end gap-2">
                <Button onClick={() => { setShowCreate(false); setCreateError(null); }} size="sm" variant="outline">Cancel</Button>
                <Button onClick={() => void createPoint()} size="sm" disabled={!description.trim() || creating} className={theme.createBtn}>
                  {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}Create
                </Button>
              </div>
            </div>
          )}

          {/* Points list */}
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
            {loading ? (
              <div className="text-center py-12"><Loader2 className={`h-5 w-5 animate-spin mx-auto ${theme.iconColor}`} /></div>
            ) : sortedPoints.length === 0 ? (
              <div className="text-center py-12 text-slate-400 text-sm">No points yet. Click &ldquo;New Point&rdquo; to create one.</div>
            ) : (
              sortedPoints.map(p => {
                const isExpanded = expanded.has(p.id);
                const isOpen = statusLabel(p.status) === 'Open';
                const colourStyle = p.colour && COLOUR_DOTS[p.colour] ? COLOUR_DOTS[p.colour] : null;
                const acts = actionsByPoint.get(p.id) || [];
                const decoded = decodeNavReference(p.reference);
                const isHistoryOpen = openHistoryFor === p.id;
                return (
                  <div
                    key={p.id}
                    className={`border rounded-lg transition-colors ${
                      isOpen
                        ? (colourStyle ? `${colourStyle.bg} ${colourStyle.border}` : 'bg-white border-slate-200')
                        : 'bg-slate-50 border-slate-200 opacity-90'
                    }`}
                  >
                    {/* Collapsed row */}
                    <button
                      type="button"
                      onClick={() => toggle(p.id)}
                      className="w-full flex items-start gap-2 px-3 py-2.5 text-left hover:bg-white/40"
                    >
                      {isExpanded
                        ? <ChevronDown className="h-4 w-4 text-slate-400 flex-shrink-0 mt-0.5" />
                        : <ChevronRight className="h-4 w-4 text-slate-400 flex-shrink-0 mt-0.5" />}
                      <span className={`flex-shrink-0 inline-block w-2.5 h-2.5 rounded-full mt-1.5 ${colourStyle?.dot || 'bg-slate-300'}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-semibold text-slate-700">#{p.chatNumber}</span>
                          {p.heading && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200 font-medium">{p.heading}</span>
                          )}
                          <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold uppercase tracking-wide border ${statusPillClasses(p.status)}`}>
                            {statusLabel(p.status)}
                          </span>
                          {acts.length > 0 && (
                            <span className="relative inline-flex">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.preventDefault(); e.stopPropagation();
                                  setOpenHistoryFor(prev => prev === p.id ? null : p.id);
                                }}
                                title={`Actions on this point:\n${acts.map(a =>
                                  `${ACTION_LABELS[a.action] || a.action}${a.actorName ? ` — ${a.actorName}` : ''}${a.occurredAt ? ` (${formatDateTime(a.occurredAt)})` : ''}`
                                ).join('\n')}`}
                                className="inline-flex items-center gap-0.5 text-[10px] text-slate-500 hover:text-slate-800 px-1 py-0.5 rounded hover:bg-slate-100"
                              >
                                <History className="h-3 w-3" />{acts.length}
                              </button>
                              {isHistoryOpen && (
                                <div
                                  className="absolute left-0 top-full mt-1 z-20 w-72 max-h-64 overflow-y-auto bg-white border border-slate-200 rounded-md shadow-lg p-2 text-left"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <div className="flex items-center justify-between mb-1.5 pb-1 border-b border-slate-100">
                                    <span className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">History</span>
                                    <button
                                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpenHistoryFor(null); }}
                                      className="text-slate-400 hover:text-slate-600"
                                    ><X className="h-3 w-3" /></button>
                                  </div>
                                  <ul className="space-y-1.5">
                                    {acts.map(a => (
                                      <li key={a.id} className="text-[11px] leading-tight">
                                        <div className="font-medium text-slate-700">{ACTION_LABELS[a.action] || a.action}</div>
                                        <div className="text-[10px] text-slate-500">
                                          {a.actorName || 'Unknown'}{a.occurredAt ? ` · ${formatDateTime(a.occurredAt)}` : ''}
                                        </div>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </span>
                          )}
                          <span className="text-[10px] text-slate-400 ml-auto whitespace-nowrap">{formatDateTime(p.updatedAt)}</span>
                        </div>
                        <p className="text-xs text-slate-700 mt-0.5 line-clamp-2">{p.description}</p>
                        <p className="text-[10px] text-slate-500 mt-0.5">by {p.createdByName}</p>
                      </div>
                    </button>

                    {/* Expanded detail */}
                    {isExpanded && (
                      <div className="px-4 pb-4 pt-1 border-t border-slate-100/70">
                        {/* Traffic-light colour picker — open points only */}
                        {isOpen && (
                          <div className="flex items-center gap-2 flex-wrap mb-3">
                            <span className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">Colour</span>
                            {(['green', 'amber', 'red'] as const).map(c => (
                              <button
                                key={c}
                                onClick={() => void actOn(p.id, 'colour', { colour: p.colour === c ? '' : c })}
                                disabled={busy === p.id}
                                title={c}
                                className={`w-5 h-5 rounded-full border-2 transition-all ${
                                  p.colour === c ? 'ring-2 ring-offset-1 ring-slate-500 scale-110' : 'hover:scale-105'
                                } ${COLOUR_DOTS[c].dot} ${COLOUR_DOTS[c].border}`}
                              />
                            ))}
                            {p.colour && (
                              <button
                                onClick={() => void actOn(p.id, 'colour', { colour: '' })}
                                disabled={busy === p.id}
                                className="text-[10px] text-slate-500 underline hover:text-slate-700"
                              >Clear</button>
                            )}
                          </div>
                        )}

                        {/* Source back-link captured at create time */}
                        {decoded ? (
                          <button
                            type="button"
                            onClick={() => {
                              navigateTo(decoded.loc);
                              if (minimised) setMinimised(false);
                            }}
                            className="inline-flex items-center gap-1 text-[11px] text-blue-700 hover:text-blue-900 hover:underline mb-3"
                            title="Open the tab/sub-tab where this point was created — drag the panel header to move it out of the way"
                          >
                            <ExternalLink className="h-3 w-3" />
                            Source: {decoded.loc.label || decoded.loc.tab}
                          </button>
                        ) : p.reference && (p.reference.startsWith('http://') || p.reference.startsWith('https://')) ? (
                          <a
                            href={p.reference}
                            className="inline-flex items-center gap-1 text-[11px] text-blue-700 hover:text-blue-900 hover:underline mb-3"
                          >
                            <ExternalLink className="h-3 w-3" />
                            Source URL
                          </a>
                        ) : null}

                        {p.heading && (
                          <div className="mb-2">
                            <span className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">Heading</span>
                            <div className="text-xs text-slate-800 font-medium">{p.heading}</div>
                          </div>
                        )}
                        <div className="bg-white/60 border border-slate-100 rounded p-3 text-xs text-slate-800 whitespace-pre-wrap mb-3">
                          {p.description}
                        </div>
                        {p.body && (
                          <div className="bg-slate-50 border border-slate-100 rounded p-3 text-xs text-slate-600 whitespace-pre-wrap mb-3">
                            <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-1">Internal notes</div>
                            {p.body}
                          </div>
                        )}

                        {/* Status footer — closed-by attribution + action buttons */}
                        <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100">
                          <div className="text-[10px] text-slate-500 italic">
                            {!isOpen && p.closedByName
                              ? `${statusLabel(p.status)} by ${p.closedByName}${p.closedAt ? ` on ${formatDateTime(p.closedAt)}` : ''}`
                              : ''}
                          </div>
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => void actOn(p.id, 'commit')}
                              disabled={busy === p.id}
                              className="text-[10px] px-2 py-1 bg-green-600 text-white rounded hover:bg-green-700 font-medium inline-flex items-center gap-1 disabled:opacity-50"
                              title={isOpen ? 'Commit — appears in the client letter' : 'Override the current status (you must have ≥ authority of the previous decider)'}
                            >
                              {busy === p.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                              {statusLabel(p.status) === 'Committed' ? 'Already committed' : 'Commit'}
                            </button>
                            <button
                              onClick={() => void actOn(p.id, 'reject')}
                              disabled={busy === p.id}
                              className="text-[10px] px-2 py-1 bg-red-100 text-red-700 border border-red-200 rounded hover:bg-red-200 font-medium inline-flex items-center gap-1 disabled:opacity-50"
                              title={isOpen ? 'Reject — point will not appear in the client letter' : 'Override the current status (you must have ≥ authority of the previous decider)'}
                            >
                              {busy === p.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <XCircle className="h-3 w-3" />}
                              {statusLabel(p.status) === 'Rejected' ? 'Already rejected' : 'Reject'}
                            </button>
                          </div>
                        </div>
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
  );
}
