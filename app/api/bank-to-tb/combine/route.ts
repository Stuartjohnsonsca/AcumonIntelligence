import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const { sessionId, mode } = await req.json(); // mode: 'together' | 'separate'
  if (!sessionId || !mode) {
    return NextResponse.json({ error: 'sessionId and mode required' }, { status: 400 });
  }

  const btbSession = await prisma.bankToTBSession.findUnique({
    where: { id: sessionId },
    include: {
      transactions: { where: { inPeriod: true } },
      trialBalance: true,
      accounts: true,
    },
  });

  if (!btbSession || btbSession.userId !== session.user.id) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  // Load firm account code mappings for automatic categorisation
  const mappings = await prisma.accountCodeMapping.findMany({
    where: { firmId: user.firmId },
  });

  const mappingMap = new Map(mappings.map(m => [m.description.toLowerCase(), m]));

  // Build a map of existing TB entries by account code
  const tbMap = new Map(btbSession.trialBalance.map(tb => [tb.accountCode, tb]));

  // Categorise transactions
  const matched: { txn: typeof btbSession.transactions[0]; mapping: typeof mappings[0] }[] = [];
  const unmatched: typeof btbSession.transactions = [];

  for (const txn of btbSession.transactions) {
    // Try exact match first, then partial
    const descLower = txn.description.toLowerCase();
    let found = mappingMap.get(descLower);

    if (!found) {
      // Try partial matching
      for (const [key, mapping] of mappingMap) {
        if (descLower.includes(key) || key.includes(descLower)) {
          found = mapping;
          break;
        }
      }
    }

    // Also check if already categorised
    if (txn.accountCode) {
      const existingTb = tbMap.get(txn.accountCode);
      if (existingTb) {
        matched.push({
          txn,
          mapping: {
            id: 'existing',
            firmId: user.firmId,
            description: txn.description,
            accountCode: txn.accountCode,
            accountName: txn.accountNameMapped || existingTb.accountName,
            categoryType: existingTb.categoryType,
            createdAt: new Date(),
          },
        });
        continue;
      }
    }

    if (found) {
      matched.push({ txn, mapping: found });
    } else {
      unmatched.push(txn);
    }
  }

  // Update TB entries with categorised amounts
  if (mode === 'together') {
    // Combine all bank accounts into one column
    for (const { txn, mapping } of matched) {
      const existing = tbMap.get(mapping.accountCode);
      if (existing) {
        await prisma.trialBalanceEntry.update({
          where: { id: existing.id },
          data: {
            combinedDebit: { increment: txn.debit },
            combinedCredit: { increment: txn.credit },
          },
        });
      } else {
        const newEntry = await prisma.trialBalanceEntry.create({
          data: {
            sessionId,
            accountCode: mapping.accountCode,
            accountName: mapping.accountName,
            categoryType: mapping.categoryType,
            combinedDebit: txn.debit,
            combinedCredit: txn.credit,
            sortOrder: btbSession.trialBalance.length,
          },
        });
        tbMap.set(mapping.accountCode, newEntry);
      }

      // Update transaction with categorisation
      await prisma.bankTransaction.update({
        where: { id: txn.id },
        data: {
          accountCode: mapping.accountCode,
          accountNameMapped: mapping.accountName,
          categoryType: mapping.categoryType,
        },
      });
    }
  } else {
    // Combine as separate - per bank account columns
    for (const { txn, mapping } of matched) {
      const accountId = txn.accountId || 'combined';
      const existing = tbMap.get(mapping.accountCode);

      if (existing) {
        const colData = (existing.columnData || {}) as Record<string, { debit: number; credit: number }>;
        if (!colData[accountId]) colData[accountId] = { debit: 0, credit: 0 };
        colData[accountId].debit += txn.debit;
        colData[accountId].credit += txn.credit;

        await prisma.trialBalanceEntry.update({
          where: { id: existing.id },
          data: {
            combinedDebit: { increment: txn.debit },
            combinedCredit: { increment: txn.credit },
            columnData: colData,
          },
        });
      } else {
        const colData: Record<string, { debit: number; credit: number }> = {};
        colData[accountId] = { debit: txn.debit, credit: txn.credit };

        const newEntry = await prisma.trialBalanceEntry.create({
          data: {
            sessionId,
            accountCode: mapping.accountCode,
            accountName: mapping.accountName,
            categoryType: mapping.categoryType,
            combinedDebit: txn.debit,
            combinedCredit: txn.credit,
            columnData: colData,
            sortOrder: btbSession.trialBalance.length,
          },
        });
        tbMap.set(mapping.accountCode, newEntry);
      }

      await prisma.bankTransaction.update({
        where: { id: txn.id },
        data: {
          accountCode: mapping.accountCode,
          accountNameMapped: mapping.accountName,
          categoryType: mapping.categoryType,
        },
      });
    }
  }

  // Update session combine mode
  await prisma.bankToTBSession.update({
    where: { id: sessionId },
    data: { combineMode: mode },
  });

  // Reload TB
  const updatedTB = await prisma.trialBalanceEntry.findMany({
    where: { sessionId },
    orderBy: { sortOrder: 'asc' },
  });

  return NextResponse.json({
    success: true,
    matchedCount: matched.length,
    unmatchedCount: unmatched.length,
    unmatched: unmatched.map(t => ({
      id: t.id,
      date: t.date,
      description: t.description,
      debit: t.debit,
      credit: t.credit,
      accountId: t.accountId,
    })),
    trialBalance: updatedTB,
  });
}
