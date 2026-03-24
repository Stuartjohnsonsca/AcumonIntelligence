import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import ExcelJS from 'exceljs';

const ASSERTION_TYPES = [
  'Completeness', 'Occurrence & Accuracy', 'Cut Off', 'Classification',
  'Presentation', 'Existence', 'Valuation', 'Rights & Obligations',
];

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified || (!session.user.isMethodologyAdmin && !session.user.isSuperAdmin)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const formData = await req.formData();
  const file = formData.get('file') as File | null;
  const industryId = formData.get('industryId') as string;
  if (!file || !industryId) {
    return NextResponse.json({ error: 'file and industryId required' }, { status: 400 });
  }

  const firmId = session.user.firmId;

  // Load test types and frameworks
  const [testTypes, fwTemplate] = await Promise.all([
    prisma.methodologyTestType.findMany({ where: { firmId, isActive: true } }),
    prisma.methodologyTemplate.findFirst({
      where: { firmId, templateType: 'audit_type_schedules', auditType: '__framework_options' },
    }),
  ]);
  const frameworkOptions = (fwTemplate?.items as string[]) || ['IFRS', 'FRS102'];

  // Parse with ExcelJS (handles multi-line cells correctly)
  const buffer = Buffer.from(await file.arrayBuffer());
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.getWorksheet(1);
  if (!ws) return NextResponse.json({ error: 'No worksheet found' }, { status: 400 });

  // Detect column positions from header row
  const headerRow = ws.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, colNum) => {
    headers[colNum - 1] = String(cell.value || '').trim().toLowerCase();
  });

  function findCol(keywords: string[]): number {
    return headers.findIndex(h => h && keywords.some(k => h.includes(k)));
  }
  const iFS = Math.max(findCol(['fs line', 'line item', 'fs statement']), 0);
  const iDesc = Math.max(findCol(['test desc', 'description']), 1);
  const iType = Math.max(findCol(['type']), 2);
  const iAssert = Math.max(findCol(['assertion']), 3);
  const iFramework = findCol(['framework', 'accounting']);
  const iSigRisk = Math.max(findCol(['significant', 'sig risk', 'sig.']), iFramework >= 0 ? 5 : 4);

  // Parse and validate ALL rows
  const validationErrors: string[] = [];
  let lastFsLine = '';

  type ParsedRow = {
    fsLine: string; description: string; typeCode: string;
    assertion: string; framework: string; significantRisk: boolean;
  };
  const parsedRows: ParsedRow[] = [];

  const colLetter = (idx: number) => String.fromCharCode(65 + idx);

  ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
    if (rowNum === 1) return; // skip header

    const get = (idx: number): string => {
      if (idx < 0) return '';
      const cell = row.getCell(idx + 1); // ExcelJS is 1-indexed
      const v = cell.value;
      if (v === null || v === undefined) return '';
      if (typeof v === 'object' && 'richText' in v) {
        return (v as any).richText.map((rt: any) => rt.text).join('');
      }
      return String(v).trim();
    };

    let fsLine = get(iFS);
    const description = get(iDesc);
    const typeName = get(iType);
    const assertion = get(iAssert);
    const framework = iFramework >= 0 ? get(iFramework) : '';
    const sigRisk = get(iSigRisk);

    // Skip completely blank rows
    if (!fsLine && !description && !typeName && !assertion) return;

    // Inherit FS Line from row above if empty
    if (!fsLine && description && lastFsLine) fsLine = lastFsLine;
    if (fsLine) lastFsLine = fsLine;

    const rowErrors: string[] = [];

    if (!fsLine) rowErrors.push(`Col ${colLetter(iFS)}: FS Line Item is empty`);
    if (!description) rowErrors.push(`Col ${colLetter(iDesc)}: Test Description is empty`);

    // Validate Type
    const typeLC = (typeName || '').toLowerCase();
    const matchedType = testTypes.find(t =>
      t.name.toLowerCase() === typeLC || t.code.toLowerCase() === typeLC
    );
    if (typeName && !matchedType) {
      rowErrors.push(`Col ${colLetter(iType)}: Invalid Type "${typeName}" (valid: ${testTypes.map(t => t.name).join(', ')})`);
    }
    const typeCode = matchedType?.code || testTypes[0]?.code || '';

    // Validate Assertion (flexible)
    const assertionLC = (assertion || '').toLowerCase().replace(/\s+/g, ' ');
    const matchedAssertion = ASSERTION_TYPES.find(a => {
      const aLC = a.toLowerCase();
      return aLC === assertionLC
        || aLC.replace('occurrence', 'occurence') === assertionLC
        || aLC.replace('&', 'and') === assertionLC.replace('&', 'and')
        || aLC.startsWith(assertionLC) || assertionLC.startsWith(aLC);
    }) || '';
    if (assertion && !matchedAssertion) {
      rowErrors.push(`Col ${colLetter(iAssert)}: Invalid Assertion "${assertion}"`);
    }

    // Validate Framework
    const frameworkLC = (framework || '').toLowerCase();
    const matchedFramework = frameworkOptions.find(f => f.toLowerCase() === frameworkLC) || '';
    if (framework && !matchedFramework && framework.toLowerCase() !== 'all') {
      rowErrors.push(`Col ${colLetter(iFramework)}: Invalid Framework "${framework}" (valid: ${frameworkOptions.join(', ')})`);
    }

    // Validate Significant Risk
    if (sigRisk && !['Y', 'N', 'YES', 'NO', ''].includes(sigRisk.toUpperCase())) {
      rowErrors.push(`Col ${colLetter(iSigRisk)}: Invalid Significant Risk "${sigRisk}" (use Y or N)`);
    }

    if (rowErrors.length > 0) {
      validationErrors.push(`Row ${rowNum}: ${rowErrors.join('; ')}`);
    } else if (fsLine && description) {
      parsedRows.push({
        fsLine, description, typeCode,
        assertion: matchedAssertion,
        framework: matchedFramework,
        significantRisk: ['Y', 'YES'].includes((sigRisk || '').toUpperCase()),
      });
    }
  });

  // ALL-OR-NOTHING
  if (validationErrors.length > 0) {
    return NextResponse.json({
      error: 'validation',
      count: validationErrors.length,
      errors: validationErrors.slice(0, 20),
      hasMore: validationErrors.length > 20,
    }, { status: 400 });
  }

  if (parsedRows.length === 0) {
    return NextResponse.json({ error: 'No valid data rows found' }, { status: 400 });
  }

  // Group by FS line and import
  const grouped: Record<string, ParsedRow[]> = {};
  for (const row of parsedRows) {
    if (!grouped[row.fsLine]) grouped[row.fsLine] = [];
    grouped[row.fsLine].push(row);
  }

  let imported = 0;
  for (const [fsLine, tests] of Object.entries(grouped)) {
    await prisma.methodologyTestBank.upsert({
      where: { firmId_industryId_fsLine: { firmId, industryId, fsLine } },
      create: {
        firmId, industryId, fsLine,
        tests: tests.map(t => ({
          description: t.description, testTypeCode: t.typeCode,
          assertion: t.assertion, framework: t.framework,
          significantRisk: t.significantRisk,
        })),
      },
      update: {
        tests: tests.map(t => ({
          description: t.description, testTypeCode: t.typeCode,
          assertion: t.assertion, framework: t.framework,
          significantRisk: t.significantRisk,
        })),
      },
    });
    imported += tests.length;
  }

  return NextResponse.json({
    success: true,
    imported,
    fsLines: Object.keys(grouped).length,
  });
}
