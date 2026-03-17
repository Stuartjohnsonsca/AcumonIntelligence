import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { uploadToInbox, generateBlobName, CONTAINERS } from '@/lib/azure-blob';
import { getMimeType, isSupportedForExtraction } from '@/lib/gemini-extractor';
import JSZip from 'jszip';
import { createHash } from 'crypto';

function computeHash(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

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

    const expiresAt = new Date(Date.now() + 121 * 24 * 60 * 60 * 1000);
    const job = await prisma.extractionJob.create({
      data: {
        clientId,
        userId: session.user.id,
        status: 'pending',
        expiresAt,
      },
    });

    const uploadedFiles: { id: string; name: string; status: string }[] = [];
    const seenHashes = new Map<string, string>(); // hash -> original fileRecord id
    let duplicateCount = 0;

    async function processEntry(
      entryBuffer: Buffer,
      entryName: string,
      mimeType: string,
      wasZipped: boolean,
      zipSourceName?: string,
    ) {
      const hash = computeHash(entryBuffer);
      const existingId = seenHashes.get(hash);

      if (existingId) {
        const dupRecord = await prisma.extractionFile.create({
          data: {
            jobId: job.id,
            originalName: entryName,
            storagePath: '',
            containerName: '',
            fileSize: entryBuffer.length,
            mimeType,
            wasZipped,
            zipSourceName: zipSourceName || null,
            status: 'duplicate',
            fileHash: hash,
            duplicateOfId: existingId,
          },
        });
        duplicateCount++;
        uploadedFiles.push({ id: dupRecord.id, name: entryName, status: 'duplicate' });
        return;
      }

      const blobName = generateBlobName(job.id, entryName);
      await uploadToInbox(blobName, entryBuffer, mimeType);

      const fileRecord = await prisma.extractionFile.create({
        data: {
          jobId: job.id,
          originalName: entryName,
          storagePath: blobName,
          containerName: CONTAINERS.INBOX,
          fileSize: entryBuffer.length,
          mimeType,
          wasZipped,
          zipSourceName: zipSourceName || null,
          status: 'uploaded',
          fileHash: hash,
        },
      });

      seenHashes.set(hash, fileRecord.id);
      uploadedFiles.push({ id: fileRecord.id, name: entryName, status: 'uploaded' });
    }

    for (const file of files) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const fileName = file.name;
      const isZip = fileName.toLowerCase().endsWith('.zip');

      if (isZip) {
        const zip = await JSZip.loadAsync(buffer);
        for (const [zipPath, zipEntry] of Object.entries(zip.files)) {
          if (zipEntry.dir) continue;
          const entryName = zipPath.split('/').pop() || zipPath;
          if (!isSupportedForExtraction(entryName)) continue;

          const entryBuffer = Buffer.from(await zipEntry.async('arraybuffer'));
          const mimeType = getMimeType(entryName);
          await processEntry(entryBuffer, entryName, mimeType, true, fileName);
        }
      } else {
        if (!isSupportedForExtraction(fileName)) continue;
        const mimeType = getMimeType(fileName);
        await processEntry(buffer, fileName, mimeType, false);
      }
    }

    const uniqueCount = uploadedFiles.filter(f => f.status === 'uploaded').length;

    await prisma.extractionJob.update({
      where: { id: job.id },
      data: { totalFiles: uniqueCount, duplicateCount },
    });

    return NextResponse.json({
      jobId: job.id,
      filesUploaded: uniqueCount,
      duplicatesSkipped: duplicateCount,
      files: uploadedFiles,
    });
  } catch (error) {
    console.error('Upload error:', error);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}
