import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { verifySummaryJobAccess } from '@/lib/client-access';

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const jobId = searchParams.get('jobId');
  if (!jobId) return NextResponse.json({ error: 'jobId required' }, { status: 400 });

  const jobAccess = await verifySummaryJobAccess(
    session.user as { id: string; firmId: string; isSuperAdmin?: boolean },
    jobId,
  );
  if (!jobAccess.allowed) {
    return NextResponse.json({ error: jobAccess.reason || 'Forbidden' }, { status: 403 });
  }

  try {
    const job = await prisma.docSummaryJob.findUnique({
      where: { id: jobId },
      include: {
        files: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            originalName: true,
            status: true,
            errorMessage: true,
            pageCount: true,
            fileSize: true,
            createdAt: true,
          },
        },
        findings: {
          orderBy: [{ fileId: 'asc' }, { sortOrder: 'asc' }],
          select: {
            id: true,
            fileId: true,
            area: true,
            finding: true,
            clauseReference: true,
            isSignificantRisk: true,
            userResponse: true,
            addToTesting: true,
            reviewed: true,
            sortOrder: true,
          },
        },
      },
    });

    if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    return NextResponse.json({
      id: job.id,
      status: job.status,
      totalFiles: job.totalFiles,
      processedCount: job.processedCount,
      failedCount: job.failedCount,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      files: job.files,
      findings: job.findings,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[DocSummary:Status] Failed | jobId=${jobId} | error=${msg}`);
    return NextResponse.json({ error: 'Failed to fetch status' }, { status: 500 });
  }
}
