import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import OpenAI from 'openai';

export const maxDuration = 120;

const EXTRACTION_PROMPT = `You are a bank statement data extractor. Extract ALL transactions from this bank statement into structured JSON.

For each transaction, extract:
- date: The transaction date (format: YYYY-MM-DD)
- description: The transaction description/narrative
- reference: Any reference number (or empty string if none)
- debit: The debit/payment amount as a number (0 if credit)
- credit: The credit/receipt amount as a number (0 if debit)
- balance: The running balance after this transaction (0 if not shown)

Return ONLY valid JSON in this exact format:
{
  "bankName": "Name of the bank",
  "accountName": "Account holder name",
  "accountNumber": "Account number (last 4 digits or masked)",
  "statementPeriod": "Start date to end date",
  "currency": "GBP/USD/EUR etc",
  "openingBalance": 0,
  "closingBalance": 0,
  "transactions": [
    {"date": "2025-01-15", "description": "Direct Debit - Electric Co", "reference": "DD123", "debit": 150.00, "credit": 0, "balance": 4850.00},
    {"date": "2025-01-16", "description": "Bank Transfer - Client Payment", "reference": "FP456", "debit": 0, "credit": 2500.00, "balance": 7350.00}
  ]
}

IMPORTANT:
- Extract EVERY transaction, do not skip any
- Amounts must be numbers, not strings
- If a transaction is a payment/debit, put the amount in "debit" and 0 in "credit"
- If a transaction is a receipt/credit, put the amount in "credit" and 0 in "debit"
- Dates must be in YYYY-MM-DD format
- If the year is not shown on each line, infer it from the statement period`;

