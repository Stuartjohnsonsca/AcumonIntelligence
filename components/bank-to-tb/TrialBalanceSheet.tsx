'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useBankToTB } from './BankToTBContext';
import { cn } from '@/lib/utils';
import { useTableSelection } from '@/hooks/useTableSelection';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';

function formatGBP(amount: number): string {
  if (Math.abs(amount) < 0.01) return '';
  return '£' + Math.abs(amount).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Friendly labels for journal categories
const JOURNAL_LABELS: Record<string, string> = {
  depreciation: 'Depreciation',
  prepayments: 'Prepayments',
  accruals: 'Accruals',
  distributions: 'Distributions',
  unbundle_fa: 'Unbundle FA',
  general: 'Journals',
};

function journalLabel(key: string): string {
  return JOURNAL_LABELS[key] || key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' ');
}

const SCOPE_ID = 'trial-balance';

export function TrialBalanceSheet() {
  const { state, dispatch } = useBankToTB();
  const tableRef = useRef<HTMLTableElement>(null);

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

  // Dynamic column count: 3 fixed + 2 opening + 2 bank + (journal Dr+Cr pairs) + 2 totals
  const columnCount = useMemo(
    () => 3 + 2 + 2 + journalCategories.length * 2 + 2,
    [journalCategories]
  );

  // Selection
  const tableSelection = useTableSelection(tableRef);
  const { isCellSelected, onCellClick, onRowHeaderClick, onColumnHeaderClick, setTableDimensions } = tableSelection;

  useEffect(() => {
    setTableDimensions(state.trialBalance.length, columnCount);
  }, [state.trialBalance.length, columnCount, setTableDimensions]);

  // Delete rows action
  const onDeleteRows = useCallback(
    (rowIndices: number[]) => {
      const idsToDelete = new Set(rowIndices.map((i) => state.trialBalance[i]?.id).filter(Boolean));
      dispatch({
        type: 'SET_TRIAL_BALANCE',
        payload: state.trialBalance.filter((tb) => !idsToDelete.has(tb.id)),
      });
    },
    [state.trialBalance, dispatch]
  );

  // Keyboard shortcuts
  useKeyboardShortcuts(SCOPE_ID, {
    tableSelection,
    onDeleteRows,
  });

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

      for (const cat of journalCategories) {
        const jd = tb.journalData?.[cat];
        if (jd) {
          jrnlTotals[cat].debit += jd.debit;
          jrnlTotals[cat].credit += jd.credit;
          rowDr += jd.debit;
          rowCr += jd.credit;
        }
      }
      // Also add columnData
      if (tb.columnData) {
        for (const v of Object.values(tb.columnData)) {
          const cd = v as { debit: number; credit: number };
          rowDr += cd.debit;
          rowCr += cd.credit;
        }
      }
      totalDr += rowDr;
      totalCr += rowCr;
    }

    return { openDr, openCr, combDr, combCr, jrnlTotals, totalDr, totalCr };
  }, [state.trialBalance, journalCategories]);

  // Summary calculations
  const summary = useMemo(() => {
    let revenue = 0, otherIncome = 0, directCosts = 0, overheads = 0;
    let totalAssets = 0, totalLiabilities = 0;

    for (const tb of state.trialBalance) {
      let rowDr = tb.openingDebit + tb.combinedDebit;
      let rowCr = tb.openingCredit + tb.combinedCredit;
      for (const cat of journalCategories) {
        const jd = tb.journalData?.[cat];
        if (jd) { rowDr += jd.debit; rowCr += jd.credit; }
      }
      if (tb.columnData) {
        for (const v of Object.values(tb.columnData)) {
          const cd = v as { debit: number; credit: number };
          rowDr += cd.debit; rowCr += cd.credit;
        }
      }
      const rowNet = rowDr - rowCr;

      switch (tb.categoryType) {
        case 'Revenue': revenue += rowNet; break;
        case 'Other Income': otherIncome += rowNet; break;
        case 'Direct Costs': directCosts += rowNet; break;
        case 'Overheads': overheads += rowNet; break;
        case 'Fixed Asset': case 'Current Asset': case 'Bank': totalAssets += rowNet; break;
        case 'Current Liability': case 'Long Term Liability':
        case 'Equity': totalLiabilities += rowNet; break;
      }
    }

    const profitBeforeTax = -revenue - otherIncome + directCosts + overheads;
    const netAssets = totalAssets + totalLiabilities;

    return { revenue: -revenue, profitBeforeTax: -profitBeforeTax, netAssets };
  }, [state.trialBalance, journalCategories]);

  return (
    <div
      className="flex flex-col h-full outline-none"
      data-kb-scope="sheet"
      data-kb-scope-id={SCOPE_ID}
      tabIndex={0}
    >
      <div className="flex-1 overflow-auto">
        <table ref={tableRef} className="w-full text-xs border-collapse">
          <thead className="sticky top-0 bg-slate-100 z-10">
            <tr>
              <th className="px-1 py-2 text-center font-medium text-slate-400 border-b w-8 select-none">#</th>
              {(() => {
                let colIdx = 0;
                const headers: React.ReactNode[] = [];
                headers.push(
                  <th key="code" className="px-2 py-2 text-left font-medium text-slate-600 border-b whitespace-nowrap cursor-pointer hover:bg-slate-200" onClick={(e) => onColumnHeaderClick(0, e)}>Account Code</th>,
                  <th key="name" className="px-2 py-2 text-left font-medium text-slate-600 border-b whitespace-nowrap cursor-pointer hover:bg-slate-200" onClick={(e) => onColumnHeaderClick(1, e)}>Account Name</th>,
                  <th key="cat" className="px-2 py-2 text-left font-medium text-slate-600 border-b whitespace-nowrap cursor-pointer hover:bg-slate-200" onClick={(e) => onColumnHeaderClick(2, e)}>Category</th>,
                  <th key="odr" className="px-2 py-2 text-right font-medium text-slate-600 border-b whitespace-nowrap cursor-pointer hover:bg-slate-200" onClick={(e) => onColumnHeaderClick(3, e)}>Opening Dr</th>,
                  <th key="ocr" className="px-2 py-2 text-right font-medium text-slate-600 border-b whitespace-nowrap cursor-pointer hover:bg-slate-200" onClick={(e) => onColumnHeaderClick(4, e)}>Opening Cr</th>,
                  <th key="bdr" className="px-2 py-2 text-right font-medium text-slate-600 border-b whitespace-nowrap cursor-pointer hover:bg-slate-200" onClick={(e) => onColumnHeaderClick(5, e)}>Bank Dr</th>,
                  <th key="bcr" className="px-2 py-2 text-right font-medium text-slate-600 border-b whitespace-nowrap cursor-pointer hover:bg-slate-200" onClick={(e) => onColumnHeaderClick(6, e)}>Bank Cr</th>,
                );
                colIdx = 7;

                // Journal columns — PAIRED (Dr + Cr together per category)
                for (const cat of journalCategories) {
                  const ci = colIdx;
                  const label = journalLabel(cat);
                  headers.push(
                    <th key={`${cat}-dr`} className="px-2 py-2 text-right font-medium text-blue-700 border-b whitespace-nowrap cursor-pointer hover:bg-blue-50 bg-blue-50/30" onClick={(e) => onColumnHeaderClick(ci, e)}>{label} Dr</th>
                  );
                  colIdx++;
                  headers.push(
                    <th key={`${cat}-cr`} className="px-2 py-2 text-right font-medium text-blue-700 border-b whitespace-nowrap cursor-pointer hover:bg-blue-50 bg-blue-50/30" onClick={(e) => onColumnHeaderClick(ci + 1, e)}>{label} Cr</th>
                  );
                  colIdx++;
                }

                headers.push(
                  <th key="tdr" className="px-2 py-2 text-right font-medium text-slate-800 border-b whitespace-nowrap cursor-pointer hover:bg-slate-200 bg-slate-200/50" onClick={(e) => onColumnHeaderClick(colIdx, e)}>Total Dr</th>,
                  <th key="tcr" className="px-2 py-2 text-right font-medium text-slate-800 border-b whitespace-nowrap cursor-pointer hover:bg-slate-200 bg-slate-200/50" onClick={(e) => onColumnHeaderClick(colIdx + 1, e)}>Total Cr</th>,
                );
                return headers;
              })()}
            </tr>
          </thead>
          <tbody>
            {state.trialBalance.length === 0 ? (
              <tr>
                <td colSpan={columnCount + 1} className="px-4 py-8 text-center text-slate-400">
                  No trial balance data. Load an opening position to begin.
                </td>
              </tr>
            ) : (
              state.trialBalance.map((tb, i) => {
                // Calculate row total
                let rowDr = tb.openingDebit + tb.combinedDebit;
                let rowCr = tb.openingCredit + tb.combinedCredit;
                for (const cat of journalCategories) {
                  const jd = tb.journalData?.[cat];
                  if (jd) { rowDr += jd.debit; rowCr += jd.credit; }
                }
                if (tb.columnData) {
                  for (const v of Object.values(tb.columnData)) {
                    const cd = v as { debit: number; credit: number };
                    rowDr += cd.debit; rowCr += cd.credit;
                  }
                }

                let colIdx = 0;
                const cells: React.ReactNode[] = [];

                // Fixed columns
                cells.push(
                  <td key="code" className={cn('px-2 py-1.5 border-b border-slate-100 font-mono cursor-cell', isCellSelected(i, colIdx) && 'bg-blue-50 ring-2 ring-inset ring-blue-300')} onClick={(e) => onCellClick(i, 0, e)}>{tb.accountCode}</td>
                );
                colIdx++;
                cells.push(
                  <td key="name" className={cn('px-2 py-1.5 border-b border-slate-100 cursor-cell', isCellSelected(i, colIdx) && 'bg-blue-50 ring-2 ring-inset ring-blue-300')} onClick={(e) => onCellClick(i, 1, e)}>{tb.accountName}</td>
                );
                colIdx++;
                cells.push(
                  <td key="cat" className={cn('px-2 py-1.5 border-b border-slate-100 text-slate-500 cursor-cell', isCellSelected(i, colIdx) && 'bg-blue-50 ring-2 ring-inset ring-blue-300')} onClick={(e) => onCellClick(i, 2, e)}>{tb.categoryType}</td>
                );
                colIdx++;

                // Opening
                cells.push(
                  <td key="odr" className={cn(
                    'px-2 py-1.5 border-b border-slate-100 text-right font-mono cursor-cell',
                    tb.isFromOpeningPosition && 'bg-orange-50',
                    isCellSelected(i, colIdx) && 'bg-blue-50 ring-2 ring-inset ring-blue-300'
                  )} onClick={(e) => onCellClick(i, 3, e)}>
                    {formatGBP(tb.openingDebit)}
                  </td>
                );
                colIdx++;
                cells.push(
                  <td key="ocr" className={cn(
                    'px-2 py-1.5 border-b border-slate-100 text-right font-mono cursor-cell',
                    tb.isFromOpeningPosition && 'bg-orange-50',
                    isCellSelected(i, colIdx) && 'bg-blue-50 ring-2 ring-inset ring-blue-300'
                  )} onClick={(e) => onCellClick(i, 4, e)}>
                    {formatGBP(tb.openingCredit)}
                  </td>
                );
                colIdx++;

                // Bank
                cells.push(
                  <td key="bdr" className={cn('px-2 py-1.5 border-b border-slate-100 text-right font-mono cursor-cell', isCellSelected(i, colIdx) && 'bg-blue-50 ring-2 ring-inset ring-blue-300')} onClick={(e) => onCellClick(i, 5, e)}>{formatGBP(tb.combinedDebit)}</td>
                );
                colIdx++;
                cells.push(
                  <td key="bcr" className={cn('px-2 py-1.5 border-b border-slate-100 text-right font-mono cursor-cell', isCellSelected(i, colIdx) && 'bg-blue-50 ring-2 ring-inset ring-blue-300')} onClick={(e) => onCellClick(i, 6, e)}>{formatGBP(tb.combinedCredit)}</td>
                );
                colIdx++;

                // Journal columns — PAIRED (Dr + Cr together per category)
                for (const cat of journalCategories) {
                  const ci = colIdx;
                  const jd = tb.journalData?.[cat];
                  cells.push(
                    <td key={`${cat}-dr`} className={cn('px-2 py-1.5 border-b border-slate-100 text-right font-mono cursor-cell bg-blue-50/20', isCellSelected(i, ci) && 'bg-blue-50 ring-2 ring-inset ring-blue-300')} onClick={(e) => onCellClick(i, ci, e)}>
                      {formatGBP(jd?.debit || 0)}
                    </td>
                  );
                  colIdx++;
                  cells.push(
                    <td key={`${cat}-cr`} className={cn('px-2 py-1.5 border-b border-slate-100 text-right font-mono cursor-cell bg-blue-50/20', isCellSelected(i, ci + 1) && 'bg-blue-50 ring-2 ring-inset ring-blue-300')} onClick={(e) => onCellClick(i, ci + 1, e)}>
                      {formatGBP(jd?.credit || 0)}
                    </td>
                  );
                  colIdx++;
                }

                // Totals
                cells.push(
                  <td key="tdr" className={cn('px-2 py-1.5 border-b border-slate-100 text-right font-mono font-semibold cursor-cell bg-slate-50', isCellSelected(i, colIdx) && 'bg-blue-50 ring-2 ring-inset ring-blue-300')} onClick={(e) => onCellClick(i, colIdx, e)}>{formatGBP(rowDr)}</td>
                );
                colIdx++;
                cells.push(
                  <td key="tcr" className={cn('px-2 py-1.5 border-b border-slate-100 text-right font-mono font-semibold cursor-cell bg-slate-50', isCellSelected(i, colIdx) && 'bg-blue-50 ring-2 ring-inset ring-blue-300')} onClick={(e) => onCellClick(i, colIdx, e)}>{formatGBP(rowCr)}</td>
                );

                return (
                  <tr key={tb.id} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                    <td
                      className="px-1 py-1.5 border-b border-slate-100 text-center text-slate-400 cursor-pointer select-none hover:bg-blue-100"
                      onClick={(e) => onRowHeaderClick(i, e)}
                    >
                      {i + 1}
                    </td>
                    {cells}
                  </tr>
                );
              })
            )}
          </tbody>
          {state.trialBalance.length > 0 && (
            <tfoot className="sticky bottom-0 bg-slate-200 font-semibold text-xs">
              <tr>
                <td className="px-1 py-2 border-t"></td>
                <td className="px-2 py-2 border-t" colSpan={3}>Totals</td>
                <td className="px-2 py-2 border-t text-right font-mono">{formatGBP(totals.openDr)}</td>
                <td className="px-2 py-2 border-t text-right font-mono">{formatGBP(totals.openCr)}</td>
                <td className="px-2 py-2 border-t text-right font-mono">{formatGBP(totals.combDr)}</td>
                <td className="px-2 py-2 border-t text-right font-mono">{formatGBP(totals.combCr)}</td>
                {journalCategories.map(cat => (
                  <>
                    <td key={`${cat}-tdr`} className="px-2 py-2 border-t text-right font-mono text-blue-700">{formatGBP(totals.jrnlTotals[cat]?.debit || 0)}</td>
                    <td key={`${cat}-tcr`} className="px-2 py-2 border-t text-right font-mono text-blue-700">{formatGBP(totals.jrnlTotals[cat]?.credit || 0)}</td>
                  </>
                ))}
                <td className="px-2 py-2 border-t text-right font-mono font-bold">{formatGBP(totals.totalDr)}</td>
                <td className="px-2 py-2 border-t text-right font-mono font-bold">{formatGBP(totals.totalCr)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Summary bar */}
      <div className="sticky bottom-0 bg-slate-800 text-white px-4 py-2 flex items-center gap-6 text-xs">
        <span>Revenue: <span className="font-mono font-semibold">{formatGBP(summary.revenue)}</span></span>
        <span>PBT: <span className="font-mono font-semibold">{formatGBP(summary.profitBeforeTax)}</span></span>
        <span>Net Assets: <span className="font-mono font-semibold">{formatGBP(summary.netAssets)}</span></span>
        <span className="ml-auto text-slate-400">{state.trialBalance.length} rows</span>
      </div>
    </div>
  );
}
