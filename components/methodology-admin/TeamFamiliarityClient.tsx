'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { Loader2, RefreshCw, Mail, Users, Filter, ChevronDown } from 'lucide-react';

interface FamiliarityRow {
  id: string;
  clientId: string;
  clientName: string;
  clientIsPIE: boolean;
  userId: string;
  userName: string;
  role: string;
  engagementStartDate: string | null;
  roleStartedDate: string | null;
  ceasedActingDate: string | null;
  servedPeriods: string[];
  memberType: 'team' | 'specialist';
  auditCategories: string[];
}

interface Limits {
  riFamiliarityLimitNonPIE: number;
  riFamiliarityLimitPIE: number;
}

const ROLE_LABEL: Record<string, string> = {
  Junior: 'Preparer',
  Manager: 'Reviewer',
  RI: 'RI',
  Partner: 'Partner',
  EQR: 'EQR',
};

type ColumnKey = 'client' | 'member' | 'role' | 'category';

/**
 * Audit Rotation Record (formerly Team Familiarity).
 *
 * Auto-refreshes from the engagement history on mount so the admin
 * doesn't have to remember to click Rebuild. Each row carries Audit
 * Categories as pills next to the member name; every key column has a
 * multi-select filter chip in the header. An on-demand "Email me a
 * snapshot" button emails the current rows as CSV to the logged-in
 * Methodology Admin so they can keep a fixed-point-in-time copy.
 */
