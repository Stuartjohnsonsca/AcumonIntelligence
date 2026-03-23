'use client';

import { useMemo } from 'react';
import { useBankToTB } from './BankToTBContext';
import { cn } from '@/lib/utils';

function formatGBP(amount: number): string {
  if (Math.abs(amount) < 0.01) return '';
  return '£' + Math.abs(amount).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function TrialBalanceSheet() {
  const { state } = useBankToTB();

  const journalCategories = useMemo(() => {
    const cats = new Set<string>();
    for (const tb of state.trialBalance) {
      if (tb.journalData) {
        for (const key of Object.keys(tb.journalData)) {
          cats.add(key);
        }
      }
    }
    return Array.from(cats);
  }, [state.trialBalance]);

  const totals = useMemo(() => {
    let openDr = 0, openCr = 0, combDr = 0, combCr = 0;
    const jrnlTotals: Record<string, { debit: number; credit: number }> = {};
    for (const cat of journalCategories) {
      jrnlTotals[cat] = { debit: 0, credit: 0 };
    }
    let totalDr = 0, totalCr = 0;

    for (const tb of state.trialBalance) {
      openDr += tb.openingDebit;
      openCr += tb.openingCredit;
      combDr += tb.combinedDebit;
      combCr += tb.combinedCredit;

      let rowDr = tb.openingDebit + tb.combinedDebit;
      let rowCr = tb.openingCredit + tb.combinedCredit;

      if (tb.journalData) {
        for (const [cat, vals] of Object.entries(tb.journalData)) {
          if (jrnlTotals[cat]) {
            jrnlTotals[cat].debit += vals.debit;
            jrnlTotals[cat].credit += vals.credit;
          }
          rowDr += vals.debit;
          rowCr += vals.credit;
        }
      }

      totalDr += rowDr;
      totalCr += rowCr;
    }

    return { openDr, openCr, combDr, combCr, jrnlTotals, totalDr, totalCr };
  }, [state.trialBalance, journalCategories]);

  const summary = useMemo(() => {
    let revenue = 0, directCosts = 0, overheads = 0, otherIncome = 0, taxCharge = 0;
    let totalAssets = 0, totalLiabilities = 0;

    for (const tb of state.trialBalance) {
      let rowNet = (tb.openingDebit + tb.combinedDebit) - (tb.openingCredit + tb.combinedCredit);
      if (tb.journalData) {
        for (const vals of Object.values(tb.journalData)) {
          rowNet += vals.debit - vals.credit;
        }
      }

      switch (tb.categoryType) {
        case 'Revenue': revenue += rowNet; break;
        case 'Direct Costs': directCosts += rowNet; break;
        case 'Overheads': overheads += rowNet; break;
        case 'Other Income': otherIncome += rowNet; break;
        case 'Tax Charge': taxCharge += rowNet; break;
        case 'Fixed Asset': case 'Investment': case 'Current Asset':
          totalAssets += rowNet; break;
        case 'Current Liability': case 'Long-term Liability':
          totalLiabilities += rowNet; break;
      }
    }

    const profitBeforeTax = -revenue - otherIncome + directCosts + overheads;
    const netAssets = totalAssets + totalLiabilities; // liabilities are negative (credit balances)

    return { revenue: -revenue, profitBeforeTax: -profitBeforeTax, netAssets };
  }, [state.trialBalance]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0 bg-slate-100 z-10">
            <tr>
              <th className="px-2 py-2 text-left font-medium text-slate-600 border-b whitespace-nowrap">Account Code</th>
              <th className="px-2 py-2 text-left font-medium text-slate-600 border-b whitespace-nowrap">Account Name</th>
              <th className="px-2 py-2 text-left font-medium text-slate-600 border-b whitespace-nowrap">Category</th>
              <th className="px-2 py-2 text-right font-medium text-slate-600 border-b whitespace-nowrap">Opening Dr</th>
              <th className="px-2 py-2 text-right font-medium text-slate-600 border-b whitespace-nowrap">Opening Cr</th>
              <th className="px-2 py-2 text-right font-medium text-slate-600 border-b whitespace-nowrap">Bank Dr</th>
              <th className="px-2 py-2 text-right font-medium text-slate-600 border-b whitespace-nowrap">Bank Cr</th>
              {journalCategories.map(cat => (
                <th key={`${cat}-dr`} className="px-2 py-2 text-right font-medium text-slate-600 border-b whitespace-nowrap" colSpan={1}>
                  {cat} Dr
                </th>
              ))}
              {journalCategories.map(cat => (
                <th key={`${cat}-cr`} className="px-2 py-2 text-right font-medium text-slate-600 border-b whitespace-nowrap" colSpan={1}>
                  {cat} Cr
                </th>
              ))}
              <th className="px-2 py-2 text-right font-medium text-slate-600 border-b whitespace-nowrap">Total Dr</th>
              <th className="px-2 py-2 text-right font-medium text-slate-600 border-b whitespace-nowrap">Total Cr</th>
            </tr>
          </thead>
          <tbody>
            {state.trialBalance.length === 0 ? (
              <tr>
                <td colSpan={7 + journalCategories.length * 2} className="px-4 py-8 text-center text-slate-400">
                  No trial balance data. Load an opening position to begin.
                </td>
              </tr>
            ) : (
              state.trialBalance.map((tb, i) => {
                let rowDr = tb.openingDebit + tb.combinedDebit;
                let rowCr = tb.openingCredit + tb.combinedCredit;
                if (tb.journalData) {
                  for (const vals of Object.values(tb.journalData)) {
                    rowDr += vals.debit;
                    rowCr += vals.credit;
                  }
                }

                return (
                  <tr key={tb.id} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                    <td className="px-2 py-1.5 border-b border-slate-100 font-mono">{tb.accountCode}</td>
                    <td className="px-2 py-1.5 border-b border-slate-100">{tb.accountName}</td>
                    <td className="px-2 py-1.5 border-b border-slate-100 text-slate-500">{tb.categoryType}</td>
                    <td className={cn(
                      'px-2 py-1.5 border-b border-slate-100 text-right font-mono',
                      tb.isFromOpeningPosition && 'bg-orange-50'
                    )}>
                      {formatGBP(tb.openingDebit)}
                    </td>
                    <td className={cn(
                      'px-2 py-1.5 border-b border-slate-100 text-right font-mono',
                      tb.isFromOpeningPosition && 'bg-orange-50'
                    )}>
                      {formatGBP(tb.openingCredit)}
                    </td>
                    <td className="px-2 py-1.5 border-b border-slate-100 text-right font-mono">{formatGBP(tb.combinedDebit)}</td>
                    <td className="px-2 py-1.5 border-b border-slate-100 text-right font-mono">{formatGBP(tb.combinedCredit)}</td>
                    {journalCategories.map(cat => (
                      <td key={`${cat}-dr`} className="px-2 py-1.5 border-b border-slate-100 text-right font-mono">
                        {formatGBP(tb.journalData?.[cat]?.debit || 0)}
                      </td>
                    ))}
                    {journalCategories.map(cat => (
                      <td key={`${cat}-cr`} className="px-2 py-1.5 border-b border-slate-100 text-right font-mono">
                        {formatGBP(tb.journalData?.[cat]?.credit || 0)}
                      </td>
                    ))}
                    <td className="px-2 py-1.5 border-b border-slate-100 text-right font-mono font-semibold">{formatGBP(rowDr)}</td>
                    <td className="px-2 py-1.5 border-b border-slate-100 text-right font-mono font-semibold">{formatGBP(rowCr)}</td>
                  </tr>
                );
              })
            )}
            {/* Totals row */}
            {state.trialBalance.length > 0 && (
              <tr className="bg-slate-200 font-semibold">
                <td colSpan={3} className="px-2 py-2 border-t-2 border-slate-400">Totals</td>
                <td className="px-2 py-2 border-t-2 border-slate-400 text-right font-mono">{formatGBP(totals.openDr)}</td>
                <td className="px-2 py-2 border-t-2 border-slate-400 text-right font-mono">{formatGBP(totals.openCr)}</td>
                <td className="px-2 py-2 border-t-2 border-slate-400 text-right font-mono">{formatGBP(totals.combDr)}</td>
                <td className="px-2 py-2 border-t-2 border-slate-400 text-right font-mono">{formatGBP(totals.combCr)}</td>
                {journalCategories.map(cat => (
                  <td key={`${cat}-dr-total`} className="px-2 py-2 border-t-2 border-slate-400 text-right font-mono">
                    {formatGBP(totals.jrnlTotals[cat]?.debit || 0)}
                  </td>
                ))}
                {journalCategories.map(cat => (
                  <td key={`${cat}-cr-total`} className="px-2 py-2 border-t-2 border-slate-400 text-right font-mono">
                    {formatGBP(totals.jrnlTotals[cat]?.credit || 0)}
                  </td>
                ))}
                <td className="px-2 py-2 border-t-2 border-slate-400 text-right font-mono">{formatGBP(totals.totalDr)}</td>
                <td className="px-2 py-2 border-t-2 border-slate-400 text-right font-mono">{formatGBP(totals.totalCr)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Summary */}
      {state.trialBalance.length > 0 && (
        <div className="px-4 py-3 bg-white border-t flex gap-6">
          <div className="text-sm">
            <span className="text-slate-500">Revenue:</span>
            <span className="ml-2 font-semibold">£{summary.revenue.toLocaleString('en-GB', { minimumFractionDigits: 2 })}</span>
          </div>
          <div className="text-sm">
            <span className="text-slate-500">Profit before Tax:</span>
            <span className="ml-2 font-semibold">£{summary.profitBeforeTax.toLocaleString('en-GB', { minimumFractionDigits: 2 })}</span>
          </div>
          <div className="text-sm">
            <span className="text-slate-500">Net Assets:</span>
            <span className="ml-2 font-semibold">£{summary.netAssets.toLocaleString('en-GB', { minimumFractionDigits: 2 })}</span>
          </div>
        </div>
      )}
    </div>
  );
}
