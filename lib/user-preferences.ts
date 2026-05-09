'use client';

import { useEffect, useState } from 'react';

/**
 * Per-session user preferences stored in sessionStorage. Cleared on
 * every new login (i.e. each new browser session) — the user wants
 * these to default OFF on log on, so persistent storage would defeat
 * the spec. Cross-component reactivity is via a window CustomEvent.
 */

const FORMULA_TOOLTIPS_KEY = 'acumon:pref:formulaTooltips';
const FIELD_REFERENCES_KEY = 'acumon:pref:fieldReferences';
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

/**
 * Field-reference tooltip preference — controls whether schedule cells
 * with a red template-reference outline ALSO show the "Referenced by:"
 * hover tooltip listing the templates that consume the cell. Off by
 * default (and reset to off on every new login) because the tooltip is
 * primarily an admin-debugging aid; methodology admins / super admins
 * can flip it on from the Preferences tab when investigating template
 * coverage. The red outline itself is unaffected by this toggle.
 */
export function getFieldReferencesEnabled(): boolean {
  return readBool(FIELD_REFERENCES_KEY, false);
}

export function setFieldReferencesEnabled(value: boolean) {
  writeBool(FIELD_REFERENCES_KEY, value);
}

export function useFieldReferencesEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    setEnabled(getFieldReferencesEnabled());
    function onChange(e: Event) {
      const detail = (e as CustomEvent<{ key: string }>).detail;
      if (detail?.key === FIELD_REFERENCES_KEY) setEnabled(getFieldReferencesEnabled());
    }
    window.addEventListener(PREF_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(PREF_CHANGED_EVENT, onChange);
  }, []);

  return enabled;
}
