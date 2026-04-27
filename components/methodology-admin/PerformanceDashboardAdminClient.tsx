'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  ClipboardCheck,
  GraduationCap,
  Loader2,
  Megaphone,
  Plus,
  Save,
  Search,
  ShieldCheck,
  Target,
  Trash2,
  X,
} from 'lucide-react';

/* ------------------------------------------------------------------ */
/* Tab definition                                                      */
/* ------------------------------------------------------------------ */

const TABS = [
  { key: 'monitoring',  label: 'Monitoring activities', icon: ClipboardCheck },
  { key: 'findings',    label: 'Findings & RCA',        icon: Search },
  { key: 'remediations',label: 'Remediations',          icon: ShieldCheck },
  { key: 'csfs',        label: 'CSFs',                  icon: Megaphone },
  { key: 'people',      label: 'People snapshots',      icon: GraduationCap },
  { key: 'schedule',    label: 'Activity schedule',     icon: Calendar },
  { key: 'isqm',        label: 'ISQM(UK)1 evidence',    icon: Target },
  { key: 'pillars',     label: 'Pillar overrides',      icon: Target },
] as const;

type TabKey = typeof TABS[number]['key'];

const ACTIVITY_TYPES = [
  { value: 'cold',        label: 'Cold file review' },
  { value: 'hot',         label: 'Hot file review (new RI/manager)' },
  { value: 'spot',        label: 'Spot review' },
  { value: 'thematic',    label: 'Thematic review' },
  { value: 'eqr',         label: 'EQR process review' },
  { value: 'consultation',label: 'Consultation (technical)' },
  { value: 'preissuance', label: 'FS pre-issuance review' },
  { value: 'ethical',     label: 'Ethical compliance review' },
];

const ACTIVITY_STATUSES = ['planned', 'in_progress', 'complete', 'overdue', 'cancelled'];
const OUTCOMES = [
  { value: '', label: '— not rated —' },
  { value: 'good', label: 'Good with limited improvements' },
  { value: 'limited_improvements', label: 'Limited improvements required' },
  { value: 'improvements_required', label: 'Improvements required' },
  { value: 'significant_improvements', label: 'Significant improvements required' },
];

const SEVERITIES = ['low', 'medium', 'high', 'critical'];
const FINDING_STATUSES = ['open', 'rca_in_progress', 'rca_complete', 'closed'];
const ROOT_CAUSES = [
  { value: '', label: '— not categorised —' },
  { value: 'process', label: 'Process' },
  { value: 'methodology', label: 'Methodology' },
  { value: 'supervision', label: 'Supervision/EQR' },
  { value: 'data_ipe', label: 'Data quality (IPE)' },
  { value: 'resourcing', label: 'Resourcing' },
  { value: 'other', label: 'Other' },
];

const REMEDIATION_STATUSES = ['not_started', 'in_progress', 'implemented', 'retested', 'overdue'];

const PILLARS = [
  { value: 'goodwill',   label: 'Goodwill' },
  { value: 'governance', label: 'Governance' },
  { value: 'growth',     label: 'Growth' },
  { value: 'quality',    label: 'Quality' },
];
const RAGS = ['grey', 'green', 'amber', 'red'];

const SCHEDULE_STATUSES = ['planned', 'on_track', 'at_risk', 'overdue', 'done'];

const ISQM_OBJECTIVES = [
  { value: 'governance_leadership',     label: 'Governance & leadership' },
  { value: 'ethics',                    label: 'Relevant ethical requirements' },
  { value: 'acceptance_continuance',    label: 'Acceptance & continuance' },
  { value: 'engagement_performance',    label: 'Engagement performance' },
  { value: 'resources',                 label: 'Resources (people, technology, IP)' },
  { value: 'information_communication', label: 'Information & communication' },
  { value: 'monitoring_remediation',    label: 'Monitoring & remediation' },
  { value: 'risk_assessment',           label: 'Risk assessment process' },
];

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

/* ------------------------------------------------------------------ */
/* Shared row types                                                    */
/* ------------------------------------------------------------------ */

type Row = Record<string, unknown> & { id: string };

interface ApiHook<T extends Row> {
  items: T[];
  loading: boolean;
  error: string | null;
  load: () => Promise<void>;
  create: (body: Partial<T>) => Promise<boolean>;
  update: (body: Partial<T> & { id: string }) => Promise<boolean>;
  remove: (id: string) => Promise<boolean>;
  put?: (body: Partial<T>) => Promise<boolean>;
}

function useApi<T extends Row>(endpoint: string, options?: { putOnly?: boolean }): ApiHook<T> {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(endpoint);
      if (!res.ok) throw new Error(`Load failed (${res.status})`);
      const json = await res.json();
      setItems((json.items as T[]) || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Load failed');
    } finally {
      setLoading(false);
    }
  }, [endpoint]);

  useEffect(() => { load(); }, [load]);

  async function call(method: string, body?: unknown, qs?: string): Promise<boolean> {
    setError(null);
    try {
      const res = await fetch(endpoint + (qs || ''), {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.error || `${method} failed (${res.status})`);
      }
      await load();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : `${method} failed`);
      return false;
    }
  }

  return {
    items,
    loading,
    error,
    load,
    create: (body) => call('POST', body),
    update: (body) => call('PATCH', body),
    remove: (id) => call('DELETE', undefined, `?id=${encodeURIComponent(id)}`),
    put: options?.putOnly ? (body) => call('PUT', body) : undefined,
  };
}

/* ------------------------------------------------------------------ */
/* Small primitives                                                    */
/* ------------------------------------------------------------------ */

function Field({ label, children, hint, required }: { label: string; children: React.ReactNode; hint?: string; required?: boolean }) {
  return (
    <label className="block">
      <span className="text-[11px] font-semibold text-slate-600 uppercase tracking-wide">
        {label}{required ? ' *' : ''}
      </span>
      <div className="mt-1">{children}</div>
      {hint && <span className="text-[10px] text-slate-400">{hint}</span>}
    </label>
  );
}

const inputCls = 'w-full text-sm border border-slate-300 rounded px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent';
const btnPrimary = 'inline-flex items-center gap-1 text-xs px-3 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed';
const btnSecondary = 'inline-flex items-center gap-1 text-xs px-3 py-1.5 bg-white border border-slate-200 rounded-md hover:bg-slate-50';
const btnDanger = 'inline-flex items-center gap-1 text-xs px-2 py-1 text-rose-600 hover:bg-rose-50 rounded';

