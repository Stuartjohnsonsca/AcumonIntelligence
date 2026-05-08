'use client';

import { useEffect, useState } from 'react';

/**
 * Per-session user preferences stored in sessionStorage. Cleared on
 * every new login (i.e. each new browser session) — the user wants
 * these to default OFF on log on, so persistent storage would defeat
 * the spec. Cross-component reactivity is via a window CustomEvent.
 */

const FORMULA_TOOLTIPS_KEY = 'acumon:pref:formulaTooltips';
const PREF_CHANGED_EVENT = 'acumon:preferences-changed';

function readBool(key: string, fallback: boolean): boolean {
  if (typeof window === 'undefined') return fallback;
  try {
    const v = sessionStorage.getItem(key);
    if (v === null) return fallback;
    return v === '1';
  } catch {
    return fallback;
  }
}

function writeBool(key: string, value: boolean) {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(key, value ? '1' : '0');
    window.dispatchEvent(new CustomEvent(PREF_CHANGED_EVENT, { detail: { key } }));
  } catch { /* private mode — quietly ignore */ }
}

export function getFormulaTooltipsEnabled(): boolean {
  return readBool(FORMULA_TOOLTIPS_KEY, false);
}

export function setFormulaTooltipsEnabled(value: boolean) {
  writeBool(FORMULA_TOOLTIPS_KEY, value);
}

/**
 * Reactive hook — the `title` attribute on formula cells is bound to
 * this; any toggle in the Preferences tab live-updates every cell on
 * the page.
 */
export function useFormulaTooltipsEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    setEnabled(getFormulaTooltipsEnabled());
    function onChange(e: Event) {
      const detail = (e as CustomEvent<{ key: string }>).detail;
      if (detail?.key === FORMULA_TOOLTIPS_KEY) setEnabled(getFormulaTooltipsEnabled());
    }
    window.addEventListener(PREF_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(PREF_CHANGED_EVENT, onChange);
  }, []);

  return enabled;
}
