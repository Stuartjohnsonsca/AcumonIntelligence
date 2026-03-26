import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import ExcelJS from 'exceljs';

export async function GET() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified || (!session.user.isMethodologyAdmin && !session.user.isSuperAdmin)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Acumon Intelligence';
  const ws = wb.addWorksheet('FS Lines');

  // Headers
  const headerRow = ws.addRow(['Name', 'Line Type', 'FS Category']);
  headerRow.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FF1E40AF' } } };
  });

  ws.getColumn(1).width = 35;
  ws.getColumn(2).width = 18;
  ws.getColumn(3).width = 18;

  // Add 50 blank rows with dropdowns
  const lineTypes = 'FS Line Item,Note Item';
  const fsCategories = 'P&L,Balance Sheet,Cashflow,Notes';

  for (let i = 0; i < 50; i++) {
    const row = ws.addRow(['', '', '']);
    if (i % 2 === 0) {
      row.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
      });
    }
  }

  // Data validation for Line Type (col B)
  for (let r = 2; r <= 51; r++) {
    ws.getCell(`B${r}`).dataValidation = {
      type: 'list', allowBlank: true,
      formulae: [`"${lineTypes}"`],
      showErrorMessage: true, errorTitle: 'Invalid', error: 'Select: FS Line Item or Note Item',
    };
  }

  // Data validation for FS Category (col C)
  for (let r = 2; r <= 51; r++) {
    ws.getCell(`C${r}`).dataValidation = {
      type: 'list', allowBlank: true,
      formulae: [`"${fsCategories}"`],
      showErrorMessage: true, errorTitle: 'Invalid', error: 'Select: P&L, Balance Sheet, Cashflow, or Notes',
    };
  }

  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.autoFilter = { from: 'A1', to: 'C51' };

  const buffer = await wb.xlsx.writeBuffer();
  return new Response(buffer as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="fs-lines-template.xlsx"',
    },
  });
}
