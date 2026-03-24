import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

async function verifyAccess(engagementId: string, firmId: string | undefined, isSuperAdmin: boolean) {
  const e = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    select: { firmId: true, clientId: true },
  });
  if (!e || (e.firmId !== firmId && !isSuperAdmin)) return null;
  return e;
}

// GET - list all documents for engagement
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

// POST - create a document request or upload metadata
export async function POST(req: Request, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await params;
  const engagement = await verifyAccess(engagementId, session.user.firmId, session.user.isSuperAdmin);
  if (!engagement) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json();
  const { action } = body;

  if (action === 'request') {
    // Create a document request
    const { documentName, requestedFrom } = body;
    if (!documentName) return NextResponse.json({ error: 'documentName required' }, { status: 400 });

    const doc = await prisma.auditDocument.create({
      data: {
        engagementId,
        documentName,
        requestedFrom: requestedFrom || null,
        requestedDate: new Date(),
        requestedById: session.user.id,
      },
      include: {
        requestedBy: { select: { id: true, name: true } },
        uploadedBy: { select: { id: true, name: true } },
      },
    });

    return NextResponse.json({ document: doc }, { status: 201 });
  }

  if (action === 'upload') {
    // Record upload metadata (actual file upload handled separately via blob storage)
    const { documentId, storagePath, fileSize, mimeType } = body;
    if (!documentId) return NextResponse.json({ error: 'documentId required' }, { status: 400 });

    const doc = await prisma.auditDocument.update({
      where: { id: documentId },
      data: {
        uploadedDate: new Date(),
        uploadedById: session.user.id,
        storagePath: storagePath || null,
        fileSize: fileSize || null,
        mimeType: mimeType || null,
      },
      include: {
        requestedBy: { select: { id: true, name: true } },
        uploadedBy: { select: { id: true, name: true } },
      },
    });

    return NextResponse.json({ document: doc });
  }

  if (action === 'verify') {
    const { documentId } = body;
    if (!documentId) return NextResponse.json({ error: 'documentId required' }, { status: 400 });

    const doc = await prisma.auditDocument.update({
      where: { id: documentId },
      data: { verifiedOn: new Date() },
    });

    return NextResponse.json({ document: doc });
  }

  if (action === 'utilise') {
    const { documentId } = body;
    if (!documentId) return NextResponse.json({ error: 'documentId required' }, { status: 400 });

    const doc = await prisma.auditDocument.update({
      where: { id: documentId },
      data: { utilisedOn: new Date() },
    });

    return NextResponse.json({ document: doc });
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}

// DELETE - remove a document
export async function DELETE(req: Request, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await params;
  if (!await verifyAccess(engagementId, session.user.firmId, session.user.isSuperAdmin)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json();
  const { documentId } = body;
  if (!documentId) return NextResponse.json({ error: 'documentId required' }, { status: 400 });

  await prisma.auditDocument.delete({ where: { id: documentId } });
  return NextResponse.json({ success: true });
}
