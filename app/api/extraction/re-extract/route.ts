import { NextResponse, after } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { verifyClientAccess } from '@/lib/client-access';

export const maxDuration = 120;

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const { jobId, fileIds } = await req.json();
  if (!jobId || !Array.isArray(fileIds) || fileIds.length === 0) {
    return NextResponse.json({ error: 'jobId and fileIds[] required' }, { status: 400 });
  }

  const job = await prisma.extractionJob.findUnique({
    where: { id: jobId },
    select: { clientId: true },
  });

  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });

  const access = await verifyClientAccess(
    session.user as { id: string; firmId: string; isSuperAdmin?: boolean },
    job.clientId,
  );
  if (!access.allowed) {
    return NextResponse.json({ error: access.reason || 'Forbidden' }, { status: 403 });
  }

  // Reset failed files to 'uploaded' so they can be re-processed
  await prisma.extractionFile.updateMany({
    where: {
      id: { in: fileIds },
      jobId,
      status: 'failed',
    },
    data: {
      status: 'uploaded',
      errorMessage: null,
    },
  });

  // Dispatch extraction batch
  after(async () => {
    try {
      const baseUrl = process.env.NEXTAUTH_URL || 'https://acumon-intelligence.vercel.app';
      await fetch(`${baseUrl}/api/extraction/process-batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId,
          fileIds,
          startIndex: 0,
          clientId: job.clientId,
          internalSecret: process.env.NEXTAUTH_SECRET,
        }),
      });
    } catch (err) {
      console.error('[Re-extract] Batch dispatch failed:', err instanceof Error ? err.message : err);
    }
  });

  return NextResponse.json({ ok: true, count: fileIds.length });
}
