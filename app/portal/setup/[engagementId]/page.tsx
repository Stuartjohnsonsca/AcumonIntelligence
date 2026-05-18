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

import { use, useCallback, useEffect, useMemo, useState, Fragment } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { ChevronDown, ChevronRight, UserPlus, UserX, CheckCircle2, AlertCircle, Loader2, Save, MessageSquare, ArrowLeft, Shield } from 'lucide-react';
import { MessagingChannelsEditor, type ChannelsState } from '@/components/portal/MessagingChannelsEditor';

interface Staff {
  id: string;
  name: string;
  email: string;
  role: string | null;
  accessConfirmed: boolean;
  portalUserId: string | null;
  inheritedFromEngagementId: string | null;
  // Channel hints — pre-filled by the Portal Principal during setup,
  // mirrored through to the linked ClientPortalUser on the server so
  // outbound notifyPortalUser() calls see them right away.
  whatsappNumber?: string | null;
  whatsappOptIn?: boolean;
  telegramHandle?: string | null;
  telegramOptIn?: boolean;
  smsNumber?: string | null;
  smsOptIn?: boolean;
  wechatOptIn?: boolean;
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
  // Per-row expand state for the messaging channel editor on the
  // staff table. Defaults to closed so the row stays compact.
  const [expandedStaffChannels, setExpandedStaffChannels] = useState<Set<string>>(new Set());
  const toggleStaffChannels = useCallback((id: string) => {
    setExpandedStaffChannels(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);
  // Optimistic merge: when the editor reports a channel change we
  // overlay the patch onto the staff row so the chip summary up the
  // page refreshes immediately, before the server roundtrips.
  const mergeStaffChannels = useCallback((id: string, next: { whatsappNumber: string | null; whatsappOptIn: boolean; telegramHandle: string | null; telegramOptIn: boolean; smsNumber: string | null; smsOptIn: boolean; wechatOptIn?: boolean }) => {
    setState((prev: any) => {
      if (!prev) return prev;
      const updated = prev.staff?.map((s: Staff) =>
        s.id === id ? { ...s, ...next } : s,
      ) || [];
      return { ...prev, staff: updated };
    });
  }, []);

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

  // Re-fetch state when the tab regains focus. The escalation days
  // shown above the allocation grid are owned by the Opening tab on
  // the firm side — if the auditor changes them while this page is
  // sitting open in another tab, the days here would otherwise stay
  // stale until manual reload. Same applies to FS-Line groups and
  // staff suggestions, both of which the audit team can edit
  // server-side while the Principal has this page open.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    function onVisible() {
      if (document.visibilityState === 'visible') load();
    }
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [load]);

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
        {/* Back to dashboard — outside the white header card so it's
            visible the moment the page renders, regardless of how far
            down the user has scrolled. Pushes the same /portal/dashboard
            URL the page-error branch above uses, with the session
            token preserved so the user lands logged-in. */}
        <button
          onClick={() => router.push('/portal/dashboard?token=' + token)}
          className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-blue-700"
        >
          <ArrowLeft className="w-4 h-4" /> Back to dashboard
        </button>

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

        {/* Security — 2FA trust-days setting. The Portal Principal
            controls how long a previously-2FA'd browser can re-login
            with just username + password before 2FA kicks back in. A
            different machine has no trust cookie and always falls
            back to 2FA, so a stolen password alone never gets the
            attacker in. */}
        <SecurityCard
          engagementId={engagementId}
          token={token}
          initial={eng.portal2faTrustDays ?? null}
          onSaved={() => { setBanner('2FA trust window updated.'); load(); }}
        />

