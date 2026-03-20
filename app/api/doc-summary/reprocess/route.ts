import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { verifySummaryJobAccess } from '@/lib/client-access';
import { enqueueDocSummaryAnalysis } from '@/lib/azure-queue';
import { setJobStatus, setFileStatus } from '@/lib/redis';
import { logActivity, logError, requestContext } from '@/lib/logger';

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const { jobId, fileId, accountingFramework } = await req.json();
  if (!jobId || !fileId) {
    return NextResponse.json({ error: 'jobId and fileId required' }, { status: 400 });
  }

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
      include: { client: { select: { clientName: true } } },
    });
    if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });

    // Reset file status to 'uploaded' and clear existing findings
    await prisma.$transaction([
      prisma.docSummaryFile.update({
        where: { id: fileId },
        data: { status: 'uploaded', errorMessage: null, hidden: false },
      }),
      prisma.docSummaryFinding.deleteMany({
        where: { jobId, fileId },
      }),
      prisma.docSummaryJob.update({
        where: { id: jobId },
        data: { status: 'processing' },
      }),
    ]);

    // Set status in Redis
    await setJobStatus(jobId, 'processing');
    await setFileStatus(jobId, fileId, 'queued');

    // Enqueue for worker processing
    await enqueueDocSummaryAnalysis({
      jobId,
      fileId,
      clientName: job.client.clientName,
      userId: session.user.id,
      clientId: job.clientId,
      accountingFramework: accountingFramework || 'FRS 102',
    });

    logActivity({
      userId: session.user.id,
      firmId: (session.user as { firmId?: string }).firmId,
      clientId: job.clientId,
      action: 'reprocess',
      tool: 'doc-summary',
      detail: { jobId, fileId },
      ipAddress: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || undefined,
      userAgent: req.headers.get('user-agent') || undefined,
    });

    return NextResponse.json({ status: 'queued', fileId });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[DocSummary:Reprocess] Failed | jobId=${jobId} fileId=${fileId} | error=${msg}`);
    logError({
      userId: session.user.id,
      route: '/api/doc-summary/reprocess',
      tool: 'doc-summary',
      message: msg,
      stack: error instanceof Error ? error.stack : undefined,
      context: requestContext(req),
    });
    return NextResponse.json({ error: 'Reprocess failed' }, { status: 500 });
  }
}
