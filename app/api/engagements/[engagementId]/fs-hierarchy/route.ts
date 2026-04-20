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

  // Load all active FS Lines with parent relationship. Every row is
  // now treated as an FS Note Level; each row carries fsLevelName and
  // fsStatementName denormalised strings (the new "level" / "statement"
  // picklists managed in the admin FS Options modal). We fall back to
  // the legacy parent hierarchy + fsCategory for rows that haven't
  // been migrated yet.
  const fsLines = await prisma.methodologyFsLine.findMany({
    where: { firmId, isActive: true },
    include: { parent: { select: { id: true, name: true, fsCategory: true } } },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });

  // Load firm-wide option lists so the dropdowns include admin-defined
  // values even if no FS Line has been tagged with them yet.
  const [stmtRow, lvlRow] = await Promise.all([
    prisma.methodologyRiskTable.findUnique({ where: { firmId_tableType: { firmId: firmId!, tableType: 'fs_statement_options' } } }).catch(() => null),
    prisma.methodologyRiskTable.findUnique({ where: { firmId_tableType: { firmId: firmId!, tableType: 'fs_level_options' } } }).catch(() => null),
  ]);
  const optionStatementNames: string[] = Array.isArray((stmtRow?.data as any)?.options) ? (stmtRow!.data as any).options : [];
  const optionLevels: { name: string; statementName: string }[] = Array.isArray((lvlRow?.data as any)?.options) ? (lvlRow!.data as any).options : [];

  // Helpers — resolve each FS Line's effective level + statement.
  const effectiveLevelName = (l: typeof fsLines[number]) => l.fsLevelName || l.parent?.name || null;
  const effectiveStatementName = (l: typeof fsLines[number]) =>
    l.fsStatementName
    || (l.parent ? (CATEGORY_TO_STATEMENT[l.parent.fsCategory] || l.parent.fsCategory) : null)
    || (CATEGORY_TO_STATEMENT[l.fsCategory] || l.fsCategory);

  // Statements — union of: admin-defined options + anything actually
  // referenced on existing FS Lines. Keeps the list useful even if the
  // admin hasn't maintained the option list yet.
  const referencedStatements = fsLines.map(l => effectiveStatementName(l)).filter((s): s is string => !!s);
  const statements = Array.from(new Set([...optionStatementNames, ...referencedStatements]));

  // Levels — same union treatment. Each entry is { name, statement }.
  const levelMapFromFsLines = new Map<string, { name: string; statement: string }>();
  for (const l of fsLines) {
    const n = effectiveLevelName(l);
    if (!n) continue;
    const s = effectiveStatementName(l) || '';
    if (!levelMapFromFsLines.has(n)) levelMapFromFsLines.set(n, { name: n, statement: s });
  }
  for (const opt of optionLevels) {
    if (!opt.name) continue;
    if (!levelMapFromFsLines.has(opt.name)) levelMapFromFsLines.set(opt.name, { name: opt.name, statement: opt.statementName || '' });
  }
  const levels = Array.from(levelMapFromFsLines.values());

  // Notes — every FS Line is an FS Note. parentName + statement are
  // resolved via the helpers so the TB cascade picks up the new fields
  // the moment they're saved.
  const notes = fsLines.map(l => ({
    id: l.id,
    name: l.name,
    parentId: l.parentFsLineId || null,
    parentName: effectiveLevelName(l),
    statement: effectiveStatementName(l),
  }));

  return NextResponse.json({
    statements,
    levels,
    notes,
    // Flat list for autocomplete/search — every row carries the same
    // effective-level / effective-statement data so the TB
    // handleFsNoteChange cascade can resolve without another roundtrip.
    allItems: fsLines.map(l => ({
      id: l.id,
      name: l.name,
      lineType: l.lineType,
      parentId: l.parentFsLineId || null,
      parentName: effectiveLevelName(l),
      statement: effectiveStatementName(l),
    })),
  });
}
