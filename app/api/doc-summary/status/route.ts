import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { verifySummaryJobAccess } from '@/lib/client-access';
import { getJobStatus, getFileStatuses, getFileProgress } from '@/lib/redis';

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
      // Get progress data for active files
      let fileProgress: Record<string, { batchesDone: number; batchesTotal: number; pagesDone: number; pagesTotal: number; message?: string }> = {};
      try { fileProgress = await getFileProgress(jobId); } catch { /* ignore */ }

      // We need file details from DB to return proper file objects
      const dbFiles = await prisma.docSummaryFile.findMany({
        where: { jobId },
        orderBy: { createdAt: 'asc' },
        select: { id: true, originalName: true, status: true, errorMessage: true, hidden: true },
      });

      // Override status from Redis (more current)
      const files = dbFiles.map(f => ({
        ...f,
        status: redisFiles[f.id] || f.status,
        progress: fileProgress[f.id] || null,
      }));

      const processedCount = files.filter(f => f.status === 'analysed').length;
      const failedCount = files.filter(f => f.status === 'failed').length;

      // If all done, fetch findings too
      const allDone = files.every(f => f.status === 'analysed' || f.status === 'failed');
      let findings: unknown[] = [];
      if (allDone) {
        const dbFindings = await prisma.docSummaryFinding.findMany({
          where: { jobId },
          orderBy: [{ fileId: 'asc' }, { sortOrder: 'asc' }],
          select: { id: true, fileId: true, area: true, finding: true, clauseReference: true,
            isSignificantRisk: true, aiSignificantRisk: true, userResponse: true,
            addToTesting: true, reviewed: true, sortOrder: true,
            accountingImpact: true, auditImpact: true },
        });
        findings = dbFindings;
      }

      return NextResponse.json({
        jobId,
        status: redisStatus,
        totalFiles: files.length,
        processedCount,
        failedCount,
        files,
        findings,
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
            hidden: true,
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
            accountingImpact: true,
            auditImpact: true,
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
