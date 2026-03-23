import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

// POST - organise transactions by bank account, creating tabs
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
    include: { transactions: true },
  });

  if (!btbSession || btbSession.userId !== session.user.id) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  // Group transactions by sort code + account number
  const groups = new Map<string, { bankName: string; sortCode: string; accountNumber: string; txns: typeof btbSession.transactions }>();

  for (const txn of btbSession.transactions) {
    const key = `${txn.sortCode || 'unknown'}-${txn.accountNumber || 'unknown'}`;
    if (!groups.has(key)) {
      groups.set(key, {
        bankName: txn.bankName || 'Unknown Bank',
        sortCode: txn.sortCode || '',
        accountNumber: txn.accountNumber || '',
        txns: [],
      });
    }
    groups.get(key)!.txns.push(txn);
  }

  if (groups.size <= 1) {
    return NextResponse.json({ organised: false, message: 'Only one account found', accountCount: groups.size });
  }

  // Create BankAccount records and assign transactions
  const accounts: { id: string; bankName: string; sortCode: string; accountNumber: string }[] = [];
  let tabOrder = 0;

  for (const [, group] of groups) {
    // Calculate opening and closing balances from transactions
    const sortedTxns = group.txns.sort((a, b) => a.date.getTime() - b.date.getTime());
    const firstBalance = sortedTxns[0]?.balance;
    const lastBalance = sortedTxns[sortedTxns.length - 1]?.balance;

    // Opening balance = first balance - first transaction effect
    const firstTxnEffect = (sortedTxns[0]?.credit || 0) - (sortedTxns[0]?.debit || 0);
    const openingBalance = firstBalance != null ? firstBalance - firstTxnEffect : null;

    const account = await prisma.bankAccount.create({
      data: {
        sessionId,
        bankName: group.bankName,
        sortCode: group.sortCode,
        accountNumber: group.accountNumber,
        openingBalance,
        closingBalance: lastBalance,
        tabOrder: tabOrder++,
      },
    });

    // Update transactions with accountId
    await prisma.bankTransaction.updateMany({
      where: {
        id: { in: group.txns.map(t => t.id) },
      },
      data: { accountId: account.id },
    });

    accounts.push({
      id: account.id,
      bankName: account.bankName || '',
      sortCode: account.sortCode || '',
      accountNumber: account.accountNumber || '',
    });
  }

  return NextResponse.json({ organised: true, accounts });
}
