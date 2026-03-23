import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { downloadBlob } from '@/lib/azure-blob';
import { processPdf, isPdf } from '@/lib/pdf-to-images';
import { selectModels, EXTRACTION_PRIORITIES, markModelUnavailable } from '@/lib/ai-extractor';
import OpenAI from 'openai';

export const maxDuration = 300;

const BANK_EXTRACTION_PROMPT = `You are an expert bank statement data extractor. Extract ALL transaction data from this bank statement.

For each transaction, extract:
- date: The transaction date (format: YYYY-MM-DD)
- description: The transaction description/narrative
- reference: Any reference number (or empty string if none)
- debit: The debit/payment amount as a number (0 if credit)
- credit: The credit/receipt amount as a number (0 if debit)
- balance: The running balance after this transaction (0 if not shown)

Also extract these header details:
- bankName: Name of the bank
- sortCode: Sort code (e.g. "20-37-83")
- accountNumber: Full account number
- statementDate: The date printed on the statement (YYYY-MM-DD)
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
- If balance is not shown per-transaction, set it to 0
- Do NOT include "Start Balance" or "Balance carried forward" as transactions — only real payment/receipt transactions`;

// ─── AI call with model fallback (same pattern as ai-extractor.ts) ───────────

const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 2000;

async function callAIWithFallback(
  apiKey: string,
  messages: OpenAI.ChatCompletionMessageParam[],
  context: string,
): Promise<string> {
  const togetherClient = new OpenAI({ apiKey, baseURL: 'https://api.together.xyz/v1' });
  const models = selectModels(EXTRACTION_PRIORITIES, messages.some(
    m => Array.isArray(m.content) && m.content.some(c => typeof c === 'object' && 'type' in c && c.type === 'image_url')
  ));

  for (const model of models) {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        console.log(`[BankToTB] Calling ${model} (attempt ${attempt + 1}) for ${context}`);
        const result = await togetherClient.chat.completions.create({
          model,
          messages,
          max_tokens: 16000,
          temperature: 0.1,
        });
        let content = result.choices?.[0]?.message?.content?.trim() || '';
        content = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
        if (content.length > 10) {
          console.log(`[BankToTB] ${model} returned ${content.length} chars for ${context}`);
          return content;
        }
        console.warn(`[BankToTB] ${model} returned empty/short response for ${context}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[BankToTB] ${model} attempt ${attempt + 1} failed: ${msg}`);
        if (msg.includes('404') || msg.includes('model not found') || msg.includes('does not exist')) {
          markModelUnavailable(model);
          break; // Skip to next model
        }
        if (attempt < MAX_RETRIES - 1) {
          const delay = BASE_BACKOFF_MS * Math.pow(2, attempt);
          await new Promise(r => setTimeout(r, delay));
        }
      }
    }
  }
  throw new Error('All AI models failed for bank statement extraction');
}

