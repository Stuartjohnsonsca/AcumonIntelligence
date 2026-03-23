import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const sessionId = searchParams.get('sessionId');

  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId required' }, { status: 400 });
  }

  const btbSession = await prisma.bankToTBSession.findUnique({
    where: { id: sessionId },
    include: {
      files: {
        select: {
          id: true,
          originalName: true,
          status: true,
          errorMessage: true,
          pageCount: true,
        },
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  if (!btbSession || btbSession.userId !== session.user.id) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  const totalFiles = btbSession.files.length;
  const extractedCount = btbSession.files.filter(f => f.status === 'extracted').length;
  const processingCount = btbSession.files.filter(f => f.status === 'processing').length;
  const failedCount = btbSession.files.filter(f => f.status === 'failed').length;
  const allDone = totalFiles > 0 && extractedCount + failedCount === totalFiles;

  // Get background task progress for detailed stage info
  const bgTask = await prisma.backgroundTask.findFirst({
    where: {
      userId: session.user.id,
      type: 'bank-to-tb-parse',
      status: 'running',
    },
    orderBy: { createdAt: 'desc' },
  });

  const taskProgress = bgTask?.progress as { stage?: string; currentFile?: string; transactionCount?: number } | null;

  return NextResponse.json({
    sessionId,
    files: btbSession.files,
    summary: {
      total: totalFiles,
      extracted: extractedCount,
      processing: processingCount,
      failed: failedCount,
      complete: allDone,
    },
    progress: taskProgress ? {
      stage: taskProgress.stage || 'processing',
      currentFile: taskProgress.currentFile || null,
      transactionCount: taskProgress.transactionCount || 0,
    } : null,
  });
}
