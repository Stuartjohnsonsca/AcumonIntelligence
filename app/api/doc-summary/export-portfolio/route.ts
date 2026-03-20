import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { verifySummaryJobAccess } from '@/lib/client-access';
import {
  generatePortfolioPdf,
  type Finding,
  type FileInfo,
  type FailedFileInfo,
} from '@/lib/doc-summary-pdf';
import { logActivity, logError, requestContext } from '@/lib/logger';

export const maxDuration = 60;

/**
 * Shared handler for portfolio PDF generation.
 * Supports single jobId (query param) or multiple jobIds (POST body).
 */
async function handlePortfolioExport(req: Request, selectedFileIds?: string[], extraJobIds?: string[]) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const primaryJobId = searchParams.get('jobId');
  if (!primaryJobId) return NextResponse.json({ error: 'jobId required' }, { status: 400 });

  // Collect all job IDs to include (primary + any extras from imported sessions)
  const allJobIds = [primaryJobId, ...(extraJobIds || [])];
  const uniqueJobIds = [...new Set(allJobIds)];

  // Verify access to all jobs
  for (const jid of uniqueJobIds) {
    const jobAccess = await verifySummaryJobAccess(
      session.user as { id: string; firmId: string; isSuperAdmin?: boolean },
      jid,
    );
    if (!jobAccess.allowed) {
      return NextResponse.json({ error: `Forbidden: ${jobAccess.reason}` }, { status: 403 });
    }
  }

  try {
    // Fetch data from all jobs
    const jobs = await Promise.all(
      uniqueJobIds.map((jid) =>
        prisma.docSummaryJob.findUnique({
          where: { id: jid },
          include: {
            client: { select: { clientName: true } },
            user: { select: { name: true, firm: { select: { name: true } } } },
            files: {
              orderBy: { createdAt: 'asc' },
              select: {
                id: true,
                originalName: true,
                fileSize: true,
                pageCount: true,
                documentDescription: true,
                status: true,
                errorMessage: true,
                createdAt: true,
              },
            },
            findings: {
              orderBy: [{ fileId: 'asc' }, { sortOrder: 'asc' }],
            },
          },
        }),
      ),
    );

    const primaryJob = jobs[0];
    if (!primaryJob) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const clientName = primaryJob.client.clientName;
    const firmName = primaryJob.user.firm.name;
    const userName = primaryJob.user.name;

    // Merge files and findings from all jobs
    const allFiles: FileInfo[] = [];
    const allFailedFiles: FailedFileInfo[] = [];
    const allFindings: Finding[] = [];

    for (const job of jobs) {
      if (!job) continue;
      const fileNameMap = new Map(job.files.map((f) => [f.id, f.originalName]));

      const analysedDbFiles = job.files.filter((f) => f.status === 'analysed');
      const failedDbFiles = job.files.filter((f) => f.status === 'failed');

      for (const f of analysedDbFiles) {
        allFiles.push({
          id: f.id,
          originalName: f.originalName,
          fileSize: f.fileSize,
          pageCount: f.pageCount,
          documentDescription: f.documentDescription || null,
          createdAt: f.createdAt.toISOString(),
          uploadedBy: userName,
        });
      }

      for (const f of failedDbFiles) {
        allFailedFiles.push({
          originalName: f.originalName,
          fileSize: f.fileSize,
          createdAt: f.createdAt.toISOString(),
          errorMessage: f.errorMessage,
        });
      }

      const analysedFileIds = new Set(analysedDbFiles.map((f) => f.id));
      for (const f of job.findings) {
        if (!analysedFileIds.has(f.fileId)) continue;
        allFindings.push({
          id: f.id,
          area: f.area,
          finding: f.finding,
          clauseReference: f.clauseReference,
          isSignificantRisk: f.isSignificantRisk,
          aiSignificantRisk: f.aiSignificantRisk,
          userResponse: f.userResponse,
          addToTesting: f.addToTesting,
          reviewed: f.reviewed,
          fileId: f.fileId,
          fileName: fileNameMap.get(f.fileId) || 'Unknown',
          accountingImpact: f.accountingImpact ?? null,
          auditImpact: f.auditImpact ?? null,
        });
      }
    }

    const exportDate = new Date();
    const pdfBytes = await generatePortfolioPdf({
      jobId: primaryJobId,
      findings: allFindings,
      files: allFiles,
      clientName,
      firmName,
      userName,
      exportDate,
      failedFiles: allFailedFiles,
      selectedFileIds,
    });

    const safeClientName = clientName.replace(/[^a-zA-Z0-9_-]/g, '_');
    const dateStr = exportDate.toISOString().slice(0, 10);
    const filename = `Portfolio-Report-${safeClientName}-${dateStr}.pdf`;

    logActivity({
      userId: session.user.id,
      firmId: (session.user as { firmId?: string }).firmId,
      clientId: primaryJob.clientId,
      action: 'export_portfolio',
      tool: 'doc-summary',
      detail: { jobIds: uniqueJobIds, selectedFileIds, pdfSize: pdfBytes.length },
      ipAddress: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || undefined,
      userAgent: req.headers.get('user-agent') || undefined,
    });

    return new Response(Buffer.from(pdfBytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[DocSummary:ExportPortfolio] Failed | jobIds=${uniqueJobIds.join(',')} | error=${msg}`);
    logError({
      userId: session.user.id,
      route: '/api/doc-summary/export-portfolio',
      tool: 'doc-summary',
      message: msg,
      stack: error instanceof Error ? error.stack : undefined,
      context: requestContext(req),
    });
    return NextResponse.json({ error: 'Failed to generate portfolio PDF' }, { status: 500 });
  }
}

/** GET — legacy compatibility, generates portfolio for all analysed files in single job */
export async function GET(req: Request) {
  return handlePortfolioExport(req);
}

/** POST — accepts { fileIds?: string[], jobIds?: string[] } body for multi-job portfolio */
export async function POST(req: Request) {
  let body: { fileIds?: string[]; jobIds?: string[] } = {};
  try {
    body = await req.json();
  } catch {
    // No body is fine
  }
  return handlePortfolioExport(req, body.fileIds, body.jobIds);
}
