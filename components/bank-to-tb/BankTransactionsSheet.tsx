'use client';

import { useMemo, useState } from 'react';
import { useBankToTB } from './BankToTBContext';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';

function formatGBP(amount: number): string {
  if (!amount) return '';
  return '£' + Math.abs(amount).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function BankTransactionsSheet() {
  const { state, dispatch } = useBankToTB();
  const [organising, setOrganising] = useState(false);
  const [restricting, setRestricting] = useState(false);

  const filteredTxns = useMemo(() => {
    let txns = state.transactions.filter(t => t.inPeriod);
    if (state.activeAccountTab) {
      txns = txns.filter(t => t.accountId === state.activeAccountTab);
    }
    return txns.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [state.transactions, state.activeAccountTab]);

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
        // Reload session to get updated transactions with accountIds
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
        // Update transactions locally
        dispatch({
          type: 'SET_TRANSACTIONS',
          payload: state.transactions.map(t => {
            const d = new Date(t.date);
            // The server already marked them, just refresh from server
            return t;
          }),
        });
        // Reload to get accurate data
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
    <div className="flex flex-col h-full">
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

        {/* Reset button is in BankToTBClient.tsx top bar — always visible */}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0 bg-slate-100 z-10">
            <tr>
              <th className="px-2 py-2 text-left font-medium text-slate-600 border-b whitespace-nowrap">Bank Name</th>
              <th className="px-2 py-2 text-left font-medium text-slate-600 border-b whitespace-nowrap">Sort Code</th>
              <th className="px-2 py-2 text-left font-medium text-slate-600 border-b whitespace-nowrap">Account No</th>
              <th className="px-2 py-2 text-left font-medium text-slate-600 border-b whitespace-nowrap">Stmt Date</th>
              <th className="px-2 py-2 text-center font-medium text-slate-600 border-b whitespace-nowrap">Page</th>
              <th className="px-2 py-2 text-left font-medium text-slate-600 border-b whitespace-nowrap">Date</th>
              <th className="px-2 py-2 text-left font-medium text-slate-600 border-b whitespace-nowrap">Description</th>
              <th className="px-2 py-2 text-left font-medium text-slate-600 border-b whitespace-nowrap">Reference</th>
              <th className="px-2 py-2 text-right font-medium text-slate-600 border-b whitespace-nowrap">Debit</th>
              <th className="px-2 py-2 text-right font-medium text-slate-600 border-b whitespace-nowrap">Credit</th>
              <th className="px-2 py-2 text-right font-medium text-slate-600 border-b whitespace-nowrap">Balance</th>
            </tr>
          </thead>
          <tbody>
            {filteredTxns.length === 0 ? (
              <tr>
                <td colSpan={11} className="px-4 py-8 text-center text-slate-400">
                  No transactions. Upload bank statements to begin extraction.
                </td>
              </tr>
            ) : (
              filteredTxns.map((txn, i) => (
                <tr key={txn.id} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                  <td className="px-2 py-1.5 border-b border-slate-100 whitespace-nowrap">{txn.bankName || ''}</td>
                  <td className="px-2 py-1.5 border-b border-slate-100 whitespace-nowrap">{txn.sortCode || ''}</td>
                  <td className="px-2 py-1.5 border-b border-slate-100 whitespace-nowrap">{txn.accountNumber || ''}</td>
                  <td className="px-2 py-1.5 border-b border-slate-100 whitespace-nowrap">{txn.statementDate || ''}</td>
                  <td className="px-2 py-1.5 border-b border-slate-100 text-center">{txn.statementPage ?? ''}</td>
                  <td className="px-2 py-1.5 border-b border-slate-100 whitespace-nowrap">{formatDate(txn.date)}</td>
                  <td className="px-2 py-1.5 border-b border-slate-100 max-w-[300px] truncate">{txn.description}</td>
                  <td className="px-2 py-1.5 border-b border-slate-100 whitespace-nowrap">{txn.reference || ''}</td>
                  <td className="px-2 py-1.5 border-b border-slate-100 text-right font-mono">{txn.debit > 0 ? formatGBP(txn.debit) : ''}</td>
                  <td className="px-2 py-1.5 border-b border-slate-100 text-right font-mono">{txn.credit > 0 ? formatGBP(txn.credit) : ''}</td>
                  <td className="px-2 py-1.5 border-b border-slate-100 text-right font-mono">{txn.balance != null ? formatGBP(txn.balance) : ''}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
