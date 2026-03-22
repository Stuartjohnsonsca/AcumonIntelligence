import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import OpenAI from 'openai';

export const maxDuration = 120;

const EXTRACTION_PROMPT = `You are an expert bank statement data extractor. The text below was extracted from a PDF bank statement. The text may be jumbled because PDF table layouts extract imperfectly — column values may appear out of order or on separate lines. Your job is to intelligently reconstruct the transactions.

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
- If balance is not shown per-transaction, set it to 0`;

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

    // For text-based PDFs, even short text can be valid (bank statements have tabular data)
    // Lower the threshold significantly — even 10 chars means some text was found
    if (extractedText.length >= 10) {
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
      // Scanned/image PDF — split into single-page PDFs, send each as base64 to vision model
      console.log('[Sampling:ParseBankStatement] Text too short, using vision model for OCR');

      try {
        const { PDFDocument } = await import('pdf-lib');
        const pdfDoc = await PDFDocument.load(buffer);
        const pageCount = pdfDoc.getPageCount();
        const maxPages = Math.min(pageCount, 5);

        const allTransactions: Record<string, unknown>[] = [];
        let metadata: Record<string, unknown> = {};

        for (let pi = 0; pi < maxPages; pi++) {
          // Create a single-page PDF for this page
          const singlePageDoc = await PDFDocument.create();
          const [copiedPage] = await singlePageDoc.copyPages(pdfDoc, [pi]);
          singlePageDoc.addPage(copiedPage);
          const singlePageBytes = await singlePageDoc.save();
          const base64Pdf = Buffer.from(singlePageBytes).toString('base64');

          const visionPrompt = pi === 0
            ? EXTRACTION_PROMPT
            : 'Continue extracting transactions from this bank statement page. Same JSON format as before.';

          const result = await client.chat.completions.create({
            model: 'meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8',
            messages: [{
              role: 'user',
              content: [
                { type: 'text', text: visionPrompt },
                { type: 'image_url', image_url: { url: `data:application/pdf;base64,${base64Pdf}` } },
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
            } catch { /* skip malformed chunk */ }
          }
        }

        if (allTransactions.length === 0) {
          return NextResponse.json({
            error: 'Could not extract transactions from the bank statement. The PDF may be image-only or encrypted. Please try the Paste Data option.',
            scanned: true,
          }, { status: 422 });
        }

        responseContent = JSON.stringify({ ...metadata, transactions: allTransactions });
      } catch (ocrErr) {
        console.error('[Sampling:ParseBankStatement] Vision OCR error:', ocrErr instanceof Error ? ocrErr.message : ocrErr);
        return NextResponse.json({
          error: 'Failed to process bank statement. Please use the Paste Data option to enter transactions manually.',
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
