'use client';

/**
 * Opening-tab panel for designating the Portal Principal on a client
 * and, if wanted, overriding the firm-wide escalation-day defaults.
 *
 * The Portal Principal is the ClientPortalUser who will curate the
 * staff list + work allocations on the client side. Until one is
 * designated, no staff member can log into this engagement via the
 * portal — the access gate on /api/portal/auth/login enforces that.
 *
 * Escalation days: three integers, one per "column" of the work
 * allocation grid. The Portal Principal sees Day-1 → Day-2 → Day-3
 * → Portal Principal as the cascade when a staff member is slow to
 * respond. Leaving a column blank means "fall back to firm default".
 */

import { useCallback, useEffect, useState } from 'react';

interface Candidate {
  id: string;
  name: string;
  email: string;
  role?: string | null;
  isClientAdmin?: boolean;
}

interface State {
  portalPrincipalId: string | null;
  overrides: { days1: number | null; days2: number | null; days3: number | null };
  resolved: { days1: number; days2: number; days3: number; source: string };
  setupCompletedAt: string | null;
  candidates: Candidate[];
}

interface Props {
  engagementId: string;
}

export function PortalPrincipalPanel({ engagementId }: Props) {
  const [state, setState] = useState<State | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/engagements/${engagementId}/portal-principal`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`Load failed (${res.status})`);
      const data = await res.json();
      setState(data);
    } catch (err: any) {
      setError(err?.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [engagementId]);

  useEffect(() => { load(); }, [load]);

  const save = useCallback(async (patch: Partial<{ portalPrincipalId: string | null; portalEscalationDays1: number | null; portalEscalationDays2: number | null; portalEscalationDays3: number | null }>) => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/engagements/${engagementId}/portal-principal`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || `Save failed (${res.status})`);
      }
      await load();
    } catch (err: any) {
      setError(err?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [engagementId, load]);

  if (loading) {
    return (
      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <div className="h-5 w-40 bg-slate-100 rounded animate-pulse mb-3" />
        <div className="h-4 w-64 bg-slate-100 rounded animate-pulse" />
      </div>
    );
  }
  if (!state) return null;

  const candidates = state.candidates || [];
  const principal = candidates.find(c => c.id === state.portalPrincipalId) || null;
  const setupComplete = !!state.setupCompletedAt;

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">Portal Principal</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Designate one client portal user to curate the staff list and work allocations. Staff members cannot log in until the Portal Principal has confirmed their access.
          </p>
        </div>
        <div className="text-xs flex items-center gap-2">
          {saving && <span className="text-slate-500">Saving…</span>}
          {setupComplete ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              Setup complete
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
              Awaiting setup
            </span>
          )}
        </div>
      </div>

      {error && (
        <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">{error}</div>
      )}

      {/* Principal picker */}
      <div>
        <label className="block text-xs font-medium text-slate-700 mb-1">Portal Principal (client-side)</label>
        <div className="flex items-center gap-2">
          <select
            className="flex-1 text-sm border border-slate-300 rounded-md px-3 py-2 bg-white"
            value={state.portalPrincipalId || ''}
            disabled={saving}
            onChange={e => save({ portalPrincipalId: e.target.value || null })}
          >
            <option value="">— Not set —</option>
            {candidates.map(c => (
              <option key={c.id} value={c.id}>
                {c.name} — {c.email}{c.role ? ` (${c.role})` : ''}
              </option>
            ))}
          </select>
          {principal && (
            <a
              href={`mailto:${principal.email}?subject=Your%20audit%20portal%20access`}
              className="text-xs text-blue-600 hover:underline whitespace-nowrap"
            >
              Email
            </a>
          )}
        </div>
        {candidates.length === 0 && (
          <p className="text-xs text-amber-700 mt-1">
            No active portal users found for this client. Set one up in Client Contacts first.
          </p>
        )}
      </div>

      {/* Escalation days */}
      <div>
        <label className="block text-xs font-medium text-slate-700 mb-1">Response SLA — days before next escalation</label>
        <p className="text-xs text-slate-500 mb-2">
          If a column-1 staff member has not responded within <em>Column 1</em> days, column-2 is also notified. Same again for column-3. After all three elapse, the Portal Principal gets the escalation. Leave blank to fall back to the firm-wide defaults.
        </p>
        <div className="grid grid-cols-3 gap-3">
          {[1, 2, 3].map(col => {
            const key = `days${col}` as 'days1' | 'days2' | 'days3';
            const override = state.overrides[key];
            const resolvedValue = state.resolved[key];
            const id = `escalation-col-${col}`;
            return (
              <div key={col}>
                <label htmlFor={id} className="block text-[11px] text-slate-600 mb-0.5">Column {col}</label>
                <div className="relative">
                  <input
                    id={id}
                    type="number"
                    min={1}
                    max={90}
                    step={1}
                    className="w-full text-sm border border-slate-300 rounded-md pl-3 pr-16 py-2"
                    value={override ?? ''}
                    placeholder={String(resolvedValue)}
                    disabled={saving}
                    onChange={e => {
                      const v = e.target.value;
                      setState(s => s ? { ...s, overrides: { ...s.overrides, [key]: v === '' ? null : Number(v) } } : s);
                    }}
                    onBlur={e => {
                      const v = e.target.value;
                      const patchKey = col === 1 ? 'portalEscalationDays1' : col === 2 ? 'portalEscalationDays2' : 'portalEscalationDays3';
                      save({ [patchKey]: v === '' ? null : Number(v) } as any);
                    }}
                  />
                  <span className="pointer-events-none absolute inset-y-0 right-3 text-xs text-slate-400 flex items-center">days</span>
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  Current: <strong className="text-slate-700">{resolvedValue} day{resolvedValue === 1 ? '' : 's'}</strong>
                  <span className="text-slate-400"> ({state.resolved.source === 'engagement-override' && (override != null) ? 'engagement' : state.resolved.source === 'firm-default' ? 'firm default' : 'default'})</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
