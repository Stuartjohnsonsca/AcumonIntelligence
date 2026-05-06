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

  useEffect(() => {
    onSubTabChange?.(activeSubTab);
  }, [activeSubTab, onSubTabChange]);

  return (
    <div className="space-y-3">
      {/* Sub-sub-tab pill bar — sits under the Completion tab pills.
          Slightly smaller chrome than the parent so the visual
          hierarchy reads as "tab → tab → content". */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-slate-200 bg-white">
        {SUB_TABS.map(t => {
          const Icon = t.icon;
          const isActive = activeSubTab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setActiveSubTab(t.key)}
              className={`flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded transition-colors whitespace-nowrap ${
                isActive
                  ? 'bg-indigo-100 text-indigo-800 border border-indigo-300'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
              }`}
            >
              <Icon className="h-3 w-3" />
              {t.label}
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
