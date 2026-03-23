'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useBankToTB } from './BankToTBContext';
import { JournalPopup } from './JournalPopup';

interface Props {
  sessionId: string;
  chartOfAccounts: { id: string; accountCode: string; accountName: string; categoryType: string; sortOrder: number }[];
}

const JOURNAL_CATEGORIES = [
  { key: 'depreciation', label: 'Depreciation' },
  { key: 'prepayments', label: 'Prepayments and Accrued Income' },
  { key: 'accruals', label: 'Accruals & Deferred Income' },
  { key: 'distributions', label: 'Distributions' },
  { key: 'unbundle_fa', label: 'Unbundle Fixed Assets' },
  { key: 'general', label: 'Journals' },
  { key: 'existing', label: 'Retrieve Existing Journal' },
];

export function JournalButtons({ sessionId, chartOfAccounts }: Props) {
  const { state } = useBankToTB();
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  if (!state.combineMode) return null;

  return (
    <>
      <div className="space-y-1.5">
        <h3 className="text-sm font-semibold text-slate-700">Journals</h3>
        {JOURNAL_CATEGORIES.map(cat => (
          <Button
            key={cat.key}
            size="sm"
            variant="outline"
            className="w-full text-xs justify-start"
            onClick={() => setActiveCategory(cat.key)}
          >
            {cat.label}
          </Button>
        ))}
      </div>

      {activeCategory && (
        <JournalPopup
          isOpen={true}
          onClose={() => setActiveCategory(null)}
          category={activeCategory}
          chartOfAccounts={chartOfAccounts}
          sessionId={sessionId}
        />
      )}
    </>
  );
}
