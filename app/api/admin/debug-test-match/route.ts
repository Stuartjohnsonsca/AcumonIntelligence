import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

/**
 * GET /api/admin/debug-test-match?engagementId=X&lineItem=Services+Rebilled
 * Debug why a test isn't showing for a specific row in the Audit Plan.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified || !session.user.isSuperAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const url = new URL(req.url);
  const engagementId = url.searchParams.get('engagementId');
  const lineItem = url.searchParams.get('lineItem') || 'Services Rebilled';

  // 1. Get all Test Bank entries
  const testBanks = await prisma.methodologyTestBank.findMany({
    where: { firmId: session.user.firmId },
  });

  const allTests = testBanks.flatMap(tb =>
    ((tb.tests as any[]) || []).map((t: any) => ({
      fsLine: tb.fsLine,
      industryId: tb.industryId,
      description: t.description,
      testTypeCode: t.testTypeCode,
      assertion: t.assertion,
      assertions: t.assertions,
      framework: t.framework,
      significantRisk: t.significantRisk,
      hasFlow: !!(t.flow?.nodes?.length),
      categories: t.categories,
    }))
  );

  // 2. Get the specific RMM row
  let rmmRow = null;
  if (engagementId) {
    rmmRow = await prisma.auditRMMRow.findFirst({
      where: { engagementId, lineItem: { contains: lineItem } },
    });
  }

  // 3. Get TB rows for context
  let tbRows: any[] = [];
  if (engagementId) {
    tbRows = await prisma.auditTBRow.findMany({
      where: { engagementId },
      select: { accountCode: true, description: true, fsLevel: true, fsStatement: true, fsNoteLevel: true, currentYear: true },
    });
  }

  // Find TB rows that match the lineItem
  const matchingTbRows = tbRows.filter(tb =>
    tb.fsLevel === lineItem || tb.fsNoteLevel === lineItem || tb.description === lineItem ||
    (tb.fsLevel || '').toLowerCase().includes(lineItem.toLowerCase()) ||
    lineItem.toLowerCase().includes((tb.fsLevel || '').toLowerCase())
  );

  // 4. Simulate the matching logic
  const searchTerms = [
    rmmRow?.fsLevel || null,
    rmmRow?.fsNote || null,
    lineItem,
    rmmRow?.fsStatement || null,
  ].filter(Boolean).map(s => (s as string).toLowerCase().trim());

  const matchingTestBankEntries = testBanks.filter(tb => {
    const tbLine = tb.fsLine.toLowerCase().trim();
    return searchTerms.some(term => {
      return tbLine === term || term.includes(tbLine) || tbLine.includes(term) ||
        term.split(/[\s\-\/,]+/).some(word => word.length > 3 && tbLine.includes(word)) ||
        tbLine.split(/[\s\-\/,]+/).some(word => word.length > 3 && term.includes(word));
    });
  });

  // 5. Get tests from matching entries
  const matchedTests = matchingTestBankEntries.flatMap(tb =>
    ((tb.tests as any[]) || []).map((t: any) => ({
      fsLine: tb.fsLine,
      description: t.description,
      assertion: t.assertion,
      framework: t.framework,
    }))
  );

  return NextResponse.json({
    lineItem,
    rmmRow: rmmRow ? {
      lineItem: rmmRow.lineItem,
      fsStatement: rmmRow.fsStatement,
      fsLevel: rmmRow.fsLevel,
      fsNote: rmmRow.fsNote,
      assertions: rmmRow.assertions,
      overallRisk: rmmRow.overallRisk,
    } : null,
    searchTerms,
    matchingTbRows: matchingTbRows.slice(0, 5),
    testBankFsLines: [...new Set(testBanks.map(tb => tb.fsLine))],
    matchingTestBankEntries: matchingTestBankEntries.map(tb => ({ fsLine: tb.fsLine, testCount: (tb.tests as any[])?.length || 0 })),
    matchedTests: matchedTests.slice(0, 10),
    totalTestsInBank: allTests.length,
    diagnosis: {
      rmmHasFsLevel: !!rmmRow?.fsLevel,
      searchTermsIncludeRevenue: searchTerms.includes('revenue'),
      testBankHasRevenue: testBanks.some(tb => tb.fsLine.toLowerCase() === 'revenue'),
      revenueTestCount: testBanks.filter(tb => tb.fsLine.toLowerCase() === 'revenue').reduce((s, tb) => s + ((tb.tests as any[])?.length || 0), 0),
    },
  });
}
