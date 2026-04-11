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

const DEFAULT_SHAREHOLDERS_HEADINGS = [
  'Dividends Declared',
  'Share Issues and Buybacks',
  'Director Appointments',
  'Approval of Financial Statements',
  'Related Party Matters',
  'Auditor Appointment',
  'Significant Resolutions',
];

// Firm-configurable headings used to generate the Overall Communications
// summary across Board Minutes / TCWG / Shareholder meetings / client /
// internal / expert meetings. Seeded per user request.
const DEFAULT_OVERALL_SUMMARY_HEADINGS = [
  'Impacts Financial Statements',
  'Impacts Going Concern',
  'Impacts Profitability',
  'Indicated Significant Decision',
];

// GET — load firm-wide communication headings
export async function GET() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!session.user.isMethodologyAdmin && !session.user.isSuperAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const firmId = session.user.firmId;

  const [boardRow, tcwgRow, shareholdersRow, overallRow] = await Promise.all([
    prisma.methodologyRiskTable.findUnique({
      where: { firmId_tableType: { firmId, tableType: 'board_minutes_headings' } },
    }),
    prisma.methodologyRiskTable.findUnique({
      where: { firmId_tableType: { firmId, tableType: 'tcwg_headings' } },
    }),
    prisma.methodologyRiskTable.findUnique({
      where: { firmId_tableType: { firmId, tableType: 'shareholders_headings' } },
    }),
    prisma.methodologyRiskTable.findUnique({
      where: { firmId_tableType: { firmId, tableType: 'communication_overall_headings' } },
    }),
  ]);

  return NextResponse.json({
    boardMinutesHeadings: (boardRow?.data as any)?.headings || DEFAULT_BOARD_MINUTES_HEADINGS,
    tcwgHeadings: (tcwgRow?.data as any)?.headings || DEFAULT_TCWG_HEADINGS,
    shareholdersHeadings: (shareholdersRow?.data as any)?.headings || DEFAULT_SHAREHOLDERS_HEADINGS,
    overallSummaryHeadings: (overallRow?.data as any)?.headings || DEFAULT_OVERALL_SUMMARY_HEADINGS,
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
  const { boardMinutesHeadings, tcwgHeadings, shareholdersHeadings, overallSummaryHeadings } = body;

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

  if (Array.isArray(shareholdersHeadings)) {
    ops.push(
      prisma.methodologyRiskTable.upsert({
        where: { firmId_tableType: { firmId, tableType: 'shareholders_headings' } },
        create: { firmId, tableType: 'shareholders_headings', data: { headings: shareholdersHeadings } },
        update: { data: { headings: shareholdersHeadings } },
      })
    );
  }

  if (Array.isArray(overallSummaryHeadings)) {
    ops.push(
      prisma.methodologyRiskTable.upsert({
        where: { firmId_tableType: { firmId, tableType: 'communication_overall_headings' } },
        create: { firmId, tableType: 'communication_overall_headings', data: { headings: overallSummaryHeadings } },
        update: { data: { headings: overallSummaryHeadings } },
      })
    );
  }

  await Promise.all(ops);

  return NextResponse.json({ success: true });
}
