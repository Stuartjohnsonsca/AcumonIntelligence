import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { generateSasUrl, CONTAINERS } from '@/lib/azure-blob';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ fileId: string }> },
) {
  const { fileId } = await params;
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const file = await prisma.extractionFile.findUnique({
    where: { id: fileId },
    include: {
      job: {
        select: {
          id: true,
          clientId: true,
          status: true,
          client: { select: { firmId: true } },
        },
      },
    },
  });

  if (!file) {
    return NextResponse.json({ error: 'File not found' }, { status: 404 });
  }

  if (file.status === 'expired') {
    return NextResponse.json({ error: 'Document has expired and is no longer available' }, { status: 410 });
  }

  if (!session.user.isSuperAdmin && file.job.client.firmId !== session.user.firmId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const containerName = file.containerName || CONTAINERS.PROCESSED;

  try {
    const url = generateSasUrl(file.storagePath, containerName, 15);

    return NextResponse.json({
      url,
      originalName: file.originalName,
      mimeType: file.mimeType,
      pageCount: file.pageCount || 1,
      fileId: file.id,
    });
  } catch (err) {
    console.error('SAS generation error:', err);
    return NextResponse.json({ error: 'Failed to generate document URL' }, { status: 500 });
  }
}
