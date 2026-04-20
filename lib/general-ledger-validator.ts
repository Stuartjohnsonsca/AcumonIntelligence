/**
 * Validates the Trial Balance current-period column against an aggregated
 * General Ledger summary.
 *
 * For Balance Sheet rows:
 *   expected CY = priorYear + sum(GL movements for accountCode in period)
 *
 * For P&L rows:
 *   expected CY = sum(GL movements for accountCode in period)
 *   (opening balance is always zero — P&L accounts reset each year)
 *
 * For the P&L Reserves row (heuristic match on description / fsLevel),
 * we also add the sum of all P&L items' currentYear values, to reflect
 * the year's net profit posted to retained earnings before the year-end
 * close journal hits the GL.
 *
 * Any difference with absolute value below TOLERANCE is treated as a
 * match — rounding to the nearest penny in both the GL and the TB can
 * leave sub-penny discrepancies that aren't real disagreements.
 */

const TOLERANCE = 0.01;

export interface TbRowForValidation {
  id: string;
  accountCode: string;
  description: string;
  fsStatement: string | null;
  fsLevel: string | null;
  currentYear: number | null;
  priorYear: number | null;
}

export interface GlCheckResult {
  rowId: string;
  accountCode: string;
  status: 'green' | 'red' | 'no-data';
  priorYear: number;
  glMovement: number;
  pnlAdjustment: number; // non-zero only for the P&L Reserves row
  expected: number;
  actual: number;
  difference: number;
  message: string;
}

const PNL_RESERVES_KEYWORDS = [
  'retained earning',
  'retained reserve',
  'p&l reserve',
  'pnl reserve',
  'profit and loss reserve',
  'profit & loss reserve',
  'profit and loss account',
  'income statement reserve',
  'accumulated profit',
];

/** Returns true if the row looks like the firm's "P&L Reserves" /
 *  retained earnings line (heuristic match on description and fsLevel). */
export function isPnlReservesRow(row: TbRowForValidation): boolean {
  const haystack = `${row.description || ''} ${row.fsLevel || ''}`.toLowerCase();
  return PNL_RESERVES_KEYWORDS.some(kw => haystack.includes(kw));
}

/** Returns true if the row is a P&L item (its activity rolls into retained
 *  earnings at year end). */
function isPnlRow(row: TbRowForValidation): boolean {
  const stmt = (row.fsStatement || '').toLowerCase();
  return stmt.includes('profit') || stmt.includes('loss') || stmt === 'pnl' || stmt.includes('income statement');
}

export function validateTbAgainstGl(
  rows: TbRowForValidation[],
  glByAccount: Record<string, number>,
): GlCheckResult[] {
  // Sum all P&L items' CY values (for the retained earnings adjustment)
  const pnlYearActivity = rows
    .filter(isPnlRow)
    .reduce((sum, r) => sum + (Number(r.currentYear) || 0), 0);

  return rows.map(row => {
    const accountCode = row.accountCode || '';
    const priorYear = Number(row.priorYear) || 0;
    const currentYear = Number(row.currentYear) || 0;
    // GL key — try exact accountCode first
    const rawMovement = accountCode in glByAccount ? glByAccount[accountCode] : null;

    if (rawMovement === null) {
      return {
        rowId: row.id,
        accountCode,
        status: 'no-data',
        priorYear,
        glMovement: 0,
        pnlAdjustment: 0,
        expected: priorYear,
        actual: currentYear,
        difference: currentYear - priorYear,
        message: accountCode
          ? `No G/L activity found for account "${accountCode}" — cannot verify.`
          : 'Row has no account code — cannot match to G/L.',
      };
    }

    const isReserves = isPnlReservesRow(row);
    const isPnl = isPnlRow(row);
    const pnlAdjustment = isReserves ? pnlYearActivity : 0;
    // Note: P&L items in most GL exports represent debit-positive movements.
    // Retained earnings (a credit-balance equity account) is increased by
    // credits (negative debits). So when adding the year's P&L activity we
    // SUBTRACT the (debit-positive) sum to credit retained earnings.
    // Net profit (positive) = revenues (credit) - expenses (debit) — but
    // signed "amount = debit - credit" gives negative for revenues and
    // positive for expenses, so the *negation* of the P&L sum equals the
    // net profit credited to RE.
    //
    // For P&L rows themselves, the opening balance is always zero — P&L
    // accounts reset at the start of each year — so the expected CY is
    // simply the year's GL movement, independent of priorYear.
    const openingForExpected = isPnl ? 0 : priorYear;
    const expected = openingForExpected + rawMovement + (isReserves ? -pnlAdjustment : 0);
    const difference = currentYear - expected;
    const status = Math.abs(difference) < TOLERANCE ? 'green' : 'red';

    let message: string;
    if (status === 'green') {
      if (isReserves) {
        message = `Agrees: PY ${fmt(priorYear)} + GL ${fmt(rawMovement)} + P&L roll-up ${fmt(-pnlAdjustment)} = CY ${fmt(currentYear)}`;
      } else if (isPnl) {
        message = `Agrees: GL ${fmt(rawMovement)} = CY ${fmt(currentYear)} (P&L accounts open at zero)`;
      } else {
        message = `Agrees: PY ${fmt(priorYear)} + GL ${fmt(rawMovement)} = CY ${fmt(currentYear)}`;
      }
    } else {
      if (isReserves) {
        message = `Disagrees by ${fmt(difference)}\nPY ${fmt(priorYear)} + GL ${fmt(rawMovement)} + P&L roll-up ${fmt(-pnlAdjustment)}\n= expected ${fmt(expected)}, actual CY ${fmt(currentYear)}`;
      } else if (isPnl) {
        message = `Disagrees by ${fmt(difference)}\nGL ${fmt(rawMovement)} (opening always 0 for P&L)\n= expected ${fmt(expected)}, actual CY ${fmt(currentYear)}`;
      } else {
        message = `Disagrees by ${fmt(difference)}\nPY ${fmt(priorYear)} + GL ${fmt(rawMovement)}\n= expected ${fmt(expected)}, actual CY ${fmt(currentYear)}`;
      }
    }

    return {
      rowId: row.id,
      accountCode,
      status,
      priorYear: isPnl ? 0 : priorYear,
      glMovement: rawMovement,
      pnlAdjustment: isReserves ? -pnlAdjustment : 0,
      expected,
      actual: currentYear,
      difference,
      message,
    };
  });
}

function fmt(n: number): string {
  const abs = Math.abs(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `(£${abs})` : `£${abs}`;
}
