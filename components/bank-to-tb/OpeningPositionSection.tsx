'use client';

import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { useBankToTB } from './BankToTBContext';

interface Props {
  sessionId: string;
}

export function OpeningPositionSection({ sessionId }: Props) {
  const { state, dispatch } = useBankToTB();
  const [source, setSource] = useState(state.openingPositionSource || '');
  const [loading, setLoading] = useState(false);
  const [pasteData, setPasteData] = useState('');
  const [showPaste, setShowPaste] = useState(false);
  const [showPriorConfirm, setShowPriorConfirm] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleObtain() {
    if (!source) return;

    if (source === 'paste') {
      setShowPaste(true);
      return;
    }

    if (source === 'upload') {
      fileInputRef.current?.click();
      return;
    }

    if (source === 'prior_period') {
      setShowPriorConfirm(true);
      return;
    }

    // firm_standard
    await loadOpeningPosition(source, {});
  }

  async function loadOpeningPosition(src: string, extra: Record<string, unknown>) {
    setLoading(true);
    try {
      const res = await fetch('/api/bank-to-tb/opening-position', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, source: src, ...extra }),
      });

      if (!res.ok) {
        const err = await res.json();
        alert(err.error || 'Failed to load opening position');
        return;
      }

      const data = await res.json();
      dispatch({ type: 'SET_TRIAL_BALANCE', payload: data.entries });
      dispatch({ type: 'SET_OPENING_SOURCE', payload: src });
      dispatch({ type: 'SET_VIEW', payload: 'trial-balance' });
      setShowPaste(false);
      setShowPriorConfirm(false);
    } catch (err) {
      console.error('Opening position failed:', err);
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

  async function handlePasteSubmit() {
    if (!pasteData.trim()) return;
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
        className={`w-full mt-2 ${source ? 'bg-green-600 hover:bg-green-700' : 'bg-slate-300'}`}
      >
        {loading && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
        Obtain data
      </Button>

      {showPaste && (
        <div className="mt-2">
          <textarea
            value={pasteData}
            onChange={e => setPasteData(e.target.value)}
            placeholder="Paste tab-delimited data: Code, Name, Category, Debit, Credit"
            className="w-full h-32 border border-slate-300 rounded-md p-2 text-xs font-mono resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <Button size="sm" onClick={handlePasteSubmit} disabled={loading} className="w-full mt-1">
            {loading && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
            Submit Paste Data
          </Button>
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
