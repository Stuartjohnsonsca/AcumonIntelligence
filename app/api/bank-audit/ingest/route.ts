import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import OpenAI from 'openai';

export const maxDuration = 300;

const EXTRACTION_PROMPT = `You are an expert bank statement data extractor. The text below was extracted from a PDF bank statement. The text may be jumbled because PDF table layouts extract imperfectly — column values may appear out of order or on separate lines. Your job is to intelligently reconstruct the transactions.

For each transaction, extract:
- date: The transaction date (format: YYYY-MM-DD)
- description: The transaction description/narrative
- reference: Any reference number (or empty string if none)
- debit: The debit/payment amount as a number (0 if credit)
- credit: The credit/receipt amount as a number (0 if debit)
- balance: The running balance after this transaction (0 if not shown)

Also extract the following statement-level metadata:
- bankName: Name of the bank (e.g. "NatWest", "HSBC", "Barclays")
- sortCode: The sort code shown on the statement (e.g. "12-34-56")
- accountNumber: The account number shown on the statement
- accountName: Account holder name
- statementDate: The date or period of the statement (format: YYYY-MM-DD)
- statementPage: The page number if shown (e.g. "1", "2", "1 of 3")
- currency: GBP/USD/EUR etc
- openingBalance: The opening/brought forward balance as a number
- closingBalance: The closing/carried forward balance as a number

Return ONLY valid JSON in this exact format:
{
  "bankName": "Name of the bank",
  "sortCode": "12-34-56",
  "accountNumber": "12345678",
  "accountName": "Account holder name",
  "statementDate": "2025-01-31",
  "statementPage": "1",
  "currency": "GBP",
  "openingBalance": 5000.00,
  "closingBalance": 7350.00,
  "transactions": [
    {"date": "2025-01-15", "description": "Direct Debit - Electric Co", "reference": "DD123", "debit": 150.00, "credit": 0, "balance": 4850.00},
    {"date": "2025-01-16", "description": "Bank Transfer - Client Payment", "reference": "FP456", "debit": 0, "credit": 2500.00, "balance": 7350.00}
  ]
}

CRITICAL RULES:
- Extract EVERY transaction, do not skip any
- Amounts must be numbers, not strings (no commas in numbers)
- If a transaction is a payment/debit, put the amount in "debit" and 0 in "credit"
- If a transaction is a receipt/credit, put the amount in "credit" and 0 in "debit"
- Dates must be in YYYY-MM-DD format
- If the year is not shown on each line, infer it from the statement period
- The text may be garbled from PDF extraction — look for patterns: dates, amounts, descriptions
- If amounts have commas (e.g. "1,234.56"), convert to plain numbers (1234.56)
- If you see columns like "Money In" / "Money Out" or "Paid In" / "Paid Out", map these to credit/debit
- If balance is not shown per-transaction, set it to 0
- The bankName, sortCode, accountNumber MUST be extracted from the header/top of the statement
- If a page number is visible, extract it into statementPage`;

// Helper: extract text from a PDF buffer using multiple fallback methods
async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  let extractedText = '';

  // Attempt 1: unpdf
  try {
    const { extractText } = await import('unpdf');
    const pdfData = new Uint8Array(buffer);
    const result = await extractText(pdfData);
    const pages = Array.isArray(result.text) ? result.text : [String(result.text || '')];
    extractedText = pages.join('\n\n--- PAGE BREAK ---\n\n');
    console.log('[BankAudit] unpdf extracted', extractedText.length, 'chars');
  } catch (e1) {
    console.warn('[BankAudit] unpdf failed:', e1 instanceof Error ? e1.message : String(e1));
  }

  // Attempt 2: pdfjs-dist if unpdf returned too little
  if (extractedText.length < 10) {
    try {
      const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
      const pages: string[] = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        const pageText = content.items
          .map((item: unknown) => (item as { str?: string }).str || '')
          .join(' ');
        pages.push(pageText);
      }
      extractedText = pages.join('\n\n--- PAGE BREAK ---\n\n');
      await doc.destroy();
      console.log('[BankAudit] pdfjs-dist extracted', extractedText.length, 'chars');
    } catch (e2) {
      console.warn('[BankAudit] pdfjs-dist failed:', e2 instanceof Error ? e2.message : String(e2));
    }
  }

  return extractedText;
}

// Helper: call AI for extraction
async function callAI(
  client: OpenAI,
  prompt: string,
  model = 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
  maxTokens = 16000
): Promise<string> {
  try {
    const result = await client.chat.completions.create({
      model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: maxTokens,
      temperature: 0.1,
    });
    let content = result.choices?.[0]?.message?.content?.trim() || '';
    content = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    return content;
  } catch (err) {
    console.warn('[BankAudit] AI call failed:', err instanceof Error ? err.message : String(err));
    return '';
  }
}

