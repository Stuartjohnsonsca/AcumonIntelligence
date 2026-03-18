import { NextResponse, after } from 'next/server';
import { auth } from '@/lib/auth';
import { getAttachmentsList, downloadAttachment } from '@/lib/xero';
import { prisma } from '@/lib/db';
import { uploadToInbox, generateBlobName, CONTAINERS } from '@/lib/azure-blob';
import { isSupportedForExtraction, getMimeType } from '@/lib/gemini-extractor';
import { verifyClientAccess } from '@/lib/client-access';
import { createHash } from 'crypto';

export const maxDuration = 300;

const XERO_CONCURRENCY = 3;
const XERO_CALL_DELAY_MS = 500;
const EXTRACTION_BATCH_SIZE = 5;

interface TransactionRef {
  id: string;
  type: 'Invoice' | 'BankTransaction';
  hasAttachments: boolean;
}

function computeHash(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

async function runWithConcurrency<T>(
  tasks: (() => Promise<T>)[],
  limit: number,
  delayMs = 0,
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(tasks.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < tasks.length) {
      const idx = nextIndex++;
      if (delayMs > 0 && idx > 0) {
        await new Promise(r => setTimeout(r, delayMs));
      }
      try {
        results[idx] = { status: 'fulfilled', value: await tasks[idx]() };
      } catch (reason) {
        results[idx] = { status: 'rejected', reason };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, () => worker()));
  return results;
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
      let extractionStarted = 0;

      const extractionQueue: string[] = [];
      let extractionRunning = false;

      async function flushExtractionQueue() {
        if (extractionRunning || extractionQueue.length === 0) return;
        extractionRunning = true;
        try {
          while (extractionQueue.length > 0) {
            const batch = extractionQueue.splice(0, EXTRACTION_BATCH_SIZE);
            try {
              const baseUrl = process.env.NEXTAUTH_URL || 'https://acumon-intelligence.vercel.app';
              await fetch(`${baseUrl}/api/extraction/process-batch`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  jobId: job.id,
                  fileIds: batch,
                  startIndex: extractionStarted,
                  clientId,
                  internalSecret: process.env.NEXTAUTH_SECRET,
                }),
              });
              extractionStarted += batch.length;
            } catch (err) {
              console.error(`[XeroAttachments] Batch extraction error:`, err);
            }
          }
        } finally {
          extractionRunning = false;
        }
      }

      // Phase 1: List attachments for all transactions in parallel
      const listTasks = withAttachments.map(txn => async () => {
        const endpoint: 'Invoices' | 'BankTransactions' = txn.type === 'Invoice' ? 'Invoices' : 'BankTransactions';
        try {
          const attachments = await getAttachmentsList(clientId, endpoint, txn.id);
          return { txn, endpoint, attachments, error: null as string | null };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { txn, endpoint, attachments: [] as { FileName: string; ContentLength: number; MimeType: string }[], error: msg };
        }
      });

      await prisma.backgroundTask.update({
        where: { id: task.id },
        data: { progress: { phase: 'listing', current: 0, total: withAttachments.length } },
      });

      const listResults = await runWithConcurrency(listTasks, XERO_CONCURRENCY, XERO_CALL_DELAY_MS);

      // Check for 403 errors first
      for (const r of listResults) {
        if (r.status !== 'fulfilled') continue;
        const { error } = r.value;
        if (error && (error.includes('403') || error.includes('scope') || error.includes('Forbidden'))) {
          await prisma.backgroundTask.update({
            where: { id: task.id },
            data: {
              status: 'error',
              error: 'Xero connection does not have permission to read attachments. Please disconnect and reconnect Xero to grant the required scope (accounting.attachments.read).',
            },
          });
          return;
        }
        if (error) {
          listFailures++;
          if (!firstListError) firstListError = error;
        }
      }

      // Build flat list of all attachments to download
      interface DownloadItem {
        txn: TransactionRef;
        endpoint: 'Invoices' | 'BankTransactions';
        fileName: string;
      }
      const downloadItems: DownloadItem[] = [];

      for (const r of listResults) {
        if (r.status !== 'fulfilled' || r.value.error) continue;
        for (const att of r.value.attachments) {
          totalAttachments++;
          if (isSupportedForExtraction(att.FileName)) {
            downloadItems.push({
              txn: r.value.txn,
              endpoint: r.value.endpoint,
              fileName: att.FileName,
            });
          } else {
            skipped++;
          }
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

      // Phase 2: Download attachments in parallel, queue extraction as each completes
      await prisma.backgroundTask.update({
        where: { id: task.id },
        data: { progress: { phase: 'downloading', current: 0, total: downloadItems.length } },
      });

      const downloadTasks = downloadItems.map(item => async () => {
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
            return { status: 'duplicate' as const };
          }

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
          downloaded++;

          // Queue for extraction immediately
          extractionQueue.push(fileRecord.id);
          if (extractionQueue.length >= EXTRACTION_BATCH_SIZE) {
            flushExtractionQueue();
          }

          await prisma.backgroundTask.update({
            where: { id: task.id },
            data: {
              progress: { phase: 'downloading', current: downloaded, total: downloadItems.length },
            },
          });

          return { status: 'downloaded' as const, fileId: fileRecord.id };
        } catch (err) {
          console.error(`[XeroAttachments] Failed to download ${item.fileName}:`, err);
          skipped++;
          return { status: 'skipped' as const };
        }
      });

      await runWithConcurrency(downloadTasks, XERO_CONCURRENCY, XERO_CALL_DELAY_MS);

      // Flush any remaining files in extraction queue
      if (extractionQueue.length > 0) {
        await flushExtractionQueue();
      }

      const uniqueCount = downloaded;
      await prisma.extractionJob.update({
        where: { id: job.id },
        data: { totalFiles: uniqueCount, duplicateCount },
      });

      if (uniqueCount === 0) {
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

      // Phase 3: Wait for extraction to complete (batches already dispatched concurrently)
      await prisma.backgroundTask.update({
        where: { id: task.id },
        data: { progress: { phase: 'extracting', current: 0, total: uniqueCount } },
      });

      let extractionDone = false;
      const pollStart = Date.now();
      const maxWaitMs = 10 * 60 * 1000;

      while (!extractionDone && Date.now() - pollStart < maxWaitMs) {
        await new Promise(r => setTimeout(r, 3000));
        const updatedJob = await prisma.extractionJob.findUnique({
          where: { id: job.id },
          select: { processedCount: true, failedCount: true, totalFiles: true },
        });
        if (!updatedJob) break;
        if (updatedJob.processedCount + updatedJob.failedCount >= updatedJob.totalFiles) {
          extractionDone = true;
        }
        await prisma.backgroundTask.update({
          where: { id: task.id },
          data: {
            progress: {
              phase: 'extracting',
              current: updatedJob.processedCount + updatedJob.failedCount,
              total: updatedJob.totalFiles,
            },
          },
        });
      }

      const finalJob = await prisma.extractionJob.findUnique({
        where: { id: job.id },
        select: { processedCount: true, failedCount: true },
      });

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

  const result = task.result as Record<string, unknown> | null;
  const progress = task.progress as Record<string, unknown> | null;

  return NextResponse.json({
    status: task.status,
    data: task.status === 'completed' ? result : undefined,
    progress,
    error: task.error,
  });
}
