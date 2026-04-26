'use client';

import { useEffect, useRef, useState } from 'react';
import { CalendarDays, Plus, Trash2, Loader2, Check, ArrowUp } from 'lucide-react';
import type { AgreedDateData } from '@/hooks/useEngagement';

/**
 * AuditTimetablePanel — the "Audit Timetable" section at the bottom
 * of the Opening Tab. Each row captures an agreed milestone for the
 * engagement (Planning start, Fieldwork, Completion, etc.) with a
 * label, target date, optional revised target, and progress status.
 *
 * Storage reuses the existing `AuditAgreedDate` Prisma model and
 * `/api/engagements/[id]/agreed-dates` endpoint — no new tables.
 *
 * ── Why we DON'T use the shared useAutoSave hook ──────────────────
 *
 * This panel needs three things the shared hook doesn't provide:
 *   1. Read the save response to hydrate server-assigned IDs back
 *      into local state. Without this, every save sees `id: ''` on
 *      newly-created rows and the server falls through to the
 *      delete-all-then-recreate path on every keystroke.
 *   2. Save-on-blur for instant persistence when the user clicks
 *      off a field — debounce alone is too slow when switching tabs.
 *   3. Idempotent seed-from-props — seeding on mount ONLY, never
 *      re-syncing when the parent re-renders (which would wipe
 *      in-progress edits).
 *
 * We implement a small purpose-built save loop below: debounced
 * autosave + flush-on-blur + flush-on-unmount.
 */

interface Props {
  engagementId: string;
  initialDates: AgreedDateData[];
}

const DEFAULT_MILESTONES: Array<{ description: string; sortOrder: number }> = [
  { description: 'Planning',   sortOrder: 1 },
  { description: 'Fieldwork',  sortOrder: 2 },
  { description: 'Completion', sortOrder: 3 },
];

const PROGRESS_OPTIONS: Array<{ value: 'Not Started' | 'In Progress' | 'Complete' | 'Overdue'; label: string; colour: string }> = [
  { value: 'Not Started',  label: 'Not Started',  colour: 'bg-slate-100 text-slate-600' },
  { value: 'In Progress',  label: 'In Progress',  colour: 'bg-amber-100 text-amber-700' },
  { value: 'Complete',     label: 'Complete',     colour: 'bg-green-100 text-green-700' },
  { value: 'Overdue',      label: 'Overdue',      colour: 'bg-red-100 text-red-700' },
];

type Row = AgreedDateData & {
  /** A starter row that hasn't been touched yet. Filtered out of the
   *  save payload so opening the tab never creates stub rows. */
  _seeded?: boolean;
  /** Client-side temporary id for React keys until the server assigns
   *  a real one. Stripped before sending to the API. */
  _tempId?: string;
};

const SAVE_DEBOUNCE_MS = 800;

