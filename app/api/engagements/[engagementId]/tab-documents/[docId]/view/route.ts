import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { generateSasUrl } from '@/lib/azure-blob';

/**
 * GET /api/engagements/:id/tab-documents/:docId/view
 *
 * Returns a 302 redirect to a short-lived SAS URL on the blob. Lets the
 * UI render `<a href="{viewUrl}" target="_blank">` and have the browser
 * open the file inline (PDF / image) or download it (binary) without
 * the page ever holding the binary itself.
 *
 * The SAS expires quickly (15 min) so a stale link isn't a long-lived
 * data exposure; users who refresh the page get a fresh link.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ engagementId: string; docId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId, docId } = await ctx.params;

  const doc = await prisma.auditDocument.findUnique({
    where: { id: docId },
    select: {
      id: true,
      engagementId: true,
      storagePath: true,
      containerName: true,
      engagement: { select: { firmId: true } },
    },
  });
  if (!doc || doc.engagementId !== engagementId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (!session.user.isSuperAdmin && doc.engagement.firmId !== session.user.firmId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (!doc.storagePath) {
    return NextResponse.json({ error: 'Document has no file content uploaded' }, { status: 404 });
  }

  let url: string;
  try {
    url = generateSasUrl(doc.storagePath, doc.containerName || 'audit-documents');
  } catch (err: any) {
    return NextResponse.json({ error: `SAS generation failed: ${err?.message || 'unknown'}` }, { status: 500 });
  }
  return NextResponse.redirect(url);
}
