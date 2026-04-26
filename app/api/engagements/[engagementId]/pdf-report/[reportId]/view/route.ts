import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { downloadBlob } from '@/lib/azure-blob';

/**
 * GET /api/engagements/:engagementId/pdf-report/:reportId/view
 *
 * Inline PDF stream — Content-Disposition: inline so the browser's
 * built-in PDF viewer renders the file rather than treating it as a
 * download. Available to anyone with engagement read access (including
 * Regulatory Reviewers — viewing is the whole point of the role).
 *
 * Browser-level PDF viewer toolbars expose a save / print button we
 * can't fully suppress, but we strip download Content-Disposition and
 * route the binary through this endpoint so external tools can't
 * scrape the blob URL directly. For full lock-down, a future iteration
 * could pre-render to images or watermark the PDF per viewer.
 */
type Ctx = { params: Promise<{ engagementId: string; reportId: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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
      // `inline` keeps the browser's PDF viewer in charge instead of
      // popping a Save dialog. The `download` route below is the
      // explicit "save to disk" path and is methodology-admin-gated.
      'Content-Disposition': `inline; filename="${report.fileName}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
