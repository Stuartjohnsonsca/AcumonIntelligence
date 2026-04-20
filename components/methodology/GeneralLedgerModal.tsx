'use client';

import { useState, useRef } from 'react';
import { X, Upload, Send, FileSpreadsheet, Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react';

interface UploadResult {
  inPeriodCount?: number;
  outOfPeriodCount?: number;
  warnings?: string[];
}

interface Props {
  engagementId: string;
  onClose: () => void;
  /** Called after a successful upload OR a successful client-request,
   *  so the parent (TrialBalanceTab) can refresh its state. */
  onSuccess: () => void;
}

export function GeneralLedgerModal({ engagementId, onClose, onSuccess }: Props) {
  const [mode, setMode] = useState<'choose' | 'upload' | 'request'>('choose');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [requestSent, setRequestSent] = useState(false);
  const [requestMessage, setRequestMessage] = useState('Please upload the General Ledger for the audit period — full transaction listing per account (date, account code, debit, credit).');
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleUpload() {
    const file = fileInputRef.current?.files?.[0];
    if (!file) return;
    setWorking(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`/api/engagements/${engagementId}/general-ledger`, { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setUploadResult({
        inPeriodCount: data.metadata?.parsedSummary?.inPeriodCount,
        outOfPeriodCount: data.metadata?.parsedSummary?.outOfPeriodCount,
        warnings: data.metadata?.parsedSummary?.warnings || [],
      });
      onSuccess();
    } catch (err: any) {
      setError(err?.message || 'Upload failed');
    } finally {
      setWorking(false);
    }
  }

  async function handleSendRequest() {
    setWorking(true);
    setError(null);
    try {
      const res = await fetch(`/api/engagements/${engagementId}/general-ledger`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'request', message: requestMessage }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setRequestSent(true);
      onSuccess();
    } catch (err: any) {
      setError(err?.message || 'Failed to send request');
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-2xl max-w-xl w-full">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <h3 className="text-sm font-semibold text-slate-800">Obtain General Ledger</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 min-h-[200px]">
          {error && (
            <div className="mb-3 px-3 py-2 bg-red-50 border border-red-200 rounded text-xs text-red-700 flex items-start gap-2">
              <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {mode === 'choose' && (
            <>
              <p className="text-sm text-slate-600 mb-4">
                The G/L will be used to verify each Trial Balance row by reconciling
                <strong> prior period + period movements </strong> against the current period balance.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => setMode('request')}
                  className="border border-slate-200 rounded-lg p-4 text-left hover:border-blue-400 hover:shadow-md transition-all"
                >
                  <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-blue-100 text-blue-600 mb-2">
                    <Send className="h-5 w-5" />
                  </div>
                  <h4 className="text-sm font-semibold text-slate-800 mb-1">Send Client Request</h4>
                  <p className="text-xs text-slate-500">Create a portal request that the client responds to with the G/L file. The file is committed back to this schedule.</p>
                </button>
                <button
                  onClick={() => setMode('upload')}
                  className="border border-slate-200 rounded-lg p-4 text-left hover:border-blue-400 hover:shadow-md transition-all"
                >
                  <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-emerald-100 text-emerald-600 mb-2">
                    <Upload className="h-5 w-5" />
                  </div>
                  <h4 className="text-sm font-semibold text-slate-800 mb-1">Upload</h4>
                  <p className="text-xs text-slate-500">Upload the G/L file (CSV or Excel) directly. Parsed and validated immediately.</p>
                </button>
              </div>
            </>
          )}

          {mode === 'upload' && !uploadResult && (
            <>
              <p className="text-sm text-slate-600 mb-3">
                Upload the General Ledger as <strong>CSV or Excel (.xlsx)</strong>. The file should have one
                row per transaction with at minimum: date, account code, debit/credit (or signed amount).
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                className="block w-full text-xs border border-slate-300 rounded p-2 file:mr-3 file:py-1 file:px-3 file:rounded file:border-0 file:text-xs file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
              />
              <div className="flex gap-2 mt-4">
                <button
                  onClick={handleUpload}
                  disabled={working}
                  className="text-xs px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 inline-flex items-center gap-1.5"
                >
                  {working ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
                  {working ? 'Uploading & parsing...' : 'Upload & Parse'}
                </button>
                <button onClick={() => setMode('choose')} className="text-xs px-4 py-2 bg-slate-100 text-slate-600 rounded hover:bg-slate-200">
                  Back
                </button>
              </div>
            </>
          )}

          {mode === 'upload' && uploadResult && (
            <>
              <div className="px-3 py-3 bg-green-50 border border-green-200 rounded text-xs text-green-800 flex items-start gap-2 mb-3">
                <CheckCircle2 className="h-4 w-4 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">G/L uploaded and parsed.</p>
                  <p className="mt-1">
                    {uploadResult.inPeriodCount ?? 0} transactions in period
                    {uploadResult.outOfPeriodCount ? `, ${uploadResult.outOfPeriodCount} ignored as out-of-period` : ''}.
                  </p>
                </div>
              </div>
              {uploadResult.warnings && uploadResult.warnings.length > 0 && (
                <div className="px-3 py-2 bg-amber-50 border border-amber-200 rounded text-[11px] text-amber-800 mb-3">
                  <p className="font-semibold mb-1">Warnings:</p>
                  <ul className="list-disc ml-4">{uploadResult.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
                </div>
              )}
              <p className="text-xs text-slate-600 mb-3">
                Each Trial Balance row now shows a <strong className="text-green-600">green</strong> or
                <strong className="text-red-600"> red</strong> dot in the GL Check column. Hover the dot
                to see the calculation.
              </p>
              <button onClick={onClose} className="text-xs px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
                Close
              </button>
            </>
          )}

          {mode === 'request' && !requestSent && (
            <>
              <p className="text-sm text-slate-600 mb-3">
                Sends a request to the Client Portal. The client responds by uploading the G/L file.
                Once committed, it&apos;s linked to this schedule and TB rows are validated automatically.
              </p>
              <label className="block text-xs font-medium text-slate-600 mb-1">Request message</label>
              <textarea
                value={requestMessage}
                onChange={e => setRequestMessage(e.target.value)}
                rows={4}
                className="w-full text-xs border border-slate-300 rounded p-2 resize-y focus:outline-none focus:border-blue-400"
              />
              <div className="flex gap-2 mt-4">
                <button
                  onClick={handleSendRequest}
                  disabled={working || !requestMessage.trim()}
                  className="text-xs px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 inline-flex items-center gap-1.5"
                >
                  {working ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                  {working ? 'Sending...' : 'Send Request'}
                </button>
                <button onClick={() => setMode('choose')} className="text-xs px-4 py-2 bg-slate-100 text-slate-600 rounded hover:bg-slate-200">
                  Back
                </button>
              </div>
            </>
          )}

          {mode === 'request' && requestSent && (
            <div className="text-center py-6">
              <CheckCircle2 className="h-10 w-10 mx-auto mb-3 text-green-500" />
              <p className="text-sm font-semibold text-slate-800 mb-1">Request sent</p>
              <p className="text-xs text-slate-500 mb-4">Track the response in the Portal tab. The G/L file will be available here once the client uploads it.</p>
              <button onClick={onClose} className="text-xs px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
                Close
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
