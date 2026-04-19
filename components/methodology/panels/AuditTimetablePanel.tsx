'use client';

import { useEffect, useState } from 'react';
import { CalendarDays, Plus, Trash2 } from 'lucide-react';
import type { AgreedDateData } from '@/hooks/useEngagement';
import { useAutoSave } from '@/hooks/useAutoSave';

/**
 * AuditTimetablePanel — the "Audit Timetable" section at the bottom
 * of the Opening Tab. Each row captures an agreed milestone for the
 * engagement (Planning start, Fieldwork, Completion, etc.) with:
 *   • A label (description)       — free text
 *   • A target date               — the agreed date
 *   • An optional revised target  — if the date slipped
 *   • Progress status             — not started / in progress / complete / overdue
 *
 * Storage reuses the existing `AuditAgreedDate` Prisma model and
 * `/api/engagements/[id]/agreed-dates` endpoint — no new tables.
 *
 * Rows are added/removed in-place and auto-saved via `useAutoSave`
 * (same pattern as TeamPanel / ClientContactsPanel).
 *
 * If the engagement has no agreed dates yet, three starter rows —
 * Planning / Fieldwork / Completion — are shown as placeholders but
 * NOT persisted until the admin types a date or label change,
 * keeping the UI helpful without polluting the DB with stubs.
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

type Draft = AgreedDateData & { _seeded?: boolean };

export function AuditTimetablePanel({ engagementId, initialDates }: Props) {
  // Seed the three starter rows when the engagement has none — marked
  // `_seeded` so we know to skip them in the save payload unless the
  // admin has actually touched them (avoids creating empty DB rows
  // just because the tab was opened).
  const [rows, setRows] = useState<Draft[]>(() => seedIfEmpty(initialDates));
  useEffect(() => { setRows(seedIfEmpty(initialDates)); }, [initialDates]);

  // Only rows the admin has interacted with get persisted. A row
  // counts as "real" if it has an id (already saved), OR a target
  // date, OR a revised date, OR a progress that isn't the default,
  // OR a description that isn't one of the untouched defaults.
  const persistableRows = rows.filter(r => {
    if (r.id) return true;
    if (!r._seeded) return true;
    if (r.targetDate || r.revisedTarget) return true;
    if (r.progress && r.progress !== 'Not Started') return true;
    return false;
  });

  useAutoSave(
    `/api/engagements/${engagementId}/agreed-dates`,
    {
      dates: persistableRows.map((r, i) => ({
        id: r.id || undefined,
        description: r.description,
        targetDate: r.targetDate,
        revisedTarget: r.revisedTarget,
        progress: r.progress,
        sortOrder: r.sortOrder ?? i,
      })),
    },
    { enabled: rows !== initialDates },
  );

  function addRow() {
    setRows(prev => [
      ...prev,
      {
        id: '',
        description: '',
        targetDate: null,
        revisedTarget: null,
        progress: 'Not Started',
        sortOrder: (prev[prev.length - 1]?.sortOrder ?? 0) + 1,
      },
    ]);
  }
  function removeRow(idx: number) {
    setRows(prev => prev.filter((_, i) => i !== idx));
  }
  function update(idx: number, patch: Partial<Draft>) {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, ...patch, _seeded: false } : r));
  }

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-blue-500" />
          Audit Timetable
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
                <tr key={row.id || `draft-${idx}`} className="border-b border-slate-100 last:border-0">
                  <td className="py-1 px-2">
                    <input
                      type="text"
                      value={row.description}
                      onChange={e => update(idx, { description: e.target.value })}
                      placeholder="e.g. Planning meeting"
                      className="w-full text-xs border border-transparent hover:border-slate-200 focus:border-blue-300 rounded px-1.5 py-1 bg-transparent focus:bg-white outline-none"
                    />
                  </td>
                  <td className="py-1 px-2">
                    <input
                      type="date"
                      value={toDateInput(row.targetDate)}
                      onChange={e => update(idx, { targetDate: e.target.value || null })}
                      className="text-xs border border-transparent hover:border-slate-200 focus:border-blue-300 rounded px-1.5 py-1 bg-transparent focus:bg-white outline-none"
                    />
                  </td>
                  <td className="py-1 px-2">
                    <input
                      type="date"
                      value={toDateInput(row.revisedTarget)}
                      onChange={e => update(idx, { revisedTarget: e.target.value || null })}
                      className="text-xs border border-transparent hover:border-slate-200 focus:border-blue-300 rounded px-1.5 py-1 bg-transparent focus:bg-white outline-none"
                    />
                  </td>
                  <td className="py-1 px-2">
                    <select
                      value={row.progress || 'Not Started'}
                      onChange={e => update(idx, { progress: e.target.value as Draft['progress'] })}
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
 *  sees a helpful starting state. Marked `_seeded` so the autosaver
 *  skips them until the admin types into one. */
function seedIfEmpty(initial: AgreedDateData[]): Draft[] {
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
