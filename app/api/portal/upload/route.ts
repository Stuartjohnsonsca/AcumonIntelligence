import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { uploadToInbox, generateSasUrl } from '@/lib/azure-blob';

/**
 * POST /api/portal/upload
 * Upload a file from the client portal response.
 * Stores in Azure Blob and creates a PortalUpload record scoped to the engagement.
 */
export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const requestId = formData.get('requestId') as string;

    if (!file || !requestId) {
      return NextResponse.json({ error: 'file and requestId are required' }, { status: 400 });
    }

    // Look up portal request to get engagement and client scope
    const request = await prisma.portalRequest.findUnique({ where: { id: requestId } });
    if (!request) {
      return NextResponse.json({ error: 'Request not found' }, { status: 404 });
    }

    // Upload to Azure Blob — path scoped by client + engagement
    const buffer = Buffer.from(await file.arrayBuffer());
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const scopePath = request.engagementId
      ? `portal-responses/${request.clientId}/${request.engagementId}/${requestId}`
      : `portal-responses/${request.clientId}/${requestId}`;
    const blobName = `${scopePath}/${Date.now()}_${safeName}`;

    await uploadToInbox(blobName, buffer, file.type || 'application/octet-stream');

    // Create PortalUpload record
    const upload = await prisma.portalUpload.create({
      data: {
        portalRequestId: requestId,
        engagementId: request.engagementId || null,
        clientId: request.clientId,
        uploadedBy: 'portal-client',
        originalName: file.name,
        storagePath: blobName,
        containerName: 'upload-inbox',
        fileSize: buffer.length,
        mimeType: file.type || null,
      },
    });

    // Generate a time-limited download URL
    const url = generateSasUrl(blobName, 'upload-inbox', 60);

    return NextResponse.json({
      uploadId: upload.id,
      fileName: file.name,
      storagePath: blobName,
      url,
    });
  } catch (error: any) {
    console.error('Portal file upload error:', error);
    return NextResponse.json({ error: error.message || 'Upload failed' }, { status: 500 });
  }
}
