import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import ExcelJS from 'exceljs';

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

  // Get existing data
  const [fsLines, industries] = await Promise.all([
    prisma.methodologyFsLine.findMany({ where: { firmId } }),
    prisma.methodologyIndustry.findMany({ where: { firmId } }),
  ]);

  const fsLineByName = new Map(fsLines.map(f => [f.name.toLowerCase(), f]));
  const industryByName = new Map(industries.map(i => [i.name.toLowerCase(), i]));

  // Parse header row to find industry columns
  const headerRow = ws.getRow(1);
  const industryColumns: { colIndex: number; industryId: string; name: string }[] = [];

  headerRow.eachCell((cell, colNumber) => {
    if (colNumber === 1) return; // Skip "FS Line Name"
    const name = String(cell.value || '').trim();
    const industry = industryByName.get(name.toLowerCase());
    if (industry) {
      industryColumns.push({ colIndex: colNumber, industryId: industry.id, name: industry.name });
    }
  });

  if (industryColumns.length === 0) {
    return NextResponse.json({ error: 'No matching industry columns found in header row' }, { status: 400 });
  }

  // Parse data rows
  const errors: string[] = [];
  const mappingChanges: { fsLineId: string; industryId: string; enabled: boolean }[] = [];

  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;

    const fsLineName = String(row.getCell(1).value || '').trim();
    if (!fsLineName) return;

    const fsLine = fsLineByName.get(fsLineName.toLowerCase());
    if (!fsLine) {
      errors.push(`Row ${rowNumber}: FS Line "${fsLineName}" not found`);
      return;
    }

    for (const col of industryColumns) {
      const val = String(row.getCell(col.colIndex).value || '').trim().toUpperCase();
      if (val === 'Y' || val === 'N') {
        mappingChanges.push({ fsLineId: fsLine.id, industryId: col.industryId, enabled: val === 'Y' });
      } else if (val && val !== '') {
        errors.push(`Row ${rowNumber}, Col ${col.name}: Invalid value "${val}" (use Y or N)`);
      }
    }
  });

  // All-or-nothing
  if (errors.length > 0) {
    return NextResponse.json({
      error: 'validation',
      count: errors.length,
      errors: errors.slice(0, 20),
      hasMore: errors.length > 20,
    }, { status: 400 });
  }

  // Apply changes (overwrite)
  let added = 0;
  let removed = 0;

  for (const change of mappingChanges) {
    const existing = await prisma.methodologyFsLineIndustry.findFirst({
      where: { fsLineId: change.fsLineId, industryId: change.industryId },
    });

    if (change.enabled && !existing) {
      await prisma.methodologyFsLineIndustry.create({
        data: { fsLineId: change.fsLineId, industryId: change.industryId },
      });
      added++;
    } else if (!change.enabled && existing) {
      await prisma.methodologyFsLineIndustry.delete({ where: { id: existing.id } });
      removed++;
    }
  }

  return NextResponse.json({ success: true, added, removed, total: mappingChanges.length });
}
