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
    });

    if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const clientName = job.client.clientName;
    const firmName = job.user.firm.name;
    const userName = job.user.name;

    // Separate analysed files from failed files
    const analysedDbFiles = job.files.filter((f) => f.status === 'analysed');
    const failedDbFiles = job.files.filter((f) => f.status === 'failed');

    // Build file info array for analysed files
    const files: FileInfo[] = analysedDbFiles.map((f) => ({
      id: f.id,
      originalName: f.originalName,
      fileSize: f.fileSize,
      pageCount: f.pageCount,
      documentDescription: f.documentDescription || null,
      createdAt: f.createdAt.toISOString(),
      uploadedBy: userName,
    }));

    // Build failed file info
    const failedFiles: FailedFileInfo[] = failedDbFiles.map((f) => ({
      originalName: f.originalName,
      fileSize: f.fileSize,
      createdAt: f.createdAt.toISOString(),
      errorMessage: f.errorMessage,
    }));

    // Build file ID -> name lookup for findings
    const fileNameMap = new Map(job.files.map((f) => [f.id, f.originalName]));

    // Only include findings for analysed files
    const analysedFileIds = new Set(analysedDbFiles.map((f) => f.id));
    const findings: Finding[] = job.findings
      .filter((f) => analysedFileIds.has(f.fileId))
      .map((f) => ({
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
      }));

    const exportDate = new Date();
    const pdfBytes = await generatePortfolioPdf({
      jobId,
      findings,
      files,
      clientName,
      firmName,
      userName,
      exportDate,
      failedFiles,
    });

    const safeClientName = clientName.replace(/[^a-zA-Z0-9_-]/g, '_');
    const dateStr = exportDate.toISOString().slice(0, 10);
    const filename = `Portfolio-Report-${safeClientName}-${dateStr}.pdf`;

    return new Response(Buffer.from(pdfBytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[DocSummary:ExportPortfolio] Failed | jobId=${jobId} | error=${msg}`);
    return NextResponse.json({ error: 'Failed to generate portfolio PDF' }, { status: 500 });
  }
}
