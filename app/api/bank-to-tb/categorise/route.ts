import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

// POST - categorise individual transactions (from unmatched popup)
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const { sessionId, categorisations } = await req.json();
  // categorisations: Array<{ transactionId, accountCode, accountName, categoryType }>

  if (!sessionId || !categorisations?.length) {
    return NextResponse.json({ error: 'sessionId and categorisations required' }, { status: 400 });
  }

  const btbSession = await prisma.bankToTBSession.findUnique({
    where: { id: sessionId },
  });

  if (!btbSession || btbSession.userId !== session.user.id) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  for (const cat of categorisations) {
    const { transactionId, accountCode, accountName, categoryType } = cat;

    // Update the transaction
    const txn = await prisma.bankTransaction.update({
      where: { id: transactionId },
      data: {
        accountCode,
        accountNameMapped: accountName,
        categoryType,
      },
    });

    // Update or create TB entry
    const existing = await prisma.trialBalanceEntry.findUnique({
      where: { sessionId_accountCode: { sessionId, accountCode } },
    });

    if (existing) {
      if (btbSession.combineMode === 'separate' && txn.accountId) {
        const colData = (existing.columnData || {}) as Record<string, { debit: number; credit: number }>;
        const accId = txn.accountId;
        if (!colData[accId]) colData[accId] = { debit: 0, credit: 0 };
        colData[accId].debit += txn.debit;
        colData[accId].credit += txn.credit;

        await prisma.trialBalanceEntry.update({
          where: { id: existing.id },
          data: {
            combinedDebit: { increment: txn.debit },
            combinedCredit: { increment: txn.credit },
            columnData: colData,
          },
        });
      } else {
        await prisma.trialBalanceEntry.update({
          where: { id: existing.id },
          data: {
            combinedDebit: { increment: txn.debit },
            combinedCredit: { increment: txn.credit },
          },
        });
      }
    } else {
      const colData: Record<string, { debit: number; credit: number }> = {};
      if (btbSession.combineMode === 'separate' && txn.accountId) {
        colData[txn.accountId] = { debit: txn.debit, credit: txn.credit };
      }

      await prisma.trialBalanceEntry.create({
        data: {
          sessionId,
          accountCode,
          accountName,
          categoryType,
          combinedDebit: txn.debit,
          combinedCredit: txn.credit,
          columnData: btbSession.combineMode === 'separate' ? colData : undefined,
          sortOrder: 999, // append at end
        },
      });
    }

    // Save mapping for future use
    await prisma.accountCodeMapping.upsert({
      where: {
        firmId_description: {
          firmId: user.firmId,
          description: txn.description,
        },
      },
      create: {
        firmId: user.firmId,
        description: txn.description,
        accountCode,
        accountName,
        categoryType,
      },
      update: {
        accountCode,
        accountName,
        categoryType,
      },
    });
  }

  // Reload TB
  const updatedTB = await prisma.trialBalanceEntry.findMany({
    where: { sessionId },
    orderBy: { sortOrder: 'asc' },
  });

  // Check for remaining uncategorised transactions
  const remaining = await prisma.bankTransaction.count({
    where: { sessionId, inPeriod: true, accountCode: null },
  });

  return NextResponse.json({
    success: true,
    trialBalance: updatedTB,
    remainingUncategorised: remaining,
  });
}
