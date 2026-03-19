/**
 * Acumon Extraction Worker
 *
 * Runs as a long-lived server process (Azure Container Instance).
 * Polls the database for pending extraction tasks and processes them
 * without the timeout constraints of Vercel serverless.
 */

import { PrismaClient } from '@prisma/client';
import { processXeroAttachments } from './xero-pipeline';
import { processExtractionBatch } from './ai-pipeline';

const prisma = new PrismaClient();

const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '3000', 10);
const WORKER_ID = `worker-${process.pid}-${Date.now().toString(36)}`;

async function pollForTasks(): Promise<void> {
  // Look for pending background tasks (xero-attachments type)
  const task = await prisma.backgroundTask.findFirst({
    where: {
      status: 'pending',
      type: { in: ['xero-attachments', 'extraction-batch'] },
    },
    orderBy: { createdAt: 'asc' },
  });

  if (!task) return;

  console.log(`[Worker:${WORKER_ID}] Picked up task ${task.id} | type=${task.type} | client=${task.clientId}`);

  // Mark as running
  await prisma.backgroundTask.update({
    where: { id: task.id },
    data: { status: 'running' },
  });

  try {
    if (task.type === 'xero-attachments') {
      await processXeroAttachments(prisma, task);
    } else if (task.type === 'extraction-batch') {
      const meta = task.result as { jobId?: string; fileIds?: string[]; clientId?: string } | null;
      if (meta?.jobId && meta?.fileIds && meta?.clientId) {
        await processExtractionBatch(prisma, meta.jobId, meta.fileIds, meta.clientId);
      }
    }

    await prisma.backgroundTask.update({
      where: { id: task.id },
      data: { status: 'completed' },
    });

    console.log(`[Worker:${WORKER_ID}] Task ${task.id} completed`);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[Worker:${WORKER_ID}] Task ${task.id} failed:`, errorMsg);

    await prisma.backgroundTask.update({
      where: { id: task.id },
      data: { status: 'error', error: errorMsg },
    });
  }
}

async function main(): Promise<void> {
  console.log(`[Worker:${WORKER_ID}] Starting extraction worker...`);
  console.log(`[Worker:${WORKER_ID}] Poll interval: ${POLL_INTERVAL_MS}ms`);
  console.log(`[Worker:${WORKER_ID}] Database connected`);

  // Graceful shutdown
  const shutdown = async () => {
    console.log(`[Worker:${WORKER_ID}] Shutting down...`);
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Main loop
  while (true) {
    try {
      await pollForTasks();
    } catch (err) {
      console.error(`[Worker:${WORKER_ID}] Poll error:`, err instanceof Error ? err.message : err);
    }
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }
}

main().catch(err => {
  console.error('Fatal worker error:', err);
  process.exit(1);
});
