/**
 * General Ledger file parser.
 *
 * Accepts both CSV and Excel exports. The exact column layout varies between
 * accounting systems so we use case-insensitive header matching against a
 * configurable set of synonyms.
 *
 * Output: a list of GL line items with at minimum { date, accountCode,
 * amount } where amount is signed (positive = debit, negative = credit).
 */

import { parse as parseCsv } from 'csv-parse/sync';
import ExcelJS from 'exceljs';

export interface GlLine {
  date: Date | null;
  accountCode: string;
  description?: string | null;
  amount: number; // signed: positive = debit, negative = credit
}

export interface GlParseResult {
  lines: GlLine[];
  totalRows: number;
  matchedColumns: { date: string; accountCode: string; amount: string };
  warnings: string[];
}

// Header synonyms — lowercase comparison.  When parsing we normalise headers
// to lowercase and strip non-alphanumerics, then check against these lists.
const ACCOUNT_HEADERS = ['accountcode', 'account', 'code', 'glcode', 'glaccount', 'accountnumber', 'accountno', 'accountnumeric', 'nominal', 'nominalcode', 'nominalaccount'];
const DATE_HEADERS = ['date', 'transactiondate', 'postedat', 'postingdate', 'posteddate', 'documentdate', 'period', 'glperiod', 'transdate'];
const DEBIT_HEADERS = ['debit', 'dr', 'debitamount', 'debits', 'amountdebit'];
const CREDIT_HEADERS = ['credit', 'cr', 'creditamount', 'credits', 'amountcredit'];
const AMOUNT_HEADERS = ['amount', 'value', 'netamount', 'net', 'transactionamount', 'glamount'];
const DESC_HEADERS = ['description', 'narrative', 'memo', 'reference', 'particulars', 'details'];

function normaliseHeader(h: string): string {
  return String(h || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function findColumnIndex(headers: string[], candidates: string[]): number {
  const norm = headers.map(normaliseHeader);
  for (const c of candidates) {
    const idx = norm.indexOf(c);
    if (idx >= 0) return idx;
  }
  return -1;
}

function parseDate(raw: any): Date | null {
  if (raw == null || raw === '') return null;
  if (raw instanceof Date) return isNaN(raw.getTime()) ? null : raw;

  // Excel sometimes gives us a serial number
  if (typeof raw === 'number' && raw > 25569 && raw < 60000) {
    // Excel epoch is 1900-01-00; serial * day + epoch
    const ms = (raw - 25569) * 86400 * 1000;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d;
  }

  const s = String(raw).trim();
  if (!s) return null;

  // Try ISO first
  const iso = new Date(s);
  if (!isNaN(iso.getTime())) return iso;

  // Try DD/MM/YYYY (UK) and MM/DD/YYYY
  const m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/);
  if (m) {
    let [, a, b, c] = m;
    let year = parseInt(c, 10);
    if (year < 100) year += year < 50 ? 2000 : 1900;
    // Assume DD/MM/YYYY (UK) — if first part > 12 it must be day
    const day = parseInt(a, 10);
    const month = parseInt(b, 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return new Date(year, month - 1, day);
    }
  }

  return null;
}

function parseAmount(raw: any): number {
  if (raw == null || raw === '') return 0;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0;
  let s = String(raw).trim().replace(/,/g, '');
  // Handle parenthesised negatives e.g. (1,234.50)
  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
  if (/^-/.test(s)) { negative = !negative; s = s.slice(1); }
  // Strip currency symbols
  s = s.replace(/[£$€¥]/g, '').trim();
  const n = Number(s);
  if (!Number.isFinite(n)) return 0;
  return negative ? -n : n;
}

/**
 * Parse a CSV file buffer into GL lines.
 */
export function parseGlCsv(buffer: Buffer): GlParseResult {
  const text = buffer.toString('utf-8');
  const rows: any[][] = parseCsv(text, {
    skip_empty_lines: true,
    bom: true,
    relax_column_count: true,
    trim: true,
  });
  if (rows.length === 0) {
    return { lines: [], totalRows: 0, matchedColumns: { date: '', accountCode: '', amount: '' }, warnings: ['Empty CSV file'] };
  }

  const headers = rows[0].map((h: any) => String(h || ''));
  return rowsToGlLines(headers, rows.slice(1));
}

/**
 * Parse an Excel (.xlsx) file buffer into GL lines.
 */
export async function parseGlExcel(buffer: Buffer): Promise<GlParseResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as any);
  const ws = wb.worksheets[0];
  if (!ws) {
    return { lines: [], totalRows: 0, matchedColumns: { date: '', accountCode: '', amount: '' }, warnings: ['Workbook has no worksheet'] };
  }

  const rows: any[][] = [];
  ws.eachRow({ includeEmpty: false }, row => {
    const arr: any[] = [];
    row.eachCell({ includeEmpty: true }, cell => {
      // Use cell.value for raw value; fall back to text for formula cells
      let v: any = cell.value;
      if (v && typeof v === 'object' && 'result' in v) v = (v as any).result;
      if (v && typeof v === 'object' && 'text' in v) v = (v as any).text;
      arr.push(v);
    });
    rows.push(arr);
  });

  if (rows.length === 0) {
    return { lines: [], totalRows: 0, matchedColumns: { date: '', accountCode: '', amount: '' }, warnings: ['Empty worksheet'] };
  }

  const headers = rows[0].map((h: any) => String(h || ''));
  return rowsToGlLines(headers, rows.slice(1));
}

