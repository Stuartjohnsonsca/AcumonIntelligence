'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { X, Plus, Loader2 } from 'lucide-react';
import { useBankToTB, type BTBJournal } from './BankToTBContext';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  category: string;
  chartOfAccounts: { id: string; accountCode: string; accountName: string; categoryType: string }[];
  sessionId: string;
}

interface JournalLineInput {
  accountCode: string;
  accountName: string;
  description: string;
  debit: number;
  credit: number;
}

const DEFAULT_DESCRIPTIONS: Record<string, string> = {
  depreciation: 'Recognising Depreciation/Amortisation for the period',
  prepayments: 'Recognising prepayments and accrued income for the period.',
  accruals: 'Recognising accruals and deferred income for the period.',
  distributions: 'Recognising dividends declared in the period.',
  unbundle_fa: 'Recognising unbundling of fixed assets.',
  general: 'General journal entry',
};

function getDefaultLines(category: string, coa: Props['chartOfAccounts']): JournalLineInput[] {
  switch (category) {
    case 'depreciation': {
      const faAccounts = coa.filter(a => a.categoryType === 'Fixed Asset');
      const lines: JournalLineInput[] = [];
      const groups = new Set(faAccounts.map(a => a.accountName.split(' ')[0]));
      for (const group of groups) {
        lines.push({
          accountCode: '',
          accountName: `Depreciation/Amortisation of ${group} Charge for the year`,
          description: '',
          debit: 0,
          credit: 0,
        });
        lines.push({
          accountCode: '',
          accountName: `Accumulated Depreciation/Amortisation of ${group}`,
          description: '',
          debit: 0,
          credit: 0,
        });
      }
      return lines.length > 0 ? lines : [{ accountCode: '', accountName: '', description: '', debit: 0, credit: 0 }];
    }
    case 'prepayments': {
      return [
        ...coa.filter(a => ['Current Asset'].includes(a.categoryType)).slice(0, 2).map(a => ({
          accountCode: a.accountCode, accountName: a.accountName, description: '', debit: 0, credit: 0,
        })),
        ...coa.filter(a => a.categoryType === 'Revenue').slice(0, 1).map(a => ({
          accountCode: a.accountCode, accountName: a.accountName, description: '', debit: 0, credit: 0,
        })),
        { accountCode: '', accountName: '', description: '', debit: 0, credit: 0 },
      ];
    }
    case 'accruals': {
      return [
        ...coa.filter(a => ['Current Liability'].includes(a.categoryType)).slice(0, 2).map(a => ({
          accountCode: a.accountCode, accountName: a.accountName, description: '', debit: 0, credit: 0,
        })),
        ...coa.filter(a => a.categoryType === 'Revenue').slice(0, 1).map(a => ({
          accountCode: a.accountCode, accountName: a.accountName, description: '', debit: 0, credit: 0,
        })),
        { accountCode: '', accountName: '', description: '', debit: 0, credit: 0 },
      ];
    }
    case 'distributions': {
      return [
        ...coa.filter(a => a.categoryType === 'Equity').slice(0, 2).map(a => ({
          accountCode: a.accountCode, accountName: a.accountName, description: '', debit: 0, credit: 0,
        })),
        { accountCode: '', accountName: '', description: '', debit: 0, credit: 0 },
      ];
    }
    case 'unbundle_fa': {
      return coa.filter(a => a.categoryType === 'Fixed Asset').map(a => ({
        accountCode: a.accountCode, accountName: a.accountName, description: '', debit: 0, credit: 0,
      }));
    }
    default:
      return [{ accountCode: '', accountName: '', description: '', debit: 0, credit: 0 }];
  }
}