function Toolbar({ onAdd, addLabel, onRefresh, error, refreshing }: { onAdd?: () => void; addLabel?: string; onRefresh: () => void; error: string | null; refreshing: boolean }) {
  return (
    <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
      <div className="flex-1">
        {error && (
          <div className="inline-flex items-center gap-1.5 text-[11px] px-2 py-1 bg-rose-50 text-rose-700 border border-rose-200 rounded">
            <AlertCircle className="h-3 w-3" /> {error}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2">
        <button onClick={onRefresh} className={btnSecondary} disabled={refreshing}>
          {refreshing ? <Loader2 className="h-3 w-3 animate-spin" /> : null} Refresh
        </button>
        {onAdd && (
          <button onClick={onAdd} className={btnPrimary}>
            <Plus className="h-3 w-3" /> {addLabel || 'Add'}
          </button>
        )}
      </div>
    </div>
  );
}

function isoDate(d: Date | string | null | undefined): string {
  if (!d) return '';
  const dt = typeof d === 'string' ? new Date(d) : d;
  if (isNaN(dt.getTime())) return '';
  return dt.toISOString().split('T')[0];
}

function ConfirmInline({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="flex items-center gap-1">
      <button onClick={onConfirm} className="text-[10px] px-1.5 py-0.5 bg-rose-600 text-white rounded">Delete</button>
      <button onClick={onCancel} className="text-[10px] px-1.5 py-0.5 bg-white border border-slate-200 rounded">Cancel</button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tab: Monitoring activities                                          */
/* ------------------------------------------------------------------ */

type MonitoringRow = Row & {
  activityType: string;
  engagementName: string | null;
  responsibleIndividualName: string | null;
  managerName: string | null;
  reviewerName: string | null;
  plannedDate: string | null;
  completedDate: string | null;
  status: string;
  outcomeRating: string | null;
  qualityScore: number | null;
  findingsCount: number;
  notes: string | null;
};

function MonitoringTab() {
  const api = useApi<MonitoringRow>('/api/methodology-admin/performance-dashboard/monitoring-activities');
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Partial<MonitoringRow>>({ activityType: 'cold', status: 'planned' });
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Partial<MonitoringRow>>({});

  function startEdit(row: MonitoringRow) {
    setEditId(row.id);
    setEditDraft({ ...row });
  }
  async function save() {
    const ok = await api.create(draft);
    if (ok) { setDraft({ activityType: 'cold', status: 'planned' }); setAdding(false); }
  }
  async function saveEdit() {
    if (!editId) return;
    const ok = await api.update({ ...editDraft, id: editId });
    if (ok) { setEditId(null); setEditDraft({}); }
  }

  return (
    <div>
      <Toolbar onRefresh={api.load} error={api.error} refreshing={api.loading} onAdd={() => setAdding(true)} addLabel="Add monitoring activity" />

      {adding && (
        <div className="mb-4 border border-blue-200 bg-blue-50/40 rounded-lg p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Field label="Activity type" required>
              <select className={inputCls} value={draft.activityType || ''} onChange={(e) => setDraft({ ...draft, activityType: e.target.value })}>
                {ACTIVITY_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </Field>
            <Field label="Engagement name">
              <input className={inputCls} value={draft.engagementName || ''} onChange={(e) => setDraft({ ...draft, engagementName: e.target.value })} placeholder="e.g. ABC Ltd 2026 audit" />
            </Field>
            <Field label="Status">
              <select className={inputCls} value={draft.status || 'planned'} onChange={(e) => setDraft({ ...draft, status: e.target.value })}>
                {ACTIVITY_STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
              </select>
            </Field>
            <Field label="Responsible Individual (RI)">
              <input className={inputCls} value={draft.responsibleIndividualName || ''} onChange={(e) => setDraft({ ...draft, responsibleIndividualName: e.target.value })} />
            </Field>
            <Field label="Manager">
              <input className={inputCls} value={draft.managerName || ''} onChange={(e) => setDraft({ ...draft, managerName: e.target.value })} />
            </Field>
            <Field label="Reviewer">
              <input className={inputCls} value={draft.reviewerName || ''} onChange={(e) => setDraft({ ...draft, reviewerName: e.target.value })} />
            </Field>
            <Field label="Planned date">
              <input type="date" className={inputCls} value={isoDate(draft.plannedDate)} onChange={(e) => setDraft({ ...draft, plannedDate: e.target.value || null })} />
            </Field>
            <Field label="Completed date">
              <input type="date" className={inputCls} value={isoDate(draft.completedDate)} onChange={(e) => setDraft({ ...draft, completedDate: e.target.value || null })} />
            </Field>
            <Field label="Outcome rating">
              <select className={inputCls} value={draft.outcomeRating || ''} onChange={(e) => setDraft({ ...draft, outcomeRating: e.target.value || null })}>
                {OUTCOMES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
            <Field label="Quality score (0-100)" hint="Used to compute Audit Quality Score KPI">
              <input type="number" min={0} max={100} className={inputCls} value={draft.qualityScore ?? ''} onChange={(e) => setDraft({ ...draft, qualityScore: e.target.value ? Number(e.target.value) : null })} />
            </Field>
            <Field label="Findings count">
              <input type="number" min={0} className={inputCls} value={draft.findingsCount ?? 0} onChange={(e) => setDraft({ ...draft, findingsCount: Number(e.target.value) || 0 })} />
            </Field>
          </div>
          <Field label="Notes">
            <textarea className={inputCls} rows={2} value={draft.notes || ''} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
          </Field>
          <div className="flex justify-end gap-2">
            <button onClick={() => { setAdding(false); setDraft({ activityType: 'cold', status: 'planned' }); }} className={btnSecondary}><X className="h-3 w-3" /> Cancel</button>
            <button onClick={save} className={btnPrimary}><Save className="h-3 w-3" /> Save activity</button>
          </div>
        </div>
      )}

      {api.items.length === 0 && !api.loading ? (
        <p className="text-sm text-slate-400 italic text-center py-8">No monitoring activities logged yet.</p>
      ) : (
        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr className="text-[10px] text-slate-500 uppercase font-semibold">
                <th className="px-3 py-2 text-left">Type / Engagement</th>
                <th className="px-2 py-2 text-left">RI / Manager</th>
                <th className="px-2 py-2 text-left w-24">Planned</th>
                <th className="px-2 py-2 text-left w-24">Completed</th>
                <th className="px-2 py-2 text-left w-28">Status</th>
                <th className="px-2 py-2 text-center w-16">Score</th>
                <th className="px-2 py-2 text-center w-20">Findings</th>
                <th className="px-2 py-2 text-right w-32"></th>
              </tr>
            </thead>
            <tbody>
              {api.items.map(row => {
                const isEditing = editId === row.id;
                if (isEditing) {
                  return (
                    <tr key={row.id} className="bg-blue-50/30 border-b border-slate-100">
                      <td className="px-2 py-1.5">
                        <select className={inputCls} value={editDraft.activityType || row.activityType} onChange={(e) => setEditDraft({ ...editDraft, activityType: e.target.value })}>
                          {ACTIVITY_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                        </select>
                        <input className={`${inputCls} mt-1`} placeholder="Engagement" value={editDraft.engagementName ?? row.engagementName ?? ''} onChange={(e) => setEditDraft({ ...editDraft, engagementName: e.target.value })} />
                      </td>
                      <td className="px-2 py-1.5">
                        <input className={inputCls} placeholder="RI" value={editDraft.responsibleIndividualName ?? row.responsibleIndividualName ?? ''} onChange={(e) => setEditDraft({ ...editDraft, responsibleIndividualName: e.target.value })} />
                        <input className={`${inputCls} mt-1`} placeholder="Manager" value={editDraft.managerName ?? row.managerName ?? ''} onChange={(e) => setEditDraft({ ...editDraft, managerName: e.target.value })} />
                      </td>
                      <td className="px-2 py-1.5"><input type="date" className={inputCls} value={isoDate(editDraft.plannedDate ?? row.plannedDate)} onChange={(e) => setEditDraft({ ...editDraft, plannedDate: e.target.value || null })} /></td>
                      <td className="px-2 py-1.5"><input type="date" className={inputCls} value={isoDate(editDraft.completedDate ?? row.completedDate)} onChange={(e) => setEditDraft({ ...editDraft, completedDate: e.target.value || null })} /></td>
                      <td className="px-2 py-1.5">
                        <select className={inputCls} value={editDraft.status ?? row.status} onChange={(e) => setEditDraft({ ...editDraft, status: e.target.value })}>
                          {ACTIVITY_STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                        </select>
                      </td>
                      <td className="px-2 py-1.5"><input type="number" min={0} max={100} className={inputCls} value={editDraft.qualityScore ?? row.qualityScore ?? ''} onChange={(e) => setEditDraft({ ...editDraft, qualityScore: e.target.value ? Number(e.target.value) : null })} /></td>
                      <td className="px-2 py-1.5"><input type="number" min={0} className={inputCls} value={editDraft.findingsCount ?? row.findingsCount} onChange={(e) => setEditDraft({ ...editDraft, findingsCount: Number(e.target.value) || 0 })} /></td>
                      <td className="px-2 py-1.5 text-right">
                        <button onClick={saveEdit} className={btnPrimary}><Save className="h-3 w-3" /></button>
                        <button onClick={() => { setEditId(null); setEditDraft({}); }} className={btnSecondary + ' ml-1'}><X className="h-3 w-3" /></button>
                      </td>
                    </tr>
                  );
                }
                return (
                  <tr key={row.id} className="border-b border-slate-100 hover:bg-slate-50/50">
                    <td className="px-3 py-2">
                      <div className="font-medium text-slate-700">{ACTIVITY_TYPES.find(t => t.value === row.activityType)?.label || row.activityType}</div>
                      {row.engagementName && <div className="text-[11px] text-slate-500">{row.engagementName}</div>}
                    </td>
                    <td className="px-2 py-2">
                      {row.responsibleIndividualName && <div className="text-slate-700">{row.responsibleIndividualName}</div>}
                      {row.managerName && <div className="text-[11px] text-slate-500">{row.managerName}</div>}
                    </td>
                    <td className="px-2 py-2 text-slate-600">{row.plannedDate ? new Date(row.plannedDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }) : '—'}</td>
                    <td className="px-2 py-2 text-slate-600">{row.completedDate ? new Date(row.completedDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }) : '—'}</td>
                    <td className="px-2 py-2"><span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600">{row.status.replace('_', ' ')}</span></td>
                    <td className="px-2 py-2 text-center">{row.qualityScore ?? <span className="text-slate-300">—</span>}</td>
                    <td className="px-2 py-2 text-center">{row.findingsCount}</td>
                    <td className="px-2 py-2 text-right">
                      {confirmId === row.id ? (
                        <ConfirmInline onConfirm={async () => { await api.remove(row.id); setConfirmId(null); }} onCancel={() => setConfirmId(null)} />
                      ) : (
                        <>
                          <button onClick={() => startEdit(row)} className="text-blue-600 hover:underline text-[11px] mr-2">Edit</button>
                          <button onClick={() => setConfirmId(row.id)} className={btnDanger}><Trash2 className="h-3 w-3" /></button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tab: Findings                                                       */
/* ------------------------------------------------------------------ */

type FindingRow = Row & {
  activityId: string | null;
  title: string;
  description: string | null;
  rootCauseCategory: string | null;
  severity: string;
  raisedDate: string;
  rcaCompletedDate: string | null;
  closedDate: string | null;
  status: string;
};

function FindingsTab() {
  const api = useApi<FindingRow>('/api/methodology-admin/performance-dashboard/findings');
  const activitiesApi = useApi<MonitoringRow>('/api/methodology-admin/performance-dashboard/monitoring-activities');
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Partial<FindingRow>>({ severity: 'medium', status: 'open' });
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Partial<FindingRow>>({});

  async function save() {
    const ok = await api.create(draft);
    if (ok) { setDraft({ severity: 'medium', status: 'open' }); setAdding(false); }
  }
  async function saveEdit() {
    if (!editId) return;
    const ok = await api.update({ ...editDraft, id: editId });
    if (ok) { setEditId(null); setEditDraft({}); }
  }

  return (
    <div>
      <Toolbar onRefresh={api.load} error={api.error} refreshing={api.loading} onAdd={() => setAdding(true)} addLabel="Add finding" />

      {adding && (
        <div className="mb-4 border border-blue-200 bg-blue-50/40 rounded-lg p-4 space-y-3">
          <Field label="Title" required>
            <input className={inputCls} value={draft.title || ''} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="Short summary of the finding" />
          </Field>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Field label="Linked monitoring activity">
              <select className={inputCls} value={draft.activityId || ''} onChange={(e) => setDraft({ ...draft, activityId: e.target.value || null })}>
                <option value="">— none —</option>
                {activitiesApi.items.map(a => (
                  <option key={a.id} value={a.id}>
                    {ACTIVITY_TYPES.find(t => t.value === a.activityType)?.label || a.activityType} — {a.engagementName || a.id.slice(0, 8)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Severity">
              <select className={inputCls} value={draft.severity || 'medium'} onChange={(e) => setDraft({ ...draft, severity: e.target.value })}>
                {SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Status">
              <select className={inputCls} value={draft.status || 'open'} onChange={(e) => setDraft({ ...draft, status: e.target.value })}>
                {FINDING_STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
              </select>
            </Field>
            <Field label="Root cause category" hint="Set after RCA">
              <select className={inputCls} value={draft.rootCauseCategory || ''} onChange={(e) => setDraft({ ...draft, rootCauseCategory: e.target.value || null })}>
                {ROOT_CAUSES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </Field>
            <Field label="Raised date">
              <input type="date" className={inputCls} value={isoDate(draft.raisedDate)} onChange={(e) => setDraft({ ...draft, raisedDate: e.target.value })} />
            </Field>
            <Field label="RCA completed">
              <input type="date" className={inputCls} value={isoDate(draft.rcaCompletedDate)} onChange={(e) => setDraft({ ...draft, rcaCompletedDate: e.target.value || null })} />
            </Field>
            <Field label="Closed date">
              <input type="date" className={inputCls} value={isoDate(draft.closedDate)} onChange={(e) => setDraft({ ...draft, closedDate: e.target.value || null })} />
            </Field>
          </div>
          <Field label="Description">
            <textarea className={inputCls} rows={3} value={draft.description || ''} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
          </Field>
          <div className="flex justify-end gap-2">
            <button onClick={() => setAdding(false)} className={btnSecondary}><X className="h-3 w-3" /> Cancel</button>
            <button onClick={save} className={btnPrimary}><Save className="h-3 w-3" /> Save finding</button>
          </div>
        </div>
      )}

      {api.items.length === 0 && !api.loading ? (
        <p className="text-sm text-slate-400 italic text-center py-8">No findings recorded yet.</p>
      ) : (
        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr className="text-[10px] text-slate-500 uppercase font-semibold">
                <th className="px-3 py-2 text-left">Finding</th>
                <th className="px-2 py-2 text-left w-32">Root cause</th>
                <th className="px-2 py-2 text-left w-20">Severity</th>
                <th className="px-2 py-2 text-left w-24">Raised</th>
                <th className="px-2 py-2 text-left w-28">Status</th>
                <th className="px-2 py-2 text-right w-32"></th>
              </tr>
            </thead>
            <tbody>
              {api.items.map(row => {
                if (editId === row.id) {
                  return (
                    <tr key={row.id} className="bg-blue-50/30 border-b border-slate-100">
                      <td className="px-2 py-1.5"><input className={inputCls} value={editDraft.title ?? row.title} onChange={(e) => setEditDraft({ ...editDraft, title: e.target.value })} /></td>
                      <td className="px-2 py-1.5">
                        <select className={inputCls} value={editDraft.rootCauseCategory ?? row.rootCauseCategory ?? ''} onChange={(e) => setEditDraft({ ...editDraft, rootCauseCategory: e.target.value || null })}>
                          {ROOT_CAUSES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                        </select>
                      </td>
                      <td className="px-2 py-1.5">
                        <select className={inputCls} value={editDraft.severity ?? row.severity} onChange={(e) => setEditDraft({ ...editDraft, severity: e.target.value })}>
                          {SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </td>
                      <td className="px-2 py-1.5"><input type="date" className={inputCls} value={isoDate(editDraft.raisedDate ?? row.raisedDate)} onChange={(e) => setEditDraft({ ...editDraft, raisedDate: e.target.value })} /></td>
                      <td className="px-2 py-1.5">
                        <select className={inputCls} value={editDraft.status ?? row.status} onChange={(e) => setEditDraft({ ...editDraft, status: e.target.value })}>
                          {FINDING_STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                        </select>
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <button onClick={saveEdit} className={btnPrimary}><Save className="h-3 w-3" /></button>
                        <button onClick={() => { setEditId(null); setEditDraft({}); }} className={btnSecondary + ' ml-1'}><X className="h-3 w-3" /></button>
                      </td>
                    </tr>
                  );
                }
                return (
                  <tr key={row.id} className="border-b border-slate-100 hover:bg-slate-50/50">
                    <td className="px-3 py-2">
                      <div className="font-medium text-slate-700">{row.title}</div>
                      {row.description && <div className="text-[11px] text-slate-500 line-clamp-2">{row.description}</div>}
                    </td>
                    <td className="px-2 py-2 text-slate-600">{ROOT_CAUSES.find(r => r.value === row.rootCauseCategory)?.label || <span className="text-slate-300">—</span>}</td>
                    <td className="px-2 py-2 text-slate-600">{row.severity}</td>
                    <td className="px-2 py-2 text-slate-600">{new Date(row.raisedDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })}</td>
                    <td className="px-2 py-2"><span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600">{row.status.replace('_', ' ')}</span></td>
                    <td className="px-2 py-2 text-right">
                      {confirmId === row.id ? (
                        <ConfirmInline onConfirm={async () => { await api.remove(row.id); setConfirmId(null); }} onCancel={() => setConfirmId(null)} />
                      ) : (
                        <>
                          <button onClick={() => { setEditId(row.id); setEditDraft({ ...row }); }} className="text-blue-600 hover:underline text-[11px] mr-2">Edit</button>
                          <button onClick={() => setConfirmId(row.id)} className={btnDanger}><Trash2 className="h-3 w-3" /></button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tab: Remediations                                                   */
/* ------------------------------------------------------------------ */

type RemediationRow = Row & {
  findingId: string;
  description: string;
  ownerName: string | null;
  dueDate: string | null;
  status: string;
  retestedDate: string | null;
  effective: boolean | null;
  finding?: { id: string; title: string };
};

function RemediationsTab() {
  const api = useApi<RemediationRow>('/api/methodology-admin/performance-dashboard/remediations');
  const findingsApi = useApi<FindingRow>('/api/methodology-admin/performance-dashboard/findings');
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Partial<RemediationRow>>({ status: 'not_started' });
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Partial<RemediationRow>>({});

  async function save() {
    const ok = await api.create(draft);
    if (ok) { setDraft({ status: 'not_started' }); setAdding(false); }
  }

  return (
    <div>
      <Toolbar onRefresh={api.load} error={api.error} refreshing={api.loading} onAdd={() => setAdding(true)} addLabel="Add remediation" />

      {findingsApi.items.length === 0 && !findingsApi.loading && (
        <div className="mb-4 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
          You need at least one finding before you can add a remediation. Switch to the Findings tab first.
        </div>
      )}

      {adding && (
        <div className="mb-4 border border-blue-200 bg-blue-50/40 rounded-lg p-4 space-y-3">
          <Field label="Linked finding" required>
            <select className={inputCls} value={draft.findingId || ''} onChange={(e) => setDraft({ ...draft, findingId: e.target.value })}>
              <option value="">— select a finding —</option>
              {findingsApi.items.map(f => <option key={f.id} value={f.id}>{f.title}</option>)}
            </select>
          </Field>
          <Field label="Action description" required>
            <textarea className={inputCls} rows={2} value={draft.description || ''} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="What will change to prevent reoccurrence" />
          </Field>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Field label="Owner">
              <input className={inputCls} value={draft.ownerName || ''} onChange={(e) => setDraft({ ...draft, ownerName: e.target.value })} />
            </Field>
            <Field label="Due date">
              <input type="date" className={inputCls} value={isoDate(draft.dueDate)} onChange={(e) => setDraft({ ...draft, dueDate: e.target.value || null })} />
            </Field>
            <Field label="Status">
              <select className={inputCls} value={draft.status || 'not_started'} onChange={(e) => setDraft({ ...draft, status: e.target.value })}>
                {REMEDIATION_STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
              </select>
            </Field>
            <Field label="Re-tested date">
              <input type="date" className={inputCls} value={isoDate(draft.retestedDate)} onChange={(e) => setDraft({ ...draft, retestedDate: e.target.value || null })} />
            </Field>
            <Field label="Effective at re-test">
              <select className={inputCls} value={draft.effective === null || draft.effective === undefined ? '' : String(draft.effective)} onChange={(e) => setDraft({ ...draft, effective: e.target.value === '' ? null : e.target.value === 'true' })}>
                <option value="">— not yet re-tested —</option>
                <option value="true">Yes — issue did not reoccur</option>
                <option value="false">No — issue reoccurred</option>
              </select>
            </Field>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setAdding(false)} className={btnSecondary}><X className="h-3 w-3" /> Cancel</button>
            <button onClick={save} className={btnPrimary} disabled={!draft.findingId || !draft.description}><Save className="h-3 w-3" /> Save remediation</button>
          </div>
        </div>
      )}

      {api.items.length === 0 && !api.loading ? (
        <p className="text-sm text-slate-400 italic text-center py-8">No remediations recorded yet.</p>
      ) : (
        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr className="text-[10px] text-slate-500 uppercase font-semibold">
                <th className="px-3 py-2 text-left">Action / Finding</th>
                <th className="px-2 py-2 text-left w-24">Owner</th>
                <th className="px-2 py-2 text-left w-24">Due</th>
                <th className="px-2 py-2 text-left w-28">Status</th>
                <th className="px-2 py-2 text-center w-24">Effective</th>
                <th className="px-2 py-2 text-right w-32"></th>
              </tr>
            </thead>
            <tbody>
              {api.items.map(row => {
                if (editId === row.id) {
                  return (
                    <tr key={row.id} className="bg-blue-50/30 border-b border-slate-100">
                      <td className="px-2 py-1.5"><textarea className={inputCls} rows={2} value={editDraft.description ?? row.description} onChange={(e) => setEditDraft({ ...editDraft, description: e.target.value })} /></td>
                      <td className="px-2 py-1.5"><input className={inputCls} value={editDraft.ownerName ?? row.ownerName ?? ''} onChange={(e) => setEditDraft({ ...editDraft, ownerName: e.target.value })} /></td>
                      <td className="px-2 py-1.5"><input type="date" className={inputCls} value={isoDate(editDraft.dueDate ?? row.dueDate)} onChange={(e) => setEditDraft({ ...editDraft, dueDate: e.target.value || null })} /></td>
                      <td className="px-2 py-1.5">
                        <select className={inputCls} value={editDraft.status ?? row.status} onChange={(e) => setEditDraft({ ...editDraft, status: e.target.value })}>
                          {REMEDIATION_STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                        </select>
                      </td>
                      <td className="px-2 py-1.5">
                        <select className={inputCls} value={editDraft.effective === undefined ? (row.effective === null ? '' : String(row.effective)) : (editDraft.effective === null ? '' : String(editDraft.effective))} onChange={(e) => setEditDraft({ ...editDraft, effective: e.target.value === '' ? null : e.target.value === 'true' })}>
                          <option value="">—</option>
                          <option value="true">Effective</option>
                          <option value="false">Not effective</option>
                        </select>
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <button onClick={async () => { const ok = await api.update({ ...editDraft, id: editId }); if (ok) { setEditId(null); setEditDraft({}); } }} className={btnPrimary}><Save className="h-3 w-3" /></button>
                        <button onClick={() => { setEditId(null); setEditDraft({}); }} className={btnSecondary + ' ml-1'}><X className="h-3 w-3" /></button>
                      </td>
                    </tr>
                  );
                }
                return (
                  <tr key={row.id} className="border-b border-slate-100 hover:bg-slate-50/50">
                    <td className="px-3 py-2">
                      <div className="text-slate-700">{row.description}</div>
                      {row.finding && <div className="text-[11px] text-slate-500">→ {row.finding.title}</div>}
                    </td>
                    <td className="px-2 py-2 text-slate-600">{row.ownerName || '—'}</td>
                    <td className="px-2 py-2 text-slate-600">{row.dueDate ? new Date(row.dueDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }) : '—'}</td>
                    <td className="px-2 py-2"><span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600">{row.status.replace('_', ' ')}</span></td>
                    <td className="px-2 py-2 text-center">
                      {row.effective === true && <CheckCircle2 className="h-4 w-4 text-emerald-600 mx-auto" />}
                      {row.effective === false && <AlertCircle className="h-4 w-4 text-rose-600 mx-auto" />}
                      {row.effective === null && <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-2 py-2 text-right">
                      {confirmId === row.id ? (
                        <ConfirmInline onConfirm={async () => { await api.remove(row.id); setConfirmId(null); }} onCancel={() => setConfirmId(null)} />
                      ) : (
                        <>
                          <button onClick={() => { setEditId(row.id); setEditDraft({ ...row }); }} className="text-blue-600 hover:underline text-[11px] mr-2">Edit</button>
                          <button onClick={() => setConfirmId(row.id)} className={btnDanger}><Trash2 className="h-3 w-3" /></button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tab: CSFs                                                           */
/* ------------------------------------------------------------------ */

type CsfRow = Row & {
  pillar: string;
  subComponent: string;
  name: string;
  targetMetric: string | null;
  currentMetric: string | null;
  rag: string;
  ownerName: string | null;
  reviewedDate: string | null;
  isActive: boolean;
};

function CsfsTab() {
  const api = useApi<CsfRow>('/api/methodology-admin/performance-dashboard/csfs');
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Partial<CsfRow>>({ pillar: 'goodwill', rag: 'grey', isActive: true });
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Partial<CsfRow>>({});

  async function save() {
    const ok = await api.create(draft);
    if (ok) { setDraft({ pillar: draft.pillar, rag: 'grey', isActive: true }); setAdding(false); }
  }

  const grouped = useMemo(() => {
    const out: Record<string, CsfRow[]> = {};
    api.items.forEach(c => { (out[c.pillar] = out[c.pillar] || []).push(c); });
    return out;
  }, [api.items]);

  return (
    <div>
      <Toolbar onRefresh={api.load} error={api.error} refreshing={api.loading} onAdd={() => setAdding(true)} addLabel="Add CSF" />

      {adding && (
        <div className="mb-4 border border-blue-200 bg-blue-50/40 rounded-lg p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Field label="Pillar" required>
              <select className={inputCls} value={draft.pillar || 'goodwill'} onChange={(e) => setDraft({ ...draft, pillar: e.target.value })}>
                {PILLARS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </Field>
            <Field label="Sub-component" required hint="e.g. Branding, Industry, People, Risks">
              <input className={inputCls} value={draft.subComponent || ''} onChange={(e) => setDraft({ ...draft, subComponent: e.target.value })} />
            </Field>
            <Field label="RAG">
              <select className={inputCls} value={draft.rag || 'grey'} onChange={(e) => setDraft({ ...draft, rag: e.target.value })}>
                {RAGS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </Field>
          </div>
          <Field label="CSF name" required>
            <input className={inputCls} value={draft.name || ''} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Avg revenue/hr at threshold" />
          </Field>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Field label="Target metric">
              <input className={inputCls} value={draft.targetMetric || ''} onChange={(e) => setDraft({ ...draft, targetMetric: e.target.value })} placeholder="e.g. £140/hr" />
            </Field>
            <Field label="Current metric">
              <input className={inputCls} value={draft.currentMetric || ''} onChange={(e) => setDraft({ ...draft, currentMetric: e.target.value })} placeholder="e.g. £128/hr" />
            </Field>
            <Field label="Owner">
              <input className={inputCls} value={draft.ownerName || ''} onChange={(e) => setDraft({ ...draft, ownerName: e.target.value })} />
            </Field>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setAdding(false)} className={btnSecondary}><X className="h-3 w-3" /> Cancel</button>
            <button onClick={save} className={btnPrimary} disabled={!draft.subComponent || !draft.name}><Save className="h-3 w-3" /> Save CSF</button>
          </div>
        </div>
      )}

      {api.items.length === 0 && !api.loading ? (
        <p className="text-sm text-slate-400 italic text-center py-8">No CSFs configured yet.</p>
      ) : (
        <div className="space-y-4">
          {PILLARS.map(p => {
            const list = grouped[p.value] || [];
            if (!list.length) return null;
            return (
              <div key={p.value}>
                <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wide mb-2">{p.label}</h3>
                <div className="border border-slate-200 rounded-lg overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr className="text-[10px] text-slate-500 uppercase font-semibold">
                        <th className="px-3 py-2 text-left w-32">Sub-component</th>
                        <th className="px-2 py-2 text-left">CSF</th>
                        <th className="px-2 py-2 text-left w-32">Target</th>
                        <th className="px-2 py-2 text-left w-32">Current</th>
                        <th className="px-2 py-2 text-left w-24">RAG</th>
                        <th className="px-2 py-2 text-left w-24">Owner</th>
                        <th className="px-2 py-2 text-right w-32"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.map(row => {
                        if (editId === row.id) {
                          return (
                            <tr key={row.id} className="bg-blue-50/30 border-b border-slate-100">
                              <td className="px-2 py-1.5"><input className={inputCls} value={editDraft.subComponent ?? row.subComponent} onChange={(e) => setEditDraft({ ...editDraft, subComponent: e.target.value })} /></td>
                              <td className="px-2 py-1.5"><input className={inputCls} value={editDraft.name ?? row.name} onChange={(e) => setEditDraft({ ...editDraft, name: e.target.value })} /></td>
                              <td className="px-2 py-1.5"><input className={inputCls} value={editDraft.targetMetric ?? row.targetMetric ?? ''} onChange={(e) => setEditDraft({ ...editDraft, targetMetric: e.target.value })} /></td>
                              <td className="px-2 py-1.5"><input className={inputCls} value={editDraft.currentMetric ?? row.currentMetric ?? ''} onChange={(e) => setEditDraft({ ...editDraft, currentMetric: e.target.value })} /></td>
                              <td className="px-2 py-1.5">
                                <select className={inputCls} value={editDraft.rag ?? row.rag} onChange={(e) => setEditDraft({ ...editDraft, rag: e.target.value })}>
                                  {RAGS.map(r => <option key={r} value={r}>{r}</option>)}
                                </select>
                              </td>
                              <td className="px-2 py-1.5"><input className={inputCls} value={editDraft.ownerName ?? row.ownerName ?? ''} onChange={(e) => setEditDraft({ ...editDraft, ownerName: e.target.value })} /></td>
                              <td className="px-2 py-1.5 text-right">
                                <button onClick={async () => { const ok = await api.update({ ...editDraft, id: editId }); if (ok) { setEditId(null); setEditDraft({}); } }} className={btnPrimary}><Save className="h-3 w-3" /></button>
                                <button onClick={() => { setEditId(null); setEditDraft({}); }} className={btnSecondary + ' ml-1'}><X className="h-3 w-3" /></button>
                              </td>
                            </tr>
                          );
                        }
                        const ragColor = row.rag === 'green' ? 'bg-emerald-500' : row.rag === 'amber' ? 'bg-amber-500' : row.rag === 'red' ? 'bg-rose-500' : 'bg-slate-400';
                        return (
                          <tr key={row.id} className="border-b border-slate-100 hover:bg-slate-50/50">
                            <td className="px-3 py-2 text-slate-600">{row.subComponent}</td>
                            <td className="px-2 py-2 text-slate-700 font-medium">{row.name}</td>
                            <td className="px-2 py-2 text-slate-600">{row.targetMetric || '—'}</td>
                            <td className="px-2 py-2 text-slate-600">{row.currentMetric || '—'}</td>
                            <td className="px-2 py-2"><span className="inline-flex items-center gap-1.5"><span className={`h-2 w-2 rounded-full ${ragColor}`} /> {row.rag}</span></td>
                            <td className="px-2 py-2 text-slate-600">{row.ownerName || '—'}</td>
                            <td className="px-2 py-2 text-right">
                              {confirmId === row.id ? (
                                <ConfirmInline onConfirm={async () => { await api.remove(row.id); setConfirmId(null); }} onCancel={() => setConfirmId(null)} />
                              ) : (
                                <>
                                  <button onClick={() => { setEditId(row.id); setEditDraft({ ...row }); }} className="text-blue-600 hover:underline text-[11px] mr-2">Edit</button>
                                  <button onClick={() => setConfirmId(row.id)} className={btnDanger}><Trash2 className="h-3 w-3" /></button>
                                </>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tab: People snapshots                                               */
/* ------------------------------------------------------------------ */

type PeopleRow = Row & {
  periodLabel: string;
  periodEnd: string;
  trainingEffectivenessPct: number | null;
  staffUtilisationPct: number | null;
  cultureSurveyScore: number | null;
  attritionPct: number | null;
};

function PeopleTab() {
  const api = useApi<PeopleRow>('/api/methodology-admin/performance-dashboard/people-snapshots');
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Partial<PeopleRow>>({});
  const [confirmId, setConfirmId] = useState<string | null>(null);

  async function save() {
    const ok = await api.create(draft);
    if (ok) { setDraft({}); setAdding(false); }
  }

  return (
    <div>
      <Toolbar onRefresh={api.load} error={api.error} refreshing={api.loading} onAdd={() => setAdding(true)} addLabel="Add snapshot" />

      {adding && (
        <div className="mb-4 border border-blue-200 bg-blue-50/40 rounded-lg p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Period label" required hint="e.g. Jul 2026, H1 2026">
              <input className={inputCls} value={draft.periodLabel || ''} onChange={(e) => setDraft({ ...draft, periodLabel: e.target.value })} />
            </Field>
            <Field label="Period end date" required>
              <input type="date" className={inputCls} value={isoDate(draft.periodEnd)} onChange={(e) => setDraft({ ...draft, periodEnd: e.target.value })} />
            </Field>
            <Field label="Training effectiveness %">
              <input type="number" min={0} max={100} step={0.1} className={inputCls} value={draft.trainingEffectivenessPct ?? ''} onChange={(e) => setDraft({ ...draft, trainingEffectivenessPct: e.target.value ? Number(e.target.value) : null })} />
            </Field>
            <Field label="Staff utilisation %">
              <input type="number" min={0} max={100} step={0.1} className={inputCls} value={draft.staffUtilisationPct ?? ''} onChange={(e) => setDraft({ ...draft, staffUtilisationPct: e.target.value ? Number(e.target.value) : null })} />
            </Field>
            <Field label="Culture survey score (0-5)">
              <input type="number" min={0} max={5} step={0.1} className={inputCls} value={draft.cultureSurveyScore ?? ''} onChange={(e) => setDraft({ ...draft, cultureSurveyScore: e.target.value ? Number(e.target.value) : null })} />
            </Field>
            <Field label="Annualised attrition %">
              <input type="number" min={0} max={100} step={0.1} className={inputCls} value={draft.attritionPct ?? ''} onChange={(e) => setDraft({ ...draft, attritionPct: e.target.value ? Number(e.target.value) : null })} />
            </Field>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setAdding(false)} className={btnSecondary}><X className="h-3 w-3" /> Cancel</button>
            <button onClick={save} className={btnPrimary} disabled={!draft.periodLabel || !draft.periodEnd}><Save className="h-3 w-3" /> Save snapshot</button>
          </div>
        </div>
      )}

      {api.items.length === 0 && !api.loading ? (
        <p className="text-sm text-slate-400 italic text-center py-8">No people snapshots recorded yet.</p>
      ) : (
        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr className="text-[10px] text-slate-500 uppercase font-semibold">
                <th className="px-3 py-2 text-left">Period</th>
                <th className="px-2 py-2 text-center w-24">Training</th>
                <th className="px-2 py-2 text-center w-24">Utilisation</th>
                <th className="px-2 py-2 text-center w-24">Culture /5</th>
                <th className="px-2 py-2 text-center w-24">Attrition</th>
                <th className="px-2 py-2 text-right w-20"></th>
              </tr>
            </thead>
            <tbody>
              {api.items.map(row => (
                <tr key={row.id} className="border-b border-slate-100 hover:bg-slate-50/50">
                  <td className="px-3 py-2 text-slate-700 font-medium">{row.periodLabel} <span className="text-[10px] text-slate-400 ml-1">({new Date(row.periodEnd).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })})</span></td>
                  <td className="px-2 py-2 text-center">{row.trainingEffectivenessPct !== null ? `${row.trainingEffectivenessPct}%` : '—'}</td>
                  <td className="px-2 py-2 text-center">{row.staffUtilisationPct !== null ? `${row.staffUtilisationPct}%` : '—'}</td>
                  <td className="px-2 py-2 text-center">{row.cultureSurveyScore !== null ? row.cultureSurveyScore : '—'}</td>
                  <td className="px-2 py-2 text-center">{row.attritionPct !== null ? `${row.attritionPct}%` : '—'}</td>
                  <td className="px-2 py-2 text-right">
                    {confirmId === row.id ? (
                      <ConfirmInline onConfirm={async () => { await api.remove(row.id); setConfirmId(null); }} onCancel={() => setConfirmId(null)} />
                    ) : (
                      <button onClick={() => setConfirmId(row.id)} className={btnDanger}><Trash2 className="h-3 w-3" /></button>
                    )}
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

/* ------------------------------------------------------------------ */
/* Tab: Activity schedule                                              */
/* ------------------------------------------------------------------ */

type ScheduleRow = Row & {
  year: number;
  monthIndex: number;
  activityName: string;
  status: string;
  ownerName: string | null;
  dueDate: string | null;
  completedDate: string | null;
};

function ScheduleTab() {
  const api = useApi<ScheduleRow>('/api/methodology-admin/performance-dashboard/activity-schedule');
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Partial<ScheduleRow>>({ year, monthIndex: 0, status: 'planned' });
  const [confirmId, setConfirmId] = useState<string | null>(null);

  async function save() {
    const ok = await api.create({ ...draft, year });
    if (ok) { setDraft({ year, monthIndex: 0, status: 'planned' }); setAdding(false); }
  }

  const yearItems = api.items.filter(i => i.year === year);

  return (
    <div>
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <div className="flex items-center gap-3">
          <label className="text-xs text-slate-600 inline-flex items-center gap-1">
            Year
            <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="text-xs border border-slate-200 rounded px-2 py-1 bg-white">
              {[year - 2, year - 1, year, year + 1, year + 2].map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </label>
          {api.error && <div className="inline-flex items-center gap-1.5 text-[11px] px-2 py-1 bg-rose-50 text-rose-700 border border-rose-200 rounded"><AlertCircle className="h-3 w-3" /> {api.error}</div>}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={api.load} className={btnSecondary} disabled={api.loading}>{api.loading ? <Loader2 className="h-3 w-3 animate-spin" /> : null} Refresh</button>
          <button onClick={() => setAdding(true)} className={btnPrimary}><Plus className="h-3 w-3" /> Add scheduled activity</button>
        </div>
      </div>

      {adding && (
        <div className="mb-4 border border-blue-200 bg-blue-50/40 rounded-lg p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Field label="Month" required>
              <select className={inputCls} value={draft.monthIndex ?? 0} onChange={(e) => setDraft({ ...draft, monthIndex: Number(e.target.value) })}>
                {MONTH_NAMES.map((m, i) => <option key={m} value={i}>{m}</option>)}
              </select>
            </Field>
            <Field label="Activity name" required>
              <input className={inputCls} value={draft.activityName || ''} onChange={(e) => setDraft({ ...draft, activityName: e.target.value })} placeholder="e.g. Cold file reviews" />
            </Field>
            <Field label="Status">
              <select className={inputCls} value={draft.status || 'planned'} onChange={(e) => setDraft({ ...draft, status: e.target.value })}>
                {SCHEDULE_STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
              </select>
            </Field>
            <Field label="Owner">
              <input className={inputCls} value={draft.ownerName || ''} onChange={(e) => setDraft({ ...draft, ownerName: e.target.value })} />
            </Field>
            <Field label="Due date">
              <input type="date" className={inputCls} value={isoDate(draft.dueDate)} onChange={(e) => setDraft({ ...draft, dueDate: e.target.value || null })} />
            </Field>
            <Field label="Completed date">
              <input type="date" className={inputCls} value={isoDate(draft.completedDate)} onChange={(e) => setDraft({ ...draft, completedDate: e.target.value || null })} />
            </Field>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setAdding(false)} className={btnSecondary}><X className="h-3 w-3" /> Cancel</button>
            <button onClick={save} className={btnPrimary} disabled={!draft.activityName}><Save className="h-3 w-3" /> Save activity</button>
          </div>
        </div>
      )}

      {yearItems.length === 0 && !api.loading ? (
        <p className="text-sm text-slate-400 italic text-center py-8">No scheduled activities for {year} yet.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {MONTH_NAMES.map((m, i) => {
            const list = yearItems.filter(it => it.monthIndex === i);
            return (
              <div key={m} className="border border-slate-200 rounded-lg overflow-hidden">
                <div className="px-3 py-1.5 bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-700">{m} {year}</div>
                <div className="p-2 space-y-1.5 min-h-[80px]">
                  {list.length === 0 ? (
                    <p className="text-[11px] text-slate-300 italic text-center py-2">No activities</p>
                  ) : list.map(it => {
                    const dot = it.status === 'done' ? 'bg-emerald-500' : it.status === 'on_track' ? 'bg-blue-500' : it.status === 'at_risk' ? 'bg-amber-500' : it.status === 'overdue' ? 'bg-rose-500' : 'bg-slate-400';
                    return (
                      <div key={it.id} className="flex items-start gap-2 text-[11px] group">
                        <span className={`mt-1 h-1.5 w-1.5 rounded-full flex-shrink-0 ${dot}`} />
                        <div className="flex-1 min-w-0">
                          <div className="text-slate-700">{it.activityName}</div>
                          {it.ownerName && <div className="text-[10px] text-slate-400">{it.ownerName}</div>}
                        </div>
                        {confirmId === it.id ? (
                          <div className="flex items-center gap-1">
                            <button onClick={async () => { await api.remove(it.id); setConfirmId(null); }} className="text-[10px] px-1 py-0.5 bg-rose-600 text-white rounded">Delete</button>
                            <button onClick={() => setConfirmId(null)} className="text-[10px] px-1 py-0.5 bg-white border rounded">×</button>
                          </div>
                        ) : (
                          <button onClick={() => setConfirmId(it.id)} className="text-slate-300 hover:text-rose-600 opacity-0 group-hover:opacity-100"><Trash2 className="h-3 w-3" /></button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tab: ISQM(UK)1 evidence                                             */
/* ------------------------------------------------------------------ */

type IsqmRow = Row & {
  objective: string;
  evidenceCount: number;
  targetCount: number;
  rag: string;
  ragManual: boolean;
  notes: string | null;
};

function IsqmTab() {
  const api = useApi<IsqmRow>('/api/methodology-admin/performance-dashboard/isqm-evidence', { putOnly: true });
  const [drafts, setDrafts] = useState<Record<string, Partial<IsqmRow>>>({});
  const [savingObjective, setSavingObjective] = useState<string | null>(null);

  function getValue<K extends keyof IsqmRow>(objective: string, key: K): IsqmRow[K] | undefined {
    const draft = drafts[objective];
    if (draft && key in draft) return draft[key as keyof typeof draft] as IsqmRow[K];
    const row = api.items.find(i => i.objective === objective);
    return row?.[key];
  }

  function setValue(objective: string, patch: Partial<IsqmRow>) {
    setDrafts({ ...drafts, [objective]: { ...drafts[objective], ...patch } });
  }

  async function saveObjective(objective: string) {
    setSavingObjective(objective);
    const row = api.items.find(i => i.objective === objective);
    const draft = drafts[objective] || {};
    const body = {
      objective,
      evidenceCount: draft.evidenceCount ?? row?.evidenceCount ?? 0,
      targetCount: draft.targetCount ?? row?.targetCount ?? 0,
      rag: draft.rag ?? row?.rag ?? 'grey',
      ragManual: draft.ragManual ?? row?.ragManual ?? false,
      notes: draft.notes ?? row?.notes ?? null,
    };
    if (api.put) await api.put(body);
    setDrafts({ ...drafts, [objective]: undefined as unknown as Partial<IsqmRow> });
    setSavingObjective(null);
  }

  return (
    <div>
      <Toolbar onRefresh={api.load} error={api.error} refreshing={api.loading} />
      <p className="text-xs text-slate-500 mb-3">
        Set evidence targets for each ISQM(UK)1 quality objective. RAG is auto-derived from evidence/target unless you override it.
      </p>
      <div className="space-y-2">
        {ISQM_OBJECTIVES.map(o => {
          const ev = getValue(o.value, 'evidenceCount') ?? 0;
          const tg = getValue(o.value, 'targetCount') ?? 0;
          const ragManual = getValue(o.value, 'ragManual') ?? false;
          const rag = getValue(o.value, 'rag') ?? 'grey';
          const notes = getValue(o.value, 'notes') ?? '';
          const isDirty = !!drafts[o.value];
          return (
            <div key={o.value} className="border border-slate-200 rounded-lg p-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="font-medium text-sm text-slate-800 flex-1 min-w-[200px]">{o.label}</div>
                <div className="flex items-center gap-2">
                  <label className="text-[11px] text-slate-500">Evidence</label>
                  <input type="number" min={0} className={`${inputCls} w-20`} value={ev} onChange={(e) => setValue(o.value, { evidenceCount: Number(e.target.value) || 0 })} />
                  <label className="text-[11px] text-slate-500">/ Target</label>
                  <input type="number" min={0} className={`${inputCls} w-20`} value={tg} onChange={(e) => setValue(o.value, { targetCount: Number(e.target.value) || 0 })} />
                  <label className="text-[11px] text-slate-500 inline-flex items-center gap-1">
                    <input type="checkbox" checked={ragManual} onChange={(e) => setValue(o.value, { ragManual: e.target.checked })} /> Manual RAG
                  </label>
                  {ragManual && (
                    <select className={`${inputCls} w-24`} value={rag} onChange={(e) => setValue(o.value, { rag: e.target.value })}>
                      {RAGS.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  )}
                  <button onClick={() => saveObjective(o.value)} className={btnPrimary} disabled={!isDirty || savingObjective === o.value}>
                    {savingObjective === o.value ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />} Save
                  </button>
                </div>
              </div>
              <input className={`${inputCls} mt-2`} placeholder="Notes (optional)" value={String(notes || '')} onChange={(e) => setValue(o.value, { notes: e.target.value })} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tab: Pillar overrides                                               */
/* ------------------------------------------------------------------ */

type PillarRow = Row & {
  pillar: string;
  manualScore: number | null;
  strapline: string | null;
};

function PillarsTab() {
  const api = useApi<PillarRow>('/api/methodology-admin/performance-dashboard/pillar-scores', { putOnly: true });
  const [drafts, setDrafts] = useState<Record<string, Partial<PillarRow>>>({});
  const [savingPillar, setSavingPillar] = useState<string | null>(null);

  function getValue<K extends keyof PillarRow>(pillar: string, key: K): PillarRow[K] | undefined {
    const draft = drafts[pillar];
    if (draft && key in draft) return draft[key as keyof typeof draft] as PillarRow[K];
    const row = api.items.find(i => i.pillar === pillar);
    return row?.[key];
  }

  function setValue(pillar: string, patch: Partial<PillarRow>) {
    setDrafts({ ...drafts, [pillar]: { ...drafts[pillar], ...patch } });
  }

  async function savePillar(pillar: string) {
    setSavingPillar(pillar);
    const row = api.items.find(i => i.pillar === pillar);
    const draft = drafts[pillar] || {};
    const body = {
      pillar,
      manualScore: draft.manualScore !== undefined ? draft.manualScore : row?.manualScore ?? null,
      strapline: draft.strapline !== undefined ? draft.strapline : row?.strapline ?? null,
    };
    if (api.put) await api.put(body);
    setDrafts({ ...drafts, [pillar]: undefined as unknown as Partial<PillarRow> });
    setSavingPillar(null);
  }

  return (
    <div>
      <Toolbar onRefresh={api.load} error={api.error} refreshing={api.loading} />
      <p className="text-xs text-slate-500 mb-3">
        By default each pillar score is auto-derived from CSF RAG mix. Override with a manual score (0-100) and a custom strapline if you want to publish a different headline.
      </p>
      <div className="space-y-2">
        {PILLARS.map(p => {
          const score = getValue(p.value, 'manualScore');
          const strapline = getValue(p.value, 'strapline');
          const isDirty = !!drafts[p.value];
          return (
            <div key={p.value} className="border border-slate-200 rounded-lg p-3 space-y-2">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="font-medium text-sm text-slate-800">{p.label}</div>
                <div className="flex items-center gap-2">
                  <label className="text-[11px] text-slate-500">Manual score (0-100)</label>
                  <input type="number" min={0} max={100} className={`${inputCls} w-24`} value={score ?? ''} placeholder="auto"
                         onChange={(e) => setValue(p.value, { manualScore: e.target.value === '' ? null : Number(e.target.value) })} />
                  <button onClick={() => savePillar(p.value)} className={btnPrimary} disabled={!isDirty || savingPillar === p.value}>
                    {savingPillar === p.value ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />} Save
                  </button>
                </div>
              </div>
              <input className={inputCls} placeholder={`Strapline for ${p.label}`} value={strapline || ''} onChange={(e) => setValue(p.value, { strapline: e.target.value })} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Container                                                           */
/* ------------------------------------------------------------------ */

export function PerformanceDashboardAdminClient() {
  const search = useSearchParams();
  const initialTab = (search.get('tab') as TabKey | null) || 'monitoring';
  const [tab, setTab] = useState<TabKey>(TABS.some(t => t.key === initialTab) ? initialTab : 'monitoring');

  return (
    <div className="space-y-4">
      <div className="border-b border-slate-200">
        <nav className="flex flex-wrap gap-1 -mb-px">
          {TABS.map(t => {
            const Icon = t.icon;
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
                  active
                    ? 'border-blue-600 text-blue-700'
                    : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                }`}
              >
                <Icon className="h-3.5 w-3.5" /> {t.label}
              </button>
            );
          })}
        </nav>
      </div>

      <div className="pt-2">
        {tab === 'monitoring' && <MonitoringTab />}
        {tab === 'findings' && <FindingsTab />}
        {tab === 'remediations' && <RemediationsTab />}
        {tab === 'csfs' && <CsfsTab />}
        {tab === 'people' && <PeopleTab />}
        {tab === 'schedule' && <ScheduleTab />}
        {tab === 'isqm' && <IsqmTab />}
        {tab === 'pillars' && <PillarsTab />}
      </div>
    </div>
  );
}
