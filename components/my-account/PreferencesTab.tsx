'use client';

import { useEffect, useState } from 'react';
import {
  getFormulaTooltipsEnabled,
  setFormulaTooltipsEnabled,
  getFieldReferencesEnabled,
  setFieldReferencesEnabled,
} from '@/lib/user-preferences';

interface Props {
  /** True for Methodology Admin or Super Admin users — gates the
   *  admin-only toggles (e.g. field-reference hover tooltips). */
  isAdmin?: boolean;
}

/**
 * Per-session preferences. Stored in sessionStorage — every new login
 * resets to defaults. The toggles live-update the rest of the app via
 * a window CustomEvent (see lib/user-preferences.ts).
 */
export function PreferencesTab({ isAdmin = false }: Props) {
  const [formulaTooltips, setFormulaTooltips] = useState(false);
  const [fieldReferences, setFieldReferences] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setFormulaTooltips(getFormulaTooltipsEnabled());
    setFieldReferences(getFieldReferencesEnabled());
    setHydrated(true);
  }, []);

  function toggleFormulaTooltips() {
    const next = !formulaTooltips;
    setFormulaTooltips(next);
    setFormulaTooltipsEnabled(next);
  }

  function toggleFieldReferences() {
    const next = !fieldReferences;
    setFieldReferences(next);
    setFieldReferencesEnabled(next);
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-800">Preferences</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          These settings apply for the current login only — they reset to defaults the next time you sign in.
        </p>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg divide-y divide-slate-100">
        <div className="flex items-start justify-between p-4 gap-4">
          <div className="flex-1">
            <p className="text-sm font-medium text-slate-800">Show formula tooltips on schedules</p>
            <p className="text-xs text-slate-500 mt-1">
              Reveals the underlying formula or &quot;Auto-calculated&quot; text on hover for cells driven by a formula.
              Useful for methodology admins reviewing how a schedule computes; off by default so casual editing isn&apos;t
              interrupted by tooltip flicker.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={formulaTooltips}
            onClick={toggleFormulaTooltips}
            disabled={!hydrated}
            className={`relative shrink-0 w-11 h-6 rounded-full transition-colors ${
              formulaTooltips ? 'bg-blue-500' : 'bg-slate-300'
            } ${hydrated ? 'cursor-pointer' : 'opacity-50 cursor-wait'}`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                formulaTooltips ? 'translate-x-5' : ''
              }`}
            />
          </button>
        </div>

        {/* Field-reference tooltips — admin-only because the listing is
            primarily useful when verifying template coverage during
            methodology authoring. Off by default so a regular auditor's
            hover never shows the noisy "Referenced by: …" popup. */}
        {isAdmin && (
          <div className="flex items-start justify-between p-4 gap-4">
            <div className="flex-1">
              <p className="text-sm font-medium text-slate-800">
                Show field-reference tooltips on schedules
                <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide text-emerald-600 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5">Admin</span>
              </p>
              <p className="text-xs text-slate-500 mt-1">
                Hover a red-outlined cell to see which document or email templates reference it. Useful when reviewing
                template coverage; off by default on each login so the popup doesn&apos;t appear during normal audit work.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={fieldReferences}
              onClick={toggleFieldReferences}
              disabled={!hydrated}
              className={`relative shrink-0 w-11 h-6 rounded-full transition-colors ${
                fieldReferences ? 'bg-blue-500' : 'bg-slate-300'
              } ${hydrated ? 'cursor-pointer' : 'opacity-50 cursor-wait'}`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                  fieldReferences ? 'translate-x-5' : ''
                }`}
              />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
