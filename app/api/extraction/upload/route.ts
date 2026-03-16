import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { uploadToInbox, generateBlobName, CONTAINERS } from '@/lib/azure-blob';
import { getMimeType, isSupportedForExtraction } from '@/lib/gemini-extractor';
import JSZip from 'jszip';

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

    // Create extraction job
    const job = await prisma.extractionJob.create({
      data: {
        clientId,
        userId: session.user.id,
        status: 'pending',
      },
    });

    const uploadedFiles: { id: string; name: string; status: string }[] = [];

    for (const file of files) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const fileName = file.name;
      const isZip = fileName.toLowerCase().endsWith('.zip');

      if (isZip) {
        // Unzip and upload each file individually
        const zip = await JSZip.loadAsync(buffer);
        for (const [zipPath, zipEntry] of Object.entries(zip.files)) {
          if (zipEntry.dir) continue;
          const entryName = zipPath.split('/').pop() || zipPath;
          if (!isSupportedForExtraction(entryName)) continue;

          const entryBuffer = Buffer.from(await zipEntry.async('arraybuffer'));
          const blobName = generateBlobName(job.id, entryName);
          const mimeType = getMimeType(entryName);

          await uploadToInbox(blobName, entryBuffer, mimeType);

          const fileRecord = await prisma.extractionFile.create({
            data: {
              jobId: job.id,
              originalName: entryName,
              storagePath: blobName,
              containerName: CONTAINERS.INBOX,
              fileSize: entryBuffer.length,
              mimeType,
              wasZipped: true,
              zipSourceName: fileName,
              status: 'uploaded',
            },
          });

          uploadedFiles.push({ id: fileRecord.id, name: entryName, status: 'uploaded' });
        }
      } else {
        if (!isSupportedForExtraction(fileName)) continue;

        const mimeType = getMimeType(fileName);
        const blobName = generateBlobName(job.id, fileName);

        await uploadToInbox(blobName, buffer, mimeType);

        const fileRecord = await prisma.extractionFile.create({
          data: {
            jobId: job.id,
            originalName: fileName,
            storagePath: blobName,
            containerName: CONTAINERS.INBOX,
            fileSize: buffer.length,
            mimeType,
            wasZipped: false,
            status: 'uploaded',
          },
        });

        uploadedFiles.push({ id: fileRecord.id, name: fileName, status: 'uploaded' });
      }
    }

    return NextResponse.json({
      jobId: job.id,
      filesUploaded: uploadedFiles.length,
      files: uploadedFiles,
    });
  } catch (error) {
    console.error('Upload error:', error);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}
