/**
 * Pure depreciation / amortisation calculator for the Fixed Asset
 * Register popup's "Calculated Value" comparison section.
 *
 * Five methods are supported, matching the user's spec:
 *   - straight_line      : (cost − residual) / usefulLifeYears
 *   - reducing_balance   : NBV × annualRate   (or NBV × 1/usefulLifeYears if rate missing)
 *   - usage              : (cost − residual) × consumptionUnitsInPeriod / totalUnits
 *   - soyd               : sum-of-the-years'-digits — current year's fraction of the
 *                          remaining-life sum applied to (cost − residual)
 *   - x_declining        : NBV × (decliningFactorX / usefulLifeYears)
 *
 * Mid-period acquisitions and disposals get pro-rated by days held within
 * the period — so a £10k addition halfway through a 365-day year and a
 * 10-year straight-line policy only attracts ~£500 of charge for the
 * period rather than the full annual £1,000.
 *
 * All inputs are plain numbers in the engagement currency. The caller
 * handles rounding/display formatting via lib/audit-rounding.
 */

export type DepreciationMethod = 'straight_line' | 'reducing_balance' | 'usage' | 'soyd' | 'x_declining';

export interface DepreciationParams {
  method: DepreciationMethod;
  residualValue: number;
  /** Years over which the asset depreciates. Used by straight_line, soyd,
   *  x_declining; ignored for reducing_balance when annualRatePct is set,
   *  ignored entirely for usage. */
  usefulLifeYears: number | null;
  /** Annual % rate for reducing_balance (e.g. 25 → 25%). Falls back to
   *  1/usefulLifeYears when null. */
  annualRatePct: number | null;
  /** Multiplier on the straight-line rate for x_declining. 2 = double
   *  declining balance, 1.5 = 150% declining etc. */
  decliningFactorX: number | null;
  /** Units consumed in THIS period (usage method only). */
  consumptionUnitsInPeriod: number | null;
  /** Total expected units over the asset's life (usage method only). */
  totalUnits: number | null;
  /** Number of full years already depreciated under SOYD — used to
   *  derive the current year's fraction. Null = year 1. */
  soydPriorYearsDepreciated: number | null;
}

export interface RoughAdjustment {
  id: string;
  kind: 'acquisition' | 'disposal';
  amount: number;
  /** ISO date string (YYYY-MM-DD). */
  date: string;
  note?: string;
}

export interface DepreciationInputs {
  params: DepreciationParams;
  costOpening: number;
  costAdditionsAtPeriodEnd: number;   // additions assumed in the popup grid (treated as period-end)
  costDisposalsAtPeriodEnd: number;   // disposals assumed in the popup grid (treated as period-end)
  accumulatedDepreciationOpening: number; // negative number; e.g. -50000
  /** Mid-period acquisitions / disposals with explicit dates. The
   *  costAdditionsAtPeriodEnd / costDisposalsAtPeriodEnd values above
   *  cover anything dated period-end exactly; this list lets the
   *  auditor capture the rest so the calculator can pro-rate. */
  roughAdjustments: RoughAdjustment[];
  /** Period start + end as YYYY-MM-DD. Used to pro-rate roughAdjustments. */
  periodStart: string;
  periodEnd: string;
}

export interface DepreciationResult {
  calculatedCharge: number;
  /** Per-component breakdown so the UI can show the auditor where the
   *  number came from. */
  breakdown: {
    onOpeningNbv: number;
    onPeriodEndAdditions: number;
    onPeriodEndDisposals: number;
    onMidPeriodAcquisitions: number;
    onMidPeriodDisposals: number;
  };
  notes: string[];
}

