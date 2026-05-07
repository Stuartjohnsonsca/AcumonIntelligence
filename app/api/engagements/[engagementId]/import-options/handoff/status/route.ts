import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

// GET /api/engagements/[id]/import-options/handoff/status?sessionId=XXX
// Polled by the modal while waiting for the external assistant to call
// submit_archive on the MCP endpoint. When the session flips to
// 'submitted', the response includes the extractionId and the modal
// auto-advances to the Review screen.
//
// Backwards compat: accepts ?token=XXX (the previous parameter name).
export async function GET(
  req: Request,
  { params }: { params: Promise<{ engagementId: string }> },
) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { engagementId } = await params;
  const url = new URL(req.url);
  const sessionId = url.searchParams.get('sessionId') || url.searchParams.get('token') || '';
  if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 });

  const handoff = await prisma.importHandoffSession.findUnique({ where: { id: sessionId } });
  if (!handoff || handoff.engagementId !== engagementId
      || handoff.firmId !== session.user.firmId) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  let status = handoff.status;
  if (status === 'pending' && handoff.expiresAt < new Date()) {
    status = 'expired';
    await prisma.importHandoffSession.update({
      where: { id: sessionId },
      data: { status: 'expired' },
    });
  }

  return NextResponse.json({
    status,
    expiresAt: handoff.expiresAt.toISOString(),
    submittedAt: handoff.submittedAt?.toISOString() || null,
    extractionId: handoff.submittedExtractionId,
    documentId: handoff.submittedDocumentId,
    progressStage: handoff.progressStage,
    progressMessage: handoff.progressMessage,
    progressAt: handoff.progressAt?.toISOString() || null,
  });
}

// DELETE — cancel an in-flight session (user clicks Cancel in the modal).
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ engagementId: string }> },
) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { engagementId } = await params;
  const url = new URL(req.url);
  const sessionId = url.searchParams.get('sessionId') || url.searchParams.get('token') || '';
  if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 });

  const handoff = await prisma.importHandoffSession.findUnique({ where: { id: sessionId } });
  if (!handoff || handoff.engagementId !== engagementId
      || handoff.firmId !== session.user.firmId) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  if (handoff.status === 'pending') {
    await prisma.importHandoffSession.update({
      where: { id: sessionId },
      data: { status: 'cancelled' },
    });
  }
  return NextResponse.json({ ok: true });
}
