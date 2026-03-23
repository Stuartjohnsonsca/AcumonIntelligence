import { prisma } from '@/lib/db';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ParsedAccount {
  accountCode: string;
  accountName: string;
  categoryType: string;
  sortOrder?: number;
}

const VALID_CATEGORY_TYPES = [
  'Fixed Asset', 'Investment', 'Current Asset', 'Current Liability',
  'Long-term Liability', 'Equity', 'Revenue', 'Direct Costs',
  'Overheads', 'Other Income', 'Tax Charge', 'Distribution',
];

// ─── Parse taxonomy file (CSV or JSON) ──────────────────────────────────────

export async function parseTaxonomyFile(buffer: Buffer, mimeType: string): Promise<ParsedAccount[]> {
  const text = buffer.toString('utf-8');

  if (mimeType === 'application/json' || mimeType.includes('json')) {
    return parseJsonTaxonomy(text);
  }

  if (mimeType === 'text/csv' || mimeType.includes('csv')) {
    return parseCsvTaxonomy(text);
  }

  if (mimeType.includes('spreadsheet') || mimeType.includes('excel') || mimeType.includes('xlsx')) {
    return parseXlsxTaxonomy(buffer);
  }

  throw new Error(`Unsupported file type: ${mimeType}`);
}

// ─── Parse JSON ─────────────────────────────────────────────────────────────

function parseJsonTaxonomy(text: string): ParsedAccount[] {
  const data = JSON.parse(text);
  const arr = Array.isArray(data) ? data : (data.accounts || data.chartOfAccounts || []);

  return arr
    .filter((item: Record<string, unknown>) => item.accountCode && item.accountName)
    .map((item: Record<string, unknown>, idx: number) => ({
      accountCode: String(item.accountCode).trim(),
      accountName: String(item.accountName).trim(),
      categoryType: normaliseCategoryType(String(item.categoryType || item.category || 'Overheads')),
      sortOrder: typeof item.sortOrder === 'number' ? item.sortOrder : idx,
    }));
}

// ─── Parse CSV ──────────────────────────────────────────────────────────────

function parseCsvTaxonomy(text: string): ParsedAccount[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length === 0) return [];

  // Detect if first row is a header
  const firstLine = lines[0].toLowerCase();
  const hasHeader = firstLine.includes('accountcode') || firstLine.includes('account_code') || firstLine.includes('code');
  const dataLines = hasHeader ? lines.slice(1) : lines;

  const results: ParsedAccount[] = [];
  dataLines.forEach((line, idx) => {
    const parts = parseCSVLine(line);
    if (parts.length < 2) return;
    const code = parts[0].trim();
    const name = parts[1].trim();
    if (!code || !name) return;
    results.push({
      accountCode: code,
      accountName: name,
      categoryType: normaliseCategoryType(parts[2]?.trim() || 'Overheads'),
      sortOrder: idx,
    });
  });
  return results;
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if (ch === ',' && !inQuotes) { result.push(current); current = ''; continue; }
    current += ch;
  }
  result.push(current);
  return result;
}

// ─── Parse XLSX (basic — reads first sheet) ─────────────────────────────────

async function parseXlsxTaxonomy(buffer: Buffer): Promise<ParsedAccount[]> {
  try {
    // Dynamic import — xlsx may not be installed; fall back to CSV if missing
    // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
    const XLSX = require('xlsx');
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows: Record<string, string>[] = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    return rows
      .filter(row => {
        const code = row.accountCode || row.AccountCode || row.account_code || row.Code || row.code || '';
        return code.trim() !== '';
      })
      .map((row, idx) => {
        const code = row.accountCode || row.AccountCode || row.account_code || row.Code || row.code || '';
        const name = row.accountName || row.AccountName || row.account_name || row.Name || row.name || '';
        const cat = row.categoryType || row.CategoryType || row.category_type || row.Category || row.category || 'Overheads';
        return {
          accountCode: String(code).trim(),
          accountName: String(name).trim(),
          categoryType: normaliseCategoryType(String(cat).trim()),
          sortOrder: idx,
        };
      });
  } catch {
    throw new Error('Failed to parse XLSX file. Ensure the file has columns: accountCode, accountName, categoryType');
  }
}

// ─── Parse from URL endpoint ────────────────────────────────────────────────

export async function parseTaxonomyFromUrl(url: string): Promise<ParsedAccount[]> {
  const response = await fetch(url, {
    headers: { Accept: 'application/json, text/csv' },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error(`Endpoint returned ${response.status}: ${response.statusText}`);
  }

  const contentType = response.headers.get('content-type') || '';
  const text = await response.text();

  if (contentType.includes('json')) {
    return parseJsonTaxonomy(text);
  }
  if (contentType.includes('csv')) {
    return parseCsvTaxonomy(text);
  }

  // Try JSON first, fall back to CSV
  try {
    return parseJsonTaxonomy(text);
  } catch {
    return parseCsvTaxonomy(text);
  }
}

// ─── Upsert parsed accounts into the database ──────────────────────────────

export async function upsertTaxonomyToDb(
  firmId: string,
  accounts: ParsedAccount[],
): Promise<{ created: number; updated: number }> {
  let created = 0;
  let updated = 0;

  for (const account of accounts) {
    const result = await prisma.firmChartOfAccount.upsert({
      where: {
        firmId_accountCode: { firmId, accountCode: account.accountCode },
      },
      create: {
        firmId,
        accountCode: account.accountCode,
        accountName: account.accountName,
        categoryType: account.categoryType,
        sortOrder: account.sortOrder || 0,
      },
      update: {
        accountName: account.accountName,
        categoryType: account.categoryType,
        sortOrder: account.sortOrder || 0,
      },
    });

    // Check if it was a create or update by comparing dates
    if (result.createdAt.getTime() === result.updatedAt.getTime()) {
      created++;
    } else {
      updated++;
    }
  }

  // Update firm timestamp
  await prisma.firm.update({
    where: { id: firmId },
    data: { chartOfAccountsUpdatedAt: new Date() },
  });

  return { created, updated };
}

// ─── Normalise category type ────────────────────────────────────────────────

function normaliseCategoryType(input: string): string {
  if (!input) return 'Overheads';

  // Exact match
  const exact = VALID_CATEGORY_TYPES.find(t => t.toLowerCase() === input.toLowerCase());
  if (exact) return exact;

  // Fuzzy match
  const lower = input.toLowerCase();
  if (lower.includes('fixed') && lower.includes('asset')) return 'Fixed Asset';
  if (lower.includes('investment')) return 'Investment';
  if (lower.includes('current') && lower.includes('asset')) return 'Current Asset';
  if (lower.includes('current') && lower.includes('liab')) return 'Current Liability';
  if (lower.includes('long') && lower.includes('liab')) return 'Long-term Liability';
  if (lower.includes('equity') || lower.includes('capital')) return 'Equity';
  if (lower.includes('revenue') || lower.includes('income') || lower.includes('sales')) return 'Revenue';
  if (lower.includes('direct') || lower.includes('cost of')) return 'Direct Costs';
  if (lower.includes('overhead') || lower.includes('admin') || lower.includes('expense')) return 'Overheads';
  if (lower.includes('other') && lower.includes('income')) return 'Other Income';
  if (lower.includes('tax')) return 'Tax Charge';
  if (lower.includes('distribut') || lower.includes('dividend')) return 'Distribution';

  return 'Overheads'; // Default fallback
}
