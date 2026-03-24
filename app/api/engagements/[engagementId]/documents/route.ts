import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

async function verifyAccess(engagementId: string, firmId: string | undefined, isSuperAdmin: boolean) {
  const e = await prisma.auditEngagement.findUnique({ where: { id: engagementId }, select: { firmId: true, clientId: true } });
  if (!e || (e.firmId !== firmId && !isSuperAdmin)) return null;
  return e;
}

export async function GET(req: Request, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await params;
  if (!await verifyAccess(engagementId, session.user.firmId, session.user.isSuperAdmin)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const documents = await prisma.auditDocument.findMany({
    where: { engagementId },
    include: {
      requestedBy: { select: { id: true, name: true } },
      uploadedBy: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json({ documents });
}

export async function POST(req: Request, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await params;
  const engagement = await verifyAccess(engagementId, session.user.firmId, session.user.isSuperAdmin);
  if (!engagement) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json();
  const { action } = body;

  // Create document request
  if (action === 'request') {
    const { documentName, requestedFrom, mappedItems } = body;
    if (!documentName) return NextResponse.json({ error: 'documentName required' }, { status: 400 });
    const doc = await prisma.auditDocument.create({
      data: {
        engagementId, documentName, requestedFrom: requestedFrom || null,
        requestedDate: new Date(), requestedById: session.user.id,
        mappedItems: mappedItems || null,
      },
      include: { requestedBy: { select: { id: true, name: true } }, uploadedBy: { select: { id: true, name: true } } },
    });
    return NextResponse.json({ document: doc }, { status: 201 });
  }

  // Upload metadata (file upload handled via blob storage separately)
  if (action === 'upload') {
    const { documentId, storagePath, fileSize, mimeType } = body;
    if (!documentId) return NextResponse.json({ error: 'documentId required' }, { status: 400 });
    const doc = await prisma.auditDocument.update({
      where: { id: documentId },
      data: {
        uploadedDate: new Date(), uploadedById: session.user.id,
        storagePath: storagePath || null, fileSize: fileSize || null, mimeType: mimeType || null,
        // Auto-set received
        receivedByName: session.user.name || session.user.email, receivedAt: new Date(),
      },
      include: { requestedBy: { select: { id: true, name: true } }, uploadedBy: { select: { id: true, name: true } } },
    });

    // Auto-verify with AI (mark as AI verified)
    await prisma.auditDocument.update({
      where: { id: documentId },
      data: { verifiedOn: new Date(), verifiedByName: 'AI' },
    });

    return NextResponse.json({ document: doc });
  }

  // Mark received (dot 1)
  if (action === 'receive') {
    const { documentId } = body;
    if (!documentId) return NextResponse.json({ error: 'documentId required' }, { status: 400 });
    const doc = await prisma.auditDocument.update({
      where: { id: documentId },
      data: { receivedByName: session.user.name || session.user.email, receivedAt: new Date() },
    });
    return NextResponse.json({ document: doc });
  }

  // Mark verified (dot 2) — typically "AI" but can be manual
  if (action === 'verify') {
    const { documentId } = body;
    if (!documentId) return NextResponse.json({ error: 'documentId required' }, { status: 400 });
    const doc = await prisma.auditDocument.update({
      where: { id: documentId },
      data: { verifiedOn: new Date(), verifiedByName: body.verifiedBy || 'AI' },
    });
    return NextResponse.json({ document: doc });
  }

  // Mark utilised (dot 3)
  if (action === 'utilise') {
    const { documentId, tabName } = body;
    if (!documentId) return NextResponse.json({ error: 'documentId required' }, { status: 400 });
    const doc = await prisma.auditDocument.update({
      where: { id: documentId },
      data: { utilisedOn: new Date(), utilisedByName: session.user.name || session.user.email, utilisedTab: tabName || null },
    });
    return NextResponse.json({ document: doc });
  }

  // Toggle visibility to client
  if (action === 'toggle_visibility') {
    const { documentId } = body;
    if (!documentId) return NextResponse.json({ error: 'documentId required' }, { status: 400 });
    const existing = await prisma.auditDocument.findUnique({ where: { id: documentId } });
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const doc = await prisma.auditDocument.update({
      where: { id: documentId },
      data: { visibleToClient: !existing.visibleToClient },
    });
    return NextResponse.json({ document: doc });
  }

  // Update mapped items
  if (action === 'update_mapping') {
    const { documentId, mappedItems } = body;
    if (!documentId) return NextResponse.json({ error: 'documentId required' }, { status: 400 });
    const doc = await prisma.auditDocument.update({
      where: { id: documentId },
      data: { mappedItems: mappedItems || null },
    });
    return NextResponse.json({ document: doc });
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await params;
  if (!await verifyAccess(engagementId, session.user.firmId, session.user.isSuperAdmin)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const body = await req.json();
  if (!body.documentId) return NextResponse.json({ error: 'documentId required' }, { status: 400 });
  await prisma.auditDocument.delete({ where: { id: body.documentId } });
  return NextResponse.json({ success: true });
}
