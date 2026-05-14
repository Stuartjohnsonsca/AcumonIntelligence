'use client';

/**
 * Taxation — Completion sub-tab containing two sub-sub-tabs:
 *   • Tax on Profits (corporation tax / tax on profits computation)
 *   • VAT Reconciliation (existing panel, reused inline)
 *
 * Sits inside CompletionPanel under the "taxation" tab key. Mirrors the
 * same Progress + Result dot aggregate scheme other Completion sub-tabs
 * use, dispatching `engagement:taxation-aggregates` so the parent pill
 * can render the rolled-up dots.
 *
 * The sub-tab strip is rendered as proper tabs (border-bottom underline
 * style matching the parent Audit Plan strip), with three Preparer /
 * Reviewer / RI dots on each tab that aggregate from each sub-panel's
 * persisted sign-off data. Data is fetched in this wrapper so the dots
 * stay in sync even before the user has opened the sub-panel.
 */

import { useEffect, useState } from 'react';
import { Calculator, FileBarChart } from 'lucide-react';
import { VatReconciliationPanel } from './VatReconciliationPanel';
import { TaxOnProfitsPanel } from './TaxOnProfitsPanel';

interface Props {
  engagementId: string;
  periodStartDate?: string | null;
  periodEndDate?: string | null;
  userId?: string;
  userName?: string;
  userRole?: string;
  /** Initial sub-sub-tab. Persists across remounts so flipping back to
   *  Completion → Taxation lands on the auditor's last view. */
  initialSubTab?: 'tax-on-profits' | 'vat-reconciliation';
  onSubTabChange?: (key: 'tax-on-profits' | 'vat-reconciliation') => void;
}

const SUB_TABS = [
  { key: 'tax-on-profits' as const, label: 'Tax on Profits', icon: Calculator },
  { key: 'vat-reconciliation' as const, label: 'VAT Reconciliation', icon: FileBarChart },
];

interface SignOffEntry { name?: string; timestamp?: string }
interface SubTabSignOffs {
  preparer?: SignOffEntry;
  reviewer?: SignOffEntry;
  ri?: SignOffEntry;
}
type SignOffRole = 'preparer' | 'reviewer' | 'ri';

/** Interactive sign-off pip. Click toggles the role's sign-off for
 *  this sub-tab. Rendered as a `<span role="button">` rather than a
 *  real `<button>` because it lives inside the tab `<button>` and
 *  nesting buttons is invalid HTML — onClick + stopPropagation gives
 *  us the behaviour we need without the nesting.
 *
 *  - Filled green:  signed (tooltip shows name + timestamp)
 *  - Hollow ring:   pending (tooltip says "Click to sign off as …")
 *  - Saving state:  semi-transparent while the PUT is in flight so
 *                   double-clicks don't fire two toggles.
 */
function SignOffDot({
  label,
  entry,
  onToggle,
  saving,
}: {
  label: string;
  entry?: SignOffEntry;
  onToggle?: () => void;
  saving?: boolean;
}) {
  const signed = !!entry?.timestamp;
  const title = signed
    ? `${label}: ${entry!.name || 'unknown'} on ${new Date(entry!.timestamp!).toLocaleString('en-GB')} — click to clear`
    : onToggle
      ? `${label}: click to sign off`
      : `${label}: not signed`;
  return (
    <span
      role={onToggle ? 'button' : undefined}
      tabIndex={onToggle ? 0 : undefined}
      onClick={onToggle
        ? (e) => { e.stopPropagation(); if (!saving) onToggle(); }
        : undefined}
      onKeyDown={onToggle
        ? (e) => { if ((e.key === 'Enter' || e.key === ' ') && !saving) { e.preventDefault(); e.stopPropagation(); onToggle(); } }
        : undefined}
      title={title}
      className={`inline-flex items-center gap-0.5 text-[9px] font-medium select-none ${signed ? 'text-green-700' : 'text-slate-400'} ${onToggle ? 'cursor-pointer hover:opacity-80' : ''} ${saving ? 'opacity-50' : ''}`}
    >
      <span className="leading-none">{label}</span>
      <span className={`inline-block w-2.5 h-2.5 rounded-full ${signed ? 'bg-green-500' : 'border border-slate-300 bg-transparent'}`} />
    </span>
  );
}

