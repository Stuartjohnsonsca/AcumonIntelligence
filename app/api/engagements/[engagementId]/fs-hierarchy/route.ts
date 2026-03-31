import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

/**
 * GET /api/engagements/[engagementId]/fs-hierarchy
 * Returns FS hierarchy for TB dropdowns:
 *   - statements: ["Balance Sheet", "P&L", "Cashflow"]
 *   - levels: [{ name, statement }]   (FS Line Items grouped by category)
 *   - notes: [{ name, level }]        (Note Items linked to their parent FS Line)
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ engagementId: string }> },
) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { engagementId } = await params;
  const firmId = session.user.firmId;

  // Get the engagement's audit type to filter FS lines
  const engagement = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    select: { auditType: true, firmId: true },
  });

  if (!engagement || (engagement.firmId !== firmId && !session.user.isSuperAdmin)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Load all active FS Lines for this firm
  const fsLines = await prisma.methodologyFsLine.findMany({
    where: { firmId, isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });

  const CATEGORY_TO_STATEMENT: Record<string, string> = {
    pnl: 'Profit & Loss',
    balance_sheet: 'Balance Sheet',
    cashflow: 'Cash Flow Statement',
    notes: 'Notes',
  };

  // Build hierarchy
  const statements = [...new Set(fsLines.map(l => CATEGORY_TO_STATEMENT[l.fsCategory] || l.fsCategory))];

  // FS Level items (lineType = 'fs_line_item') — these are the aggregated items on the face of the statements
  const levels = fsLines
    .filter(l => l.lineType === 'fs_line_item')
    .map(l => ({
      id: l.id,
      name: l.name,
      statement: CATEGORY_TO_STATEMENT[l.fsCategory] || l.fsCategory,
    }));

  // FS Note items (lineType = 'note_item') — detailed items in the notes
  // Try to match to a parent level by fsCategory (same statement)
  const notes = fsLines
    .filter(l => l.lineType === 'note_item')
    .map(l => {
      const statement = CATEGORY_TO_STATEMENT[l.fsCategory] || l.fsCategory;
      // Find the most likely parent level (same category)
      const parentLevels = levels.filter(lv => lv.statement === statement);
      return {
        id: l.id,
        name: l.name,
        statement,
        // parentLevel will need to be set manually by the methodology admin
        // For now, return all levels in the same statement as possible parents
        possibleLevels: parentLevels.map(lv => lv.name),
      };
    });

  return NextResponse.json({
    statements,
    levels,
    notes,
    // Also return flat list for simple autocomplete
    allItems: fsLines.map(l => ({
      id: l.id,
      name: l.name,
      lineType: l.lineType,
      statement: CATEGORY_TO_STATEMENT[l.fsCategory] || l.fsCategory,
    })),
  });
}
