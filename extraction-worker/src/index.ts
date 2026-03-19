/**
 * Acumon Extraction Worker — self-contained.
 */

console.error('[BOOT] Starting worker...');
console.error('[BOOT] NODE_PATH=' + process.env.NODE_PATH);
console.error('[BOOT] DATABASE_URL=' + (process.env.DATABASE_URL ? 'set' : 'NOT SET'));
console.error('[BOOT] TOGETHER_API_KEY=' + (process.env.TOGETHER_API_KEY ? 'set' : 'NOT SET'));

// Use require to control load order and catch import errors
let PrismaClient: any;
try {
  const prismaModule = require('@prisma/client');
  PrismaClient = prismaModule.PrismaClient;
  console.error('[BOOT] @prisma/client loaded');
} catch (err: any) {
  console.error('[BOOT] FATAL: Cannot load @prisma/client:', err.message);
  console.error(err.stack);
  // Keep process alive so logs are captured
  setTimeout(() => process.exit(1), 5000);
  throw err;
}

const prisma = new PrismaClient({ log: ['error'] });
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '3000', 10);

async function pollForTasks(): Promise<void> {
  const task = await prisma.backgroundTask.findFirst({
    where: {
      status: 'pending',
      type: { in: ['xero-attachments', 'extraction-batch'] },
    },
    orderBy: { createdAt: 'asc' },
  });

  if (!task) return;

  console.log(`[Worker] Picked up task ${task.id} | type=${task.type}`);

  await prisma.backgroundTask.update({
    where: { id: task.id },
    data: { status: 'running' },
  });

  try {
    if (task.type === 'xero-attachments') {
      const { processXeroAttachments } = require('./xero-pipeline');
      await processXeroAttachments(prisma, task);
    }

    await prisma.backgroundTask.update({
      where: { id: task.id },
      data: { status: 'completed' },
    });
    console.log(`[Worker] Task ${task.id} completed`);
  } catch (err: any) {
    console.error(`[Worker] Task ${task.id} failed:`, err.message);
    await prisma.backgroundTask.update({
      where: { id: task.id },
      data: { status: 'error', error: err.message || String(err) },
    });
  }
}

async function main(): Promise<void> {
  console.error('[BOOT] Testing database connection...');

  try {
    await prisma.$queryRaw`SELECT 1`;
    console.error('[BOOT] Database connected OK');
  } catch (err: any) {
    console.error('[BOOT] Database connection FAILED:', err.message);
    // Stay alive for log capture
    await new Promise(r => setTimeout(r, 10000));
    process.exit(1);
  }

  console.log('[Worker] Polling for tasks...');

  process.on('SIGINT', async () => { await prisma.$disconnect(); process.exit(0); });
  process.on('SIGTERM', async () => { await prisma.$disconnect(); process.exit(0); });

  while (true) {
    try {
      await pollForTasks();
    } catch (err: any) {
      console.error('[Worker] Poll error:', err.message);
    }
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }
}

main().catch(err => {
  console.error('[BOOT] Fatal error:', err);
  setTimeout(() => process.exit(1), 10000);
});
