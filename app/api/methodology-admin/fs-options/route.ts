import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

// Firm-wide lists of FS Level + FS Statement options used to drive
// the dropdowns on the FS Lines admin screen. Stored in
// MethodologyRiskTable (a JSON-payload table keyed by (firmId,
// tableType)) so they don't require a dedicated Prisma model.
//
// Shapes:
//   tableType 'fs_statement_options' → { options: string[] }
//   tableType 'fs_level_options'     → { options: { name: string; statementName: string }[] }

const STATEMENT_KEY = 'fs_statement_options';
const LEVEL_KEY = 'fs_level_options';

const DEFAULT_STATEMENTS = ['Profit & Loss', 'Balance Sheet', 'Cashflow', 'Notes'];

async function loadTable(firmId: string, tableType: string) {
  const row = await prisma.methodologyRiskTable.findUnique({
    where: { firmId_tableType: { firmId, tableType } },
  }).catch(() => null);
  return (row?.data as any) || null;
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const firmId = session.user.firmId!;

  const [stmt, lvl] = await Promise.all([
    loadTable(firmId, STATEMENT_KEY),
    loadTable(firmId, LEVEL_KEY),
  ]);

  // Seed the statement list with defaults if the firm has never set one
  // up, so the admin sees immediately populated dropdowns rather than
  // an empty screen.
  const statementOptions: string[] = Array.isArray(stmt?.options) && stmt.options.length
    ? stmt.options
    : [...DEFAULT_STATEMENTS];
  const levelOptions: { name: string; statementName: string }[] = Array.isArray(lvl?.options) ? lvl.options : [];

  return NextResponse.json({ statementOptions, levelOptions });
}

export async function PUT(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified || (!session.user.isMethodologyAdmin && !session.user.isSuperAdmin)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const firmId = session.user.firmId!;
  const { statementOptions, levelOptions } = await req.json();

  if (Array.isArray(statementOptions)) {
    const clean = (statementOptions as unknown[])
      .map(s => String(s).trim())
      .filter(Boolean);
    await prisma.methodologyRiskTable.upsert({
      where: { firmId_tableType: { firmId, tableType: STATEMENT_KEY } },
      create: { firmId, tableType: STATEMENT_KEY, data: { options: clean } as object },
      update: { data: { options: clean } as object },
    });
  }
  if (Array.isArray(levelOptions)) {
    const clean = (levelOptions as Array<{ name?: unknown; statementName?: unknown }>)
      .map(l => ({
        name: String(l?.name ?? '').trim(),
        statementName: String(l?.statementName ?? '').trim(),
      }))
      .filter(l => l.name);
    await prisma.methodologyRiskTable.upsert({
      where: { firmId_tableType: { firmId, tableType: LEVEL_KEY } },
      create: { firmId, tableType: LEVEL_KEY, data: { options: clean } as object },
      update: { data: { options: clean } as object },
    });
  }

  return NextResponse.json({ success: true });
}
