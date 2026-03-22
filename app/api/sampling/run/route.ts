import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { verifyClientAccess } from '@/lib/client-access';
import {
  selectSRSWOR, computePopulationHash, buildAuditTrail,
  generateSeed, planSampleSize, computeRequiredSampleSize,
  type PopulationItem, type ErrorMetric,
} from '@/lib/sampling-engine';

export const maxDuration = 30;

/**
 * POST /api/sampling/run — Execute a sampling selection.
 *
 * Body: {
 *   engagementId, populationData (rows), columnMapping,
 *   method, stratification, errorMetric,
 *   sampleSize (if fixed), planningMode, planningParams,
 *   seed (optional), confidence
 * }
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const body = await req.json();
  const {
    engagementId,
    populationData,
    columnMapping,
    method,
    stratification,
    errorMetric,
    sampleSize: fixedSampleSize,
    sampleSizeStrategy,
    planningMode,
    planningParams,
    seed: providedSeed,
    confidence,
    tolerableMisstatement,
  } = body;

  if (!engagementId || !populationData || !columnMapping) {
    return NextResponse.json({ error: 'engagementId, populationData, and columnMapping required' }, { status: 400 });
  }

  // Verify engagement access
  const engagement = await prisma.samplingEngagement.findUnique({
    where: { id: engagementId },
    select: { clientId: true },
  });
  if (!engagement) {
    return NextResponse.json({ error: 'Engagement not found' }, { status: 404 });
  }

  const access = await verifyClientAccess(
    session.user as { id: string; firmId: string; isSuperAdmin?: boolean },
    engagement.clientId,
  );
  if (!access.allowed) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    // Convert raw population data to PopulationItems
    const populationItems: PopulationItem[] = (populationData as Record<string, unknown>[]).map((row, idx) => ({
      id: String(row[columnMapping.transactionId] || `row_${idx}`),
      bookValue: parseFloat(String(row[columnMapping.amount] || 0)) || 0,
      ...row,
    }));

    const N = populationItems.length;
    if (N === 0) {
      return NextResponse.json({ error: 'Population is empty' }, { status: 400 });
    }

    const seed = providedSeed || generateSeed();
    const conf = confidence || 0.95;
    const TM = tolerableMisstatement || 0;
    const metric: ErrorMetric = errorMetric || 'net_signed';

    // Determine sample size
    let n: number;
    let planningRationale = '';

    if (sampleSizeStrategy === 'fixed') {
      n = fixedSampleSize || 25;
    } else if (method === 'random' && planningMode) {
      // Use planning engine
      const planResult = planSampleSize({
        populationItems,
        confidence: conf,
        tolerableMisstatement: TM,
        errorMetric: metric,
        mode: planningMode,
        pilotSize: planningParams?.pilotSize,
        assumedSd: planningParams?.assumedSd,
        kFactor: planningParams?.kFactor,
      });
      n = planResult.recommendedN;
      planningRationale = planResult.rationale;
    } else {
      // Default: compute from risk parameters if TM > 0, else use 25
      if (TM > 0) {
        const bookValues = populationItems.map(i => i.bookValue);
        const bookSd = Math.sqrt(bookValues.reduce((s, v) => s + (v - bookValues.reduce((a, b) => a + b, 0) / bookValues.length) ** 2, 0) / (bookValues.length - 1));
        const sdEstimate = bookSd * 0.2; // Conservative 20% k-factor
        n = computeRequiredSampleSize(N, TM, sdEstimate, conf);
        planningRationale = `Computed from population book value SD (${bookSd.toFixed(2)}) × 20% k-factor. Required n=${n} for TM=${TM} at ${(conf * 100).toFixed(0)}% confidence.`;
      } else {
        n = Math.min(25, N);
        planningRationale = 'Default sample size (no tolerable misstatement specified).';
      }
    }

    // Clamp sample size
    n = Math.min(Math.max(n, 1), N);

    // Select sample using SRS
    const selection = selectSRSWOR(populationItems, n, seed);

    // Build audit trail
    const auditTrail = buildAuditTrail(selection, { errorMetric: metric, confidence: conf, tolerableMisstatement: TM });

    // Compute population total and sample total
    const populationTotal = populationItems.reduce((s, i) => s + i.bookValue, 0);
    const sampleTotal = selection.selectedItems.reduce((s, i) => s + i.bookValue, 0);
    const coverage = populationTotal > 0 ? (sampleTotal / populationTotal) * 100 : 0;

    // Store population if not already stored
    const population = await prisma.samplingPopulation.create({
      data: {
        engagementId,
        recordCount: N,
        fileHash: computePopulationHash(populationItems),
        columnMapping: columnMapping,
        parsedData: populationData,
      },
    });

    // Store the run
    const run = await prisma.samplingRun.create({
      data: {
        engagementId,
        populationId: population.id,
        mode: 'A',
        method: method || 'random',
        stratification: stratification || 'simple',
        parameters: {
          errorMetric: metric,
          confidence: conf,
          tolerableMisstatement: TM,
          sampleSizeStrategy: sampleSizeStrategy || 'calculator',
          fixedSampleSize: sampleSizeStrategy === 'fixed' ? fixedSampleSize : undefined,
          planningMode: planningMode || null,
          planningParams: planningParams || null,
          planningRationale,
        },
        seed,
        toolVersion: '1.0',
        status: 'complete',
        sampleSize: n,
        resultSummary: {
          populationTotal: Math.round(populationTotal * 100) / 100,
          sampleTotal: Math.round(sampleTotal * 100) / 100,
          coverage: Math.round(coverage * 100) / 100,
          planningRationale,
        },
        coverageSummary: {
          populationSize: N,
          sampleSize: n,
          populationTotal: Math.round(populationTotal * 100) / 100,
          sampleTotal: Math.round(sampleTotal * 100) / 100,
          coveragePct: Math.round(coverage * 100) / 100,
        },
        auditTrailHash: computePopulationHash(selection.selectedItems),
      },
    });

    // Store selected items
    await prisma.samplingItem.createMany({
      data: selection.selectedItems.map(item => ({
        runId: run.id,
        transactionId: item.id,
        bookValue: item.bookValue,
        selectedReason: 'SRS (Simple Random Sampling Without Replacement)',
      })),
    });

    // Update engagement status
    await prisma.samplingEngagement.update({
      where: { id: engagementId },
      data: { status: 'complete' },
    });

    return NextResponse.json({
      runId: run.id,
      selectedIndices: selection.selectedIndices,
      selectedIds: selection.selectedItems.map(i => i.id),
      sampleSize: n,
      populationSize: N,
      populationTotal: Math.round(populationTotal * 100) / 100,
      sampleTotal: Math.round(sampleTotal * 100) / 100,
      coverage: Math.round(coverage * 100) / 100,
      seed,
      algorithm: selection.algorithm,
      populationHash: selection.populationHash,
      planningRationale,
      auditTrail,
    });
  } catch (error) {
    console.error('[Sampling:Run] Error:', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'Sampling failed' }, { status: 500 });
  }
}
