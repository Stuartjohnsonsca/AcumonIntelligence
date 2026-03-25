import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

interface RouteParams {
  params: Promise<{ sessionId: string }>;
}

/**
 * GET - Load full session state (for initial page load when IndexedDB is empty).
 */
export async function GET(req: NextRequest, { params }: RouteParams) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { sessionId } = await params;

  const btbSession = await prisma.bankToTBSession.findFirst({
    where: { id: sessionId, userId: session.user.id },
    include: {
      files: { orderBy: { createdAt: 'asc' } },
      accounts: true,
      transactions: { orderBy: { date: 'asc' } },
      trialBalance: { orderBy: { sortOrder: 'asc' } },
      journals: { include: { lines: { orderBy: { sortOrder: 'asc' } } } },
    },
  });

  if (!btbSession) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  return NextResponse.json({
    sessionId: btbSession.id,
    clientId: btbSession.clientId,
    periodId: btbSession.periodId,
    files: btbSession.files,
    accounts: btbSession.accounts,
    transactions: btbSession.transactions,
    trialBalance: btbSession.trialBalance,
    journals: btbSession.journals,
    combineMode: btbSession.combineMode,
    openingPositionSource: btbSession.openingPositionSource,
    updatedAt: btbSession.updatedAt,
  });
}

/**
 * PUT - Auto-save session state from the Zustand store.
 * Only saves metadata fields that are tracked at the session level.
 * Individual data (files, transactions, TB) are saved via their own endpoints.
 */
export async function PUT(req: NextRequest, { params }: RouteParams) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { sessionId } = await params;
  const body = await req.json();

  // Verify ownership
  const btbSession = await prisma.bankToTBSession.findFirst({
    where: { id: sessionId, userId: session.user.id },
  });

  if (!btbSession) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  // Optimistic lock check
  if (body._updatedAt && btbSession.updatedAt) {
    const serverVersion = btbSession.updatedAt.toISOString();
    if (body._updatedAt !== serverVersion) {
      return NextResponse.json({
        error: 'Conflict — data has been modified by another session',
        serverVersion,
        localVersion: body._updatedAt,
      }, { status: 409 });
    }
  }

  // Save session-level metadata
  const updateData: Record<string, any> = {};
  if (body.combineMode !== undefined) updateData.combineMode = body.combineMode;
  if (body.openingPositionSource !== undefined) updateData.openingPositionSource = body.openingPositionSource;
  if (body.accountingFramework !== undefined) updateData.accountingFramework = body.accountingFramework;

  if (Object.keys(updateData).length > 0) {
    await prisma.bankToTBSession.update({
      where: { id: sessionId },
      data: updateData,
    });
  }

  return NextResponse.json({ success: true, updatedAt: new Date().toISOString() });
}
