import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { deleteBlob } from '@/lib/azure-blob';

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  try {
    const { fileId, hide } = await req.json();
    if (!fileId) return NextResponse.json({ error: 'fileId required' }, { status: 400 });

    // Get the file and verify ownership via job
    const file = await prisma.docSummaryFile.findUnique({
      where: { id: fileId },
      include: { job: { select: { userId: true } } },
    });

    if (!file) return NextResponse.json({ error: 'File not found' }, { status: 404 });
    if (file.job.userId !== session.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Hide mode: mark file as hidden in DB (for analysed/failed files)
    if (hide) {
      await prisma.docSummaryFile.update({
        where: { id: fileId },
        data: { hidden: true },
      });
      return NextResponse.json({ ok: true });
    }

    // Only allow deletion if file hasn't been analysed
    if (file.status === 'analysed') {
      return NextResponse.json({ error: 'Cannot delete analysed files — use hide instead' }, { status: 400 });
    }

    // Delete blob from Azure
    try {
      await deleteBlob(file.storagePath, file.containerName);
    } catch {
      // Non-fatal — blob might already be gone
    }

    // Delete findings (if any from partial processing)
    await prisma.docSummaryFinding.deleteMany({ where: { fileId } });

    // Delete the file record
    await prisma.docSummaryFile.delete({ where: { id: fileId } });

    // Update job total count
    const remaining = await prisma.docSummaryFile.count({ where: { jobId: file.jobId } });
    await prisma.docSummaryJob.update({
      where: { id: file.jobId },
      data: { totalFiles: remaining },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[DocSummary:RemoveFile] Failed | error=${msg}`);
    return NextResponse.json({ error: 'Remove failed' }, { status: 500 });
  }
}
