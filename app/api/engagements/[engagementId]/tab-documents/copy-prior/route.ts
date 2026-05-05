import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { downloadBlob, uploadToContainer } from '@/lib/azure-blob';
import crypto from 'crypto';

/**
 * POST /api/engagements/:id/tab-documents/copy-prior
 *
 * Copy a tab's documents from the prior-period engagement into the
 * current one. The blob bytes are duplicated (so deleting the prior
 * engagement doesn't break the current copy) and a fresh AuditDocument
 * row is created with utilisedTab set to the same tab.
 *
 * Body:
 *   { tab, documentIds?: string[] }   // when documentIds is omitted,
 *                                      // every prior-period document
 *                                      // tagged with this tab is copied.
 *
 * The endpoint requires the current engagement to have a
 * priorPeriodEngagementId — without it there's nothing to copy from.
 */
const CONTAINER_NAME = 'audit-documents';

export async function POST(req: NextRequest, ctx: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await ctx.params;

  const engagement = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    select: { firmId: true, clientId: true, priorPeriodEngagementId: true },
  });
  if (!engagement) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!session.user.isSuperAdmin && engagement.firmId !== session.user.firmId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (!engagement.priorPeriodEngagementId) {
    return NextResponse.json({ error: 'No prior-period engagement is linked to this period' }, { status: 422 });
  }

  const body = await req.json().catch(() => ({}));
  const tab = typeof body.tab === 'string' ? body.tab.trim() : '';
  const requestedIds = Array.isArray(body.documentIds)
    ? body.documentIds.filter((x: unknown) => typeof x === 'string')
    : null;
  if (!tab) return NextResponse.json({ error: 'tab is required' }, { status: 400 });

  // Pull candidate prior-period documents — those tagged with the same
  // tab. If the caller specified documentIds, narrow further so the UI
  // can let the user cherry-pick rather than copying everything.
  const prior = await prisma.auditDocument.findMany({
    where: {
      engagementId: engagement.priorPeriodEngagementId,
      utilisedTab: tab,
      ...(requestedIds && requestedIds.length > 0 ? { id: { in: requestedIds } } : {}),
    },
  });

  if (prior.length === 0) {
    return NextResponse.json({
      ok: true,
      copied: 0,
      message: 'No prior-period documents found for this tab.',
    });
  }

  const copiedDocs: Array<{ id: string; documentName: string }> = [];
  for (const src of prior) {
    // Skip rows that never had file content uploaded (e.g. requested
    // documents that were never received) — copying their metadata
    // would clutter the new engagement with empty placeholders.
    if (!src.storagePath) continue;

    const newId = crypto.randomUUID();
    const safeName = src.documentName.replace(/[^a-zA-Z0-9._-]+/g, '_');
    const newBlobName = `${engagement.clientId}/${engagementId}/${tab}/${newId}_${safeName}`;

    try {
      const buf = await downloadBlob(src.storagePath, src.containerName || CONTAINER_NAME);
      await uploadToContainer(
        CONTAINER_NAME,
        newBlobName,
        buf,
        src.mimeType || 'application/octet-stream',
      );
    } catch (err) {
      // If the source blob is gone (rare — older periods may have been
      // archived), we still want the loop to continue with the others
      // rather than failing the whole copy.
      console.error('[tab-documents] copy-prior: failed to copy blob', src.storagePath, err);
      continue;
    }

    const created = await prisma.auditDocument.create({
      data: {
        id: newId,
        engagementId,
        documentName: src.documentName,
        storagePath: newBlobName,
        containerName: CONTAINER_NAME,
        fileSize: src.fileSize,
        mimeType: src.mimeType,
        uploadedDate: new Date(),
        uploadedById: session.user.id,
        utilisedTab: tab,
        utilisedOn: new Date(),
        utilisedByName: session.user.name || session.user.email || null,
        source: src.source || 'Prior Period',
        documentType: src.documentType,
        receivedByName: session.user.name || session.user.email || null,
        receivedAt: new Date(),
      },
    });
    copiedDocs.push({ id: created.id, documentName: created.documentName });
  }

  return NextResponse.json({ ok: true, copied: copiedDocs.length, documents: copiedDocs });
}
