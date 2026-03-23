'use client';

import { useState, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { useBankToTB } from './BankToTBContext';

const CATEGORY_OPTIONS = [
  'Fixed Asset', 'Investment', 'Current Asset', 'Current Liability',
  'Long-term Liability', 'Equity', 'Revenue', 'Direct Costs',
  'Overheads', 'Other Income', 'Tax Charge', 'Distribution',
];

interface PasteRow {
  accountCode: string;
  accountName: string;
  categoryType: string;
  amount: string;
}

interface Props {
  sessionId: string;
}

export function OpeningPositionSection({ sessionId }: Props) {
  const { state, dispatch } = useBankToTB();
  const [source, setSource] = useState(state.openingPositionSource || '');
  const [loading, setLoading] = useState(false);
  const [showPaste, setShowPaste] = useState(false);
  const [pasteRows, setPasteRows] = useState<PasteRow[]>([
    { accountCode: '', accountName: '', categoryType: 'Overheads', amount: '' },
  ]);
  const [showPriorConfirm, setShowPriorConfirm] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleObtain() {
    if (!source) return;
    setError('');

    if (source === 'paste') {
      setShowPaste(true);
      setShowPriorConfirm(false);
      return;
    }

    if (source === 'upload') {
      fileInputRef.current?.click();
      return;
    }

    if (source === 'prior_period') {
      setShowPriorConfirm(true);
      setShowPaste(false);
      return;
    }

    // firm_standard
    await loadOpeningPosition(source, {});
  }

  async function loadOpeningPosition(src: string, extra: Record<string, unknown>) {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/bank-to-tb/opening-position', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, source: src, ...extra }),
      });

      if (!res.ok) {
        const err = await res.json();
        setError(err.error || 'Failed to load opening position');
        return;
      }

      const data = await res.json();
      dispatch({ type: 'SET_TRIAL_BALANCE', payload: data.entries });
      dispatch({ type: 'SET_OPENING_SOURCE', payload: src });
      dispatch({ type: 'SET_VIEW', payload: 'trial-balance' });
      setShowPaste(false);
      setShowPriorConfirm(false);
    } catch {
      setError('Network error loading opening position');
    } finally {
      setLoading(false);
    }
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const buffer = await file.arrayBuffer();
    const base64 = btoa(
      new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
    );

    await loadOpeningPosition('upload', {
      uploadData: { data: base64, fileName: file.name },
    });

    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  // Handle paste event on the spreadsheet area
  const handleSpreadsheetPaste = useCallback((e: React.ClipboardEvent<HTMLDivElement>) => {
    const text = e.clipboardData.getData('text/plain');
    if (!text.trim()) return;
    e.preventDefault();

    const lines = text.split('\n').filter(l => l.trim());
    const newRows: PasteRow[] = [];

    for (const line of lines) {
      const cols = line.split('\t');
      if (cols.length < 2) continue;

      // Flexible: support 2-col (Name, Amount), 3-col (Code, Name, Amount), 4-col (Code, Name, Category, Amount), 5-col (Code, Name, Category, Dr, Cr)
      if (cols.length === 2) {
        const amount = parseFloat(cols[1].replace(/[£,]/g, ''));
        newRows.push({
          accountCode: '',
          accountName: cols[0].trim(),
          categoryType: 'Overheads',
          amount: isNaN(amount) ? '' : amount.toString(),
        });
      } else if (cols.length === 3) {
        const amount = parseFloat(cols[2].replace(/[£,]/g, ''));
        newRows.push({
          accountCode: cols[0].trim(),
          accountName: cols[1].trim(),
          categoryType: 'Overheads',
          amount: isNaN(amount) ? '' : amount.toString(),
        });
      } else if (cols.length === 4) {
        const amount = parseFloat(cols[3].replace(/[£,]/g, ''));
        newRows.push({
          accountCode: cols[0].trim(),
          accountName: cols[1].trim(),
          categoryType: cols[2].trim() || 'Overheads',
          amount: isNaN(amount) ? '' : amount.toString(),
        });
      } else {
        // 5+ columns: Code, Name, Category, Debit, Credit
        const dr = parseFloat(cols[3].replace(/[£,]/g, '')) || 0;
        const cr = parseFloat(cols[4].replace(/[£,]/g, '')) || 0;
        const net = dr - cr;
        newRows.push({
          accountCode: cols[0].trim(),
          accountName: cols[1].trim(),
          categoryType: cols[2].trim() || 'Overheads',
          amount: net.toString(),
        });
      }
    }

    if (newRows.length > 0) {
      setPasteRows(newRows);
    }
  }, []);

  function updatePasteRow(index: number, field: keyof PasteRow, value: string) {
    setPasteRows(prev => prev.map((r, i) => i === index ? { ...r, [field]: value } : r));
  }

  function addPasteRow() {
    setPasteRows(prev => [...prev, { accountCode: '', accountName: '', categoryType: 'Overheads', amount: '' }]);
  }

  function removePasteRow(index: number) {
    setPasteRows(prev => prev.filter((_, i) => i !== index));
  }

  async function handlePasteSubmit() {
    const validRows = pasteRows.filter(r => r.accountName.trim());
    if (validRows.length === 0) {
      setError('Please enter at least one account name');
      return;
    }

    // Convert to tab-delimited paste format for the API
    const pasteData = validRows.map((r, i) => {
      const code = r.accountCode.trim() || `AUTO-${i + 1}`;
      const amount = parseFloat(r.amount) || 0;
      const debit = amount >= 0 ? amount : 0;
      const credit = amount < 0 ? Math.abs(amount) : 0;
      return `${code}\t${r.accountName}\t${r.categoryType}\t${debit}\t${credit}`;
    }).join('\n');

    await loadOpeningPosition('paste', { pasteData });
  }

  return (
    <div>
      <h3 className="text-sm font-semibold text-slate-700 mb-2">Opening Position</h3>

      <select
        value={source}
        onChange={e => {
          setSource(e.target.value);
          setShowPaste(false);
          setShowPriorConfirm(false);
          setError('');
        }}
        className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <option value="">Select source...</option>
        <option value="firm_standard">Firm Standard</option>
        <option value="upload">Upload</option>
        <option value="paste">Paste</option>
        <option value="prior_period">Prior Period</option>
      </select>

      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        onChange={handleFileUpload}
        className="hidden"
      />

      <Button
        size="sm"
        onClick={handleObtain}
        disabled={!source || loading}
        className={`w-full mt-2 ${source ? 'bg-green-600 hover:bg-green-700 text-white' : 'bg-slate-300'}`}
      >
        {loading && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
        Obtain data
      </Button>

      {error && (
        <p className="text-xs text-red-600 mt-1 bg-red-50 border border-red-200 rounded px-2 py-1">{error}</p>
      )}

      {/* Paste spreadsheet interface */}
      {showPaste && (
        <div className="mt-3 border border-slate-300 rounded-md overflow-hidden" onPaste={handleSpreadsheetPaste}>
          <div className="bg-slate-100 px-2 py-1 text-[10px] text-slate-500 border-b">
            Paste from a spreadsheet or enter manually. Positive = Debit, Negative = Credit.
          </div>
          <div className="max-h-60 overflow-auto">
            <table className="w-full text-[11px] border-collapse">
              <thead className="bg-slate-50 sticky top-0">
                <tr>
                  <th className="px-1.5 py-1 text-left font-medium text-slate-600 border-b w-16">Code</th>
                  <th className="px-1.5 py-1 text-left font-medium text-slate-600 border-b">Name</th>
                  <th className="px-1.5 py-1 text-right font-medium text-slate-600 border-b w-20">Amount</th>
                  <th className="px-1.5 py-1 border-b w-6" />
                </tr>
              </thead>
              <tbody>
                {pasteRows.map((row, i) => (
                  <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                    <td className="px-0.5 py-0.5 border-b border-slate-100">
                      <input
                        type="text"
                        value={row.accountCode}
                        onChange={e => updatePasteRow(i, 'accountCode', e.target.value)}
                        className="w-full px-1 py-0.5 text-[11px] border border-transparent hover:border-slate-300 focus:border-blue-400 focus:outline-none rounded bg-orange-50"
                        placeholder="Code"
                      />
                    </td>
                    <td className="px-0.5 py-0.5 border-b border-slate-100">
                      <input
                        type="text"
                        value={row.accountName}
                        onChange={e => updatePasteRow(i, 'accountName', e.target.value)}
                        className="w-full px-1 py-0.5 text-[11px] border border-transparent hover:border-slate-300 focus:border-blue-400 focus:outline-none rounded bg-orange-50"
                        placeholder="Account name"
                      />
                    </td>
                    <td className="px-0.5 py-0.5 border-b border-slate-100">
                      <input
                        type="text"
                        value={row.amount}
                        onChange={e => updatePasteRow(i, 'amount', e.target.value)}
                        className="w-full px-1 py-0.5 text-[11px] text-right font-mono border border-transparent hover:border-slate-300 focus:border-blue-400 focus:outline-none rounded bg-orange-50"
                        placeholder="0.00"
                      />
                    </td>
                    <td className="px-0.5 py-0.5 border-b border-slate-100">
                      {pasteRows.length > 1 && (
                        <button onClick={() => removePasteRow(i)} className="text-slate-400 hover:text-red-500">
                          <Trash2 className="h-3 w-3" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex gap-1 p-1.5 border-t bg-slate-50">
            <Button size="sm" variant="outline" onClick={addPasteRow} className="h-6 text-[10px] px-2">
              <Plus className="h-2.5 w-2.5 mr-0.5" /> Row
            </Button>
            <div className="flex-1" />
            <Button size="sm" variant="outline" onClick={() => setShowPaste(false)} className="h-6 text-[10px] px-2">
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handlePasteSubmit}
              disabled={loading}
              className="h-6 text-[10px] px-2 bg-green-600 hover:bg-green-700 text-white"
            >
              {loading && <Loader2 className="h-2.5 w-2.5 mr-0.5 animate-spin" />}
              Submit
            </Button>
          </div>
        </div>
      )}

      {showPriorConfirm && (
        <div className="mt-2 p-2 bg-slate-50 border rounded-md text-xs">
          <p className="text-slate-600 mb-2">
            This will load the trial balance from the period ending the day before this period starts.
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setShowPriorConfirm(false)}>Cancel</Button>
            <Button
              size="sm"
              onClick={() => loadOpeningPosition('prior_period', {})}
              disabled={loading}
            >
              {loading && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
              Confirm
            </Button>
          </div>
        </div>
      )}

      {state.openingPositionSource && (
        <p className="text-xs text-green-600 mt-1">
          Loaded from: {state.openingPositionSource.replace('_', ' ')}
        </p>
      )}
    </div>
  );
}
