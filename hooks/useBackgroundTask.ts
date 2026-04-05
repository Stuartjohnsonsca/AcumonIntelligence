'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

interface BackgroundTaskState {
  status: 'idle' | 'running' | 'completed' | 'error';
  progress: { phase?: string; step?: number; totalSteps?: number; message?: string; recordCount?: number } | null;
  result: any | null;
  error: string | null;
}

interface UseBackgroundTaskOptions {
  pollInterval?: number;  // ms, default 1500
  maxPolls?: number;      // default 240 (6 minutes)
  onComplete?: (result: any) => void;
  onError?: (error: string) => void;
}

/**
 * Shared hook for polling background tasks.
 *
 * Usage:
 *   const { start, status, progress, result, error } = useBackgroundTask('/api/my-endpoint', options);
 *
 *   // Start a task:
 *   const taskId = await start({ action: 'do_something', data: '...' });
 *
 *   // Hook auto-polls and updates status/progress/result
 */
export function useBackgroundTask(endpoint: string, options: UseBackgroundTaskOptions = {}) {
  const { pollInterval = 1500, maxPolls = 240, onComplete, onError } = options;
  const [state, setState] = useState<BackgroundTaskState>({ status: 'idle', progress: null, result: null, error: null });
  const [taskId, setTaskId] = useState<string | null>(null);
  const abortRef = useRef(false);
  const pollCountRef = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  // Poll for task status
  useEffect(() => {
    if (!taskId) return;

    pollCountRef.current = 0;
    abortRef.current = false;

    intervalRef.current = setInterval(async () => {
      if (abortRef.current) { stopPolling(); return; }
      pollCountRef.current++;

      if (pollCountRef.current > maxPolls) {
        stopPolling();
        setState(prev => ({ ...prev, status: 'error', error: 'Task timed out' }));
        onError?.('Task timed out');
        return;
      }

      try {
        const res = await fetch(`${endpoint}?taskId=${taskId}`);
        if (!res.ok) return;
        const data = await res.json();

        if (data.status === 'completed') {
          stopPolling();
          setState({ status: 'completed', progress: null, result: data.result || data.data, error: null });
          onComplete?.(data.result || data.data);
          return;
        }

        if (data.status === 'error') {
          stopPolling();
          setState({ status: 'error', progress: null, result: null, error: data.error || 'Task failed' });
          onError?.(data.error || 'Task failed');
          return;
        }

        // Still running — update progress
        setState(prev => ({
          ...prev,
          status: 'running',
          progress: data.progress || prev.progress,
        }));
      } catch {
        // Network error — keep polling
      }
    }, pollInterval);

    return () => stopPolling();
  }, [taskId, endpoint, pollInterval, maxPolls, onComplete, onError, stopPolling]);

  // Start a new task
  const start = useCallback(async (body: any): Promise<string | null> => {
    setState({ status: 'running', progress: { message: 'Starting...' }, result: null, error: null });
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const errMsg = data.error || `Failed (${res.status})`;
        setState({ status: 'error', progress: null, result: null, error: errMsg });
        onError?.(errMsg);
        return null;
      }
      const data = await res.json();
      const id = data.taskId;
      if (id) {
        setTaskId(id);
        return id;
      }
      // No taskId — assume synchronous response
      setState({ status: 'completed', progress: null, result: data, error: null });
      onComplete?.(data);
      return null;
    } catch (err: any) {
      setState({ status: 'error', progress: null, result: null, error: err.message || 'Failed to start' });
      onError?.(err.message);
      return null;
    }
  }, [endpoint, onComplete, onError]);

  const abort = useCallback(() => {
    abortRef.current = true;
    stopPolling();
    setState(prev => ({ ...prev, status: 'idle' }));
  }, [stopPolling]);

  const reset = useCallback(() => {
    stopPolling();
    setTaskId(null);
    setState({ status: 'idle', progress: null, result: null, error: null });
  }, [stopPolling]);

  return {
    start,
    abort,
    reset,
    taskId,
    ...state,
  };
}
