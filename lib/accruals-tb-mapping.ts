/**
 * Accruals / TB mapping helpers used by the Year-End Accruals pipeline.
 *
 * The listing reconciliation step needs to compare the client-supplied
 * accruals listing total against the sum of the relevant TB account
 * codes. Two ways to identify those codes:
 *
 *   1. Explicit comma-separated list on the action input
 *      (`accrual_account_codes`). Useful on first runs where the firm
 *      hasn't classified its TB rows yet.
 *   2. Implicit via `audit_tb_rows.is_accrual_account = true`. Preferred
 *      for recurring engagements once the methodology admin has flagged
 *      the codes against a firm's TB.
 *
 * If both are present, the explicit list wins (it's more specific).
 */

import { prisma } from '@/lib/db';

export interface AccrualsTbReconciliation {
  codes: string[];
  rows: Array<{ accountCode: string; description: string; currentYear: number }>;
  tbTotal: number;
}

function parseCodeList(input: string | null | undefined): string[] {
  if (!input) return [];
  return input
    .split(/[,\s]+/)
    .map(s => s.trim())
    .filter(Boolean);
}

/**
 * Load the accrual-account TB rows for an engagement. Sign convention:
 * creditor/accrual balances are typically credits, i.e. negative when
 * stored as a normal "currentYear" figure. We return the absolute sum
 * so the caller compares magnitude — the listing total is almost always
 * positive.
 */
export async function sumAccrualsAtPeriodEnd(
  engagementId: string,
  explicitCodesInput?: string | null,
): Promise<AccrualsTbReconciliation> {
  const explicit = parseCodeList(explicitCodesInput);

  const rows = explicit.length > 0
    ? await prisma.auditTBRow.findMany({
        where: {
          engagementId,
          OR: [
            { accountCode: { in: explicit } },
            { originalAccountCode: { in: explicit } },
          ],
        },
        select: { accountCode: true, description: true, currentYear: true },
      })
    : await prisma.auditTBRow.findMany({
        where: { engagementId, isAccrualAccount: true },
        select: { accountCode: true, description: true, currentYear: true },
      });

  const rowsOut = rows.map(r => ({
    accountCode: r.accountCode,
    description: r.description,
    currentYear: Number(r.currentYear || 0),
  }));

  const rawSum = rowsOut.reduce((s, r) => s + r.currentYear, 0);
  // Accruals are credit balances → stored as negatives in most TB imports.
  // Take the absolute value so the caller can compare magnitude.
  const tbTotal = Math.abs(Math.round(rawSum * 100) / 100);

  const codes = explicit.length > 0 ? explicit : rowsOut.map(r => r.accountCode);

  return { codes, rows: rowsOut, tbTotal };
}

/**
 * Best-effort extract of the total from a parsed accruals listing.
 * Accepts an array of rows (already parsed from the uploaded file) and
 * sums anything that looks like an amount column. Prefers explicit
 * "Amount" / "Accrual" / "Gross" columns; otherwise picks the first
 * numeric column.
 */
export function sumAccrualsListing(rows: Array<Record<string, any>>): { total: number; column: string | null } {
  if (!Array.isArray(rows) || rows.length === 0) return { total: 0, column: null };

  const preferred = ['amount', 'accrual', 'accrualamount', 'gross', 'grossamount', 'value', 'total'];
  const sample = rows[0];
  const keys = Object.keys(sample);
  const normalised = keys.map(k => ({ key: k, norm: k.toLowerCase().replace(/[\s_-]/g, '') }));

  let chosen: string | null = null;
  for (const want of preferred) {
    const hit = normalised.find(n => n.norm === want);
    if (hit) { chosen = hit.key; break; }
  }
  if (!chosen) {
    // Fallback — first column whose values are mostly numeric.
    for (const { key } of normalised) {
      const nums = rows.map(r => Number(r[key])).filter(n => !Number.isNaN(n));
      if (nums.length >= rows.length * 0.75) { chosen = key; break; }
    }
  }
  if (!chosen) return { total: 0, column: null };

  const total = rows.reduce((s, r) => s + (Number(r[chosen!]) || 0), 0);
  return { total: Math.round(total * 100) / 100, column: chosen };
}
