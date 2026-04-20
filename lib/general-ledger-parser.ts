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
const ACCOUNT_HEADERS = ['accountcode', 'account', 'code', 'glcode', 'glaccount', 'accountnumber', 'accountno', 'accountnumeric', 'nominal', 'nominalcode', 'nominalaccount', 'ac', 'accode', 'accountid', 'ledgeraccount', 'ledgercode', 'accountref'];
const DATE_HEADERS = ['date', 'transactiondate', 'postedat', 'postingdate', 'posteddate', 'documentdate', 'period', 'glperiod', 'transdate', 'docdate', 'entrydate', 'txndate', 'journaldate', 'effectivedate'];
const DEBIT_HEADERS = ['debit', 'dr', 'debitamount', 'debits', 'amountdebit', 'dramount', 'debitgbp', 'debitvalue'];
const CREDIT_HEADERS = ['credit', 'cr', 'creditamount', 'credits', 'amountcredit', 'cramount', 'creditgbp', 'creditvalue'];
const AMOUNT_HEADERS = ['amount', 'value', 'netamount', 'net', 'transactionamount', 'glamount', 'signedamount', 'totalamount', 'lineamount', 'postedamount'];
const DESC_HEADERS = ['description', 'narrative', 'memo', 'reference', 'particulars', 'details', 'comment', 'notes', 'lineitem', 'journaldescription', 'txndescription'];

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
  // Reject bare numerics that aren't in the Excel-serial range — JS's
  // Date constructor happily parses short integers as dates (e.g. the
  // transaction-id "76234" becomes year 76234) which produces false
  // positives in the column-profile heuristic.
  if (typeof raw === 'number') return null;

  const s = String(raw).trim();
  if (!s) return null;

  // Must contain a date-shaped separator. This guards against the same
  // false-positive as above for text-valued numeric IDs ("76234" →
  // Invalid Date is what we want, not a 76234 AD epoch).
  const looksLikeDate = /[\/.\-T:]/.test(s) && /\d/.test(s);
  const hasMonthName = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(s);
  if (!looksLikeDate && !hasMonthName) return null;

  // Try DD/MM/YYYY (UK) and MM/DD/YYYY first so UK day-first dates
  // aren't silently mis-parsed by the built-in constructor.
  const m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/);
  if (m) {
    const [, a, b, c] = m;
    let year = parseInt(c, 10);
    if (year < 100) year += year < 50 ? 2000 : 1900;
    const day = parseInt(a, 10);
    const month = parseInt(b, 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return new Date(year, month - 1, day);
    }
  }

  const iso = new Date(s);
  if (!isNaN(iso.getTime())) {
    // Sanity guard — reject dates too far outside a realistic audit range.
    const y = iso.getFullYear();
    if (y >= 1900 && y <= 2100) return iso;
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

  return parseWithFormatDetection(rows);
}

/**
 * Parse an Excel (.xlsx) file buffer into GL lines. Tries every sheet in
 * the workbook and returns the parse result with the most lines — many
 * firms export a G/L report with a summary sheet first and the detail
 * on a later sheet, so blindly picking sheet 0 can miss the data.
 */
export async function parseGlExcel(buffer: Buffer): Promise<GlParseResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as any);
  if (wb.worksheets.length === 0) {
    return { lines: [], totalRows: 0, matchedColumns: { date: '', accountCode: '', amount: '' }, warnings: ['Workbook has no worksheet'] };
  }

  let best: GlParseResult | null = null;
  let bestSheetName = '';
  for (const ws of wb.worksheets) {
    const rows: any[][] = [];
    ws.eachRow({ includeEmpty: false }, row => {
      const arr: any[] = [];
      row.eachCell({ includeEmpty: true }, cell => {
        let v: any = cell.value;
        if (v && typeof v === 'object' && 'result' in v) v = (v as any).result;
        if (v && typeof v === 'object' && 'text' in v) v = (v as any).text;
        arr.push(v);
      });
      rows.push(arr);
    });
    if (rows.length === 0) continue;
    const result = parseWithFormatDetection(rows);
    if (!best || result.lines.length > best.lines.length) {
      best = result;
      bestSheetName = ws.name;
    }
  }
  if (!best) {
    return { lines: [], totalRows: 0, matchedColumns: { date: '', accountCode: '', amount: '' }, warnings: ['All worksheets were empty.'] };
  }
  if (wb.worksheets.length > 1) {
    best.warnings = [`Using sheet "${bestSheetName}" (${best.lines.length} lines).`, ...best.warnings];
  }
  return best;
}

