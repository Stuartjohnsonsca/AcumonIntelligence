import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { sendExtractionExpiryReminder } from '@/lib/email';

const RETENTION_DAYS = 121;
const FIRST_REMINDER_DAYS = 40;
const FINAL_REMINDER_DAYS = 81;

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const results = { reminders40: 0, reminders81: 0, expired: 0, errors: [] as string[] };
  const baseUrl = process.env.NEXTAUTH_URL || 'https://www.acumonintelligence.com';

  try {
    // 40-day reminder: jobs created more than 40 days ago, no reminder sent yet
    const jobsFor40DayReminder = await prisma.extractionJob.findMany({
      where: {
        createdAt: { lt: daysAgo(FIRST_REMINDER_DAYS) },
        reminderSentAt: null,
        status: { in: ['complete', 'processing'] },
      },
      include: {
        user: { select: { email: true, name: true } },
        client: { select: { clientName: true } },
      },
    });

    for (const job of jobsFor40DayReminder) {
      try {
        const daysRemaining = RETENTION_DAYS - FIRST_REMINDER_DAYS;
        const downloadUrl = `${baseUrl}/tools/data-extraction?jobId=${job.id}`;
        if (job.user.email) {
          await sendExtractionExpiryReminder(
            job.user.email,
            job.user.name || 'User',
            job.client.clientName,
            daysRemaining,
            downloadUrl,
          );
        }
        await prisma.extractionJob.update({
          where: { id: job.id },
          data: { reminderSentAt: new Date() },
        });
        results.reminders40++;
      } catch (err) {
        results.errors.push(`40-day reminder failed for job ${job.id}: ${err instanceof Error ? err.message : 'Unknown'}`);
      }
    }

    // 81-day reminder: jobs created more than 81 days ago, first reminder sent, no final reminder yet
    const jobsFor81DayReminder = await prisma.extractionJob.findMany({
      where: {
        createdAt: { lt: daysAgo(FINAL_REMINDER_DAYS) },
        reminderSentAt: { not: null },
        finalReminderSentAt: null,
        status: { in: ['complete', 'processing'] },
      },
      include: {
        user: { select: { email: true, name: true } },
        client: { select: { clientName: true } },
      },
    });

    for (const job of jobsFor81DayReminder) {
      try {
        const daysRemaining = RETENTION_DAYS - FINAL_REMINDER_DAYS;
        const downloadUrl = `${baseUrl}/tools/data-extraction?jobId=${job.id}`;
        if (job.user.email) {
          await sendExtractionExpiryReminder(
            job.user.email,
            job.user.name || 'User',
            job.client.clientName,
            daysRemaining,
            downloadUrl,
          );
        }
        await prisma.extractionJob.update({
          where: { id: job.id },
          data: { finalReminderSentAt: new Date() },
        });
        results.reminders81++;
      } catch (err) {
        results.errors.push(`81-day reminder failed for job ${job.id}: ${err instanceof Error ? err.message : 'Unknown'}`);
      }
    }

    // 121-day expiry: delete blobs and mark as expired
    const expiredJobs = await prisma.extractionJob.findMany({
      where: {
        OR: [
          { expiresAt: { lt: new Date() } },
          { expiresAt: null, createdAt: { lt: daysAgo(RETENTION_DAYS) } },
        ],
        status: { notIn: ['expired'] },
      },
      include: {
        files: { where: { status: { notIn: ['expired', 'duplicate'] } } },
      },
    });

    for (const job of expiredJobs) {
      try {
        // Delete blobs from Azure
        for (const file of job.files) {
          try {
            const { BlobServiceClient } = await import('@azure/storage-blob');
            const blobServiceClient = BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING!);
            const containerClient = blobServiceClient.getContainerClient(file.containerName || 'processed');
            const blobClient = containerClient.getBlobClient(file.storagePath);
            await blobClient.deleteIfExists();
          } catch {
            // Blob may already be deleted
          }
        }

        await prisma.extractionFile.updateMany({
          where: { jobId: job.id, status: { notIn: ['expired', 'duplicate'] } },
          data: { status: 'expired' },
        });

        await prisma.extractionJob.update({
          where: { id: job.id },
          data: { status: 'expired' },
        });

        results.expired++;
      } catch (err) {
        results.errors.push(`Expiry failed for job ${job.id}: ${err instanceof Error ? err.message : 'Unknown'}`);
      }
    }
  } catch (err) {
    results.errors.push(`Cron error: ${err instanceof Error ? err.message : 'Unknown'}`);
  }

  return NextResponse.json({
    ok: true,
    ...results,
    timestamp: new Date().toISOString(),
  });
}
