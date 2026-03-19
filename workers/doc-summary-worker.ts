/**
 * Doc Summary Worker
 *
 * Standalone worker that polls the Azure Queue for doc-summary-analysis messages
 * and processes them. Run with: npx tsx workers/doc-summary-worker.ts
 */

import {
  receiveMessages,
  deleteMessage,
  isDeadLetter,
  QUEUES,
  type DocSummaryMessage,
} from '../lib/azure-queue';
import { prisma } from '../lib/db';
import { downloadBlob } from '../lib/azure-blob';
import {
  analyseDocumentForAudit,
  analyseDocumentFromImage,
  calculateDocSummaryCost,
} from '../lib/doc-summary-ai';
import { getKeyForJob, getDocSummaryKeyConfig, type KeyConfig } from '../lib/ai-key-manager';
import { setJobStatus, setFileStatus, closeRedis } from '../lib/redis';

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
        const { jobId, fileId, clientName, userId, clientId } = message;

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
          await processFile(jobId, fileId, clientName, userId, clientId, keyConfig);
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
      console.error(`[Worker] Poll error: ${errMsg}`);
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
    // Scanned/image PDF — send raw PDF as base64 to vision model
    console.log(
      `[Worker] Text too short (${text.length} chars), using vision mode | file=${file.originalName}`,
    );
    const base64Pdf = Buffer.from(pdfBuffer).toString('base64');
    analysisResult = await analyseDocumentFromImage(
      base64Pdf,
      file.originalName,
      clientName,
      file.mimeType || 'application/pdf',
    );
  } else {
    analysisResult = await analyseDocumentForAudit(text, file.originalName, clientName);
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

  // 9. Update file status to analysed
  await prisma.docSummaryFile.update({
    where: { id: fileId },
    data: { status: 'analysed', pageCount },
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

main().catch(err => {
  console.error('[Worker] Fatal error:', err);
  process.exit(1);
});
