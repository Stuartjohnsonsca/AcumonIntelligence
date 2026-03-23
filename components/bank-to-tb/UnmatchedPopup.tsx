'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { X, Loader2, AlertCircle } from 'lucide-react';
import { AddAccountCodePopup } from './AddAccountCodePopup';

interface UnmatchedTxn {
  id: string;
  date: string;
  description: string;
  debit: number;
  credit: number;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  unmatchedTransactions: UnmatchedTxn[];
  chartOfAccounts: { id: string; accountCode: string; accountName: string; categoryType: string }[];
  sessionId: string;
  onComplete: () => void;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function UnmatchedPopup({ isOpen, onClose, unmatchedTransactions, chartOfAccounts, sessionId, onComplete }: Props) {
  const [categorisations, setCategorisations] = useState<Record<string, { accountCode: string; accountName: string; categoryType: string }>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [showAddNew, setShowAddNew] = useState<string | null>(null);
  const [localCoA, setLocalCoA] = useState(chartOfAccounts);

  if (!isOpen) return null;

  function handleAccountSelect(txnId: string, code: string) {
    const account = localCoA.find(a => a.accountCode === code);
    if (account) {
      setCategorisations(prev => ({
        ...prev,
        [txnId]: {
          accountCode: account.accountCode,
          accountName: account.accountName,
          categoryType: account.categoryType,
        },
      }));
    }
  }

  function handleNewAccount(txnId: string, newAccount: { accountCode: string; accountName: string; categoryType: string }) {
    setLocalCoA(prev => [...prev, { id: `new-${Date.now()}`, ...newAccount, sortOrder: prev.length }]);
    setCategorisations(prev => ({ ...prev, [txnId]: newAccount }));
    setShowAddNew(null);
  }

  async function handleSubmit() {
    const uncategorised = unmatchedTransactions.filter(t => !categorisations[t.id]);
    if (uncategorised.length > 0) {
      setError(`${uncategorised.length} transaction(s) still need to be categorised.`);
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      const res = await fetch('/api/bank-to-tb/categorise', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          categorisations: unmatchedTransactions.map(t => ({
            transactionId: t.id,
            ...categorisations[t.id],
          })),
        }),
      });

      if (!res.ok) throw new Error('Categorisation failed');
      const data = await res.json();

      if (data.remainingUncategorised > 0) {
        setError(`${data.remainingUncategorised} transaction(s) still uncategorised. Please add new account descriptions.`);
      } else {
        onComplete();
      }
    } catch (err) {
      console.error('Categorisation failed:', err);
      setError('Failed to save categorisations');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-lg shadow-xl w-[85vw] max-w-[900px] max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-lg font-semibold text-slate-800">
            Uncategorised Transactions ({unmatchedTransactions.length})
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {error && (
            <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded flex items-center gap-2 text-sm text-red-700">
              <AlertCircle className="h-4 w-4" />
              {error}
            </div>
          )}

          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-slate-100">
                <th className="px-2 py-2 text-left font-medium text-slate-600">Date</th>
                <th className="px-2 py-2 text-left font-medium text-slate-600">Description</th>
                <th className="px-2 py-2 text-right font-medium text-slate-600">Amount</th>
                <th className="px-2 py-2 text-left font-medium text-slate-600 w-[250px]">Account Code</th>
                <th className="px-2 py-2 w-[80px]"></th>
              </tr>
            </thead>
            <tbody>
              {unmatchedTransactions.map(txn => (
                <tr key={txn.id} className="border-b">
                  <td className="px-2 py-2 text-xs whitespace-nowrap">{formatDate(txn.date)}</td>
                  <td className="px-2 py-2 text-xs">{txn.description}</td>
                  <td className="px-2 py-2 text-xs text-right font-mono">
                    £{(txn.debit || txn.credit).toLocaleString('en-GB', { minimumFractionDigits: 2 })}
                    {txn.debit > 0 ? ' Dr' : ' Cr'}
                  </td>
                  <td className="px-2 py-1">
                    <select
                      value={categorisations[txn.id]?.accountCode || ''}
                      onChange={e => handleAccountSelect(txn.id, e.target.value)}
                      className="w-full border border-slate-200 rounded px-1 py-1 text-xs"
                    >
                      <option value="">Select account...</option>
                      {localCoA.map(a => (
                        <option key={a.accountCode} value={a.accountCode}>
                          {a.accountCode} - {a.accountName}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-xs px-2 py-1 h-auto"
                      onClick={() => setShowAddNew(txn.id)}
                    >
                      Add New
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t">
          <Button size="sm" variant="outline" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={handleSubmit} disabled={submitting} className="bg-blue-600 hover:bg-blue-700">
            {submitting && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
            Submit
          </Button>
        </div>
      </div>

      {showAddNew && (
        <AddAccountCodePopup
          onSave={(newAccount) => handleNewAccount(showAddNew, newAccount)}
          onCancel={() => setShowAddNew(null)}
        />
      )}
    </div>
  );
}
