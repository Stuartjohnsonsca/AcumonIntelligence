import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import ExcelJS from 'exceljs';

const JOURNAL_TYPES = [
  'Depreciation',
  'Prepayments and Accrued Income',
  'Accruals & Deferred Income',
  'Distributions',
  'Unbundle Fixed Assets',
  'Journals',
];

// Map display names to internal keys
const TYPE_KEY_MAP: Record<string, string> = {
  'Depreciation': 'depreciation',
  'Prepayments and Accrued Income': 'prepayments',
  'Accruals & Deferred Income': 'accruals',
  'Distributions': 'distributions',
  'Unbundle Fixed Assets': 'unbundle_fa',
  'Journals': 'general',
};

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sessionId = req.nextUrl.searchParams.get('sessionId');
  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId required' }, { status: 400 });
  }

  // Fetch Chart of Accounts for this session's firm
  // (model is FirmChartOfAccount; isActive does not exist on it)
  const coa = await prisma.firmChartOfAccount.findMany({
    where: { firmId: session.user.firmId },
    orderBy: { sortOrder: 'asc' },
    select: { accountCode: true, accountName: true, categoryType: true },
  });

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Acumon Intelligence';

  // Main data sheet
  const ws = wb.addWorksheet('Journals');

  // Headers
  const headerRow = ws.addRow([
    'Journal Type',
    'Account Code',
    'Account Name',
    'Description',
    'Debit',
    'Credit',
  ]);
  headerRow.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FF1E40AF' } } };
  });

  // Column widths
  ws.getColumn(1).width = 30; // Journal Type
  ws.getColumn(2).width = 18; // Account Code
  ws.getColumn(3).width = 35; // Account Name
  ws.getColumn(4).width = 40; // Description
  ws.getColumn(5).width = 15; // Debit
  ws.getColumn(6).width = 15; // Credit

  // Add 100 data rows
  const dataRows = 100;
  for (let i = 0; i < dataRows; i++) {
    const row = ws.addRow(['', '', '', '', '', '']);
    if (i % 2 === 0) {
      row.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
      });
    }
  }

  const lastDataRow = dataRows + 1;

  // Journal Type dropdown (column A)
  for (let r = 2; r <= lastDataRow; r++) {
    ws.getCell(`A${r}`).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: [`"${JOURNAL_TYPES.join(',')}"`],
      showErrorMessage: true,
      errorTitle: 'Invalid Journal Type',
      error: `Select: ${JOURNAL_TYPES.join(', ')}`,
    };
  }

  // Account Code dropdown (column B) — from Chart of Accounts
  const accountCodes = coa.map((a: { accountCode: string }) => a.accountCode).slice(0, 200); // Excel limit on dropdown items
  if (accountCodes.length > 0) {
    // Use a hidden reference sheet for long lists
    const refSheet = wb.addWorksheet('_Ref', { state: 'veryHidden' });
    accountCodes.forEach((code: string, i: number) => {
      refSheet.getCell(`A${i + 1}`).value = code;
    });

    for (let r = 2; r <= lastDataRow; r++) {
      ws.getCell(`B${r}`).dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: [`'_Ref'!$A$1:$A$${accountCodes.length}`],
      };
    }
  }

  // Debit/Credit number validation
  for (let r = 2; r <= lastDataRow; r++) {
    ws.getCell(`E${r}`).dataValidation = { type: 'decimal', allowBlank: true, formulae: [0] as any };
    ws.getCell(`F${r}`).dataValidation = { type: 'decimal', allowBlank: true, formulae: [0] as any };
    ws.getCell(`E${r}`).numFmt = '#,##0.00';
    ws.getCell(`F${r}`).numFmt = '#,##0.00';
  }

  // VLOOKUP for Account Name (auto-fills from Account Code)
  // Use a lookup sheet
  const lookupSheet = wb.addWorksheet('_Lookup', { state: 'veryHidden' });
  coa.forEach((a: { accountCode: string; accountName: string }, i: number) => {
    lookupSheet.getCell(`A${i + 1}`).value = a.accountCode;
    lookupSheet.getCell(`B${i + 1}`).value = a.accountName;
  });

  for (let r = 2; r <= lastDataRow; r++) {
    ws.getCell(`C${r}`).value = { formula: `IFERROR(VLOOKUP(B${r},'_Lookup'!A:B,2,FALSE),"")` } as any;
    ws.getCell(`C${r}`).font = { color: { argb: 'FF666666' } };
  }

  // Freeze header
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.autoFilter = { from: 'A1', to: `F${lastDataRow}` };

  const buffer = await wb.xlsx.writeBuffer();

  return new Response(buffer as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="journal-template.xlsx"',
    },
  });
}
