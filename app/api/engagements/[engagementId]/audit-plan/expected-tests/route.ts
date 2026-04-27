import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

/**
 * GET /api/engagements/[engagementId]/audit-plan/expected-tests
 *
 * Produces a deduplicated list of tests the audit plan expects for
 * this engagement, derived from the firm's test bank + FS Line
 * allocations + the TB rows actually loaded for the engagement.
 *
 * Used by the Completion → Test Summary panel to surface tests that
 * haven't been executed yet (so the user can see coverage gaps), and
 * by anything else that needs the expected-test list without
 * duplicating the per-row matching logic that lives in
 * AuditPlanPanel.tsx.
 *
 * The matching is intentionally simpler than the AuditPlanPanel
 * render-time logic: it iterates TB rows, looks at each row's
 * fsLineId directly, finds firm-wide allocations for that FS Line,
 * and dedupes by (testName, fsLine). It DOESN'T:
 *   - apply RMM-driven risk classification filters
 *   - apply Plan Customiser N/A overrides
 *   - merge custom tests
 * The result is a slightly broader list than the live audit plan,
 * which is what the Test Summary actually wants — visibility of
 * "every test that *could* apply" with their execution status.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { engagementId } = await params;

  const eng = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    select: { firmId: true },
  });
  if (!eng || (eng.firmId !== session.user.firmId && !session.user.isSuperAdmin)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const [tbRows, allocations] = await Promise.all([
    prisma.auditTBRow.findMany({
      where: { engagementId },
      select: {
        accountCode: true,
        description: true,
        fsStatement: true,
        fsLevel: true,
        fsNoteLevel: true,
        fsLineId: true,
        currentYear: true,
        priorYear: true,
      },
    }),
    prisma.methodologyTestAllocation.findMany({
      where: { test: { firmId: eng.firmId, isActive: true, isDraft: false } },
      include: {
        test: {
          select: {
            id: true,
            name: true,
            testTypeCode: true,
            isIngest: true,
            outputFormat: true,
            assertions: true,
          },
        },
        fsLine: { select: { id: true, name: true } },
      },
    }),
  ]);

  // Index allocations by FS Line ID for O(1) lookup per TB row.
  const allocationsByFsLineId = new Map<string, typeof allocations>();
  for (const a of allocations) {
    if (!a.fsLine?.id || !a.test) continue;
    const arr = allocationsByFsLineId.get(a.fsLine.id) || [];
    arr.push(a);
    allocationsByFsLineId.set(a.fsLine.id, arr);
  }

  // Walk TB rows; for each, emit one expected-test entry per matching
  // allocation. Dedupe by (test name + fsLine name) so the Test
  // Summary doesn't get N copies of the same test for the same FS
  // Line just because the firm has many TB rows on that line.
  const seen = new Set<string>();
  const out: Array<{
    testName: string;
    testTypeCode: string;
    fsLine: string;
    fsLineId: string;
    accountCode: string | null;
    fsStatement: string | null;
    fsLevel: string | null;
    fsNoteLevel: string | null;
    isIngest: boolean;
    outputFormat: string | null;
  }> = [];

  for (const row of tbRows) {
    const cy = Number(row.currentYear) || 0;
    const py = Number(row.priorYear) || 0;
    if (cy === 0 && py === 0) continue;
    if (!row.fsLineId) continue;
    const allocs = allocationsByFsLineId.get(row.fsLineId);
    if (!allocs) continue;
    for (const a of allocs) {
      if (!a.test || !a.fsLine) continue;
      const key = `${a.test.name.toLowerCase().trim()}::${a.fsLine.name.toLowerCase().trim()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        testName: a.test.name,
        testTypeCode: a.test.testTypeCode,
        fsLine: a.fsLine.name,
        fsLineId: a.fsLine.id,
        accountCode: row.accountCode || null,
        fsStatement: row.fsStatement || null,
        fsLevel: row.fsLevel || null,
        fsNoteLevel: row.fsNoteLevel || null,
        isIngest: !!a.test.isIngest,
        outputFormat: a.test.outputFormat || null,
      });
    }
  }

  return NextResponse.json({ tests: out });
}
