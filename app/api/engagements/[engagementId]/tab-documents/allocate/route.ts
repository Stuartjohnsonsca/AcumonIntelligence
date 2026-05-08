import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

/**
 * POST /api/engagements/:id/tab-documents/allocate
 *
 * Allocate an existing AuditDocument (already in the engagement's
 * Documents tab) to a specific engagement tab. The allocation lands
 * in AuditDocumentTabAllocation (composite-key upsert — idempotent),
 * AND the legacy `utilisedTab` field is updated to this tab so older
 * code paths that still read the single-tab field show the most
 * recently allocated tab.
 *
 * Existing allocations on OTHER tabs are NOT cleared — a single
 * document can sit on multiple tabs simultaneously.
 *
 * Body: { documentId, tab }
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await ctx.params;

  const engagement = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    select: { firmId: true },
  });
  if (!engagement) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!session.user.isSuperAdmin && engagement.firmId !== session.user.firmId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const documentId = typeof body.documentId === 'string' ? body.documentId : '';
  const tab = typeof body.tab === 'string' ? body.tab.trim() : '';
  if (!documentId || !tab) {
    return NextResponse.json({ error: 'documentId and tab are required' }, { status: 400 });
  }

  // Confirm the document belongs to this engagement before tagging it.
  const existing = await prisma.auditDocument.findUnique({
    where: { id: documentId },
    select: { id: true, engagementId: true, utilisedTab: true },
  });
  if (!existing || existing.engagementId !== engagementId) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 });
  }

  // Upsert the allocation row (idempotent — same doc/tab pair is fine
  // to call repeatedly), and update the legacy single-tab field for
  // back-compat readers.
  await prisma.$transaction([
    prisma.auditDocumentTabAllocation.upsert({
      where: { documentId_tab: { documentId, tab } },
      create: { documentId, tab, allocatedById: session.user.id },
      update: {},
    }),
    prisma.auditDocument.update({
      where: { id: documentId },
      data: {
        utilisedTab: tab,
        utilisedOn: existing.utilisedTab ? undefined : new Date(),
        utilisedByName: existing.utilisedTab ? undefined : (session.user.name || session.user.email || null),
      },
    }),
  ]);

  return NextResponse.json({ ok: true });
}
