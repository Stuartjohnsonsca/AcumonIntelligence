'use client';

/**
 * Portal Principal first-sign-in setup screen.
 *
 * Layout (per the spec):
 *
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │ Client / Period header                                     │
 *   │ ─ Staff list (collapsible) ────────────────────            │
 *   │    Current approved staff + "+ Add" + "Carry forward" chips│
 *   │    Per-row toggle: "Confirm access" (gates login)          │
 *   │                                                            │
 *   │ ─ Work allocation (collapsible) ────────────────           │
 *   │    Column headers with escalation-day counts               │
 *   │    ┌ FS Line ▸ ▫ TB code 1  [staff1 ▼][staff2 ▼][staff3 ▼]│
 *   │    │         ▸ ▫ TB code 2  [staff1 ▼][staff2 ▼][staff3 ▼]│
 *   │    │                                                       │
 *   │ "Complete setup" button — flips the access gate open       │
 *   └─────────────────────────────────────────────────────────────┘
 */

import { use, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { ChevronDown, ChevronRight, UserPlus, UserX, CheckCircle2, AlertCircle, Loader2, Save } from 'lucide-react';

interface Staff {
  id: string;
  name: string;
  email: string;
  role: string | null;
  accessConfirmed: boolean;
  portalUserId: string | null;
  inheritedFromEngagementId: string | null;
}
interface Suggestion {
  sourceEngagementId: string | null;
  portalUserId: string | null;
  name: string;
  email: string;
  role: string | null;
  source?: 'prior_period' | 'contacts';
}
interface FsGroup {
  fsLineId: string | null;
  fsLineName: string;
  fsStatementName: string | null;
  fsLevelName: string | null;
  tbRows: Array<{ accountCode: string; description: string }>;
}
interface Allocation {
  id: string;
  fsLineId: string | null;
  tbAccountCode: string | null;
  staff1UserId: string | null;
  staff2UserId: string | null;
  staff3UserId: string | null;
}

export default function PortalSetupPage({ params }: { params: Promise<{ engagementId: string }> }) {
  const { engagementId } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') || '';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [state, setState] = useState<any>(null);

  const [openStaff, setOpenStaff] = useState(true);
  const [openAlloc, setOpenAlloc] = useState(true);
  const [expandedFs, setExpandedFs] = useState<Set<string>>(new Set());

  const [addName, setAddName] = useState('');
  const [addEmail, setAddEmail] = useState('');
  const [addRole, setAddRole] = useState('');
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    if (!token) { setError('Session token missing from URL — please log in again.'); setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/portal/setup/engagement?token=${encodeURIComponent(token)}&engagementId=${encodeURIComponent(engagementId)}`, { cache: 'no-store' });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        throw new Error(data?.error || `Failed (${r.status})`);
      }
      setState(await r.json());
    } catch (err: any) {
      setError(err?.message || 'Failed to load setup');
    } finally {
      setLoading(false);
    }
  }, [token, engagementId]);

  useEffect(() => { load(); }, [load]);

  // ── Staff actions ──────────────────────────────────────────────────
  async function addStaff(name: string, email: string, role: string, inheritedFromEngagementId?: string, preConfirm?: boolean) {
    setAdding(true);
    try {
      const r = await fetch(`/api/portal/setup/staff?token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ engagementId, name, email, role: role || null, inheritedFromEngagementId: inheritedFromEngagementId || null, accessConfirmed: !!preConfirm }),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        throw new Error(data?.error || `Failed (${r.status})`);
      }
      setAddName(''); setAddEmail(''); setAddRole('');
      await load();
    } catch (err: any) {
      setError(err?.message || 'Failed to add staff');
    } finally {
      setAdding(false);
    }
  }

  async function updateStaff(staffId: string, patch: Partial<{ accessConfirmed: boolean; role: string | null; name: string }>) {
    try {
      const r = await fetch(`/api/portal/setup/staff/${staffId}?token=${encodeURIComponent(token)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!r.ok) throw new Error(`Failed (${r.status})`);
      await load();
    } catch (err: any) {
      setError(err?.message || 'Update failed');
    }
  }

  async function removeStaff(staffId: string) {
    if (!confirm('Remove this staff member? They will lose access immediately. You can re-add them later.')) return;
    try {
      const r = await fetch(`/api/portal/setup/staff/${staffId}?token=${encodeURIComponent(token)}`, { method: 'DELETE' });
      if (!r.ok) throw new Error(`Failed (${r.status})`);
      await load();
    } catch (err: any) {
      setError(err?.message || 'Remove failed');
    }
  }

  // ── Allocation actions ─────────────────────────────────────────────
  // Optimistic save: update local state FIRST so the dropdown commits
  // instantly, fire the server save in the background, and only
  // reconcile if the server echoes something different or errors.
  // Previously we called load() after every save, which refetched the
  // whole page (staff list + suggestions + FS Lines + TB rows + all
  // allocations + escalation days) and felt slow when changing
  // dropdowns in rapid succession.
  async function saveAllocation(alloc: Partial<Allocation> & { fsLineId: string | null; tbAccountCode: string | null; staff1UserId: string | null; staff2UserId: string | null; staff3UserId: string | null; }) {
    // 1) Optimistic local update — merge the new row into state.allocations.
    setState((prev: any) => {
      if (!prev) return prev;
      const list: Allocation[] = Array.isArray(prev.allocations) ? prev.allocations : [];
      const idx = list.findIndex(a => a.fsLineId === alloc.fsLineId && a.tbAccountCode === alloc.tbAccountCode);
      const merged: Allocation = idx >= 0
        ? { ...list[idx], ...alloc }
        : { id: `pending-${alloc.fsLineId || 'catch'}-${alloc.tbAccountCode || 'all'}`, fsLineId: alloc.fsLineId, tbAccountCode: alloc.tbAccountCode, staff1UserId: alloc.staff1UserId, staff2UserId: alloc.staff2UserId, staff3UserId: alloc.staff3UserId };
      const next = idx >= 0
        ? [...list.slice(0, idx), merged, ...list.slice(idx + 1)]
        : [...list, merged];
      return { ...prev, allocations: next };
    });

    // 2) Background server save. On success, swap the optimistic row
    //    for the server-authoritative one (mainly to pick up the real
    //    id). On failure, roll back + surface the error.
    try {
      const r = await fetch(`/api/portal/setup/allocation?token=${encodeURIComponent(token)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ engagementId, ...alloc }),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        throw new Error(data?.error || `Failed (${r.status})`);
      }
      const body = await r.json().catch(() => null);
      if (body?.allocation) {
        setState((prev: any) => {
          if (!prev) return prev;
          const list: Allocation[] = Array.isArray(prev.allocations) ? prev.allocations : [];
          const idx = list.findIndex(a => a.fsLineId === alloc.fsLineId && a.tbAccountCode === alloc.tbAccountCode);
          if (idx < 0) return prev;
          return { ...prev, allocations: [...list.slice(0, idx), body.allocation, ...list.slice(idx + 1)] };
        });
      }
    } catch (err: any) {
      setError(err?.message || 'Save failed');
      // Hard reload only on failure so the UI reflects the true
      // server state — optimistic update on the happy path stays.
      await load();
    }
  }

  async function completeSetup() {
    setBanner(null); setError(null);
    try {
      const r = await fetch(`/api/portal/setup/complete?token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ engagementId }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data?.error || `Failed (${r.status})`);
      // Setup complete → bounce straight back to the portal home.
      // Short confirmation flash first so the Principal sees the
      // success state before we navigate away. The home dashboard
      // will show the green "Manage — <client>" row for this
      // engagement (via /api/portal/my-engagements).
      setBanner('Setup complete — taking you back to your dashboard…');
      setTimeout(() => {
        router.push(`/portal/dashboard?token=${encodeURIComponent(token)}`);
      }, 900);
    } catch (err: any) {
      setError(err?.message || 'Could not complete setup');
    }
  }

  async function undoComplete() {
    try {
      const r = await fetch(`/api/portal/setup/complete?token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ engagementId, undo: true }),
      });
      if (!r.ok) throw new Error('Undo failed');
      await load();
    } catch (err: any) {
      setError(err?.message || 'Undo failed');
    }
  }

  // ── Rendering ──────────────────────────────────────────────────────
  const approvedStaff: Staff[] = useMemo(() => (state?.staff ?? []).filter((s: Staff) => s.accessConfirmed), [state]);
  const stafffMap = useMemo(() => {
    const m = new Map<string, Staff>();
    for (const s of state?.staff ?? []) { if (s.portalUserId) m.set(s.portalUserId, s); }
    return m;
  }, [state]);
  const principalOption = useMemo(() => ({
    id: state?.engagement?.portalPrincipalId ?? null,
    label: 'Portal Principal (you)',
  }), [state]);

  function getAllocationFor(fsLineId: string | null, tbAccountCode: string | null): Allocation | null {
    const list: Allocation[] = state?.allocations ?? [];
    return list.find(a => a.fsLineId === fsLineId && a.tbAccountCode === tbAccountCode) || null;
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-slate-500 inline-flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />Loading setup…</div>
      </div>
    );
  }
  if (error && !state) {
    return (
      <div className="min-h-screen bg-slate-50 p-6">
        <div className="max-w-2xl mx-auto bg-white border border-red-200 rounded-lg p-6">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
            <div>
              <h2 className="text-lg font-semibold text-slate-800 mb-1">Setup unavailable</h2>
              <p className="text-sm text-slate-600">{error}</p>
              <button onClick={() => router.push('/portal/dashboard?token=' + token)} className="text-sm text-blue-600 hover:underline mt-3">Back to dashboard</button>
            </div>
          </div>
        </div>
      </div>
    );
  }
  if (!state) return null;

  const eng = state.engagement;
  const periodLabel = [eng.periodStart, eng.periodEnd].filter(Boolean).map((d: string) => new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })).join(' – ');
  const setupComplete = !!eng.setupCompletedAt;
  const escDays: { days1: number; days2: number; days3: number } = state.escalationDays;

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-5xl mx-auto space-y-5">
        {/* Header */}
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs text-slate-500 uppercase tracking-wide">Portal Principal Setup</p>
              <h1 className="text-xl font-semibold text-slate-800 mt-0.5">{eng.clientName}</h1>
              <p className="text-sm text-slate-600 mt-0.5">{periodLabel} · {eng.auditType}</p>
            </div>
            <div className="flex items-center gap-2">
              {setupComplete ? (
                <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs">
                  <CheckCircle2 className="w-3.5 h-3.5" />Setup complete
                </span>
              ) : (
                <button
                  onClick={completeSetup}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-emerald-600 text-white text-sm hover:bg-emerald-700"
                >
                  <CheckCircle2 className="w-4 h-4" />Complete setup
                </button>
              )}
            </div>
          </div>
          {!setupComplete && (
            <p className="text-xs text-amber-700 mt-3 bg-amber-50 border border-amber-200 rounded p-2">
              While setup is outstanding, <strong>no staff member can log in</strong>. They see a blocking message until you click &quot;Complete setup&quot;. You can re-open setup at any time to revise access or allocations.
            </p>
          )}
          {setupComplete && (
            <div className="text-xs text-slate-500 mt-2 flex items-center justify-between">
              <span>Completed {new Date(eng.setupCompletedAt).toLocaleString('en-GB')} — staff can now log in.</span>
              <button onClick={undoComplete} className="text-slate-500 hover:text-red-600 underline">Re-open setup</button>
            </div>
          )}
          {banner && <p className="text-xs text-emerald-700 mt-2 bg-emerald-50 border border-emerald-200 rounded p-2">{banner}</p>}
          {error && <p className="text-xs text-red-700 mt-2 bg-red-50 border border-red-200 rounded p-2">{error}</p>}
        </div>

        {/* Collapsible: Staff */}
        <div className="bg-white border border-slate-200 rounded-lg">
          <button
            onClick={() => setOpenStaff(o => !o)}
            className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-slate-50"
          >
            <div>
              <h2 className="text-sm font-semibold text-slate-800">Staff</h2>
              <p className="text-xs text-slate-500 mt-0.5">{state.staff.length} on list · {approvedStaff.length} approved · {state.suggestions.length} suggested from prior/related periods</p>
            </div>
            {openStaff ? <ChevronDown className="w-4 h-4 text-slate-500" /> : <ChevronRight className="w-4 h-4 text-slate-500" />}
          </button>

          {openStaff && (
            <div className="border-t border-slate-200 p-5 space-y-4">
              {/* Suggestions — split by source. Prior-period pills are
                  blue (strong recommendation: same team, same client);
                  contacts pills are slate (weaker: the audit team added
                  them but there's no prior history to vouch for them). */}
              {state.suggestions.length > 0 && (
                <div className="space-y-3">
                  {state.suggestions.some((s: Suggestion) => s.source !== 'contacts') && (
                    <div>
                      <p className="text-xs font-medium text-slate-600 mb-2">Suggested from prior period or related group company</p>
                      <div className="flex flex-wrap gap-2">
                        {state.suggestions
                          .filter((s: Suggestion) => s.source !== 'contacts')
                          .map((s: Suggestion) => (
                            <button
                              key={s.email}
                              onClick={() => addStaff(s.name, s.email, s.role || '', s.sourceEngagementId || undefined, true)}
                              disabled={adding}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-full border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-50"
                              title={`Add ${s.name} (${s.email}) with access pre-confirmed`}
                            >
                              <UserPlus className="w-3 h-3" />
                              {s.name} {s.role ? `— ${s.role}` : ''}
                            </button>
                          ))}
                      </div>
                    </div>
                  )}
                  {state.suggestions.some((s: Suggestion) => s.source === 'contacts') && (
                    <div>
                      <p className="text-xs font-medium text-slate-600 mb-2">
                        Added by your audit team via the Contacts list — approve to grant engagement access
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {state.suggestions
                          .filter((s: Suggestion) => s.source === 'contacts')
                          .map((s: Suggestion) => (
                            <button
                              key={s.email}
                              onClick={() => addStaff(s.name, s.email, s.role || '', undefined, true)}
                              disabled={adding}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-full border border-slate-300 bg-slate-50 text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                              title={`Add ${s.name} (${s.email}) with access pre-confirmed`}
                            >
                              <UserPlus className="w-3 h-3" />
                              {s.name} {s.role ? `— ${s.role}` : ''}
                            </button>
                          ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Manual add */}
              <div className="border border-dashed border-slate-300 rounded-md p-3">
                <p className="text-xs font-medium text-slate-600 mb-2">Add a new staff member</p>
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                  <input value={addName} onChange={e => setAddName(e.target.value)} placeholder="Name" className="text-sm border border-slate-300 rounded-md px-3 py-1.5" />
                  <input value={addEmail} onChange={e => setAddEmail(e.target.value)} placeholder="Email" type="email" className="text-sm border border-slate-300 rounded-md px-3 py-1.5" />
                  <input value={addRole} onChange={e => setAddRole(e.target.value)} placeholder="Role (optional)" className="text-sm border border-slate-300 rounded-md px-3 py-1.5" />
                  <button
                    onClick={() => addName && addEmail && addStaff(addName.trim(), addEmail.trim(), addRole.trim(), undefined, false)}
                    disabled={adding || !addName.trim() || !addEmail.trim()}
                    className="inline-flex items-center justify-center gap-1 px-3 py-1.5 text-xs rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    <UserPlus className="w-3.5 h-3.5" />Add
                  </button>
                </div>
                <p className="text-[11px] text-slate-500 mt-1">New users will get a password-reset link on first login via the &quot;Forgot password&quot; flow.</p>
              </div>

              {/* Current staff */}
              {state.staff.length === 0 ? (
                <p className="text-xs text-slate-500 italic">No staff added yet.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-slate-500 border-b border-slate-200">
                      <th className="text-left font-medium py-2">Name</th>
                      <th className="text-left font-medium">Email</th>
                      <th className="text-left font-medium">Role</th>
                      <th className="text-center font-medium">Access</th>
                      <th className="text-right font-medium"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.staff.map((s: Staff) => (
                      <tr key={s.id} className="border-b border-slate-100 last:border-0">
                        <td className="py-2 text-slate-800">{s.name}</td>
                        <td className="text-slate-600">{s.email}</td>
                        <td className="text-slate-500">{s.role || '—'}</td>
                        <td className="text-center">
                          <button
                            onClick={() => updateStaff(s.id, { accessConfirmed: !s.accessConfirmed })}
                            className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-full border ${s.accessConfirmed ? 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100' : 'bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100'}`}
                            title={s.accessConfirmed ? 'Access confirmed — click to revoke' : 'Click to confirm access'}
                          >
                            {s.accessConfirmed ? <><CheckCircle2 className="w-3 h-3" />Confirmed</> : 'Click to confirm'}
                          </button>
                        </td>
                        <td className="text-right">
                          <button onClick={() => removeStaff(s.id)} className="text-slate-400 hover:text-red-600 p-1" title="Remove">
                            <UserX className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>

        {/* Collapsible: Work Allocation. id="work-allocation" lets
            the Portal Principal Dashboard's "Work Allocation" button
            hash-link straight to this section via scroll-margin-top
            so the section header lands below any sticky chrome. */}
        <div id="work-allocation" className="bg-white border border-slate-200 rounded-lg scroll-mt-20">
          <button
            onClick={() => setOpenAlloc(o => !o)}
            className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-slate-50"
          >
            <div>
              <h2 className="text-sm font-semibold text-slate-800">Work Allocation</h2>
              <p className="text-xs text-slate-500 mt-0.5">{state.fsLineGroups.length} FS Lines — assign up to 3 staff per line or per TB code</p>
            </div>
            {openAlloc ? <ChevronDown className="w-4 h-4 text-slate-500" /> : <ChevronRight className="w-4 h-4 text-slate-500" />}
          </button>

          {openAlloc && (
            <div className="border-t border-slate-200">
              {/* Data-quality warnings — surface any TB rows we dropped
                  from the grid so the Portal Principal knows to chase
                  the audit team. "No description" = unfair to ask
                  about; "unclassified" = TBCYvPY never ran. */}
              {(state.dataQuality?.droppedNoDescriptionCount > 0 || state.dataQuality?.droppedUnclassifiedCount > 0) && (
                <div className="bg-amber-50 border-b border-amber-200 px-5 py-3 text-xs text-amber-800">
                  <p className="font-medium mb-1">Some TB codes were not included in the grid</p>
                  <ul className="space-y-0.5 list-disc pl-5">
                    {state.dataQuality.droppedNoDescriptionCount > 0 && (
                      <li>
                        <strong>{state.dataQuality.droppedNoDescriptionCount}</strong> TB code{state.dataQuality.droppedNoDescriptionCount === 1 ? '' : 's'} with a blank description — you can&apos;t reasonably allocate staff without a description.
                        Ask the audit team to fix the TB import.
                        {state.dataQuality.droppedNoDescription?.length > 0 && (
                          <span className="block text-[11px] mt-0.5 text-amber-700">
                            Examples: {state.dataQuality.droppedNoDescription.slice(0, 8).join(', ')}{state.dataQuality.droppedNoDescription.length > 8 ? ` … (+${state.dataQuality.droppedNoDescription.length - 8} more)` : ''}
                          </span>
                        )}
                      </li>
                    )}
                    {state.dataQuality.droppedUnclassifiedCount > 0 && (
                      <li>
                        <strong>{state.dataQuality.droppedUnclassifiedCount}</strong> TB code{state.dataQuality.droppedUnclassifiedCount === 1 ? '' : 's'} have no FS Line classification at all. Ask the audit team to run TBCYvPY classification on the engagement.
                        {state.dataQuality.droppedUnclassified?.length > 0 && (
                          <span className="block text-[11px] mt-0.5 text-amber-700">
                            Examples: {state.dataQuality.droppedUnclassified.slice(0, 8).join(', ')}{state.dataQuality.droppedUnclassified.length > 8 ? ` … (+${state.dataQuality.droppedUnclassified.length - 8} more)` : ''}
                          </span>
                        )}
                      </li>
                    )}
                  </ul>
                </div>
              )}

              {/* Column header with escalation days */}
              <div className="grid grid-cols-[minmax(200px,3fr)_1fr_1fr_1fr] gap-3 px-5 py-3 bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
                <div className="font-medium">FS Line / TB code</div>
                {[1, 2, 3].map(col => (
                  <div key={col} className="text-center">
                    <div className="font-medium text-slate-700">Column {col}</div>
                    <div className="text-[11px]">{(escDays as any)[`days${col}`]} day{(escDays as any)[`days${col}`] === 1 ? '' : 's'} to escalate</div>
                  </div>
                ))}
              </div>

              <div className="divide-y divide-slate-100">
                {state.fsLineGroups.map((g: FsGroup) => {
                  const key = g.fsLineId ?? '__unmapped__';
                  const isExpanded = expandedFs.has(key);
                  const alloc = getAllocationFor(g.fsLineId, null);
                  // Per-column child coverage: for each of the 3 columns,
                  // do ALL TB codes under this FS Line have a non-null
                  // staff? If yes, the FS-Line-level dropdown renders
                  // "— assigned (via TB codes) —" because requests at
                  // the TB-code level route directly and the FS-Line
                  // fallback never fires. FS Lines with zero TB rows
                  // (shouldn't normally happen but defensive) get all
                  // false so the original "unassigned" text shows.
                  const childCoverageByColumn: [boolean, boolean, boolean] = g.tbRows.length === 0
                    ? [false, false, false]
                    : ([1, 2, 3] as const).map(col => {
                        const k = `staff${col}UserId` as 'staff1UserId' | 'staff2UserId' | 'staff3UserId';
                        return g.tbRows.every(tb => {
                          const tbAlloc = getAllocationFor(g.fsLineId, tb.accountCode);
                          return !!(tbAlloc && tbAlloc[k]);
                        });
                      }) as [boolean, boolean, boolean];
                  return (
                    <div key={key}>
                      <AllocationRow
                        label={(
                          <button
                            type="button"
                            onClick={() => {
                              setExpandedFs(prev => {
                                const next = new Set(prev);
                                if (next.has(key)) next.delete(key); else next.add(key);
                                return next;
                              });
                            }}
                            // w-full + justify-start + text-left force
                            // consistent left alignment regardless of
                            // the browser's default button centering,
                            // grid-cell stretch behaviour, or FS Line
                            // name length. Without these, a short FS
                            // Line name can appear centered in the
                            // column while longer names look left-
                            // aligned — which is what the user was
                            // seeing on "one specific row".
                            className="flex w-full items-center justify-start gap-1.5 text-left text-sm font-medium text-slate-800 hover:text-blue-700"
                          >
                            {isExpanded ? <ChevronDown className="w-4 h-4 text-slate-500 flex-shrink-0" /> : <ChevronRight className="w-4 h-4 text-slate-500 flex-shrink-0" />}
                            <span className="truncate">{g.fsLineName}</span>
                            <span className="text-[11px] text-slate-400 flex-shrink-0">({g.tbRows.length} TB)</span>
                          </button>
                        )}
                        staffOptions={approvedStaff}
                        principalOption={principalOption}
                        alloc={alloc}
                        childCoverageByColumn={childCoverageByColumn}
                        onChange={(staffSlot, userId) => saveAllocation({
                          fsLineId: g.fsLineId,
                          tbAccountCode: null,
                          staff1UserId: staffSlot === 1 ? userId : alloc?.staff1UserId ?? null,
                          staff2UserId: staffSlot === 2 ? userId : alloc?.staff2UserId ?? null,
                          staff3UserId: staffSlot === 3 ? userId : alloc?.staff3UserId ?? null,
                        })}
                      />
                      {isExpanded && g.tbRows.map(tb => {
                        const tbAlloc = getAllocationFor(g.fsLineId, tb.accountCode);
                        return (
                          <AllocationRow
                            key={tb.accountCode}
                            label={(
                              <div className="pl-6 text-xs text-slate-700">
                                <span className="font-mono text-slate-500 mr-2">{tb.accountCode}</span>
                                {tb.description}
                              </div>
                            )}
                            staffOptions={approvedStaff}
                            principalOption={principalOption}
                            alloc={tbAlloc}
                            onChange={(staffSlot, userId) => saveAllocation({
                              fsLineId: g.fsLineId,
                              tbAccountCode: tb.accountCode,
                              staff1UserId: staffSlot === 1 ? userId : tbAlloc?.staff1UserId ?? null,
                              staff2UserId: staffSlot === 2 ? userId : tbAlloc?.staff2UserId ?? null,
                              staff3UserId: staffSlot === 3 ? userId : tbAlloc?.staff3UserId ?? null,
                            })}
                          />
                        );
                      })}
                    </div>
                  );
                })}
                {state.fsLineGroups.length === 0 && (
                  <div className="px-5 py-6 text-xs text-slate-500 italic">
                    No FS Lines on this engagement yet. Ask the audit team to import the TB and map FS lines before doing work allocation.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="text-xs text-slate-500 text-center py-2">
          Requests the audit team send will route to the leftmost assigned staff. If no response within the column&apos;s escalation days, the next column is notified. After all three, the request returns to you.
        </div>
      </div>
    </div>
  );
}

// ─── Allocation-row sub-component ──────────────────────────────────

interface AllocationRowProps {
  label: React.ReactNode;
  staffOptions: Staff[];
  principalOption: { id: string | null; label: string };
  alloc: Allocation | null;
  onChange: (staffSlot: 1 | 2 | 3, userId: string | null) => void;
  /**
   * Per-column coverage status from child (TB-code) allocations, for the
   * parent (FS-Line) row only. Index 0 = column 1, etc. When an entry is
   * true, the FS-Line row's dropdown — if still null at this level —
   * swaps its placeholder from "unassigned" to "assigned (via TB codes)"
   * because every TB code underneath already has a named staff member
   * for that column. TB-code rows (no children) pass undefined and keep
   * the original placeholder.
   */
  childCoverageByColumn?: [boolean, boolean, boolean];
}

function AllocationRow({ label, staffOptions, principalOption, alloc, onChange, childCoverageByColumn }: AllocationRowProps) {
  return (
    <div className="grid grid-cols-[minmax(200px,3fr)_1fr_1fr_1fr] gap-3 px-5 py-2 items-center hover:bg-slate-50">
      <div>{label}</div>
      {([1, 2, 3] as const).map(col => {
        const key = `staff${col}UserId` as 'staff1UserId' | 'staff2UserId' | 'staff3UserId';
        const current = (alloc?.[key] as string | null) ?? null;
        const childrenFull = !!childCoverageByColumn?.[col - 1];
        // Placeholder logic:
        //   current set   → the value overrides; dropdown shows the name
        //   current null + childrenFull → "— assigned (via TB codes) —"
        //   current null + !childrenFull → "— unassigned (falls back) —"
        const placeholder = childrenFull
          ? '— assigned (via TB codes) —'
          : '— unassigned (falls back) —';
        return (
          <select
            key={col}
            value={current || ''}
            onChange={e => onChange(col, e.target.value || null)}
            className={`text-xs border rounded-md px-2 py-1.5 bg-white ${childrenFull && !current ? 'border-emerald-300 text-emerald-700' : 'border-slate-300'}`}
            title={childrenFull && !current ? 'All TB codes under this FS Line are allocated for this column — requests at TB level route directly; the FS-Line fallback is not needed.' : undefined}
          >
            <option value="">{placeholder}</option>
            {principalOption.id && <option value={principalOption.id}>{principalOption.label}</option>}
            {staffOptions.map(s => (
              <option key={s.portalUserId || s.id} value={s.portalUserId || ''}>{s.name}</option>
            ))}
          </select>
        );
      })}
    </div>
  );
}
