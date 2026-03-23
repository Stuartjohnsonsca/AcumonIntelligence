import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// POST - validate and post a journal to the trial balance
export async function POST(req: NextRequest, { params }: RouteParams) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const { id } = await params;

  const journal = await prisma.journal.findUnique({
    where: { id },
    include: {
      session: true,
      lines: { orderBy: { sortOrder: 'asc' } },
    },
  });

  if (!journal || journal.session.userId !== session.user.id) {
    return NextResponse.json({ error: 'Journal not found' }, { status: 404 });
  }

  // Validate: total Dr must equal total Cr
  const totalDebit = journal.lines.reduce((sum, l) => sum + l.debit, 0);
  const totalCredit = journal.lines.reduce((sum, l) => sum + l.credit, 0);

  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    return NextResponse.json({
      error: 'Journal does not balance.',
      totalDebit,
      totalCredit,
      difference: totalDebit - totalCredit,
    }, { status: 400 });
  }

  // If this journal was previously posted, unpost first (reverse previous figures)
  if (journal.status === 'posted') {
    await unpostJournal(journal.id, journal.sessionId, journal.category, journal.lines);
  }

  // Post: add journal amounts to TB entries
  for (const line of journal.lines) {
    const netAmount = line.debit - line.credit;

    const existing = await prisma.trialBalanceEntry.findUnique({
      where: { sessionId_accountCode: { sessionId: journal.sessionId, accountCode: line.accountCode } },
    });

    if (existing) {
      const journalData = (existing.journalData || {}) as Record<string, { debit: number; credit: number }>;
      if (!journalData[journal.category]) {
        journalData[journal.category] = { debit: 0, credit: 0 };
      }
      journalData[journal.category].debit += line.debit;
      journalData[journal.category].credit += line.credit;

      await prisma.trialBalanceEntry.update({
        where: { id: existing.id },
        data: { journalData },
      });
    } else {
      const journalData: Record<string, { debit: number; credit: number }> = {};
      journalData[journal.category] = { debit: line.debit, credit: line.credit };

      await prisma.trialBalanceEntry.create({
        data: {
          sessionId: journal.sessionId,
          accountCode: line.accountCode,
          accountName: line.accountName,
          categoryType: 'Overheads', // default, should be looked up
          journalData,
          sortOrder: 999,
        },
      });
    }
  }

  // Update journal status
  await prisma.journal.update({
    where: { id },
    data: { status: 'posted' },
  });

  // Reload TB
  const updatedTB = await prisma.trialBalanceEntry.findMany({
    where: { sessionId: journal.sessionId },
    orderBy: { sortOrder: 'asc' },
  });

  return NextResponse.json({
    success: true,
    journal: { ...journal, status: 'posted' },
    trialBalance: updatedTB,
  });
}

async function unpostJournal(
  journalId: string,
  sessionId: string,
  category: string,
  lines: { accountCode: string; debit: number; credit: number }[]
) {
  for (const line of lines) {
    const existing = await prisma.trialBalanceEntry.findUnique({
      where: { sessionId_accountCode: { sessionId, accountCode: line.accountCode } },
    });

    if (existing) {
      const journalData = (existing.journalData || {}) as Record<string, { debit: number; credit: number }>;
      if (journalData[category]) {
        journalData[category].debit -= line.debit;
        journalData[category].credit -= line.credit;

        // Clean up if zeroed out
        if (Math.abs(journalData[category].debit) < 0.01 && Math.abs(journalData[category].credit) < 0.01) {
          delete journalData[category];
        }
      }

      await prisma.trialBalanceEntry.update({
        where: { id: existing.id },
        data: { journalData },
      });
    }
  }

  await prisma.journal.update({
    where: { id: journalId },
    data: { status: 'unposted' },
  });
}
