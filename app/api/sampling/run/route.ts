import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { verifyClientAccess } from '@/lib/client-access';
import { apiAction } from '@/lib/logger';
import {
  selectSRSWOR, computePopulationHash, buildAuditTrail,
  generateSeed, planSampleSize,
  type PopulationItem, type ErrorMetric,
} from '@/lib/sampling-engine';
import { selectSystematic } from '@/lib/sampling-systematic';
import { selectMUS } from '@/lib/sampling-mus';
import { selectComposite } from '@/lib/sampling-composite';
import { stratifyPopulation, type StratificationFeature } from '@/lib/sampling-stratification';

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

  const action = apiAction(req, session.user as { id: string; firmId?: string }, '/api/sampling/run', 'sampling');

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
    seed: providedSeed,
    confidence,
    tolerableMisstatement,
    kFactor,
    // Systematic-specific
    systematicBasis,
    // MUS-specific
    confidenceFactor: cfFactor,
    // Composite-specific
    compositeThreshold,
    compositeResidualMethod,
    // Mode B stratification
    stratificationFeatures,
    allocationRule,
    allocationParams,
    explainabilityLevel,
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
    const populationTotal = populationItems.reduce((s, i) => s + Math.abs(i.bookValue), 0);
    const selectedMethod = method || 'random';

    // ─── Method-specific selection ──────────────────────────────────────
    let selectedIndices: number[] = [];
    let selectedItems: PopulationItem[] = [];
    let planningRationale = '';
    let algorithmName = '';
    let n: number;
    let extraData: Record<string, unknown> = {};

    switch (selectedMethod) {
      case 'systematic': {
        // Determine sample size
        n = sampleSizeStrategy === 'fixed' ? (fixedSampleSize || 25) : Math.min(25, N);
        if (sampleSizeStrategy !== 'fixed' && TM > 0) {
          const plan = planSampleSize({ populationItems, confidence: conf, tolerableMisstatement: TM, errorMetric: metric, mode: 'book_sd_bound', kFactor: kFactor || 20 });
          n = plan.recommendedN;
          planningRationale = plan.rationale;
        }
        n = Math.min(Math.max(n, 1), N);
        const sysResult = selectSystematic({
          population: populationItems,
          sampleSize: n,
          seed,
          stage: systematicBasis === 'two_stage' ? 'two_stage' : 'single',
        });
        selectedIndices = sysResult.selectedIndices;
        selectedItems = sysResult.selectedItems;
        algorithmName = sysResult.algorithm;
        planningRationale = planningRationale || `Systematic interval sampling: interval=${sysResult.interval}, start=${sysResult.startPoint}. ${sysResult.stage === 'two_stage' ? 'Two-stage selection applied.' : 'Single-stage selection.'}`;
        extraData = { interval: sysResult.interval, startPoint: sysResult.startPoint, stage: sysResult.stage };
        break;
      }

      case 'mus': {
        const cf = cfFactor || 3.0; // Default moderate confidence factor
        const musResult = selectMUS({
          population: populationItems,
          tolerableMisstatement: TM || populationTotal * 0.05,
          confidenceFactor: cf,
          seed,
        });
        selectedIndices = musResult.selectedIndices;
        selectedItems = musResult.selectedItems;
        n = musResult.sampleSize;
        algorithmName = musResult.algorithm;
        planningRationale = `MUS: Sampling interval = ${musResult.samplingInterval} (TM / confidence factor ${cf}). ${musResult.highValueItems.length} high-value items selected with certainty, ${musResult.cumulativeSelections.length} items by cumulative monetary amount.`;
        extraData = { samplingInterval: musResult.samplingInterval, highValueCount: musResult.highValueItems.length };
        break;
      }

      case 'composite': {
        const ct = compositeThreshold || TM || 0;
        const residualN = sampleSizeStrategy === 'fixed' ? (fixedSampleSize || 25) : 25;
        const compResult = selectComposite({
          population: populationItems,
          threshold: ct,
          residualMethod: compositeResidualMethod || 'random',
          residualSampleSize: residualN,
          seed,
          tolerableMisstatement: TM || undefined,
          confidenceFactor: cfFactor || undefined,
          confidence: conf,
        });
        selectedIndices = compResult.selectedIndices;
        selectedItems = compResult.selectedItems;
        n = compResult.sampleSize;
        algorithmName = compResult.algorithm;
        planningRationale = `Composite sampling: ${compResult.largeItemCount} items above threshold ${ct} (100% tested, value=${compResult.largeItemTotal}). Residual: ${compResult.residualIndices.length} items selected via ${compResult.residualMethod} from ${compResult.residualPopulationSize} remaining items.`;
        extraData = {
          threshold: ct,
          largeItemCount: compResult.largeItemCount,
          largeItemTotal: compResult.largeItemTotal,
          residualMethod: compResult.residualMethod,
          residualPopulationSize: compResult.residualPopulationSize,
        };
        break;
      }

      case 'judgemental': {
        // Judgemental: just record the method — actual selection is manual or AI-guided
        // For now, fall through to random with a note
        n = sampleSizeStrategy === 'fixed' ? (fixedSampleSize || 25) : Math.min(25, N);
        n = Math.min(Math.max(n, 1), N);
        const jResult = selectSRSWOR(populationItems, n, seed);
        selectedIndices = jResult.selectedIndices;
        selectedItems = jResult.selectedItems;
        algorithmName = 'Judgemental-RandomAssist';
        planningRationale = `Judgemental sampling: ${n} items selected with random assistance. The auditor's judgement and documented rationale govern the selection approach.`;
        break;
      }

      case 'stratified': {
        // Mode B — AI Risk Stratification
        const features: StratificationFeature[] = Array.isArray(stratificationFeatures)
          ? stratificationFeatures
          : [{ name: 'Amount', column: columnMapping.amount || 'bookValue', type: 'numeric' as const, weight: 1 }];

        const rule = allocationRule || 'rule_a';
        const params = allocationParams || {};

        const stratResult = stratifyPopulation({
          population: populationItems,
          features,
          allocationRule: rule,
          ruleAMediumPct: params.mediumPct || 30,
          ruleALowPct: params.lowPct || 10,
          ruleBTotalN: params.totalN || 50,
          ruleCHighN: params.highN,
          ruleCMediumN: params.mediumN,
          ruleCLowN: params.lowN,
          seed,
          explainability: explainabilityLevel || 'basic',
        });

        selectedIndices = stratResult.selectedIndices;
        selectedItems = stratResult.selectedItems;
        n = stratResult.sampleSize;
        algorithmName = stratResult.algorithm;

        const strataSummary = stratResult.strata.map(s => `${s.name}: ${s.itemCount} items (${s.sampleSize} sampled)`).join('; ');
        planningRationale = `AI Risk Stratification: ${strataSummary}. Features: ${stratResult.featuresUsed.join(', ')}. Allocation: ${rule}.`;

        extraData = {
          strata: stratResult.strata,
          featuresUsed: stratResult.featuresUsed,
          allocationRule: rule,
          itemProfiles: stratResult.itemProfiles.map(ip => ({
            index: ip.index, riskScore: ip.riskScore, stratum: ip.stratum,
          })),
          highRiskProfiles: stratResult.itemProfiles.filter(ip => ip.stratum === 'high').slice(0, 50),
        };
        break;
      }

      case 'random':
      default: {
        // Random SRS
        if (sampleSizeStrategy === 'fixed') {
          n = fixedSampleSize || 25;
          planningRationale = `Fixed sample size of ${n} (user-specified).`;
        } else if (TM > 0) {
          const plan = planSampleSize({ populationItems, confidence: conf, tolerableMisstatement: TM, errorMetric: metric, mode: 'book_sd_bound', kFactor: kFactor || 20 });
          n = plan.recommendedN;
          planningRationale = plan.rationale;
        } else {
          n = Math.min(25, N);
          planningRationale = 'Default sample size of 25 (no tolerable misstatement specified).';
        }
        n = Math.min(Math.max(n, 1), N);
        const rResult = selectSRSWOR(populationItems, n, seed);
        selectedIndices = rResult.selectedIndices;
        selectedItems = rResult.selectedItems;
        algorithmName = rResult.algorithm;
        break;
      }
    }

    // Build audit trail
    const auditTrail = {
      populationHash: computePopulationHash(populationItems),
      populationSize: N,
      sampleSize: selectedItems.length,
      seed,
      algorithm: algorithmName,
      errorMetric: metric,
      confidence: conf,
      tolerableMisstatement: TM,
      timestamp: new Date().toISOString(),
      toolVersion: '1.0',
      selectedItemIds: selectedItems.map(i => i.id),
      method: selectedMethod,
      ...extraData,
    };

    const sampleTotal = selectedItems.reduce((s, i) => s + Math.abs(i.bookValue), 0);
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
        mode: selectedMethod === 'stratified' ? 'B' : 'A',
        method: selectedMethod,
        stratification: stratification || 'simple',
        parameters: {
          errorMetric: metric,
          confidence: conf,
          tolerableMisstatement: TM,
          sampleSizeStrategy: sampleSizeStrategy || 'calculator',
          fixedSampleSize: sampleSizeStrategy === 'fixed' ? fixedSampleSize : undefined,
          kFactor: kFactor || 20,
          planningRationale,
        },
        seed,
        toolVersion: '1.0',
        status: 'complete',
        sampleSize: selectedItems.length,
        resultSummary: {
          populationTotal: Math.round(populationTotal * 100) / 100,
          sampleTotal: Math.round(sampleTotal * 100) / 100,
          coverage: Math.round(coverage * 100) / 100,
          planningRationale,
          ...extraData,
        },
        coverageSummary: {
          populationSize: N,
          sampleSize: selectedItems.length,
          populationTotal: Math.round(populationTotal * 100) / 100,
          sampleTotal: Math.round(sampleTotal * 100) / 100,
          coveragePct: Math.round(coverage * 100) / 100,
        },
        auditTrailHash: computePopulationHash(selectedItems),
      },
    });

    // Store selected items
    await prisma.samplingItem.createMany({
      data: selectedItems.map(item => ({
        runId: run.id,
        transactionId: item.id,
        bookValue: item.bookValue,
        selectedReason: algorithmName,
      })),
    });

    // Update engagement status
    await prisma.samplingEngagement.update({
      where: { id: engagementId },
      data: { status: 'complete' },
    });

    await action.success('Sampling complete', {
      runId: run.id, method, sampleSize: selectedItems.length,
      populationSize: N, coverage: Math.round(coverage * 100) / 100,
    });

    return NextResponse.json({
      runId: run.id,
      selectedIndices,
      selectedIds: selectedItems.map(i => i.id),
      sampleSize: selectedItems.length,
      populationSize: N,
      populationTotal: Math.round(populationTotal * 100) / 100,
      sampleTotal: Math.round(sampleTotal * 100) / 100,
      coverage: Math.round(coverage * 100) / 100,
      seed,
      algorithm: algorithmName,
      populationHash: auditTrail.populationHash,
      planningRationale,
      auditTrail,
    });
  } catch (error) {
    await action.error(error, { method: body?.method, engagementId: body?.engagementId });
    return action.errorResponse(error);
  }
}