/**
 * Two-format dispatcher. Some accounting systems export G/L data as a flat
 * table with a single header row ("Date | Account | Debit | Credit …"); Xero
 * and similar systems export a *grouped* report where each account is
 * introduced by a section header row and followed by its transactions, with
 * "Total X" / "Net movement" summary rows in between. We try the flat parser
 * first (looking for a header in the first ~20 rows); if that fails to find
 * the minimum columns we need, we fall back to the grouped parser.
 */
function parseWithFormatDetection(rows: any[][]): GlParseResult {
  const flat = tryParseFlat(rows);
  if (flat) return flat;
  return parseGroupedReport(rows);
}

/**
 * Try to locate a flat table header inside the first ~20 rows. Many exports
 * prefix a few banner rows (company name, period, logo) before the real data
 * table, so the header isn't always on row 1. We pick the first row that
 * contains at least an Account-like column AND either a Date column or an
 * amount column — that's the most conservative signal for "this is the
 * header row". Returns null if no such row is found.
 */
function tryParseFlat(rows: any[][]): GlParseResult | null {
  const maxScan = Math.min(rows.length, 20);
  for (let i = 0; i < maxScan; i++) {
    const headers = rows[i].map((h: any) => String(h || ''));
    const accountIdx = findColumnIndex(headers, ACCOUNT_HEADERS);
    const dateIdx = findColumnIndex(headers, DATE_HEADERS);
    const debitIdx = findColumnIndex(headers, DEBIT_HEADERS);
    const creditIdx = findColumnIndex(headers, CREDIT_HEADERS);
    const amountIdx = findColumnIndex(headers, AMOUNT_HEADERS);
    const hasAmountCol = debitIdx >= 0 || creditIdx >= 0 || amountIdx >= 0;
    if (accountIdx >= 0 && (dateIdx >= 0 || hasAmountCol)) {
      return rowsToGlLines(headers, rows.slice(i + 1));
    }
  }
  return null;
}

/**
 * Content-inferred G/L parser — the "intelligent" fallback.
 *
 * When the file has no header row we recognise (grouped Xero exports,
 * bespoke bank statements, anonymised CSVs, etc.) we scan the data
 * itself and pick out columns by shape:
 *
 *   - Date column: a column whose first-few rows parse as valid dates.
 *   - Account-code column: a column with short alphanumeric codes
 *     (2–6 chars) that repeat across many rows.
 *   - Debit + Credit pair: the adjacent pair with the highest
 *     "exactly-one-is-positive" XOR count — the signature of mutually
 *     exclusive Dr/Cr columns vs. running-balance / reference columns.
 *   - Signed-amount column: a single column with a healthy mix of
 *     positive and negative numbers (used when there's no Dr/Cr pair).
 *   - Description column: the widest text column near the data.
 *
 * This handles grouped reports (section headers, totals, blanks in
 * between transaction rows), unheadered CSVs, and anything else where
 * the columns are in a sensible order even if they aren't labelled.
 */
