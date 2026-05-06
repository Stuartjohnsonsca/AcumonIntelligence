/**
 * Firm-wide "Tax on Profits" assumption.
 *
 * Stored in MethodologyRiskTable under tableType='firm_tax_on_profits'
 * as { rates: FirmTaxOnProfitsRate[] }. The Tax on Profits engagement
 * tool consults these rates when the auditor selects jurisdictions,
 * matching by jurisdiction + applicability date range against the
 * engagement's period end.
 */

export interface FirmTaxOnProfitsRate {
  id: string;
  /** e.g. "Main rate", "Small profits rate", "Marginal rate" */
  label: string;
  /** Country / regime label as shown in the jurisdiction dropdown
   *  on the engagement-side panel. Free text so admins can add
   *  bespoke regimes (e.g. "UK – Ring-fenced") as needed. */
  jurisdiction: string;
  /** Inclusive start date for this rate (ISO yyyy-mm-dd). */
  dateFrom: string | null;
  /** Inclusive end date for this rate (ISO yyyy-mm-dd). null = open-ended. */
  dateTo: string | null;
  /** Numeric rate as a percentage (e.g. 25 means 25%). */
  ratePercent: number;
}

export interface FirmTaxOnProfitsConfig {
  rates: FirmTaxOnProfitsRate[];
}

/**
 * Pick the rate that applies to a given jurisdiction at a given date.
 * Returns null when no rate row covers the date. When multiple rows
 * match (overlapping admin-side data) the first match wins — admins
 * are responsible for keeping date ranges non-overlapping.
 */
export function findRateForDate(
  rates: FirmTaxOnProfitsRate[],
  jurisdiction: string,
  dateIso: string,
): FirmTaxOnProfitsRate | null {
  const target = dateIso;
  for (const r of rates) {
    if (r.jurisdiction !== jurisdiction) continue;
    const fromOk = !r.dateFrom || r.dateFrom <= target;
    const toOk = !r.dateTo || r.dateTo >= target;
    if (fromOk && toOk) return r;
  }
  return null;
}

/** All distinct jurisdiction labels currently configured. */
export function listJurisdictions(rates: FirmTaxOnProfitsRate[]): string[] {
  return Array.from(new Set(rates.map(r => r.jurisdiction).filter(Boolean))).sort();
}

// ─── Permanent file question key ─────────────────────────────────────
//
// The Tax on Profits tool gates on this answer (Y/N). The seeded
// question lives in the Permanent File "Taxation" section with a
// stable id so the tool can locate it even after admins reorder.
export const TAX_ON_PROFITS_PERMANENT_QUESTION_ID = 'pf_taxation_subject_to_tax_on_profits';
export const TAX_ON_PROFITS_PERMANENT_QUESTION_LABEL = 'Is the entity subject to tax on its profits?';

export type SubjectToTaxStatus = 'unanswered' | 'Y' | 'N';

export async function readSubjectToTax(engagementId: string): Promise<SubjectToTaxStatus> {
  try {
    const res = await fetch(`/api/engagements/${engagementId}/permanent-file`);
    if (!res.ok) return 'unanswered';
    const json = await res.json();
    const flat: Record<string, unknown> = {};
    for (const [, sectionData] of Object.entries(json.data || {})) {
      if (typeof sectionData === 'object' && sectionData) Object.assign(flat, sectionData);
    }
    const raw = flat[TAX_ON_PROFITS_PERMANENT_QUESTION_ID];
    if (raw === 'Y' || raw === 'N') return raw;
    return 'unanswered';
  } catch {
    return 'unanswered';
  }
}

// ─── Firm tax-on-profits config reader ───────────────────────────────

export const FIRM_TAX_ON_PROFITS_TABLE_TYPE = 'firm_tax_on_profits';

export async function readFirmTaxOnProfitsConfig(): Promise<FirmTaxOnProfitsConfig> {
  try {
    const res = await fetch(`/api/methodology-admin/risk-tables?tableType=${FIRM_TAX_ON_PROFITS_TABLE_TYPE}`);
    if (!res.ok) return { rates: [] };
    const json = await res.json();
    const data = json.table?.data;
    if (!data || typeof data !== 'object') return { rates: [] };
    return { rates: Array.isArray(data.rates) ? data.rates : [] };
  } catch {
    return { rates: [] };
  }
}

