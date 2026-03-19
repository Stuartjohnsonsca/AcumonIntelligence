import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { verifySummaryJobAccess } from '@/lib/client-access';
import { generateDocSummaryPdf, type Finding, type FileInfo } from '@/lib/doc-summary-pdf';
import { uploadToInbox } from '@/lib/azure-blob';
import { setPdfStatus } from '@/lib/redis';

const PDF_SIZE_THRESHOLD = 5 * 1024 * 1024; // 5 MB

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const jobId = searchParams.get('jobId');
  const singleFileId = searchParams.get('fileId') || undefined;
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

    // Build file info array with uploader name
    const files: FileInfo[] = job.files.map((f) => ({
      id: f.id,
      originalName: f.originalName,
      fileSize: f.fileSize,
      pageCount: f.pageCount,
      createdAt: f.createdAt.toISOString(),
      uploadedBy: userName,
    }));

    // Build file ID -> name lookup for findings
    const fileNameMap = new Map(job.files.map((f) => [f.id, f.originalName]));

    const findings: Finding[] = job.findings.map((f) => ({
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
    const pdfBytes = await generateDocSummaryPdf({
      jobId,
      findings,
      files,
      clientName,
      firmName,
      userName,
      exportDate,
      singleFileId,
    });

    const safeClientName = clientName.replace(/[^a-zA-Z0-9_-]/g, '_');
    const dateStr = exportDate.toISOString().slice(0, 10);
    const filename = `Document-Summary-${safeClientName}-${dateStr}.pdf`;
    const pdfBuffer = Buffer.from(pdfBytes);

    // If the PDF is small enough, return it directly
    if (pdfBuffer.length < PDF_SIZE_THRESHOLD) {
      return new Response(pdfBuffer, {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Cache-Control': 'no-store',
        },
      });
    }

    // Large PDF: upload to Azure Blob and return a task ID for async retrieval
    const taskId = crypto.randomUUID();
    const blobPath = `pdf-exports/${taskId}/${filename}`;
    await uploadToInbox(blobPath, pdfBuffer, 'application/pdf');
    await setPdfStatus(taskId, 'ready', blobPath);

    return NextResponse.json({
      taskId,
      status: 'ready',
      filename,
      size: pdfBuffer.length,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[DocSummary:ExportPDF] Failed | jobId=${jobId} | error=${msg}`);
    return NextResponse.json({ error: 'Failed to generate PDF' }, { status: 500 });
  }
}