/** Days between two YYYY-MM-DD dates (rounded). Always >= 0. */
function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(fromIso);
  const b = Date.parse(toIso);
  if (!isFinite(a) || !isFinite(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

/** Pick the later of two ISO dates (string comparison works for YYYY-MM-DD). */
function maxIso(a: string, b: string): string {
  return a > b ? a : b;
}

/** Pick the earlier of two ISO dates. */
function minIso(a: string, b: string): string {
  return a < b ? a : b;
}

/** Days an acquisition contributes to the period:
 *  the asset is presumed held from the acquisition date to period end,
 *  but the contribution is bounded by the period itself. Dates before
 *  period_start are clamped to period_start (so a pre-period acquisition
 *  attracts the full period's worth of charge — same as it would if
 *  recorded in the opening cost); dates after period_end attract zero. */
function acquisitionDaysInPeriod(acqDate: string, periodStart: string, periodEnd: string): number {
  if (acqDate > periodEnd) return 0;
  const effectiveStart = maxIso(acqDate, periodStart);
  return daysBetween(effectiveStart, periodEnd);
}

/** Days a disposal removes from the period:
 *  the asset is presumed to have been held from period start, then
 *  disposed of mid-period — so the "missing days" run from the disposal
 *  date to period end, clamped to the period. Disposals before
 *  period_start contribute zero (the asset wasn't in opening cost),
 *  disposals after period_end contribute zero (the asset was held all
 *  period). */
function disposalDaysMissingFromPeriod(dispDate: string, periodStart: string, periodEnd: string): number {
  if (dispDate < periodStart) return 0;
  if (dispDate >= periodEnd) return 0;
  const effectiveStart = maxIso(dispDate, periodStart);
  return daysBetween(effectiveStart, periodEnd);
}

/** Annual rate implied by the params (for straight-line-like methods).
 *  Returns 0 when life or rate aren't usable. */
function annualRateFromParams(p: DepreciationParams): number {
  if (p.method === 'reducing_balance' && p.annualRatePct != null && p.annualRatePct > 0) {
    return p.annualRatePct / 100;
  }
  if (p.usefulLifeYears != null && p.usefulLifeYears > 0) {
    return 1 / p.usefulLifeYears;
  }
  return 0;
}

/** Depreciable base for the period — cost (or valuation) less residual,
 *  bounded so we don't return negatives. */
function depreciableBase(cost: number, residual: number): number {
  return Math.max(0, cost - Math.max(0, residual));
}

/** Annual depreciation on a freshly-purchased asset of size `cost`,
 *  before time-apportionment. Returned as a positive number (charges
 *  are reported with sign at the caller). */
function annualChargeForCost(cost: number, p: DepreciationParams, openingNbv?: number): number {
  const base = depreciableBase(cost, p.residualValue);
  switch (p.method) {
    case 'straight_line': {
      if (!p.usefulLifeYears || p.usefulLifeYears <= 0) return 0;
      return base / p.usefulLifeYears;
    }
    case 'reducing_balance': {
      const r = annualRateFromParams(p);
      // For reducing balance we want NBV × rate. When the caller is
      // computing the charge on a fresh acquisition we use the cost
      // less residual as the NBV starting point.
      const nbv = openingNbv != null ? openingNbv : Math.max(0, cost - p.residualValue);
      return nbv * r;
    }
    case 'usage': {
      if (!p.totalUnits || p.totalUnits <= 0) return 0;
      const used = p.consumptionUnitsInPeriod ?? 0;
      return base * (used / p.totalUnits);
    }
    case 'soyd': {
      if (!p.usefulLifeYears || p.usefulLifeYears <= 0) return 0;
      const life = Math.floor(p.usefulLifeYears);
      const sumDigits = (life * (life + 1)) / 2;
      const yearsAlreadyDepreciated = Math.max(0, Math.floor(p.soydPriorYearsDepreciated ?? 0));
      const yearsRemaining = Math.max(0, life - yearsAlreadyDepreciated);
      if (sumDigits <= 0 || yearsRemaining <= 0) return 0;
      return base * (yearsRemaining / sumDigits);
    }
    case 'x_declining': {
      if (!p.usefulLifeYears || p.usefulLifeYears <= 0) return 0;
      const x = p.decliningFactorX && p.decliningFactorX > 0 ? p.decliningFactorX : 2;
      const r = x / p.usefulLifeYears;
      const nbv = openingNbv != null ? openingNbv : Math.max(0, cost - p.residualValue);
      return nbv * r;
    }
  }
}

/** Full computation. Returns the expected charge for the period plus a
 *  breakdown the popup uses to show working. Charge is returned as a
 *  POSITIVE number; the popup compares against the absolute booked
 *  charge so the sign convention doesn't matter at the call site. */
export function calculatePeriodCharge(inp: DepreciationInputs): DepreciationResult {
  const { params, costOpening, costAdditionsAtPeriodEnd, costDisposalsAtPeriodEnd, accumulatedDepreciationOpening, roughAdjustments, periodStart, periodEnd } = inp;
  const notes: string[] = [];

  // Opening NBV = cost less accumulated depreciation. accumulated dep is
  // stored as a negative number in the popup, so we ADD to subtract.
  const openingNbv = Math.max(0, costOpening + accumulatedDepreciationOpening);

  // 1) Charge on the opening book of assets. Reducing balance / x-decl
  //    bite on NBV; everything else bites on cost less residual.
  let onOpeningNbv = 0;
  if (params.method === 'reducing_balance' || params.method === 'x_declining') {
    onOpeningNbv = annualChargeForCost(costOpening, params, openingNbv);
  } else {
    onOpeningNbv = annualChargeForCost(costOpening, params);
  }

  // 2) Period-end additions / disposals as captured in the main popup
  //    grid — these are assumed to land ON the period end so they
  //    attract zero charge for the period (under most policies). We
  //    flag them in notes so the user knows we didn't pro-rate.
  const onPeriodEndAdditions = 0;
  const onPeriodEndDisposals = 0;
  if (Math.abs(costAdditionsAtPeriodEnd) > 0 || Math.abs(costDisposalsAtPeriodEnd) > 0) {
    notes.push('Additions/disposals from the main grid are assumed to land on period end (no pro-rata charge). Capture mid-period movements in Rough Adjustments below.');
  }

  // 3) Mid-period rough adjustments — pro-rate by days actually held
  //    WITHIN the engagement period. Earlier the helper used a flat
  //    daysBetween(adj.date, periodEnd) without capping by period
  //    boundaries, which mis-counted (a) acquisitions dated before
  //    period start (over-counted) and (b) disposals dated outside
  //    the period (raised a fictitious adjustment). Both sides now
  //    use the period-aware helpers above; the denominator stays at
  //    365 because depreciation policies are expressed annually —
  //    a 60-day holding accrues 60/365 of annual regardless of the
  //    engagement's own period length.
  let onMidPeriodAcquisitions = 0;
  let onMidPeriodDisposals = 0;
  for (const adj of roughAdjustments) {
    if (!adj || !adj.amount || !adj.date) continue;
    if (adj.kind === 'acquisition') {
      const daysHeld = acquisitionDaysInPeriod(adj.date, periodStart, periodEnd);
      const fraction = daysHeld / 365;
      const annual = annualChargeForCost(adj.amount, params, Math.max(0, adj.amount - params.residualValue));
      onMidPeriodAcquisitions += annual * fraction;
      if (adj.date < periodStart) {
        notes.push(`Acquisition "${adj.note || ''}" dated ${adj.date} is before period start ${periodStart}; treated as held for the full period (${daysHeld} days within period).`);
      } else if (adj.date > periodEnd) {
        notes.push(`Acquisition "${adj.note || ''}" dated ${adj.date} is after period end ${periodEnd}; no charge raised in this period.`);
      }
    } else if (adj.kind === 'disposal') {
      // For disposals, subtract the charge that WON'T be raised because
      // the asset was disposed mid-period.
      const daysMissing = disposalDaysMissingFromPeriod(adj.date, periodStart, periodEnd);
      const fraction = daysMissing / 365;
      const annual = annualChargeForCost(adj.amount, params, Math.max(0, adj.amount - params.residualValue));
      onMidPeriodDisposals += annual * fraction;
      if (adj.date < periodStart) {
        notes.push(`Disposal "${adj.note || ''}" dated ${adj.date} is before period start ${periodStart}; no charge adjustment raised (asset wasn't in opening cost).`);
      } else if (adj.date >= periodEnd) {
        notes.push(`Disposal "${adj.note || ''}" dated ${adj.date} is on/after period end ${periodEnd}; no charge adjustment raised (asset held throughout).`);
      }
    }
  }
  const totalDaysInPeriod = Math.max(1, daysBetween(periodStart, periodEnd));

  // Apportion the opening-book charge if the engagement period is
  // shorter / longer than a year. Common case: 365-day periods → factor
  // is 1, so this is a no-op.
  const periodFactor = totalDaysInPeriod / 365;
  if (Math.abs(periodFactor - 1) > 0.01) {
    notes.push(`Engagement period spans ${totalDaysInPeriod} days — opening-book charge has been time-apportioned (${periodFactor.toFixed(2)} × annual).`);
  }
  onOpeningNbv *= periodFactor;

  const calculatedCharge = onOpeningNbv + onPeriodEndAdditions - onPeriodEndDisposals + onMidPeriodAcquisitions - onMidPeriodDisposals;

  return {
    calculatedCharge,
    breakdown: {
      onOpeningNbv,
      onPeriodEndAdditions,
      onPeriodEndDisposals,
      onMidPeriodAcquisitions,
      onMidPeriodDisposals,
    },
    notes,
  };
}

/** Empty params with the safest defaults — straight-line, no residual,
 *  no life. Used when initialising a category that doesn't have a saved
 *  policy yet. */
export function emptyDepreciationParams(): DepreciationParams {
  return {
    method: 'straight_line',
    residualValue: 0,
    usefulLifeYears: null,
    annualRatePct: null,
    decliningFactorX: 2,
    consumptionUnitsInPeriod: null,
    totalUnits: null,
    soydPriorYearsDepreciated: null,
  };
}

/** Used to label every UI surface — Tangible assets get "Depreciation"
 *  wording, Intangible get "Amortisation". `both` is the all-bets-off
 *  TBCYvPY popup which uses the joint label. */
export type AssetClass = 'tangible' | 'intangible' | 'both';

export function chargeNoun(cls: AssetClass): string {
  if (cls === 'intangible') return 'Amortisation';
  if (cls === 'tangible') return 'Depreciation';
  return 'Depreciation / Amortisation';
}
