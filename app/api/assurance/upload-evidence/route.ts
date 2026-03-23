import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { BlobServiceClient } from '@azure/storage-blob';

function getBlobServiceClient(): BlobServiceClient {
  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!connectionString) throw new Error('AZURE_STORAGE_CONNECTION_STRING not configured');
  return BlobServiceClient.fromConnectionString(connectionString);
}

function getAssuranceContainerName(dataRegion: string): string {
  return `assurance-evidence-${dataRegion}`;
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id || !session.user.twoFactorVerified) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const formData = await request.formData();
    const engagementId = formData.get('engagementId') as string;
    const clientId = formData.get('clientId') as string;
    const documentCategory = formData.get('documentCategory') as string;
    const files = formData.getAll('files') as File[];

    if (!engagementId || !clientId || !documentCategory || files.length === 0) {
      return NextResponse.json(
        { error: 'engagementId, clientId, documentCategory, and at least one file are required' },
        { status: 400 },
      );
    }

    // Verify engagement access
    const engagement = await prisma.assuranceEngagement.findFirst({
      where: { id: engagementId, firmId: session.user.firmId },
      include: { firm: true },
    });
    if (!engagement) {
      return NextResponse.json({ error: 'Engagement not found' }, { status: 404 });
    }

    // Geo-locked container based on firm data region
    const containerName = getAssuranceContainerName(engagement.firm.dataRegion);
    const blobServiceClient = getBlobServiceClient();
    const containerClient = blobServiceClient.getContainerClient(containerName);

    // Ensure container exists
    await containerClient.createIfNotExists();

    const uploadResults = [];

    for (const file of files) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const sanitizedName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const storagePath = `${engagement.firmId}/${clientId}/${engagementId}/${Date.now()}_${sanitizedName}`;

      const blockBlobClient = containerClient.getBlockBlobClient(storagePath);
      await blockBlobClient.uploadData(buffer, {
        blobHTTPHeaders: { blobContentType: file.type },
      });

      const doc = await prisma.assuranceDocument.create({
        data: {
          engagementId,
          uploadedById: session.user.id,
          originalName: file.name,
          storagePath,
          containerName,
          fileSize: buffer.length,
          mimeType: file.type,
          documentCategory,
          aiReviewStatus: 'pending',
        },
      });

      uploadResults.push(doc);
    }

    // Update engagement status to evidence_collection if still in tor_generated
    if (engagement.status === 'tor_generated') {
      await prisma.assuranceEngagement.update({
        where: { id: engagementId },
        data: { status: 'evidence_collection' },
      });
    }

    // Log activity
    await prisma.activityLog.create({
      data: {
        userId: session.user.id,
        firmId: session.user.firmId,
        clientId,
        action: 'upload_evidence',
        tool: 'assurance',
        detail: JSON.stringify({
          engagementId,
          documentCategory,
          fileCount: files.length,
          fileNames: files.map(f => f.name),
        }),
      },
    });

    return NextResponse.json({ uploaded: uploadResults.length, documents: uploadResults });
  } catch (err) {
    console.error('[Assurance:UploadEvidence] Error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
