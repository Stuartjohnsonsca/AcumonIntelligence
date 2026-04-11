import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import ExcelJS from 'exceljs';

const LINE_TYPE_MAP: Record<string, string> = {
  'fs line item': 'fs_line_item',
  'note item': 'note_item',
};

const CATEGORY_MAP: Record<string, string> = {
  'p&l': 'pnl',
  'pnl': 'pnl',
  'balance sheet': 'balance_sheet',
  'cashflow': 'cashflow',
  'notes': 'notes',
};

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified || (!session.user.isMethodologyAdmin && !session.user.isSuperAdmin)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const firmId = session.user.firmId;
  const formData = await req.formData();
  const file = formData.get('file') as File;
  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });

  const arrayBuf = await file.arrayBuffer();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(arrayBuf as any);
  const ws = wb.getWorksheet(1);
  if (!ws) return NextResponse.json({ error: 'No worksheet found' }, { status: 400 });

  // Parse rows
  const errors: string[] = [];
  const rows: { name: string; lineType: string; fsCategory: string }[] = [];

  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // Skip header

    const name = String(row.getCell(1).value || '').trim();
    const lineTypeRaw = String(row.getCell(2).value || '').trim().toLowerCase();
    const categoryRaw = String(row.getCell(3).value || '').trim().toLowerCase();

    if (!name) return; // Skip blank rows

    const lineType = LINE_TYPE_MAP[lineTypeRaw];
    const fsCategory = CATEGORY_MAP[categoryRaw];

    const rowErrors: string[] = [];
    if (!lineType) rowErrors.push(`Col B: Invalid Line Type "${row.getCell(2).value}" (use: FS Line Item, Note Item)`);
    if (!fsCategory) rowErrors.push(`Col C: Invalid FS Category "${row.getCell(3).value}" (use: P&L, Balance Sheet, Cashflow, Notes)`);

    if (rowErrors.length > 0) {
      errors.push(`Row ${rowNumber}: ${rowErrors.join('; ')}`);
    } else {
      rows.push({ name, lineType: lineType!, fsCategory: fsCategory! });
    }
  });

  // All-or-nothing validation
  if (errors.length > 0) {
    return NextResponse.json({
      error: 'validation',
      count: errors.length,
      errors: errors.slice(0, 20),
      hasMore: errors.length > 20,
    }, { status: 400 });
  }

  if (rows.length === 0) {
    return NextResponse.json({ error: 'No data rows found' }, { status: 400 });
  }

  // Get existing FS lines for sort order
  const existing = await prisma.methodologyFsLine.findMany({ where: { firmId } });
  const maxSort = existing.reduce((max, f) => Math.max(max, f.sortOrder), 0);

  // Upsert each row (overwrite on name match)
  let created = 0;
  let updated = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const existingLine = existing.find(f => f.name.toLowerCase() === row.name.toLowerCase());

    if (existingLine) {
      await prisma.methodologyFsLine.update({
        where: { id: existingLine.id },
        data: { lineType: row.lineType, fsCategory: row.fsCategory },
      });
      updated++;
    } else {
      await prisma.methodologyFsLine.create({
        data: {
          firmId,
          name: row.name,
          lineType: row.lineType,
          fsCategory: row.fsCategory,
          sortOrder: maxSort + i + 1,
          isMandatory: false,
        },
      });
      created++;
    }
  }

  return NextResponse.json({ success: true, created, updated, total: rows.length });
}
