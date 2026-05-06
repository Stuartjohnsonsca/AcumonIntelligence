/**
 * VAT Reconciliation calculator — shared types + placeholder reads.
 *
 * This calculator is launched from the Revenue section of the Audit
 * Plan. It verifies (1) revenue per the client's books against the VAT
 * charged on each revenue stream and (2) the VAT liability at period
 * end against the TB.
 *
 * ── Placeholder reads ────────────────────────────────────────────────
 * Two pieces of upstream data are still being scaffolded by the
 * methodology admin:
 *   - Permanent tab:    `vat_registered` (Yes/No) and `vat_periodicity`
 *                       (Monthly | Quarterly | Annual).
 *   - Firm Wide:        VAT rates (label / jurisdiction / rate),
 *                       VAT registration + deregistration thresholds,
 *                       each with a date-from/date-to applicability range.
 *
 * `readVatRegistration` and `readFirmVatConfig` look up these values
 * via the existing permanent-file + risk-tables endpoints. Until the
 * methodology admin wires them, both safely return "not configured"
 * shapes — the UI then surfaces the placeholder banners or pop-ups.
 *
 * Once Phase 0 is complete, the reads here keep working unchanged —
 * just edit the constant keys below if naming has shifted.
 */

// ── Permanent-file question keys (placeholder) ───────────────────────
//
// These are the keys the panel will read from the engagement's
// permanent file. Update if Phase 0 lands them under different names.
export const VAT_REGISTERED_KEY = 'vat_registered';      // 'Yes' | 'No' | undefined
export const VAT_PERIODICITY_KEY = 'vat_periodicity';    // 'Monthly' | 'Quarterly' | 'Annual' | undefined
export const VAT_PERMANENT_QUESTION_LABEL = 'Is the entity registered for VAT?';

// ── Firm-Wide VAT config — risk-tables tableType (placeholder) ───────
//
// Stored as a MethodologyRiskTable row. Until the methodology admin
// wires the UI we read it back as null and the panel handles that.
export const FIRM_VAT_CONFIG_TABLE_TYPE = 'firm_vat_config';

// ── Revenue FS-Level aliases ─────────────────────────────────────────
//
// Used to decide whether the Audit Plan's currently-active FS Level
// counts as a Revenue level (and therefore should show the VAT
// Reconciliation button). Same canonical names already used in the
// Audit Plan's framework-order map.
const REVENUE_FS_LEVEL_ALIASES = new Set([
  'revenue', 'turnover', 'sales', 'income', 'fees',
]);

export function isRevenueFsLevel(level: string | null | undefined): boolean {
  if (!level) return false;
  return REVENUE_FS_LEVEL_ALIASES.has(level.toLowerCase().trim());
}

// ─── Types ───────────────────────────────────────────────────────────

export type VatPeriodicity = 'Monthly' | 'Quarterly' | 'Annual';
export type VatConclusion = 'green' | 'orange' | 'red';

export interface FirmVatRate {
  id: string;
  label: string;          // "Standard rate", "Zero rate", "Reduced rate"
  jurisdiction: string;   // "UK", "ROI", etc
  ratePercent: number;    // 20, 0, 5, 12.5 …
}

export interface FirmVatThreshold {
  id: string;
  kind: 'registration' | 'deregistration';
  amount: number;
  dateFrom: string | null; // ISO; null = open-ended start
  dateTo: string | null;   // ISO; null = current
}

export interface FirmVatConfig {
  rates: FirmVatRate[];
  thresholds: FirmVatThreshold[];
}

export interface VatRevenueMapping {
  vatRateId: string;       // FK into firm rates
  ratePercentOverride?: number; // Only set when ratesConsistent === false and user typed a per-account %
  dr: number;              // Snapshot of TB Dr at the time of mapping
  cr: number;              // Snapshot of TB Cr
  description: string;     // Snapshot of TB row description
  savedAt: string;         // ISO
  savedBy: string;         // User name (display)
}

export interface VatPeriodRow {
  id: string;
  periodEnding: string;    // ISO date
  jurisdiction: string;
  // Special-row flags. Opening row is just "PY HMRC bal c/f". Cut-off
  // rows are short stub periods at engagement period start/end where
  // a VAT period straddles the audit period boundary.
  isOpening?: boolean;
  isCutoffStart?: boolean;
  isCutoffEnd?: boolean;
  // Days-in-period figures driving the Adjusted columns. proRata =
  // overlap days within the engagement period / total days in the
  // VAT period. Always 1 for non-cut-off rows.
  daysInPeriod: number;
  daysOverlap: number;
  // Raw values from the VAT return (extracted or manually entered).
  netRevenue: number | null;
  netPurchases: number | null;
  salesVat: number | null;
  purchaseVat: number | null;
  // Pointer to the uploaded VAT-return doc, when available.
  vatReturnDocId?: string;
  // For the opening row — manual entry of prior-period HMRC balance.
  hmrcAmount: number | null;
}

