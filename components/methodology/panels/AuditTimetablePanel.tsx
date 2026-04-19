'use client';

import { useEffect, useRef, useState } from 'react';
import { CalendarDays, Plus, Trash2, Loader2, Check } from 'lucide-react';
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
  // Seed ONCE on mount — never re-sync from props afterwards. The
  // component owns its state for the rest of its lifetime; on tab
  // switch it unmounts and remounts with fresh server data.
  const [rows, setRows] = useState<Row[]>(() => seedIfEmpty(initialDates));
  const [saving, setSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The latest rows — a ref mirror so the debounced/unmount saver
  // sees fresh values at call time, not the stale closure.
  const rowsRef = useRef<Row[]>(rows);
  rowsRef.current = rows;

  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const savingRef = useRef(false);
  const pendingWhileSavingRef = useRef(false);

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
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, ...patch, _seeded: false } : r));
    scheduleSave();
  }
  function addRow() {
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
    setRows(prev => prev.filter((_, i) => i !== idx));
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
                    <input
                      type="date"
                      value={toDateInput(row.targetDate)}
                      onChange={e => update(idx, { targetDate: e.target.value || null })}
                      onBlur={flushNow}
                      className="text-xs border border-transparent hover:border-slate-200 focus:border-blue-300 rounded px-1.5 py-1 bg-transparent focus:bg-white outline-none"
                    />
                  </td>
                  <td className="py-1 px-2">
                    <input
                      type="date"
                      value={toDateInput(row.revisedTarget)}
                      onChange={e => update(idx, { revisedTarget: e.target.value || null })}
                      onBlur={flushNow}
                      className="text-xs border border-transparent hover:border-slate-200 focus:border-blue-300 rounded px-1.5 py-1 bg-transparent focus:bg-white outline-none"
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
                  <td className="py-1 px-2 text-right">
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

/** Convert an ISO-ish string (or null) to the `yyyy-mm-dd` format
 *  the `<input type="date">` element requires. Never throws. */
function toDateInput(v: string | null): string {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
