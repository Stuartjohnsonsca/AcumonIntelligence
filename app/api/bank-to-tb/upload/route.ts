import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { verifyClientAccess } from '@/lib/client-access';
import { uploadToInbox } from '@/lib/azure-blob';
import crypto from 'crypto';

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const formData = await req.formData();
  const sessionId = formData.get('sessionId') as string;
  const files = formData.getAll('files') as File[];

  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
  }

  if (!files.length) {
    return NextResponse.json({ error: 'No files provided' }, { status: 400 });
  }

  // Verify session exists and user owns it
  const btbSession = await prisma.bankToTBSession.findUnique({
    where: { id: sessionId },
  });

  if (!btbSession) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  if (btbSession.userId !== session.user.id) {
    const access = await verifyClientAccess(
      { id: session.user.id, firmId: session.user.firmId || '' },
      btbSession.clientId
    );
    if (!access.allowed) {
      return NextResponse.json({ error: access.reason || 'Access denied' }, { status: 403 });
    }
  }

  const containerName = 'upload-inbox';
  const uploadedFiles: { id: string; name: string; status: string }[] = [];

  for (const file of files) {
    const buffer = Buffer.from(await file.arrayBuffer());
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    const storagePath = `bank-to-tb/${sessionId}/${Date.now()}-${file.name}`;

    // Upload to Azure Blob
    await uploadToInbox(storagePath, buffer, file.type);

    // Create file record
    const fileRecord = await prisma.bankToTBFile.create({
      data: {
        sessionId,
        originalName: file.name,
        storagePath,
        containerName,
        fileSize: buffer.length,
        mimeType: file.type,
        fileHash: hash,
        status: 'uploaded',
      },
    });

    uploadedFiles.push({
      id: fileRecord.id,
      name: fileRecord.originalName,
      status: fileRecord.status,
    });
  }

  // Create a background task for tracking
  await prisma.backgroundTask.create({
    data: {
      userId: session.user.id,
      clientId: btbSession.clientId,
      type: 'bank-to-tb-parse',
      status: 'running',
      progress: { sessionId, fileCount: files.length, processed: 0 },
    },
  });

  return NextResponse.json({
    success: true,
    sessionId,
    files: uploadedFiles,
  });
}