// ─── POST handler ────────────────────────────────────────────────────────────

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
    await prisma.bankToTBFile.updateMany({
      where: { sessionId, status: 'uploaded' },
      data: { status: 'failed', errorMessage: 'AI extraction service not configured. Contact your administrator.' },
    });
    return NextResponse.json({ error: 'AI extraction service not configured.' }, { status: 500 });
  }

  const results: { fileId: string; status: string; transactionCount: number; error?: string }[] = [];
  const totalFiles = btbSession.files.length;

  for (let fi = 0; fi < btbSession.files.length; fi++) {
    const file = btbSession.files[fi];
    try {
      // Mark as processing
      await prisma.bankToTBFile.update({
        where: { id: file.id },
        data: { status: 'processing' },
      });

      await prisma.backgroundTask.updateMany({
        where: { userId: session.user.id, type: 'bank-to-tb-parse', status: 'running' },
        data: { progress: { sessionId, fileCount: totalFiles, processed: fi, currentFile: file.originalName, stage: 'downloading' } },
      });

      // Download from Azure Blob
      console.log(`[BankToTB] Downloading ${file.originalName} from ${file.storagePath}`);
      const buffer = await downloadBlob(file.storagePath, file.containerName);
      console.log(`[BankToTB] Downloaded ${buffer.length} bytes for ${file.originalName}`);

      // Update progress
      await prisma.backgroundTask.updateMany({
        where: { userId: session.user.id, type: 'bank-to-tb-parse', status: 'running' },
        data: { progress: { sessionId, fileCount: totalFiles, processed: fi, currentFile: file.originalName, stage: 'extracting' } },
      });

      // ── Build AI messages using same approach as Financial Data Extraction ──
      let messages: OpenAI.ChatCompletionMessageParam[];

      if (isPdf(file.mimeType || '')) {
        // Use processPdf from lib/pdf-to-images.ts (same as Financial Data Extraction)
        const pdfContent = await processPdf(buffer, 20);
        console.log(`[BankToTB] PDF mode: ${pdfContent.mode}, pages: ${pdfContent.pageCount}, text: ${pdfContent.text?.length ?? 0} chars`);

        if (pdfContent.mode === 'text' && pdfContent.text) {
          // Text-based extraction — send extracted text to AI
          messages = [{
            role: 'user' as const,
            content: `${BANK_EXTRACTION_PROMPT}\n\n--- BANK STATEMENT TEXT ---\n${pdfContent.text.slice(0, 40000)}`,
          }];
        } else {
          // Scanned PDF — send as image to vision model
          console.log(`[BankToTB] Scanned/image PDF — using vision extraction for ${file.originalName}`);
          const base64Data = buffer.toString('base64');
          messages = [{
            role: 'user' as const,
            content: [
              { type: 'text' as const, text: BANK_EXTRACTION_PROMPT },
              { type: 'image_url' as const, image_url: { url: `data:application/pdf;base64,${base64Data}` } },
            ],
          }];
        }
      } else {
        // Image file — send directly as image to vision model
        console.log(`[BankToTB] Image file — using vision extraction for ${file.originalName}`);
        const base64Data = buffer.toString('base64');
        const mimeType = file.mimeType || 'image/png';
        messages = [{
          role: 'user' as const,
          content: [
            { type: 'text' as const, text: BANK_EXTRACTION_PROMPT },
            { type: 'image_url' as const, image_url: { url: `data:${mimeType};base64,${base64Data}` } },
          ],
        }];
      }

      // ── Call AI with model fallback and retry ──
      const responseContent = await callAIWithFallback(apiKey, messages, file.originalName);

      // Parse JSON response
      const jsonMatch = responseContent.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.error(`[BankToTB] No JSON in AI response for ${file.originalName}. Response: ${responseContent.slice(0, 200)}`);
        await prisma.bankToTBFile.update({
          where: { id: file.id },
          data: { status: 'failed', errorMessage: 'AI did not return valid JSON. The bank statement format may not be supported.' },
        });
        results.push({ fileId: file.id, status: 'failed', transactionCount: 0, error: 'No JSON in response' });
        continue;
      }

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch (parseErr) {
        console.error(`[BankToTB] JSON parse error for ${file.originalName}:`, parseErr);
        await prisma.bankToTBFile.update({
          where: { id: file.id },
          data: { status: 'failed', errorMessage: 'AI returned malformed JSON.' },
        });
        results.push({ fileId: file.id, status: 'failed', transactionCount: 0, error: 'JSON parse error' });
        continue;
      }

      const transactions: Record<string, unknown>[] = Array.isArray(parsed.transactions) ? parsed.transactions : [];
      console.log(`[BankToTB] Extracted ${transactions.length} transactions from ${file.originalName}`);

      // Update progress: saving
      await prisma.backgroundTask.updateMany({
        where: { userId: session.user.id, type: 'bank-to-tb-parse', status: 'running' },
        data: { progress: { sessionId, fileCount: totalFiles, processed: fi, currentFile: file.originalName, stage: 'saving', transactionCount: transactions.length } },
      });

      // Save transactions to database
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

      // Mark file as extracted
      await prisma.bankToTBFile.update({
        where: { id: file.id },
        data: {
          status: 'extracted',
          pageCount: Number(parsed.statementPage) || null,
        },
      });

      results.push({ fileId: file.id, status: 'extracted', transactionCount: transactions.length });
      console.log(`[BankToTB] Successfully processed ${file.originalName}: ${transactions.length} transactions`);

    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      console.error(`[BankToTB] Failed to process ${file.originalName}:`, errMsg);
      await prisma.bankToTBFile.update({
        where: { id: file.id },
        data: { status: 'failed', errorMessage: errMsg },
      });
      results.push({ fileId: file.id, status: 'failed', transactionCount: 0, error: errMsg });
    }
  }

  // Update background task to completed
  await prisma.backgroundTask.updateMany({
    where: { userId: session.user.id, type: 'bank-to-tb-parse', status: 'running' },
    data: { status: 'completed', result: { results } },
  });

  return NextResponse.json({ success: true, results });
}
