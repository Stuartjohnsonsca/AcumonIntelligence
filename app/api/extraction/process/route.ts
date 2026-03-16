import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

function getBaseUrl(): string {
  if (process.env.NEXTAUTH_URL) return process.env.NEXTAUTH_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'http://localhost:3000';
}

function calculateBatchSize(fileCount: number): number {
  if (fileCount <= 5) return fileCount;
  if (fileCount <= 20) return 5;
  if (fileCount <= 100) return 10;
  if (fileCount <= 300) return 15;
  return 25;
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const { jobId } = await req.json();
  if (!jobId) return NextResponse.json({ error: 'jobId required' }, { status: 400 });

  const job = await prisma.extractionJob.findUnique({
    where: { id: jobId },
    include: { files: true },
  });

  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });

  const files = job.files.filter(f => f.status === 'uploaded');
  if (files.length === 0) {
    return NextResponse.json({ error: 'No files to process' }, { status: 400 });
  }

  const batchSize = calculateBatchSize(files.length);
  const batches: typeof files[] = [];
  for (let i = 0; i < files.length; i += batchSize) {
    batches.push(files.slice(i, i + batchSize));
  }

  await prisma.extractionJob.update({
    where: { id: jobId },
    data: {
      status: 'processing',
      totalFiles: files.length,
      processedCount: 0,
      failedCount: 0,
    },
  });

  const baseUrl = getBaseUrl();

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const startIndex = i * batchSize + 1;

    fetch(`${baseUrl}/api/extraction/process-batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jobId,
        fileIds: batch.map(f => f.id),
        startIndex,
        clientId: job.clientId,
        internalSecret: process.env.NEXTAUTH_SECRET,
      }),
    }).catch(err => {
      console.error(`Batch ${i + 1} fire failed:`, err);
    });
  }

  return NextResponse.json({
    jobId,
    status: 'processing',
    totalFiles: files.length,
    batchCount: batches.length,
    batchSize,
  });
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const jobId = searchParams.get('jobId');

  if (!jobId) return NextResponse.json({ error: 'jobId required' }, { status: 400 });

  const job = await prisma.extractionJob.findUnique({
    where: { id: jobId },
    include: {
      files: true,
      records: { orderBy: { referenceId: 'asc' } },
      client: { select: { clientName: true, software: true } },
      user: { select: { name: true, displayId: true } },
    },
  });

  if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json(job);
}
