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
export const VAT_REGISTERED_KEY = 'vat_registered';        // 'Yes' | 'No' | undefined
export const VAT_PERIODICITY_KEY = 'vat_periodicity';      // 'Monthly' | 'Quarterly' | 'Annual' | undefined
// Anchor date for the VAT period schedule. From this single ISO date
// + the periodicity, every VAT period end in any year can be derived
// by adding/subtracting the cadence in months. Example: anchor
// 2026-03-31 + Quarterly → 31 Mar / 30 Jun / 30 Sep / 31 Dec each year.
// Use any one VAT period end the client has filed in the past (or
// the next one due) — the schedule is symmetric.
export const VAT_PERIOD_END_ANCHOR_KEY = 'vat_period_end_anchor';
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

export const PERIODICITY_MONTHS: Record<VatPeriodicity, number> = {
  Monthly: 1,
  Quarterly: 3,
  Annual: 12,
};

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

// ─── Performance materiality reader (placeholder) ─────────────────────
//
// Reads from the existing AuditMateriality JSON blob. The audit-plan
// panel uses the same fallback chain — keeps us robust to whichever
// shape the materiality form ends up writing.
export async function readPerformanceMateriality(engagementId: string): Promise<number> {
  try {
    const res = await fetch(`/api/engagements/${engagementId}/materiality`);
    if (!res.ok) return 0;
    const json = await res.json();
    const d = json.data || {};
    const pm = d.performanceMateriality
      ?? d.materiality?.performanceMateriality
      ?? json.performanceMateriality
      ?? 0;
    const n = Number(pm);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

// ─── Period-row generation ───────────────────────────────────────────

/**
 * UTC year-month-day building blocks. We keep all VAT-period maths
 * in UTC to avoid DST / timezone drift around month-end boundaries.
 */
function startOfDay(iso: string): Date {
  const d = new Date(iso);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
function endOfMonth(year: number, monthZeroBased: number): Date {
  // Day 0 of next month = last day of this month, in UTC.
  return new Date(Date.UTC(year, monthZeroBased + 1, 0));
}
function addMonthsKeepEom(date: Date, months: number): Date {
  // Stagger period ends are typically the last day of a month, so we
  // explicitly snap to end-of-month after shifting. Otherwise 31 Mar +
  // 3 months would land on 30 Jun (correct) but 31 Aug + 1 month would
  // land on 30 Sep — the same logic, but worth being deliberate.
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  const d = date.getUTCDate();
  const target = new Date(Date.UTC(y, m + months, d));
  // If the day of month doesn't survive (e.g. 31 → 30/28), snap to EoM
  // when the source was EoM. Otherwise preserve the day.
  const sourceWasEom = d === endOfMonth(y, m).getUTCDate();
  if (sourceWasEom) return endOfMonth(target.getUTCFullYear(), target.getUTCMonth());
  return target;
}
function diffDaysInclusive(a: Date, b: Date): number {
  // Inclusive day count, e.g. 1 Jan to 31 Jan = 31.
  const ms = b.getTime() - a.getTime();
  return Math.round(ms / 86_400_000) + 1;
}

/**
 * Generate the full set of VAT period rows for an engagement period.
 *
 * Input semantics:
 *   anchor       — any one VAT period end (past or future), used to
 *                  align the recurring schedule.
 *   periodicity  — Monthly / Quarterly / Annual.
 *   periodStart  — engagement period start (inclusive).
 *   periodEnd    — engagement period end   (inclusive).
 *
 * Output is one row per VAT period that overlaps the engagement
 * period. Each row carries:
 *   - daysInPeriod  : total days in the VAT period
 *   - daysOverlap   : days within the engagement period
 *   - isCutoffStart : VAT period extends before periodStart
 *   - isCutoffEnd   : VAT period extends after periodEnd
 *
 * Adjusted-column maths is just (raw × daysOverlap / daysInPeriod) for
 * cut-off rows; for full rows, daysOverlap === daysInPeriod so the
 * factor is 1.
 *
 * Note: this does NOT prepend the opening-balance row. The grid
 * inserts that itself so it can stay editable independently.
 */
export interface GeneratedPeriodRow {
  periodStart: string;       // ISO
  periodEnd: string;         // ISO
  daysInPeriod: number;
  daysOverlap: number;
  isCutoffStart: boolean;
  isCutoffEnd: boolean;
}

export function generateVatPeriodRows(
  anchorIso: string,
  periodicity: VatPeriodicity,
  periodStartIso: string,
  periodEndIso: string,
): GeneratedPeriodRow[] {
  const stepMonths = PERIODICITY_MONTHS[periodicity];
  const anchor = startOfDay(anchorIso);
  const audStart = startOfDay(periodStartIso);
  const audEnd = startOfDay(periodEndIso);
  if (audEnd.getTime() < audStart.getTime()) return [];

  // Walk the anchor backward until we sit at-or-before audStart.
  // Then walk forward generating period ends, stopping once we pass
  // audEnd. Period N starts the day after period (N-1) ends.
  let cursorEnd = anchor;
  // Step back in big jumps first to be quick on long histories.
  while (cursorEnd.getTime() > audStart.getTime()) {
    cursorEnd = addMonthsKeepEom(cursorEnd, -stepMonths);
  }
  // cursorEnd is now <= audStart. The first overlapping VAT period
  // ends one stepMonths after this cursor.
  const rows: GeneratedPeriodRow[] = [];
  // Safety cap: shouldn't ever need > ~50 iterations for a 1-year audit
  // even monthly. 600 catches anomalies without infinite-looping.
  for (let i = 0; i < 600; i++) {
    const prevEnd = cursorEnd;
    cursorEnd = addMonthsKeepEom(cursorEnd, stepMonths);
    // VAT period covers (prevEnd + 1 day) → cursorEnd inclusive.
    const vatStart = new Date(prevEnd.getTime() + 86_400_000);
    if (vatStart.getTime() > audEnd.getTime()) break;
    if (cursorEnd.getTime() < audStart.getTime()) continue;

    const overlapStart = vatStart.getTime() > audStart.getTime() ? vatStart : audStart;
    const overlapEnd = cursorEnd.getTime() < audEnd.getTime() ? cursorEnd : audEnd;
    const daysInPeriod = diffDaysInclusive(vatStart, cursorEnd);
    const daysOverlap = diffDaysInclusive(overlapStart, overlapEnd);
    rows.push({
      periodStart: vatStart.toISOString().slice(0, 10),
      periodEnd: cursorEnd.toISOString().slice(0, 10),
      daysInPeriod,
      daysOverlap,
      isCutoffStart: vatStart.getTime() < audStart.getTime(),
      isCutoffEnd: cursorEnd.getTime() > audEnd.getTime(),
    });
    // Stop once the cursor has passed the audit period end.
    if (cursorEnd.getTime() >= audEnd.getTime()) break;
  }
  return rows;
}

/**
 * Time-pro-rate a raw VAT-return value to the audit period.
 * Returns the raw value unchanged for full-overlap rows.
 */
export function proRata(raw: number | null | undefined, daysOverlap: number, daysInPeriod: number): number {
  if (raw == null || !Number.isFinite(raw)) return 0;
  if (daysInPeriod <= 0) return 0;
  if (daysOverlap === daysInPeriod) return raw;
  return (raw * daysOverlap) / daysInPeriod;
}

// ─── Anchor + periodicity placeholder reader ─────────────────────────
//
// Reads the optional `vat_period_end_anchor` from the permanent file.
// Falls back to engagement period end so the grid still renders even
// when Phase 0 hasn't wired the question yet — the user can tell from
// the (placeholder) tag in the UI that the anchor is provisional.
export async function readVatAnchor(
  engagementId: string,
  fallbackPeriodEnd: string,
): Promise<{ anchorIso: string; isPlaceholder: boolean }> {
  try {
    const res = await fetch(`/api/engagements/${engagementId}/permanent-file`);
    if (!res.ok) return { anchorIso: fallbackPeriodEnd, isPlaceholder: true };
    const json = await res.json();
    const flat: Record<string, unknown> = {};
    for (const [, sectionData] of Object.entries(json.data || {})) {
      if (typeof sectionData === 'object' && sectionData) Object.assign(flat, sectionData);
    }
    const raw = flat[VAT_PERIOD_END_ANCHOR_KEY];
    if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}/.test(raw)) {
      return { anchorIso: raw, isPlaceholder: false };
    }
    return { anchorIso: fallbackPeriodEnd, isPlaceholder: true };
  } catch {
    return { anchorIso: fallbackPeriodEnd, isPlaceholder: true };
  }
}
