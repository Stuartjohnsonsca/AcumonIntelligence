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
  const enabledRef = useRef(enabled);
  /** Last payload the server has acknowledged. Used to skip redundant
   *  unmount / visibility flushes when nothing has actually changed
   *  since the last successful save. */
  const lastSavedPayloadRef = useRef<string>('');

  dataRef.current = data;
  endpointRef.current = endpoint;
  enabledRef.current = enabled;

  const performSave = useCallback(async () => {
    if (!endpointRef.current) return;
    const payload = JSON.stringify(dataRef.current);
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(endpointRef.current, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        // keepalive lets the request survive component unmount / tab
        // switch / page navigation — without it the browser aborts the
        // in-flight fetch the moment this component tears down, which
        // silently loses the save even though the UI said "Saved".
        keepalive: true,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Save failed (${res.status})`);
      }
      lastSavedPayloadRef.current = payload;
      setLastSaved(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [method]);

  /** Synchronous-ish flush using sendBeacon. Used on unmount when
   *  there's no guarantee the regular fetch() will be allowed to
   *  complete. Works with method=POST only; we fall back to a
   *  keepalive fetch for PUT/PATCH endpoints. */
  const flushOnUnmount = useCallback(() => {
    if (!endpointRef.current) return;
    // Don't fire when the consumer explicitly has auto-save disabled
    // (e.g. during an import the TB tab passes enabled:false to stop
    // concurrent writes — we must honour that here too).
    if (!enabledRef.current) return;
    const payload = JSON.stringify(dataRef.current);
    // Nothing new since the last successful save — skip the write.
    if (payload === lastSavedPayloadRef.current) return;
    try {
      if (method === 'POST' && typeof navigator !== 'undefined' && 'sendBeacon' in navigator) {
        const blob = new Blob([payload], { type: 'application/json' });
        // sendBeacon survives unmount + tab-close cleanly; it's the
        // most reliable mechanism we have for "this must land".
        navigator.sendBeacon(endpointRef.current, blob);
        return;
      }
      // PUT/PATCH — sendBeacon is POST-only, so use keepalive fetch
      // which is the next-best survivor.
      fetch(endpointRef.current, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        keepalive: true,
      }).catch(() => { /* silent */ });
    } catch { /* silent */ }
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

  // Save on unmount. We ALWAYS flush — not just when a debounce timer
  // is pending — because the user may have typed within the last couple
  // of hundred ms and the save fired but hasn't yet settled. The flush
  // uses sendBeacon / keepalive-fetch so it survives the tab switch.
  // (If the data hasn't actually changed the server will just no-op on
  // the second write, which is cheap and idempotent.)
  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      flushOnUnmount();
    };
  }, [flushOnUnmount]);

  // Also flush when the tab visibility changes to hidden (user switched
  // windows or put the browser in the background). This catches the
  // case where the user types something then backgrounds the tab before
  // the debounce elapses — without this, the save would sit in the
  // pending timer forever and be lost on a later reload.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onVis = () => {
      if (document.visibilityState === 'hidden') flushOnUnmount();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [flushOnUnmount]);

  return { saving, lastSaved, error, triggerSave: performSave };
}
