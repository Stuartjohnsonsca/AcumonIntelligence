/**
 * Doc Summary Worker
 *
 * Standalone worker that polls the Azure Queue for doc-summary-analysis messages
 * and processes them. Run with: npx tsx workers/doc-summary-worker.ts
 */

import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  receiveMessages,
  deleteMessage,
  isDeadLetter,
  QUEUES,
  type DocSummaryMessage,
  type BankStatementParseMessage,
} from '../lib/azure-queue';
import { prisma } from '../lib/db';
import { Prisma } from '@prisma/client';
import { downloadBlob } from '../lib/azure-blob';
import {
  analyseDocumentForAudit,
  analyseDocumentFromImage,
  calculateDocSummaryCost,
} from '../lib/doc-summary-ai';
import { getKeyForJob, getDocSummaryKeyConfig, type KeyConfig } from '../lib/ai-key-manager';
import OpenAI from 'openai';
import { setJobStatus, setFileStatus, setFileProgress, closeRedis } from '../lib/redis';

const POLL_INTERVAL_MS = 2000;
const VISIBILITY_TIMEOUT_SECONDS = 300;

let running = true;

// ─── Graceful shutdown ──────────────────────────────────────────────────────

process.on('SIGTERM', () => {
  console.log('[Worker] SIGTERM received, finishing current work...');
  running = false;
});

process.on('SIGINT', () => {
  console.log('[Worker] SIGINT received, finishing current work...');
  running = false;
});

// ─── Main loop ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('[Worker] Doc summary worker starting...');

  const keyConfig = getDocSummaryKeyConfig();

  while (running) {
    try {
      const messages = await receiveMessages<DocSummaryMessage>(
        QUEUES.DOC_SUMMARY_ANALYSIS,
        1,
        VISIBILITY_TIMEOUT_SECONDS,
      );

      if (messages.length === 0) {
        await sleep(POLL_INTERVAL_MS);
        continue;
      }

      for (const received of messages) {
        const { message, messageId, popReceipt, dequeueCount } = received;
        const { jobId, fileId, clientName, userId, clientId, accountingFramework, perspective } = message;

        console.log(
          `[Worker] Processing | jobId=${jobId} fileId=${fileId} dequeueCount=${dequeueCount}`,
        );

        // Dead letter check — too many retries
        if (isDeadLetter(dequeueCount)) {
          console.error(
            `[Worker] Dead letter | jobId=${jobId} fileId=${fileId} dequeueCount=${dequeueCount}`,
          );
          await markFileFailed(jobId, fileId, `Max retries exceeded (dequeueCount=${dequeueCount})`);
          await deleteMessage(QUEUES.DOC_SUMMARY_ANALYSIS, messageId, popReceipt);
          await checkJobCompletion(jobId);
          continue;
        }

        try {
          await processFile(jobId, fileId, clientName, userId, clientId, keyConfig, accountingFramework, perspective);
          await deleteMessage(QUEUES.DOC_SUMMARY_ANALYSIS, messageId, popReceipt);
          console.log(`[Worker] File complete | jobId=${jobId} fileId=${fileId}`);
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          console.error(`[Worker] File failed | jobId=${jobId} fileId=${fileId} error=${errMsg}`);

          // Update file as failed in DB and Redis, but DON'T delete message (let it retry)
          await markFileFailed(jobId, fileId, errMsg);
        }

        await checkJobCompletion(jobId);
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[Worker] DocSummary poll error: ${errMsg}`);
    }

    // ─── Bank Statement Parse (DB polling) ─────────────────────────────────
    try {
      // Find populations that need parsing: have a storagePath but no parsedData yet
      const pending = await prisma.samplingPopulation.findFirst({
        where: {
          storagePath: { not: null },
          parsedData: { equals: Prisma.DbNull },
          originalFileName: { endsWith: '.pdf' },
        },
        include: {
          engagement: { select: { clientId: true } },
        },
        orderBy: { createdAt: 'asc' },
      });

      if (pending && pending.storagePath) {
        console.log(`[Worker:BankStatement] Found pending | populationId=${pending.id} file=${pending.originalFileName}`);

        try {
          await processBankStatement({
            type: 'bank-statement-parse',
            populationId: pending.id,
            engagementId: pending.engagementId,
            clientId: pending.engagement.clientId,
            userId: '',
            storagePath: pending.storagePath,
            containerName: pending.containerName,
            fileName: pending.originalFileName || 'statement.pdf',
          });
          console.log(`[Worker:BankStatement] Complete | populationId=${pending.id}`);
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          console.error(`[Worker:BankStatement] Failed | populationId=${pending.id} error=${errMsg}`);
          await prisma.samplingPopulation.update({
            where: { id: pending.id },
            data: { parsedData: { error: errMsg } },
          }).catch(() => {});
        }
      } else {
        await sleep(POLL_INTERVAL_MS);
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[Worker] BankStatement poll error: ${errMsg}`);
      await sleep(POLL_INTERVAL_MS);
    }
  }

  console.log('[Worker] Shutting down...');
  await closeRedis();
  await prisma.$disconnect();
  process.exit(0);
}

