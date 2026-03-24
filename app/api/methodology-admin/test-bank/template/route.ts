import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import ExcelJS from 'exceljs';
import { ASSERTION_TYPES } from '@/types/methodology';

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const industryId = searchParams.get('industryId');

  // Get test types for this firm
  const testTypes = await prisma.methodologyTestType.findMany({
    where: { firmId: session.user.firmId },
    orderBy: { name: 'asc' },
  });

  // Get industry name
  let industryName = 'Default';
  if (industryId) {
    const ind = await prisma.methodologyIndustry.findUnique({ where: { id: industryId } });
    if (ind) industryName = ind.name;
  }

  // Get existing FS lines from test bank for this industry
  const existingEntries = industryId ? await prisma.methodologyTestBank.findMany({
    where: { firmId: session.user.firmId, industryId },
    select: { fsLine: true },
  }) : [];
  const existingFsLines = [...new Set(existingEntries.map(e => e.fsLine))];

  // Default FS lines
  const defaultFsLines = [
    'Going Concern', 'Management Override', 'Notes and Disclosures',
    'Revenue', 'Cost of Sales', 'Operating Expenses', 'Fixed Assets',
    'Debtors', 'Cash and Bank', 'Creditors', 'Accruals', 'Loans',
    'Share Capital', 'Reserves',
  ];
  const allFsLines = [...new Set([...defaultFsLines, ...existingFsLines])];

  // Build dropdown lists
  const typeNames = testTypes.map(t => t.name);
  const assertionNames = [...ASSERTION_TYPES] as string[];
  const sigRiskOptions = ['Y', 'N'];

  // Create workbook
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Acumon Intelligence';

  // Main data sheet
  const ws = wb.addWorksheet('Test Bank');

  // Headers
  const headerRow = ws.addRow(['FS Line Item', 'Test Description', 'Type', 'Assertion', 'Significant Risk']);
  headerRow.eachCell(cell => {
    cell.font = { bold: true, size: 11 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.border = {
      bottom: { style: 'thin', color: { argb: 'FF1E40AF' } },
    };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });

  // Column widths
  ws.getColumn(1).width = 25;
  ws.getColumn(2).width = 50;
  ws.getColumn(3).width = 20;
  ws.getColumn(4).width = 25;
  ws.getColumn(5).width = 18;

  // Add pre-populated rows with FS lines (100 rows for data entry)
  const dataRowCount = Math.max(allFsLines.length * 3, 50); // At least 3 rows per FS line
  for (let i = 0; i < dataRowCount; i++) {
    const fsLine = i < allFsLines.length ? allFsLines[i] : '';
    const row = ws.addRow([fsLine, '', '', '', '']);
    // Light alternating row colours
    if (i % 2 === 0) {
      row.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
      });
    }
  }

  // Apply data validation (dropdowns) to columns C, D, E for all data rows
  const lastDataRow = dataRowCount + 1; // +1 for header

  // Type dropdown (column C)
  for (let r = 2; r <= lastDataRow; r++) {
    ws.getCell(`C${r}`).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: [`"${typeNames.join(',')}"`],
      showErrorMessage: true,
      errorTitle: 'Invalid Type',
      error: `Please select: ${typeNames.join(', ')}`,
    };
  }

  // Assertion dropdown (column D)
  for (let r = 2; r <= lastDataRow; r++) {
    ws.getCell(`D${r}`).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: [`"${assertionNames.join(',')}"`],
      showErrorMessage: true,
      errorTitle: 'Invalid Assertion',
      error: `Please select a valid assertion type`,
    };
  }

  // Significant Risk dropdown (column E)
  for (let r = 2; r <= lastDataRow; r++) {
    ws.getCell(`E${r}`).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: [`"${sigRiskOptions.join(',')}"`],
      showErrorMessage: true,
      errorTitle: 'Invalid Value',
      error: 'Please select Y or N',
    };
  }

  // Freeze header row
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  // Auto-filter
  ws.autoFilter = { from: 'A1', to: `E${lastDataRow}` };

  // Generate buffer
  const buffer = await wb.xlsx.writeBuffer();

  return new Response(buffer as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="test-bank-template-${industryName.replace(/\s+/g, '-').toLowerCase()}.xlsx"`,
    },
  });
}
