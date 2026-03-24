'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useBankToTB } from './BankToTBContext';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { useTableSelection } from '@/hooks/useTableSelection';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { cn } from '@/lib/utils';

function formatGBP(amount: number): string {
  if (!amount) return '';
  return '£' + Math.abs(amount).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

const COLUMN_COUNT = 11;
const SCOPE_ID = 'bank-transactions';

export function BankTransactionsSheet() {
  const { state, dispatch } = useBankToTB();
  const [organising, setOrganising] = useState(false);
  const [restricting, setRestricting] = useState(false);
  const tableRef = useRef<HTMLTableElement>(null);

  const filteredTxns = useMemo(() => {
    let txns = state.transactions.filter(t => t.inPeriod);
    if (state.activeAccountTab) {
      txns = txns.filter(t => t.accountId === state.activeAccountTab);
    }
    return txns.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [state.transactions, state.activeAccountTab]);

  // Selection
  const tableSelection = useTableSelection(tableRef);
  const { isCellSelected, onCellClick, onRowHeaderClick, onColumnHeaderClick, setTableDimensions } = tableSelection;

  // Keep dimensions in sync
  useEffect(() => {
    setTableDimensions(filteredTxns.length, COLUMN_COUNT);
  }, [filteredTxns.length, setTableDimensions]);

  // Delete rows action
  const onDeleteRows = useCallback(
    (rowIndices: number[]) => {
      const idsToDelete = new Set(rowIndices.map((i) => filteredTxns[i]?.id).filter(Boolean));
      dispatch({
        type: 'SET_TRANSACTIONS',
        payload: state.transactions.filter((t) => !idsToDelete.has(t.id)),
      });
    },
    [filteredTxns, state.transactions, dispatch]
  );

  // Keyboard shortcuts
  useKeyboardShortcuts(SCOPE_ID, {
    tableSelection,
    onDeleteRows,
  });

  async function handleOrganise() {
    if (!state.sessionId) return;
    setOrganising(true);
    try {
      const res = await fetch('/api/bank-to-tb/organise', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: state.sessionId }),
      });
      const data = await res.json();
      if (data.organised && data.accounts) {
        dispatch({ type: 'SET_ACCOUNTS', payload: data.accounts });
        dispatch({ type: 'SET_MULTI_ACCOUNTS', payload: true });
        const sessRes = await fetch(`/api/bank-to-tb/session?clientId=${state.clientId}&periodId=${state.periodId}`);
        const sessData = await sessRes.json();
        if (sessData.session) {
          dispatch({ type: 'SET_TRANSACTIONS', payload: sessData.session.transactions });
        }
      }
    } catch (err) {
      console.error('Organise failed:', err);
    } finally {
      setOrganising(false);
    }
  }

  async function handleRestrict() {
    if (!state.sessionId) return;
    setRestricting(true);
    try {
      const res = await fetch('/api/bank-to-tb/restrict-period', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: state.sessionId }),
      });
      const data = await res.json();
      if (data.success) {
        dispatch({
          type: 'SET_TRANSACTIONS',
          payload: state.transactions.map(t => {
            const d = new Date(t.date);
            return t;
          }),
        });
        const sessRes = await fetch(`/api/bank-to-tb/session?clientId=${state.clientId}&periodId=${state.periodId}`);
        const sessData = await sessRes.json();
        if (sessData.session) {
          dispatch({ type: 'SET_TRANSACTIONS', payload: sessData.session.transactions });
          dispatch({ type: 'SET_OUT_OF_PERIOD', payload: false });
        }
      }
    } catch (err) {
      console.error('Restrict failed:', err);
    } finally {
      setRestricting(false);
    }
  }

  return (
    <div
      className="flex flex-col h-full outline-none"
      data-kb-scope="sheet"
      data-kb-scope-id={SCOPE_ID}
      tabIndex={0}
    >
      {/* Action buttons */}
      <div className="px-4 py-2 flex gap-2 bg-white border-b">
        {state.hasMultipleAccounts && state.accounts.length === 0 && (
          <Button size="sm" variant="outline" onClick={handleOrganise} disabled={organising}>
            {organising && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
            Organise by Account
          </Button>
        )}
        {state.hasOutOfPeriodTxns && (
          <Button size="sm" variant="outline" onClick={handleRestrict} disabled={restricting}>
            {restricting && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
            Restrict to Period
          </Button>
        )}
        <span className="text-xs text-slate-500 self-center ml-auto">
          {filteredTxns.length} transaction{filteredTxns.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table ref={tableRef} className="w-full text-xs border-collapse">
          <thead className="sticky top-0 bg-slate-100 z-10">
            <tr>
              <th className="px-1 py-2 text-center font-medium text-slate-400 border-b w-8 select-none">#</th>
              <th className="px-2 py-2 text-left font-medium text-slate-600 border-b whitespace-nowrap cursor-pointer hover:bg-slate-200" onClick={(e) => onColumnHeaderClick(0, e)}>Bank Name</th>
              <th className="px-2 py-2 text-left font-medium text-slate-600 border-b whitespace-nowrap cursor-pointer hover:bg-slate-200" onClick={(e) => onColumnHeaderClick(1, e)}>Sort Code</th>
              <th className="px-2 py-2 text-left font-medium text-slate-600 border-b whitespace-nowrap cursor-pointer hover:bg-slate-200" onClick={(e) => onColumnHeaderClick(2, e)}>Account No</th>
              <th className="px-2 py-2 text-left font-medium text-slate-600 border-b whitespace-nowrap cursor-pointer hover:bg-slate-200" onClick={(e) => onColumnHeaderClick(3, e)}>Stmt Date</th>
              <th className="px-2 py-2 text-center font-medium text-slate-600 border-b whitespace-nowrap cursor-pointer hover:bg-slate-200" onClick={(e) => onColumnHeaderClick(4, e)}>Page</th>
              <th className="px-2 py-2 text-left font-medium text-slate-600 border-b whitespace-nowrap cursor-pointer hover:bg-slate-200" onClick={(e) => onColumnHeaderClick(5, e)}>Date</th>
              <th className="px-2 py-2 text-left font-medium text-slate-600 border-b whitespace-nowrap cursor-pointer hover:bg-slate-200" onClick={(e) => onColumnHeaderClick(6, e)}>Description</th>
              <th className="px-2 py-2 text-left font-medium text-slate-600 border-b whitespace-nowrap cursor-pointer hover:bg-slate-200" onClick={(e) => onColumnHeaderClick(7, e)}>Reference</th>
              <th className="px-2 py-2 text-right font-medium text-slate-600 border-b whitespace-nowrap cursor-pointer hover:bg-slate-200" onClick={(e) => onColumnHeaderClick(8, e)}>Debit</th>
              <th className="px-2 py-2 text-right font-medium text-slate-600 border-b whitespace-nowrap cursor-pointer hover:bg-slate-200" onClick={(e) => onColumnHeaderClick(9, e)}>Credit</th>
              <th className="px-2 py-2 text-right font-medium text-slate-600 border-b whitespace-nowrap cursor-pointer hover:bg-slate-200" onClick={(e) => onColumnHeaderClick(10, e)}>Balance</th>
            </tr>
          </thead>
          <tbody>
            {filteredTxns.length === 0 ? (
              <tr>
                <td colSpan={12} className="px-4 py-8 text-center text-slate-400">
                  No transactions. Upload bank statements to begin extraction.
                </td>
              </tr>
            ) : (
              filteredTxns.map((txn, i) => (
                <tr key={txn.id} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                  <td
                    className="px-1 py-1.5 border-b border-slate-100 text-center text-slate-400 cursor-pointer select-none hover:bg-blue-100"
                    onClick={(e) => onRowHeaderClick(i, e)}
                  >
                    {i + 1}
                  </td>
                  <td className={cn('px-2 py-1.5 border-b border-slate-100 whitespace-nowrap cursor-cell', isCellSelected(i, 0) && 'bg-blue-50 ring-2 ring-inset ring-blue-300')} onClick={(e) => onCellClick(i, 0, e)}>{txn.bankName || ''}</td>
                  <td className={cn('px-2 py-1.5 border-b border-slate-100 whitespace-nowrap cursor-cell', isCellSelected(i, 1) && 'bg-blue-50 ring-2 ring-inset ring-blue-300')} onClick={(e) => onCellClick(i, 1, e)}>{txn.sortCode || ''}</td>
                  <td className={cn('px-2 py-1.5 border-b border-slate-100 whitespace-nowrap cursor-cell', isCellSelected(i, 2) && 'bg-blue-50 ring-2 ring-inset ring-blue-300')} onClick={(e) => onCellClick(i, 2, e)}>{txn.accountNumber || ''}</td>
                  <td className={cn('px-2 py-1.5 border-b border-slate-100 whitespace-nowrap cursor-cell', isCellSelected(i, 3) && 'bg-blue-50 ring-2 ring-inset ring-blue-300')} onClick={(e) => onCellClick(i, 3, e)}>{txn.statementDate || ''}</td>
                  <td className={cn('px-2 py-1.5 border-b border-slate-100 text-center cursor-cell', isCellSelected(i, 4) && 'bg-blue-50 ring-2 ring-inset ring-blue-300')} onClick={(e) => onCellClick(i, 4, e)}>{txn.statementPage ?? ''}</td>
                  <td className={cn('px-2 py-1.5 border-b border-slate-100 whitespace-nowrap cursor-cell', isCellSelected(i, 5) && 'bg-blue-50 ring-2 ring-inset ring-blue-300')} onClick={(e) => onCellClick(i, 5, e)}>{formatDate(txn.date)}</td>
                  <td className={cn('px-2 py-1.5 border-b border-slate-100 max-w-[300px] truncate cursor-cell', isCellSelected(i, 6) && 'bg-blue-50 ring-2 ring-inset ring-blue-300')} onClick={(e) => onCellClick(i, 6, e)}>{txn.description}</td>
                  <td className={cn('px-2 py-1.5 border-b border-slate-100 whitespace-nowrap cursor-cell', isCellSelected(i, 7) && 'bg-blue-50 ring-2 ring-inset ring-blue-300')} onClick={(e) => onCellClick(i, 7, e)}>{txn.reference || ''}</td>
                  <td className={cn('px-2 py-1.5 border-b border-slate-100 text-right font-mono cursor-cell', isCellSelected(i, 8) && 'bg-blue-50 ring-2 ring-inset ring-blue-300')} onClick={(e) => onCellClick(i, 8, e)}>{txn.debit > 0 ? formatGBP(txn.debit) : ''}</td>
                  <td className={cn('px-2 py-1.5 border-b border-slate-100 text-right font-mono cursor-cell', isCellSelected(i, 9) && 'bg-blue-50 ring-2 ring-inset ring-blue-300')} onClick={(e) => onCellClick(i, 9, e)}>{txn.credit > 0 ? formatGBP(txn.credit) : ''}</td>
                  <td className={cn('px-2 py-1.5 border-b border-slate-100 text-right font-mono cursor-cell', isCellSelected(i, 10) && 'bg-blue-50 ring-2 ring-inset ring-blue-300')} onClick={(e) => onCellClick(i, 10, e)}>{txn.balance != null ? formatGBP(txn.balance) : ''}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
