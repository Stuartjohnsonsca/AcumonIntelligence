import { NextResponse, after } from 'next/server';
import { auth } from '@/lib/auth';
import { getAttachmentsList, downloadAttachment } from '@/lib/xero';
import { prisma } from '@/lib/db';
import { uploadToInbox, generateBlobName, CONTAINERS } from '@/lib/azure-blob';
import { isSupportedForExtraction, getMimeType } from '@/lib/gemini-extractor';
import { verifyClientAccess } from '@/lib/client-access';
import { createHash } from 'crypto';

export const maxDuration = 300;

const XERO_CALL_DELAY_MS = 1200;

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
      const fileIds: string[] = [];

      for (const txn of withAttachments) {
        const endpoint = txn.type === 'Invoice' ? 'Invoices' : 'BankTransactions';

        await new Promise(r => setTimeout(r, XERO_CALL_DELAY_MS));
        let attachments;
        try {
          attachments = await getAttachmentsList(clientId, endpoint, txn.id);
        } catch (err) {
          console.error(`[XeroAttachments] Failed to list attachments for ${endpoint}/${txn.id}:`, err);
          continue;
        }

        for (const att of attachments) {
          totalAttachments++;
          if (!isSupportedForExtraction(att.FileName)) {
            skipped++;
            continue;
          }

          await new Promise(r => setTimeout(r, XERO_CALL_DELAY_MS));

          try {
            const { buffer, mimeType } = await downloadAttachment(clientId, endpoint, txn.id, att.FileName);
            const hash = computeHash(buffer);
            const existingId = seenHashes.get(hash);

            if (existingId) {
              await prisma.extractionFile.create({
                data: {
                  jobId: job.id,
                  originalName: att.FileName,
                  storagePath: '',
                  containerName: '',
                  fileSize: buffer.length,
                  mimeType: mimeType || getMimeType(att.FileName),
                  status: 'duplicate',
                  fileHash: hash,
                  duplicateOfId: existingId,
                },
              });
              duplicateCount++;
              continue;
            }

            const blobName = generateBlobName(job.id, att.FileName);
            await uploadToInbox(blobName, buffer, mimeType || getMimeType(att.FileName));

            const fileRecord = await prisma.extractionFile.create({
              data: {
                jobId: job.id,
                originalName: att.FileName,
                storagePath: blobName,
                containerName: CONTAINERS.INBOX,
                fileSize: buffer.length,
                mimeType: mimeType || getMimeType(att.FileName),
                status: 'uploaded',
                fileHash: hash,
              },
            });

            seenHashes.set(hash, fileRecord.id);
            fileIds.push(fileRecord.id);
            downloaded++;

            await prisma.backgroundTask.update({
              where: { id: task.id },
              data: {
                progress: { phase: 'downloading', current: downloaded, total: withAttachments.length },
              },
            });
          } catch (err) {
            console.error(`[XeroAttachments] Failed to download ${att.FileName}:`, err);
            skipped++;
          }
        }
      }

      const uniqueCount = fileIds.length;
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

      await prisma.backgroundTask.update({
        where: { id: task.id },
        data: { progress: { phase: 'extracting', current: 0, total: uniqueCount } },
      });

      const batchSize = 5;
      for (let i = 0; i < fileIds.length; i += batchSize) {
        const batch = fileIds.slice(i, i + batchSize);
        try {
          const baseUrl = process.env.NEXTAUTH_URL || 'https://acumon-intelligence.vercel.app';
          await fetch(`${baseUrl}/api/extraction/process-batch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jobId: job.id,
              fileIds: batch,
              startIndex: i,
              clientId,
              internalSecret: process.env.NEXTAUTH_SECRET,
            }),
          });
        } catch (err) {
          console.error(`[XeroAttachments] Batch extraction error:`, err);
        }
      }

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
