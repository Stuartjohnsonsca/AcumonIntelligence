'use client';

import { useState, useEffect, useMemo } from 'react';
import { Loader2, RefreshCw, Save, Users } from 'lucide-react';

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

export function TeamFamiliarityClient() {
  const [rows, setRows] = useState<FamiliarityRow[]>([]);
  const [limits, setLimits] = useState<Limits>({ riFamiliarityLimitNonPIE: 10, riFamiliarityLimitPIE: 5 });
  const [loading, setLoading] = useState(true);
  const [rebuilding, setRebuilding] = useState(false);
  const [savingLimits, setSavingLimits] = useState(false);
  const [savingRow, setSavingRow] = useState<string | null>(null);

  useEffect(() => { load(); }, []);

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

  // Group rows by client
  const grouped = useMemo(() => {
    const byClient = new Map<string, { client: { id: string; name: string; isPIE: boolean }; rows: FamiliarityRow[] }>();
    for (const r of rows) {
      if (!byClient.has(r.clientId)) {
        byClient.set(r.clientId, { client: { id: r.clientId, name: r.clientName, isPIE: r.clientIsPIE }, rows: [] });
      }
      byClient.get(r.clientId)!.rows.push(r);
    }
    return Array.from(byClient.values()).sort((a, b) => a.client.name.localeCompare(b.client.name));
  }, [rows]);

  // Determine the max number of "served-period" columns to render
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

  if (loading) return <div className="p-8 text-center text-sm text-slate-400 animate-pulse">Loading team familiarity…</div>;

  return (
    <div className="space-y-6">
      {/* Top controls */}
      <div className="flex items-end gap-4 p-4 bg-slate-50 rounded-lg border border-slate-200">
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
        <button
          onClick={rebuild}
          disabled={rebuilding}
          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-slate-600 text-white rounded hover:bg-slate-700 disabled:opacity-50"
        >
          {rebuilding ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          Rebuild from engagements
        </button>
      </div>

      {/* Table */}
      <div className="border border-slate-200 rounded-lg overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead className="bg-slate-50">
            <tr className="border-b border-slate-200">
              <th className="px-2 py-2 text-left font-semibold text-slate-600 uppercase tracking-wide">Client</th>
              <th className="px-2 py-2 text-left font-semibold text-slate-600 uppercase tracking-wide">Team Member (Role)</th>
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
                <td colSpan={6 + maxPeriods} className="text-center py-8 text-slate-400">
                  <Users className="h-6 w-6 mx-auto text-slate-300 mb-2" />
                  No team familiarity entries yet. Click "Rebuild from engagements" to populate from existing data.
                </td>
              </tr>
            )}
            {grouped.map(group => (
              <>
                <tr key={`hdr-${group.client.id}`} className="bg-slate-100/60 border-t-2 border-slate-200">
                  <td colSpan={6 + maxPeriods} className="px-2 py-1 font-semibold text-slate-700">
                    {group.client.name}
                    {group.client.isPIE && <span className="ml-2 inline-block text-[9px] font-bold uppercase bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">PIE</span>}
                  </td>
                </tr>
                {group.rows.map(row => {
                  const total = row.servedPeriods.length;
                  const yrs = yearsSinceCeasing(row);
                  return (
                    <tr key={row.id} className={`border-b border-slate-100 ${rowColourClass(row)}`}>
                      <td className="px-2 py-1.5 text-slate-400 text-[10px]"></td>
                      <td className="px-2 py-1.5 text-slate-700">
                        {row.userName} <span className="text-slate-400">({ROLE_LABEL[row.role] || row.role})</span>
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          type="date"
                          value={fmtDate(row.engagementStartDate)}
                          onChange={e => updateRow(row.id, { engagementStartDate: e.target.value || null })}
                          className="text-[10px] border border-slate-200 rounded px-1 py-0.5 focus:outline-none focus:border-blue-400"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          type="date"
                          value={fmtDate(row.roleStartedDate)}
                          onChange={e => updateRow(row.id, { roleStartedDate: e.target.value || null })}
                          className="text-[10px] border border-slate-200 rounded px-1 py-0.5 focus:outline-none focus:border-blue-400"
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
              </>
            ))}
          </tbody>
        </table>
      </div>

      <div className="text-[10px] text-slate-400">
        Checkboxes are system-derived from engagement history. Engagement Start and Role Started dates are user-entered.
        RI rows turn amber when one period away from the limit, red when at or above.
      </div>
    </div>
  );
}