        {/* WeCom group join URL — paste-once setting. The audit firm
            sends the Principal a WeCom group invite (URL or QR image
            URL) out-of-band (email / kickoff meeting). Principal
            pastes it here once. Staff see it read-only on their
            My Details page when they pick WeChat preference and can
            scan to join. Only the Portal Principal can edit; the
            audit firm controls the WeCom group itself (admin rights),
            so other client users can't kick the firm out or remove
            content. */}
        <WeComJoinCard
          engagementId={engagementId}
          token={token}
          initial={eng.wecomJoinUrl ?? null}
          onSaved={() => { setBanner('WeCom join URL updated.'); load(); }}
        />

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
                      <th className="text-left font-medium py-2 w-8"></th>
                      <th className="text-left font-medium py-2">Name</th>
                      <th className="text-left font-medium">Email</th>
                      <th className="text-left font-medium">Role</th>
                      <th className="text-center font-medium">Access</th>
                      <th className="text-right font-medium"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.staff.map((s: Staff) => {
                      const isExpanded = expandedStaffChannels.has(s.id);
                      // Quick visual signal — coloured pill summarising
                      // which of the three channels the staff has any
                      // contact value AND opt-in for. Cheaper than
                      // re-rendering the whole editor in the row.
                      const channelChips: string[] = [];
                      if (s.whatsappNumber && s.whatsappOptIn) channelChips.push('WhatsApp');
                      if (s.telegramHandle && s.telegramOptIn) channelChips.push('Telegram');
                      if (s.smsNumber && s.smsOptIn) channelChips.push('SMS');
                      // WeChat is opt-in-only at the staff-hint level —
                      // the actual OpenID binding happens on the user
                      // side. Showing the chip when they've ticked
                      // opt-in flags "this user wants WeChat" even if
                      // they haven't scanned yet.
                      if (s.wechatOptIn) channelChips.push('WeChat');
                      return (
                        <Fragment key={s.id}>
                          <tr className="border-b border-slate-100 last:border-0">
                            <td className="py-2 align-top">
                              <button
                                onClick={() => toggleStaffChannels(s.id)}
                                className="p-1 text-slate-400 hover:text-blue-600"
                                title={isExpanded ? 'Hide messaging channels' : 'Edit messaging channels'}
                              >
                                {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                              </button>
                            </td>
                            <td className="py-2 text-slate-800 align-top">
                              <div>{s.name}</div>
                              {channelChips.length > 0 && (
                                <div className="text-[10px] text-blue-700 inline-flex items-center gap-1 mt-0.5">
                                  <MessageSquare className="h-3 w-3" />
                                  {channelChips.join(' · ')}
                                </div>
                              )}
                            </td>
                            <td className="text-slate-600 align-top">{s.email}</td>
                            <td className="text-slate-500 align-top">{s.role || '—'}</td>
                            <td className="text-center align-top">
                              <button
                                onClick={() => updateStaff(s.id, { accessConfirmed: !s.accessConfirmed })}
                                className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-full border ${s.accessConfirmed ? 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100' : 'bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100'}`}
                                title={s.accessConfirmed ? 'Access confirmed — click to revoke' : 'Click to confirm access'}
                              >
                                {s.accessConfirmed ? <><CheckCircle2 className="w-3 h-3" />Confirmed</> : 'Click to confirm'}
                              </button>
                            </td>
                            <td className="text-right align-top">
                              <button onClick={() => removeStaff(s.id)} className="text-slate-400 hover:text-red-600 p-1" title="Remove">
                                <UserX className="w-4 h-4" />
                              </button>
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr className="bg-slate-50/60 border-b border-slate-100">
                              <td></td>
                              <td colSpan={5} className="py-3 pr-3">
                                <MessagingChannelsEditor
                                  mode="staff"
                                  token={token}
                                  staffId={s.id}
                                  compact
                                  value={{
                                    whatsappNumber: s.whatsappNumber ?? null,
                                    whatsappOptIn: !!s.whatsappOptIn,
                                    telegramHandle: s.telegramHandle ?? null,
                                    telegramChatId: null,
                                    telegramOptIn: !!s.telegramOptIn,
                                    smsNumber: s.smsNumber ?? null,
                                    smsOptIn: !!s.smsOptIn,
                                    wechatOpenId: null,
                                    wechatNickname: null,
                                    wechatOptIn: !!s.wechatOptIn,
                                    // Principal-side hints don't carry the staff
                                    // member's preferred channel — that's their
                                    // own /portal/my-details choice. Show null
                                    // here; the staff editor branch of the
                                    // component ignores the preference UI.
                                    preferredCommunicationChannel: null,
                                  }}
                                  onChange={(next: ChannelsState) => mergeStaffChannels(s.id, next)}
                                />
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
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
              {/* TB rows with blank descriptions are flagged on the audit
                  team's TBCYvPY tab, not here — the Portal Principal
                  isn't the right person to fix TB-import issues. We
                  still warn on rows with no FS-Line classification at
                  all because that one is a setup blocker the Principal
                  needs to know about. */}
              {state.dataQuality?.droppedUnclassifiedCount > 0 && (
                <div className="bg-amber-50 border-b border-amber-200 px-5 py-3 text-xs text-amber-800">
                  <p className="font-medium mb-1">Some TB codes were not included in the grid</p>
                  <ul className="space-y-0.5 list-disc pl-5">
                    <li>
                      <strong>{state.dataQuality.droppedUnclassifiedCount}</strong> TB code{state.dataQuality.droppedUnclassifiedCount === 1 ? '' : 's'} have no FS Line classification at all. Ask the audit team to run TBCYvPY classification on the engagement.
                      {state.dataQuality.droppedUnclassified?.length > 0 && (
                        <span className="block text-[11px] mt-0.5 text-amber-700">
                          Examples: {state.dataQuality.droppedUnclassified.slice(0, 8).join(', ')}{state.dataQuality.droppedUnclassified.length > 8 ? ` … (+${state.dataQuality.droppedUnclassified.length - 8} more)` : ''}
                        </span>
                      )}
                    </li>
                  </ul>
                </div>
              )}

              {/* Column header with escalation days — left-aligned to
                  match the dropdown content below. Center-aligning the
                  header text while the dropdown content sits left
                  caused the visual mismatch the Principal flagged. */}
              <div className="grid grid-cols-[minmax(200px,3fr)_1fr_1fr_1fr] gap-3 px-5 py-3 bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
                <div className="font-medium">FS Line / TB code</div>
                {[1, 2, 3].map(col => (
                  <div key={col} className="text-left pl-2">
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

// ─── Security card (2FA trust window) ─────────────────────────────
//
// Lets the Principal pick how many days a browser stays trusted after
// it completes 2FA. Stored on AuditEngagement.portal2faTrustDays —
// 0 / null means "always require 2FA" (the safest default). A
// different browser has no trust cookie and always falls through to
// the email-code flow regardless of this value.

function SecurityCard({
  engagementId, token, initial, onSaved,
}: {
  engagementId: string;
  token: string;
  initial: number | null;
  onSaved: () => void;
}) {
  const [value, setValue] = useState<string>(initial == null ? '' : String(initial));
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  // Keep the input in sync if the parent reloads with a fresh value
  // (e.g. after a successful save).
  useEffect(() => {
    setValue(initial == null ? '' : String(initial));
  }, [initial]);

  async function save() {
    setSaving(true); setErrMsg(null); setSavedMsg(null);
    try {
      // Empty string normalises to null on the server; we send raw
      // so the server's clamp + parse logic is the single source of
      // truth for "what does X mean".
      const res = await fetch(`/api/portal/setup/engagement?token=${encodeURIComponent(token)}&engagementId=${encodeURIComponent(engagementId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ portal2faTrustDays: value === '' ? null : Number(value) }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || `Save failed (${res.status})`);
      }
      setSavedMsg('Saved.');
      onSaved();
    } catch (e: any) {
      setErrMsg(e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-5">
      <div className="flex items-start gap-3">
        <Shield className="w-4 h-4 text-blue-600 mt-1" />
        <div className="flex-1">
          <h2 className="text-sm font-semibold text-slate-800">Two-factor authentication trust window</h2>
          <p className="text-xs text-slate-600 mt-1 max-w-2xl">
            How many days a browser stays trusted after passing 2FA. Inside the window the user can sign in with just username + password.
            A different machine has no trust cookie and <strong>always</strong> falls back to 2FA, so a stolen password alone never gets in.
            Leave blank or set to <code className="bg-slate-100 px-1 rounded">0</code> to <strong>always require 2FA</strong>.
          </p>
          <div className="mt-3 flex items-center gap-2 flex-wrap">
            <input
              type="number"
              min={0}
              max={365}
              value={value}
              onChange={e => setValue(e.target.value)}
              className="w-24 border border-slate-300 rounded px-2 py-1.5 text-sm"
              placeholder="0"
            />
            <span className="text-xs text-slate-600">days</span>
            <button
              onClick={() => void save()}
              disabled={saving}
              className="inline-flex items-center gap-1 text-xs px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
              Save
            </button>
            {savedMsg && <span className="text-[11px] text-emerald-700">{savedMsg}</span>}
            {errMsg && <span className="text-[11px] text-red-700">{errMsg}</span>}
          </div>
          <div className="mt-2 text-[11px] text-slate-500 space-x-3">
            <button type="button" onClick={() => setValue('0')} className="hover:text-blue-700 hover:underline">Always 2FA</button>
            <button type="button" onClick={() => setValue('7')} className="hover:text-blue-700 hover:underline">7 days</button>
            <button type="button" onClick={() => setValue('30')} className="hover:text-blue-700 hover:underline">30 days</button>
            <button type="button" onClick={() => setValue('90')} className="hover:text-blue-700 hover:underline">90 days</button>
          </div>
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

// ─── WeCom Join URL card ──────────────────────────────────────────
//
// The Principal pastes the audit firm's WeCom group invite URL or QR
// image URL once. Staff see it read-only on their My Details page
// when they pick WeChat as their preferred channel; they scan to
// join. We don't validate the host strictly because WeCom QR URLs
// can come from several Tencent hosts (work.weixin.qq.com,
// wework.qpic.cn, qrcode.work.weixin.qq.com) — we just require
// HTTPS to catch typos.

function WeComJoinCard({
  engagementId, token, initial, onSaved,
}: {
  engagementId: string;
  token: string;
  initial: string | null;
  onSaved: () => void;
}) {
  const [value, setValue] = useState(initial ?? '');
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  useEffect(() => { setValue(initial ?? ''); }, [initial]);

  async function save() {
    setSaving(true); setErrMsg(null); setSavedMsg(null);
    try {
      const trimmed = value.trim();
      if (trimmed && !/^https:\/\//i.test(trimmed)) {
        setErrMsg('Must start with https://');
        return;
      }
      const res = await fetch(`/api/portal/setup/engagement?token=${encodeURIComponent(token)}&engagementId=${encodeURIComponent(engagementId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wecomJoinUrl: trimmed || null }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || `Save failed (${res.status})`);
      }
      setSavedMsg('Saved.');
      onSaved();
    } catch (e: any) {
      setErrMsg(e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  // Best-effort: when the pasted value looks like a QR image URL
  // (.jpg / .png / qpic.cn host), preview it so the Principal can
  // eyeball that they pasted the right thing.
  const looksLikeImage = !!value && /(\.png|\.jpg|\.jpeg|qpic\.cn)/i.test(value);

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-5">
      <div className="flex items-start gap-3">
        <MessageSquare className="w-4 h-4 text-emerald-600 mt-1" />
        <div className="flex-1">
          <h2 className="text-sm font-semibold text-slate-800">WeCom group — join URL or QR</h2>
          <p className="text-xs text-slate-600 mt-1 max-w-2xl">
            The audit firm will send you a WeCom group invite URL or QR image (by email or at kickoff).
            Paste it here once. Your staff will see it read-only and can scan it from WeChat to join the group.
            Only you (the Portal Principal) can change this — staff cannot edit or clear it.
          </p>
          <p className="text-[11px] text-slate-500 mt-1.5">
            <strong>The audit firm stays in control of the WeCom group.</strong> Clients join as regular members and cannot remove the firm or its pinned content.
          </p>
          <div className="mt-3 space-y-2">
            <input
              type="url"
              value={value}
              onChange={e => setValue(e.target.value)}
              placeholder="https://work.weixin.qq.com/… or QR image URL"
              className="w-full border border-slate-300 rounded px-3 py-1.5 text-sm font-mono focus:outline-none focus:border-emerald-300"
            />
            <div className="flex items-center gap-2">
              <button
                onClick={() => void save()}
                disabled={saving}
                className="inline-flex items-center gap-1 text-xs px-3 py-1.5 bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                Save
              </button>
              {value && (
                <button
                  type="button"
                  onClick={() => setValue('')}
                  className="text-[11px] text-slate-500 hover:text-red-600 underline"
                >Clear</button>
              )}
              {savedMsg && <span className="text-[11px] text-emerald-700">{savedMsg}</span>}
              {errMsg && <span className="text-[11px] text-red-700">{errMsg}</span>}
            </div>
            {looksLikeImage && value && (
              <div className="mt-2">
                <p className="text-[10px] text-slate-500 mb-1">Preview (so you can check before saving):</p>
                <img
                  src={value}
                  alt="WeCom join QR"
                  className="w-40 h-40 border border-slate-200 rounded bg-white"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
