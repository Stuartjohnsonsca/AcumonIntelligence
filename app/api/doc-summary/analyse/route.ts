import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { verifySummaryJobAccess } from '@/lib/client-access';
import { enqueueDocSummaryAnalysis } from '@/lib/azure-queue';
import { setJobStatus, setFileStatus } from '@/lib/redis';

export const maxDuration = 60;

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const { jobId } = await req.json();
  if (!jobId) return NextResponse.json({ error: 'jobId required' }, { status: 400 });

  const jobAccess = await verifySummaryJobAccess(
    session.user as { id: string; firmId: string; isSuperAdmin?: boolean },
    jobId,
  );
  if (!jobAccess.allowed) {
    return NextResponse.json({ error: jobAccess.reason || 'Forbidden' }, { status: 403 });
  }

  const job = await prisma.docSummaryJob.findUnique({
    where: { id: jobId },
    include: {
      files: true,
      client: { select: { clientName: true } },
    },
  });

  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });

  const filesToProcess = job.files.filter(f => f.status === 'uploaded');
  if (filesToProcess.length === 0) {
    return NextResponse.json({ error: 'No files to analyse' }, { status: 400 });
  }

  // Set job to processing — keep total files count from upload, only reset processing counters
  const totalAllFiles = await prisma.docSummaryFile.count({ where: { jobId } });
  await prisma.docSummaryJob.update({
    where: { id: jobId },
    data: {
      status: 'processing',
      totalFiles: totalAllFiles,
    },
  });

  // Set job status in Redis for fast polling
  await setJobStatus(jobId, 'processing');

  const clientName = job.client.clientName;
  const userId = session.user.id;
  const clientId = job.clientId;

  // Enqueue each file for worker processing
  for (const file of filesToProcess) {
    await setFileStatus(jobId, file.id, 'queued');
    await enqueueDocSummaryAnalysis({
      jobId,
      fileId: file.id,
      clientName,
      userId,
      clientId,
    });
  }

  return NextResponse.json({
    jobId,
    status: 'processing',
    totalFiles: filesToProcess.length,
  });
}
