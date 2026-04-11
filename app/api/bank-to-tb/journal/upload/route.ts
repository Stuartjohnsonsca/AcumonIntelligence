import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import ExcelJS from 'exceljs';

// Map display names to internal keys
const TYPE_KEY_MAP: Record<string, string> = {
  'depreciation': 'depreciation',
  'prepayments and accrued income': 'prepayments',
  'prepayments': 'prepayments',
  'accruals & deferred income': 'accruals',
  'accruals': 'accruals',
  'distributions': 'distributions',
  'unbundle fixed assets': 'unbundle_fa',
  'unbundle fa': 'unbundle_fa',
  'journals': 'general',
  'general': 'general',
};

interface ParsedLine {
  journalType: string;
  accountCode: string;
  accountName: string;
  description: string;
  debit: number;
  credit: number;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const formData = await req.formData();
  const file = formData.get('file') as File;
  const sessionId = formData.get('sessionId') as string;

  if (!file || !sessionId) {
    return NextResponse.json({ error: 'file and sessionId required' }, { status: 400 });
  }

  // Verify session belongs to user
  const btbSession = await prisma.bankToTBSession.findFirst({
    where: { id: sessionId, userId: session.user.id },
  });
  if (!btbSession) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  try {
    const arrayBuf = await file.arrayBuffer();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(arrayBuf as any);
    const ws = wb.getWorksheet(1);

    if (!ws) {
      return NextResponse.json({ error: 'No worksheet found' }, { status: 400 });
    }

    // Parse rows — skip header row
    const lines: ParsedLine[] = [];
    const errors: string[] = [];

    ws.eachRow((row, rowNum) => {
      if (rowNum === 1) return; // Skip header

      const journalTypeRaw = String(row.getCell(1).value || '').trim();
      const accountCode = String(row.getCell(2).value || '').trim();
      const accountName = String(row.getCell(3).value || '').trim();
      const description = String(row.getCell(4).value || '').trim();
      const debit = parseFloat(String(row.getCell(5).value || '0')) || 0;
      const credit = parseFloat(String(row.getCell(6).value || '0')) || 0;

      // Skip empty rows
      if (!journalTypeRaw && !accountCode && debit === 0 && credit === 0) return;

      // Validate
      const journalType = TYPE_KEY_MAP[journalTypeRaw.toLowerCase()];
      if (!journalType) {
        errors.push(`Row ${rowNum}: Invalid journal type "${journalTypeRaw}"`);
        return;
      }
      if (!accountCode) {
        errors.push(`Row ${rowNum}: Account code is empty`);
        return;
      }
      if (debit === 0 && credit === 0) {
        errors.push(`Row ${rowNum}: Both debit and credit are zero`);
        return;
      }
      if (debit > 0 && credit > 0) {
        errors.push(`Row ${rowNum}: Both debit and credit have values — use one per line`);
        return;
      }

      lines.push({ journalType, accountCode, accountName, description, debit, credit });
    });

    // Validate all-or-nothing
    if (errors.length > 0) {
      return NextResponse.json({
        error: `Upload rejected — ${errors.length} validation error(s)`,
        details: errors.slice(0, 30),
        totalErrors: errors.length,
      }, { status: 400 });
    }

    if (lines.length === 0) {
      return NextResponse.json({ error: 'No valid journal lines found' }, { status: 400 });
    }

    // Group by journal type
    const grouped: Record<string, ParsedLine[]> = {};
    for (const line of lines) {
      if (!grouped[line.journalType]) grouped[line.journalType] = [];
      grouped[line.journalType].push(line);
    }

    // Validate each journal group balances
    for (const [type, groupLines] of Object.entries(grouped)) {
      const totalDr = groupLines.reduce((s, l) => s + l.debit, 0);
      const totalCr = groupLines.reduce((s, l) => s + l.credit, 0);
      if (Math.abs(totalDr - totalCr) > 0.01) {
        return NextResponse.json({
          error: `Journal "${type}" does not balance: Dr ${totalDr.toFixed(2)} ≠ Cr ${totalCr.toFixed(2)}, difference ${(totalDr - totalCr).toFixed(2)}`,
        }, { status: 400 });
      }
    }

    // Create journals in DB
    let journalsCreated = 0;
    let linesCreated = 0;

    for (const [type, groupLines] of Object.entries(grouped)) {
      // Get next journal ref
      const existingCount = await prisma.journal.count({
        where: { sessionId, category: type },
      });

      const journal = await prisma.journal.create({
        data: {
          sessionId,
          category: type,
          description: `Uploaded ${type} journal`,
          status: 'draft',
          journalRef: `${type.toUpperCase().slice(0, 3)}-${String(existingCount + 1).padStart(3, '0')}`,
          lines: {
            create: groupLines.map((l, i) => ({
              accountCode: l.accountCode,
              accountName: l.accountName,
              description: l.description,
              debit: l.debit,
              credit: l.credit,
              sortOrder: i,
            })),
          },
        },
        include: { lines: true },
      });

      journalsCreated++;
      linesCreated += groupLines.length;
    }

    // Reload journals and TB
    const [allJournals, trialBalance] = await Promise.all([
      prisma.journal.findMany({
        where: { sessionId },
        include: { lines: { orderBy: { sortOrder: 'asc' } } },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.trialBalanceEntry.findMany({
        where: { sessionId },
        orderBy: { sortOrder: 'asc' },
      }),
    ]);

    return NextResponse.json({
      success: true,
      journalsCreated,
      linesCreated,
      journals: allJournals,
      trialBalance,
    });
  } catch (err: any) {
    console.error('Journal upload error:', err);
    return NextResponse.json({ error: err.message || 'Upload failed' }, { status: 500 });
  }
}
