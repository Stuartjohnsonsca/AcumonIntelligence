import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { uploadToInbox, generateBlobName, CONTAINERS } from '@/lib/azure-blob';
import { verifyClientAccess } from '@/lib/client-access';

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  try {
    const formData = await req.formData();
    const clientId = formData.get('clientId') as string;
    const files = formData.getAll('files') as File[];

    if (!clientId) return NextResponse.json({ error: 'clientId required' }, { status: 400 });
    if (!files.length) return NextResponse.json({ error: 'No files provided' }, { status: 400 });

    // Only accept PDFs
    for (const file of files) {
      if (!file.name.toLowerCase().endsWith('.pdf')) {
        return NextResponse.json(
          { error: `Only PDF files are accepted. "${file.name}" is not a PDF.` },
          { status: 400 },
        );
      }
    }

    const access = await verifyClientAccess(
      session.user as { id: string; firmId: string; isSuperAdmin?: boolean },
      clientId,
    );
    if (!access.allowed) {
      return NextResponse.json({ error: access.reason || 'Forbidden' }, { status: 403 });
    }

    // Reuse existing pending job for same client/user, or create a new one
    let job = await prisma.docSummaryJob.findFirst({
      where: {
        clientId,
        userId: session.user.id,
        status: 'pending',
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

    const uploadedFiles: { id: string; name: string; status: string }[] = [];

    for (const file of files) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const blobName = `doc-summary/${clientId}/${job.id}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

      await uploadToInbox(blobName, buffer, 'application/pdf');

      const fileRecord = await prisma.docSummaryFile.create({
        data: {
          jobId: job.id,
          originalName: file.name,
          storagePath: blobName,
          containerName: CONTAINERS.INBOX,
          fileSize: buffer.length,
          mimeType: 'application/pdf',
          status: 'uploaded',
        },
      });

      uploadedFiles.push({ id: fileRecord.id, name: file.name, status: 'uploaded' });
    }

    // Update job total files count
    const totalFiles = await prisma.docSummaryFile.count({ where: { jobId: job.id } });
    await prisma.docSummaryJob.update({
      where: { id: job.id },
      data: { totalFiles },
    });

    // Return only the newly uploaded files (client appends to existing)
    return NextResponse.json({
      jobId: job.id,
      files: uploadedFiles,
      totalFiles,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    console.error(`[DocSummary:Upload] Failed | user=${session.user.id} | error=${msg}`, stack ? `\n${stack}` : '');
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}
