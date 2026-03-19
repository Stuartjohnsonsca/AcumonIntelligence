import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  try {
    const { fileId, jobId } = (await req.json()) as { fileId: string; jobId: string };

    if (!fileId) return NextResponse.json({ error: 'fileId required' }, { status: 400 });
    if (!jobId) return NextResponse.json({ error: 'jobId required' }, { status: 400 });

    // Verify the file belongs to the job and is in 'uploading' state
    const file = await prisma.docSummaryFile.findUnique({ where: { id: fileId } });
    if (!file || file.jobId !== jobId) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }
    if (file.status !== 'uploading') {
      return NextResponse.json({ error: 'File is not in uploading state' }, { status: 400 });
    }

    // Mark file as uploaded
    await prisma.docSummaryFile.update({
      where: { id: fileId },
      data: { status: 'uploaded' },
    });

    // Update job totalFiles count and reset to pending if it was complete
    const job = await prisma.docSummaryJob.findUnique({ where: { id: jobId } });
    const totalFiles = await prisma.docSummaryFile.count({
      where: { jobId, status: { not: 'uploading' } },
    });
    await prisma.docSummaryJob.update({
      where: { id: jobId },
      data: {
        totalFiles,
        status: job?.status === 'complete' ? 'pending' : job?.status,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[DocSummary:UploadComplete] Failed | error=${msg}`);
    return NextResponse.json({ error: 'Failed to complete upload' }, { status: 500 });
  }
}
