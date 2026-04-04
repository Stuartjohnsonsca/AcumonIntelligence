import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

/**
 * POST /api/admin/migrate-test-bank
 * Migrates embedded JSON tests from MethodologyTestBank → MethodologyTest + MethodologyTestAllocation.
 * Super Admin only. Run once. Safe to re-run (deduplicates).
 */
export async function POST() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified || !session.user.isSuperAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const testBanks = await prisma.methodologyTestBank.findMany();
  const fsLines = await prisma.methodologyFsLine.findMany();

  const stats = { testsCreated: 0, allocationsCreated: 0, fsLinesCreated: 0, skippedDuplicates: 0, errors: [] as string[] };
  const testCache = new Map<string, string>(); // "firmId:name" → testId

  for (const tb of testBanks) {
    const tests = (tb.tests as any[]) || [];
    if (tests.length === 0) continue;

    // Find or create FS line
    let fsLine = fsLines.find(fl => fl.firmId === tb.firmId && fl.name.toLowerCase() === tb.fsLine.toLowerCase());
    if (!fsLine && tb.fsLine.trim()) {
      try {
        const category = inferCategory(tb.fsLine);
        fsLine = await prisma.methodologyFsLine.create({
          data: {
            firmId: tb.firmId,
            name: tb.fsLine.trim(),
            lineType: 'fs_line_item',
            fsCategory: category,
            isMandatory: ['Going Concern', 'Management Override', 'Notes and Disclosures'].includes(tb.fsLine),
          },
        });
        fsLines.push(fsLine);
        stats.fsLinesCreated++;
      } catch (e: any) {
        // Might already exist with different casing
        fsLine = fsLines.find(fl => fl.firmId === tb.firmId && fl.name.toLowerCase() === tb.fsLine.toLowerCase().trim());
        if (!fsLine) { stats.errors.push(`Failed to create FS line: ${tb.fsLine} — ${e.message}`); continue; }
      }
    }

    if (!fsLine) {
      if (tb.fsLine.trim()) stats.errors.push(`No FS line for: "${tb.fsLine}"`);
      continue;
    }

    for (const t of tests) {
      if (!t.description?.trim()) continue;

      const cacheKey = `${tb.firmId}:${t.description.trim()}`;
      let testId = testCache.get(cacheKey);

      if (!testId) {
        try {
          const created = await prisma.methodologyTest.create({
            data: {
              firmId: tb.firmId,
              name: t.description.trim(),
              testTypeCode: t.testTypeCode || '',
              assertions: t.assertions || (t.assertion ? [t.assertion] : []),
              framework: t.framework || 'ALL',
              significantRisk: t.significantRisk || false,
              flow: t.flow || null,
            },
          });
          testId = created.id;
          testCache.set(cacheKey, testId);
          stats.testsCreated++;
        } catch (e: any) {
          // Unique constraint violation — test already exists
          const existing = await prisma.methodologyTest.findFirst({
            where: { firmId: tb.firmId, name: t.description.trim() },
          });
          if (existing) {
            testId = existing.id;
            testCache.set(cacheKey, testId);
            stats.skippedDuplicates++;
          } else {
            stats.errors.push(`Failed to create test: ${t.description} — ${e.message}`);
            continue;
          }
        }
      }

      // Create allocation
      try {
        await prisma.methodologyTestAllocation.create({
          data: {
            testId,
            fsLineId: fsLine.id,
            industryId: tb.industryId,
          },
        });
        stats.allocationsCreated++;
      } catch {
        // Already exists (duplicate)
        stats.skippedDuplicates++;
      }
    }
  }

  return NextResponse.json({ message: 'Migration complete', stats });
}

function inferCategory(fsLine: string): string {
  const l = fsLine.toLowerCase();
  if (['revenue', 'cost of sales', 'operating expenses', 'wages', 'interest', 'tax expense', 'other operating income', 'depreciation', 'amortisation'].some(k => l.includes(k))) return 'pnl';
  if (['going concern', 'management override', 'notes and disclosures'].some(k => l.includes(k))) return 'notes';
  if (['cash'].some(k => l.includes(k))) return 'balance_sheet';
  return 'balance_sheet';
}
