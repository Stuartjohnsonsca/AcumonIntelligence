import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { uploadToInbox, generateSasUrl } from '@/lib/azure-blob';

/**
 * GET /api/portal/upload?requestId=X  — uploads for a specific portal request
 * GET /api/portal/upload?engagementId=X&processLabel=Y — uploads for walkthrough requests matching a process
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const requestId = searchParams.get('requestId');
  const engagementId = searchParams.get('engagementId');
  const processLabel = searchParams.get('processLabel');

  if (requestId) {
    const uploads = await prisma.portalUpload.findMany({
      where: { portalRequestId: requestId },
      select: { id: true, originalName: true, storagePath: true, containerName: true, mimeType: true, fileSize: true },
      orderBy: { createdAt: 'asc' },
    });
    return NextResponse.json({ uploads });
  }

  if (engagementId) {
    // Find all walkthrough-related portal requests for this engagement + process
    const where: any = { engagementId, status: { in: ['responded', 'verified', 'committed', 'outstanding'] } };
    if (processLabel) {
      where.question = { contains: processLabel };
    }
    const requests = await prisma.portalRequest.findMany({
      where,
      select: { id: true },
    });
    if (requests.length === 0) return NextResponse.json({ uploads: [] });

    const uploads = await prisma.portalUpload.findMany({
      where: { portalRequestId: { in: requests.map(r => r.id) } },
      select: { id: true, originalName: true, storagePath: true, containerName: true, mimeType: true, fileSize: true },
      orderBy: { createdAt: 'asc' },
    });
    return NextResponse.json({ uploads });
  }

  return NextResponse.json({ error: 'requestId or engagementId required' }, { status: 400 });
}

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