export function JournalPopup({ isOpen, onClose, category, chartOfAccounts, sessionId }: Props) {
  const { state, dispatch } = useBankToTB();
  const [description, setDescription] = useState(DEFAULT_DESCRIPTIONS[category] || '');
  const [lines, setLines] = useState<JournalLineInput[]>([]);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState('');
  const [existingJournals, setExistingJournals] = useState<BTBJournal[]>([]);
  const [showExisting, setShowExisting] = useState(category === 'existing');
  const [selectedExisting, setSelectedExisting] = useState<string | null>(null);

  useEffect(() => {
    if (category === 'existing') {
      // Load posted journals
      fetch(`/api/bank-to-tb/journal?sessionId=${sessionId}&status=posted`)
        .then(r => r.json())
        .then(data => setExistingJournals(data.journals || []))
        .catch(console.error);
    } else {
      setLines(getDefaultLines(category, chartOfAccounts));
    }
  }, [category, chartOfAccounts, sessionId]);

  if (!isOpen) return null;

  function handleAccountSelect(index: number, code: string) {
    const account = chartOfAccounts.find(a => a.accountCode === code);
    setLines(prev => prev.map((l, i) =>
      i === index ? { ...l, accountCode: code, accountName: account?.accountName || l.accountName } : l
    ));
  }

  function handleLineChange(index: number, field: keyof JournalLineInput, value: string | number) {
    setLines(prev => prev.map((l, i) =>
      i === index ? { ...l, [field]: value } : l
    ));
  }

  function addRow() {
    setLines(prev => [...prev, { accountCode: '', accountName: '', description: '', debit: 0, credit: 0 }]);
  }

  function removeRow(index: number) {
    setLines(prev => prev.filter((_, i) => i !== index));
  }

  async function handlePost() {
    const totalDr = lines.reduce((s, l) => s + (l.debit || 0), 0);
    const totalCr = lines.reduce((s, l) => s + (l.credit || 0), 0);

    if (Math.abs(totalDr - totalCr) > 0.01) {
      setError(`Journal does not balance. Dr: £${totalDr.toFixed(2)}, Cr: £${totalCr.toFixed(2)}`);
      return;
    }

    setPosting(true);
    setError('');

    try {
      // Create journal
      const createRes = await fetch('/api/bank-to-tb/journal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          category: category === 'existing' ? 'general' : category,
          description,
          lines: lines.filter(l => l.accountCode && (l.debit || l.credit)),
        }),
      });

      if (!createRes.ok) throw new Error('Failed to create journal');
      const { journal } = await createRes.json();

      // Post journal
      const postRes = await fetch(`/api/bank-to-tb/journal/${journal.id}/post`, {
        method: 'POST',
      });

      if (!postRes.ok) {
        const err = await postRes.json();
        setError(err.error || 'Failed to post journal');
        return;
      }

      const postData = await postRes.json();
      dispatch({ type: 'ADD_JOURNAL', payload: postData.journal });
      dispatch({ type: 'SET_TRIAL_BALANCE', payload: postData.trialBalance });
      onClose();
    } catch (err) {
      console.error('Post failed:', err);
      setError('Failed to post journal');
    } finally {
      setPosting(false);
    }
  }

  function handleSelectExisting(journalId: string) {
    const journal = existingJournals.find(j => j.id === journalId);
    if (!journal) return;
    setDescription(journal.description || '');
    setLines(journal.lines.map(l => ({
      accountCode: l.accountCode,
      accountName: l.accountName,
      description: l.description,
      debit: l.debit,
      credit: l.credit,
    })));
    setShowExisting(false);
    setSelectedExisting(journalId);
  }

  const totalDr = lines.reduce((s, l) => s + (l.debit || 0), 0);
  const totalCr = lines.reduce((s, l) => s + (l.credit || 0), 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-lg shadow-xl w-[90vw] max-w-[1000px] max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-lg font-semibold text-slate-800">
            {category === 'existing' ? 'Retrieve Existing Journal' : `Journal: ${category.replace(/_/g, ' ')}`}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {showExisting ? (
            <div className="space-y-2">
              {existingJournals.length === 0 ? (
                <p className="text-sm text-slate-500">No posted journals found.</p>
              ) : (
                existingJournals.map(j => (
                  <div
                    key={j.id}
                    onClick={() => handleSelectExisting(j.id)}
                    className="p-3 border rounded-md hover:bg-blue-50 cursor-pointer"
                  >
                    <div className="flex justify-between">
                      <span className="font-medium text-sm">{j.journalRef} - {j.category}</span>
                      <span className="text-xs text-slate-500">{j.status}</span>
                    </div>
                    <p className="text-xs text-slate-600 mt-1">{j.description}</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {j.lines.length} line(s) | Dr: £{j.lines.reduce((s, l) => s + l.debit, 0).toFixed(2)} | Cr: £{j.lines.reduce((s, l) => s + l.credit, 0).toFixed(2)}
                    </p>
                  </div>
                ))
              )}
            </div>
          ) : (
            <>
              {/* Description */}
              <input
                type="text"
                value={description}
                onChange={e => setDescription(e.target.value)}
                className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Journal description..."
              />

              {/* Lines table */}
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-slate-100">
                    <th className="px-2 py-2 text-left font-medium text-slate-600 w-[200px]">Account</th>
                    <th className="px-2 py-2 text-left font-medium text-slate-600">Description</th>
                    <th className="px-2 py-2 text-right font-medium text-slate-600 w-[120px]">Debit</th>
                    <th className="px-2 py-2 text-right font-medium text-slate-600 w-[120px]">Credit</th>
                    <th className="w-[40px]"></th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, i) => (
                    <tr key={i} className="border-b">
                      <td className="px-1 py-1">
                        <select
                          value={line.accountCode}
                          onChange={e => handleAccountSelect(i, e.target.value)}
                          className="w-full border border-slate-200 rounded px-1 py-1 text-xs"
                        >
                          <option value="">Select...</option>
                          {chartOfAccounts.map(a => (
                            <option key={a.accountCode} value={a.accountCode}>
                              {a.accountCode} - {a.accountName}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-1 py-1">
                        <input
                          type="text"
                          value={line.description}
                          onChange={e => handleLineChange(i, 'description', e.target.value)}
                          className="w-full border border-slate-200 rounded px-2 py-1 text-xs"
                        />
                      </td>
                      <td className="px-1 py-1">
                        <input
                          type="number"
                          value={line.debit || ''}
                          onChange={e => handleLineChange(i, 'debit', parseFloat(e.target.value) || 0)}
                          className="w-full border border-slate-200 rounded px-2 py-1 text-xs text-right"
                          step="0.01"
                        />
                      </td>
                      <td className="px-1 py-1">
                        <input
                          type="number"
                          value={line.credit || ''}
                          onChange={e => handleLineChange(i, 'credit', parseFloat(e.target.value) || 0)}
                          className="w-full border border-slate-200 rounded px-2 py-1 text-xs text-right"
                          step="0.01"
                        />
                      </td>
                      <td className="px-1 py-1">
                        <button onClick={() => removeRow(i)} className="text-red-400 hover:text-red-600">
                          <X className="h-3 w-3" />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {/* Totals */}
                  <tr className="bg-slate-50 font-semibold">
                    <td colSpan={2} className="px-2 py-2 text-right">Totals:</td>
                    <td className="px-2 py-2 text-right">£{totalDr.toFixed(2)}</td>
                    <td className="px-2 py-2 text-right">£{totalCr.toFixed(2)}</td>
                    <td></td>
                  </tr>
                </tbody>
              </table>

              {error && (
                <div className="mt-3 p-2 bg-red-50 border border-red-200 rounded text-sm text-red-700">
                  {error}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t">
          <div>
            {!showExisting && (
              <Button size="sm" variant="outline" onClick={addRow}>
                <Plus className="h-3 w-3 mr-1" />
                Add Row
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={onClose}>Cancel</Button>
            {!showExisting && (
              <Button size="sm" onClick={handlePost} disabled={posting} className="bg-blue-600 hover:bg-blue-700">
                {posting && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                Post
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
