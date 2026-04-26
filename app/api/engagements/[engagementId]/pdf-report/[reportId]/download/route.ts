import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { downloadBlob } from '@/lib/azure-blob';

/**
 * GET /api/engagements/:engagementId/pdf-report/:reportId/download
 *
 * Methodology-admin-only download. Streams the PDF as a true file
 * attachment (Content-Disposition: attachment) so the browser shows
 * a Save dialog. Anyone else (preparer / reviewer / partner / EQR /
 * Regulatory Reviewer) gets a 403 here — they have to use the /view
 * endpoint above which renders inline in the browser.
 */
type Ctx = { params: Promise<{ engagementId: string; reportId: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Hard role gate. The user spec is clear: "not downloadable by
  // anyone except by a Methodology Administrator." Super-admins are
  // permitted as the implicit superset.
  if (!session.user.isSuperAdmin && !session.user.isMethodologyAdmin) {
    return NextResponse.json({
      error: 'Only Methodology Administrators can download the PDF report',
      reason: 'download_not_permitted',
    }, { status: 403 });
  }

  const { engagementId, reportId } = await ctx.params;

  const eng = await prisma.auditEngagement.findUnique({ where: { id: engagementId }, select: { firmId: true } });
  if (!eng) return NextResponse.json({ error: 'Engagement not found' }, { status: 404 });
  if (!session.user.isSuperAdmin && eng.firmId !== session.user.firmId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const report = await prisma.auditPdfReport.findFirst({
    where: { id: reportId, engagementId },
    select: { blobPath: true, containerName: true, fileName: true },
  });
  if (!report) return NextResponse.json({ error: 'Report not found' }, { status: 404 });

  let buffer: Buffer;
  try {
    buffer = await downloadBlob(report.blobPath, report.containerName);
  } catch (err: any) {
    return NextResponse.json({ error: `Blob fetch failed: ${err?.message || 'unknown error'}` }, { status: 500 });
  }

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${report.fileName}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
