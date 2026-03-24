'use client';

import { useRef, useEffect, useState, useCallback } from 'react';

interface AutoSaveOptions {
  delay?: number;
  enabled?: boolean;
  method?: 'PUT' | 'POST' | 'PATCH';
}

interface AutoSaveResult {
  saving: boolean;
  lastSaved: Date | null;
  error: string | null;
  triggerSave: () => void;
}

export function useAutoSave<T>(
  endpoint: string,
  data: T,
  options: AutoSaveOptions = {}
): AutoSaveResult {
  const { delay = 2000, enabled = true, method = 'PUT' } = options;
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const dataRef = useRef<T>(data);
  const initialRef = useRef(true);
  const endpointRef = useRef(endpoint);

  dataRef.current = data;
  endpointRef.current = endpoint;

  const performSave = useCallback(async () => {
    if (!endpointRef.current) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(endpointRef.current, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dataRef.current),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Save failed (${res.status})`);
      }
      setLastSaved(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [method]);

  useEffect(() => {
    if (!enabled) return;
    // Skip the initial render
    if (initialRef.current) {
      initialRef.current = false;
      return;
    }

    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(performSave, delay);

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [data, delay, enabled, performSave]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  return { saving, lastSaved, error, triggerSave: performSave };
}
