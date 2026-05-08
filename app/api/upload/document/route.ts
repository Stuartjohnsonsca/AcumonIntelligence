import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { uploadToInbox } from '@/lib/azure-blob';
import { indexDocument } from '@/lib/document-indexing';

/**
 * POST /api/upload/document
 * Upload a document file to Azure Blob storage and update the AuditDocument record.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const documentId = formData.get('documentId') as string;
    const engagementId = formData.get('engagementId') as string;

    if (!file) {
      return NextResponse.json({ error: 'file is required' }, { status: 400 });
    }

    // Get engagement for scoping
    let clientId = '';
    if (engagementId) {
      const engagement = await prisma.auditEngagement.findUnique({
        where: { id: engagementId },
        select: { clientId: true, firmId: true },
      });
      if (!engagement || (engagement.firmId !== session.user.firmId && !session.user.isSuperAdmin)) {
        return NextResponse.json({ error: 'Engagement not found' }, { status: 404 });
      }
      clientId = engagement.clientId;
    }

    // Upload to Azure Blob
    const buffer = Buffer.from(await file.arrayBuffer());
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const scopePath = engagementId
      ? `documents/${clientId}/${engagementId}`
      : `documents/${session.user.firmId}`;
    const blobName = `${scopePath}/${Date.now()}_${safeName}`;

    await uploadToInbox(blobName, buffer, file.type || 'application/octet-stream');

    // Update AuditDocument record if documentId provided
    if (documentId) {
      await prisma.auditDocument.update({
        where: { id: documentId },
        data: {
          uploadedDate: new Date(),
          uploadedById: session.user.id,
          storagePath: blobName,
          fileSize: file.size,
          mimeType: file.type || null,
          receivedByName: session.user.name || session.user.email,
          receivedAt: new Date(),
        },
      });
      // Phase 3: chunk + embed for InterrogateBot retrieval. Fire-and-
      // forget so the upload response stays snappy; failures are logged
      // but don't block the user. PDFs over a few hundred pages can
      // take 10s+ to index.
      void indexDocument(documentId).catch(err =>
        console.warn(`[upload] document indexing failed for ${documentId}:`, err instanceof Error ? err.message : err),
      );
    }

    return NextResponse.json({
      url: blobName,
      path: blobName,
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type,
    });
  } catch (err: any) {
    console.error('Document upload error:', err);
    return NextResponse.json({ error: err.message || 'Upload failed' }, { status: 500 });
  }
}
