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

/** Tiny circle indicating whether the role has signed off this sub-tab.
 *  - Filled green: signed
 *  - Hollow ring: pending
 *  Tooltip carries the signer's name + timestamp when present. */
function SignOffDot({ label, entry }: { label: string; entry?: SignOffEntry }) {
  const signed = !!entry?.timestamp;
  const title = signed
    ? `${label}: ${entry!.name || 'unknown'} on ${new Date(entry!.timestamp!).toLocaleString('en-GB')}`
    : `${label}: not signed`;
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-0.5 text-[9px] font-medium ${signed ? 'text-green-700' : 'text-slate-400'}`}
    >
      <span className="leading-none">{label}</span>
      <span className={`inline-block w-2 h-2 rounded-full ${signed ? 'bg-green-500' : 'border border-slate-300 bg-transparent'}`} />
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
  const [taxOnProfitsSO, setTaxOnProfitsSO] = useState<SubTabSignOffs>({});
  const [vatReconciliationSO, setVatReconciliationSO] = useState<SubTabSignOffs>({});

  useEffect(() => {
    let cancelled = false;
    async function loadSignOffs() {
      try {
        const [topRes, vatRes] = await Promise.all([
          fetch(`/api/engagements/${engagementId}/tax-on-profits`).then(r => r.ok ? r.json() : null).catch(() => null),
          fetch(`/api/engagements/${engagementId}/vat-reconciliation`).then(r => r.ok ? r.json() : null).catch(() => null),
        ]);
        if (cancelled) return;

        // Tax on Profits — the panel persists `conclusion` (preparer
        // signal), `reviewedByName/reviewedAt` (reviewer), and
        // `riSignedByName/riSignedAt` (RI). Fall back to byUserName/at
        // for the preparer slot when no explicit reviewer is set.
        const topData = topRes?.data || {};
        setTaxOnProfitsSO({
          preparer: topData.conclusion
            ? { name: topData.byUserName || 'Preparer', timestamp: topData.at }
            : undefined,
          reviewer: topData.reviewedAt
            ? { name: topData.reviewedByName, timestamp: topData.reviewedAt }
            : undefined,
          ri: topData.riSignedAt
            ? { name: topData.riSignedByName, timestamp: topData.riSignedAt }
            : undefined,
        });

        // VAT Reconciliation — same shape as Tax on Profits since both
        // tools share the same conclusion + sign-off field convention.
        const vatData = vatRes?.data || {};
        setVatReconciliationSO({
          preparer: vatData.conclusion
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
  }, [engagementId, activeSubTab]);

  useEffect(() => {
    onSubTabChange?.(activeSubTab);
  }, [activeSubTab, onSubTabChange]);

  const signOffsBySubTab: Record<string, SubTabSignOffs> = {
    'tax-on-profits': taxOnProfitsSO,
    'vat-reconciliation': vatReconciliationSO,
  };

  // Roll up Reviewer/RI sign-offs across both Taxation sub-tabs and
  // broadcast to CompletionPanel so the tab-strip Reviewer/RI dots
  // mirror what's signed inside this panel. Green only when both
  // sub-tabs have the role signed; pending otherwise.
  useEffect(() => {
    const reviewerOk = !!taxOnProfitsSO.reviewer?.timestamp && !!vatReconciliationSO.reviewer?.timestamp;
    const riOk = !!taxOnProfitsSO.ri?.timestamp && !!vatReconciliationSO.ri?.timestamp;
    try {
      window.dispatchEvent(new CustomEvent('engagement:taxation-signoffs', {
        detail: {
          engagementId,
          reviewer: reviewerOk ? 'green' : 'pending',
          ri: riOk ? 'green' : 'pending',
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
                <SignOffDot label="P" entry={so.preparer} />
                <SignOffDot label="R" entry={so.reviewer} />
                <SignOffDot label="RI" entry={so.ri} />
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
