'use client';

import { Fragment, useEffect, useMemo, useState, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  AlertCircle,
  Bot,
  Calendar,
  CheckCircle2,
  ClipboardCheck,
  Database,
  GraduationCap,
  Loader2,
  Megaphone,
  Plus,
  Save,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
  Trash2,
  X,
  XCircle,
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
  { key: 'ai',          label: 'AI Reliance',           icon: Bot },
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
/* Lightweight fetch hook for dropdown lookups (users, engagements)    */
/* ------------------------------------------------------------------ */

type FirmUser = { id: string; name: string; email: string; jobTitle: string | null; isActive: boolean };
type FirmEngagement = {
  id: string;
  auditType: string;
  status: string;
  client: { id: string; clientName: string };
  period: { id: string; endDate: string };
};

function useUsers() {
  const [users, setUsers] = useState<FirmUser[]>([]);
  useEffect(() => {
    fetch('/api/users')
      .then(r => r.ok ? r.json() : [])
      .then((data) => setUsers((Array.isArray(data) ? data : []).filter((u: FirmUser) => u.isActive !== false)))
      .catch(() => setUsers([]));
  }, []);
  return users;
}

function useEngagements() {
  const [engagements, setEngagements] = useState<FirmEngagement[]>([]);
  useEffect(() => {
    fetch('/api/engagements?limit=200')
      .then(r => r.ok ? r.json() : { engagements: [] })
      .then((data) => setEngagements(data?.engagements || []))
      .catch(() => setEngagements([]));
  }, []);
  return engagements;
}

function engagementLabel(e: FirmEngagement): string {
  const period = e.period?.endDate ? new Date(e.period.endDate).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) : '';
  return `${e.client?.clientName || 'Unknown'} — ${e.auditType}${period ? ` · ${period}` : ''}`;
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

function Toolbar({ onAdd, addLabel, onRefresh, error, refreshing, extra }: { onAdd?: () => void; addLabel?: string; onRefresh: () => void; error: string | null; refreshing: boolean; extra?: React.ReactNode }) {
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
        {extra}
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
/* Reusable user / engagement select inputs                            */
/* ------------------------------------------------------------------ */

function UserSelect({ users, value, onChange, placeholder }: { users: FirmUser[]; value: string | null | undefined; onChange: (name: string | null) => void; placeholder?: string }) {
  // value here is the *name* string (free-text legacy + name-based modelling)
  return (
    <select className={inputCls} value={value || ''} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">{placeholder || '— select —'}</option>
      {users.map(u => (
        <option key={u.id} value={u.name}>{u.name}{u.jobTitle ? ` · ${u.jobTitle}` : ''}</option>
      ))}
    </select>
  );
}

function EngagementSelect({ engagements, valueId, valueName, onChange, placeholder }: { engagements: FirmEngagement[]; valueId: string | null | undefined; valueName: string | null | undefined; onChange: (id: string | null, name: string | null) => void; placeholder?: string }) {
  // We keep both id and name in sync — name is denormalised onto the row for display when an engagement is later archived.
  return (
    <select
      className={inputCls}
      value={valueId || ''}
      onChange={(e) => {
        const id = e.target.value || null;
        const eng = engagements.find(x => x.id === id);
        onChange(id, eng ? engagementLabel(eng) : (id ? valueName ?? null : null));
      }}
    >
      <option value="">{placeholder || '— select engagement —'}</option>
      {engagements.map(e => (
        <option key={e.id} value={e.id}>{engagementLabel(e)}</option>
      ))}
      {/* If valueId references something not in the (capped) list, surface its name as a stub */}
      {valueId && !engagements.find(x => x.id === valueId) && valueName ? (
        <option value={valueId}>{valueName} (archived)</option>
      ) : null}
    </select>
  );
}

/* ------------------------------------------------------------------ */
/* Tab: Monitoring activities                                          */
/* ------------------------------------------------------------------ */

type MonitoringRow = Row & {
  activityType: string;
  engagementName: string | null;
  engagementId: string | null;
  responsibleIndividualName: string | null;
  managerName: string | null;
  reviewerName: string | null;
  plannedDate: string | null;
  startedDate: string | null;
  completedDate: string | null;
  status: string;
  outcomeRating: string | null;
  qualityScore: number | null;
  findingsCount: number;
  notes: string | null;
};

function MonitoringForm({ value, onChange, users, engagements }: { value: Partial<MonitoringRow>; onChange: (v: Partial<MonitoringRow>) => void; users: FirmUser[]; engagements: FirmEngagement[] }) {
  const set = (patch: Partial<MonitoringRow>) => onChange({ ...value, ...patch });
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Field label="Activity type" required>
          <select className={inputCls} value={value.activityType || 'cold'} onChange={(e) => set({ activityType: e.target.value })}>
            {ACTIVITY_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </Field>
        <div className="md:col-span-2">
          <Field label="Engagement">
            <EngagementSelect engagements={engagements} valueId={value.engagementId} valueName={value.engagementName} onChange={(id, name) => set({ engagementId: id, engagementName: name })} />
          </Field>
        </div>
        <Field label="Status">
          <select className={inputCls} value={value.status || 'planned'} onChange={(e) => set({ status: e.target.value })}>
            {ACTIVITY_STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
          </select>
        </Field>
        <Field label="Responsible Individual (RI)">
          <UserSelect users={users} value={value.responsibleIndividualName} onChange={(n) => set({ responsibleIndividualName: n })} placeholder="— select RI —" />
        </Field>
        <Field label="Manager">
          <UserSelect users={users} value={value.managerName} onChange={(n) => set({ managerName: n })} placeholder="— select manager —" />
        </Field>
        <Field label="Reviewer">
          <UserSelect users={users} value={value.reviewerName} onChange={(n) => set({ reviewerName: n })} placeholder="— select reviewer —" />
        </Field>
        <Field label="Planned date">
          <input type="date" className={inputCls} value={isoDate(value.plannedDate)} onChange={(e) => set({ plannedDate: e.target.value || null })} />
        </Field>
        <Field label="Started date">
          <input type="date" className={inputCls} value={isoDate(value.startedDate)} onChange={(e) => set({ startedDate: e.target.value || null })} />
        </Field>
        <Field label="Completed date">
          <input type="date" className={inputCls} value={isoDate(value.completedDate)} onChange={(e) => set({ completedDate: e.target.value || null })} />
        </Field>
        <Field label="Outcome rating">
          <select className={inputCls} value={value.outcomeRating || ''} onChange={(e) => set({ outcomeRating: e.target.value || null })}>
            {OUTCOMES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </Field>
        <Field label="Quality score (0-100)" hint="Used to compute Audit Quality Score KPI">
          <input type="number" min={0} max={100} className={inputCls} value={value.qualityScore ?? ''} onChange={(e) => set({ qualityScore: e.target.value ? Number(e.target.value) : null })} />
        </Field>
        <Field label="Findings count">
          <input type="number" min={0} className={inputCls} value={value.findingsCount ?? 0} onChange={(e) => set({ findingsCount: Number(e.target.value) || 0 })} />
        </Field>
      </div>
      <Field label="Notes">
        <textarea className={inputCls} rows={2} value={value.notes || ''} onChange={(e) => set({ notes: e.target.value })} />
      </Field>
    </div>
  );
}

function MonitoringTab() {
  const api = useApi<MonitoringRow>('/api/methodology-admin/performance-dashboard/monitoring-activities');
  const users = useUsers();
  const engagements = useEngagements();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Partial<MonitoringRow>>({ activityType: 'cold', status: 'planned' });
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Partial<MonitoringRow>>({});

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
        <div className="mb-4 border border-blue-200 bg-blue-50/40 rounded-lg p-4">
          <MonitoringForm value={draft} onChange={setDraft} users={users} engagements={engagements} />
          <div className="flex justify-end gap-2 mt-3">
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
              {api.items.map(row => (
                <Fragment key={row.id}>
                  <tr className="border-b border-slate-100 hover:bg-slate-50/50">
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
                          <button onClick={() => { setEditId(row.id === editId ? null : row.id); setEditDraft(row.id === editId ? {} : { ...row }); }} className="text-blue-600 hover:underline text-[11px] mr-2">{editId === row.id ? 'Close' : 'Edit'}</button>
                          <button onClick={() => setConfirmId(row.id)} className={btnDanger}><Trash2 className="h-3 w-3" /></button>
                        </>
                      )}
                    </td>
                  </tr>
                  {editId === row.id && (
                    <tr key={`${row.id}-edit`} className="bg-blue-50/30">
                      <td colSpan={8} className="p-4">
                        <MonitoringForm value={editDraft} onChange={setEditDraft} users={users} engagements={engagements} />
                        <div className="flex justify-end gap-2 mt-3">
                          <button onClick={() => { setEditId(null); setEditDraft({}); }} className={btnSecondary}><X className="h-3 w-3" /> Cancel</button>
                          <button onClick={saveEdit} className={btnPrimary}><Save className="h-3 w-3" /> Save changes</button>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
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
  notes: string | null;
};

function FindingForm({ value, onChange, activities }: { value: Partial<FindingRow>; onChange: (v: Partial<FindingRow>) => void; activities: MonitoringRow[] }) {
  const set = (patch: Partial<FindingRow>) => onChange({ ...value, ...patch });
  return (
    <div className="space-y-3">
      <Field label="Title" required>
        <input className={inputCls} value={value.title || ''} onChange={(e) => set({ title: e.target.value })} placeholder="Short summary of the finding" />
      </Field>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Field label="Linked monitoring activity">
          <select className={inputCls} value={value.activityId || ''} onChange={(e) => set({ activityId: e.target.value || null })}>
            <option value="">— none —</option>
            {activities.map(a => (
              <option key={a.id} value={a.id}>
                {ACTIVITY_TYPES.find(t => t.value === a.activityType)?.label || a.activityType} — {a.engagementName || a.id.slice(0, 8)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Severity">
          <select className={inputCls} value={value.severity || 'medium'} onChange={(e) => set({ severity: e.target.value })}>
            {SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Status">
          <select className={inputCls} value={value.status || 'open'} onChange={(e) => set({ status: e.target.value })}>
            {FINDING_STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
          </select>
        </Field>
        <Field label="Root cause category" hint="Set after RCA">
          <select className={inputCls} value={value.rootCauseCategory || ''} onChange={(e) => set({ rootCauseCategory: e.target.value || null })}>
            {ROOT_CAUSES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </Field>
        <Field label="Raised date">
          <input type="date" className={inputCls} value={isoDate(value.raisedDate)} onChange={(e) => set({ raisedDate: e.target.value })} />
        </Field>
        <Field label="RCA completed">
          <input type="date" className={inputCls} value={isoDate(value.rcaCompletedDate)} onChange={(e) => set({ rcaCompletedDate: e.target.value || null })} />
        </Field>
        <Field label="Closed date">
          <input type="date" className={inputCls} value={isoDate(value.closedDate)} onChange={(e) => set({ closedDate: e.target.value || null })} />
        </Field>
      </div>
      <Field label="Description">
        <textarea className={inputCls} rows={3} value={value.description || ''} onChange={(e) => set({ description: e.target.value })} />
      </Field>
      <Field label="Notes / RCA detail">
        <textarea className={inputCls} rows={3} value={value.notes || ''} onChange={(e) => set({ notes: e.target.value })} placeholder="Why did this happen? What process / supervision / data weakness sits behind it?" />
      </Field>
    </div>
  );
}

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
        <div className="mb-4 border border-blue-200 bg-blue-50/40 rounded-lg p-4">
          <FindingForm value={draft} onChange={setDraft} activities={activitiesApi.items} />
          <div className="flex justify-end gap-2 mt-3">
            <button onClick={() => setAdding(false)} className={btnSecondary}><X className="h-3 w-3" /> Cancel</button>
            <button onClick={save} className={btnPrimary} disabled={!draft.title}><Save className="h-3 w-3" /> Save finding</button>
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
              {api.items.map(row => (
                <Fragment key={row.id}>
                  <tr className="border-b border-slate-100 hover:bg-slate-50/50">
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
                          <button onClick={() => { setEditId(row.id === editId ? null : row.id); setEditDraft(row.id === editId ? {} : { ...row }); }} className="text-blue-600 hover:underline text-[11px] mr-2">{editId === row.id ? 'Close' : 'Edit'}</button>
                          <button onClick={() => setConfirmId(row.id)} className={btnDanger}><Trash2 className="h-3 w-3" /></button>
                        </>
                      )}
                    </td>
                  </tr>
                  {editId === row.id && (
                    <tr key={`${row.id}-edit`} className="bg-blue-50/30">
                      <td colSpan={6} className="p-4">
                        <FindingForm value={editDraft} onChange={setEditDraft} activities={activitiesApi.items} />
                        <div className="flex justify-end gap-2 mt-3">
                          <button onClick={() => { setEditId(null); setEditDraft({}); }} className={btnSecondary}><X className="h-3 w-3" /> Cancel</button>
                          <button onClick={saveEdit} className={btnPrimary}><Save className="h-3 w-3" /> Save changes</button>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
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
  notes: string | null;
  finding?: { id: string; title: string };
};

function RemediationForm({ value, onChange, findings, users, isEdit }: { value: Partial<RemediationRow>; onChange: (v: Partial<RemediationRow>) => void; findings: FindingRow[]; users: FirmUser[]; isEdit?: boolean }) {
  const set = (patch: Partial<RemediationRow>) => onChange({ ...value, ...patch });
  return (
    <div className="space-y-3">
      <Field label="Linked finding" required>
        <select className={inputCls} value={value.findingId || ''} onChange={(e) => set({ findingId: e.target.value })} disabled={isEdit}>
          <option value="">— select a finding —</option>
          {findings.map(f => <option key={f.id} value={f.id}>{f.title}</option>)}
        </select>
      </Field>
      <Field label="Action description" required>
        <textarea className={inputCls} rows={2} value={value.description || ''} onChange={(e) => set({ description: e.target.value })} placeholder="What will change to prevent reoccurrence" />
      </Field>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Field label="Owner">
          <UserSelect users={users} value={value.ownerName} onChange={(n) => set({ ownerName: n })} placeholder="— select owner —" />
        </Field>
        <Field label="Due date">
          <input type="date" className={inputCls} value={isoDate(value.dueDate)} onChange={(e) => set({ dueDate: e.target.value || null })} />
        </Field>
        <Field label="Status">
          <select className={inputCls} value={value.status || 'not_started'} onChange={(e) => set({ status: e.target.value })}>
            {REMEDIATION_STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
          </select>
        </Field>
        <Field label="Re-tested date">
          <input type="date" className={inputCls} value={isoDate(value.retestedDate)} onChange={(e) => set({ retestedDate: e.target.value || null })} />
        </Field>
        <Field label="Effective at re-test">
          <select className={inputCls} value={value.effective === null || value.effective === undefined ? '' : String(value.effective)} onChange={(e) => set({ effective: e.target.value === '' ? null : e.target.value === 'true' })}>
            <option value="">— not yet re-tested —</option>
            <option value="true">Yes — issue did not reoccur</option>
            <option value="false">No — issue reoccurred</option>
          </select>
        </Field>
      </div>
      <Field label="Notes">
        <textarea className={inputCls} rows={2} value={value.notes || ''} onChange={(e) => set({ notes: e.target.value })} />
      </Field>
    </div>
  );
}

function RemediationsTab() {
  const api = useApi<RemediationRow>('/api/methodology-admin/performance-dashboard/remediations');
  const findingsApi = useApi<FindingRow>('/api/methodology-admin/performance-dashboard/findings');
  const users = useUsers();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Partial<RemediationRow>>({ status: 'not_started' });
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Partial<RemediationRow>>({});

  async function save() {
    const ok = await api.create(draft);
    if (ok) { setDraft({ status: 'not_started' }); setAdding(false); }
  }
  async function saveEdit() {
    if (!editId) return;
    const ok = await api.update({ ...editDraft, id: editId });
    if (ok) { setEditId(null); setEditDraft({}); }
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
        <div className="mb-4 border border-blue-200 bg-blue-50/40 rounded-lg p-4">
          <RemediationForm value={draft} onChange={setDraft} findings={findingsApi.items} users={users} />
          <div className="flex justify-end gap-2 mt-3">
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
              {api.items.map(row => (
                <Fragment key={row.id}>
                  <tr className="border-b border-slate-100 hover:bg-slate-50/50">
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
                          <button onClick={() => { setEditId(row.id === editId ? null : row.id); setEditDraft(row.id === editId ? {} : { ...row }); }} className="text-blue-600 hover:underline text-[11px] mr-2">{editId === row.id ? 'Close' : 'Edit'}</button>
                          <button onClick={() => setConfirmId(row.id)} className={btnDanger}><Trash2 className="h-3 w-3" /></button>
                        </>
                      )}
                    </td>
                  </tr>
                  {editId === row.id && (
                    <tr key={`${row.id}-edit`} className="bg-blue-50/30">
                      <td colSpan={6} className="p-4">
                        <RemediationForm value={editDraft} onChange={setEditDraft} findings={findingsApi.items} users={users} isEdit />
                        <div className="flex justify-end gap-2 mt-3">
                          <button onClick={() => { setEditId(null); setEditDraft({}); }} className={btnSecondary}><X className="h-3 w-3" /> Cancel</button>
                          <button onClick={saveEdit} className={btnPrimary}><Save className="h-3 w-3" /> Save changes</button>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
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
  notes: string | null;
  isActive: boolean;
};

function CsfForm({ value, onChange, users }: { value: Partial<CsfRow>; onChange: (v: Partial<CsfRow>) => void; users: FirmUser[] }) {
  const set = (patch: Partial<CsfRow>) => onChange({ ...value, ...patch });
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Field label="Pillar" required>
          <select className={inputCls} value={value.pillar || 'goodwill'} onChange={(e) => set({ pillar: e.target.value })}>
            {PILLARS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </Field>
        <Field label="Sub-component" required hint="e.g. Branding, Industry, People, Risks">
          <input className={inputCls} value={value.subComponent || ''} onChange={(e) => set({ subComponent: e.target.value })} />
        </Field>
        <Field label="RAG">
          <select className={inputCls} value={value.rag || 'grey'} onChange={(e) => set({ rag: e.target.value })}>
            {RAGS.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </Field>
      </div>
      <Field label="CSF name" required>
        <input className={inputCls} value={value.name || ''} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Avg revenue/hr at threshold" />
      </Field>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Field label="Target metric">
          <input className={inputCls} value={value.targetMetric || ''} onChange={(e) => set({ targetMetric: e.target.value })} placeholder="e.g. £140/hr" />
        </Field>
        <Field label="Current metric">
          <input className={inputCls} value={value.currentMetric || ''} onChange={(e) => set({ currentMetric: e.target.value })} placeholder="e.g. £128/hr" />
        </Field>
        <Field label="Owner">
          <UserSelect users={users} value={value.ownerName} onChange={(n) => set({ ownerName: n })} placeholder="— select owner —" />
        </Field>
        <Field label="Reviewed date">
          <input type="date" className={inputCls} value={isoDate(value.reviewedDate)} onChange={(e) => set({ reviewedDate: e.target.value || null })} />
        </Field>
        <Field label="Active">
          <select className={inputCls} value={value.isActive === false ? 'false' : 'true'} onChange={(e) => set({ isActive: e.target.value === 'true' })}>
            <option value="true">Active</option>
            <option value="false">Inactive (hidden from dashboard)</option>
          </select>
        </Field>
      </div>
      <Field label="Notes">
        <textarea className={inputCls} rows={2} value={value.notes || ''} onChange={(e) => set({ notes: e.target.value })} />
      </Field>
    </div>
  );
}

function CsfsTab() {
  const api = useApi<CsfRow>('/api/methodology-admin/performance-dashboard/csfs');
  const users = useUsers();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Partial<CsfRow>>({ pillar: 'goodwill', rag: 'grey', isActive: true });
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Partial<CsfRow>>({});

  async function save() {
    const ok = await api.create(draft);
    if (ok) { setDraft({ pillar: draft.pillar, rag: 'grey', isActive: true }); setAdding(false); }
  }
  async function saveEdit() {
    if (!editId) return;
    const ok = await api.update({ ...editDraft, id: editId });
    if (ok) { setEditId(null); setEditDraft({}); }
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
        <div className="mb-4 border border-blue-200 bg-blue-50/40 rounded-lg p-4">
          <CsfForm value={draft} onChange={setDraft} users={users} />
          <div className="flex justify-end gap-2 mt-3">
            <button onClick={() => setAdding(false)} className={btnSecondary}><X className="h-3 w-3" /> Cancel</button>
            <button onClick={save} className={btnPrimary} disabled={!draft.subComponent || !draft.name}><Save className="h-3 w-3" /> Save CSF</button>
          </div>
        </div>
      )}

      {api.items.length === 0 && !api.loading ? (
        <p className="text-sm text-slate-400 italic text-center py-8">No CSFs configured yet — try the &quot;Seed G3Q defaults&quot; button at the top of this page.</p>
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
                        const ragColor = row.rag === 'green' ? 'bg-emerald-500' : row.rag === 'amber' ? 'bg-amber-500' : row.rag === 'red' ? 'bg-rose-500' : 'bg-slate-400';
                        return (
                          <Fragment key={row.id}>
                            <tr className={`border-b border-slate-100 hover:bg-slate-50/50 ${!row.isActive ? 'opacity-60' : ''}`}>
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
                                    <button onClick={() => { setEditId(row.id === editId ? null : row.id); setEditDraft(row.id === editId ? {} : { ...row }); }} className="text-blue-600 hover:underline text-[11px] mr-2">{editId === row.id ? 'Close' : 'Edit'}</button>
                                    <button onClick={() => setConfirmId(row.id)} className={btnDanger}><Trash2 className="h-3 w-3" /></button>
                                  </>
                                )}
                              </td>
                            </tr>
                            {editId === row.id && (
                              <tr key={`${row.id}-edit`} className="bg-blue-50/30">
                                <td colSpan={7} className="p-4">
                                  <CsfForm value={editDraft} onChange={setEditDraft} users={users} />
                                  <div className="flex justify-end gap-2 mt-3">
                                    <button onClick={() => { setEditId(null); setEditDraft({}); }} className={btnSecondary}><X className="h-3 w-3" /> Cancel</button>
                                    <button onClick={saveEdit} className={btnPrimary}><Save className="h-3 w-3" /> Save changes</button>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
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
  notes: string | null;
};

function PeopleForm({ value, onChange }: { value: Partial<PeopleRow>; onChange: (v: Partial<PeopleRow>) => void }) {
  const set = (patch: Partial<PeopleRow>) => onChange({ ...value, ...patch });
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label="Period label" required hint="e.g. Jul 2026, H1 2026">
          <input className={inputCls} value={value.periodLabel || ''} onChange={(e) => set({ periodLabel: e.target.value })} />
        </Field>
        <Field label="Period end date" required>
          <input type="date" className={inputCls} value={isoDate(value.periodEnd)} onChange={(e) => set({ periodEnd: e.target.value })} />
        </Field>
        <Field label="Training effectiveness %">
          <input type="number" min={0} max={100} step={0.1} className={inputCls} value={value.trainingEffectivenessPct ?? ''} onChange={(e) => set({ trainingEffectivenessPct: e.target.value ? Number(e.target.value) : null })} />
        </Field>
        <Field label="Staff utilisation %">
          <input type="number" min={0} max={100} step={0.1} className={inputCls} value={value.staffUtilisationPct ?? ''} onChange={(e) => set({ staffUtilisationPct: e.target.value ? Number(e.target.value) : null })} />
        </Field>
        <Field label="Culture survey score (0-5)">
          <input type="number" min={0} max={5} step={0.1} className={inputCls} value={value.cultureSurveyScore ?? ''} onChange={(e) => set({ cultureSurveyScore: e.target.value ? Number(e.target.value) : null })} />
        </Field>
        <Field label="Annualised attrition %">
          <input type="number" min={0} max={100} step={0.1} className={inputCls} value={value.attritionPct ?? ''} onChange={(e) => set({ attritionPct: e.target.value ? Number(e.target.value) : null })} />
        </Field>
      </div>
      <Field label="Notes">
        <textarea className={inputCls} rows={2} value={value.notes || ''} onChange={(e) => set({ notes: e.target.value })} />
      </Field>
    </div>
  );
}

function PeopleTab() {
  const api = useApi<PeopleRow>('/api/methodology-admin/performance-dashboard/people-snapshots');
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Partial<PeopleRow>>({});
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Partial<PeopleRow>>({});

  async function save() {
    const ok = await api.create(draft);
    if (ok) { setDraft({}); setAdding(false); }
  }
  async function saveEdit() {
    if (!editId) return;
    const ok = await api.update({ ...editDraft, id: editId });
    if (ok) { setEditId(null); setEditDraft({}); }
  }

  return (
    <div>
      <Toolbar onRefresh={api.load} error={api.error} refreshing={api.loading} onAdd={() => setAdding(true)} addLabel="Add snapshot" />

      {adding && (
        <div className="mb-4 border border-blue-200 bg-blue-50/40 rounded-lg p-4">
          <PeopleForm value={draft} onChange={setDraft} />
          <div className="flex justify-end gap-2 mt-3">
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
                <th className="px-2 py-2 text-right w-32"></th>
              </tr>
            </thead>
            <tbody>
              {api.items.map(row => (
                <Fragment key={row.id}>
                  <tr className="border-b border-slate-100 hover:bg-slate-50/50">
                    <td className="px-3 py-2 text-slate-700 font-medium">{row.periodLabel} <span className="text-[10px] text-slate-400 ml-1">({new Date(row.periodEnd).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })})</span></td>
                    <td className="px-2 py-2 text-center">{row.trainingEffectivenessPct !== null ? `${row.trainingEffectivenessPct}%` : '—'}</td>
                    <td className="px-2 py-2 text-center">{row.staffUtilisationPct !== null ? `${row.staffUtilisationPct}%` : '—'}</td>
                    <td className="px-2 py-2 text-center">{row.cultureSurveyScore !== null ? row.cultureSurveyScore : '—'}</td>
                    <td className="px-2 py-2 text-center">{row.attritionPct !== null ? `${row.attritionPct}%` : '—'}</td>
                    <td className="px-2 py-2 text-right">
                      {confirmId === row.id ? (
                        <ConfirmInline onConfirm={async () => { await api.remove(row.id); setConfirmId(null); }} onCancel={() => setConfirmId(null)} />
                      ) : (
                        <>
                          <button onClick={() => { setEditId(row.id === editId ? null : row.id); setEditDraft(row.id === editId ? {} : { ...row }); }} className="text-blue-600 hover:underline text-[11px] mr-2">{editId === row.id ? 'Close' : 'Edit'}</button>
                          <button onClick={() => setConfirmId(row.id)} className={btnDanger}><Trash2 className="h-3 w-3" /></button>
                        </>
                      )}
                    </td>
                  </tr>
                  {editId === row.id && (
                    <tr key={`${row.id}-edit`} className="bg-blue-50/30">
                      <td colSpan={6} className="p-4">
                        <PeopleForm value={editDraft} onChange={setEditDraft} />
                        <div className="flex justify-end gap-2 mt-3">
                          <button onClick={() => { setEditId(null); setEditDraft({}); }} className={btnSecondary}><X className="h-3 w-3" /> Cancel</button>
                          <button onClick={saveEdit} className={btnPrimary}><Save className="h-3 w-3" /> Save changes</button>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
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
  const users = useUsers();
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Partial<ScheduleRow>>({ year, monthIndex: 0, status: 'planned' });
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Partial<ScheduleRow>>({});

  async function save() {
    const ok = await api.create({ ...draft, year });
    if (ok) { setDraft({ year, monthIndex: 0, status: 'planned' }); setAdding(false); }
  }
  async function saveEdit() {
    if (!editId) return;
    const ok = await api.update({ ...editDraft, id: editId });
    if (ok) { setEditId(null); setEditDraft({}); }
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
              <UserSelect users={users} value={draft.ownerName} onChange={(n) => setDraft({ ...draft, ownerName: n })} placeholder="— select owner —" />
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
        <p className="text-sm text-slate-400 italic text-center py-8">No scheduled activities for {year} yet — try the &quot;Seed G3Q defaults&quot; button at the top of this page.</p>
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
                    if (editId === it.id) {
                      return (
                        <div key={it.id} className="space-y-2 p-2 bg-blue-50/40 rounded">
                          <input className={inputCls} value={editDraft.activityName ?? it.activityName} onChange={(e) => setEditDraft({ ...editDraft, activityName: e.target.value })} />
                          <div className="grid grid-cols-2 gap-2">
                            <select className={inputCls} value={editDraft.status ?? it.status} onChange={(e) => setEditDraft({ ...editDraft, status: e.target.value })}>
                              {SCHEDULE_STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                            </select>
                            <UserSelect users={users} value={editDraft.ownerName ?? it.ownerName} onChange={(n) => setEditDraft({ ...editDraft, ownerName: n })} placeholder="Owner" />
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <input type="date" className={inputCls} value={isoDate(editDraft.dueDate ?? it.dueDate)} onChange={(e) => setEditDraft({ ...editDraft, dueDate: e.target.value || null })} placeholder="Due" />
                            <input type="date" className={inputCls} value={isoDate(editDraft.completedDate ?? it.completedDate)} onChange={(e) => setEditDraft({ ...editDraft, completedDate: e.target.value || null })} placeholder="Completed" />
                          </div>
                          <div className="flex justify-end gap-1">
                            <button onClick={() => { setEditId(null); setEditDraft({}); }} className={btnSecondary}><X className="h-3 w-3" /></button>
                            <button onClick={saveEdit} className={btnPrimary}><Save className="h-3 w-3" /> Save</button>
                          </div>
                        </div>
                      );
                    }
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
                          <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5">
                            <button onClick={() => { setEditId(it.id); setEditDraft({ ...it }); }} className="text-blue-500 hover:text-blue-700 text-[10px]">edit</button>
                            <button onClick={() => setConfirmId(it.id)} className="text-slate-300 hover:text-rose-600"><Trash2 className="h-3 w-3" /></button>
                          </div>
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
        By default each pillar score is auto-derived from CSF RAG mix (with monitoring + RCA blended into the Quality pillar). Override with a manual score (0-100) and a custom strapline if you want to publish a different headline.
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
/* Tab: AI Reliance — registry / usage / validations                   */
/* ------------------------------------------------------------------ */

const AI_AREAS = [
  { value: '',                  label: '— not categorised —' },
  { value: 'revenue',           label: 'Revenue testing' },
  { value: 'je_testing',        label: 'Journal entry testing' },
  { value: 'risk_assessment',   label: 'Risk assessment / planning' },
  { value: 'controls',          label: 'Controls testing' },
  { value: 'analytics',         label: 'Analytics / sampling' },
  { value: 'documentation',     label: 'Documentation drafting' },
  { value: 'research',          label: 'Technical research' },
  { value: 'other',             label: 'Other' },
];
const AI_RISK = ['low', 'medium', 'high', 'critical'];
const AI_VAL_STATUS = ['pending', 'validated', 'under_review', 'withdrawn'];
const AI_DECISIONS = [
  { value: 'accepted',   label: 'Accepted as-is' },
  { value: 'partial',    label: 'Accepted with adjustment' },
  { value: 'overridden', label: 'Overridden by reviewer' },
  { value: 'rejected',   label: 'Rejected outright' },
];
const AI_MATERIALITY = ['low', 'medium', 'high', 'critical'];
const AI_TEST_TYPES = [
  { value: 'accuracy',   label: 'Accuracy / golden-set comparison' },
  { value: 'bias',       label: 'Bias / fairness' },
  { value: 'regression', label: 'Regression (vs prior version)' },
  { value: 'edge_case',  label: 'Edge-case stress test' },
  { value: 'drift',      label: 'Drift detection' },
  { value: 'golden_set', label: 'Golden-set replay' },
  { value: 'other',      label: 'Other' },
];
const AI_RESULTS = ['pass', 'fail', 'partial'];

type AiToolRow = Row & {
  name: string;
  vendor: string | null;
  modelVersion: string | null;
  auditArea: string | null;
  scopeOfUse: string | null;
  riskRating: string;
  ownerName: string | null;
  validationStatus: string;
  lastValidatedDate: string | null;
  nextValidationDue: string | null;
  approvedForUse: boolean;
  approvedByName: string | null;
  approvedDate: string | null;
  humanInLoop: boolean;
  notes: string | null;
  isActive: boolean;
  _count?: { usage: number; validations: number };
};

type AiUsageRow = Row & {
  toolId: string;
  engagementName: string | null;
  engagementId: string | null;
  usedDate: string;
  reviewerName: string | null;
  outputDecision: string;
  materiality: string;
  notes: string | null;
  tool?: { id: string; name: string; riskRating: string };
};

type AiValidationRow = Row & {
  toolId: string;
  testDate: string;
  testType: string;
  result: string;
  performedBy: string | null;
  sampleSize: number | null;
  accuracyPct: number | null;
  evidenceUrl: string | null;
  notes: string | null;
  tool?: { id: string; name: string };
};

function AiToolForm({ value, onChange, users }: { value: Partial<AiToolRow>; onChange: (v: Partial<AiToolRow>) => void; users: FirmUser[] }) {
  const set = (patch: Partial<AiToolRow>) => onChange({ ...value, ...patch });
  return (
    <div className="space-y-3">
      <Field label="Tool name" required hint="e.g. Journal entry risk scoring (Together AI Llama 3.3)">
        <input className={inputCls} value={value.name || ''} onChange={(e) => set({ name: e.target.value })} />
      </Field>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Field label="Vendor / provider">
          <input className={inputCls} value={value.vendor || ''} onChange={(e) => set({ vendor: e.target.value })} placeholder="e.g. Together AI" />
        </Field>
        <Field label="Model / version">
          <input className={inputCls} value={value.modelVersion || ''} onChange={(e) => set({ modelVersion: e.target.value })} placeholder="e.g. Llama-3.3-70B-Instruct" />
        </Field>
        <Field label="Audit area">
          <select className={inputCls} value={value.auditArea || ''} onChange={(e) => set({ auditArea: e.target.value || null })}>
            {AI_AREAS.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
          </select>
        </Field>
        <Field label="Risk rating" required>
          <select className={inputCls} value={value.riskRating || 'medium'} onChange={(e) => set({ riskRating: e.target.value })}>
            {AI_RISK.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </Field>
        <Field label="Owner">
          <UserSelect users={users} value={value.ownerName} onChange={(n) => set({ ownerName: n })} placeholder="— select owner —" />
        </Field>
        <Field label="Validation status">
          <select className={inputCls} value={value.validationStatus || 'pending'} onChange={(e) => set({ validationStatus: e.target.value })}>
            {AI_VAL_STATUS.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
          </select>
        </Field>
        <Field label="Last validated date">
          <input type="date" className={inputCls} value={isoDate(value.lastValidatedDate)} onChange={(e) => set({ lastValidatedDate: e.target.value || null })} />
        </Field>
        <Field label="Next validation due" hint="Defensible cadence: 12 months max for high/critical">
          <input type="date" className={inputCls} value={isoDate(value.nextValidationDue)} onChange={(e) => set({ nextValidationDue: e.target.value || null })} />
        </Field>
        <Field label="Approved for production use">
          <select className={inputCls} value={value.approvedForUse ? 'true' : 'false'} onChange={(e) => set({ approvedForUse: e.target.value === 'true' })}>
            <option value="false">No</option>
            <option value="true">Yes</option>
          </select>
        </Field>
        <Field label="Approved by">
          <UserSelect users={users} value={value.approvedByName} onChange={(n) => set({ approvedByName: n })} placeholder="— select approver —" />
        </Field>
        <Field label="Approval date">
          <input type="date" className={inputCls} value={isoDate(value.approvedDate)} onChange={(e) => set({ approvedDate: e.target.value || null })} />
        </Field>
        <Field label="Human-in-the-loop required">
          <select className={inputCls} value={value.humanInLoop === false ? 'false' : 'true'} onChange={(e) => set({ humanInLoop: e.target.value === 'true' })}>
            <option value="true">Yes — every output must be human-reviewed</option>
            <option value="false">No — sampling-based oversight only</option>
          </select>
        </Field>
      </div>
      <Field label="Scope of use" hint="What the tool is permitted to do — and what it is not allowed to do unsupervised">
        <textarea className={inputCls} rows={3} value={value.scopeOfUse || ''} onChange={(e) => set({ scopeOfUse: e.target.value })} />
      </Field>
      <Field label="Notes">
        <textarea className={inputCls} rows={2} value={value.notes || ''} onChange={(e) => set({ notes: e.target.value })} />
      </Field>
    </div>
  );
}

function AiToolsSubTab() {
  const api = useApi<AiToolRow>('/api/methodology-admin/performance-dashboard/ai-tools');
  const users = useUsers();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Partial<AiToolRow>>({ riskRating: 'medium', validationStatus: 'pending', humanInLoop: true, isActive: true });
  const [editId, setEditId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Partial<AiToolRow>>({});
  const [confirmId, setConfirmId] = useState<string | null>(null);

  async function save() {
    const ok = await api.create(draft);
    if (ok) { setDraft({ riskRating: 'medium', validationStatus: 'pending', humanInLoop: true, isActive: true }); setAdding(false); }
  }
  async function saveEdit() {
    if (!editId) return;
    const ok = await api.update({ ...editDraft, id: editId });
    if (ok) { setEditId(null); setEditDraft({}); }
  }

  const today = new Date();

  return (
    <div>
      <Toolbar onRefresh={api.load} error={api.error} refreshing={api.loading} onAdd={() => setAdding(true)} addLabel="Register AI tool" />

      {adding && (
        <div className="mb-4 border border-blue-200 bg-blue-50/40 rounded-lg p-4">
          <AiToolForm value={draft} onChange={setDraft} users={users} />
          <div className="flex justify-end gap-2 mt-3">
            <button onClick={() => setAdding(false)} className={btnSecondary}><X className="h-3 w-3" /> Cancel</button>
            <button onClick={save} className={btnPrimary} disabled={!draft.name}><Save className="h-3 w-3" /> Register tool</button>
          </div>
        </div>
      )}

      {api.items.length === 0 && !api.loading ? (
        <p className="text-sm text-slate-400 italic text-center py-8">No AI tools registered yet — register every tool used in audit work to maintain a defensible position.</p>
      ) : (
        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr className="text-[10px] text-slate-500 uppercase font-semibold">
                <th className="px-3 py-2 text-left">Tool</th>
                <th className="px-2 py-2 text-left w-32">Audit area</th>
                <th className="px-2 py-2 text-left w-20">Risk</th>
                <th className="px-2 py-2 text-left w-28">Validation</th>
                <th className="px-2 py-2 text-left w-24">Last tested</th>
                <th className="px-2 py-2 text-left w-24">Next due</th>
                <th className="px-2 py-2 text-center w-20">Approved</th>
                <th className="px-2 py-2 text-center w-20">HITL</th>
                <th className="px-2 py-2 text-right w-32"></th>
              </tr>
            </thead>
            <tbody>
              {api.items.map(row => {
                const overdue = row.nextValidationDue && new Date(row.nextValidationDue) < today;
                const riskCls = row.riskRating === 'critical' ? 'bg-rose-100 text-rose-700' : row.riskRating === 'high' ? 'bg-amber-100 text-amber-700' : row.riskRating === 'medium' ? 'bg-slate-100 text-slate-700' : 'bg-emerald-100 text-emerald-700';
                const valCls = row.validationStatus === 'validated' ? 'bg-emerald-100 text-emerald-700' : row.validationStatus === 'withdrawn' ? 'bg-slate-200 text-slate-600' : row.validationStatus === 'under_review' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500';
                return (
                  <Fragment key={row.id}>
                    <tr className={`border-b border-slate-100 hover:bg-slate-50/50 ${!row.isActive ? 'opacity-60' : ''}`}>
                      <td className="px-3 py-2">
                        <div className="font-medium text-slate-700">{row.name}</div>
                        {(row.vendor || row.modelVersion) && <div className="text-[11px] text-slate-500">{[row.vendor, row.modelVersion].filter(Boolean).join(' · ')}</div>}
                        <div className="text-[10px] text-slate-400 mt-0.5">{row._count?.usage ?? 0} uses · {row._count?.validations ?? 0} tests</div>
                      </td>
                      <td className="px-2 py-2 text-slate-600">{AI_AREAS.find(a => a.value === row.auditArea)?.label || '—'}</td>
                      <td className="px-2 py-2"><span className={`text-[10px] px-1.5 py-0.5 rounded-full ${riskCls}`}>{row.riskRating}</span></td>
                      <td className="px-2 py-2"><span className={`text-[10px] px-1.5 py-0.5 rounded-full ${valCls}`}>{row.validationStatus.replace('_', ' ')}</span></td>
                      <td className="px-2 py-2 text-slate-600">{row.lastValidatedDate ? new Date(row.lastValidatedDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }) : '—'}</td>
                      <td className={`px-2 py-2 ${overdue ? 'text-rose-600 font-semibold' : 'text-slate-600'}`}>{row.nextValidationDue ? new Date(row.nextValidationDue).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }) : '—'}{overdue ? ' (overdue)' : ''}</td>
                      <td className="px-2 py-2 text-center">{row.approvedForUse ? <CheckCircle2 className="h-4 w-4 text-emerald-600 mx-auto" /> : <XCircle className="h-4 w-4 text-rose-400 mx-auto" />}</td>
                      <td className="px-2 py-2 text-center">{row.humanInLoop ? <CheckCircle2 className="h-4 w-4 text-emerald-600 mx-auto" /> : <span className="text-amber-600 text-[10px]">sampling</span>}</td>
                      <td className="px-2 py-2 text-right">
                        {confirmId === row.id ? (
                          <ConfirmInline onConfirm={async () => { await api.remove(row.id); setConfirmId(null); }} onCancel={() => setConfirmId(null)} />
                        ) : (
                          <>
                            <button onClick={() => { setEditId(row.id === editId ? null : row.id); setEditDraft(row.id === editId ? {} : { ...row }); }} className="text-blue-600 hover:underline text-[11px] mr-2">{editId === row.id ? 'Close' : 'Edit'}</button>
                            <button onClick={() => setConfirmId(row.id)} className={btnDanger}><Trash2 className="h-3 w-3" /></button>
                          </>
                        )}
                      </td>
                    </tr>
                    {editId === row.id && (
                      <tr className="bg-blue-50/30">
                        <td colSpan={9} className="p-4">
                          <AiToolForm value={editDraft} onChange={setEditDraft} users={users} />
                          <div className="flex justify-end gap-2 mt-3">
                            <button onClick={() => { setEditId(null); setEditDraft({}); }} className={btnSecondary}><X className="h-3 w-3" /> Cancel</button>
                            <button onClick={saveEdit} className={btnPrimary}><Save className="h-3 w-3" /> Save changes</button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AiUsageSubTab() {
  const api = useApi<AiUsageRow>('/api/methodology-admin/performance-dashboard/ai-usage');
  const toolsApi = useApi<AiToolRow>('/api/methodology-admin/performance-dashboard/ai-tools');
  const users = useUsers();
  const engagements = useEngagements();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Partial<AiUsageRow>>({ outputDecision: 'accepted', materiality: 'medium' });
  const [confirmId, setConfirmId] = useState<string | null>(null);

  async function save() {
    const ok = await api.create(draft);
    if (ok) { setDraft({ outputDecision: 'accepted', materiality: 'medium' }); setAdding(false); }
  }

  return (
    <div>
      <Toolbar onRefresh={api.load} error={api.error} refreshing={api.loading} onAdd={() => setAdding(true)} addLabel="Log AI usage" />

      {toolsApi.items.length === 0 && !toolsApi.loading && (
        <div className="mb-4 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
          You need at least one registered AI tool before you can log usage. Switch to the Tool registry sub-tab first.
        </div>
      )}

      {adding && (
        <div className="mb-4 border border-blue-200 bg-blue-50/40 rounded-lg p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="AI tool" required>
              <select className={inputCls} value={draft.toolId || ''} onChange={(e) => setDraft({ ...draft, toolId: e.target.value })}>
                <option value="">— select tool —</option>
                {toolsApi.items.filter(t => t.isActive).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </Field>
            <Field label="Engagement">
              <EngagementSelect engagements={engagements} valueId={draft.engagementId} valueName={draft.engagementName} onChange={(id, name) => setDraft({ ...draft, engagementId: id, engagementName: name })} />
            </Field>
            <Field label="Used date">
              <input type="date" className={inputCls} value={isoDate(draft.usedDate)} onChange={(e) => setDraft({ ...draft, usedDate: e.target.value })} />
            </Field>
            <Field label="Reviewer (human-in-the-loop)" required>
              <UserSelect users={users} value={draft.reviewerName} onChange={(n) => setDraft({ ...draft, reviewerName: n })} placeholder="— select reviewer —" />
            </Field>
            <Field label="Output decision" required hint="The audit-trail evidence that a human engaged">
              <select className={inputCls} value={draft.outputDecision || 'accepted'} onChange={(e) => setDraft({ ...draft, outputDecision: e.target.value })}>
                {AI_DECISIONS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
            </Field>
            <Field label="Materiality of decision">
              <select className={inputCls} value={draft.materiality || 'medium'} onChange={(e) => setDraft({ ...draft, materiality: e.target.value })}>
                {AI_MATERIALITY.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Notes" hint="What the AI said, what the reviewer concluded, why an override was made if applicable">
            <textarea className={inputCls} rows={3} value={draft.notes || ''} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
          </Field>
          <div className="flex justify-end gap-2">
            <button onClick={() => setAdding(false)} className={btnSecondary}><X className="h-3 w-3" /> Cancel</button>
            <button onClick={save} className={btnPrimary} disabled={!draft.toolId || !draft.outputDecision}><Save className="h-3 w-3" /> Log usage</button>
          </div>
        </div>
      )}

      {api.items.length === 0 && !api.loading ? (
        <p className="text-sm text-slate-400 italic text-center py-8">No AI-assisted decisions logged yet.</p>
      ) : (
        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr className="text-[10px] text-slate-500 uppercase font-semibold">
                <th className="px-3 py-2 text-left">Date / Tool</th>
                <th className="px-2 py-2 text-left">Engagement</th>
                <th className="px-2 py-2 text-left w-28">Reviewer</th>
                <th className="px-2 py-2 text-left w-32">Decision</th>
                <th className="px-2 py-2 text-left w-20">Materiality</th>
                <th className="px-2 py-2 text-right w-20"></th>
              </tr>
            </thead>
            <tbody>
              {api.items.map(row => {
                const decisionCls = row.outputDecision === 'accepted' ? 'bg-emerald-100 text-emerald-700' : row.outputDecision === 'overridden' ? 'bg-amber-100 text-amber-700' : row.outputDecision === 'partial' ? 'bg-blue-100 text-blue-700' : 'bg-rose-100 text-rose-700';
                return (
                  <tr key={row.id} className="border-b border-slate-100 hover:bg-slate-50/50">
                    <td className="px-3 py-2">
                      <div className="text-slate-600">{new Date(row.usedDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })}</div>
                      <div className="text-[11px] text-slate-500">{row.tool?.name || row.toolId.slice(0, 8)}</div>
                    </td>
                    <td className="px-2 py-2 text-slate-600">{row.engagementName || '—'}</td>
                    <td className="px-2 py-2 text-slate-600">{row.reviewerName || '—'}</td>
                    <td className="px-2 py-2"><span className={`text-[10px] px-1.5 py-0.5 rounded-full ${decisionCls}`}>{AI_DECISIONS.find(d => d.value === row.outputDecision)?.label || row.outputDecision}</span></td>
                    <td className="px-2 py-2 text-slate-600">{row.materiality}</td>
                    <td className="px-2 py-2 text-right">
                      {confirmId === row.id ? (
                        <ConfirmInline onConfirm={async () => { await api.remove(row.id); setConfirmId(null); }} onCancel={() => setConfirmId(null)} />
                      ) : (
                        <button onClick={() => setConfirmId(row.id)} className={btnDanger}><Trash2 className="h-3 w-3" /></button>
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

function AiValidationsSubTab() {
  const api = useApi<AiValidationRow>('/api/methodology-admin/performance-dashboard/ai-validations');
  const toolsApi = useApi<AiToolRow>('/api/methodology-admin/performance-dashboard/ai-tools');
  const users = useUsers();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Partial<AiValidationRow>>({ testType: 'accuracy', result: 'pass' });
  const [confirmId, setConfirmId] = useState<string | null>(null);

  async function save() {
    const ok = await api.create(draft);
    if (ok) { setDraft({ testType: 'accuracy', result: 'pass' }); setAdding(false); toolsApi.load(); }
  }

  return (
    <div>
      <Toolbar onRefresh={api.load} error={api.error} refreshing={api.loading} onAdd={() => setAdding(true)} addLabel="Log validation test" />

      {adding && (
        <div className="mb-4 border border-blue-200 bg-blue-50/40 rounded-lg p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Field label="AI tool" required>
              <select className={inputCls} value={draft.toolId || ''} onChange={(e) => setDraft({ ...draft, toolId: e.target.value })}>
                <option value="">— select tool —</option>
                {toolsApi.items.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </Field>
            <Field label="Test date" required>
              <input type="date" className={inputCls} value={isoDate(draft.testDate)} onChange={(e) => setDraft({ ...draft, testDate: e.target.value })} />
            </Field>
            <Field label="Test type" required>
              <select className={inputCls} value={draft.testType || 'accuracy'} onChange={(e) => setDraft({ ...draft, testType: e.target.value })}>
                {AI_TEST_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </Field>
            <Field label="Result" required>
              <select className={inputCls} value={draft.result || 'pass'} onChange={(e) => setDraft({ ...draft, result: e.target.value })}>
                {AI_RESULTS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </Field>
            <Field label="Performed by">
              <UserSelect users={users} value={draft.performedBy} onChange={(n) => setDraft({ ...draft, performedBy: n })} placeholder="— select tester —" />
            </Field>
            <Field label="Sample size">
              <input type="number" min={0} className={inputCls} value={draft.sampleSize ?? ''} onChange={(e) => setDraft({ ...draft, sampleSize: e.target.value ? Number(e.target.value) : null })} />
            </Field>
            <Field label="Accuracy %" hint="Where applicable (golden-set runs)">
              <input type="number" min={0} max={100} step={0.1} className={inputCls} value={draft.accuracyPct ?? ''} onChange={(e) => setDraft({ ...draft, accuracyPct: e.target.value ? Number(e.target.value) : null })} />
            </Field>
            <Field label="Evidence URL">
              <input type="url" className={inputCls} value={draft.evidenceUrl || ''} onChange={(e) => setDraft({ ...draft, evidenceUrl: e.target.value })} placeholder="link to test evidence / report" />
            </Field>
          </div>
          <Field label="Notes">
            <textarea className={inputCls} rows={3} value={draft.notes || ''} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
          </Field>
          <div className="text-[11px] text-slate-500 italic">A passing test will set the tool&apos;s validation status to &quot;validated&quot; and update the last-validated date.</div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setAdding(false)} className={btnSecondary}><X className="h-3 w-3" /> Cancel</button>
            <button onClick={save} className={btnPrimary} disabled={!draft.toolId}><Save className="h-3 w-3" /> Log validation</button>
          </div>
        </div>
      )}

      {api.items.length === 0 && !api.loading ? (
        <p className="text-sm text-slate-400 italic text-center py-8">No validation tests recorded yet.</p>
      ) : (
        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr className="text-[10px] text-slate-500 uppercase font-semibold">
                <th className="px-3 py-2 text-left w-24">Date</th>
                <th className="px-3 py-2 text-left">Tool</th>
                <th className="px-2 py-2 text-left w-32">Test type</th>
                <th className="px-2 py-2 text-left w-20">Result</th>
                <th className="px-2 py-2 text-center w-20">Sample</th>
                <th className="px-2 py-2 text-center w-20">Accuracy</th>
                <th className="px-2 py-2 text-left w-28">Performed by</th>
                <th className="px-2 py-2 text-right w-20"></th>
              </tr>
            </thead>
            <tbody>
              {api.items.map(row => {
                const resultCls = row.result === 'pass' ? 'bg-emerald-100 text-emerald-700' : row.result === 'fail' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700';
                return (
                  <tr key={row.id} className="border-b border-slate-100 hover:bg-slate-50/50">
                    <td className="px-3 py-2 text-slate-600">{new Date(row.testDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })}</td>
                    <td className="px-3 py-2 text-slate-700">{row.tool?.name || row.toolId.slice(0, 8)}</td>
                    <td className="px-2 py-2 text-slate-600">{AI_TEST_TYPES.find(t => t.value === row.testType)?.label || row.testType}</td>
                    <td className="px-2 py-2"><span className={`text-[10px] px-1.5 py-0.5 rounded-full ${resultCls}`}>{row.result}</span></td>
                    <td className="px-2 py-2 text-center text-slate-600">{row.sampleSize ?? '—'}</td>
                    <td className="px-2 py-2 text-center text-slate-600">{row.accuracyPct !== null ? `${row.accuracyPct}%` : '—'}</td>
                    <td className="px-2 py-2 text-slate-600">{row.performedBy || '—'}</td>
                    <td className="px-2 py-2 text-right">
                      {confirmId === row.id ? (
                        <ConfirmInline onConfirm={async () => { await api.remove(row.id); setConfirmId(null); }} onCancel={() => setConfirmId(null)} />
                      ) : (
                        <button onClick={() => setConfirmId(row.id)} className={btnDanger}><Trash2 className="h-3 w-3" /></button>
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

function AiReliancesTab() {
  const [sub, setSub] = useState<'tools' | 'usage' | 'validations'>('tools');
  return (
    <div>
      <div className="flex items-center gap-2 mb-3 border border-slate-200 rounded-lg p-1 bg-slate-50 w-fit">
        {[
          { key: 'tools' as const,       label: 'Tool registry' },
          { key: 'usage' as const,       label: 'Usage log' },
          { key: 'validations' as const, label: 'Validation tests' },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setSub(t.key)}
            className={`text-xs px-3 py-1.5 rounded-md transition-colors ${sub === t.key ? 'bg-white shadow-sm border border-slate-200 text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {sub === 'tools' && <AiToolsSubTab />}
      {sub === 'usage' && <AiUsageSubTab />}
      {sub === 'validations' && <AiValidationsSubTab />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Seed banner — populates standard G3Q content                        */
/* ------------------------------------------------------------------ */

function SeedBanner({ onSeeded }: { onSeeded: () => void }) {
  const [seeding, setSeeding] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [year, setYear] = useState<number>(new Date().getFullYear());

  async function seed() {
    setSeeding(true);
    setResult(null);
    try {
      const res = await fetch('/api/methodology-admin/performance-dashboard/seed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Seed failed');
      setResult(`Created: ${json.csfsCreated} CSFs · ${json.scheduleCreated} schedule rows · ${json.isqmCreated} ISQM objectives · ${json.pillarsCreated} pillars (${json.csfsSkipped + json.scheduleSkipped + json.isqmSkipped + json.pillarsSkipped} skipped as duplicates)`);
      onSeeded();
    } catch (e) {
      setResult(e instanceof Error ? e.message : 'Seed failed');
    } finally {
      setSeeding(false);
    }
  }

  return (
    <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg p-4 mb-6">
      <div className="flex items-start gap-3">
        <Database className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-slate-900 mb-1">Seed standard G3Q defaults</h3>
          <p className="text-xs text-slate-600 mb-3">
            Pre-populates CSFs (40+ items across all four pillars), the annual activity schedule (60+ items mirroring slide 22 of the G3Q deck), the eight ISQM(UK)1 quality objectives and pillar straplines. Idempotent — re-running skips anything that already exists.
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <label className="text-[11px] text-slate-500 inline-flex items-center gap-1">
              Schedule year
              <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="text-xs border border-slate-200 rounded px-2 py-1 bg-white">
                {[year - 1, year, year + 1].map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </label>
            <button onClick={seed} disabled={seeding} className={btnPrimary}>
              {seeding ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
              {seeding ? 'Seeding…' : 'Seed G3Q defaults'}
            </button>
            {result && <span className="text-[11px] text-slate-600">{result}</span>}
          </div>
        </div>
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
  const [seedBump, setSeedBump] = useState(0);

  return (
    <div className="space-y-4">
      <SeedBanner onSeeded={() => setSeedBump(b => b + 1)} />

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

      <div className="pt-2" key={`${tab}-${seedBump}`}>
        {tab === 'monitoring' && <MonitoringTab />}
        {tab === 'findings' && <FindingsTab />}
        {tab === 'remediations' && <RemediationsTab />}
        {tab === 'csfs' && <CsfsTab />}
        {tab === 'people' && <PeopleTab />}
        {tab === 'schedule' && <ScheduleTab />}
        {tab === 'isqm' && <IsqmTab />}
        {tab === 'pillars' && <PillarsTab />}
        {tab === 'ai' && <AiReliancesTab />}
      </div>
    </div>
  );
}
