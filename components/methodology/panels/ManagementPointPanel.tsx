'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import {
  Plus, Loader2, X, ChevronDown, ChevronRight, ExternalLink,
  CheckCircle2, XCircle, History, FileText, ClipboardList,
  User, Filter, ArrowUpDown,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  encodeNavReference, decodeNavReference, getCurrentLocation, navigateTo,
} from '@/lib/engagement-nav';
import { PointAttachments, type Attachment } from './PointAttachments';

// Team member shape passed in from the engagement so the assignee
// dropdown can render names + enforce the role-rank gate client-side.
interface TeamMember {
  userId: string;
  userName?: string;
  role: string;
}

// New workflow status values. The legacy string column also stores
// 'new' / 'committed' / 'cancelled' from earlier audits; those map
// to a friendly label in statusLabel() so old data reads cleanly.
type WorkflowStatus = 'open' | 'addressed' | 'reviewed' | 'closed';
const WORKFLOW_STATUSES: WorkflowStatus[] = ['open', 'addressed', 'reviewed', 'closed'];
const WORKFLOW_STATUS_LABELS: Record<WorkflowStatus, string> = {
  open: 'Open',
  addressed: 'Addressed',
  reviewed: 'Reviewed',
  closed: 'Closed',
};
const WORKFLOW_STATUS_PILL: Record<WorkflowStatus, string> = {
  open: 'bg-amber-50 text-amber-700 border-amber-200',
  addressed: 'bg-blue-50 text-blue-700 border-blue-200',
  reviewed: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  closed: 'bg-slate-100 text-slate-600 border-slate-200',
};

// Status history entry — appended by the server every time the
// status changes. The UI surfaces it as a per-point timeline.
interface StatusHistoryEntry {
  status: string;
  byId?: string;
  byName?: string;
  byRole?: string;
  at?: string;
}

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
  status: string;          // open | new | addressed | reviewed | closed | committed | cancelled
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
  // Assignee — team member responsible for actioning this point.
  // Role is cached at assignment time so the status authority gate
  // can compare ranks without an extra fetch.
  assignedToUserId?: string | null;
  assignedToName?: string | null;
  assignedToRole?: string | null;
  // Status history — append-only timeline of every status change.
  statusHistory?: StatusHistoryEntry[] | null;
  // Links + file attachments — JSON array shaped {name,url,type?,size?}.
  // Driven by the shared PointAttachments widget; persisted via the
  // existing PATCH ?action=update handler on /audit-points.
  attachments?: Array<{ name: string; url: string; type?: string; size?: number }> | null;
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
  /**
   * The caller's role on this engagement team. Drives the client-side
   * authority gate on status changes — a junior cannot override a
   * status set by a more senior role. The server enforces the same
   * rule and is the source of truth; this prop just keeps the UI
   * honest (disabled buttons, explanatory tooltip) so a junior
   * doesn't get into a click-and-watch-it-fail loop.
   */
  userRole?: string;
  /** Caller's user id — used by the client-side authority gate to
   *  match the latest history entry's byId. */
  userId?: string;
  /** Engagement team members for the assignee dropdown. Optional —
   *  when omitted the dropdown shows the existing assignee name read-
   *  only (so an old call site that hasn't been updated still
   *  renders without crashing). */
  teamMembers?: TeamMember[];
}

// Mirrors the server-side ROLE_RANK in
// app/api/engagements/[engagementId]/audit-points/route.ts. Keep in
// sync — these are the only ranks that drive the override gate.
const ROLE_RANK: Record<string, number> = {
  Junior: 0,
  Manager: 1,
  RI: 2,
  Reviewer: 2,
  Partner: 3,
  EQR: 4,
};

// Pulls "Partner" out of "Jane Smith (Partner)" — the closedByName
// stamp format the server writes on commit/reject. Returns null when
// no role suffix is present (legacy data, pre-stamp); callers treat
// null as "unknown rank, allow override" to match the server.
function parseRoleFromStampedName(name: string | null | undefined): string | null {
  if (!name) return null;
  const match = name.match(/\(([^)]+)\)\s*$/);
  return match ? match[1].trim() : null;
}

