import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { generateSasUrl } from '@/lib/azure-blob';

/**
 * GET /api/engagements/:id/specialist-requests/:reviewId/attachments/:idx
 *
 * Resolves an attachment in a specialist review's `attachments` JSON
 * array (by index) and 302-redirects to a short-lived SAS URL on the
 * blob. Lets the hub modal render `<a href="…">` for click-to-open
 * without ever exposing the storage path or full SAS to the client.
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ engagementId: string; reviewId: string; idx: string }> },
) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId, reviewId, idx } = await ctx.params;
  const i = Number.parseInt(idx, 10);
  if (!Number.isFinite(i) || i < 0) return NextResponse.json({ error: 'Bad index' }, { status: 400 });

  const review = await prisma.scheduleSpecialistReview.findUnique({
    where: { id: reviewId },
    select: { id: true, engagementId: true, firmId: true, attachments: true },
  });
  if (!review || review.engagementId !== engagementId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (!session.user.isSuperAdmin && review.firmId !== session.user.firmId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const attachments = Array.isArray(review.attachments) ? review.attachments : [];
  const attachment = attachments[i] as { storagePath?: string; containerName?: string } | undefined;
  if (!attachment || !attachment.storagePath) {
    return NextResponse.json({ error: 'Attachment not found' }, { status: 404 });
  }

  let url: string;
  try {
    url = generateSasUrl(attachment.storagePath, attachment.containerName || 'audit-documents');
  } catch (err: any) {
    return NextResponse.json({ error: `SAS generation failed: ${err?.message || 'unknown'}` }, { status: 500 });
  }
  return NextResponse.redirect(url);
}