// Helper: call vision model for scanned/image PDFs
async function callVisionAI(
  client: OpenAI,
  base64Data: string,
  mimeType: string,
  prompt: string
): Promise<string> {
  try {
    const result = await client.chat.completions.create({
      model: 'meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Data}` } },
        ],
      }],
      max_tokens: 8000,
      temperature: 0.1,
    });
    let content = result.choices?.[0]?.message?.content?.trim() || '';
    content = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    return content;
  } catch (err) {
    console.warn('[BankAudit] Vision AI call failed:', err instanceof Error ? err.message : String(err));
    return '';
  }
}

// Helper: parse JSON from AI response
function parseAIJson(content: string): Record<string, unknown> | null {
  if (!content) return null;
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    console.warn('[BankAudit] Failed to parse AI JSON');
    return null;
  }
}

// Extract transactions from a single PDF file
async function extractFromPdf(
  client: OpenAI,
  buffer: Buffer,
  fileName: string
): Promise<{ metadata: Record<string, unknown>; transactions: Record<string, unknown>[] }> {
  console.log(`[BankAudit] Extracting from PDF: ${fileName} (${buffer.length} bytes)`);

  const extractedText = await extractTextFromPdf(buffer);

  if (extractedText.length >= 10) {
    // Text-based PDF — use text extraction + LLM
    console.log(`[BankAudit] Text-mode extraction for ${fileName}: ${extractedText.length} chars`);

    const maxChunkSize = 20000;
    const chunks: string[] = [];
    for (let i = 0; i < extractedText.length; i += maxChunkSize) {
      chunks.push(extractedText.slice(i, i + maxChunkSize));
    }

    const allTransactions: Record<string, unknown>[] = [];
    let metadata: Record<string, unknown> = {};

    if (chunks.length === 1) {
      const response = await callAI(client, `${EXTRACTION_PROMPT}\n\n--- BANK STATEMENT TEXT ---\n${chunks[0]}`);
      const parsed = parseAIJson(response);
      if (parsed) {
        metadata = { ...parsed };
        delete metadata.transactions;
        if (Array.isArray(parsed.transactions)) {
          allTransactions.push(...(parsed.transactions as Record<string, unknown>[]));
        }
      }
    } else {
      // Process chunks in parallel
      const chunkPromises = chunks.map((chunk, ci) => {
        const chunkPrompt = ci === 0
          ? `${EXTRACTION_PROMPT}\n\n--- BANK STATEMENT TEXT (part ${ci + 1} of ${chunks.length}) ---\n${chunk}`
          : `Extract ALL transactions from this bank statement text continuation. Also extract bankName, sortCode, accountNumber, statementDate, statementPage if visible. Return ONLY valid JSON: {"transactions": [...]} with each transaction having date (YYYY-MM-DD), description, reference, debit (number), credit (number), balance (number).\n\n--- BANK STATEMENT TEXT (part ${ci + 1} of ${chunks.length}) ---\n${chunk}`;
        return callAI(client, chunkPrompt);
      });

      const results = await Promise.all(chunkPromises);

      for (let ci = 0; ci < results.length; ci++) {
        const parsed = parseAIJson(results[ci]);
        if (parsed) {
          if (ci === 0) {
            metadata = { ...parsed };
            delete metadata.transactions;
          }
          if (Array.isArray(parsed.transactions)) {
            allTransactions.push(...(parsed.transactions as Record<string, unknown>[]));
          }
        }
      }
    }

    console.log(`[BankAudit] Text extraction complete for ${fileName}: ${allTransactions.length} transactions`);
    return { metadata, transactions: allTransactions };
  } else {
    // Scanned/image PDF — use vision model page by page
    console.log(`[BankAudit] Vision-mode extraction for ${fileName} (text too short: ${extractedText.length} chars)`);

    try {
      const { PDFDocument } = await import('pdf-lib');
      const pdfDoc = await PDFDocument.load(buffer);
      const pageCount = pdfDoc.getPageCount();
      const maxPages = Math.min(pageCount, 10); // Allow up to 10 pages

      const allTransactions: Record<string, unknown>[] = [];
      let metadata: Record<string, unknown> = {};

      for (let pi = 0; pi < maxPages; pi++) {
        const singlePageDoc = await PDFDocument.create();
        const [copiedPage] = await singlePageDoc.copyPages(pdfDoc, [pi]);
        singlePageDoc.addPage(copiedPage);
        const singlePageBytes = await singlePageDoc.save();
        const base64Pdf = Buffer.from(singlePageBytes).toString('base64');

        const visionPrompt = pi === 0
          ? EXTRACTION_PROMPT
          : `Continue extracting transactions from this bank statement page (page ${pi + 1}). Extract bankName, sortCode, accountNumber, statementDate, statementPage if visible. Return JSON: {"bankName":"...","sortCode":"...","accountNumber":"...","statementDate":"...","statementPage":"${pi + 1}","transactions":[...]} with each transaction having date, description, reference, debit, credit, balance.`;

        const response = await callVisionAI(client, base64Pdf, 'application/pdf', visionPrompt);
        const parsed = parseAIJson(response);

        if (parsed) {
          if (pi === 0) {
            metadata = { ...parsed };
            delete metadata.transactions;
          }
          if (Array.isArray(parsed.transactions)) {
            allTransactions.push(...(parsed.transactions as Record<string, unknown>[]));
          }
        }
      }

      console.log(`[BankAudit] Vision extraction complete for ${fileName}: ${allTransactions.length} transactions from ${maxPages} pages`);
      return { metadata, transactions: allTransactions };
    } catch (err) {
      console.error(`[BankAudit] Vision extraction failed for ${fileName}:`, err instanceof Error ? err.message : String(err));
      return { metadata: {}, transactions: [] };
    }
  }
}

