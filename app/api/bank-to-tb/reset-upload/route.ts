import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { deleteBlob } from '@/lib/azure-blob';

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const { sessionId } = await req.json();

  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
  }

  const btbSession = await prisma.bankToTBSession.findUnique({
    where: { id: sessionId },
    include: { files: true },
  });

  if (!btbSession || btbSession.userId !== session.user.id) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  // Delete blobs from Azure Storage
  for (const file of btbSession.files) {
    try {
      await deleteBlob(file.storagePath, file.containerName);
    } catch (err) {
      console.warn(`[Reset] Failed to delete blob ${file.storagePath}:`, err);
    }
  }

  // Delete all data for this session
  await prisma.$transaction(async (tx) => {
    // Delete journal lines first (FK constraint)
    const journals = await tx.journal.findMany({ where: { sessionId }, select: { id: true } });
    if (journals.length > 0) {
      await tx.journalLine.deleteMany({ where: { journalId: { in: journals.map(j => j.id) } } });
      await tx.journal.deleteMany({ where: { sessionId } });
    }

    await tx.trialBalanceEntry.deleteMany({ where: { sessionId } });
    await tx.bankTransaction.deleteMany({ where: { sessionId } });
    await tx.bankAccount.deleteMany({ where: { sessionId } });
    await tx.bankToTBFile.deleteMany({ where: { sessionId } });

    // Cancel any running background tasks
    await tx.backgroundTask.updateMany({
      where: {
        userId: session.user.id,
        type: 'bank-to-tb-parse',
        status: 'running',
      },
      data: { status: 'cancelled' },
    });
  });

  console.log(`[Reset] Cleared session ${sessionId}: ${btbSession.files.length} files, blobs, transactions, accounts, trial balance, journals`);

  return NextResponse.json({ success: true });
}
