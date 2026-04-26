'use client';

import { useRef, useEffect, useState, useCallback } from 'react';

interface AutoSaveOptions<TResp = unknown> {
  delay?: number;
  enabled?: boolean;
  method?: 'PUT' | 'POST' | 'PATCH';
  /** Optional callback fired with the parsed JSON response on a
   *  successful save. Useful when the server assigns IDs to newly-
   *  created rows — the consumer can pull those IDs back into state so
   *  the next save doesn't churn the DB (delete-then-recreate) on the
   *  same logical rows. */
  onSaveSuccess?: (response: TResp) => void;
}

interface AutoSaveResult {
  saving: boolean;
  lastSaved: Date | null;
  error: string | null;
  triggerSave: () => void;
}

export function useAutoSave<T, TResp = unknown>(
  endpoint: string,
  data: T,
  options: AutoSaveOptions<TResp> = {}
): AutoSaveResult {
  const { delay = 2000, enabled = true, method = 'PUT', onSaveSuccess } = options;
  const onSaveSuccessRef = useRef(onSaveSuccess);
  onSaveSuccessRef.current = onSaveSuccess;
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
    // Diagnostic — confirm the body actually carries the field we
    // just typed. Searches for `"riskIdentified":` non-null entries
    // and reports the first few. Lets the user open DevTools and
    // verify their typed Nature value made it into the request body.
    if (typeof window !== 'undefined' && endpointRef.current.endsWith('/rmm')) {
      try {
        const obj = JSON.parse(payload);
        const rows = Array.isArray(obj?.rows) ? obj.rows : [];
        const populatedNature = rows
          .filter((r: any) => typeof r.riskIdentified === 'string' && r.riskIdentified.trim() !== '')
          .map((r: any) => ({ id: r.id, lineItem: r.lineItem, riskIdentified: r.riskIdentified }));
        console.log(`[useAutoSave] PUT ${endpointRef.current} — ${rows.length} rows, ${populatedNature.length} with riskIdentified`, populatedNature.slice(0, 5));
      } catch { /* ignore — diagnostic only */ }
    }
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
      // Pass the parsed response to the consumer so it can, e.g.,
      // fold server-assigned IDs back into the client state. Safe to
      // ignore on endpoints that don't return JSON.
      if (onSaveSuccessRef.current) {
        try {
          const respBody = await res.json();
          onSaveSuccessRef.current(respBody as TResp);
        } catch { /* non-JSON response — that's fine */ }
      }
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
    // Diagnostic — only logged for the RMM endpoint to keep the rest of
    // the app quiet. Confirms whether the debounce effect is actually
    // re-running on data changes, whether `enabled` is true, and whether
    // the timer is being scheduled.
    const debug = typeof window !== 'undefined' && endpoint.endsWith('/rmm');
    if (debug) {
      console.log(`[useAutoSave debug] effect fired enabled=${enabled} initial=${initialRef.current} hasTimer=${timeoutRef.current != null}`);
    }
    if (!enabled) {
      if (debug) console.log('[useAutoSave debug] enabled=false → returning, no timer scheduled');
      return;
    }
    // Skip the initial render
    if (initialRef.current) {
      initialRef.current = false;
      if (debug) console.log('[useAutoSave debug] initialRef → returning, no timer scheduled');
      return;
    }

    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      if (debug) console.log(`[useAutoSave debug] TIMER FIRED — calling performSave for ${endpoint}`);
      performSave();
    }, delay);
    if (debug) console.log(`[useAutoSave debug] timer scheduled for ${delay}ms`);

    return () => {
      if (debug && timeoutRef.current) console.log('[useAutoSave debug] cleanup cleared pending timer');
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [data, delay, enabled, performSave, endpoint]);

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
