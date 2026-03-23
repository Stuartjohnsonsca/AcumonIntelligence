import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { downloadBlob } from '@/lib/azure-blob';
import * as XLSX from 'xlsx';

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const body = await req.json();
  const { sessionId, source, pasteData, uploadData } = body;

  if (!sessionId || !source) {
    return NextResponse.json({ error: 'sessionId and source required' }, { status: 400 });
  }

  const btbSession = await prisma.bankToTBSession.findUnique({
    where: { id: sessionId },
  });

  if (!btbSession || btbSession.userId !== session.user.id) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  let entries: { accountCode: string; accountName: string; categoryType: string; debit: number; credit: number }[] = [];

  if (source === 'firm_standard') {
    // Check for client-specific COA override first, then fall back to firm COA
    const clientAccounts = await prisma.clientChartOfAccount.findMany({
      where: { clientId: btbSession.clientId },
      orderBy: { sortOrder: 'asc' },
    });

    const accounts = clientAccounts.length > 0
      ? clientAccounts
      : await prisma.firmChartOfAccount.findMany({
          where: { firmId: user.firmId },
          orderBy: { sortOrder: 'asc' },
        });

    entries = accounts.map(a => ({
      accountCode: a.accountCode,
      accountName: a.accountName,
      categoryType: a.categoryType,
      debit: 0,
      credit: 0,
    }));
  } else if (source === 'upload') {
    // Parse uploaded spreadsheet data (base64 encoded)
    if (!uploadData) {
      return NextResponse.json({ error: 'uploadData required for upload source' }, { status: 400 });
    }

    const buffer = Buffer.from(uploadData.data, 'base64');
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);

    for (const row of rows) {
      const code = String(row['Account Code'] || row['Code'] || row['account_code'] || '').trim();
      const name = String(row['Account Name'] || row['Name'] || row['Description'] || row['account_name'] || '').trim();
      const cat = String(row['Category'] || row['Category Type'] || row['Type'] || row['category'] || 'Overheads').trim();
      const debit = parseFloat(String(row['Debit'] || row['Dr'] || row['debit'] || '0')) || 0;
      const credit = parseFloat(String(row['Credit'] || row['Cr'] || row['credit'] || '0')) || 0;

      if (!code && !name) continue;

      entries.push({
        accountCode: code || `AUTO-${entries.length + 1}`,
        accountName: name,
        categoryType: cat,
        debit,
        credit,
      });
    }
  } else if (source === 'paste') {
    // Parse pasted tab-delimited data
    if (!pasteData) {
      return NextResponse.json({ error: 'pasteData required for paste source' }, { status: 400 });
    }

    const lines = pasteData.split('\n').filter((l: string) => l.trim());
    for (let i = 0; i < lines.length; i++) {
      const cols = lines[i].split('\t');
      if (cols.length < 2) continue;

      // Assume: Code, Name, Category, Debit, Credit (flexible parsing)
      const code = (cols[0] || '').trim();
      const name = (cols[1] || '').trim();
      const cat = (cols[2] || 'Overheads').trim();
      const debit = parseFloat(cols[3] || '0') || 0;
      const credit = parseFloat(cols[4] || '0') || 0;

      if (!code && !name) continue;

      entries.push({
        accountCode: code || `AUTO-${i + 1}`,
        accountName: name,
        categoryType: cat,
        debit,
        credit,
      });
    }
  } else if (source === 'prior_period') {
    // Find the prior period session
    const period = await prisma.clientPeriod.findUnique({
      where: { id: btbSession.periodId },
    });

    if (!period) {
      return NextResponse.json({ error: 'Period not found' }, { status: 404 });
    }

    // Find the period that ends the day before this one starts
    const priorPeriodEnd = new Date(period.startDate);
    priorPeriodEnd.setDate(priorPeriodEnd.getDate() - 1);

    const priorSession = await prisma.bankToTBSession.findFirst({
      where: {
        clientId: btbSession.clientId,
        firmId: btbSession.firmId,
        status: { in: ['active', 'complete'] },
        period: {
          endDate: {
            gte: new Date(priorPeriodEnd.getFullYear(), priorPeriodEnd.getMonth(), priorPeriodEnd.getDate()),
            lt: new Date(priorPeriodEnd.getFullYear(), priorPeriodEnd.getMonth(), priorPeriodEnd.getDate() + 1),
          },
        },
      },
      include: {
        trialBalance: { orderBy: { sortOrder: 'asc' } },
        period: true,
      },
      orderBy: { updatedAt: 'desc' },
    });

    if (!priorSession || priorSession.trialBalance.length === 0) {
      return NextResponse.json({ error: 'No prior period trial balance found' }, { status: 404 });
    }

    // Calculate closing balances from prior period
    entries = priorSession.trialBalance.map(tb => {
      // Total debit/credit across all columns
      const totalDebit = tb.openingDebit + tb.combinedDebit;
      const totalCredit = tb.openingCredit + tb.combinedCredit;
      // Add journal amounts
      const journalData = (tb.journalData || {}) as Record<string, { debit: number; credit: number }>;
      let jrnlDebit = 0;
      let jrnlCredit = 0;
      for (const jd of Object.values(journalData)) {
        jrnlDebit += jd.debit || 0;
        jrnlCredit += jd.credit || 0;
      }

      return {
        accountCode: tb.accountCode,
        accountName: tb.accountName,
        categoryType: tb.categoryType,
        debit: totalDebit + jrnlDebit,
        credit: totalCredit + jrnlCredit,
      };
    });
  } else {
    return NextResponse.json({ error: 'Invalid source' }, { status: 400 });
  }

  if (entries.length === 0) {
    return NextResponse.json({ error: 'No data found for the selected source' }, { status: 400 });
  }

  // Clear existing opening position entries and create new ones
  await prisma.$transaction(async (tx) => {
    await tx.trialBalanceEntry.deleteMany({
      where: { sessionId, isFromOpeningPosition: true },
    });

    await tx.trialBalanceEntry.createMany({
      data: entries.map((e, i) => ({
        sessionId,
        accountCode: e.accountCode,
        accountName: e.accountName,
        categoryType: e.categoryType,
        openingDebit: e.debit,
        openingCredit: e.credit,
        isFromOpeningPosition: true,
        sortOrder: i,
      })),
      skipDuplicates: true,
    });

    await tx.bankToTBSession.update({
      where: { id: sessionId },
      data: { openingPositionSource: source },
    });
  });

  // Reload entries
  const savedEntries = await prisma.trialBalanceEntry.findMany({
    where: { sessionId },
    orderBy: { sortOrder: 'asc' },
  });

  return NextResponse.json({ success: true, entries: savedEntries });
}