// ─── File processing ────────────────────────────────────────────────────────

async function processFile(
  jobId: string,
  fileId: string,
  clientName: string,
  userId: string,
  clientId: string,
  keyConfig: KeyConfig,
  accountingFramework?: string,
  perspective?: string,
): Promise<void> {
  // 1. Get the file record
  const file = await prisma.docSummaryFile.findUnique({ where: { id: fileId } });
  if (!file) throw new Error(`File ${fileId} not found`);

  // 2. Update file status to processing
  await prisma.docSummaryFile.update({
    where: { id: fileId },
    data: { status: 'processing' },
  });
  await setFileStatus(jobId, fileId, 'processing');

  // 3. Get API key for this job
  const apiKey = await getKeyForJob(jobId, keyConfig);
  // Set env var so the doc-summary-ai module uses the correct key
  process.env.TOGETHER_DOC_SUMMARY_KEY = apiKey;

  // 4. Download from Azure Blob
  const pdfBuffer = await downloadBlob(file.storagePath, file.containerName);

  // 5. Extract text using unpdf (dynamic import — ESM-only)
  const { extractText, getMeta } = await import('unpdf');
  const pdfData = new Uint8Array(pdfBuffer);
  const pdfResult = await extractText(pdfData);
  const textPages = Array.isArray(pdfResult.text) ? pdfResult.text : [String(pdfResult.text || '')];
  const text = textPages.join('\n').trim();
  let pageCount = textPages.length || 1;
  try {
    const meta = await getMeta(pdfData);
    pageCount = (meta.info as Record<string, unknown>)?.Pages as number || pageCount;
  } catch { /* non-fatal */ }

  // 6. Run AI analysis
  let analysisResult;

  if (text.length < 50) {
    // Scanned/image PDF — convert to page images via pdftoppm, then send to vision model
    console.log(
      `[Worker] Text too short (${text.length} chars), converting PDF to images | file=${file.originalName}`,
    );
    let pageImages: string[];
    try {
      pageImages = convertPdfToImages(pdfBuffer);
    } catch (convErr) {
      const convMsg = convErr instanceof Error ? convErr.message : String(convErr);
      console.error(`[Worker] PDF-to-image conversion failed | file=${file.originalName} | error=${convMsg}`);
      throw new Error(`PDF-to-image conversion failed: ${convMsg}`);
    }
    console.log(`[Worker] Converted PDF to ${pageImages.length} page images`);
    // Set initial progress
    await setFileProgress(jobId, fileId, {
      batchesDone: 0, batchesTotal: Math.ceil(pageImages.length / 5),
      pagesDone: 0, pagesTotal: pageImages.length,
      message: 'Analysing pages...',
    });

    analysisResult = await analyseDocumentFromImage(
      pageImages,
      file.originalName,
      clientName,
      async (batchesDone, batchesTotal, pagesDone, pagesTotal) => {
        await setFileProgress(jobId, fileId, { batchesDone, batchesTotal, pagesDone, pagesTotal,
          message: `Analysed ${pagesDone}/${pagesTotal} pages (batch ${batchesDone}/${batchesTotal})`,
        });
      },
      accountingFramework || 'FRS 102',
      perspective,
    );
  } else {
    await setFileProgress(jobId, fileId, { batchesDone: 0, batchesTotal: 1, pagesDone: 0, pagesTotal: 1, message: 'Analysing text...' });
    analysisResult = await analyseDocumentForAudit(text, file.originalName, clientName, accountingFramework || 'FRS 102', perspective);
    await setFileProgress(jobId, fileId, { batchesDone: 1, batchesTotal: 1, pagesDone: 1, pagesTotal: 1, message: 'Complete' });
  }

  // 7. Save findings
  for (let i = 0; i < analysisResult.findings.length; i++) {
    const finding = analysisResult.findings[i];
    await prisma.docSummaryFinding.create({
      data: {
        jobId,
        fileId,
        area: finding.area,
        finding: finding.finding,
        clauseReference: finding.clauseReference,
        isSignificantRisk: finding.isSignificantRisk,
        aiSignificantRisk: finding.isSignificantRisk,
        accountingImpact: finding.accountingImpact || null,
        auditImpact: finding.auditImpact || null,
        sortOrder: i,
      },
    });
  }

  // 8. Log AI usage
  const costUsd = calculateDocSummaryCost(analysisResult.usage, analysisResult.model);
  await prisma.aiUsage.create({
    data: {
      clientId,
      jobId,
      fileId,
      userId,
      action: 'Document Summary',
      model: analysisResult.model,
      operation: 'document-analysis',
      promptTokens: analysisResult.usage.promptTokens,
      completionTokens: analysisResult.usage.completionTokens,
      totalTokens: analysisResult.usage.totalTokens,
      estimatedCostUsd: costUsd,
    },
  });

  // 9. Build extracted text for Q&A use
  // For text-based PDFs: use the raw extracted text
  // For OCR/vision PDFs: reconstruct from analysis results so Q&A can work
  let extractedText = text;
  if (text.length < 50 && analysisResult) {
    // Vision/OCR path — reconstruct searchable text from findings
    const parts: string[] = [];
    if (analysisResult.documentDescription) {
      parts.push(`DOCUMENT DESCRIPTION:\n${analysisResult.documentDescription}`);
    }
    if (analysisResult.summary) {
      parts.push(`SUMMARY:\n${analysisResult.summary}`);
    }
    if (analysisResult.keyTerms?.length) {
      parts.push('KEY TERMS:\n' + analysisResult.keyTerms.map(t => `${t.term}: ${t.value} (${t.clauseReference})`).join('\n'));
    }
    if (analysisResult.findings.length > 0) {
      parts.push('FINDINGS:\n' + analysisResult.findings.map(f =>
        `[${f.area}] ${f.finding} (Clause: ${f.clauseReference})${f.accountingImpact ? `\nAccounting Impact: ${f.accountingImpact}` : ''}${f.auditImpact ? `\nAudit Impact: ${f.auditImpact}` : ''}`
      ).join('\n\n'));
    }
    if (analysisResult.missingInformation?.length) {
      parts.push('MISSING INFORMATION:\n' + analysisResult.missingInformation.map(m => `${m.item}: ${m.reason}`).join('\n'));
    }
    extractedText = parts.join('\n\n');
    console.log(`[Worker] Reconstructed ${extractedText.length} chars of text from OCR analysis for Q&A | file=${file.originalName}`);
  }

  // 10. Update file status to analysed + save document description, key terms, missing info, extracted text
  await prisma.docSummaryFile.update({
    where: { id: fileId },
    data: {
      status: 'analysed',
      pageCount,
      documentDescription: analysisResult.documentDescription || null,
      extractedText: extractedText || null,
      keyTerms: analysisResult.keyTerms?.length ? JSON.parse(JSON.stringify(analysisResult.keyTerms)) : undefined,
      missingInformation: analysisResult.missingInformation?.length ? JSON.parse(JSON.stringify(analysisResult.missingInformation)) : undefined,
    },
  });
  await setFileStatus(jobId, fileId, 'analysed');

  // 10. Increment processed count
  await prisma.docSummaryJob.update({
    where: { id: jobId },
    data: { processedCount: { increment: 1 } },
  });

  console.log(
    `[Worker] Analysis done | jobId=${jobId} | file=${file.originalName} | ` +
    `findings=${analysisResult.findings.length} | model=${analysisResult.model}`,
  );
}

