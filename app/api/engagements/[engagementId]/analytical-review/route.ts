import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import {
  calculateAR,
  resolveXABVariable,
  resolveZVariable,
  calculateFsNoteRollup,
  type TBSummary,
} from '@/lib/ar-calculation';

async function verifyAccess(engagementId: string, firmId: string | undefined, isSuperAdmin: boolean) {
  const e = await prisma.auditEngagement.findUnique({ where: { id: engagementId }, select: { firmId: true } });
  if (!e || (e.firmId !== firmId && !isSuperAdmin)) return null;
  return e;
}

// GET: Fetch AR records for engagement, optionally filtered by fsLine
export async function GET(req: NextRequest, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await params;
  if (!await verifyAccess(engagementId, session.user.firmId, session.user.isSuperAdmin)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const url = new URL(req.url);
  const fsLine = url.searchParams.get('fsLine');

  const where: any = { engagementId };
  if (fsLine) where.fsLine = fsLine;

  const reviews = await prisma.auditAnalyticalReview.findMany({
    where,
    orderBy: { accountCode: 'asc' },
  });

  return NextResponse.json({ reviews });
}

// POST: Initialize AR records, calculate, or sign off
export async function POST(req: NextRequest, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await params;
  const engagement = await verifyAccess(engagementId, session.user.firmId, session.user.isSuperAdmin);
  if (!engagement) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json();

  // ─── Initialize AR records for a given FS line ───
  if (body.action === 'initialize') {
    const { fsLine, accountCodes } = body;
    if (!fsLine) return NextResponse.json({ error: 'fsLine required' }, { status: 400 });

    // Get TB rows for this FS line
    const tbRows = await prisma.auditTBRow.findMany({
      where: {
        engagementId,
        ...(accountCodes?.length ? { accountCode: { in: accountCodes } } : { fsLevel: fsLine }),
      },
    });

    const created: string[] = [];
    const skipped: string[] = [];

    for (const row of tbRows) {
      // Check if AR record already exists
      const existing = await prisma.auditAnalyticalReview.findUnique({
        where: { engagementId_accountCode: { engagementId, accountCode: row.accountCode } },
      });
      if (existing) {
        skipped.push(row.accountCode);
        continue;
      }

      await prisma.auditAnalyticalReview.create({
        data: {
          engagementId,
          fsLine,
          accountCode: row.accountCode,
          description: row.description,
          recordedAmount: Number(row.currentYear) || 0,
          priorYearAmount: Number(row.priorYear) || 0,
        },
      });
      created.push(row.accountCode);
    }

    return NextResponse.json({ created: created.length, skipped: skipped.length, accountCodes: created });
  }

  // ─── Calculate expected result for an AR record ───
  if (body.action === 'calculate') {
    const { id } = body;
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    const review = await prisma.auditAnalyticalReview.findUnique({ where: { id } });
    if (!review || review.engagementId !== engagementId) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    // Get TB data for variable resolution
    const tbRows = await prisma.auditTBRow.findMany({ where: { engagementId } });
    const tbSummaries: TBSummary[] = tbRows.map(r => ({
      accountCode: r.accountCode,
      description: r.description,
      currentYear: Number(r.currentYear) || 0,
      priorYear: Number(r.priorYear) || 0,
      fsLevel: r.fsLevel,
      fsNoteLevel: r.fsNoteLevel,
      fsStatement: r.fsStatement,
    }));

    const accountTB = tbSummaries.find(r => r.accountCode === review.accountCode) || {
      accountCode: review.accountCode,
      description: review.description || '',
      currentYear: review.recordedAmount,
      priorYear: review.priorYearAmount,
      fsLevel: review.fsLine,
      fsNoteLevel: null,
      fsStatement: null,
    };

    // Resolve formula variables
    const xValue = resolveXABVariable(review.formulaX, accountTB, tbSummaries, review.xValue);
    const aValue = resolveXABVariable(review.formulaA, accountTB, tbSummaries, review.aValue);
    const bValue = resolveXABVariable(review.formulaB, accountTB, tbSummaries, review.bValue);
    const zValue = resolveZVariable(review.formulaZ, tbSummaries, review.zValue);

    // Get materiality
    const materiality = await prisma.auditMateriality.findFirst({ where: { engagementId } });
    const matData = (materiality?.data as any) || {};
    const performanceMateriality = matData.performanceMateriality || matData.pm || 0;

    // Get confidence factor from firm settings
    const cfTable = await prisma.methodologyRiskTable.findFirst({
      where: { firmId: engagement.firmId, tableType: 'arConfidenceFactor' },
    });
    const confidenceFactor = (cfTable?.data as any)?.confidenceFactor ?? 1.0;

    // Calculate FS Note rollup
    const fsNoteRollup = calculateFsNoteRollup(review.accountCode, tbSummaries);

    // Run calculation
    const result = calculateAR({
      formulaX: review.formulaX, formulaA: review.formulaA, formulaB: review.formulaB, formulaZ: review.formulaZ,
      xValue, aValue, bValue, zValue,
      recordedAmount: review.recordedAmount,
      performanceMateriality,
      confidenceFactor,
      fsNoteRollup,
    });

    // Update the record
    const updated = await prisma.auditAnalyticalReview.update({
      where: { id },
      data: {
        xValue, aValue, bValue, zValue,
        expectedAmount: result.expectedAmount,
        difference: result.difference,
        toleranceMateriality: result.toleranceMateriality,
        threshold: result.threshold,
        withinThreshold: result.withinThreshold,
        status: 'calculated',
      },
    });

    return NextResponse.json({ review: updated, calculation: result });
  }

  // ─── Sign-off toggle ───
  if (body.action === 'signoff' || body.action === 'unsignoff') {
    const { id, role } = body; // role: preparer | reviewer | ri
    if (!id || !role) return NextResponse.json({ error: 'id and role required' }, { status: 400 });

    const review = await prisma.auditAnalyticalReview.findUnique({ where: { id } });
    if (!review || review.engagementId !== engagementId) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const signOffs = (review.signOffs as Record<string, any>) || {};
    if (body.action === 'signoff') {
      signOffs[role] = {
        userId: session.user.id,
        userName: session.user.name || session.user.email,
        timestamp: new Date().toISOString(),
      };
    } else {
      delete signOffs[role];
    }

    const statusFromSignoffs = signOffs.ri ? 'signed_off' : signOffs.reviewer ? 'reviewed' : review.status;

    const updated = await prisma.auditAnalyticalReview.update({
      where: { id },
      data: { signOffs, status: statusFromSignoffs },
    });

    return NextResponse.json({ review: updated });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}

// PUT: Update individual AR fields (formula selections, justification, assessment, RMM)
export async function PUT(req: NextRequest, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await params;
  if (!await verifyAccess(engagementId, session.user.firmId, session.user.isSuperAdmin)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const { id, ...updates } = await req.json();
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const allowedFields = [
    'formulaX', 'formulaA', 'formulaB', 'formulaZ',
    'xValue', 'aValue', 'bValue', 'zValue',
    'xExplanation', 'zExplanation',
    'justification', 'differenceAssessment',
    'rmmErrors', 'rmmBias', 'rmmControlFailures', 'rmmFraudRisks',
    'mergedWithCode',
  ];

  const data: Record<string, any> = {};
  for (const field of allowedFields) {
    if (updates[field] !== undefined) data[field] = updates[field];
  }

  const review = await prisma.auditAnalyticalReview.update({ where: { id }, data });
  return NextResponse.json({ review });
}