export function TaxationPanel({
  engagementId,
  periodStartDate,
  periodEndDate,
  userId,
  userName,
  userRole,
  initialSubTab,
  onSubTabChange,
}: Props) {
  const [activeSubTab, setActiveSubTab] = useState<'tax-on-profits' | 'vat-reconciliation'>(
    initialSubTab || 'tax-on-profits',
  );

  // Sign-off snapshots for each sub-tab — loaded from the same APIs
  // the sub-panels use. Re-fetched whenever the user switches sub-tab
  // (so dots update after the user saves a conclusion) and on initial
  // mount. Tolerant of API errors / missing fields (everything is
  // optional — empty fields render hollow dots).
  //
  // Also re-fetched whenever a sub-panel broadcasts a change event so
  // the dots aren't stale just because the user signed off without
  // leaving the active sub-tab. Without this trigger, the Taxation
  // tab-pill dots appeared "uneditable" — they kept showing pending
  // even after the auditor signed off inside.
  const [taxOnProfitsSO, setTaxOnProfitsSO] = useState<SubTabSignOffs>({});
  const [vatReconciliationSO, setVatReconciliationSO] = useState<SubTabSignOffs>({});
  const [signOffRefreshTick, setSignOffRefreshTick] = useState(0);
  // While a dot's PUT is in flight we dim the dot and ignore further
  // clicks. Key is `${subTabKey}:${role}` so the two sub-tabs and
  // three roles each have their own busy flag.
  const [savingKey, setSavingKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadSignOffs() {
      try {
        const [topRes, vatRes] = await Promise.all([
          fetch(`/api/engagements/${engagementId}/tax-on-profits`).then(r => r.ok ? r.json() : null).catch(() => null),
          fetch(`/api/engagements/${engagementId}/vat-reconciliation`).then(r => r.ok ? r.json() : null).catch(() => null),
        ]);
        if (cancelled) return;

        // Read order for the Preparer slot:
        //   1. explicit `preparerSignedAt` / `preparerSignedByName`
        //      set by clicking the P dot here;
        //   2. legacy: a `conclusion` saved without an explicit P
        //      click — treat the conclusion's `at` as the preparer
        //      timestamp so dots don't go backwards for existing
        //      engagements.
        // Reviewer / RI are explicit fields written by the R / RI
        // dots — there's no legacy fallback because nothing in the
        // pre-existing UI ever set them.
        const topData = topRes?.data || {};
        setTaxOnProfitsSO({
          preparer: topData.preparerSignedAt
            ? { name: topData.preparerSignedByName || 'Preparer', timestamp: topData.preparerSignedAt }
            : topData.conclusion
              ? { name: topData.byUserName || 'Preparer', timestamp: topData.at }
              : undefined,
          reviewer: topData.reviewedAt
            ? { name: topData.reviewedByName, timestamp: topData.reviewedAt }
            : undefined,
          ri: topData.riSignedAt
            ? { name: topData.riSignedByName, timestamp: topData.riSignedAt }
            : undefined,
        });

        // VAT Reconciliation — same convention as Tax on Profits.
        const vatData = vatRes?.data || {};
        setVatReconciliationSO({
          preparer: vatData.preparerSignedAt
            ? { name: vatData.preparerSignedByName || 'Preparer', timestamp: vatData.preparerSignedAt }
            : vatData.conclusion
              ? { name: vatData.byUserName || 'Preparer', timestamp: vatData.at }
              : undefined,
          reviewer: vatData.reviewedAt
            ? { name: vatData.reviewedByName, timestamp: vatData.reviewedAt }
            : undefined,
          ri: vatData.riSignedAt
            ? { name: vatData.riSignedByName, timestamp: vatData.riSignedAt }
            : undefined,
        });
      } catch { /* tolerant — hollow dots while we wait */ }
    }
    loadSignOffs();
    return () => { cancelled = true; };
  }, [engagementId, activeSubTab, signOffRefreshTick]);

  // Listen for sub-panel save broadcasts so the rollup dots refresh
  // immediately when the auditor signs off / saves a conclusion. The
  // sub-panels dispatch their own events from inside their persist()
  // helpers; we just bump a tick that re-runs the fetch above.
  useEffect(() => {
    function onChange(e: Event) {
      const detail = (e as CustomEvent).detail as { engagementId?: string } | undefined;
      if (!detail || detail.engagementId !== engagementId) return;
      setSignOffRefreshTick(t => t + 1);
    }
    window.addEventListener('engagement:tax-on-profits-changed', onChange);
    window.addEventListener('engagement:vat-reconciliation-changed', onChange);
    return () => {
      window.removeEventListener('engagement:tax-on-profits-changed', onChange);
      window.removeEventListener('engagement:vat-reconciliation-changed', onChange);
    };
  }, [engagementId]);

  useEffect(() => {
    onSubTabChange?.(activeSubTab);
  }, [activeSubTab, onSubTabChange]);

  const signOffsBySubTab: Record<string, SubTabSignOffs> = {
    'tax-on-profits': taxOnProfitsSO,
    'vat-reconciliation': vatReconciliationSO,
  };

  /**
   * Click handler for a P/R/RI dot. PUTs a shallow-merge patch into
   * the appropriate sub-panel's `data` blob to toggle the role's
   * sign-off, then dispatches the panel's change event so the dots
   * refresh immediately. Both endpoints share the same shallow-merge
   * PUT semantics so we don't need separate code paths.
   *
   * Toggle policy: if the role is currently signed, the click clears
   * it (sets fields to null). Otherwise it sets the timestamp +
   * signer name. We persist `null` rather than omitting the keys so
   * the shallow merge actually unsets the previous value.
   */
  async function toggleSignOff(subTabKey: 'tax-on-profits' | 'vat-reconciliation', role: SignOffRole) {
    const so = signOffsBySubTab[subTabKey] || {};
    const currentlySigned = !!so[role]?.timestamp;
    const now = currentlySigned ? null : new Date().toISOString();
    const name = currentlySigned ? null : (userName || userRole || 'User');
    // Map role → DB field names. Preparer writes a dedicated
    // preparerSignedAt/By pair so the dot can be toggled
    // independently of the conclusion text (which has its own Save
    // button further down the panel).
    const patch: Record<string, unknown> = role === 'preparer'
      ? { preparerSignedAt: now, preparerSignedByName: name }
      : role === 'reviewer'
        ? { reviewedAt: now, reviewedByName: name }
        : { riSignedAt: now, riSignedByName: name };

    const url = subTabKey === 'tax-on-profits'
      ? `/api/engagements/${engagementId}/tax-on-profits`
      : `/api/engagements/${engagementId}/vat-reconciliation`;
    const changeEvent = subTabKey === 'tax-on-profits'
      ? 'engagement:tax-on-profits-changed'
      : 'engagement:vat-reconciliation-changed';

    const key = `${subTabKey}:${role}`;
    if (savingKey === key) return;
    setSavingKey(key);
    // Optimistically update local state so the dot flips immediately;
    // a failed PUT below will roll it back on the next refresh tick.
    setLocal(subTabKey, role, currentlySigned ? undefined : { name: name || undefined, timestamp: now || undefined });
    try {
      const res = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: patch }),
      });
      if (!res.ok) {
        // Force a re-fetch so the optimistic state gets corrected.
        setSignOffRefreshTick(t => t + 1);
      }
      try { window.dispatchEvent(new CustomEvent(changeEvent, { detail: { engagementId } })); } catch {}
    } catch {
      setSignOffRefreshTick(t => t + 1);
    } finally {
      setSavingKey(null);
    }
  }

  function setLocal(subTabKey: 'tax-on-profits' | 'vat-reconciliation', role: SignOffRole, entry: SignOffEntry | undefined) {
    const setter = subTabKey === 'tax-on-profits' ? setTaxOnProfitsSO : setVatReconciliationSO;
    setter(prev => ({ ...prev, [role]: entry }));
  }

  // Roll up Preparer / Reviewer / RI sign-offs across both Taxation
  // sub-tabs and broadcast so listeners (CompletionPanel pill, the
  // Audit Plan OTHER_TABS Taxation button) mirror what's signed
  // inside. Three states:
  //   • green  — both sub-tabs signed for this role
  //   • orange — exactly one signed (partial)
  //   • pending — neither signed
  useEffect(() => {
    function rollup(top?: SignOffEntry, vat?: SignOffEntry): 'green' | 'orange' | 'pending' {
      const a = !!top?.timestamp;
      const b = !!vat?.timestamp;
      if (a && b) return 'green';
      if (a || b) return 'orange';
      return 'pending';
    }
    try {
      window.dispatchEvent(new CustomEvent('engagement:taxation-signoffs', {
        detail: {
          engagementId,
          preparer: rollup(taxOnProfitsSO.preparer, vatReconciliationSO.preparer),
          reviewer: rollup(taxOnProfitsSO.reviewer, vatReconciliationSO.reviewer),
          ri: rollup(taxOnProfitsSO.ri, vatReconciliationSO.ri),
        },
      }));
    } catch {}
  }, [engagementId, taxOnProfitsSO, vatReconciliationSO]);

  return (
    <div className="space-y-3">
      {/* Sub-sub-tab strip — proper border-bottom underline tabs to
          match the parent Audit Plan + Statement strip styling, with
          three Preparer / Reviewer / RI dots on each tab so the
          auditor can see sign-off status without opening the panel. */}
      <div className="flex items-end gap-4 border-b border-slate-200">
        {SUB_TABS.map(t => {
          const Icon = t.icon;
          const isActive = activeSubTab === t.key;
          const so = signOffsBySubTab[t.key] || {};
          return (
            <button
              key={t.key}
              onClick={() => setActiveSubTab(t.key)}
              className={`group inline-flex items-center gap-2 px-3 py-2 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${
                isActive
                  ? 'border-indigo-600 text-indigo-700'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{t.label}</span>
              <span className="inline-flex items-center gap-1.5 ml-1">
                <SignOffDot
                  label="P"
                  entry={so.preparer}
                  onToggle={() => toggleSignOff(t.key, 'preparer')}
                  saving={savingKey === `${t.key}:preparer`}
                />
                <SignOffDot
                  label="R"
                  entry={so.reviewer}
                  onToggle={() => toggleSignOff(t.key, 'reviewer')}
                  saving={savingKey === `${t.key}:reviewer`}
                />
                <SignOffDot
                  label="RI"
                  entry={so.ri}
                  onToggle={() => toggleSignOff(t.key, 'ri')}
                  saving={savingKey === `${t.key}:ri`}
                />
              </span>
            </button>
          );
        })}
      </div>

      <div>
        {activeSubTab === 'tax-on-profits' && (
          <TaxOnProfitsPanel
            engagementId={engagementId}
            periodStartDate={periodStartDate}
            periodEndDate={periodEndDate}
            userId={userId}
            userName={userName}
            userRole={userRole}
          />
        )}
        {activeSubTab === 'vat-reconciliation' && (
          <VatReconciliationPanel
            engagementId={engagementId}
            periodStartDate={periodStartDate}
            periodEndDate={periodEndDate}
            onClose={() => { /* inline mode — no close, sub-tab nav replaces it */ }}
            inline
          />
        )}
      </div>
    </div>
  );
}
