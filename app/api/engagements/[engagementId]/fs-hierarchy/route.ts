import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

const CATEGORY_TO_STATEMENT: Record<string, string> = {
  pnl: 'Profit & Loss',
  balance_sheet: 'Balance Sheet',
  cashflow: 'Cash Flow Statement',
  notes: 'Notes',
};

/**
 * GET /api/engagements/[engagementId]/fs-hierarchy
 * Returns FS hierarchy for TB dropdowns with proper parent-child mapping:
 *   - statements: ["Balance Sheet", "P&L", ...]
 *   - levels: [{ id, name, statement }]       (fs_line_items)
 *   - notes: [{ id, name, parentName, parentId, statement }]  (note_items with parent)
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

  const engagement = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    select: { auditType: true, firmId: true },
  });

  if (!engagement || (engagement.firmId !== firmId && !session.user.isSuperAdmin)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Load all active FS Lines with parent relationship
  const fsLines = await prisma.methodologyFsLine.findMany({
    where: { firmId, isActive: true },
    include: { parent: { select: { id: true, name: true, fsCategory: true } } },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });

  // Build hierarchy
  const statements = [...new Set(
    fsLines.map(l => CATEGORY_TO_STATEMENT[l.fsCategory] || l.fsCategory)
  )];

  // FS Level items (fs_line_items) — aggregated items on the face of the statements
  const levels = fsLines
    .filter(l => l.lineType === 'fs_line_item')
    .map(l => ({
      id: l.id,
      name: l.name,
      statement: CATEGORY_TO_STATEMENT[l.fsCategory] || l.fsCategory,
    }));

  // FS Note items (note_items) — with parent mapping from parentFsLineId
  const notes = fsLines
    .filter(l => l.lineType === 'note_item')
    .map(l => {
      const parentLevel = l.parent;
      const parentStatement = parentLevel
        ? (CATEGORY_TO_STATEMENT[parentLevel.fsCategory] || parentLevel.fsCategory)
        : (CATEGORY_TO_STATEMENT[l.fsCategory] || l.fsCategory);

      return {
        id: l.id,
        name: l.name,
        parentId: l.parentFsLineId || null,
        parentName: parentLevel?.name || null,
        statement: parentStatement,
      };
    });

  return NextResponse.json({
    statements,
    levels,
    notes,
    // Flat list for autocomplete/search
    allItems: fsLines.map(l => ({
      id: l.id,
      name: l.name,
      lineType: l.lineType,
      parentId: l.parentFsLineId || null,
      parentName: l.parent?.name || null,
      statement: CATEGORY_TO_STATEMENT[l.fsCategory] || l.fsCategory,
    })),
  });
}
