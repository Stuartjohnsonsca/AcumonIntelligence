import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { verifyClientAccess } from '@/lib/client-access';

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

  const files = await prisma.extractionFile.findMany({
    where: { jobId },
    select: {
      id: true,
      originalName: true,
      mimeType: true,
      fileSize: true,
      status: true,
      errorMessage: true,
      containerName: true,
      pageCount: true,
      duplicateOfId: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  return NextResponse.json(files);
}
