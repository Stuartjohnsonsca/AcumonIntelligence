import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { verifySummaryJobAccess } from '@/lib/client-access';
import { getJobStatus, getFileStatuses } from '@/lib/redis';

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
    // Fast path: try Redis first for active jobs
    let redisStatus: string | null = null;
    let redisFiles: Record<string, string> = {};
    try {
      redisStatus = await getJobStatus(jobId);
      if (redisStatus) {
        redisFiles = await getFileStatuses(jobId);
      }
    } catch {
      // Redis unavailable — fall through to DB
    }

    if (redisStatus && Object.keys(redisFiles).length > 0) {
      // Count statuses from Redis file map
      const fileEntries = Object.entries(redisFiles);
      const processedCount = fileEntries.filter(([, s]) => s === 'analysed').length;
      const failedCount = fileEntries.filter(([, s]) => s === 'failed').length;

      return NextResponse.json({
        jobId,
        status: redisStatus,
        totalFiles: fileEntries.length,
        processedCount,
        failedCount,
        files: redisFiles,
      });
    }

    // Fallback: full DB query (for jobs that started before Redis was wired in)
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
            aiSignificantRisk: true,
            userResponse: true,
            addToTesting: true,
            reviewed: true,
            sortOrder: true,
          },
        },
      },
    });

    if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // Build file status map from DB
    const fileStatusMap: Record<string, string> = {};
    for (const f of job.files) {
      fileStatusMap[f.id] = f.status;
    }

    return NextResponse.json({
      jobId: job.id,
      status: job.status,
      totalFiles: job.totalFiles,
      processedCount: job.processedCount,
      failedCount: job.failedCount,
      files: fileStatusMap,
      // Include full data for DB fallback path
      fileDetails: job.files,
      findings: job.findings,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[DocSummary:Status] Failed | jobId=${jobId} | error=${msg}`);
    return NextResponse.json({ error: 'Failed to fetch status' }, { status: 500 });
  }
}
