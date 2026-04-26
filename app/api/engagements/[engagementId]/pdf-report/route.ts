import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { uploadToContainer } from '@/lib/azure-blob';
import { generatePdfReport } from '@/lib/pdf-report-generator';

/**
 * POST /api/engagements/:engagementId/pdf-report
 *   Generate a fresh PDF snapshot of the engagement file. Methodology
 *   admins / super admins only — anyone else gets 403. The generator
 *   reads the engagement (team, materiality, RMM, agreed dates, etc.)
 *   and produces a PDF with a cover page, table of contents, and one
 *   page-broken section per schedule. The binary uploads to Azure
 *   blob storage; metadata persists in audit_pdf_reports.
 *
 * GET /api/engagements/:engagementId/pdf-report
 *   List existing reports for this engagement. Visible to anyone with
 *   read access (including Regulatory Reviewers — they need to see the
 *   snapshot history). The download URLs in the response only resolve
 *   to a binary for methodology admins; non-admins see a viewer URL
 *   only (the download endpoint itself enforces the gate).
 */
type Ctx = { params: Promise<{ engagementId: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await ctx.params;

  const eng = await prisma.auditEngagement.findUnique({ where: { id: engagementId }, select: { firmId: true } });
  if (!eng) return NextResponse.json({ error: 'Engagement not found' }, { status: 404 });
  if (!session.user.isSuperAdmin && eng.firmId !== session.user.firmId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const reports = await prisma.auditPdfReport.findMany({
    where: { engagementId },
    orderBy: { generatedAt: 'desc' },
  });

  const isAdmin = Boolean(session.user.isSuperAdmin || session.user.isMethodologyAdmin);
  return NextResponse.json({
    reports: reports.map(r => ({
      id: r.id,
      fileName: r.fileName,
      generatedAt: r.generatedAt,
      generatedByName: r.generatedByName,
      fileSize: r.fileSize,
      viewUrl: `/api/engagements/${engagementId}/pdf-report/${r.id}/view`,
      // Only methodology admins see a download URL — the route itself
      // also enforces, but hiding the link from non-admin UIs is a
      // belt-and-braces safeguard.
      downloadUrl: isAdmin ? `/api/engagements/${engagementId}/pdf-report/${r.id}/download` : null,
    })),
    canGenerate: isAdmin,
  });
}

export async function POST(_req: Request, ctx: Ctx) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!session.user.isSuperAdmin && !session.user.isMethodologyAdmin) {
    return NextResponse.json({ error: 'Only Methodology Administrators can generate PDF reports' }, { status: 403 });
  }
  const { engagementId } = await ctx.params;

  const eng = await prisma.auditEngagement.findUnique({ where: { id: engagementId }, select: { firmId: true, clientId: true } });
  if (!eng) return NextResponse.json({ error: 'Engagement not found' }, { status: 404 });
  if (!session.user.isSuperAdmin && eng.firmId !== session.user.firmId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Build the PDF.
  let buffer: Uint8Array;
  let fileName: string;
  try {
    const result = await generatePdfReport(engagementId, {
      generatedByName: session.user.name || session.user.email || 'Unknown',
    });
    buffer = result.buffer;
    fileName = result.fileName;
  } catch (err: any) {
    return NextResponse.json({ error: `Generation failed: ${err?.message || 'unknown error'}` }, { status: 500 });
  }

  // Persist to Azure blob — same `audit-pdf-reports` container the
  // schema defaults to.
  const reportId = crypto.randomUUID();
  const blobPath = `${eng.clientId}/${engagementId}/${reportId}_${fileName}`;
  const containerName = 'audit-pdf-reports';
  try {
    await uploadToContainer(containerName, blobPath, Buffer.from(buffer), 'application/pdf');
  } catch (err: any) {
    return NextResponse.json({ error: `Blob upload failed: ${err?.message || 'unknown error'}` }, { status: 500 });
  }

  const report = await prisma.auditPdfReport.create({
    data: {
      id: reportId,
      engagementId,
      fileName,
      blobPath,
      containerName,
      fileSize: buffer.length,
      generatedById: session.user.id!,
      generatedByName: session.user.name || session.user.email || 'Unknown',
    },
  });

  return NextResponse.json({
    id: report.id,
    fileName: report.fileName,
    generatedAt: report.generatedAt,
    generatedByName: report.generatedByName,
    fileSize: report.fileSize,
    viewUrl: `/api/engagements/${engagementId}/pdf-report/${report.id}/view`,
    downloadUrl: `/api/engagements/${engagementId}/pdf-report/${report.id}/download`,
  });
}