/**
 * POST /api/sampling/parse-bank-statement
 * Accepts a PDF bank statement and extracts transactions using AI.
 * Returns structured data ready for the sampling spreadsheet.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  try {
    const formData = await req.formData();
    const file = formData.get('file') as File;
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    if (!file.name.toLowerCase().endsWith('.pdf')) {
      return NextResponse.json({ error: 'Only PDF files are supported' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // Try text extraction first
    let extractedText = '';
    try {
      const { extractText } = await import('unpdf');
      const pdfData = new Uint8Array(buffer);
      const result = await extractText(pdfData);
      const pages = Array.isArray(result.text) ? result.text : [String(result.text || '')];
      extractedText = pages.join('\n\n');
    } catch {
      // Text extraction failed — will try vision
    }

    const apiKey = process.env.TOGETHER_DOC_SUMMARY_KEY || process.env.TOGETHER_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'AI service not configured' }, { status: 500 });
    }

    const client = new OpenAI({ apiKey, baseURL: 'https://api.together.xyz/v1' });
    let responseContent = '';

    if (extractedText.length >= 50) {
      // Text-based extraction — split into chunks if very long
      const maxChunkSize = 12000;
      const chunks: string[] = [];
      for (let i = 0; i < extractedText.length; i += maxChunkSize) {
        chunks.push(extractedText.slice(i, i + maxChunkSize));
      }

      if (chunks.length === 1) {
        // Single chunk — one call
        const result = await client.chat.completions.create({
          model: 'Qwen/Qwen3-235B-A22B',
          messages: [
            { role: 'user', content: `${EXTRACTION_PROMPT}\n\n--- BANK STATEMENT TEXT ---\n${chunks[0]}` },
          ],
          max_tokens: 8000,
          temperature: 0.1,
        });
        responseContent = result.choices?.[0]?.message?.content?.trim() || '';
      } else {
        // Multiple chunks — extract from each, then merge
        const allTransactions: Record<string, unknown>[] = [];
        let metadata: Record<string, unknown> = {};

        for (let ci = 0; ci < chunks.length; ci++) {
          const chunkPrompt = ci === 0
            ? `${EXTRACTION_PROMPT}\n\n--- BANK STATEMENT TEXT (page ${ci + 1} of ${chunks.length}) ---\n${chunks[ci]}`
            : `Continue extracting transactions from this bank statement. Same format as before.\n\n--- BANK STATEMENT TEXT (page ${ci + 1} of ${chunks.length}) ---\n${chunks[ci]}`;

          const result = await client.chat.completions.create({
            model: 'Qwen/Qwen3-235B-A22B',
            messages: [
              { role: 'user', content: chunkPrompt },
            ],
            max_tokens: 8000,
            temperature: 0.1,
          });

          const content = result.choices?.[0]?.message?.content?.trim() || '';
          const jsonMatch = content.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            try {
              const parsed = JSON.parse(jsonMatch[0]);
              if (ci === 0) {
                metadata = { ...parsed };
                delete metadata.transactions;
              }
              if (Array.isArray(parsed.transactions)) {
                allTransactions.push(...parsed.transactions);
              }
            } catch { /* skip malformed chunk */ }
          }
        }

        responseContent = JSON.stringify({ ...metadata, transactions: allTransactions });
      }
    } else {
      // Scanned PDF — convert pages to images and use vision model
      console.log('[Sampling:ParseBankStatement] Text too short, using vision model for OCR');

      try {
        const { execSync } = await import('child_process');
        const { writeFileSync, readFileSync, mkdirSync, readdirSync, unlinkSync, rmdirSync } = await import('fs');
        const { join } = await import('path');
        const os = await import('os');

        const tmpDir = join(os.tmpdir(), `bank-stmt-${Date.now()}`);
        mkdirSync(tmpDir, { recursive: true });
        const pdfPath = join(tmpDir, 'statement.pdf');
        writeFileSync(pdfPath, buffer);

        // Convert PDF pages to images using pdftoppm (from poppler)
        try {
          execSync(`pdftoppm -jpeg -r 200 "${pdfPath}" "${join(tmpDir, 'page')}"`, { timeout: 30000 });
        } catch {
          // pdftoppm may not be available on serverless — fall back to error
          return NextResponse.json({
            error: 'This bank statement appears to be scanned. OCR processing is not available on this server. Please use the Paste Data option to enter transactions manually.',
            scanned: true,
          }, { status: 422 });
        }

        // Read generated page images
        const pageFiles = readdirSync(tmpDir)
          .filter(f => f.startsWith('page') && f.endsWith('.jpg'))
          .sort();

        if (pageFiles.length === 0) {
          return NextResponse.json({ error: 'Could not convert PDF pages to images' }, { status: 422 });
        }

        // Send each page to vision model (max 5 pages for bank statements)
        const allTransactions: Record<string, unknown>[] = [];
        let metadata: Record<string, unknown> = {};
        const maxPages = Math.min(pageFiles.length, 5);

        for (let pi = 0; pi < maxPages; pi++) {
          const imgData = readFileSync(join(tmpDir, pageFiles[pi]));
          const base64 = imgData.toString('base64');

          const visionPrompt = pi === 0
            ? EXTRACTION_PROMPT
            : 'Continue extracting transactions from this bank statement page. Same JSON format as before.';

          const result = await client.chat.completions.create({
            model: 'meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8',
            messages: [{
              role: 'user',
              content: [
                { type: 'text', text: visionPrompt },
                { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}` } },
              ],
            }],
            max_tokens: 8000,
            temperature: 0.1,
          });

          const content = result.choices?.[0]?.message?.content?.trim() || '';
          const jsonMatch = content.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            try {
              const parsed = JSON.parse(jsonMatch[0]);
              if (pi === 0) {
                metadata = { ...parsed };
                delete metadata.transactions;
              }
              if (Array.isArray(parsed.transactions)) {
                allTransactions.push(...parsed.transactions);
              }
            } catch { /* skip malformed */ }
          }
        }

        // Cleanup temp files
        try {
          readdirSync(tmpDir).forEach(f => unlinkSync(join(tmpDir, f)));
          rmdirSync(tmpDir);
        } catch { /* non-fatal */ }

        if (allTransactions.length === 0) {
          return NextResponse.json({
            error: 'Could not extract transactions from the scanned bank statement. Please try the Paste Data option.',
            scanned: true,
          }, { status: 422 });
        }

        responseContent = JSON.stringify({ ...metadata, transactions: allTransactions });
      } catch (ocrErr) {
        console.error('[Sampling:ParseBankStatement] OCR error:', ocrErr instanceof Error ? ocrErr.message : ocrErr);
        return NextResponse.json({
          error: 'Failed to process scanned bank statement. Please use the Paste Data option to enter transactions manually.',
          scanned: true,
        }, { status: 422 });
      }
    }

    // Parse the AI response
    const jsonMatch = responseContent.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json({ error: 'Could not parse bank statement data' }, { status: 422 });
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const transactions: Record<string, unknown>[] = Array.isArray(parsed.transactions) ? parsed.transactions : [];

    if (transactions.length === 0) {
      return NextResponse.json({ error: 'No transactions found in the bank statement' }, { status: 422 });
    }

    // Convert to spreadsheet-ready format with a net amount column
    const rows = transactions.map((t, idx) => {
      const debit = Number(t.debit) || 0;
      const credit = Number(t.credit) || 0;
      const amount = credit > 0 ? credit : -debit; // Positive for credits, negative for debits
      return {
        'Transaction ID': `BS${String(idx + 1).padStart(4, '0')}`,
        'Date': String(t.date || ''),
        'Description': String(t.description || ''),
        'Reference': String(t.reference || ''),
        'Debit': debit,
        'Credit': credit,
        'Amount': Math.round(amount * 100) / 100,
        'Balance': Number(t.balance) || 0,
      };
    });

    return NextResponse.json({
      rows,
      columns: ['Transaction ID', 'Date', 'Description', 'Reference', 'Debit', 'Credit', 'Amount', 'Balance'],
      metadata: {
        bankName: parsed.bankName || null,
        accountName: parsed.accountName || null,
        accountNumber: parsed.accountNumber || null,
        statementPeriod: parsed.statementPeriod || null,
        currency: parsed.currency || 'GBP',
        openingBalance: parsed.openingBalance || null,
        closingBalance: parsed.closingBalance || null,
        transactionCount: rows.length,
        fileName: file.name,
      },
    });
  } catch (error) {
    console.error('[Sampling:ParseBankStatement] Error:', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'Failed to parse bank statement' }, { status: 500 });
  }
}
