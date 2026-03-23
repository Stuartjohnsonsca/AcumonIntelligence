'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import { Upload, FileText, Check, AlertCircle, Loader2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useBankToTB } from './BankToTBContext';
import { useBackgroundTasks } from '@/components/BackgroundTaskProvider';
import { cn } from '@/lib/utils';

interface Props {
  sessionId: string;
}

export function FileUploadSection({ sessionId }: Props) {
  const { state, dispatch } = useBankToTB();
  const { addTask, updateTask } = useBackgroundTasks();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [extractionStage, setExtractionStage] = useState<{ stage: string; currentFile: string | null; transactionCount: number } | null>(null);
  const [processError, setProcessError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval>>();

  const hasProcessing = state.files.some(f => f.status === 'uploaded' || f.status === 'processing');
  const hasUploaded = state.files.some(f => f.status === 'uploaded');
  const hasFailed = state.files.some(f => f.status === 'failed');

  const stageLabels: Record<string, string> = {
    downloading: 'Downloading file from storage...',
    extracting: 'Extracting transaction data (AI OCR)...',
    saving: 'Saving extracted transactions...',
    processing: 'Processing...',
  };

  const pollStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/bank-to-tb/status?sessionId=${sessionId}`);
      if (!res.ok) return;
      const data = await res.json();
      dispatch({ type: 'SET_FILES', payload: data.files });

      // Update extraction stage display
      if (data.progress) {
        setExtractionStage(data.progress);
      }

      if (data.summary.complete) {
        setExtractionStage(null);
        // All files processed - reload session for transactions
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = undefined;
        }

        const sessRes = await fetch(`/api/bank-to-tb/session?clientId=${state.clientId}&periodId=${state.periodId}`);
        const sessData = await sessRes.json();
        if (sessData.session) {
          dispatch({ type: 'SET_TRANSACTIONS', payload: sessData.session.transactions });
          dispatch({ type: 'SET_ACCOUNTS', payload: sessData.session.accounts });
          dispatch({
            type: 'SET_MULTI_ACCOUNTS',
            payload: (sessData.session.transactions as { sortCode: string; accountNumber: string }[])
              .reduce((s: Set<string>, t: { sortCode: string; accountNumber: string }) => {
                s.add(`${t.sortCode}-${t.accountNumber}`);
                return s;
              }, new Set<string>()).size > 1,
          });
          dispatch({
            type: 'SET_OUT_OF_PERIOD',
            payload: sessData.session.transactions.some((t: { inPeriod: boolean }) => !t.inPeriod),
          });
        }

        updateTask(`btb-${sessionId}`, {
          status: 'completed',
          completedAt: Date.now(),
        });
      }
    } catch (err) {
      console.error('Poll status failed:', err);
    }
  }, [sessionId, state.clientId, state.periodId, dispatch, updateTask]);

  const triggerProcess = useCallback(async (sid: string) => {
    setProcessError(null);
    try {
      const res = await fetch('/api/bank-to-tb/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: sid }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        setProcessError(errData.error || `Extraction failed (${res.status})`);
        console.error('Process failed:', errData);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setProcessError(`Extraction request failed: ${msg}`);
      console.error('Process trigger failed:', err);
    }
  }, []);

  async function handleRetry() {
    if (!sessionId) return;
    setRetrying(true);
    setProcessError(null);
    await triggerProcess(sessionId);
    setRetrying(false);
  }

  useEffect(() => {
    if (hasProcessing && !pollRef.current) {
      pollRef.current = setInterval(pollStatus, 3000);
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = undefined;
      }
    };
  }, [hasProcessing, pollStatus]);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('sessionId', sessionId);
      for (const file of Array.from(files)) {
        formData.append('files', file);
      }

      const res = await fetch('/api/bank-to-tb/upload', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) throw new Error('Upload failed');

      const data = await res.json();
      dispatch({ type: 'ADD_FILES', payload: data.files });

      // Add background task dot
      addTask({
        id: `btb-${sessionId}`,
        clientName: 'Bank to TB',
        activity: `Processing ${data.files.length} file(s)`,
        status: 'running',
        toolPath: '/tools/bank-to-tb',
      });

      // Trigger server-side processing and start polling
      if (!pollRef.current) {
        pollRef.current = setInterval(pollStatus, 3000);
      }

      triggerProcess(sessionId);
    } catch (err) {
      console.error('Upload failed:', err);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleReset() {
    if (!confirm('This will cancel any processing and clear all uploaded files for this session. Continue?')) return;
    setResetting(true);
    try {
      // Stop polling
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = undefined;
      }

      // Call server to reset files and transactions
      await fetch('/api/bank-to-tb/reset-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });

      // Clear all local state
      dispatch({ type: 'SET_FILES', payload: [] });
      dispatch({ type: 'SET_TRANSACTIONS', payload: [] });
      dispatch({ type: 'SET_ACCOUNTS', payload: [] });
      dispatch({ type: 'SET_TRIAL_BALANCE', payload: [] });
      dispatch({ type: 'SET_MULTI_ACCOUNTS', payload: false });
      dispatch({ type: 'SET_OUT_OF_PERIOD', payload: false });
      dispatch({ type: 'SET_OPENING_SOURCE', payload: '' });
      dispatch({ type: 'SET_VIEW', payload: 'bank-transactions' });
      setProcessError(null);
      setExtractionStage(null);

      updateTask(`btb-${sessionId}`, {
        status: 'completed',
        completedAt: Date.now(),
      });
    } catch (err) {
      console.error('Reset failed:', err);
    } finally {
      setResetting(false);
    }
  }

  return (
    <div>
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.jpg,.jpeg,.png,.tiff,.bmp"
        multiple
        onChange={handleUpload}
        className="hidden"
      />
      <Button
        size="sm"
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading || resetting}
        className="w-full bg-blue-600 hover:bg-blue-700"
      >
        {uploading ? (
          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
        ) : (
          <Upload className="h-4 w-4 mr-2" />
        )}
        Upload Bank Statements
      </Button>

      {/* File list */}
      {state.files.length > 0 && (
        <div className="mt-3 space-y-2">
          {state.files.map(file => (
            <div key={file.id} className="text-xs">
              <div className="flex items-center gap-1.5">
                <FileText className="h-3 w-3 text-slate-400 flex-shrink-0" />
                <span className="truncate flex-1" title={file.originalName}>{file.originalName}</span>
                {file.status === 'extracted' && <Check className="h-3 w-3 text-green-500" />}
                {file.status === 'failed' && <AlertCircle className="h-3 w-3 text-red-500" />}
                {(file.status === 'uploaded' || file.status === 'processing') && (
                  <Loader2 className="h-3 w-3 text-orange-500 animate-spin" />
                )}
              </div>
              {/* Progress bar */}
              <div className="mt-1 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                <div
                  className={cn(
                    'h-full rounded-full transition-all duration-500',
                    file.status === 'extracted' ? 'bg-green-500 w-full' :
                    file.status === 'failed' ? 'bg-red-500 w-full' :
                    file.status === 'processing' ? 'bg-green-500 w-2/3' :
                    'bg-green-500 w-1/3'
                  )}
                />
              </div>
              {file.errorMessage && (
                <p className="text-red-500 mt-0.5 text-[10px]">{file.errorMessage}</p>
              )}
            </div>
          ))}

          {/* Process error display */}
          {processError && (
            <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded-md">
              <p className="text-[10px] text-red-700 font-medium">Extraction Error</p>
              <p className="text-[10px] text-red-600 mt-0.5">{processError}</p>
              <Button
                size="sm"
                variant="outline"
                onClick={handleRetry}
                disabled={retrying}
                className="mt-1.5 h-6 text-[10px] border-red-300 text-red-700 hover:bg-red-50"
              >
                {retrying ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : null}
                Retry Extraction
              </Button>
            </div>
          )}

          {/* Retry button when files stuck in uploaded status */}
          {hasUploaded && !hasProcessing && !processError && state.files.length > 0 && (
            <div className="mt-2">
              <Button
                size="sm"
                variant="outline"
                onClick={handleRetry}
                disabled={retrying}
                className="w-full h-6 text-[10px] border-orange-300 text-orange-700 hover:bg-orange-50"
              >
                {retrying ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : null}
                Extract Data from Uploaded Files
              </Button>
            </div>
          )}

          {/* Extraction stage info */}
          {extractionStage && hasProcessing && (
            <div className="mt-2 p-2 bg-blue-50 border border-blue-200 rounded-md">
              <div className="flex items-center gap-1.5 text-[10px] text-blue-700">
                <Loader2 className="h-3 w-3 animate-spin text-blue-500" />
                <span className="font-medium">{stageLabels[extractionStage.stage] || extractionStage.stage}</span>
              </div>
              {extractionStage.currentFile && (
                <p className="text-[10px] text-blue-600 mt-0.5 truncate">
                  File: {extractionStage.currentFile}
                </p>
              )}
              {extractionStage.transactionCount > 0 && (
                <p className="text-[10px] text-blue-600 mt-0.5">
                  Found {extractionStage.transactionCount} transactions so far
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Reset button — always visible when there are files or transactions */}
      {(state.files.length > 0 || state.transactions.length > 0) && (
        <Button
          size="sm"
          variant="outline"
          onClick={handleReset}
          disabled={resetting}
          className="w-full mt-3 border-red-300 text-red-600 hover:bg-red-50 hover:text-red-700 hover:border-red-400"
        >
          {resetting ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <RotateCcw className="h-4 w-4 mr-2" />
          )}
          Reset &amp; Clear All
        </Button>
      )}
    </div>
  );
}
