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
      // Names: `min_avg_fee_per_hour_<code-lowercased>`. Iterates the
      // firm's configurable audit-type list so custom types (Grant
      // Audit, CASS Audit, ...) get a firm-variable too. Falls back
      // to the codes present on min_avg_fee_per_hour itself if the
      // audit-types row hasn't been saved yet.
      const minByType = tables.min_avg_fee_per_hour?.byAuditType;
      const auditTypeRow = tables.audit_types?.items as Array<{ code: string; label: string; isActive: boolean }> | undefined;
      const knownCodes: string[] = Array.isArray(auditTypeRow) && auditTypeRow.length > 0
        ? auditTypeRow.filter(a => a.isActive).map(a => a.code)
        : (minByType && typeof minByType === 'object' ? Object.keys(minByType) : []);
      if (minByType && typeof minByType === 'object') {
        const seen = new Set(list.map(v => v.name));
        for (const code of knownCodes) {
          const value = Number((minByType as Record<string, unknown>)[code]);
          if (!Number.isFinite(value) || value <= 0) continue;
          const name = `min_avg_fee_per_hour_${code.toLowerCase()}`;
          if (seen.has(name)) continue;
          list.push({ name, label: `Minimum average fee/hour — ${code}`, value });
          seen.add(name);
        }
        // Bare alias defaults to SME (the original built-in primary
        // audit type) so formulas written without a type qualifier
        // keep working. If SME has no value set, fall back to the
        // first code with a value.
        const sme = Number((minByType as Record<string, unknown>).SME);
        if (Number.isFinite(sme) && sme > 0 && !seen.has('min_avg_fee_per_hour')) {
          list.push({ name: 'min_avg_fee_per_hour', label: 'Minimum average fee/hour (default = SME)', value: sme });
        } else if (!seen.has('min_avg_fee_per_hour')) {
          for (const code of knownCodes) {
            const v = Number((minByType as Record<string, unknown>)[code]);
            if (Number.isFinite(v) && v > 0) {
              list.push({ name: 'min_avg_fee_per_hour', label: `Minimum average fee/hour (default = ${code})`, value: v });
              break;
            }
          }
        }
      }

      // ── VAT registration / deregistration thresholds ────────────────
      // Pick the threshold row currently in force for each kind:
      // dateFrom <= today AND (dateTo IS NULL OR dateTo >= today).
      // If multiple rows match (overlapping ranges), the one with the
      // latest dateFrom wins. Exposed as `vat_registration_threshold`
      // and `vat_deregistration_threshold` so admins can write
      // `=revenue > vat_registration_threshold` in any schedule
      // formula. Note: this is firm-scoped (no engagement period
      // context) — see the comment in lib/vat-reconciliation.ts if
      // engagement-period-end-accurate resolution is needed.
      const vatThresholds = tables.firm_vat_config?.thresholds;
      if (Array.isArray(vatThresholds)) {
        const today = new Date().toISOString().slice(0, 10);
        const isCurrent = (t: { dateFrom?: string | null; dateTo?: string | null }) => {
          const fromOk = !t.dateFrom || t.dateFrom <= today;
          const toOk = !t.dateTo || t.dateTo >= today;
          return fromOk && toOk;
        };
        const pickLatest = (kind: 'registration' | 'deregistration') => {
          const candidates = vatThresholds
            .filter((t: any) => t && t.kind === kind && Number.isFinite(Number(t.amount)) && isCurrent(t));
          if (candidates.length === 0) return null;
          // Latest dateFrom wins (treat null/empty as the earliest).
          candidates.sort((a: any, b: any) => (b.dateFrom || '').localeCompare(a.dateFrom || ''));
          return Number(candidates[0].amount);
        };
        const reg = pickLatest('registration');
        if (reg !== null) {
          list.push({ name: 'vat_registration_threshold', label: 'VAT Registration Threshold (current)', value: reg });
        }
        const dereg = pickLatest('deregistration');
        if (dereg !== null) {
          list.push({ name: 'vat_deregistration_threshold', label: 'VAT Deregistration Threshold (current)', value: dereg });
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
