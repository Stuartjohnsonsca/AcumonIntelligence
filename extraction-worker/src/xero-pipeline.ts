/**
 * Xero attachment download pipeline.
 * Runs on the dedicated worker — no timeout constraints.
 */

import { PrismaClient } from '@prisma/client';
import { getAttachmentsList, downloadAttachment } from '../../lib/xero';
import { uploadToInbox, generateBlobName, CONTAINERS } from '../../lib/azure-blob';
import { isSupportedForExtraction, getMimeType } from '../../lib/ai-extractor';
import { createHash } from 'crypto';
import { processExtractionBatch } from './ai-pipeline';

const XERO_CALL_DELAY_MS = 600;
const EXTRACTION_BATCH_SIZE = 5;

interface TransactionRef {
  id: string;
  type: 'Invoice' | 'BankTransaction';
  hasAttachments: boolean;
}

export async function processXeroAttachments(
  prisma: PrismaClient,
  task: { id: string; clientId: string | null; result: unknown },
): Promise<void> {
  const meta = task.result as { transactions?: TransactionRef[]; clientId?: string } | null;
  const clientId = task.clientId || meta?.clientId;
  const transactions = meta?.transactions || [];

  if (!clientId || transactions.length === 0) {
    throw new Error('Missing clientId or transactions');
  }

  const withAttachments = transactions.filter(t => t.hasAttachments);
  console.log(`[Xero] Starting attachment extraction | clientId=${clientId} | txns=${withAttachments.length}/${transactions.length}`);

  // Update progress
  const updateProgress = (progress: Record<string, unknown>) =>
    prisma.backgroundTask.update({
      where: { id: task.id },
      data: { progress: progress as never },
    });

  // Phase 1: List attachments
  await updateProgress({ phase: 'listing', current: 0, total: withAttachments.length });

  const filesToDownload: {
    txnId: string;
    endpoint: 'Invoices' | 'BankTransactions';
    fileName: string;
    mimeType: string;
  }[] = [];

  for (let i = 0; i < withAttachments.length; i++) {
    const txn = withAttachments[i];
    const endpoint = txn.type === 'Invoice' ? 'Invoices' : 'BankTransactions';

    try {
      const attachments = await getAttachmentsList(clientId, endpoint, txn.id);
      for (const att of attachments) {
        if (isSupportedForExtraction(att.FileName)) {
          filesToDownload.push({
            txnId: txn.id,
            endpoint,
            fileName: att.FileName,
            mimeType: att.MimeType || getMimeType(att.FileName),
          });
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('403') || msg.includes('Forbidden')) {
        throw new Error('Xero permission denied. Ensure accounting.attachments.read scope is authorised.');
      }
      console.warn(`[Xero] Failed to list attachments for ${txn.id}: ${msg}`);
    }

    if (i % 5 === 0) {
      await updateProgress({ phase: 'listing', current: i + 1, total: withAttachments.length });
    }
    await new Promise(r => setTimeout(r, XERO_CALL_DELAY_MS));
  }

  if (filesToDownload.length === 0) {
    console.log('[Xero] No supported attachments found');
    await updateProgress({ phase: 'complete', current: 0, total: 0 });
    return;
  }

  console.log(`[Xero] Found ${filesToDownload.length} files to download`);

  // Create extraction job
  const expiresAt = new Date(Date.now() + 121 * 24 * 60 * 60 * 1000);
  const job = await prisma.extractionJob.create({
    data: {
      clientId,
      userId: (await prisma.backgroundTask.findUnique({ where: { id: task.id }, select: { userId: true } }))?.userId || '',
      status: 'processing',
      totalFiles: filesToDownload.length,
      accountingSystem: 'xero',
      expiresAt,
    },
  });

  // Phase 2: Download and upload to Azure
  await updateProgress({ phase: 'downloading', current: 0, total: filesToDownload.length, downloaded: 0 });

  const seenHashes = new Map<string, string>(); // hash → fileId
  const batchFileIds: string[] = [];
  let downloaded = 0;

  for (let i = 0; i < filesToDownload.length; i++) {
    const file = filesToDownload[i];

    try {
      const { buffer, mimeType } = await downloadAttachment(
        clientId, file.endpoint, file.txnId, file.fileName,
      );

      // Hash for deduplication
      const hash = createHash('sha256').update(buffer).digest('hex');

      if (seenHashes.has(hash)) {
        // Duplicate file
        await prisma.extractionFile.create({
          data: {
            jobId: job.id,
            originalName: file.fileName,
            storagePath: '',
            containerName: '',
            mimeType,
            fileSize: buffer.length,
            status: 'multi-line',
            fileHash: hash,
            duplicateOfId: seenHashes.get(hash),
          },
        });
        await prisma.extractionJob.update({
          where: { id: job.id },
          data: { duplicateCount: { increment: 1 } },
        });
      } else {
        // Upload to Azure Blob (path includes clientId for isolation)
        const blobName = `${clientId}/${generateBlobName(job.id, file.fileName)}`;
        await uploadToInbox(buffer, blobName, mimeType);

        const extractionFile = await prisma.extractionFile.create({
          data: {
            jobId: job.id,
            originalName: file.fileName,
            storagePath: blobName,
            containerName: CONTAINERS.INBOX,
            mimeType,
            fileSize: buffer.length,
            status: 'uploaded',
            fileHash: hash,
          },
        });

        seenHashes.set(hash, extractionFile.id);
        batchFileIds.push(extractionFile.id);
      }

      downloaded++;
    } catch (err) {
      console.warn(`[Xero] Download failed for ${file.fileName}: ${err instanceof Error ? err.message : err}`);
      await prisma.extractionFile.create({
        data: {
          jobId: job.id,
          originalName: file.fileName,
          storagePath: '',
          containerName: '',
          mimeType: file.mimeType,
          status: 'failed',
          errorMessage: err instanceof Error ? err.message : String(err),
        },
      });
      await prisma.extractionJob.update({
        where: { id: job.id },
        data: { failedCount: { increment: 1 } },
      });
    }

    await updateProgress({
      phase: 'downloading',
      current: i + 1,
      total: filesToDownload.length,
      downloaded,
    });

    await new Promise(r => setTimeout(r, XERO_CALL_DELAY_MS));

    // Process batch when enough files accumulated
    if (batchFileIds.length >= EXTRACTION_BATCH_SIZE) {
      const batch = batchFileIds.splice(0, EXTRACTION_BATCH_SIZE);
      console.log(`[Xero] Processing batch of ${batch.length} files`);
      await processExtractionBatch(prisma, job.id, batch, clientId);
    }
  }

  // Process remaining files
  if (batchFileIds.length > 0) {
    console.log(`[Xero] Processing final batch of ${batchFileIds.length} files`);
    await processExtractionBatch(prisma, job.id, batchFileIds, clientId);
  }

  // Update job status
  const finalJob = await prisma.extractionJob.findUnique({
    where: { id: job.id },
    select: { processedCount: true, failedCount: true, totalFiles: true },
  });

  const finalStatus = (finalJob?.processedCount || 0) > 0 ? 'complete' : 'failed';
  await prisma.extractionJob.update({
    where: { id: job.id },
    data: {
      status: finalStatus,
      extractedAt: new Date(),
    },
  });

  // Store job ID and noDocsTxnIds in task result for the client to pick up
  const noDocsTxnIds = transactions
    .filter(t => !t.hasAttachments)
    .map(t => t.id);

  await prisma.backgroundTask.update({
    where: { id: task.id },
    data: {
      result: {
        jobId: job.id,
        noDocsTxnIds,
        downloaded,
        totalFiles: filesToDownload.length,
      } as never,
    },
  });

  console.log(`[Xero] Pipeline complete | jobId=${job.id} | status=${finalStatus} | downloaded=${downloaded} | total=${filesToDownload.length}`);
}