export interface VatBankVerification {
  id: string;
  rowId?: string;          // Optional link to a periodRow.id
  date: string;            // ISO
  amount: number;          // Negative = paid to HMRC, positive = refund received
  source: 'manual' | 'connector';
  bankTxnId?: string;      // Set when source = 'connector'
  notes?: string;
}

export interface VatTbRow {
  tbAccountCode: string;   // Code on the engagement's TB
  amount: number;          // Snapshot at time of selection
}

export interface VatRecData {
  ratesConsistent?: boolean | null;
  revenueMappings: Record<string, VatRevenueMapping>; // keyed by accountCode
  periodRows: VatPeriodRow[];
  bankVerifications: VatBankVerification[];
  tbVatRows: VatTbRow[];
  // Set once the bundle of "please upload these N VAT returns" was sent.
  vatReturnsRequest?: { portalRequestId: string; sentAt: string };
  // Conclusion + sign-off — same shape as audit_test_conclusions.
  conclusion?: VatConclusion;
  reviewedBy?: string;
  reviewedByName?: string;
  reviewedAt?: string;
  riSignedBy?: string;
  riSignedByName?: string;
  riSignedAt?: string;
}

export const EMPTY_VAT_REC: VatRecData = {
  ratesConsistent: null,
  revenueMappings: {},
  periodRows: [],
  bankVerifications: [],
  tbVatRows: [],
};

// ─── Placeholder reads ───────────────────────────────────────────────

export type VatRegistration = {
  /**
   * 'Yes' / 'No' / 'unanswered'. The panel branches into the three
   * pop-up paths off this value.
   */
  status: 'Yes' | 'No' | 'unanswered';
  /** Periodicity from the same Permanent tab — undefined if unanswered. */
  periodicity?: VatPeriodicity;
};

/**
 * Read VAT-registration status from the engagement's Permanent file.
 * Returns 'unanswered' until Phase 0 wires the question.
 */
export async function readVatRegistration(engagementId: string): Promise<VatRegistration> {
  try {
    const res = await fetch(`/api/engagements/${engagementId}/permanent-file`);
    if (!res.ok) return { status: 'unanswered' };
    const json = await res.json();
    // The permanent-file GET returns { data: { [sectionKey]: { ...fields } } }.
    // We don't know which section the methodology admin will land the
    // question in, so flatten and look up by key — same pattern
    // PermanentFileTab uses on load.
    const flat: Record<string, unknown> = {};
    for (const [, sectionData] of Object.entries(json.data || {})) {
      if (typeof sectionData === 'object' && sectionData) Object.assign(flat, sectionData);
    }
    const raw = flat[VAT_REGISTERED_KEY];
    const periodicityRaw = flat[VAT_PERIODICITY_KEY];
    const periodicity: VatPeriodicity | undefined =
      periodicityRaw === 'Monthly' || periodicityRaw === 'Quarterly' || periodicityRaw === 'Annual'
        ? periodicityRaw
        : undefined;
    if (raw === 'Yes' || raw === true) return { status: 'Yes', periodicity };
    if (raw === 'No' || raw === false) return { status: 'No', periodicity };
    return { status: 'unanswered' };
  } catch {
    return { status: 'unanswered' };
  }
}

/**
 * Read firm-wide VAT rates + thresholds. Returns a config with empty
 * arrays until Phase 0 wires the Firm Wide Assumptions VAT section.
 */
export async function readFirmVatConfig(): Promise<FirmVatConfig> {
  try {
    const res = await fetch(`/api/methodology-admin/risk-tables?tableType=${FIRM_VAT_CONFIG_TABLE_TYPE}`);
    if (!res.ok) return { rates: [], thresholds: [] };
    const json = await res.json();
    const data = json.table?.data;
    if (!data || typeof data !== 'object') return { rates: [], thresholds: [] };
    return {
      rates: Array.isArray(data.rates) ? data.rates : [],
      thresholds: Array.isArray(data.thresholds) ? data.thresholds : [],
    };
  } catch {
    return { rates: [], thresholds: [] };
  }
}

/**
 * Pretty rate label. e.g. "Standard rate (UK) — 20%".
 */
export function formatRateLabel(rate: FirmVatRate): string {
  return `${rate.label} (${rate.jurisdiction}) — ${rate.ratePercent}%`;
}
