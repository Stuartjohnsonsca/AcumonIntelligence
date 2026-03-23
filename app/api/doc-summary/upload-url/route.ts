import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { verifyClientAccess } from '@/lib/client-access';
import { CONTAINERS } from '@/lib/azure-blob';
import { logActivity, logError, requestContext } from '@/lib/logger';
import {
  BlobSASPermissions,
  generateBlobSASQueryParameters,
  StorageSharedKeyCredential,
  SASProtocol,
} from '@azure/storage-blob';

const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING!;

function generateWriteSasUrl(
  blobName: string,
  containerName: string,
  expiryMinutes = 30,
): string {
  const match = connectionString.match(/AccountName=([^;]+)/);
  const keyMatch = connectionString.match(/AccountKey=([^;]+)/);
  if (!match || !keyMatch)
    throw new Error('Cannot parse Azure connection string for SAS generation');

  const accountName = match[1];
  const accountKey = keyMatch[1];
  const credential = new StorageSharedKeyCredential(accountName, accountKey);

  const startsOn = new Date();
  const expiresOn = new Date(startsOn.getTime() + expiryMinutes * 60 * 1000);

  const sasToken = generateBlobSASQueryParameters(
    {
      containerName,
      blobName,
      permissions: BlobSASPermissions.parse('cw'), // create + write
      startsOn,
      expiresOn,
      protocol: SASProtocol.Https,
    },
    credential,
  ).toString();

  return `https://${accountName}.blob.core.windows.net/${containerName}/${blobName}?${sasToken}`;
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { clientId, fileName, fileSize, jobId: existingJobId, forceNew } = body as {
      clientId: string;
      fileName: string;
      fileSize: number;
      jobId?: string;
      forceNew?: boolean;
    };

    if (!clientId) return NextResponse.json({ error: 'clientId required' }, { status: 400 });
    if (!fileName) return NextResponse.json({ error: 'fileName required' }, { status: 400 });
    if (!fileSize || fileSize <= 0) return NextResponse.json({ error: 'fileSize required' }, { status: 400 });

    const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
    if (fileSize > MAX_FILE_SIZE) {
      return NextResponse.json({ error: 'File exceeds the 50 MB size limit.' }, { status: 400 });
    }

    if (!fileName.toLowerCase().endsWith('.pdf')) {
      return NextResponse.json({ error: 'Only PDF files are accepted.' }, { status: 400 });
    }

    const access = await verifyClientAccess(
      session.user as { id: string; firmId: string; isSuperAdmin?: boolean },
      clientId,
    );
    if (!access.allowed) {
      return NextResponse.json({ error: access.reason || 'Forbidden' }, { status: 403 });
    }

    // Reuse existing job or find/create one
    // forceNew=true skips the lookup so a fresh job is always created
    let job = existingJobId
      ? await prisma.docSummaryJob.findUnique({ where: { id: existingJobId } })
      : forceNew
        ? null
        : await prisma.docSummaryJob.findFirst({
            where: {
              clientId,
              userId: session.user.id,
              status: { in: ['pending', 'complete'] },
            },
            orderBy: { createdAt: 'desc' },
          });

    if (!job) {
      const expiresAt = new Date(Date.now() + 121 * 24 * 60 * 60 * 1000);
      job = await prisma.docSummaryJob.create({
        data: {
          clientId,
          userId: session.user.id,
          status: 'pending',
          expiresAt,
        },
      });
    }

    const sanitisedName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const blobPath = `doc-summary/${clientId}/${job.id}/${Date.now()}_${sanitisedName}`;

    // Create file record with status 'uploading'
    const fileRecord = await prisma.docSummaryFile.create({
      data: {
        jobId: job.id,
        originalName: fileName,
        storagePath: blobPath,
        containerName: CONTAINERS.INBOX,
        fileSize,
        mimeType: 'application/pdf',
        status: 'uploading',
      },
    });

    const sasUrl = generateWriteSasUrl(blobPath, CONTAINERS.INBOX, 30);

    // Non-blocking activity log
    logActivity({
      userId: session.user.id,
      firmId: (session.user as { firmId?: string }).firmId,
      clientId,
      action: 'upload',
      tool: 'doc-summary',
      detail: { fileName, fileSize, jobId: job.id, fileId: fileRecord.id },
      ipAddress: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || undefined,
      userAgent: req.headers.get('user-agent') || undefined,
    });

    return NextResponse.json({
      sasUrl,
      blobPath,
      fileId: fileRecord.id,
      jobId: job.id,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[DocSummary:UploadUrl] Failed | error=${msg}`);
    logError({
      userId: session.user.id,
      route: '/api/doc-summary/upload-url',
      tool: 'doc-summary',
      message: msg,
      stack: error instanceof Error ? error.stack : undefined,
      context: requestContext(req),
    });
    return NextResponse.json({ error: 'Failed to generate upload URL' }, { status: 500 });
  }
}
