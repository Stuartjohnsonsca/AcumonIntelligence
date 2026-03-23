import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { downloadBlob } from '@/lib/azure-blob';
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

Also extract these header details:
- bankName: Name of the bank
- sortCode: Sort code (e.g. "12-34-56")
- accountNumber: Full account number
- statementDate: The date printed on the statement
- statementPage: Page number if shown
- openingBalance: Opening balance for this statement page
- closingBalance: Closing balance for this statement page

Return ONLY valid JSON in this exact format:
{
  "bankName": "Bank Name",
  "sortCode": "12-34-56",
  "accountNumber": "12345678",
  "statementDate": "2025-01-31",
  "statementPage": 1,
  "openingBalance": 5000.00,
  "closingBalance": 4500.00,
  "currency": "GBP",
  "transactions": [
    {"date": "2025-01-15", "description": "Direct Debit - Electric Co", "reference": "DD123", "debit": 150.00, "credit": 0, "balance": 4850.00}
  ]
}

CRITICAL RULES:
- Extract EVERY transaction, do not skip any
- Amounts must be numbers, not strings (no commas in numbers)
- Dates must be in YYYY-MM-DD format
- If the year is not shown on each line, infer it from the statement period
- If amounts have commas, convert to plain numbers
- If balance is not shown per-transaction, set it to 0`;

// POST - process uploaded bank statement files for a session
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const { sessionId } = await req.json();
  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId required' }, { status: 400 });
  }

  const btbSession = await prisma.bankToTBSession.findUnique({
    where: { id: sessionId },
    include: {
      files: { where: { status: 'uploaded' } },
      period: true,
    },
  });

  if (!btbSession || btbSession.userId !== session.user.id) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  if (btbSession.files.length === 0) {
    return NextResponse.json({ error: 'No files to process' }, { status: 400 });
  }

  const apiKey = process.env.TOGETHER_DOC_SUMMARY_KEY || process.env.TOGETHER_API_KEY;
  if (!apiKey) {
    console.error('[BankToTB Process] No TOGETHER_DOC_SUMMARY_KEY or TOGETHER_API_KEY set');
    // Mark all uploaded files as failed
    await prisma.bankToTBFile.updateMany({
      where: { sessionId, status: 'uploaded' },
      data: { status: 'failed', errorMessage: 'AI extraction service not configured. Contact your administrator.' },
    });
    return NextResponse.json({ error: 'AI extraction service not configured. Check TOGETHER_DOC_SUMMARY_KEY or TOGETHER_API_KEY.' }, { status: 500 });
  }

  const client = new OpenAI({ apiKey, baseURL: 'https://api.together.xyz/v1' });
  const results: { fileId: string; status: string; transactionCount: number }[] = [];

  const totalFiles = btbSession.files.length;

  for (let fi = 0; fi < btbSession.files.length; fi++) {
    const file = btbSession.files[fi];
    try {
      // Mark as processing and update background task progress
      await prisma.bankToTBFile.update({
        where: { id: file.id },
        data: { status: 'processing' },
      });

      await prisma.backgroundTask.updateMany({
        where: { userId: session.user.id, type: 'bank-to-tb-parse', status: 'running' },
        data: { progress: { sessionId, fileCount: totalFiles, processed: fi, currentFile: file.originalName, stage: 'downloading' } },
      });

      // Download file from blob
      const buffer = await downloadBlob(file.storagePath, file.containerName);

      // Extract text from PDF
      let extractedText = '';

      if (file.mimeType === 'application/pdf') {
        // Try pdf-parse first (most reliable on serverless)
        try {
          console.log(`[BankToTB] Trying pdf-parse for ${file.originalName}`);
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const pdfParse = require('pdf-parse');
          const result = await pdfParse(buffer) as { text: string };
          extractedText = result.text || '';
          console.log(`[BankToTB] pdf-parse extracted ${extractedText.length} chars from ${file.originalName}`);
        } catch (pdfParseErr) {
          console.warn(`[BankToTB] pdf-parse failed for ${file.originalName}:`, pdfParseErr instanceof Error ? pdfParseErr.message : pdfParseErr);

          // Try unpdf as fallback
          try {
            console.log(`[BankToTB] Trying unpdf for ${file.originalName}`);
            const { extractText } = await import('unpdf');
            const pdfData = new Uint8Array(buffer);
            const result = await extractText(pdfData);
            const pages = Array.isArray(result.text) ? result.text : [String(result.text || '')];
            extractedText = pages.join('\n\n');
            console.log(`[BankToTB] unpdf extracted ${extractedText.length} chars from ${file.originalName}`);
          } catch (unpdfErr) {
            console.warn(`[BankToTB] unpdf failed for ${file.originalName}:`, unpdfErr instanceof Error ? unpdfErr.message : unpdfErr);
            console.log(`[BankToTB] All PDF text extractors failed — falling through to vision extraction for ${file.originalName}`);
          }
        }
      } else {
        console.log(`[BankToTB] Image file ${file.originalName} — using vision extraction`);
      }

      // Update progress: extracting
      await prisma.backgroundTask.updateMany({
        where: { userId: session.user.id, type: 'bank-to-tb-parse', status: 'running' },
        data: { progress: { sessionId, fileCount: totalFiles, processed: fi, currentFile: file.originalName, stage: 'extracting' } },
      });

      let responseContent = '';

      console.log(`[BankToTB] Text length for ${file.originalName}: ${extractedText.length} chars. Using ${extractedText.length >= 10 ? 'text' : 'vision'} extraction.`);

      if (extractedText.length >= 10) {
        // Text-based extraction
        const maxChunkSize = 20000;
        const chunks: string[] = [];
        for (let i = 0; i < extractedText.length; i += maxChunkSize) {
          chunks.push(extractedText.slice(i, i + maxChunkSize));
        }

        const chunkPromises = chunks.map((chunk, ci) => {
          const prompt = ci === 0
            ? `${EXTRACTION_PROMPT}\n\n--- BANK STATEMENT TEXT ---\n${chunk}`
            : `Continue extracting ALL transactions from this bank statement. Return ONLY {"transactions": [...], "statementPage": N}.\n\n--- TEXT ---\n${chunk}`;

          return client.chat.completions.create({
            model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 16000,
            temperature: 0.1,
          }).then(r => {
            let c = r.choices?.[0]?.message?.content?.trim() || '';
            c = c.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
            return c;
          }).catch(() => '');
        });

        const chunkResults = await Promise.all(chunkPromises);

        const allTransactions: Record<string, unknown>[] = [];
        let metadata: Record<string, unknown> = {};

        for (let ci = 0; ci < chunkResults.length; ci++) {
          const jsonMatch = chunkResults[ci].match(/\{[\s\S]*\}/);
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
            } catch { /* skip */ }
          }
        }

        responseContent = JSON.stringify({ ...metadata, transactions: allTransactions });
      } else {
        // Vision-based for images or scanned PDFs
        const base64Data = buffer.toString('base64');
        const mimeType = file.mimeType || 'application/pdf';

        const result = await client.chat.completions.create({
          model: 'meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8',
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: EXTRACTION_PROMPT },
              { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Data}` } },
            ],
          }],
          max_tokens: 8000,
          temperature: 0.1,
        });

        responseContent = result.choices?.[0]?.message?.content?.trim() || '';
        responseContent = responseContent.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
      }

      // Parse response
      const jsonMatch = responseContent.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        await prisma.bankToTBFile.update({
          where: { id: file.id },
          data: { status: 'failed', errorMessage: 'No valid JSON returned from AI extraction' },
        });
        results.push({ fileId: file.id, status: 'failed', transactionCount: 0 });
        continue;
      }

      const parsed = JSON.parse(jsonMatch[0]);
      const transactions: Record<string, unknown>[] = Array.isArray(parsed.transactions) ? parsed.transactions : [];

      // Update progress: saving transactions
      await prisma.backgroundTask.updateMany({
        where: { userId: session.user.id, type: 'bank-to-tb-parse', status: 'running' },
        data: { progress: { sessionId, fileCount: totalFiles, processed: fi, currentFile: file.originalName, stage: 'saving', transactionCount: transactions.length } },
      });

      // Create bank transaction records
      for (let i = 0; i < transactions.length; i++) {
        const t = transactions[i];
        await prisma.bankTransaction.create({
          data: {
            sessionId,
            fileId: file.id,
            date: new Date(String(t.date) || new Date().toISOString()),
            description: String(t.description || ''),
            reference: String(t.reference || '') || null,
            debit: Number(t.debit) || 0,
            credit: Number(t.credit) || 0,
            balance: Number(t.balance) || null,
            bankName: String(parsed.bankName || '') || null,
            sortCode: String(parsed.sortCode || '') || null,
            accountNumber: String(parsed.accountNumber || '') || null,
            statementDate: String(parsed.statementDate || '') || null,
            statementPage: Number(parsed.statementPage) || null,
            sortOrder: i,
          },
        });
      }

      // Update file status
      await prisma.bankToTBFile.update({
        where: { id: file.id },
        data: {
          status: 'extracted',
          pageCount: Number(parsed.statementPage) || null,
        },
      });

      results.push({ fileId: file.id, status: 'extracted', transactionCount: transactions.length });

    } catch (err) {
      console.error(`Failed to process file ${file.id}:`, err);
      await prisma.bankToTBFile.update({
        where: { id: file.id },
        data: {
          status: 'failed',
          errorMessage: err instanceof Error ? err.message : 'Unknown error',
        },
      });
      results.push({ fileId: file.id, status: 'failed', transactionCount: 0 });
    }
  }

  // Update background task
  await prisma.backgroundTask.updateMany({
    where: {
      userId: session.user.id,
      type: 'bank-to-tb-parse',
      status: 'running',
    },
    data: {
      status: 'completed',
      result: { results },
    },
  });

  return NextResponse.json({ success: true, results });
}
