import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import ExcelJS from 'exceljs';

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
      client: true,
      period: true,
      accounts: { orderBy: { tabOrder: 'asc' } },
      transactions: { where: { inPeriod: true }, orderBy: { date: 'asc' } },
      trialBalance: { orderBy: { sortOrder: 'asc' } },
      journals: {
        where: { status: 'posted' },
        include: { lines: { orderBy: { sortOrder: 'asc' } } },
      },
    },
  });

  if (!btbSession || btbSession.userId !== session.user.id) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  const workbook = new ExcelJS.Workbook();

  // Sheet 1: Bank Transactions
  const txnSheet = workbook.addWorksheet('Bank Transactions');
  txnSheet.columns = [
    { header: 'Bank Name', key: 'bankName', width: 20 },
    { header: 'Sort Code', key: 'sortCode', width: 12 },
    { header: 'Account No', key: 'accountNumber', width: 15 },
    { header: 'Statement Date', key: 'statementDate', width: 15 },
    { header: 'Page', key: 'statementPage', width: 8 },
    { header: 'Date', key: 'date', width: 12 },
    { header: 'Description', key: 'description', width: 40 },
    { header: 'Reference', key: 'reference', width: 15 },
    { header: 'Debit', key: 'debit', width: 15 },
    { header: 'Credit', key: 'credit', width: 15 },
    { header: 'Balance', key: 'balance', width: 15 },
    { header: 'Account Code', key: 'accountCode', width: 15 },
    { header: 'Category', key: 'categoryType', width: 20 },
  ];

  // Style header row
  txnSheet.getRow(1).font = { bold: true };
  txnSheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
  txnSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

  for (const txn of btbSession.transactions) {
    txnSheet.addRow({
      bankName: txn.bankName,
      sortCode: txn.sortCode,
      accountNumber: txn.accountNumber,
      statementDate: txn.statementDate,
      statementPage: txn.statementPage,
      date: txn.date,
      description: txn.description,
      reference: txn.reference,
      debit: txn.debit || '',
      credit: txn.credit || '',
      balance: txn.balance,
      accountCode: txn.accountCode,
      categoryType: txn.categoryType,
    });
  }

  // Sheet 2: Trial Balance
  const tbSheet = workbook.addWorksheet('Trial Balance');
  const tbColumns: Partial<ExcelJS.Column>[] = [
    { header: 'Account Code', key: 'accountCode', width: 15 },
    { header: 'Account Name', key: 'accountName', width: 30 },
    { header: 'Category', key: 'categoryType', width: 20 },
    { header: 'Opening Dr', key: 'openingDebit', width: 15 },
    { header: 'Opening Cr', key: 'openingCredit', width: 15 },
    { header: 'Bank Dr', key: 'combinedDebit', width: 15 },
    { header: 'Bank Cr', key: 'combinedCredit', width: 15 },
  ];

  // Add journal category columns
  const journalCategories = [...new Set(btbSession.journals.map(j => j.category))];
  for (const cat of journalCategories) {
    tbColumns.push({ header: `${cat} Dr`, key: `${cat}_dr`, width: 15 });
    tbColumns.push({ header: `${cat} Cr`, key: `${cat}_cr`, width: 15 });
  }

  tbColumns.push({ header: 'Total Dr', key: 'totalDebit', width: 15 });
  tbColumns.push({ header: 'Total Cr', key: 'totalCredit', width: 15 });

  tbSheet.columns = tbColumns;
  tbSheet.getRow(1).font = { bold: true };
  tbSheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
  tbSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

  for (const tb of btbSession.trialBalance) {
    const journalData = (tb.journalData || {}) as Record<string, { debit: number; credit: number }>;
    const row: Record<string, unknown> = {
      accountCode: tb.accountCode,
      accountName: tb.accountName,
      categoryType: tb.categoryType,
      openingDebit: tb.openingDebit || '',
      openingCredit: tb.openingCredit || '',
      combinedDebit: tb.combinedDebit || '',
      combinedCredit: tb.combinedCredit || '',
    };

    let totalDr = tb.openingDebit + tb.combinedDebit;
    let totalCr = tb.openingCredit + tb.combinedCredit;

    for (const cat of journalCategories) {
      const jd = journalData[cat] || { debit: 0, credit: 0 };
      row[`${cat}_dr`] = jd.debit || '';
      row[`${cat}_cr`] = jd.credit || '';
      totalDr += jd.debit;
      totalCr += jd.credit;
    }

    row.totalDebit = totalDr;
    row.totalCredit = totalCr;

    const addedRow = tbSheet.addRow(row);

    // Orange shading for opening position cells
    if (tb.isFromOpeningPosition) {
      addedRow.getCell('openingDebit').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDE9D9' } };
      addedRow.getCell('openingCredit').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDE9D9' } };
    }
  }

  // Sheet 3: Journals
  const jrnlSheet = workbook.addWorksheet('Journals');
  jrnlSheet.columns = [
    { header: 'Ref', key: 'ref', width: 10 },
    { header: 'Category', key: 'category', width: 20 },
    { header: 'Description', key: 'description', width: 40 },
    { header: 'Account Code', key: 'accountCode', width: 15 },
    { header: 'Account Name', key: 'accountName', width: 25 },
    { header: 'Line Description', key: 'lineDescription', width: 30 },
    { header: 'Debit', key: 'debit', width: 15 },
    { header: 'Credit', key: 'credit', width: 15 },
    { header: 'Status', key: 'status', width: 12 },
  ];

  jrnlSheet.getRow(1).font = { bold: true };

  for (const journal of btbSession.journals) {
    for (const line of journal.lines) {
      jrnlSheet.addRow({
        ref: journal.journalRef,
        category: journal.category,
        description: journal.description,
        accountCode: line.accountCode,
        accountName: line.accountName,
        lineDescription: line.description,
        debit: line.debit || '',
        credit: line.credit || '',
        status: journal.status,
      });
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="Bank-to-TB-${btbSession.client.clientName}-${btbSession.period.startDate.toISOString().slice(0, 10)}.xlsx"`,
    },
  });
}
