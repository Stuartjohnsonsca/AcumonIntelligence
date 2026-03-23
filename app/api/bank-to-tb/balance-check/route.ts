import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const { sessionId } = await req.json();
  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId required' }, { status: 400 });
  }

  const btbSession = await prisma.bankToTBSession.findUnique({
    where: { id: sessionId },
    include: {
      accounts: true,
      transactions: { where: { inPeriod: true } },
      trialBalance: true,
    },
  });

  if (!btbSession || btbSession.userId !== session.user.id) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  const errors: { type: string; message: string; details?: Record<string, unknown> }[] = [];

  // Check 1: Column totals should be nil (Dr = Cr)
  for (const tb of btbSession.trialBalance) {
    const totalDebit = tb.openingDebit + tb.combinedDebit;
    const totalCredit = tb.openingCredit + tb.combinedCredit;

    // Include journal data
    const journalData = (tb.journalData || {}) as Record<string, { debit: number; credit: number }>;
    let jrnlDebit = 0;
    let jrnlCredit = 0;
    for (const jd of Object.values(journalData)) {
      jrnlDebit += jd.debit || 0;
      jrnlCredit += jd.credit || 0;
    }

    const netDebit = totalDebit + jrnlDebit;
    const netCredit = totalCredit + jrnlCredit;

    if (Math.abs(netDebit - netCredit) > 0.01) {
      // This is expected - individual rows won't balance, only totals
    }
  }

  // Check 2: Overall TB balance (total debits should equal total credits)
  let totalTBDebit = 0;
  let totalTBCredit = 0;
  for (const tb of btbSession.trialBalance) {
    const journalData = (tb.journalData || {}) as Record<string, { debit: number; credit: number }>;
    let jrnlDebit = 0;
    let jrnlCredit = 0;
    for (const jd of Object.values(journalData)) {
      jrnlDebit += jd.debit || 0;
      jrnlCredit += jd.credit || 0;
    }
    totalTBDebit += tb.openingDebit + tb.combinedDebit + jrnlDebit;
    totalTBCredit += tb.openingCredit + tb.combinedCredit + jrnlCredit;
  }

  if (Math.abs(totalTBDebit - totalTBCredit) > 0.01) {
    errors.push({
      type: 'tb_imbalance',
      message: `Trial Balance does not balance. Total Debits: ${totalTBDebit.toFixed(2)}, Total Credits: ${totalTBCredit.toFixed(2)}, Difference: ${(totalTBDebit - totalTBCredit).toFixed(2)}`,
      details: { totalDebit: totalTBDebit, totalCredit: totalTBCredit },
    });
  }

  // Check 3: Bank balance reconciliation per account
  if (btbSession.combineMode === 'separate') {
    for (const account of btbSession.accounts) {
      // Sum of bank transactions for this account
      const accountTxns = btbSession.transactions.filter(t => t.accountId === account.id);
      const txnNetMovement = accountTxns.reduce((sum, t) => sum + t.credit - t.debit, 0);

      // Find the bank/cash TB entry for this account
      const bankTBEntries = btbSession.trialBalance.filter(tb => {
        const colData = (tb.columnData || {}) as Record<string, { debit: number; credit: number }>;
        return colData[account.id] !== undefined;
      });

      const tbNetMovement = bankTBEntries.reduce((sum, tb) => {
        const colData = (tb.columnData || {}) as Record<string, { debit: number; credit: number }>;
        const col = colData[account.id];
        return sum + (col?.credit || 0) - (col?.debit || 0);
      }, 0);

      if (Math.abs(txnNetMovement - tbNetMovement) > 0.01) {
        errors.push({
          type: 'bank_reconciliation',
          message: `Bank account ${account.accountNumber || account.bankName} reconciliation difference: ${(txnNetMovement - tbNetMovement).toFixed(2)}`,
          details: {
            accountId: account.id,
            accountNumber: account.accountNumber,
            bankName: account.bankName,
            transactionMovement: txnNetMovement,
            tbMovement: tbNetMovement,
          },
        });
      }
    }
  } else {
    // Combined - check total movement
    const totalTxnMovement = btbSession.transactions.reduce((sum, t) => sum + t.credit - t.debit, 0);
    const totalCombinedMovement = btbSession.trialBalance.reduce((sum, tb) => sum + tb.combinedCredit - tb.combinedDebit, 0);

    if (Math.abs(totalTxnMovement - totalCombinedMovement) > 0.01) {
      errors.push({
        type: 'bank_reconciliation',
        message: `Combined Accounts reconciliation difference: ${(totalTxnMovement - totalCombinedMovement).toFixed(2)}`,
        details: {
          accountLabel: 'Combined Accounts',
          transactionMovement: totalTxnMovement,
          tbMovement: totalCombinedMovement,
        },
      });
    }
  }

  return NextResponse.json({
    balanced: errors.length === 0,
    errors,
    totals: {
      totalDebit: totalTBDebit,
      totalCredit: totalTBCredit,
      difference: totalTBDebit - totalTBCredit,
    },
  });
}
