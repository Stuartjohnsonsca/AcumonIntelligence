'use client';

import { useState, useMemo } from 'react';
import { ChevronDown, ChevronUp, AlertCircle } from 'lucide-react';
import { useBankToTB } from './BankToTBContext';
import { cn } from '@/lib/utils';

function formatGBP(amount: number): string {
  return '£' + Math.abs(amount).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function BalanceBar() {
  const { state } = useBankToTB();
  const [expanded, setExpanded] = useState(false);

  const totals = useMemo(() => {
    const inPeriodTxns = state.transactions.filter(t => t.inPeriod);
    const opening = state.accounts.reduce((sum, a) => sum + (a.openingBalance || 0), 0);
    const receipts = inPeriodTxns.reduce((sum, t) => sum + t.credit, 0);
    const payments = inPeriodTxns.reduce((sum, t) => sum + t.debit, 0);
    const total = opening + receipts - payments;
    const extracted = state.accounts.reduce((sum, a) => sum + (a.closingBalance || 0), 0);
    const difference = total - extracted;

    return { opening, receipts, payments, total, extracted, difference };
  }, [state.transactions, state.accounts]);

  const perAccount = useMemo(() => {
    if (state.accounts.length <= 1) return [];
    return state.accounts.map(account => {
      const txns = state.transactions.filter(t => t.inPeriod && t.accountId === account.id);
      const receipts = txns.reduce((sum, t) => sum + t.credit, 0);
      const payments = txns.reduce((sum, t) => sum + t.debit, 0);
      const opening = account.openingBalance || 0;
      const total = opening + receipts - payments;
      const extracted = account.closingBalance || 0;
      const difference = total - extracted;
      return { ...account, receipts, payments, opening, total, extracted, difference };
    });
  }, [state.accounts, state.transactions]);

  const hasDifference = Math.abs(totals.difference) > 0.01;
  const hasAccounts = state.accounts.length > 0;

  if (!hasAccounts && state.transactions.length === 0) return null;

  const boxes = [
    { label: 'Opening Balance', value: totals.opening },
    { label: 'Receipts', value: totals.receipts },
    { label: 'Payments', value: totals.payments },
    { label: 'Total Balance', value: totals.total },
    { label: 'Extracted End Balance', value: totals.extracted },
    { label: 'Difference', value: totals.difference, highlight: hasDifference },
  ];

  return (
    <div className="border-b bg-white">
      <div className={cn('px-4 py-3', hasDifference && 'border-2 border-red-500 bg-red-50')}>
        <div className="flex items-center gap-2">
          {boxes.map((box, i) => (
            <div
              key={i}
              className={cn(
                'flex-1 text-center px-2 py-2 rounded-md border',
                box.highlight ? 'border-red-500 bg-red-100' : 'border-slate-200 bg-slate-50'
              )}
            >
              <div className="text-xs text-slate-500 font-medium">{box.label}</div>
              <div className={cn('text-sm font-semibold mt-1', box.highlight && box.value !== 0 ? 'text-red-600' : 'text-slate-900')}>
                {box.value < 0 ? '-' : ''}{formatGBP(box.value)}
              </div>
            </div>
          ))}
          {state.accounts.length > 1 && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="p-2 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded"
            >
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          )}
        </div>

        {hasDifference && (
          <div className="mt-2 flex items-center gap-2 text-sm text-red-700">
            <AlertCircle className="h-4 w-4" />
            <span>
              {state.balanceErrors.length > 0
                ? state.balanceErrors[0].message
                : `Balance difference of ${formatGBP(totals.difference)} detected. Check for missing statement pages or extraction discrepancies.`}
            </span>
          </div>
        )}
      </div>

      {expanded && perAccount.length > 0 && (
        <div className="px-4 py-2 bg-slate-50 border-t space-y-1">
          {perAccount.map(acc => (
            <div key={acc.id} className="flex items-center gap-2 text-xs">
              <span className="w-32 font-medium text-slate-600 truncate">
                {acc.accountNumber || acc.bankName || 'Account'}
              </span>
              <span className="flex-1 text-center">Open: {formatGBP(acc.opening)}</span>
              <span className="flex-1 text-center">Rcpts: {formatGBP(acc.receipts)}</span>
              <span className="flex-1 text-center">Pmts: {formatGBP(acc.payments)}</span>
              <span className="flex-1 text-center">Total: {formatGBP(acc.total)}</span>
              <span className="flex-1 text-center">Extr: {formatGBP(acc.extracted)}</span>
              <span className={cn('flex-1 text-center font-semibold', Math.abs(acc.difference) > 0.01 ? 'text-red-600' : 'text-green-600')}>
                Diff: {formatGBP(acc.difference)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
