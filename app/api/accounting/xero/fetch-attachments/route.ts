import { NextResponse, after } from 'next/server';
import { auth } from '@/lib/auth';
import { getAttachmentsList, downloadAttachment } from '@/lib/xero';
import { prisma } from '@/lib/db';
import { uploadToInbox, generateBlobName, CONTAINERS } from '@/lib/azure-blob';
import { isSupportedForExtraction, getMimeType } from '@/lib/gemini-extractor';
import { verifyClientAccess } from '@/lib/client-access';
import { createHash } from 'crypto';

export const maxDuration = 300;

const XERO_CONCURRENCY = 2;
const XERO_CALL_DELAY_MS = 600;
const EXTRACTION_BATCH_SIZE = 5;

interface TransactionRef {
  id: string;
  type: 'Invoice' | 'BankTransaction';
  hasAttachments: boolean;
}

function computeHash(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const body = await req.json();
  const { clientId, transactions } = body as {
    clientId: string;
    transactions: TransactionRef[];
  };

  if (!clientId || !transactions?.length) {
    return NextResponse.json({ error: 'clientId and transactions required' }, { status: 400 });
  }

  const access = await verifyClientAccess(session.user as { id: string; firmId: string; isSuperAdmin?: boolean }, clientId);
  if (!access.allowed) {
    return NextResponse.json({ error: access.reason || 'Forbidden' }, { status: 403 });
  }

  const task = await prisma.backgroundTask.create({
    data: {
      userId: session.user.id,
      clientId,
      type: 'xero-attachments',
      status: 'running',
    },
  });

  after(async () => {
    try {
      const withAttachments = transactions.filter(t => t.hasAttachments);
      const noDocsTxnIds = transactions.filter(t => !t.hasAttachments).map(t => t.id);

      if (withAttachments.length === 0) {
        await prisma.backgroundTask.update({
          where: { id: task.id },
          data: {
            status: 'completed',
            result: {
              jobId: '',
              totalAttachments: 0,
              downloaded: 0,
              extracted: 0,
              failed: 0,
              skipped: 0,
              noDocsTxnIds,
            },
          },
        });
        return;
      }

      const expiresAt = new Date(Date.now() + 121 * 24 * 60 * 60 * 1000);
      const job = await prisma.extractionJob.create({
        data: {
          clientId,
          userId: session.user.id,
          status: 'pending',
          expiresAt,
          accountingSystem: 'xero',
          orgName: 'Xero Attachments',
        },
      });

      const seenHashes = new Map<string, string>();
      let totalAttachments = 0;
      let downloaded = 0;
      let skipped = 0;
      let duplicateCount = 0;
      let listFailures = 0;
      let firstListError = '';

      // Phase 1: List attachments sequentially to avoid Xero rate limits
      await prisma.backgroundTask.update({
        where: { id: task.id },
        data: { progress: { phase: 'listing', current: 0, total: withAttachments.length, downloaded: 0, extracted: 0 } },
      });

      interface AttachmentInfo { txn: TransactionRef; endpoint: 'Invoices' | 'BankTransactions'; fileName: string }
      const downloadItems: AttachmentInfo[] = [];
      let listed = 0;

      for (const txn of withAttachments) {
        const endpoint: 'Invoices' | 'BankTransactions' = txn.type === 'Invoice' ? 'Invoices' : 'BankTransactions';
        await new Promise(r => setTimeout(r, XERO_CALL_DELAY_MS));

        try {
          const attachments = await getAttachmentsList(clientId, endpoint, txn.id);
          for (const att of attachments) {
            totalAttachments++;
            if (isSupportedForExtraction(att.FileName)) {
              downloadItems.push({ txn, endpoint, fileName: att.FileName });
            } else {
              skipped++;
            }
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          listFailures++;
          if (!firstListError) firstListError = msg;
          if (msg.includes('403') || msg.includes('scope') || msg.includes('Forbidden')) {
            await prisma.backgroundTask.update({
              where: { id: task.id },
              data: {
                status: 'error',
                error: 'Xero connection does not have permission to read attachments. Please disconnect and reconnect Xero to grant the required scope (accounting.attachments.read).',
              },
            });
            return;
          }
        }

        listed++;
        if (listed % 5 === 0 || listed === withAttachments.length) {
          await prisma.backgroundTask.update({
            where: { id: task.id },
            data: { progress: { phase: 'listing', current: listed, total: withAttachments.length, downloaded: 0, extracted: 0 } },
          });
        }
      }

      if (listFailures > 0 && totalAttachments === 0 && downloadItems.length === 0) {
        await prisma.backgroundTask.update({
          where: { id: task.id },
          data: {
            status: 'error',
            error: `Failed to list attachments for ${listFailures} transaction(s). ${firstListError.includes('403') ? 'The Xero connection may need to be re-authorised with the attachments scope.' : firstListError}`,
          },
        });
        return;
      }

      if (downloadItems.length === 0) {
        await prisma.extractionJob.update({
          where: { id: job.id },
          data: { status: 'complete', extractedAt: new Date(), totalFiles: 0 },
        });
        await prisma.backgroundTask.update({
          where: { id: task.id },
          data: {
            status: 'completed',
            result: { jobId: job.id, totalAttachments, downloaded: 0, extracted: 0, failed: 0, skipped, noDocsTxnIds },
          },
        });
        return;
      }

      // Phase 2: Download and extract concurrently
      // Download one at a time (Xero rate limits), but dispatch extraction batches immediately
      const totalToDownload = downloadItems.length;
      const consistentTotal = totalToDownload;
      const fileIds: string[] = [];

      await prisma.backgroundTask.update({
        where: { id: task.id },
        data: { progress: { phase: 'downloading', current: 0, total: consistentTotal, downloaded: 0, extracted: 0 } },
      });

      for (let i = 0; i < downloadItems.length; i++) {
        const item = downloadItems[i];
        await new Promise(r => setTimeout(r, XERO_CALL_DELAY_MS));

        try {
          const { buffer, mimeType } = await downloadAttachment(clientId, item.endpoint, item.txn.id, item.fileName);
          const hash = computeHash(buffer);
          const existingId = seenHashes.get(hash);

          if (existingId) {
            await prisma.extractionFile.create({
              data: {
                jobId: job.id,
                originalName: item.fileName,
                storagePath: '',
                containerName: '',
                fileSize: buffer.length,
                mimeType: mimeType || getMimeType(item.fileName),
                status: 'duplicate',
                fileHash: hash,
                duplicateOfId: existingId,
              },
            });
            duplicateCount++;
          } else {
            const blobName = generateBlobName(job.id, item.fileName);
            await uploadToInbox(blobName, buffer, mimeType || getMimeType(item.fileName));

            const fileRecord = await prisma.extractionFile.create({
              data: {
                jobId: job.id,
                originalName: item.fileName,
                storagePath: blobName,
                containerName: CONTAINERS.INBOX,
                fileSize: buffer.length,
                mimeType: mimeType || getMimeType(item.fileName),
                status: 'uploaded',
                fileHash: hash,
              },
            });

            seenHashes.set(hash, fileRecord.id);
            fileIds.push(fileRecord.id);
            downloaded++;
          }
        } catch (err) {
          console.error(`[XeroAttachments] Failed to download ${item.fileName}:`, err);
          skipped++;
        }

        // Dispatch extraction batch as soon as we have enough files
        if (fileIds.length >= EXTRACTION_BATCH_SIZE) {
          const batch = fileIds.splice(0, EXTRACTION_BATCH_SIZE);
          await prisma.extractionJob.update({
            where: { id: job.id },
            data: { totalFiles: { increment: batch.length } },
          });
          dispatchExtractionBatch(job.id, batch, clientId);
        }

        // Update progress every file
        const extractedSoFar = await getExtractionProgress(job.id);
        await prisma.backgroundTask.update({
          where: { id: task.id },
          data: {
            progress: {
              phase: 'downloading',
              current: i + 1,
              total: consistentTotal,
              downloaded,
              extracted: extractedSoFar,
              skipped: skipped + duplicateCount,
            },
          },
        });
      }

      // Flush remaining files
      if (fileIds.length > 0) {
        await prisma.extractionJob.update({
          where: { id: job.id },
          data: { totalFiles: { increment: fileIds.length } },
        });
        dispatchExtractionBatch(job.id, [...fileIds], clientId);
        fileIds.length = 0;
      }

      await prisma.extractionJob.update({
        where: { id: job.id },
        data: { duplicateCount },
      });

      // Phase 3: Wait for extraction to finish
      const totalFiles = downloaded;
      if (totalFiles === 0) {
        await prisma.extractionJob.update({
          where: { id: job.id },
          data: { status: 'complete', extractedAt: new Date() },
        });
        await prisma.backgroundTask.update({
          where: { id: task.id },
          data: {
            status: 'completed',
            result: { jobId: job.id, totalAttachments, downloaded: 0, extracted: 0, failed: 0, skipped, noDocsTxnIds },
          },
        });
        return;
      }

      let extractionDone = false;
      const pollStart = Date.now();
      const maxWaitMs = 15 * 60 * 1000;

      while (!extractionDone && Date.now() - pollStart < maxWaitMs) {
        await new Promise(r => setTimeout(r, 4000));
        const updatedJob = await prisma.extractionJob.findUnique({
          where: { id: job.id },
          select: { processedCount: true, failedCount: true, totalFiles: true },
        });
        if (!updatedJob) break;

        const completed = updatedJob.processedCount + updatedJob.failedCount;
        if (completed >= updatedJob.totalFiles && updatedJob.totalFiles > 0) {
          extractionDone = true;
        }

        await prisma.backgroundTask.update({
          where: { id: task.id },
          data: {
            progress: {
              phase: 'extracting',
              current: updatedJob.processedCount + updatedJob.failedCount,
              total: downloaded,
              downloaded,
              extracted: updatedJob.processedCount,
            },
          },
        });
      }

      const finalJob = await prisma.extractionJob.findUnique({
        where: { id: job.id },
        select: { processedCount: true, failedCount: true },
      });

      if (!extractionDone) {
        await prisma.extractionJob.update({
          where: { id: job.id },
          data: { status: finalJob && finalJob.processedCount > 0 ? 'complete' : 'failed', extractedAt: new Date() },
        });
      }

      await prisma.backgroundTask.update({
        where: { id: task.id },
        data: {
          status: 'completed',
          result: {
            jobId: job.id,
            totalAttachments,
            downloaded,
            extracted: finalJob?.processedCount ?? 0,
            failed: finalJob?.failedCount ?? 0,
            skipped,
            noDocsTxnIds,
          },
        },
      });
    } catch (err) {
      console.error('[XeroAttachments] Fatal error:', err);
      await prisma.backgroundTask.update({
        where: { id: task.id },
        data: {
          status: 'error',
          error: err instanceof Error ? err.message : 'Unknown error',
        },
      });
    }
  });

  return NextResponse.json({ taskId: task.id });
}

function dispatchExtractionBatch(jobId: string, fileIds: string[], clientId: string) {
  const baseUrl = process.env.NEXTAUTH_URL || 'https://acumon-intelligence.vercel.app';
  fetch(`${baseUrl}/api/extraction/process-batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jobId,
      fileIds,
      startIndex: 0,
      clientId,
      internalSecret: process.env.NEXTAUTH_SECRET,
    }),
  }).catch(err => {
    console.error('[XeroAttachments] Extraction dispatch failed:', err);
  });
}

async function getExtractionProgress(jobId: string): Promise<number> {
  try {
    const job = await prisma.extractionJob.findUnique({
      where: { id: jobId },
      select: { processedCount: true },
    });
    return job?.processedCount ?? 0;
  } catch {
    return 0;
  }
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const taskId = searchParams.get('taskId');

  if (!taskId) {
    return NextResponse.json({ error: 'taskId required' }, { status: 400 });
  }

  const task = await prisma.backgroundTask.findUnique({
    where: { id: taskId },
  });

  if (!task) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 });
  }

  if (task.userId !== session.user.id && !session.user.isSuperAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Detect stalled tasks: running for >6 minutes with no updates
  if (task.status === 'running') {
    const stalledMs = 6 * 60 * 1000;
    const lastUpdate = task.updatedAt.getTime();
    if (Date.now() - lastUpdate > stalledMs) {
      await prisma.backgroundTask.update({
        where: { id: task.id },
        data: {
          status: 'error',
          error: 'Task appears to have stalled. Please try again.',
        },
      });
      return NextResponse.json({
        status: 'error',
        error: 'Task appears to have stalled. Please try again.',
      });
    }
  }

  const result = task.result as Record<string, unknown> | null;
  const progress = task.progress as Record<string, unknown> | null;

  return NextResponse.json({
    status: task.status,
    data: task.status === 'completed' ? result : undefined,
    progress,
    error: task.error,
  });
}