// ─── PDF to image conversion ────────────────────────────────────────────────

const MAX_PDF_PAGES = 20;

function convertPdfToImages(pdfBuffer: Buffer): string[] {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf2img-'));
  try {
    const inputPath = path.join(tmpDir, 'input.pdf');
    const outputPrefix = path.join(tmpDir, 'page');
    fs.writeFileSync(inputPath, pdfBuffer);

    execSync(
      `pdftoppm -png -r 200 -l ${MAX_PDF_PAGES} "${inputPath}" "${outputPrefix}"`,
      { timeout: 120_000, stdio: 'pipe' },
    );

    const pngFiles = fs.readdirSync(tmpDir)
      .filter(f => f.startsWith('page') && f.endsWith('.png'))
      .sort();

    if (pngFiles.length === 0) {
      throw new Error('pdftoppm produced no PNG output');
    }

    const images: string[] = [];
    for (const pngFile of pngFiles) {
      const pngData = fs.readFileSync(path.join(tmpDir, pngFile));
      images.push(`data:image/png;base64,${pngData.toString('base64')}`);
    }

    return images;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function markFileFailed(jobId: string, fileId: string, errorMessage: string): Promise<void> {
  await prisma.docSummaryFile.update({
    where: { id: fileId },
    data: { status: 'failed', errorMessage },
  });
  await setFileStatus(jobId, fileId, 'failed');
  await prisma.docSummaryJob.update({
    where: { id: jobId },
    data: { failedCount: { increment: 1 } },
  });
}

async function checkJobCompletion(jobId: string): Promise<void> {
  const job = await prisma.docSummaryJob.findUnique({
    where: { id: jobId },
    include: { files: { select: { status: true } } },
  });
  if (!job) return;

  const allDone = job.files.every(f => f.status === 'analysed' || f.status === 'failed');
  if (allDone && job.files.length > 0) {
    await prisma.docSummaryJob.update({
      where: { id: jobId },
      data: { status: 'complete' },
    });
    await setJobStatus(jobId, 'complete');
    console.log(`[Worker] Job complete | jobId=${jobId}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Start ──────────────────────────────────────────────────────────────────

// ─── Bank Statement Processing ───────────────────────────────────────────────

const BANK_EXTRACTION_PROMPT = `You are an expert bank statement data extractor. The text below was extracted from a PDF bank statement. The text may be jumbled because PDF table layouts extract imperfectly — column values may appear out of order or on separate lines. Your job is to intelligently reconstruct the transactions.

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
    {"date": "2025-01-15", "description": "Direct Debit - Electric Co", "reference": "DD123", "debit": 150.00, "credit": 0, "balance": 4850.00}
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
- If you see columns like "Money In" / "Money Out" or "Paid In" / "Paid Out", map these to credit/debit`;

async function processBankStatement(msg: BankStatementParseMessage): Promise<void> {
  const { populationId, storagePath, containerName, fileName } = msg;

  console.log(`[Worker:BankStatement] Downloading ${fileName} from blob...`);

  // Download PDF from Azure Blob
  const buffer = await downloadBlob(storagePath, containerName);

  // Extract text — try multiple methods
  let extractedText = '';

  // Method 1: unpdf
  try {
    const { extractText } = await import('unpdf');
    const result = await extractText(new Uint8Array(buffer));
    const pages = Array.isArray(result.text) ? result.text : [String(result.text || '')];
    extractedText = pages.join('\n\n');
    console.log(`[Worker:BankStatement] unpdf extracted ${extractedText.length} chars`);
  } catch (e) {
    console.log(`[Worker:BankStatement] unpdf failed: ${e instanceof Error ? e.message : e}`);
  }

  // Method 2: pdftoppm + vision (worker has poppler available in Docker)
  if (extractedText.length < 10) {
    console.log(`[Worker:BankStatement] Text too short, trying pdftoppm + vision...`);
    const tmpDir = path.join(os.tmpdir(), `bank-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    const pdfPath = path.join(tmpDir, 'statement.pdf');
    fs.writeFileSync(pdfPath, buffer);

    try {
      execSync(`pdftoppm -jpeg -r 200 "${pdfPath}" "${path.join(tmpDir, 'page')}"`, { timeout: 60000 });
      const pageFiles = fs.readdirSync(tmpDir).filter(f => f.startsWith('page') && f.endsWith('.jpg')).sort();

      if (pageFiles.length > 0) {
        const apiKey = process.env.TOGETHER_DOC_SUMMARY_KEY || process.env.TOGETHER_API_KEY;
        if (apiKey) {
          const client = new OpenAI({ apiKey, baseURL: 'https://api.together.xyz/v1' });
          const allTransactions: Record<string, unknown>[] = [];
          let metadata: Record<string, unknown> = {};

          for (let pi = 0; pi < pageFiles.length; pi++) {
            const imgData = fs.readFileSync(path.join(tmpDir, pageFiles[pi]));
            const base64 = imgData.toString('base64');
            const prompt = pi === 0 ? BANK_EXTRACTION_PROMPT : 'Continue extracting transactions. Same JSON format.';

            const result = await client.chat.completions.create({
              model: 'meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8',
              messages: [{ role: 'user', content: [
                { type: 'text', text: prompt },
                { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}` } },
              ] }],
              max_tokens: 8000,
              temperature: 0.1,
            });

            const content = (result.choices?.[0]?.message?.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              try {
                const parsed = JSON.parse(jsonMatch[0]);
                if (pi === 0) { metadata = { ...parsed }; delete metadata.transactions; }
                if (Array.isArray(parsed.transactions)) allTransactions.push(...parsed.transactions);
              } catch { /* skip */ }
            }
          }

          // Store results
          if (allTransactions.length > 0) {
            await storeParseResults(populationId, allTransactions, metadata, fileName);
            // Cleanup
            fs.readdirSync(tmpDir).forEach(f => fs.unlinkSync(path.join(tmpDir, f)));
            fs.rmdirSync(tmpDir);
            return;
          }
        }
      }
    } catch (e) {
      console.log(`[Worker:BankStatement] pdftoppm failed: ${e instanceof Error ? e.message : e}`);
    }

    // Cleanup
    try { fs.readdirSync(tmpDir).forEach(f => fs.unlinkSync(path.join(tmpDir, f))); fs.rmdirSync(tmpDir); } catch { /* */ }
  }

  // If we have text, send to AI for extraction
  if (extractedText.length >= 10) {
    console.log(`[Worker:BankStatement] Sending ${extractedText.length} chars to AI...`);
    const apiKey = process.env.TOGETHER_DOC_SUMMARY_KEY || process.env.TOGETHER_API_KEY;
    if (!apiKey) throw new Error('AI API key not configured');

    const client = new OpenAI({ apiKey, baseURL: 'https://api.together.xyz/v1' });

    // Split into chunks and process in parallel
    const maxChunkSize = 20000;
    const chunks: string[] = [];
    for (let i = 0; i < extractedText.length; i += maxChunkSize) {
      chunks.push(extractedText.slice(i, i + maxChunkSize));
    }

    const chunkPromises = chunks.map((chunk, ci) => {
      const prompt = ci === 0
        ? `${BANK_EXTRACTION_PROMPT}\n\n--- BANK STATEMENT TEXT (part ${ci + 1} of ${chunks.length}) ---\n${chunk}`
        : `Extract ALL transactions from this bank statement text. Return ONLY valid JSON: {"transactions": [...]} with each transaction having date, description, reference, debit, credit, balance.\n\n--- BANK STATEMENT TEXT (part ${ci + 1} of ${chunks.length}) ---\n${chunk}`;

      return client.chat.completions.create({
        model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 16000,
        temperature: 0.1,
      });
    });

    const results = await Promise.all(chunkPromises);

    const allTransactions: Record<string, unknown>[] = [];
    let metadata: Record<string, unknown> = {};

    for (let ci = 0; ci < results.length; ci++) {
      const content = (results[ci].choices?.[0]?.message?.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          if (ci === 0) { metadata = { ...parsed }; delete metadata.transactions; }
          if (Array.isArray(parsed.transactions)) allTransactions.push(...(parsed.transactions as Record<string, unknown>[]));
        } catch { /* skip malformed */ }
      }
    }

    console.log(`[Worker:BankStatement] Extracted ${allTransactions.length} transactions from ${chunks.length} chunks`);

    if (allTransactions.length === 0) {
      throw new Error('No transactions could be extracted from the bank statement');
    }

    await storeParseResults(populationId, allTransactions, metadata, fileName);
  } else {
    throw new Error('Could not extract any text from the bank statement PDF');
  }
}

async function storeParseResults(
  populationId: string,
  transactions: Record<string, unknown>[],
  metadata: Record<string, unknown>,
  fileName: string,
): Promise<void> {
  // Convert to spreadsheet-ready format
  const rows = transactions.map((t, idx) => {
    const debit = Number(t.debit) || 0;
    const credit = Number(t.credit) || 0;
    const amount = credit > 0 ? credit : -debit;
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

  const columns = ['Transaction ID', 'Date', 'Description', 'Reference', 'Debit', 'Credit', 'Amount', 'Balance'];

  await prisma.samplingPopulation.update({
    where: { id: populationId },
    data: {
      recordCount: rows.length,
      currency: String(metadata.currency || 'GBP'),
      parsedData: {
        rows,
        columns,
        metadata: {
          bankName: metadata.bankName || null,
          accountName: metadata.accountName || null,
          accountNumber: metadata.accountNumber || null,
          statementPeriod: metadata.statementPeriod || null,
          currency: metadata.currency || 'GBP',
          openingBalance: metadata.openingBalance || null,
          closingBalance: metadata.closingBalance || null,
          transactionCount: rows.length,
          fileName,
        },
      },
    },
  });

  console.log(`[Worker:BankStatement] Stored ${rows.length} rows for populationId=${populationId}`);
}

main().catch(err => {
  console.error('[Worker] Fatal error:', err);
  process.exit(1);
});
