import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { generateSasUrl } from '@/lib/azure-blob';

/**
 * GET /api/portal/download?uploadId=X
 * Generate a time-limited SAS download URL for a portal upload.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const uploadId = searchParams.get('uploadId');
  const storagePath = searchParams.get('storagePath');

  if (!uploadId && !storagePath) {
    return NextResponse.json({ error: 'uploadId or storagePath required' }, { status: 400 });
  }

  try {
    let blobName: string;
    let fileName: string;

    if (uploadId) {
      const upload = await prisma.portalUpload.findUnique({ where: { id: uploadId } });
      if (!upload) return NextResponse.json({ error: 'Upload not found' }, { status: 404 });
      blobName = upload.storagePath;
      fileName = upload.originalName;
    } else {
      blobName = storagePath!;
      fileName = blobName.split('/').pop() || 'download';
    }

    const url = generateSasUrl(blobName, 'upload-inbox', 15);

    return NextResponse.json({ url, fileName });
  } catch (error: any) {
    console.error('Portal download error:', error);
    return NextResponse.json({ error: error.message || 'Failed to generate download URL' }, { status: 500 });
  }
}
