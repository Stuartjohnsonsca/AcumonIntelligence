'use client';

import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { useBankToTB } from './BankToTBContext';
import { JournalPopup } from './JournalPopup';
import { Download, Upload, Loader2 } from 'lucide-react';

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
  const { state, dispatch } = useBankToTB();
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!state.combineMode) return null;

  async function downloadTemplate() {
    const res = await fetch(`/api/bank-to-tb/journal/template?sessionId=${sessionId}`);
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'journal-template.xlsx';
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadResult(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('sessionId', sessionId);

      const res = await fetch('/api/bank-to-tb/journal/upload', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        setUploadResult(`Error: ${data.error || 'Upload failed'}`);
      } else {
        setUploadResult(`Uploaded ${data.journalsCreated} journal(s) with ${data.linesCreated} lines`);
        // Refresh journals and TB
        if (data.journals) dispatch({ type: 'SET_JOURNALS', payload: data.journals });
        if (data.trialBalance) dispatch({ type: 'SET_TRIAL_BALANCE', payload: data.trialBalance });
      }
    } catch (err: any) {
      setUploadResult(`Error: ${err.message}`);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

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

        {/* Upload / Download */}
        <div className="border-t border-slate-200 pt-2 mt-2 space-y-1.5">
          <Button size="sm" variant="outline" className="w-full text-xs justify-start" onClick={downloadTemplate}>
            <Download className="h-3 w-3 mr-1.5" /> Download Template
          </Button>
          <Button size="sm" variant="outline" className="w-full text-xs justify-start"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}>
            {uploading ? <Loader2 className="h-3 w-3 mr-1.5 animate-spin" /> : <Upload className="h-3 w-3 mr-1.5" />}
            Upload Journals
          </Button>
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleUpload} className="hidden" />
        </div>

        {uploadResult && (
          <div className={`text-[10px] px-2 py-1.5 rounded ${uploadResult.startsWith('Error') ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
            {uploadResult}
            <button onClick={() => setUploadResult(null)} className="ml-1 text-slate-400 hover:text-slate-600">×</button>
          </div>
        )}
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