function parseGroupedReport(rows: any[][]): GlParseResult {
  const warnings: string[] = [];
  const lines: GlLine[] = [];

  const MAX_COL = 30;
  const MAX_SCAN = 500;

  // Step 1 — profile columns. For each column index we count how often
  // its value parses as a valid date and how often it matches the
  // account-code shape (short alphanumeric). The columns with the
  // strongest signal for each role become our (dateCol, codeCol)
  // candidates.
  const dateHits: Record<number, number> = {};
  const codeHits: Record<number, number> = {};
  const textHits: Record<number, number> = {};
  const textAvgLen: Record<number, number> = {};
  const textSeenLen: Record<number, number> = {};
  let profiledRows = 0;
  for (const row of rows) {
    if (!row || row.length < 2) continue;
    let sawAny = false;
    for (let c = 0; c < Math.min(row.length, MAX_COL); c++) {
      const v = row[c];
      if (v == null || v === '') continue;
      sawAny = true;
      if (parseDate(v)) dateHits[c] = (dateHits[c] || 0) + 1;
      const s = String(v).trim();
      if (/^\d{2,6}[a-z]?$/i.test(s)) codeHits[c] = (codeHits[c] || 0) + 1;
      if (/[a-z]{3,}/i.test(s)) {
        textHits[c] = (textHits[c] || 0) + 1;
        textAvgLen[c] = (textAvgLen[c] || 0) + s.length;
        textSeenLen[c] = (textSeenLen[c] || 0) + 1;
      }
    }
    if (sawAny) profiledRows++;
    if (profiledRows >= MAX_SCAN) break;
  }

  const dateCol = topColumn(dateHits);
  const codeCol = topColumn(codeHits, [dateCol]);

  if (dateCol < 0 && codeCol < 0) {
    return {
      lines: [],
      totalRows: rows.length,
      matchedColumns: { date: '', accountCode: '', amount: '' },
      warnings: [
        'Could not find an Account / Code column. Looked for: ' + ACCOUNT_HEADERS.slice(0, 6).join(', '),
        'Could not find a Date column. Will not be able to filter by period.',
        'Could not find any Amount column (Debit/Credit/Amount).',
      ],
    };
  }

  // Step 2 — find the Debit / Credit pair (or signed Amount column).
  // For every adjacent pair of numeric-looking columns we count:
  //   - xorCount: rows where exactly one of the pair is positive and
  //     the other is zero (the Dr/Cr signature).
  //   - bothPositive: rows where both have a positive value (reference /
  //     running-balance pairs).
  // We also track, for each single column, whether it carries mixed
  // positive + negative amounts (signed amount column).
  type PairScore = { xorCount: number; bothPositive: number };
  const pairScores: Record<string, PairScore> = {};
  const signedHits: Record<number, { pos: number; neg: number; zero: number }> = {};
  let txnCandidateCount = 0;
  for (const row of rows) {
    if (!row || row.length < 2) continue;
    const isTxn = (dateCol >= 0 ? !!parseDate(row[dateCol]) : true)
      && (codeCol >= 0 ? /^\d{2,6}[a-z]?$/i.test(String(row[codeCol] ?? '').trim()) : true);
    if (!isTxn) continue;
    txnCandidateCount++;

    for (let c = 0; c < Math.min(row.length, MAX_COL); c++) {
      if (c === dateCol || c === codeCol) continue;
      const v = parseAmount(row[c]);
      const s = signedHits[c] || { pos: 0, neg: 0, zero: 0 };
      if (v > 0) s.pos++; else if (v < 0) s.neg++; else s.zero++;
      signedHits[c] = s;

      if (c + 1 < Math.min(row.length, MAX_COL) && c + 1 !== dateCol && c + 1 !== codeCol) {
        const right = parseAmount(row[c + 1]);
        const leftPos = v > 0, rightPos = right > 0;
        const leftZero = v === 0, rightZero = right === 0;
        const key = `${c}:${c + 1}`;
        const ps = pairScores[key] || { xorCount: 0, bothPositive: 0 };
        if ((leftPos && rightZero) || (rightPos && leftZero)) ps.xorCount++;
        else if (leftPos && rightPos) ps.bothPositive++;
        pairScores[key] = ps;
      }
    }
    if (txnCandidateCount >= MAX_SCAN) break;
  }

  if (txnCandidateCount < 3) {
    return {
      lines: [],
      totalRows: rows.length,
      matchedColumns: { date: '', accountCode: '', amount: '' },
      warnings: [
        'Could not locate enough transaction-shaped rows to infer the column layout.',
      ],
    };
  }

  const rankedPairs = Object.entries(pairScores).map(([key, s]) => {
    const [a, b] = key.split(':').map(Number);
    return { a, b, ...s, score: s.xorCount - s.bothPositive };
  }).sort((x, y) => y.score - x.score || y.xorCount - x.xorCount);

  let debitCol = -1, creditCol = -1, signedAmountCol = -1;
  const top = rankedPairs[0];
  const XOR_THRESHOLD = Math.max(3, Math.floor(txnCandidateCount * 0.1));
  if (top && top.xorCount >= XOR_THRESHOLD && top.score > 0) {
    debitCol = top.a;
    creditCol = top.b;
  } else {
    // Fall back to a signed-amount column: the column with the best
    // mix of positive + negative values and fewest zeros. Gives us
    // something to work with for banking-style exports.
    const signedRanked = Object.entries(signedHits)
      .map(([c, v]) => ({ col: Number(c), ...v, mixScore: Math.min(v.pos, v.neg) * 2 - v.zero }))
      .sort((a, b) => b.mixScore - a.mixScore);
    if (signedRanked[0] && signedRanked[0].mixScore > 0) {
      signedAmountCol = signedRanked[0].col;
    }
  }

  if (debitCol < 0 && signedAmountCol < 0) {
    warnings.push('Could not identify any amount columns in the data — expected either a Debit + Credit pair or a signed Amount column.');
    return { lines: [], totalRows: rows.length, matchedColumns: { date: '', accountCode: '', amount: '' }, warnings };
  }

  // Step 3 — pick a description column. Prefer the widest-text column
  // that isn't already claimed. This is the human-readable narrative /
  // memo / reference.
  const descRanked = Object.entries(textHits)
    .filter(([c]) => {
      const col = Number(c);
      return col !== dateCol && col !== codeCol && col !== debitCol && col !== creditCol && col !== signedAmountCol;
    })
    .map(([c, hits]) => {
      const col = Number(c);
      const avg = (textAvgLen[col] || 0) / Math.max(1, textSeenLen[col] || 1);
      return { col, hits, avg, score: hits * avg };
    })
    .sort((a, b) => b.score - a.score);
  const descCol = descRanked[0]?.col ?? -1;

  // Step 4 — walk every row. For each transaction-shaped row, emit a
  // GlLine. Non-transaction rows (section headers, totals, net
  // movement, blanks) are skipped by the same date+code predicate.
  for (const row of rows) {
    if (!row || row.length < 2) continue;
    const d = dateCol >= 0 ? parseDate(row[dateCol]) : null;
    const code = codeCol >= 0 ? String(row[codeCol] ?? '').trim() : '';
    if (dateCol >= 0 && !d) continue;
    if (codeCol >= 0 && !/^\d{2,6}[a-z]?$/i.test(code)) continue;
    let amount = 0;
    if (debitCol >= 0 && creditCol >= 0) {
      amount = parseAmount(row[debitCol]) - parseAmount(row[creditCol]);
    } else if (signedAmountCol >= 0) {
      amount = parseAmount(row[signedAmountCol]);
    }
    if (amount === 0) continue;
    const description = descCol >= 0 ? (String(row[descCol] ?? '').trim() || null) : null;
    lines.push({ date: d, accountCode: code || 'UNKNOWN', description, amount });
  }

  const dateLabel = dateCol >= 0 ? `Column ${colIndexToLetter(dateCol)} (inferred)` : '';
  const codeLabel = codeCol >= 0 ? `Column ${colIndexToLetter(codeCol)} (inferred)` : '';
  const amountLabel = debitCol >= 0 && creditCol >= 0
    ? `Column ${colIndexToLetter(debitCol)} / ${colIndexToLetter(creditCol)} (inferred)`
    : signedAmountCol >= 0 ? `Column ${colIndexToLetter(signedAmountCol)} (inferred signed)` : '';

  return {
    lines,
    totalRows: rows.length,
    matchedColumns: { date: dateLabel, accountCode: codeLabel, amount: amountLabel },
    warnings,
  };
}

/** Pick the column index with the highest hit count, optionally skipping
 *  columns already claimed for another role. Returns -1 if the best
 *  column has zero hits. */
function topColumn(hits: Record<number, number>, exclude: number[] = []): number {
  let best = -1;
  let bestScore = 0;
  for (const [c, n] of Object.entries(hits)) {
    const col = Number(c);
    if (exclude.includes(col)) continue;
    if (n > bestScore) { bestScore = n; best = col; }
  }
  return bestScore > 0 ? best : -1;
}

function colIndexToLetter(idx: number): string {
  // 0 → A, 1 → B, 25 → Z, 26 → AA
  let n = idx;
  let s = '';
  while (n >= 0) {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
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