function rowsToGlLines(headers: string[], dataRows: any[][]): GlParseResult {
  const warnings: string[] = [];
  const dateIdx = findColumnIndex(headers, DATE_HEADERS);
  const accountIdx = findColumnIndex(headers, ACCOUNT_HEADERS);
  const debitIdx = findColumnIndex(headers, DEBIT_HEADERS);
  const creditIdx = findColumnIndex(headers, CREDIT_HEADERS);
  const amountIdx = findColumnIndex(headers, AMOUNT_HEADERS);
  const descIdx = findColumnIndex(headers, DESC_HEADERS);

  if (accountIdx < 0) warnings.push('Could not find an Account / Code column. Looked for: ' + ACCOUNT_HEADERS.slice(0, 6).join(', '));
  if (dateIdx < 0) warnings.push('Could not find a Date column. Will not be able to filter by period.');
  if (debitIdx < 0 && creditIdx < 0 && amountIdx < 0) {
    warnings.push('Could not find any Amount column (Debit/Credit/Amount).');
  }

  const lines: GlLine[] = [];
  for (const row of dataRows) {
    if (!row || row.every(c => c == null || c === '')) continue;
    const accountCode = accountIdx >= 0 ? String(row[accountIdx] ?? '').trim() : '';
    if (!accountCode) continue;

    const date = dateIdx >= 0 ? parseDate(row[dateIdx]) : null;

    let amount = 0;
    if (debitIdx >= 0 || creditIdx >= 0) {
      const dr = debitIdx >= 0 ? parseAmount(row[debitIdx]) : 0;
      const cr = creditIdx >= 0 ? parseAmount(row[creditIdx]) : 0;
      amount = dr - cr;
    } else if (amountIdx >= 0) {
      amount = parseAmount(row[amountIdx]);
    }

    if (amount === 0 && date == null) continue; // skip blank rows

    lines.push({
      date,
      accountCode,
      description: descIdx >= 0 ? String(row[descIdx] ?? '').trim() || null : null,
      amount,
    });
  }

  return {
    lines,
    totalRows: dataRows.length,
    matchedColumns: {
      date: dateIdx >= 0 ? headers[dateIdx] : '',
      accountCode: accountIdx >= 0 ? headers[accountIdx] : '',
      amount: debitIdx >= 0 || creditIdx >= 0
        ? `${debitIdx >= 0 ? headers[debitIdx] : ''}${debitIdx >= 0 && creditIdx >= 0 ? ' / ' : ''}${creditIdx >= 0 ? headers[creditIdx] : ''}`
        : amountIdx >= 0 ? headers[amountIdx] : '',
    },
    warnings,
  };
}

/**
 * Aggregate parsed GL lines into a per-account net movement, filtered to a
 * date range. Returns { [accountCode]: netSignedAmount } where positive =
 * net debit movement, negative = net credit movement.
 */
export function aggregateGlByAccount(
  lines: GlLine[],
  periodStart: Date | null,
  periodEnd: Date | null,
): { byAccount: Record<string, number>; inPeriodCount: number; outOfPeriodCount: number; missingDateCount: number } {
  const byAccount: Record<string, number> = {};
  let inPeriodCount = 0;
  let outOfPeriodCount = 0;
  let missingDateCount = 0;

  for (const line of lines) {
    if (!line.accountCode) continue;
    if (line.date == null) {
      // No date — count but don't include in totals (can't tell if in period)
      missingDateCount++;
      continue;
    }
    if (periodStart && line.date < periodStart) { outOfPeriodCount++; continue; }
    if (periodEnd && line.date > periodEnd) { outOfPeriodCount++; continue; }

    inPeriodCount++;
    byAccount[line.accountCode] = (byAccount[line.accountCode] || 0) + line.amount;
  }

  return { byAccount, inPeriodCount, outOfPeriodCount, missingDateCount };
}
