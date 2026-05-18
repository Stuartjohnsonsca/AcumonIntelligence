'use client';

/**
 * useEngagementRounding — shared state hook for the engagement-level
 * display rounding mode (Unrounded / Pounds / Thousands / Millions).
 *
 * Stored on `AuditPermanentFile` under section `engagement_rounding`.
 * Falls back to legacy section `par_rounding` for engagements set
 * before the section was made tab-agnostic, so existing data is
 * never lost. Allowed options come from the firm-admin
 * `rounding_options` risk-table; if that's not set we fall back to
 * the four-mode default in `lib/audit-rounding.ts`.
 *
 * The hook fires a `window` CustomEvent on every save so other open
 * tabs on the same page pick up the change immediately — no need
 * for an explicit prop drill from a parent component.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  DEFAULT_ROUNDING_ORDER,
  type RoundingMode,
} from '@/lib/audit-rounding';

const EVENT_NAME = 'engagement:rounding-changed';
const CANONICAL_SECTION = 'engagement_rounding';
const LEGACY_SECTION = 'par_rounding';

export interface UseEngagementRoundingResult {
  mode: RoundingMode;
  setMode: (next: RoundingMode) => void;
  /** The list of modes the firm admin has allowed on this engagement. */
  options: RoundingMode[];
  /** True while the initial fetch is in flight. */
  loading: boolean;
}

/** Fetch the saved rounding choice for an engagement, with legacy fallback. */
async function fetchSavedMode(engagementId: string): Promise<RoundingMode | null> {
  // Try the canonical key first.
  try {
    const r = await fetch(`/api/engagements/${engagementId}/permanent-file?section=${CANONICAL_SECTION}`);
    if (r.ok) {
      const d = await r.json();
      const mode = d?.data?.mode as RoundingMode | undefined;
      if (mode && DEFAULT_ROUNDING_ORDER.includes(mode)) return mode;
    }
  } catch { /* fall through to legacy */ }
  // Legacy: PAR-only key the rounding dropdown used to live under.
  try {
    const r = await fetch(`/api/engagements/${engagementId}/permanent-file?section=${LEGACY_SECTION}`);
    if (r.ok) {
      const d = await r.json();
      const mode = d?.data?.mode as RoundingMode | undefined;
      if (mode && DEFAULT_ROUNDING_ORDER.includes(mode)) return mode;
    }
  } catch { /* fall through */ }
  return null;
}

async function fetchAllowedOptions(): Promise<RoundingMode[] | null> {
  try {
    const r = await fetch('/api/methodology-admin/risk-tables?tableType=rounding_options');
    if (!r.ok) return null;
    const d = await r.json();
    const opts = d?.table?.data?.options as RoundingMode[] | undefined;
    if (Array.isArray(opts) && opts.length) {
      return opts.filter(o => DEFAULT_ROUNDING_ORDER.includes(o));
    }
  } catch { /* ignore */ }
  return null;
}

export function useEngagementRounding(engagementId: string): UseEngagementRoundingResult {
  const [mode, setModeState] = useState<RoundingMode>('unrounded');
  const [options, setOptions] = useState<RoundingMode[]>(DEFAULT_ROUNDING_ORDER);
  const [loading, setLoading] = useState(true);

  // Initial load — saved mode + firm-allowed options.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [saved, opts] = await Promise.all([fetchSavedMode(engagementId), fetchAllowedOptions()]);
      if (cancelled) return;
      if (saved) setModeState(saved);
      if (opts) setOptions(opts);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [engagementId]);

  // Cross-tab sync — when another open hook on this engagement saves a
  // new mode, the corresponding CustomEvent fires and we pick it up
  // without a fetch. Other engagements ignored.
  useEffect(() => {
    function onChange(e: Event) {
      const detail = (e as CustomEvent).detail as { engagementId: string; mode: RoundingMode } | undefined;
      if (!detail || detail.engagementId !== engagementId) return;
      if (!DEFAULT_ROUNDING_ORDER.includes(detail.mode)) return;
      setModeState(detail.mode);
    }
    window.addEventListener(EVENT_NAME, onChange);
    return () => window.removeEventListener(EVENT_NAME, onChange);
  }, [engagementId]);

  const setMode = useCallback((next: RoundingMode) => {
    setModeState(next);
    // Optimistic save — no error UI; if the persist fails the next
    // page reload will fall back to the legacy / default value.
    fetch(`/api/engagements/${engagementId}/permanent-file`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sectionKey: CANONICAL_SECTION, data: { mode: next } }),
    }).catch(() => {});
    // Broadcast so other hooks on the same page reflect the change
    // immediately.
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { engagementId, mode: next } }));
  }, [engagementId]);

  return { mode, setMode, options, loading };
}