// Extract from an image file (JPG, PNG, etc.) using vision model
async function extractFromImage(
  client: OpenAI,
  buffer: Buffer,
  mimeType: string,
  fileName: string
): Promise<{ metadata: Record<string, unknown>; transactions: Record<string, unknown>[] }> {
  console.log(`[BankAudit] Extracting from image: ${fileName} (${buffer.length} bytes)`);

  const base64Data = buffer.toString('base64');
  const response = await callVisionAI(client, base64Data, mimeType, EXTRACTION_PROMPT);
  const parsed = parseAIJson(response);

  if (parsed) {
    const metadata = { ...parsed };
    delete metadata.transactions;
    const transactions = Array.isArray(parsed.transactions) ? parsed.transactions as Record<string, unknown>[] : [];
    console.log(`[BankAudit] Image extraction complete for ${fileName}: ${transactions.length} transactions`);
    return { metadata, transactions };
  }

  return { metadata: {}, transactions: [] };
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  try {
    const apiKey = process.env.TOGETHER_DOC_SUMMARY_KEY || process.env.TOGETHER_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'AI extraction service not configured (TOGETHER_API_KEY missing)' }, { status: 500 });
    }
    const aiClient = new OpenAI({ apiKey, baseURL: 'https://api.together.xyz/v1' });

    const contentType = req.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
      // Import from accounting system
      const { sessionId, source, clientId, fromDate, toDate } = await req.json();
      if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 });

      const auditSession = await prisma.bankAuditSession.findUnique({ where: { id: sessionId } });
      if (!auditSession || auditSession.userId !== session.user.id) {
        return NextResponse.json({ error: 'Session not found' }, { status: 404 });
      }

      if (source === 'import') {
        const conn = await prisma.accountingConnection.findFirst({
          where: { clientId },
        });

        if (!conn) {
          return NextResponse.json({ error: 'No accounting connection found' }, { status: 400 });
        }

        // TODO: Implement actual Xero bank transaction fetch using conn.accessToken
        const transactions = [
          { date: fromDate, description: 'Placeholder - Xero import not yet implemented', debit: 0, credit: 0, bankName: '', sortCode: '', accountNumber: '' },
        ];

        await prisma.bankAuditSession.update({
          where: { id: sessionId },
          data: { dataSource: 'import', bankData: transactions as unknown as never },
        });

        return NextResponse.json({ transactions });
      }

      return NextResponse.json({ error: 'Unknown source' }, { status: 400 });
    }

    // File upload (FormData)
    const formData = await req.formData();
    const sessionId = formData.get('sessionId') as string;
    const source = formData.get('source') as string;

    if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 });

    const auditSession = await prisma.bankAuditSession.findUnique({ where: { id: sessionId } });
    if (!auditSession || auditSession.userId !== session.user.id) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    if (source === 'upload') {
      const file = formData.get('file') as File | null;
      if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });

      const buffer = Buffer.from(await file.arrayBuffer());

      // Parse CSV/XLSX
      let transactions: Record<string, unknown>[] = [];
      if (file.name.toLowerCase().endsWith('.csv')) {
        const text = buffer.toString('utf-8');
        const lines = text.split('\n').filter(l => l.trim());
        if (lines.length > 1) {
          const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
          transactions = lines.slice(1).map(line => {
            const vals = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
            const row: Record<string, unknown> = {};
            headers.forEach((h, i) => { row[h] = vals[i] || ''; });
            return row;
          });
        }
      } else {
        // XLSX — use AI to extract if we can't parse natively
        // For now try to use the text content
        const text = buffer.toString('utf-8');
        if (text.includes(',') || text.includes('\t')) {
          const delimiter = text.includes('\t') ? '\t' : ',';
          const lines = text.split('\n').filter(l => l.trim());
          if (lines.length > 1) {
            const headers = lines[0].split(delimiter).map(h => h.trim().replace(/^"|"$/g, ''));
            transactions = lines.slice(1).map(line => {
              const vals = line.split(delimiter).map(v => v.trim().replace(/^"|"$/g, ''));
              const row: Record<string, unknown> = {};
              headers.forEach((h, i) => { row[h] = vals[i] || ''; });
              return row;
            });
          }
        }
      }

      await prisma.bankAuditSession.update({
        where: { id: sessionId },
        data: { dataSource: 'upload', bankData: transactions as unknown as never },
      });

      await prisma.bankAuditFile.create({
        data: {
          sessionId,
          fileName: file.name,
          blobPath: `bank-audit/${sessionId}/${file.name}`,
          container: 'bank-audit',
          fileType: file.name.endsWith('.csv') ? 'csv' : 'xlsx',
          status: 'completed',
          progress: 100,
        },
      });

      return NextResponse.json({ transactions });
    }

    if (source === 'extract') {
      const files = formData.getAll('files') as File[];
      if (!files.length) return NextResponse.json({ error: 'No files provided' }, { status: 400 });

      console.log(`[BankAudit] Starting extraction of ${files.length} files`);

      // Create file records with 'extracting' status
      const fileRecords: { id: string; fileName: string }[] = [];
      for (const file of files) {
        const record = await prisma.bankAuditFile.create({
          data: {
            sessionId,
            fileName: file.name,
            blobPath: `bank-audit/${sessionId}/${file.name}`,
            container: 'bank-audit',
            fileType: file.type.includes('pdf') ? 'pdf' : 'image',
            status: 'extracting',
            progress: 10,
          },
        });
        fileRecords.push(record);
      }

      // Extract from each file in parallel
      const allTransactions: Record<string, unknown>[] = [];
      const extractionPromises = files.map(async (file, idx) => {
        const buffer = Buffer.from(await file.arrayBuffer());
        const isPdf = file.name.toLowerCase().endsWith('.pdf') || file.type.includes('pdf');
        const mimeType = file.type || (isPdf ? 'application/pdf' : 'image/jpeg');

        // Update progress to 30%
        await prisma.bankAuditFile.update({
          where: { id: fileRecords[idx].id },
          data: { progress: 30 },
        });

        let result: { metadata: Record<string, unknown>; transactions: Record<string, unknown>[] };

        if (isPdf) {
          result = await extractFromPdf(aiClient, buffer, file.name);
        } else {
          result = await extractFromImage(aiClient, buffer, mimeType, file.name);
        }

        // Update progress to 80%
        await prisma.bankAuditFile.update({
          where: { id: fileRecords[idx].id },
          data: { progress: 80 },
        });

        // Attach metadata to each transaction row
        const txnsWithMeta = result.transactions.map(t => ({
          ...t,
          bankName: t.bankName || result.metadata.bankName || '',
          sortCode: t.sortCode || result.metadata.sortCode || '',
          accountNumber: t.accountNumber || result.metadata.accountNumber || '',
          statementDate: t.statementDate || result.metadata.statementDate || '',
          statementPage: t.statementPage || result.metadata.statementPage || '',
          sourceFile: file.name,
        }));

        // Mark file complete
        await prisma.bankAuditFile.update({
          where: { id: fileRecords[idx].id },
          data: { status: 'completed', progress: 100 },
        });

        return txnsWithMeta;
      });

      const results = await Promise.all(extractionPromises);
      for (const txns of results) {
        allTransactions.push(...txns);
      }

      console.log(`[BankAudit] Extraction complete: ${allTransactions.length} total transactions from ${files.length} files`);

      // Sort by date
      allTransactions.sort((a, b) => {
        const da = String(a.date || '');
        const db = String(b.date || '');
        return da.localeCompare(db);
      });

      await prisma.bankAuditSession.update({
        where: { id: sessionId },
        data: { dataSource: 'extract', bankData: allTransactions as unknown as never },
      });

      return NextResponse.json({ transactions: allTransactions });
    }

    return NextResponse.json({ error: 'Unknown source' }, { status: 400 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[BankAudit Ingest]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