export function AuditTimetablePanel({ engagementId, initialDates }: Props) {
  // Initial render shows whatever the parent's cached engagement has.
  // That cache is set ONCE on page load and never refetched, so after
  // a save + tab-switch the parent still thinks the timetable is
  // empty. To fix that, we fetch fresh data from the server on mount
  // (see the useEffect below) and replace the initial seed with it.
  // This means: even though the parent never refreshes, the panel
  // always shows live data when it mounts.
  const [rows, setRows] = useState<Row[]>(() => seedIfEmpty(initialDates));
  const [saving, setSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Hydration state — true once we've successfully fetched fresh
  // rows. While loading we still show the seeded/cached rows so the
  // admin doesn't see a flash of emptiness.
  const [hydrated, setHydrated] = useState(false);

  // ── Fetch fresh rows on mount ───────────────────────────────────
  // Guarantees we always see the truth after switching tabs, even
  // though the parent's `initialDates` prop is stale cached data
  // from the initial page load.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/engagements/${engagementId}/agreed-dates`);
        if (!res.ok) return;
        const data = await res.json().catch(() => ({}));
        const serverRows: AgreedDateData[] = Array.isArray(data?.dates) ? data.dates : [];
        if (cancelled) return;
        // If the user has already started editing, don't stomp their
        // in-progress work. The next save will push their edits to
        // the server anyway, and subsequent mounts will hydrate fresh.
        if (dirtyRef.current) return;
        // If the server has real data, replace local seed with it.
        // If it's empty, keep the seeded starter rows.
        if (serverRows.length > 0) {
          setRows(serverRows.map(r => ({ ...r })));
        }
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();
    return () => { cancelled = true; };
  }, [engagementId]);

  // The latest rows — a ref mirror so the debounced/unmount saver
  // sees fresh values at call time, not the stale closure.
  const rowsRef = useRef<Row[]>(rows);
  rowsRef.current = rows;

  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const savingRef = useRef(false);
  const pendingWhileSavingRef = useRef(false);
  // Flips true the moment the user edits anything. The initial
  // hydration fetch checks this before replacing state — if the user
  // has already started typing, we skip the hydration so their edits
  // aren't overwritten by the race-winning fetch response.
  const dirtyRef = useRef(false);

  /** Take the current local rows, filter to the subset that should
   *  actually be persisted, strip client-only fields, and send. */
  async function flush(): Promise<void> {
    // Serialise — if a save is already in flight, mark that another
    // is needed and let the current one pick up the latest rows when
    // it finishes.
    if (savingRef.current) {
      pendingWhileSavingRef.current = true;
      return;
    }
    const persistable = rowsRef.current.filter(r => {
      if (r.id) return true;
      if (!r._seeded) return true;
      if (r.targetDate || r.revisedTarget) return true;
      if (r.progress && r.progress !== 'Not Started') return true;
      if (r.description && !DEFAULT_MILESTONES.some(m => m.description === r.description)) return true;
      return false;
    });

    savingRef.current = true;
    setSaving(true);
    setError(null);

    try {
      const payload = persistable.map((r, i) => ({
        id: r.id || undefined,
        description: r.description,
        targetDate: r.targetDate,
        revisedTarget: r.revisedTarget,
        progress: r.progress,
        sortOrder: r.sortOrder ?? i,
      }));
      const res = await fetch(`/api/engagements/${engagementId}/agreed-dates`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dates: payload }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Save failed (${res.status})`);
      }
      const data = await res.json().catch(() => ({ dates: [] }));
      const serverRows: AgreedDateData[] = Array.isArray(data?.dates) ? data.dates : [];

      // Hydrate local IDs from the server response by matching on
      // (sortOrder, description) — same keys the server round-trips.
      // This stops subsequent saves churning through delete+recreate.
      setRows(prev => {
        const mapByKey = new Map(serverRows.map(s => [`${s.sortOrder}::${s.description}`, s]));
        return prev.map(r => {
          if (r.id) return r; // already has server id
          if (r._seeded) return r; // untouched starter — leave as-is
          const key = `${r.sortOrder}::${r.description}`;
          const server = mapByKey.get(key);
          if (server?.id) return { ...r, id: server.id };
          return r;
        });
      });

      setLastSavedAt(new Date());
    } catch (err: any) {
      setError(err?.message || 'Save failed');
    } finally {
      savingRef.current = false;
      setSaving(false);
      // If more edits came in while we were saving, queue another.
      if (pendingWhileSavingRef.current) {
        pendingWhileSavingRef.current = false;
        scheduleSave();
      }
    }
  }

  /** Schedule a debounced save — called from every change handler. */
  function scheduleSave() {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => { void flush(); }, SAVE_DEBOUNCE_MS);
  }

  /** Flush any pending save immediately — called on blur and unmount. */
  function flushNow() {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    void flush();
  }

  // ── Unmount: flush any pending save synchronously so nothing is
  // ── dropped when the user switches tabs.
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      // Fire-and-forget — the browser keeps the fetch alive even
      // after the component unmounts. We use `keepalive` on the
      // fetch to be safe.
      const persistable = rowsRef.current.filter(r => {
        if (r.id) return true;
        if (!r._seeded) return true;
        if (r.targetDate || r.revisedTarget) return true;
        if (r.progress && r.progress !== 'Not Started') return true;
        if (r.description && !DEFAULT_MILESTONES.some(m => m.description === r.description)) return true;
        return false;
      });
      if (persistable.length === 0 && rowsRef.current.every(r => r._seeded)) return;
      const payload = persistable.map((r, i) => ({
        id: r.id || undefined,
        description: r.description,
        targetDate: r.targetDate,
        revisedTarget: r.revisedTarget,
        progress: r.progress,
        sortOrder: r.sortOrder ?? i,
      }));
      fetch(`/api/engagements/${engagementId}/agreed-dates`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dates: payload }),
        keepalive: true,
      }).catch(() => { /* unmount-time flush — best effort */ });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engagementId]);

  // ── Mutation helpers ────────────────────────────────────────────
  function update(idx: number, patch: Partial<Row>) {
    dirtyRef.current = true;
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, ...patch, _seeded: false } : r));
    scheduleSave();
  }
  function addRow() {
    dirtyRef.current = true;
    setRows(prev => [
      ...prev,
      {
        id: '',
        _tempId: Math.random().toString(36).slice(2, 10),
        description: '',
        targetDate: null,
        revisedTarget: null,
        progress: 'Not Started',
        sortOrder: (prev[prev.length - 1]?.sortOrder ?? 0) + 1,
      },
    ]);
    // Don't save yet — blank row with no description. Save after user types.
  }
  function removeRow(idx: number) {
    dirtyRef.current = true;
    setRows(prev => prev.filter((_, i) => i !== idx));
    scheduleSave();
  }
  /** Swap a milestone with the one above it. Renumbers `sortOrder`
   *  on both rows so the persisted order matches the new array
   *  position — important because the agreed-dates endpoint orders
   *  by `sortOrder` ASC, and `{{#each auditTimetable}}` document
   *  iterations use that same ordering. */
  function moveRowUp(idx: number) {
    if (idx <= 0) return;
    dirtyRef.current = true;
    setRows(prev => {
      const next = prev.slice();
      const a = next[idx - 1];
      const b = next[idx];
      // Swap positions AND swap their sortOrder values so save sees
      // monotonically-increasing numbers from top to bottom.
      const aSort = typeof a.sortOrder === 'number' ? a.sortOrder : idx - 1;
      const bSort = typeof b.sortOrder === 'number' ? b.sortOrder : idx;
      next[idx - 1] = { ...b, sortOrder: aSort, _seeded: false };
      next[idx] = { ...a, sortOrder: bSort, _seeded: false };
      return next;
    });
    scheduleSave();
  }

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-blue-500" />
          Audit Timetable
          {/* Save-status indicator — subtle but informative. */}
          {saving && <span className="text-[10px] text-blue-500 flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Saving…</span>}
          {!saving && lastSavedAt && !error && (
            <span className="text-[10px] text-green-600 flex items-center gap-1"><Check className="h-3 w-3" /> Saved</span>
          )}
          {error && <span className="text-[10px] text-red-600">Save failed: {error}</span>}
        </h3>
        <button
          type="button"
          onClick={addRow}
          className="inline-flex items-center gap-1 text-[11px] px-2 py-1 bg-blue-50 border border-blue-200 text-blue-700 rounded hover:bg-blue-100"
        >
          <Plus className="h-3 w-3" /> Add milestone
        </button>
      </div>

      {rows.length === 0 && (
        <div className="text-[11px] text-slate-400 italic px-3 py-4 border border-dashed border-slate-200 rounded text-center">
          No milestones yet — click &ldquo;Add milestone&rdquo; to set dates for Planning, Fieldwork, Completion, etc.
        </div>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] uppercase tracking-wide text-slate-500 border-b border-slate-200">
                <th className="text-left py-1.5 px-2 font-semibold">Milestone</th>
                <th className="text-left py-1.5 px-2 font-semibold">Target date</th>
                <th className="text-left py-1.5 px-2 font-semibold">Revised</th>
                <th className="text-left py-1.5 px-2 font-semibold">Progress</th>
                <th className="w-8"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr key={row.id || row._tempId || `seed-${idx}-${row.description}`} className="border-b border-slate-100 last:border-0">
                  <td className="py-1 px-2">
                    <input
                      type="text"
                      value={row.description}
                      onChange={e => update(idx, { description: e.target.value })}
                      onBlur={flushNow}
                      placeholder="e.g. Planning meeting"
                      className="w-full text-xs border border-transparent hover:border-slate-200 focus:border-blue-300 rounded px-1.5 py-1 bg-transparent focus:bg-white outline-none"
                    />
                  </td>
                  <td className="py-1 px-2">
                    <UkDateInput
                      value={row.targetDate}
                      onCommit={(iso) => { update(idx, { targetDate: iso }); flushNow(); }}
                    />
                  </td>
                  <td className="py-1 px-2">
                    <UkDateInput
                      value={row.revisedTarget}
                      onCommit={(iso) => { update(idx, { revisedTarget: iso }); flushNow(); }}
                    />
                  </td>
                  <td className="py-1 px-2">
                    <select
                      value={row.progress || 'Not Started'}
                      onChange={e => { update(idx, { progress: e.target.value as Row['progress'] }); flushNow(); }}
                      className={`text-[10px] font-medium rounded px-1.5 py-0.5 border border-transparent hover:border-slate-200 focus:border-blue-300 ${
                        PROGRESS_OPTIONS.find(p => p.value === row.progress)?.colour || 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {PROGRESS_OPTIONS.map(p => (
                        <option key={p.value} value={p.value}>{p.label}</option>
                      ))}
                    </select>
                  </td>
                  <td className="py-1 px-2 text-right whitespace-nowrap">
                    {/* Move-up arrow — drives row order in the saved
                        agreed-dates AND the order document templates
                        iterate this list as `auditTimetable`. Disabled
                        on the top row (nowhere to go). */}
                    <button
                      type="button"
                      onClick={() => moveRowUp(idx)}
                      disabled={idx === 0}
                      className="text-slate-400 hover:text-slate-700 p-1 disabled:opacity-30 disabled:cursor-not-allowed"
                      title={idx === 0 ? 'Already at the top' : 'Move up'}
                    >
                      <ArrowUp className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeRow(idx)}
                      className="text-slate-400 hover:text-red-500 p-1"
                      title="Remove milestone"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Date input that accepts UK-style formats and parses on blur /
 *  Enter. Displays as dd/mm/yyyy. Commits to parent only when the
 *  input either becomes cleanly empty (parent gets null) or parses
 *  to a valid date (parent gets ISO yyyy-mm-dd) — malformed input
 *  on blur reverts to the last committed value (with a brief red
 *  border to show the user their input was rejected).
 *
 *  Why not <input type="date">: the native picker fires onChange
 *  with '' when the user types raw digits without slashes (e.g.
 *  `01042026`), which silently persists as null. This control
 *  accepts `01042026`, `01/04/2026`, `1/4/26`, `1 Apr 2026` etc. */
function UkDateInput({ value, onCommit }: { value: string | null; onCommit: (iso: string | null) => void }) {
  const display = toUkDisplay(value);
  const [text, setText] = useState(display);
  const [rejected, setRejected] = useState(false);
  // Keep the text in sync when the parent hands us a different
  // committed value (e.g. from a fresh server hydration).
  useEffect(() => { setText(toUkDisplay(value)); setRejected(false); }, [value]);

  function commit() {
    const parsed = parseUkDate(text);
    if (parsed === null) {
      // Explicit empty — clear the saved date.
      setRejected(false);
      if (value !== null) onCommit(null);
      return;
    }
    if (parsed === false) {
      // Nonsense input — flash the field red and revert to the last
      // committed value so we never save a half-typed number.
      setRejected(true);
      setText(toUkDisplay(value));
      window.setTimeout(() => setRejected(false), 1200);
      return;
    }
    setRejected(false);
    // Normalise the display to canonical dd/mm/yyyy now that we
    // have a valid parse.
    setText(toUkDisplay(parsed));
    if (parsed !== value) onCommit(parsed);
  }

  return (
    <input
      type="text"
      value={text}
      onChange={e => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') { (e.currentTarget as HTMLInputElement).blur(); }
      }}
      placeholder="dd/mm/yyyy"
      className={`w-28 text-xs border rounded px-1.5 py-1 bg-transparent focus:bg-white outline-none ${
        rejected ? 'border-red-400 text-red-700' : 'border-transparent hover:border-slate-200 focus:border-blue-300'
      }`}
      title={rejected ? 'Invalid date — reverted. Try dd/mm/yyyy or 01042026 etc.' : 'Accepts dd/mm/yyyy, 01042026, 1/4/26, 1 Apr 2026, etc.'}
    />
  );
}

/** Seed three default rows when the engagement has none so the admin
 *  sees a helpful starting state. Marked `_seeded` so the saver skips
 *  them until the admin types into one. */
function seedIfEmpty(initial: AgreedDateData[]): Row[] {
  if (initial.length > 0) return initial.map(d => ({ ...d }));
  return DEFAULT_MILESTONES.map(m => ({
    id: '',
    description: m.description,
    targetDate: null,
    revisedTarget: null,
    progress: 'Not Started',
    sortOrder: m.sortOrder,
    _seeded: true,
  }));
}

/** Convert an ISO-ish string (or null) to a UK display string
 *  `dd/mm/yyyy`. Never throws. Empty-in / invalid → empty-out. */
function toUkDisplay(v: string | null): string {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${day}/${m}/${y}`;
}

/** Parse a user-typed date in any of these flavours into an ISO
 *  `yyyy-mm-dd` string. Returns null when the input is empty, and
 *  `false` when the input has text but can't be parsed (so the
 *  caller can distinguish "user cleared the field" from "user typed
 *  nonsense and we should keep the previous value"). Accepts:
 *    • `01042026`       (8 raw digits — dd mm yyyy)
 *    • `1042026`        (7 raw digits — d mm yyyy)
 *    • `01/04/2026`     (slashes, hyphens, dots, or spaces)
 *    • `1/4/2026`
 *    • `1/4/26`         (2-digit year → +2000)
 *    • `01-04-2026`, `01.04.2026`, `01 04 2026`
 *    • `2026-04-01`     (already ISO)
 *    • `1 Apr 2026` / `1 April 2026` / `apr 1 2026`
 *  Rejects clearly out-of-range day/month. */
function parseUkDate(raw: string): string | null | false {
  const s = String(raw ?? '').trim();
  if (!s) return null;

  // ISO short-circuit.
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (iso) {
    const d = new Date(`${iso[1]}-${iso[2]}-${iso[3]}T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? false : `${iso[1]}-${iso[2]}-${iso[3]}`;
  }

  // Raw digits — 6 / 7 / 8 long. Interpret as ddmmyy / dmmyyyy / ddmmyyyy.
  const digits = s.replace(/[^0-9]/g, '');
  if (digits.length === 8 && /^\d+$/.test(s.replace(/\s+/g, ''))) {
    const d = digits.slice(0, 2), m = digits.slice(2, 4), y = digits.slice(4, 8);
    return buildIso(Number(d), Number(m), Number(y));
  }
  if (digits.length === 6 && /^\d+$/.test(s.replace(/\s+/g, ''))) {
    const d = digits.slice(0, 2), m = digits.slice(2, 4), y = digits.slice(4, 6);
    return buildIso(Number(d), Number(m), 2000 + Number(y));
  }
  if (digits.length === 7 && /^\d+$/.test(s.replace(/\s+/g, ''))) {
    const d = digits.slice(0, 1), m = digits.slice(1, 3), y = digits.slice(3, 7);
    return buildIso(Number(d), Number(m), Number(y));
  }

  // Separated dd/mm/yyyy with any of the common UK separators.
  const sep = /^(\d{1,2})[\/\-\.\s](\d{1,2})[\/\-\.\s](\d{2}|\d{4})$/.exec(s);
  if (sep) {
    const year = sep[3].length === 2 ? 2000 + Number(sep[3]) : Number(sep[3]);
    return buildIso(Number(sep[1]), Number(sep[2]), year);
  }

  // Month-name formats — let Date try.
  const tried = new Date(s);
  if (!Number.isNaN(tried.getTime())) {
    const y = tried.getFullYear();
    const m = String(tried.getMonth() + 1).padStart(2, '0');
    const d = String(tried.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return false;
}

/** Check day/month/year are in range and assemble an ISO string.
 *  Rejects 31 Feb etc. (via Date's own rollover detection). */
function buildIso(day: number, month: number, year: number): string | false {
  if (!Number.isFinite(day) || !Number.isFinite(month) || !Number.isFinite(year)) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  if (year < 1900 || year > 2100) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  // Reject rolled-over dates like 31-Feb becoming 3-Mar.
  if (d.getUTCFullYear() !== year || d.getUTCMonth() + 1 !== month || d.getUTCDate() !== day) return false;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
