import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { verifyJobAccess } from '@/lib/client-access';

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const jobId = searchParams.get('jobId');
  if (!jobId) return NextResponse.json({ error: 'jobId required' }, { status: 400 });

  const jobAccess = await verifyJobAccess(session.user as { id: string; firmId: string; isSuperAdmin?: boolean }, jobId);
  if (!jobAccess.allowed) {
    return NextResponse.json({ error: jobAccess.reason || 'Forbidden' }, { status: 403 });
  }

  const job = await prisma.extractionJob.findUnique({
    where: { id: jobId },
    select: {
      status: true,
      totalFiles: true,
      processedCount: true,
      failedCount: true,
      duplicateCount: true,
    },
  });

  if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const complete = job.status === 'complete' || job.status === 'failed';

  return NextResponse.json({
    status: job.status,
    total: job.totalFiles,
    extracted: job.processedCount,
    failed: job.failedCount,
    duplicated: job.duplicateCount,
    complete,
  });
}
