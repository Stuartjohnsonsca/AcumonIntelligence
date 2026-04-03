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
  rows: Record<string, any>[];
  columns: string[];
  rowCount: number;
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
        parsedFiles.push({
          fileName: name,
          mimeType: mime,
          rows,
          columns,
          rowCount: rows.length,
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
