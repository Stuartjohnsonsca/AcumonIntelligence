'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import { Upload, FileText, Check, AlertCircle, Loader2 } from 'lucide-react';
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
  const pollRef = useRef<ReturnType<typeof setInterval>>();

  const hasProcessing = state.files.some(f => f.status === 'uploaded' || f.status === 'processing');

  const pollStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/bank-to-tb/status?sessionId=${sessionId}`);
      if (!res.ok) return;
      const data = await res.json();
      dispatch({ type: 'SET_FILES', payload: data.files });

      if (data.summary.complete) {
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

      // Start polling
      if (!pollRef.current) {
        pollRef.current = setInterval(pollStatus, 3000);
      }
    } catch (err) {
      console.error('Upload failed:', err);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
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
        disabled={uploading}
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
        </div>
      )}
    </div>
  );
}
