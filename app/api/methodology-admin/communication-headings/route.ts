import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

const DEFAULT_BOARD_MINUTES_HEADINGS = [
  'Litigation',
  'Committed Capital Expenditure',
  'Performance Concerns',
  'Significant Disposals',
  'Fraud',
];

const DEFAULT_TCWG_HEADINGS = [
  'Valuations',
  'Accounting Policies',
  'Cashflow',
  'Significant Transactions',
  'Fraud',
  'Audit Matters',
  'Control Breaches',
  'Regulator Issues',
];

// GET — load firm-wide communication headings
export async function GET() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!session.user.isMethodologyAdmin && !session.user.isSuperAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const firmId = session.user.firmId;

  const [boardRow, tcwgRow] = await Promise.all([
    prisma.methodologyRiskTable.findUnique({
      where: { firmId_tableType: { firmId, tableType: 'board_minutes_headings' } },
    }),
    prisma.methodologyRiskTable.findUnique({
      where: { firmId_tableType: { firmId, tableType: 'tcwg_headings' } },
    }),
  ]);

  return NextResponse.json({
    boardMinutesHeadings: (boardRow?.data as any)?.headings || DEFAULT_BOARD_MINUTES_HEADINGS,
    tcwgHeadings: (tcwgRow?.data as any)?.headings || DEFAULT_TCWG_HEADINGS,
  });
}

// PUT — save firm-wide communication headings
export async function PUT(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!session.user.isMethodologyAdmin && !session.user.isSuperAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const firmId = session.user.firmId;
  const body = await req.json();
  const { boardMinutesHeadings, tcwgHeadings } = body;

  const ops: Promise<unknown>[] = [];

  if (Array.isArray(boardMinutesHeadings)) {
    ops.push(
      prisma.methodologyRiskTable.upsert({
        where: { firmId_tableType: { firmId, tableType: 'board_minutes_headings' } },
        create: { firmId, tableType: 'board_minutes_headings', data: { headings: boardMinutesHeadings } },
        update: { data: { headings: boardMinutesHeadings } },
      })
    );
  }

  if (Array.isArray(tcwgHeadings)) {
    ops.push(
      prisma.methodologyRiskTable.upsert({
        where: { firmId_tableType: { firmId, tableType: 'tcwg_headings' } },
        create: { firmId, tableType: 'tcwg_headings', data: { headings: tcwgHeadings } },
        update: { data: { headings: tcwgHeadings } },
      })
    );
  }

  await Promise.all(ops);

  return NextResponse.json({ success: true });
}