// Client-side mirror of the server's hasAuthorityToOverride. Used to
// disable the Commit/Reject buttons before the user clicks. The
// server is still the source of truth; this is just a UX guard.
function canOverridePreviousDecision(callerRole: string | undefined, previousCloserName: string | null | undefined): boolean {
  const previousRole = parseRoleFromStampedName(previousCloserName);
  if (!previousRole) return true; // unknown previous role → permissive
  const callerRank = ROLE_RANK[callerRole || ''] ?? 0;
  const previousRank = ROLE_RANK[previousRole] ?? 0;
  return callerRank >= previousRank;
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

// Significance labels driving the tooltips on the colour dot + the
// 3-button colour picker. The traffic-light tones stay (green/amber/
// red) because that's what the schema stores; the labels reframe
// them in terms of point significance so reviewers see severity at
// a hover, not just a colour name.
const COLOUR_LABELS: Record<string, string> = {
  green: 'Minor',
  amber: 'Medium',
  red:   'Major',
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
  if (status === 'open' || status === 'new') return 'Open';
  if (status === 'addressed') return 'Addressed';
  if (status === 'reviewed') return 'Reviewed';
  if (status === 'closed' || status === 'committed') return 'Closed';
  if (status === 'cancelled' || status === 'rejected') return 'Rejected';
  return status.charAt(0).toUpperCase() + status.slice(1);
}
function statusPillClasses(status: string): string {
  const label = statusLabel(status);
  if (label === 'Addressed') return 'bg-blue-50 text-blue-700 border-blue-200';
  if (label === 'Reviewed') return 'bg-indigo-50 text-indigo-700 border-indigo-200';
  if (label === 'Closed') return 'bg-slate-100 text-slate-600 border-slate-200';
  if (label === 'Rejected') return 'bg-slate-200 text-slate-600 border-slate-300';
  return 'bg-amber-50 text-amber-700 border-amber-200';
}

/** Normalise legacy status values to the new workflow set, so the
 *  dropdown picker can highlight the current state correctly. */
function normaliseStatus(status: string): WorkflowStatus {
  if (status === 'addressed' || status === 'reviewed' || status === 'closed') return status as WorkflowStatus;
  if (status === 'committed') return 'closed';
  if (status === 'cancelled' || status === 'rejected') return 'closed';
  return 'open';
}

export function ManagementPointPanel({ engagementId, pointType, title, onClose, headingOptions: initialHeadings = [], userRole, userId, teamMembers = [] }: Props) {
  const theme = THEMES[pointType];
  const [points, setPoints] = useState<PointData[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [templateHeadings, setTemplateHeadings] = useState<string[]>(initialHeadings);
  // Engagement-specific custom headings — added inline by the team
  // during this client/period only. Persisted in AuditPermanentFile
  // section 'point_custom_headings' with shape
  //   { management: string[], representation: string[] }
  // so they survive page reloads without polluting the firm-wide
  // methodology template list.
  const [engagementHeadings, setEngagementHeadings] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [actionLog, setActionLog] = useState<ActionLogEntry[]>([]);
  const [openHistoryFor, setOpenHistoryFor] = useState<string | null>(null);

  // Filter + sort bar state. Filters narrow the list; sortBy picks a
  // column to order by (default: updated descending). See sortedPoints
  // useMemo below for the actual selection.
  const [filterAssignee, setFilterAssignee] = useState<string>('all'); // 'all' | userId | '__unassigned'
  const [filterCreator, setFilterCreator] = useState<string>('all');
  const [filterSection, setFilterSection] = useState<string>('all');
  const [filterSeverity, setFilterSeverity] = useState<string>('all'); // 'all' | green | amber | red | none
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'updated' | 'assignee' | 'creator' | 'section' | 'severity' | 'status'>('updated');

  // Create-form fields
  const [heading, setHeading] = useState('');
  const [customHeading, setCustomHeading] = useState('');
  const [description, setDescription] = useState('');
  const [body, setBody] = useState('');
  const [createAssignee, setCreateAssignee] = useState<string>('');

  useEffect(() => { void load(); void loadActionLog(); void loadEngagementHeadings(); }, [engagementId, pointType]);

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

  // Engagement-specific custom headings — persisted on AuditPermanentFile
  // section 'point_custom_headings'. Loaded once at mount; updated on
  // every "Add new heading" save. We store under the section's
  // pointType key so management + representation custom lists are
  // independent.
  async function loadEngagementHeadings() {
    try {
      const res = await fetch(`/api/engagements/${engagementId}/permanent-file?section=point_custom_headings`);
      if (!res.ok) return;
      const data = await res.json();
      const list = Array.isArray(data?.data?.[pointType]) ? data.data[pointType] as string[] : [];
      setEngagementHeadings(list);
    } catch { /* tolerant — engagement headings just stay empty */ }
  }

  async function saveEngagementHeadings(next: string[]) {
    setEngagementHeadings(next);
    try {
      // Read first so we don't clobber the OTHER pointType's list.
      const cur = await fetch(`/api/engagements/${engagementId}/permanent-file?section=point_custom_headings`).then(r => r.ok ? r.json() : null).catch(() => null);
      const existing = (cur?.data && typeof cur.data === 'object') ? cur.data : {};
      const merged = { ...existing, [pointType]: next };
      await fetch(`/api/engagements/${engagementId}/permanent-file`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sectionKey: 'point_custom_headings', data: merged, replace: true }),
      });
    } catch (err) {
      console.error('[ManagementPointPanel] saveEngagementHeadings failed', err);
    }
  }

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
  // The dropdown shows three buckets, de-duplicated case-insensitively:
  //   1. Methodology Admin defaults (firm-wide template list).
  //   2. Engagement-specific custom headings added inline via "Add
  //      new heading" — persisted on AuditPermanentFile section
  //      'point_custom_headings' so they survive reloads but stay
  //      scoped to THIS client/period only.
  //   3. Headings already used on this engagement's existing points
  //      (back-compat: pre-existing free-text headings show up
  //      automatically without needing to be added explicitly).
  const combinedHeadings = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    const push = (raw: string | null | undefined) => {
      const h = (raw || '').trim();
      const k = h.toLowerCase();
      if (!h || seen.has(k)) return;
      seen.add(k); out.push(h);
    };
    for (const h of templateHeadings) push(h);
    for (const h of engagementHeadings) push(h);
    for (const p of points) push(p.heading);
    return out;
  }, [templateHeadings, engagementHeadings, points]);

  /** Add a custom heading to the engagement-specific list. Used by
   *  the "+ Add new heading" inline form on the create panel. Idempotent
   *  on the case-insensitive key — adding a heading the firm-wide
   *  template already has is a no-op. */
  async function addEngagementHeading(raw: string) {
    const h = raw.trim();
    if (!h) return;
    const k = h.toLowerCase();
    // Already covered by templates / engagement / used list → no-op.
    if (combinedHeadings.some(x => x.toLowerCase() === k)) return;
    const next = [...engagementHeadings, h];
    await saveEngagementHeadings(next);
  }

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

  // Source section — derived from the captured nav reference. Used by
  // the filter bar so the auditor can see "all points raised on the
  // Walkthroughs tab" at a glance. Falls back to "(none)" for points
  // created without a nav reference (rare but possible on imports).
  const sectionOfPoint = (p: PointData): string => {
    const decoded = decodeNavReference(p.reference);
    if (decoded?.loc?.tab) return decoded.loc.tab;
    return '(none)';
  };

  // Filter + sort pipeline. Each filter is a no-op when set to 'all'.
  // Sorting falls back to updated-desc when two rows tie on the
  // primary key so the user always sees the freshest activity first
  // within a group.
  const filteredPoints = useMemo(() => {
    return points.filter(p => {
      if (filterAssignee !== 'all') {
        if (filterAssignee === '__unassigned' && p.assignedToUserId) return false;
        if (filterAssignee !== '__unassigned' && p.assignedToUserId !== filterAssignee) return false;
      }
      if (filterCreator !== 'all' && p.createdById !== filterCreator) return false;
      if (filterSection !== 'all' && sectionOfPoint(p) !== filterSection) return false;
      if (filterSeverity !== 'all') {
        if (filterSeverity === 'none' && p.colour) return false;
        if (filterSeverity !== 'none' && p.colour !== filterSeverity) return false;
      }
      if (filterStatus !== 'all' && normaliseStatus(p.status) !== filterStatus) return false;
      return true;
    });
  }, [points, filterAssignee, filterCreator, filterSection, filterSeverity, filterStatus]);

  const sortedPoints = useMemo(() => {
    const updatedDesc = (a: PointData, b: PointData) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    const arr = [...filteredPoints];
    if (sortBy === 'assignee') {
      arr.sort((a, b) => (a.assignedToName || 'zzz').localeCompare(b.assignedToName || 'zzz') || updatedDesc(a, b));
    } else if (sortBy === 'creator') {
      arr.sort((a, b) => a.createdByName.localeCompare(b.createdByName) || updatedDesc(a, b));
    } else if (sortBy === 'section') {
      arr.sort((a, b) => sectionOfPoint(a).localeCompare(sectionOfPoint(b)) || updatedDesc(a, b));
    } else if (sortBy === 'severity') {
      const sevRank = (c: string | null | undefined) => c === 'red' ? 0 : c === 'amber' ? 1 : c === 'green' ? 2 : 3;
      arr.sort((a, b) => sevRank(a.colour) - sevRank(b.colour) || updatedDesc(a, b));
    } else if (sortBy === 'status') {
      const rank = (s: string) => {
        const n = normaliseStatus(s);
        return n === 'open' ? 0 : n === 'addressed' ? 1 : n === 'reviewed' ? 2 : 3;
      };
      arr.sort((a, b) => rank(a.status) - rank(b.status) || updatedDesc(a, b));
    } else {
      // default: open first, then by updated-desc — keeps the
      // pre-existing behaviour as the most useful default.
      const rank = (s: string) => {
        const n = normaliseStatus(s);
        return n === 'open' ? 0 : n === 'addressed' ? 1 : n === 'reviewed' ? 2 : 3;
      };
      arr.sort((a, b) => rank(a.status) - rank(b.status) || updatedDesc(a, b));
    }
    return arr;
  }, [filteredPoints, sortBy]);

  // Options for the filter bar's Creator / Section dropdowns —
  // derived from the actual points so unfilled categories don't show.
  const creatorOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of points) map.set(p.createdById, p.createdByName);
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [points]);
  const sectionOptions = useMemo(() => {
    const set = new Set<string>();
    for (const p of points) set.add(sectionOfPoint(p));
    return Array.from(set).sort();
  }, [points]);

  const counts = useMemo(() => ({
    open: points.filter(p => normaliseStatus(p.status) === 'open').length,
    addressed: points.filter(p => normaliseStatus(p.status) === 'addressed').length,
    reviewed: points.filter(p => normaliseStatus(p.status) === 'reviewed').length,
    closed: points.filter(p => normaliseStatus(p.status) === 'closed').length,
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
          assignedToUserId: createAssignee || null,
        }),
      });
      if (res.ok) {
        // If the heading was free-text and new, persist it to the
        // engagement-specific list so subsequent points get it in
        // the dropdown without having to retype.
        if (heading === '__custom' && customHeading.trim()) {
          await addEngagementHeading(customHeading.trim());
        }
        setDescription(''); setBody(''); setHeading(''); setCustomHeading(''); setCreateAssignee('');
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

  /** Set a point's assignee via the PATCH ?action=assign handler. */
  async function assign(pointId: string, assignedToUserId: string | null) {
    setBusy(pointId);
    try {
      const res = await fetch(`/api/engagements/${engagementId}/audit-points`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: pointId, action: 'assign', assignedToUserId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data?.error || `Assignment failed (HTTP ${res.status})`);
      }
      await load();
    } finally { setBusy(null); }
  }

  /** Set a point's workflow status. Server enforces the role-rank
   *  gate; we mirror it client-side so the dropdown disables values
   *  the user can't pick. */
  async function setStatus(pointId: string, status: WorkflowStatus) {
    setBusy(pointId);
    try {
      const res = await fetch(`/api/engagements/${engagementId}/audit-points`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: pointId, action: 'status', status }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data?.error || `Status change failed (HTTP ${res.status})`);
      }
      await Promise.all([load(), loadActionLog()]);
    } finally { setBusy(null); }
  }

  /** Client-side mirror of the server role-rank gate. Returns true
   *  when the caller can change the status from its current value
   *  (i.e. caller rank >= rank of the user who last set the
   *  status). Server is the source of truth; this just keeps the
   *  dropdown disabled when we already know the change will be
   *  rejected. */
  function canChangeStatus(point: PointData): boolean {
    const history = Array.isArray(point.statusHistory) ? point.statusHistory : [];
    const last = history.length > 0 ? history[history.length - 1] : null;
    if (!last) return true; // no history → permissive
    const callerRank = ROLE_RANK[userRole || ''] ?? 0;
    const prevRank = ROLE_RANK[last.byRole || ''] ?? 0;
    // Allow the same user to flip their own status back regardless of
    // rank — useful for "I clicked the wrong one" corrections.
    if (userId && last.byId === userId) return true;
    return callerRank >= prevRank;
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
                {counts.open} open · {counts.addressed} addressed · {counts.reviewed} reviewed · {counts.closed} closed · drag header to move
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
                {/* Heading — red outline because it ends up on a client-facing letter */}
                <label className="text-xs font-semibold text-slate-700 block mb-1">
                  Heading <span className="text-[10px] text-red-600 font-normal">(appears in client letter)</span>
                </label>
                <select
                  value={heading}
                  onChange={e => setHeading(e.target.value)}
                  className="w-full border-2 border-red-300 rounded-lg px-3 py-2 text-sm bg-white focus:border-red-500 focus:ring-1 focus:ring-red-200 outline-none"
                >
                  <option value="">Select heading…</option>
                  {/* Defaults from Methodology Admin (templateHeadings)
                      are listed first; engagement-specific additions
                      then; previously-used free-text headings last.
                      combinedHeadings.useMemo above does the merge. */}
                  {combinedHeadings.map(h => <option key={h} value={h}>{h}</option>)}
                  <option value="__custom">+ Add new heading (this client/period only)</option>
                </select>
                {heading === '__custom' && (
                  <>
                    <input
                      value={customHeading}
                      onChange={e => setCustomHeading(e.target.value)}
                      placeholder="Enter custom heading…"
                      className="w-full border-2 border-red-300 rounded-lg px-3 py-2 text-sm mt-2 focus:border-red-500 focus:ring-1 focus:ring-red-200 outline-none"
                    />
                    <p className="text-[10px] text-slate-500 mt-1 italic">
                      This heading will be saved for this client/period only — defaults stay configured in Methodology Admin.
                    </p>
                  </>
                )}
              </div>
              {/* Assignee — who's responsible for actioning this
                  point. Optional; can also be assigned later from the
                  expanded row dropdown. */}
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1 inline-flex items-center gap-1">
                  <User className="h-3 w-3" /> Assignee <span className="text-[10px] text-slate-500 font-normal">(optional)</span>
                </label>
                <select
                  value={createAssignee}
                  onChange={e => setCreateAssignee(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white"
                >
                  <option value="">Unassigned</option>
                  {teamMembers.map(m => (
                    <option key={m.userId} value={m.userId}>
                      {m.userName || m.userId} · {m.role}
                    </option>
                  ))}
                </select>
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

          {/* Filter + sort bar — five filters + one sort selector,
              wrapped in a flex-wrap row so it shrinks gracefully on a
              narrow viewport. Filter state lives in component scope so
              switching between create + browse modes preserves it. */}
          <div className="px-3 py-2 border-b border-slate-100 bg-slate-50/40 flex items-center flex-wrap gap-2">
            <Filter className="h-3 w-3 text-slate-400" />
            <select
              value={filterAssignee}
              onChange={e => setFilterAssignee(e.target.value)}
              className="text-[11px] border border-slate-200 rounded px-1.5 py-1 bg-white"
              title="Filter by assignee"
            >
              <option value="all">Assignee: all</option>
              <option value="__unassigned">— Unassigned —</option>
              {teamMembers.map(m => (
                <option key={m.userId} value={m.userId}>
                  {m.userName || m.userId}
                </option>
              ))}
            </select>
            <select
              value={filterCreator}
              onChange={e => setFilterCreator(e.target.value)}
              className="text-[11px] border border-slate-200 rounded px-1.5 py-1 bg-white"
              title="Filter by creator"
            >
              <option value="all">Creator: all</option>
              {creatorOptions.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <select
              value={filterSection}
              onChange={e => setFilterSection(e.target.value)}
              className="text-[11px] border border-slate-200 rounded px-1.5 py-1 bg-white"
              title="Filter by source section (where the point was raised)"
            >
              <option value="all">Source: all</option>
              {sectionOptions.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <select
              value={filterSeverity}
              onChange={e => setFilterSeverity(e.target.value)}
              className="text-[11px] border border-slate-200 rounded px-1.5 py-1 bg-white"
              title="Filter by severity (traffic-light colour)"
            >
              <option value="all">Severity: all</option>
              <option value="red">Major (red)</option>
              <option value="amber">Medium (amber)</option>
              <option value="green">Minor (green)</option>
              <option value="none">No severity set</option>
            </select>
            <select
              value={filterStatus}
              onChange={e => setFilterStatus(e.target.value)}
              className="text-[11px] border border-slate-200 rounded px-1.5 py-1 bg-white"
              title="Filter by status"
            >
              <option value="all">Status: all</option>
              {WORKFLOW_STATUSES.map(s => (
                <option key={s} value={s}>{WORKFLOW_STATUS_LABELS[s]}</option>
              ))}
            </select>
            <div className="ml-auto flex items-center gap-1.5">
              <ArrowUpDown className="h-3 w-3 text-slate-400" />
              <select
                value={sortBy}
                onChange={e => setSortBy(e.target.value as typeof sortBy)}
                className="text-[11px] border border-slate-200 rounded px-1.5 py-1 bg-white"
                title="Sort by"
              >
                <option value="updated">Sort: updated</option>
                <option value="assignee">Sort: assignee</option>
                <option value="creator">Sort: creator</option>
                <option value="section">Sort: source</option>
                <option value="severity">Sort: severity</option>
                <option value="status">Sort: status</option>
              </select>
              {(filterAssignee !== 'all' || filterCreator !== 'all' || filterSection !== 'all' || filterSeverity !== 'all' || filterStatus !== 'all') && (
                <button
                  onClick={() => {
                    setFilterAssignee('all'); setFilterCreator('all'); setFilterSection('all'); setFilterSeverity('all'); setFilterStatus('all');
                  }}
                  className="text-[10px] text-slate-500 hover:text-slate-700 underline"
                  title="Clear all filters"
                >Reset</button>
              )}
            </div>
          </div>

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
                      <span
                        className={`flex-shrink-0 inline-block w-2.5 h-2.5 rounded-full mt-1.5 ${colourStyle?.dot || 'bg-slate-300'}`}
                        title={p.colour && COLOUR_LABELS[p.colour] ? `Significance: ${COLOUR_LABELS[p.colour]}` : 'No significance set'}
                      />
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
                        <p className="text-[10px] text-slate-500 mt-0.5">
                          by {p.createdByName}
                          {p.assignedToName && (
                            <span className="ml-2 inline-flex items-center gap-0.5 text-blue-700">
                              <User className="h-2.5 w-2.5" />{p.assignedToName}
                            </span>
                          )}
                        </p>
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
                                title={COLOUR_LABELS[c]}
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

                        {/* Links + file attachments — disabled once
                            the point is committed/rejected so the
                            audit trail of evidence at decision time
                            stays intact. The authority gate on the
                            buttons below still allows a senior to
                            unlock. */}
                        <div className="mb-3">
                          <PointAttachments
                            engagementId={engagementId}
                            value={(p.attachments as Attachment[] | null) ?? []}
                            onChange={(next) => void actOn(p.id, 'update', { attachments: next })}
                            disabled={!isOpen || busy === p.id}
                          />
                        </div>

                        {/* Assignee + Status row.
                            Assignee is freely editable by anyone on the
                            team. Status is gated by the role-rank rule
                            enforced server-side (canChangeStatus mirrors
                            the gate client-side so the dropdown disables
                            when the change would be rejected). */}
                        {(() => {
                          const currentStatus = normaliseStatus(p.status);
                          const canChange = canChangeStatus(p);
                          const history = Array.isArray(p.statusHistory) ? p.statusHistory : [];
                          const lastEntry = history.length > 0 ? history[history.length - 1] : null;
                          const lockedTooltip = lastEntry
                            ? `Status was last set to "${lastEntry.status}" by ${lastEntry.byName || 'a senior reviewer'}${lastEntry.byRole ? ` (${lastEntry.byRole})` : ''}${lastEntry.at ? ` on ${formatDateTime(lastEntry.at)}` : ''}. You need at least their authority to change it.`
                            : '';
                          return (
                            <div className="pt-2 border-t border-slate-100 space-y-2">
                              <div className="flex items-center gap-3 flex-wrap">
                                {/* Assignee dropdown */}
                                <div className="inline-flex items-center gap-1.5">
                                  <span className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold inline-flex items-center gap-1">
                                    <User className="h-3 w-3" /> Assignee
                                  </span>
                                  <select
                                    value={p.assignedToUserId || ''}
                                    onChange={e => void assign(p.id, e.target.value || null)}
                                    disabled={busy === p.id}
                                    className="text-[11px] border border-slate-200 rounded px-1.5 py-1 bg-white disabled:opacity-50"
                                  >
                                    <option value="">Unassigned</option>
                                    {teamMembers.map(m => (
                                      <option key={m.userId} value={m.userId}>
                                        {m.userName || m.userId} · {m.role}
                                      </option>
                                    ))}
                                    {/* If the current assignee isn't in the supplied
                                        team list (e.g. they left the team), show
                                        them anyway so the dropdown isn't blank. */}
                                    {p.assignedToUserId && !teamMembers.some(m => m.userId === p.assignedToUserId) && (
                                      <option value={p.assignedToUserId}>{p.assignedToName || p.assignedToUserId} (former)</option>
                                    )}
                                  </select>
                                </div>
                                {/* Status dropdown */}
                                <div className="inline-flex items-center gap-1.5">
                                  <span className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">Status</span>
                                  <select
                                    value={currentStatus}
                                    onChange={e => void setStatus(p.id, e.target.value as WorkflowStatus)}
                                    disabled={busy === p.id || !canChange}
                                    className="text-[11px] border border-slate-200 rounded px-1.5 py-1 bg-white disabled:opacity-50 disabled:cursor-not-allowed"
                                    title={!canChange ? lockedTooltip : 'Change status — recorded against you and timestamped'}
                                  >
                                    {WORKFLOW_STATUSES.map(s => (
                                      <option key={s} value={s}>{WORKFLOW_STATUS_LABELS[s]}</option>
                                    ))}
                                  </select>
                                </div>
                                {lastEntry && (
                                  <span className="text-[10px] text-slate-500 italic ml-auto">
                                    {WORKFLOW_STATUS_LABELS[normaliseStatus(lastEntry.status || '')]}
                                    {lastEntry.byName ? ` by ${lastEntry.byName}` : ''}
                                    {lastEntry.byRole ? ` (${lastEntry.byRole})` : ''}
                                    {lastEntry.at ? ` on ${formatDateTime(lastEntry.at)}` : ''}
                                  </span>
                                )}
                              </div>
                              {/* Status timeline — full history of changes
                                  rendered as a tiny list so reviewers can
                                  see at a glance who set what when. Only
                                  shown when there are 2+ entries (a
                                  single entry duplicates the line above). */}
                              {history.length > 1 && (
                                <div className="text-[10px] text-slate-500">
                                  <div className="font-semibold uppercase tracking-wide text-slate-400 mb-1">Status history</div>
                                  <ul className="space-y-0.5">
                                    {history.map((h, i) => (
                                      <li key={i}>
                                        → <span className="font-medium text-slate-700">{WORKFLOW_STATUS_LABELS[normaliseStatus(h.status || '')]}</span>
                                        {h.byName ? ` · ${h.byName}` : ''}
                                        {h.byRole ? ` (${h.byRole})` : ''}
                                        {h.at ? ` · ${formatDateTime(h.at)}` : ''}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </div>
                          );
                        })()}
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
