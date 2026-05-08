import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { assertEngagementWriteAccess } from '@/lib/auth/engagement-auth';

/**
 * PATCH /api/engagements/:id/tab-documents/:docId
 *   Body: { documentName: string }
 *   Renames the AuditDocument's display name. The blob path is left
 *   alone — the on-disk filename is encoded into the path with a UUID
 *   prefix and isn't user-visible, so changing the display name
 *   doesn't require moving blob bytes.
 *
 * DELETE /api/engagements/:id/tab-documents/:docId?tab=<tabKey>
 *   Removes the document's allocation to the given tab — the
 *   AuditDocument row stays in the engagement-wide Documents
 *   repository, mirroring how the user thinks about multi-tab
 *   documents ("remove from this tab" vs "delete entirely"). To
 *   purge the document outright, use the engagement-wide /documents
 *   DELETE.
 *
 *   If `tab` is omitted, falls back to the legacy behaviour of
 *   deleting the AuditDocument row entirely — keeps any older callers
 *   working.
 *
 * Both gated by assertEngagementWriteAccess so EQR / read-only users
 * can't mutate someone else's evidence.
 */

async function loadDoc(engagementId: string, docId: string, firmId: string | undefined, isSuperAdmin: boolean) {
  const doc = await prisma.auditDocument.findUnique({
    where: { id: docId },
    select: {
      id: true,
      engagementId: true,
      documentName: true,
      utilisedTab: true,
      engagement: { select: { firmId: true } },
    },
  });
  if (!doc || doc.engagementId !== engagementId) return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) };
  if (!isSuperAdmin && doc.engagement.firmId !== firmId) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  return { doc };
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ engagementId: string; docId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId, docId } = await ctx.params;

  const __eqrGuard = await assertEngagementWriteAccess(engagementId, session);
  if (__eqrGuard instanceof NextResponse) return __eqrGuard;

  const found = await loadDoc(engagementId, docId, session.user.firmId, session.user.isSuperAdmin);
  if ('error' in found) return found.error;

  let body: { documentName?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }); }

  const raw = typeof body.documentName === 'string' ? body.documentName.trim() : '';
  if (!raw) return NextResponse.json({ error: 'documentName is required' }, { status: 400 });
  if (raw.length > 255) return NextResponse.json({ error: 'documentName is too long (max 255 chars)' }, { status: 400 });

  const doc = await prisma.auditDocument.update({
    where: { id: docId },
    data: { documentName: raw },
    select: { id: true, documentName: true },
  });

  return NextResponse.json({ document: doc });
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ engagementId: string; docId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId, docId } = await ctx.params;

  const __eqrGuard = await assertEngagementWriteAccess(engagementId, session);
  if (__eqrGuard instanceof NextResponse) return __eqrGuard;

  const found = await loadDoc(engagementId, docId, session.user.firmId, session.user.isSuperAdmin);
  if ('error' in found) return found.error;

  const url = new URL(req.url);
  const tab = (url.searchParams.get('tab') || '').trim();

  if (tab) {
    // Deallocate from this tab only — drop the join-table row, and if
    // the legacy `utilisedTab` field still points at this tab swap it
    // to whichever other allocation remains (or null when the doc no
    // longer sits on any tab). The AuditDocument row itself survives
    // and remains visible on the Documents repository.
    await prisma.auditDocumentTabAllocation.deleteMany({
      where: { documentId: docId, tab },
    });
    if (found.doc.utilisedTab === tab) {
      const remaining = await prisma.auditDocumentTabAllocation.findFirst({
        where: { documentId: docId },
        select: { tab: true },
        orderBy: { allocatedAt: 'desc' },
      });
      await prisma.auditDocument.update({
        where: { id: docId },
        data: { utilisedTab: remaining?.tab ?? null },
      });
    }
    return NextResponse.json({ success: true, deallocatedFrom: tab });
  }

  // No tab param — legacy behaviour: drop the document row entirely.
  // Cascade-deletes any allocation rows automatically.
  await prisma.auditDocument.delete({ where: { id: docId } });
  return NextResponse.json({ success: true });
}
