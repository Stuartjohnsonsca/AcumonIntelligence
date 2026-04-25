'use client';

/**
 * useFirmVariables — fetches the firm's custom hard-coded numeric variables
 * from /api/methodology-admin/risk-tables (tableType='firm_variables') and
 * returns them as a Record<name, number> suitable for passing as
 * DynamicAppendixForm.externalValues.
 *
 * Also returns a richer `list` shape (name/label/value) for admin UIs that
 * want to display labels.
 *
 * The fetch is memoised at module level so multiple hook callers on the same
 * page don't re-hit the endpoint. Refreshes on window focus are not
 * implemented — an admin saving new variables will see them on next page
 * load, which is fine for our use case.
 */

import { useEffect, useState } from 'react';

export interface FirmVariable {
  name: string;
  label: string;
  value: number;
}

type VariableMap = Record<string, number>;

let memoCache: { list: FirmVariable[]; map: VariableMap } | null = null;
let inflight: Promise<{ list: FirmVariable[]; map: VariableMap }> | null = null;

async function fetchOnce(): Promise<{ list: FirmVariable[]; map: VariableMap }> {
  if (memoCache) return memoCache;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const res = await fetch('/api/methodology-admin/risk-tables');
      if (!res.ok) return { list: [], map: {} };
      const json = await res.json();
      const tables: Record<string, any> = json.tables || json || {};

      const raw = tables.firm_variables?.variables;
      let list: FirmVariable[] = [];
      if (Array.isArray(raw)) {
        list = raw
          .filter((v: any): v is FirmVariable => v && typeof v.name === 'string' && typeof v.value === 'number')
          .map((v: FirmVariable) => ({ name: v.name, label: v.label || v.name, value: v.value }));
      }

      // Back-compat: if no firm_variables row but a legacy firm_fees row exists,
      // synthesize a firm_fees variable so existing ethics formulas keep working.
      if (list.length === 0 && typeof tables.firm_fees?.amount === 'number') {
        list = [{ name: 'firm_fees', label: 'Firm Annual Fee Income', value: tables.firm_fees.amount as number }];
      }

      // Expose min-fee-per-hour by audit type (Firm Wide Assumptions)
      // as firm variables so schedule formulas can reference them.
      // Names: `min_avg_fee_per_hour_<audit_type_lowercase>`
      // (e.g. min_avg_fee_per_hour_sme, min_avg_fee_per_hour_pie).
      // Plus a bare `min_avg_fee_per_hour` defaulting to the SME value
      // for formulas written without a type qualifier.
      const minByType = tables.min_avg_fee_per_hour?.byAuditType;
      if (minByType && typeof minByType === 'object') {
        const seen = new Set(list.map(v => v.name));
        for (const [auditType, raw] of Object.entries(minByType)) {
          const value = Number(raw);
          if (!Number.isFinite(value) || value <= 0) continue;
          const name = `min_avg_fee_per_hour_${String(auditType).toLowerCase()}`;
          if (seen.has(name)) continue;
          list.push({ name, label: `Minimum average fee/hour — ${auditType}`, value });
          seen.add(name);
        }
        const sme = Number((minByType as Record<string, unknown>).SME);
        if (Number.isFinite(sme) && sme > 0 && !seen.has('min_avg_fee_per_hour')) {
          list.push({ name: 'min_avg_fee_per_hour', label: 'Minimum average fee/hour (default = SME)', value: sme });
        }
      }

      const map: VariableMap = {};
      for (const v of list) map[v.name] = v.value;

      const result = { list, map };
      memoCache = result;
      return result;
    } catch {
      return { list: [], map: {} };
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

/** Clear the memoised cache. Useful after an admin saves new variables. */
export function invalidateFirmVariables() {
  memoCache = null;
  inflight = null;
}

export function useFirmVariables(): { list: FirmVariable[]; map: VariableMap; loading: boolean } {
  const [state, setState] = useState<{ list: FirmVariable[]; map: VariableMap; loading: boolean }>(() => ({
    list: memoCache?.list || [],
    map: memoCache?.map || {},
    loading: !memoCache,
  }));

  useEffect(() => {
    let cancelled = false;
    fetchOnce().then(result => {
      if (cancelled) return;
      setState({ list: result.list, map: result.map, loading: false });
    });
    return () => { cancelled = true; };
  }, []);

  return state;
}
