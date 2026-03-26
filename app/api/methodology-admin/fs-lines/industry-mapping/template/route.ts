import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import ExcelJS from 'exceljs';

export async function GET() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified || (!session.user.isMethodologyAdmin && !session.user.isSuperAdmin)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const firmId = session.user.firmId;

  const [fsLines, industries, mappings] = await Promise.all([
    prisma.methodologyFsLine.findMany({ where: { firmId, isActive: true }, orderBy: { sortOrder: 'asc' } }),
    prisma.methodologyIndustry.findMany({ where: { firmId, isActive: true }, orderBy: [{ isDefault: 'desc' }, { name: 'asc' }] }),
    prisma.methodologyFsLineIndustry.findMany({ where: { fsLine: { firmId } } }),
  ]);

  const mappingSet = new Set(mappings.map(m => `${m.fsLineId}:${m.industryId}`));

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Acumon Intelligence';
  const ws = wb.addWorksheet('Industry Mapping');

  // Headers: FS Line Name | Industry 1 | Industry 2 | ...
  const headers = ['FS Line Name', ...industries.map(i => i.name)];
  const headerRow = ws.addRow(headers);
  headerRow.eachCell((cell, colNumber) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };
    cell.alignment = { vertical: 'middle', horizontal: colNumber === 1 ? 'left' : 'center' };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FF1E40AF' } } };
  });

  ws.getColumn(1).width = 35;
  for (let c = 2; c <= industries.length + 1; c++) {
    ws.getColumn(c).width = 16;
  }

  // Data rows: pre-populate with current mappings
  for (const fsLine of fsLines) {
    const rowData = [fsLine.name];
    for (const ind of industries) {
      const isMapped = mappingSet.has(`${fsLine.id}:${ind.id}`);
      rowData.push(isMapped ? 'Y' : 'N');
    }
    const row = ws.addRow(rowData);

    // Style the Y/N cells
    for (let c = 2; c <= industries.length + 1; c++) {
      const cell = row.getCell(c);
      cell.alignment = { horizontal: 'center' };
      if (cell.value === 'Y') {
        cell.font = { bold: true, color: { argb: 'FF16A34A' } };
      }
    }
  }

  // Data validation for Y/N columns
  const lastRow = fsLines.length + 1;
  for (let c = 2; c <= industries.length + 1; c++) {
    for (let r = 2; r <= lastRow; r++) {
      ws.getCell(r, c).dataValidation = {
        type: 'list', allowBlank: true,
        formulae: ['"Y,N"'],
        showErrorMessage: true, errorTitle: 'Invalid', error: 'Use Y or N',
      };
    }
  }

  ws.views = [{ state: 'frozen', ySplit: 1, xSplit: 1 }];

  const buffer = await wb.xlsx.writeBuffer();
  return new Response(buffer as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="industry-mapping-template.xlsx"',
    },
  });
}