export function TeamFamiliarityClient() {
  const [rows, setRows] = useState<FamiliarityRow[]>([]);
  const [limits, setLimits] = useState<Limits>({ riFamiliarityLimitNonPIE: 10, riFamiliarityLimitPIE: 5 });
  const [loading, setLoading] = useState(true);
  const [rebuilding, setRebuilding] = useState(false);
  const [savingLimits, setSavingLimits] = useState(false);
  const [_savingRow, setSavingRow] = useState<string | null>(null);
  const [emailing, setEmailing] = useState(false);
  const [emailResult, setEmailResult] = useState<{ ok: boolean; message: string } | null>(null);
  const autoRebuiltRef = useRef(false);

  // Per-column multi-select filter state. An empty Set means "no
  // filter for this column" (show all). Click a chip → toggle.
  const [filters, setFilters] = useState<Record<ColumnKey, Set<string>>>({
    client: new Set(),
    member: new Set(),
    role: new Set(),
    category: new Set(),
  });

  useEffect(() => {
    // First load — render whatever's in the DB straight away, then
    // kick off a silent rebuild in the background so derived rows
    // (specialists, categories) stay current without a button press.
    load().then(() => {
      if (autoRebuiltRef.current) return;
      autoRebuiltRef.current = true;
      void silentRebuild();
    });
  }, []);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/methodology-admin/team-familiarity');
      if (res.ok) {
        const data = await res.json();
        setRows(data.rows || []);
        setLimits(data.limits || { riFamiliarityLimitNonPIE: 10, riFamiliarityLimitPIE: 5 });
      }
    } finally {
      setLoading(false);
    }
  }

  async function silentRebuild() {
    // Fire-and-forget the rebuild then reload — never block UI on it.
    try {
      await fetch('/api/methodology-admin/team-familiarity/rebuild', { method: 'POST' });
      await load();
    } catch { /* ignore — manual refresh still available */ }
  }

  async function rebuild() {
    setRebuilding(true);
    try {
      await fetch('/api/methodology-admin/team-familiarity/rebuild', { method: 'POST' });
      await load();
    } finally {
      setRebuilding(false);
    }
  }

  async function saveLimits() {
    setSavingLimits(true);
    try {
      await fetch('/api/methodology-admin/team-familiarity/limits', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(limits),
      });
    } finally {
      setSavingLimits(false);
    }
  }

  async function updateRow(rowId: string, patch: Partial<Pick<FamiliarityRow, 'engagementStartDate' | 'roleStartedDate' | 'ceasedActingDate'>>) {
    // Synthesised specialist rows don't have a backing
    // TeamFamiliarityEntry row, so we silently no-op on date edits
    // for them — their dates are derived from the engagement periods.
    if (rowId.startsWith('spec:')) return;
    setSavingRow(rowId);
    try {
      const res = await fetch('/api/methodology-admin/team-familiarity', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entryId: rowId, ...patch }),
      });
      if (res.ok) {
        setRows(prev => prev.map(r => r.id === rowId ? { ...r, ...patch } : r));
      }
    } finally {
      setSavingRow(null);
    }
  }

  async function emailSnapshot() {
    setEmailing(true);
    setEmailResult(null);
    try {
      const res = await fetch('/api/methodology-admin/team-familiarity/snapshot-email', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setEmailResult({ ok: true, message: `Snapshot emailed to ${data.to} (${data.rowCount ?? 0} rows).` });
      } else {
        setEmailResult({ ok: false, message: data?.error || `Email send failed (${res.status})` });
      }
    } catch (err: any) {
      setEmailResult({ ok: false, message: err?.message || 'Network error' });
    } finally {
      setEmailing(false);
    }
  }

  // Distinct values for each column's filter dropdown — derived from
  // the unfiltered row list so the menu options don't disappear as
  // the user filters.
  const distinct = useMemo(() => {
    const clients = new Set<string>();
    const members = new Set<string>();
    const roles = new Set<string>();
    const categories = new Set<string>();
    for (const r of rows) {
      clients.add(r.clientName);
      members.add(r.userName);
      roles.add(r.role);
      for (const c of r.auditCategories) categories.add(c);
    }
    return {
      clients: Array.from(clients).sort(),
      members: Array.from(members).sort(),
      roles: Array.from(roles).sort(),
      categories: Array.from(categories).sort(),
    };
  }, [rows]);

  const filtered = useMemo(() => {
    return rows.filter(r => {
      if (filters.client.size > 0 && !filters.client.has(r.clientName)) return false;
      if (filters.member.size > 0 && !filters.member.has(r.userName)) return false;
      if (filters.role.size > 0 && !filters.role.has(r.role)) return false;
      if (filters.category.size > 0) {
        // Match if ANY of the row's categories are in the picked set.
        const ok = r.auditCategories.some(c => filters.category.has(c));
        if (!ok) return false;
      }
      return true;
    });
  }, [rows, filters]);

  // Group filtered rows by client for the section headers
  const grouped = useMemo(() => {
    const byClient = new Map<string, { client: { id: string; name: string; isPIE: boolean }; rows: FamiliarityRow[] }>();
    for (const r of filtered) {
      if (!byClient.has(r.clientId)) {
        byClient.set(r.clientId, { client: { id: r.clientId, name: r.clientName, isPIE: r.clientIsPIE }, rows: [] });
      }
      byClient.get(r.clientId)!.rows.push(r);
    }
    return Array.from(byClient.values()).sort((a, b) => a.client.name.localeCompare(b.client.name));
  }, [filtered]);

  const maxPeriods = useMemo(() => {
    const maxFromRows = rows.reduce((m, r) => Math.max(m, r.servedPeriods.length), 0);
    const maxFromLimits = Math.max(limits.riFamiliarityLimitNonPIE, limits.riFamiliarityLimitPIE);
    return Math.max(maxFromRows, maxFromLimits, 5);
  }, [rows, limits]);

  function rowColourClass(row: FamiliarityRow): string {
    if (row.role !== 'RI') return '';
    const total = row.servedPeriods.length;
    const limit = row.clientIsPIE ? limits.riFamiliarityLimitPIE : limits.riFamiliarityLimitNonPIE;
    if (total >= limit) return 'bg-red-50';
    if (total === limit - 1) return 'bg-amber-50';
    return '';
  }

  function fmtDate(s: string | null): string {
    return s ? s.slice(0, 10) : '';
  }

  function yearsSinceCeasing(row: FamiliarityRow): number | null {
    if (!row.ceasedActingDate) return null;
    const ceased = new Date(row.ceasedActingDate);
    const now = new Date();
    const ms = now.getTime() - ceased.getTime();
    return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24 * 365)));
  }

  function setFilter(col: ColumnKey, values: Set<string>) {
    setFilters(prev => ({ ...prev, [col]: values }));
  }

  if (loading) return <div className="p-8 text-center text-sm text-slate-400 animate-pulse">Loading rotation record…</div>;

  const totalRows = rows.length;
  const showingCount = filtered.length;
  const anyFilterActive = (Object.keys(filters) as ColumnKey[]).some(k => filters[k].size > 0);

  return (
    <div className="space-y-6">
      {/* Top controls */}
      <div className="flex flex-wrap items-end gap-4 p-4 bg-slate-50 rounded-lg border border-slate-200">
        <div>
          <label className="text-[10px] text-slate-500 uppercase tracking-wide font-semibold">RI Familiarity Limit (non-PIE)</label>
          <input
            type="number"
            min={1}
            value={limits.riFamiliarityLimitNonPIE}
            onChange={e => setLimits(prev => ({ ...prev, riFamiliarityLimitNonPIE: Math.max(1, parseInt(e.target.value) || 1) }))}
            onBlur={saveLimits}
            className="mt-1 w-24 text-xs border border-slate-300 rounded px-2 py-1.5 focus:outline-none focus:border-blue-400"
          />
        </div>
        <div>
          <label className="text-[10px] text-slate-500 uppercase tracking-wide font-semibold">RI Familiarity Limit (PIE)</label>
          <input
            type="number"
            min={1}
            value={limits.riFamiliarityLimitPIE}
            onChange={e => setLimits(prev => ({ ...prev, riFamiliarityLimitPIE: Math.max(1, parseInt(e.target.value) || 1) }))}
            onBlur={saveLimits}
            className="mt-1 w-24 text-xs border border-slate-300 rounded px-2 py-1.5 focus:outline-none focus:border-blue-400"
          />
        </div>
        {savingLimits && <Loader2 className="h-3 w-3 animate-spin text-slate-400 mb-2" />}
        <div className="flex-1" />
        <div className="flex flex-wrap items-center gap-2 mb-1">
          {anyFilterActive && (
            <button
              onClick={() => setFilters({ client: new Set(), member: new Set(), role: new Set(), category: new Set() })}
              className="text-[11px] px-2 py-1 rounded border border-slate-300 bg-white hover:bg-slate-50 text-slate-600"
              title="Clear all column filters"
            >
              Clear filters
            </button>
          )}
          <span className="text-[11px] text-slate-500">{showingCount} of {totalRows}</span>
          <button
            onClick={emailSnapshot}
            disabled={emailing}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            title="Email a CSV snapshot of the current rotation record to your firm email"
          >
            {emailing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Mail className="h-3 w-3" />}
            Email snapshot
          </button>
          <button
            onClick={rebuild}
            disabled={rebuilding}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-slate-600 text-white rounded hover:bg-slate-700 disabled:opacity-50"
            title="Force a full rebuild from engagements right now (auto-runs on page load too)"
          >
            {rebuilding ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            Rebuild
          </button>
        </div>
      </div>

      {emailResult && (
        <div className={`p-2 rounded border text-xs ${emailResult.ok ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
          {emailResult.message}
        </div>
      )}

      {/* Table */}
      <div className="border border-slate-200 rounded-lg overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead className="bg-slate-50">
            <tr className="border-b border-slate-200">
              <th className="px-2 py-2 text-left font-semibold text-slate-600 uppercase tracking-wide">
                <ColumnFilterHeader label="Client" options={distinct.clients} value={filters.client} onChange={v => setFilter('client', v)} />
              </th>
              <th className="px-2 py-2 text-left font-semibold text-slate-600 uppercase tracking-wide">
                <ColumnFilterHeader label="Member" options={distinct.members} value={filters.member} onChange={v => setFilter('member', v)} />
              </th>
              <th className="px-2 py-2 text-left font-semibold text-slate-600 uppercase tracking-wide">
                <ColumnFilterHeader label="Role" options={distinct.roles} value={filters.role} onChange={v => setFilter('role', v)} />
              </th>
              <th className="px-2 py-2 text-left font-semibold text-slate-600 uppercase tracking-wide">
                <ColumnFilterHeader label="Audit Category" options={distinct.categories} value={filters.category} onChange={v => setFilter('category', v)} />
              </th>
              <th className="px-2 py-2 text-left font-semibold text-slate-600 uppercase tracking-wide">Engagement Start</th>
              <th className="px-2 py-2 text-left font-semibold text-slate-600 uppercase tracking-wide">Role Started</th>
              {Array.from({ length: maxPeriods }, (_, i) => (
                <th key={i} className="px-1 py-2 text-center font-semibold text-slate-600 uppercase tracking-wide w-6">{i + 1}</th>
              ))}
              <th className="px-2 py-2 text-center font-semibold text-slate-600 uppercase tracking-wide">Total</th>
              <th className="px-2 py-2 text-center font-semibold text-slate-600 uppercase tracking-wide">Yrs since ceasing</th>
            </tr>
          </thead>
          <tbody>
            {grouped.length === 0 && (
              <tr>
                <td colSpan={8 + maxPeriods} className="text-center py-8 text-slate-400">
                  <Users className="h-6 w-6 mx-auto text-slate-300 mb-2" />
                  {anyFilterActive ? 'No rows match the current filters.' : 'No rotation entries yet. The page auto-rebuilds on load — try Refresh.'}
                </td>
              </tr>
            )}
            {grouped.map(group => (
              <tbody key={`grp-${group.client.id}`} className="contents">
                <tr className="bg-slate-100/60 border-t-2 border-slate-200">
                  <td colSpan={8 + maxPeriods} className="px-2 py-1 font-semibold text-slate-700">
                    {group.client.name}
                    {group.client.isPIE && <span className="ml-2 inline-block text-[9px] font-bold uppercase bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">PIE</span>}
                  </td>
                </tr>
                {group.rows.map(row => {
                  const total = row.servedPeriods.length;
                  const yrs = yearsSinceCeasing(row);
                  const isSpec = row.memberType === 'specialist';
                  return (
                    <tr key={row.id} className={`border-b border-slate-100 ${rowColourClass(row)}`}>
                      <td className="px-2 py-1.5 text-slate-400 text-[10px]"></td>
                      <td className="px-2 py-1.5 text-slate-700">
                        <span className="font-medium">{row.userName}</span>
                        {isSpec && (
                          <span className="ml-1 inline-block text-[9px] font-medium uppercase bg-violet-100 text-violet-700 px-1 py-0.5 rounded" title="Specialist (external)">Spec</span>
                        )}
                        {/* Audit Category pills — one per distinct
                            category this person/client has appeared
                            with. Renders inline with the name so the
                            sensitive scope (PIE / Listed / Charity …)
                            is always visible. */}
                        {row.auditCategories.length > 0 && (
                          <span className="ml-1 inline-flex flex-wrap gap-0.5 align-middle">
                            {row.auditCategories.map(c => (
                              <span key={c} className="text-[9px] px-1 py-0.5 rounded bg-indigo-100 text-indigo-700 border border-indigo-200">
                                {c}
                              </span>
                            ))}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-slate-700">{ROLE_LABEL[row.role] || row.role}</td>
                      <td className="px-2 py-1.5 text-slate-500 text-[10px]">{row.auditCategories.join(', ') || '—'}</td>
                      <td className="px-2 py-1.5">
                        <input
                          type="date"
                          value={fmtDate(row.engagementStartDate)}
                          onChange={e => updateRow(row.id, { engagementStartDate: e.target.value || null })}
                          disabled={isSpec}
                          className="text-[10px] border border-slate-200 rounded px-1 py-0.5 focus:outline-none focus:border-blue-400 disabled:opacity-40"
                          title={isSpec ? 'Specialist dates are derived — not editable here' : ''}
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          type="date"
                          value={fmtDate(row.roleStartedDate)}
                          onChange={e => updateRow(row.id, { roleStartedDate: e.target.value || null })}
                          disabled={isSpec}
                          className="text-[10px] border border-slate-200 rounded px-1 py-0.5 focus:outline-none focus:border-blue-400 disabled:opacity-40"
                          title={isSpec ? 'Specialist dates are derived — not editable here' : ''}
                        />
                      </td>
                      {Array.from({ length: maxPeriods }, (_, i) => (
                        <td key={i} className="px-1 py-1.5 text-center">
                          <input
                            type="checkbox"
                            checked={i < total}
                            disabled
                            className="h-3 w-3"
                            title={i < total ? row.servedPeriods[i].slice(0, 10) : ''}
                          />
                        </td>
                      ))}
                      <td className="px-2 py-1.5 text-center font-semibold text-slate-700">{total}</td>
                      <td className="px-2 py-1.5 text-center text-slate-500">{yrs !== null ? yrs : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            ))}
          </tbody>
        </table>
      </div>

      <div className="text-[10px] text-slate-400">
        Checkboxes are system-derived from engagement history. Engagement Start and Role Started dates are user-entered for team members; specialists are auto-derived and read-only here. RI rows turn amber one period away from the limit, red at or above. Page auto-rebuilds on load — use Refresh for an explicit pull.
      </div>
    </div>
  );
}

/** Per-column multi-select filter header. Renders the column label
 *  with a small Filter icon → clicking pops a checkbox menu of the
 *  distinct values. Empty selection = no filter (everything shown).
 *  Click-away closes by listening on document mousedown. */
function ColumnFilterHeader({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: string[];
  value: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [open]);

  function toggle(v: string) {
    const next = new Set(value);
    if (next.has(v)) next.delete(v); else next.add(v);
    onChange(next);
  }

  return (
    <div ref={wrapRef} className="inline-flex items-center gap-1 relative">
      <span>{label}</span>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className={`inline-flex items-center gap-0.5 text-[10px] px-1 py-0.5 rounded border ${
          value.size > 0 ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-transparent text-slate-400 hover:text-slate-700 hover:border-slate-300'
        }`}
        title="Filter / sort this column"
      >
        <Filter className="h-2.5 w-2.5" />
        {value.size > 0 && <span>{value.size}</span>}
        <ChevronDown className="h-2.5 w-2.5" />
      </button>
      {open && (
        <div className="absolute z-30 top-full left-0 mt-1 w-56 bg-white border border-slate-200 rounded-md shadow-lg p-2 text-[11px] normal-case font-normal text-slate-700">
          <div className="flex items-center justify-between mb-1">
            <button
              type="button"
              onClick={() => onChange(new Set(options))}
              className="text-[10px] text-slate-500 hover:text-slate-800"
            >Select all</button>
            <button
              type="button"
              onClick={() => onChange(new Set())}
              className="text-[10px] text-slate-500 hover:text-slate-800"
            >Clear</button>
          </div>
          <div className="max-h-56 overflow-y-auto">
            {options.length === 0 && (
              <div className="text-[10px] text-slate-400 italic px-1 py-1">No values yet.</div>
            )}
            {options.map(opt => (
              <label key={opt} className="flex items-center gap-1.5 py-0.5 px-1 hover:bg-slate-50 rounded cursor-pointer">
                <input type="checkbox" checked={value.has(opt)} onChange={() => toggle(opt)} className="h-3 w-3" />
                <span className="truncate">{opt || <em className="text-slate-400">(blank)</em>}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
