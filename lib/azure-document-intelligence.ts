/**
 * Azure Document Intelligence — fast OCR for bank statements.
 * Processes entire PDFs (text + scanned) in seconds, returns structured data.
 *
 * Env vars required:
 *   AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT — e.g. https://xxx.cognitiveservices.azure.com/
 *   AZURE_DOCUMENT_INTELLIGENCE_KEY — API key
 */

import type { BankStatementResult } from '@/lib/ai-extractor';

const ENDPOINT = process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT || '';
const API_KEY = process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY || '';

export function isAzureDIConfigured(): boolean {
  return !!(ENDPOINT && API_KEY);
}

/**
 * Extract bank statement transactions from a PDF using Azure Document Intelligence.
 * Uses the "prebuilt-layout" model which extracts tables, text, and structure.
 * Returns the same BankStatementResult format as the AI vision extractor.
 */
export async function extractBankStatementWithAzureDI(
  pdfBuffer: Buffer,
  fileName: string,
): Promise<BankStatementResult> {
  if (!ENDPOINT || !API_KEY) {
    throw new Error('Azure Document Intelligence not configured. Set AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT and AZURE_DOCUMENT_INTELLIGENCE_KEY.');
  }

  const startTime = Date.now();
  console.log(`[AzureDI] Starting analysis: ${fileName} (${(pdfBuffer.length / 1024).toFixed(0)}KB)`);

  // Start the analysis
  const analyzeUrl = `${ENDPOINT.replace(/\/$/, '')}/documentintelligence/documentModels/prebuilt-layout:analyze?api-version=2024-11-30`;

  const startRes = await fetch(analyzeUrl, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': API_KEY,
      'Content-Type': 'application/pdf',
    },
    body: pdfBuffer,
  });

  if (!startRes.ok) {
    const errBody = await startRes.text();
    throw new Error(`Azure DI analysis failed (${startRes.status}): ${errBody.substring(0, 200)}`);
  }

  // Get the operation URL from the response header
  const operationUrl = startRes.headers.get('operation-location');
  if (!operationUrl) {
    throw new Error('Azure DI did not return operation-location header');
  }

  // Poll for completion
  let result: any = null;
  for (let attempt = 0; attempt < 60; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 2000));

    const pollRes = await fetch(operationUrl, {
      headers: { 'Ocp-Apim-Subscription-Key': API_KEY },
    });

    if (!pollRes.ok) continue;
    const pollData = await pollRes.json();

    if (pollData.status === 'succeeded') {
      result = pollData.analyzeResult;
      break;
    } else if (pollData.status === 'failed') {
      throw new Error(`Azure DI analysis failed: ${JSON.stringify(pollData.error || {}).substring(0, 200)}`);
    }
    // status === 'running' — keep polling
  }

  if (!result) {
    throw new Error('Azure DI analysis timed out after 120 seconds');
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[AzureDI] Analysis complete in ${elapsed}s: ${result.pages?.length || 0} pages, ${result.tables?.length || 0} tables`);

  // Parse the results into transactions
  return parseAzureDIResult(result, fileName);
}

/**
 * Parse Azure DI layout result into BankStatementResult.
 * Looks for tables first (most reliable), falls back to text parsing.
 */
function parseAzureDIResult(result: any, fileName: string): BankStatementResult {
  const transactions: BankStatementResult['transactions'] = [];
  let bankName: string | null = null;
  let sortCode: string | null = null;
  let accountNumber: string | null = null;
  let statementDate: string | null = null;
  let openingBalance: number | null = null;
  let closingBalance: number | null = null;
  let currency: string | null = null;

  // Extract key-value pairs and text for metadata
  const fullText = (result.content || '').substring(0, 5000);

  // Try to extract metadata from text
  const sortCodeMatch = fullText.match(/sort\s*code[:\s]*(\d{2}[-\s]?\d{2}[-\s]?\d{2})/i);
  if (sortCodeMatch) sortCode = sortCodeMatch[1].replace(/\s/g, '');
  const accountMatch = fullText.match(/account\s*(?:number|no)[:\s]*(\d{6,10})/i);
  if (accountMatch) accountNumber = accountMatch[1];
  const bankMatch = fullText.match(/(barclays|natwest|hsbc|lloyds|metro\s*bank|santander|nationwide|rbs|tsb|virgin\s*money|monzo|starling|revolut|tide|modulr)/i);
  if (bankMatch) bankName = bankMatch[1];

  // Extract from tables (most reliable for transaction data)
  if (result.tables && result.tables.length > 0) {
    for (const table of result.tables) {
      const headers = extractTableHeaders(table);
      if (!looksLikeTransactionTable(headers)) continue;

      const colMap = mapColumns(headers);
      if (!colMap.date && !colMap.description) continue;

      // Extract rows
      const maxRow = Math.max(...table.cells.map((c: any) => c.rowIndex));
      for (let ri = 1; ri <= maxRow; ri++) { // Skip header row
        const cells = table.cells.filter((c: any) => c.rowIndex === ri);
        const getCell = (col: number) => cells.find((c: any) => c.columnIndex === col)?.content?.trim() || '';

        const dateStr = colMap.date !== undefined ? getCell(colMap.date) : '';
        const desc = colMap.description !== undefined ? getCell(colMap.description) : '';
        const ref = colMap.reference !== undefined ? getCell(colMap.reference) : '';
        const debitStr = colMap.debit !== undefined ? getCell(colMap.debit) : '';
        const creditStr = colMap.credit !== undefined ? getCell(colMap.credit) : '';
        const balanceStr = colMap.balance !== undefined ? getCell(colMap.balance) : '';

        if (!dateStr && !desc) continue; // Skip empty rows

        transactions.push({
          date: parseDate(dateStr),
          description: desc,
          reference: ref,
          debit: parseAmount(debitStr),
          credit: parseAmount(creditStr),
          balance: parseAmount(balanceStr),
        });
      }
    }
  }

  // If no table extraction worked, fall back to line-by-line text parsing
  if (transactions.length === 0 && result.content) {
    console.log(`[AzureDI] No tables found, falling back to text parsing for ${fileName}`);
    const lines = result.content.split('\n');
    for (const line of lines) {
      const txn = parseTransactionLine(line);
      if (txn) transactions.push(txn);
    }
  }

  // Try to get opening/closing balance from text
  const openMatch = fullText.match(/(?:opening|brought\s*forward|b\/f)\s*(?:balance)?[:\s]*([£$€]?\s*[\d,]+\.?\d*)/i);
  if (openMatch) openingBalance = parseAmount(openMatch[1]);
  const closeMatch = fullText.match(/(?:closing|carried\s*forward|c\/f)\s*(?:balance)?[:\s]*([£$€]?\s*[\d,]+\.?\d*)/i);
  if (closeMatch) closingBalance = parseAmount(closeMatch[1]);

  // Detect currency
  if (fullText.includes('£') || fullText.toLowerCase().includes('gbp')) currency = 'GBP';
  else if (fullText.includes('$') || fullText.toLowerCase().includes('usd')) currency = 'USD';
  else if (fullText.includes('€') || fullText.toLowerCase().includes('eur')) currency = 'EUR';

  console.log(`[AzureDI] Parsed ${transactions.length} transactions from ${fileName}`);

  return {
    bankName,
    sortCode,
    accountNumber,
    statementDate,
    statementPage: null,
    openingBalance,
    closingBalance,
    currency,
    transactions,
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, model: 'azure-di-prebuilt-layout', costUsd: 0 },
  };
}

// ─── Helper functions ───

function extractTableHeaders(table: any): string[] {
  return table.cells
    .filter((c: any) => c.rowIndex === 0)
    .sort((a: any, b: any) => a.columnIndex - b.columnIndex)
    .map((c: any) => (c.content || '').toLowerCase().trim());
}

function looksLikeTransactionTable(headers: string[]): boolean {
  const joined = headers.join(' ');
  return (joined.includes('date') || joined.includes('transaction')) &&
    (joined.includes('debit') || joined.includes('credit') || joined.includes('amount') || joined.includes('balance'));
}

function mapColumns(headers: string[]): { date?: number; description?: number; reference?: number; debit?: number; credit?: number; balance?: number; amount?: number } {
  const map: any = {};
  headers.forEach((h, i) => {
    if (h.includes('date')) map.date = i;
    else if (h.includes('description') || h.includes('transaction') || h.includes('details') || h.includes('narrative') || h.includes('particular')) map.description = i;
    else if (h.includes('reference') || h.includes('ref')) map.reference = i;
    else if (h.includes('debit') || h.includes('payment') || h.includes('money out') || h.includes('withdrawal')) map.debit = i;
    else if (h.includes('credit') || h.includes('receipt') || h.includes('money in') || h.includes('deposit')) map.credit = i;
    else if (h.includes('balance')) map.balance = i;
    else if (h.includes('amount')) map.amount = i;
  });
  return map;
}

function parseAmount(str: string): number {
  if (!str) return 0;
  const cleaned = str.replace(/[£$€,\s]/g, '').replace(/[()]/g, m => m === '(' ? '-' : '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

function parseDate(str: string): string {
  if (!str) return '';
  // Try DD/MM/YYYY or DD-MM-YYYY
  const ukMatch = str.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (ukMatch) {
    const [, d, m, y] = ukMatch;
    const year = y.length === 2 ? `20${y}` : y;
    return `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  // Try DD Mon YYYY
  const monthNames: Record<string, string> = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
  const namedMatch = str.match(/(\d{1,2})\s*(\w{3})\s*(\d{2,4})/i);
  if (namedMatch) {
    const [, d, mon, y] = namedMatch;
    const m = monthNames[mon.toLowerCase().substring(0, 3)];
    if (m) {
      const year = y.length === 2 ? `20${y}` : y;
      return `${year}-${m}-${d.padStart(2, '0')}`;
    }
  }
  return str;
}

function parseTransactionLine(line: string): { date: string; description: string; reference: string; debit: number; credit: number; balance: number } | null {
  // Try to match: DATE DESCRIPTION AMOUNT [BALANCE]
  const match = line.match(/^(\d{1,2}[\/\-]\w{2,3}[\/\-]?\d{0,4})\s+(.+?)\s+([\d,]+\.\d{2})\s*([\d,]+\.\d{2})?$/);
  if (!match) return null;
  const [, dateStr, desc, amt1, amt2] = match;
  return {
    date: parseDate(dateStr),
    description: desc.trim(),
    reference: '',
    debit: parseAmount(amt1),
    credit: 0,
    balance: amt2 ? parseAmount(amt2) : 0,
  };
}
