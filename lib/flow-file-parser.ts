/**
 * Flow File Parser
 *
 * Parses uploaded CSV/XLSX files from portal evidence uploads
 * for use in the flow execution engine.
 */

import { prisma } from '@/lib/db';
import { downloadBlob } from '@/lib/azure-blob';
import * as XLSX from 'xlsx';

interface ParsedFile {
  fileName: string;
  mimeType: string;
  rows: Record<string, any>[];          // Raw line items
  aggregatedRows: Record<string, any>[]; // Aggregated by invoice/document number
  columns: string[];
  rowCount: number;
  aggregatedCount: number;
}

/**
 * Find and parse evidence files uploaded in response to a portal request.
 * Returns parsed row data from CSV/XLSX files.
 */
export async function parsePortalResponseFiles(portalRequestId: string): Promise<ParsedFile[]> {
  // Find portal uploads linked to this portal request
  const uploads = await prisma.portalUpload.findMany({
    where: { portalRequestId },
    orderBy: { createdAt: 'desc' },
  });

  if (uploads.length === 0) return [];

  const parsedFiles: ParsedFile[] = [];

  for (const upload of uploads) {
    const mime = upload.mimeType || '';
    const name = upload.originalName || '';
    const isSpreadsheet = mime.includes('csv') || mime.includes('excel') || mime.includes('spreadsheet') ||
      name.endsWith('.csv') || name.endsWith('.xlsx') || name.endsWith('.xls');

    if (!isSpreadsheet) continue;
    if (!upload.storagePath || !upload.containerName) continue;

    try {
      const buffer = await downloadBlob(upload.storagePath, upload.containerName);

      let rows: Record<string, any>[] = [];
      let columns: string[] = [];

      if (name.endsWith('.csv') || mime.includes('csv')) {
        // Parse CSV
        const text = buffer.toString('utf-8');
        const result = parseCsv(text);
        rows = result.rows;
        columns = result.columns;
      } else {
        // Parse XLSX/XLS
        const workbook = XLSX.read(buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        if (sheetName) {
          const sheet = workbook.Sheets[sheetName];
          rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
          if (rows.length > 0) columns = Object.keys(rows[0]);
        }
      }

      if (rows.length > 0) {
        const aggregated = aggregateByInvoice(rows, columns);
        parsedFiles.push({
          fileName: name,
          mimeType: mime,
          rows,
          aggregatedRows: aggregated.rows,
          columns,
          rowCount: rows.length,
          aggregatedCount: aggregated.rows.length,
        });
      }
    } catch (err) {
      console.error(`[FlowFileParser] Failed to parse ${name}:`, err);
    }
  }

  return parsedFiles;
}

/**
 * Simple CSV parser — handles quoted fields and commas within quotes.
 */
function parseCsv(text: string): { rows: Record<string, any>[]; columns: string[] } {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return { rows: [], columns: [] };

  const columns = parseCsvLine(lines[0]);
  const rows: Record<string, any>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]);
    if (values.length === 0) continue;
    const row: Record<string, any> = {};
    columns.forEach((col, j) => {
      let val: any = values[j] || '';
      // Try to parse numbers
      const num = parseFloat(val.replace(/[,£$€]/g, ''));
      if (!isNaN(num) && val.trim() !== '') row[col] = num;
      else row[col] = val;
    });
    rows.push(row);
  }

  return { rows, columns };
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

/**
 * Aggregate line items by invoice/document number.
 * Detects the grouping column automatically, then sums amounts
 * and takes first values for non-numeric fields.
 */
function aggregateByInvoice(rows: Record<string, any>[], columns: string[]): { rows: Record<string, any>[]; groupColumn: string } {
  // Find the grouping column — invoice number first, then fallbacks
  // Priority: specific invoice columns first, generic references last
  const groupCandidates = [
    // High priority — specific invoice/document identifiers
    'InvoiceNumber', 'Invoice Number', 'InvoiceNo', 'Invoice No', 'Invoice',
    'DocumentNumber', 'Document Number', 'Doc No', 'DocRef', 'Doc Ref',
    'TransactionId', 'Transaction ID', 'TxnId',
    // Low priority — generic references (only used if specific ones not found)
    'Number', 'ID', 'Reference', 'Ref',
  ];
  let groupColumn = '';
  for (const candidate of groupCandidates) {
    const found = columns.find(c => c.toLowerCase() === candidate.toLowerCase());
    if (found) {
      const values = rows.map(r => r[found]);
      const unique = new Set(values).size;
      const nonEmpty = values.filter(v => v != null && String(v).trim() !== '').length;
      // Must actually group: fewer unique values than rows, but not TOO few
      // (e.g., 1-2 groups from 500 rows means it's a category, not an invoice number)
      // Good grouping: unique count is between 10% and 90% of row count
      const ratio = unique / rows.length;
      if (unique < rows.length && unique > 1 && nonEmpty > rows.length * 0.5 && ratio > 0.1 && ratio < 0.95) {
        groupColumn = found;
        break;
      }
    }
  }

  // If no grouping column found, or all values are unique (already at invoice level), return as-is
  if (!groupColumn) return { rows, groupColumn: '' };

  // Amount columns to sum
  const amountColumns = columns.filter(c =>
    /amount|total|gross|net|tax|lineamount|unitamount|subtotal|invoiceamountdue|invoiceamountpaid|taxtotal|taxamount/i.test(c)
  );
  // Quantity column
  const qtyColumns = columns.filter(c => /quantity|qty/i.test(c));

  // Group by the grouping column
  const groups = new Map<string, Record<string, any>[]>();
  for (const row of rows) {
    const key = String(row[groupColumn] || '');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }

  // Aggregate each group
  const aggregated: Record<string, any>[] = [];
  for (const [key, groupRows] of groups) {
    const agg: Record<string, any> = {};
    // Take first row's values for non-numeric fields
    for (const col of columns) {
      agg[col] = groupRows[0][col];
    }
    // Sum amount columns across all rows in the group
    for (const col of amountColumns) {
      agg[col] = groupRows.reduce((sum, r) => sum + (parseFloat(String(r[col] || 0)) || 0), 0);
    }
    // Sum quantities
    for (const col of qtyColumns) {
      agg[col] = groupRows.reduce((sum, r) => sum + (parseFloat(String(r[col] || 0)) || 0), 0);
    }
    // Add line count
    agg._lineItemCount = groupRows.length;
    // Build description from all line descriptions
    const descs = groupRows.map(r => r.Description || r.Desc || '').filter(Boolean);
    if (descs.length > 1) {
      agg._allDescriptions = descs.join('; ');
    }
    aggregated.push(agg);
  }

  return { rows: aggregated, groupColumn };
}