// ─── Engagement-side data shape ──────────────────────────────────────

/**
 * One row in the engagement's jurisdiction split. Default seed is
 * `[{ jurisdiction: 'UK', percent: 100 }]`. Total of all rows must
 * equal 100. Add/remove from the entry-flow popup.
 */
export interface TaxOnProfitsJurisdictionRow {
  jurisdiction: string;
  percent: number;
}

/**
 * One tax adjustment row in the computation grid. Auditor picks an
 * account from the TB (intellisense), the row defaults to the TB
 * description + current period amount (Cr +ve, Dr −ve). The total is
 * split pro-rata across jurisdictions; manual edits highlight cells
 * red. If the per-jurisdiction sum ≠ accountAmount the row total
 * cell goes red-bg/white-text.
 */
export interface TaxOnProfitsAdjustment {
  id: string;
  description: string;
  accountCode?: string;
  /** TB amount (Cr +ve, Dr −ve). When the per-jurisdiction sum drifts
   *  from this, the row is flagged. */
  accountAmount?: number;
  /** Per-jurisdiction split keyed by jurisdiction label. Sum of all
   *  jurisdiction values + any disallowable add-back is the row
   *  contribution to the tax computation. */
  perJurisdiction: Record<string, number>;
  /** Auditor-edited flag per jurisdiction key — when a cell has been
   *  edited away from its pro-rata default, it renders red. */
  perJurisdictionEdited: Record<string, boolean>;
  /** Disallowable element (UK CT addback equivalent). */
  disallowable: number;
  /** Flagged for audit testing. When toggled on, the audit-test
   *  workflow surfaces a row for this adjustment on Save. */
  selectedForAudit: boolean;
  /** Audit test selection for this adjustment row, once configured
   *  from the audit-test workflow. */
  auditTest?: TaxOnProfitsAuditTest;
}

export type TaxOnProfitsAction = 'explanation' | 'evidence' | 'specialist';

export interface TaxOnProfitsAuditTest {
  /** Test type chosen from the audit methodology test bank. */
  testTypeId?: string;
  testTypeName?: string;
  /** Seeded action: add explanation / request evidence / request to
   *  tax specialist. Saved when the auditor confirms the row. */
  action?: TaxOnProfitsAction;
  /** Free-text explanation when action='explanation'. */
  explanation?: string;
  /** Stored on the row once the document request has been sent to
   *  the client portal. Acts as the lookup key for the response. */
  documentRequestId?: string;
  /** Stored once the specialist message has been spawned. */
  specialistChatId?: string;
  /** Set after the auditor reviews the AI comparison of submitted
   *  evidence vs the booked amount. */
  evidenceStatus?: 'pending' | 'accepted' | 'error';
  /** Free-text reviewer / audit-team comments on this audit test
   *  row. Visible on the Completion → Taxation → Tax on Profits tab
   *  with the usual sign-off dots. */
  reviewComments?: string;
}

export interface TaxOnProfitsData {
  jurisdictions: TaxOnProfitsJurisdictionRow[];
  /** When >1 jurisdiction, the rate sub-sub-heading shows lowest-to-
   *  highest. This toggle picks which is used for the expected-tax
   *  row at the bottom of the computation grid. */
  rateMode: 'highest' | 'lowest';
  /** Profit before tax for the period (auditor-entered). */
  accountingProfit: number;
  adjustments: TaxOnProfitsAdjustment[];
  /** Tax on profits charge per the P&L for cross-check. */
  taxChargePerPL: number;
  /** Free-text conclusion + sign-off notes. */
  conclusion?: string;
  /** Hash of the Permanent file Taxation section the last time the
   *  AI re-check ran. Used to detect "section changed → re-check
   *  whether the Y/N and jurisdictions still hold". */
  permanentTaxationHash?: string;
  /** AI verification result + summary, refreshed when the hash above
   *  changes. */
  aiVerification?: {
    confidence: 'high' | 'medium' | 'low';
    summary: string;
    checkedAt: string; // ISO
  };
}

export const EMPTY_TAX_ON_PROFITS: TaxOnProfitsData = {
  jurisdictions: [{ jurisdiction: 'UK', percent: 100 }],
  rateMode: 'highest',
  accountingProfit: 0,
  adjustments: [],
  taxChargePerPL: 0,
};
