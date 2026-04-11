/**
 * Action Pipeline Handlers
 *
 * Each handler wraps one or more existing flow-engine operations.
 * Called by the pipeline execution engine (processPipelineStep).
 * Handlers return a result indicating continue/pause/error.
 */

import { prisma } from '@/lib/db';
import type { InputFieldDef, OutputFieldDef } from './action-registry';
import { resolveActionInputs } from './action-registry';
import {
  extractAddressesFromPortalResponse,
  runBatch,
  DATA_GROUPS,
  type DataGroup,
  type ExtractedAddress,
  type PropertyVerificationResult,
} from './property-verification';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ActionHandlerContext {
  engagementId: string;
  executionId: string;
  stepIndex: number;
  actionStepId: string;
  inputs: Record<string, any>;
  pipelineState: Record<number, Record<string, any>>;
  config: {
    userId: string;
    firmId: string;
    fsLine: string;
    fsLineId?: string;
    testDescription: string;
  };
}

export interface ActionHandlerResult {
  action: 'continue' | 'pause' | 'error';
  outputs: Record<string, any>;
  pauseReason?: string;
  pauseRefId?: string;
  errorMessage?: string;
}

export type ActionHandler = (ctx: ActionHandlerContext) => Promise<ActionHandlerResult>;

// ─── Handler Registry ───────────────────────────────────────────────────────

const HANDLERS: Record<string, ActionHandler> = {
  requestDocuments: handleRequestDocuments,
  extractBankStatements: handleExtractBankStatements,
  accountingExtract: handleAccountingExtract,
  selectSample: handleSelectSample,
  aiAnalysis: handleAiAnalysis,
  analyseLargeUnusual: handleAnalyseLargeUnusual,
  analyseCutOff: handleAnalyseCutOff,
  compareBankToTB: handleCompareBankToTB,
  verifyEvidence: handleVerifyEvidence,
  teamReview: handleTeamReview,
  verifyPropertyAssets: handleVerifyPropertyAssets,
};

export function getActionHandler(handlerName: string): ActionHandler | null {
  return HANDLERS[handlerName] || null;
}

// ─── Handler Implementations ────────────────────────────────────────────────
// Each handler is a thin wrapper that delegates to existing flow-engine logic.
// For Phase 2, handlers that require complex sub-flows (portal requests,
// sampling UI) return 'pause' with appropriate reason so the UI can handle it.

async function handleRequestDocuments(ctx: ActionHandlerContext): Promise<ActionHandlerResult> {
  const { engagementId, inputs } = ctx;

  // Look up the engagement to get its clientId + the requesting user's name (PortalRequest requires both)
  const engagement = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    select: { clientId: true },
  });
  if (!engagement) {
    return { action: 'error', outputs: {}, errorMessage: 'Engagement not found' };
  }
  const requestingUser = await prisma.user.findUnique({
    where: { id: ctx.config.userId },
    select: { name: true, email: true },
  });

  // Create a portal request for the client
  try {
    const portalRequest = await prisma.portalRequest.create({
      data: {
        clientId: engagement.clientId,
        engagementId,
        section: 'evidence',
        question: inputs.message_to_client || 'Please provide the requested documents.',
        status: 'outstanding',
        requestedById: ctx.config.userId,
        requestedByName: requestingUser?.name || requestingUser?.email || 'Audit Team',
        evidenceTag: inputs.area_of_work || ctx.config.fsLine,
      },
    });

    // Create outstanding item to track
    await prisma.outstandingItem.create({
      data: {
        engagementId,
        executionId: ctx.executionId,
        type: 'portal_request',
        title: `Document request: ${inputs.document_type || 'documents'}`,
        description: inputs.message_to_client,
        source: 'flow',
        assignedTo: 'client',
        status: 'awaiting_client',
        fsLine: ctx.config.fsLine,
        testName: ctx.config.testDescription,
        portalRequestId: portalRequest.id,
      },
    });

    return {
      action: 'pause',
      outputs: { portal_request_id: portalRequest.id },
      pauseReason: 'portal_response',
      pauseRefId: portalRequest.id,
    };
  } catch (err: any) {
    return { action: 'error', outputs: {}, errorMessage: `Failed to create portal request: ${err.message}` };
  }
}

async function handleExtractBankStatements(ctx: ActionHandlerContext): Promise<ActionHandlerResult> {
  // Bank statement extraction is a complex multi-step process.
  // For now, pause to let the user upload/provide statements via the UI.
  return {
    action: 'pause',
    outputs: { status: 'awaiting_bank_statements' },
    pauseReason: 'evidence',
    pauseRefId: `bank_extract_${ctx.stepIndex}`,
  };
}

async function handleAccountingExtract(ctx: ActionHandlerContext): Promise<ActionHandlerResult> {
  const { engagementId, inputs } = ctx;

  try {
    // Check if client has an accounting connection
    const engagement = await prisma.auditEngagement.findUnique({
      where: { id: engagementId },
      select: { clientId: true },
    });
    if (!engagement) return { action: 'error', outputs: {}, errorMessage: 'Engagement not found' };

    const connection = await prisma.accountingConnection.findFirst({
      where: { clientId: engagement.clientId, expiresAt: { gt: new Date() } },
    });

    if (!connection) {
      return {
        action: 'pause',
        outputs: { status: 'no_accounting_connection', message: 'No accounting system connected. Please connect via Client settings or provide data manually.' },
        pauseReason: 'evidence',
      };
    }

    // Accounting extract requires Xero/other API calls — delegate to flow engine's existing handler
    // For Phase 2, return pause so the user can trigger the extract from the UI
    return {
      action: 'pause',
      outputs: { status: 'accounting_connected', system: connection.system, data_type: inputs.data_type },
      pauseReason: 'evidence',
      pauseRefId: `accounting_extract_${ctx.stepIndex}`,
    };
  } catch (err: any) {
    return { action: 'error', outputs: {}, errorMessage: `Accounting extract failed: ${err.message}` };
  }
}

async function handleSelectSample(ctx: ActionHandlerContext): Promise<ActionHandlerResult> {
  // Sampling requires user interaction with the sample calculator UI
  return {
    action: 'pause',
    outputs: {
      status: 'awaiting_sampling',
      sample_type: ctx.inputs.sample_type,
      population_size: Array.isArray(ctx.inputs.population) ? ctx.inputs.population.length : 0,
    },
    pauseReason: 'sampling',
    pauseRefId: `sampling_${ctx.stepIndex}`,
  };
}

async function handleAiAnalysis(ctx: ActionHandlerContext): Promise<ActionHandlerResult> {
  const { inputs } = ctx;

  try {
    // Use Together AI (same as flow engine)
    const OpenAI = (await import('openai')).default;
    const client = new OpenAI({
      apiKey: process.env.TOGETHER_API_KEY || '',
      baseURL: 'https://api.together.xyz/v1',
    });

    const prompt = inputs.prompt_template || 'Analyse the following data and provide findings.';
    const dataStr = inputs.input_data ? JSON.stringify(inputs.input_data).slice(0, 8000) : 'No data provided.';

    const response = await client.chat.completions.create({
      model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
      messages: [
        { role: 'system', content: inputs.system_instruction || 'You are an audit assistant. Analyse the data and provide clear findings.' },
        { role: 'user', content: `${prompt}\n\nData:\n${dataStr}` },
      ],
      max_tokens: 2000,
      temperature: 0.1,
    });

    const result = response.choices[0]?.message?.content || '';

    return {
      action: inputs.requires_review ? 'pause' : 'continue',
      outputs: {
        result,
        summary: result.slice(0, 500),
        pass_fail: result.toLowerCase().includes('pass') ? 'pass' : result.toLowerCase().includes('fail') ? 'fail' : 'review',
        data_table: [],
      },
      ...(inputs.requires_review ? { pauseReason: 'review', pauseRefId: `ai_review_${ctx.stepIndex}` } : {}),
    };
  } catch (err: any) {
    return { action: 'error', outputs: {}, errorMessage: `AI analysis failed: ${err.message}` };
  }
}

async function handleAnalyseLargeUnusual(ctx: ActionHandlerContext): Promise<ActionHandlerResult> {
  // Delegate to AI analysis with a specific prompt for large/unusual items
  const largeUnusualCtx = {
    ...ctx,
    inputs: {
      ...ctx.inputs,
      prompt_template: `Analyse the following transactions and identify any that are large or unusual relative to the population. Consider materiality of ${ctx.inputs.materiality || 'not specified'} and performance materiality of ${ctx.inputs.performance_materiality || 'not specified'}. List each flagged item with a reason.`,
      system_instruction: 'You are a statutory auditor analysing transactions for large or unusual items per ISA 240 and ISA 315. Be specific about why each item is flagged.',
      requires_review: true,
    },
  };
  return handleAiAnalysis(largeUnusualCtx);
}

async function handleAnalyseCutOff(ctx: ActionHandlerContext): Promise<ActionHandlerResult> {
  const cutOffCtx = {
    ...ctx,
    inputs: {
      ...ctx.inputs,
      prompt_template: `Analyse these transactions for cut-off issues around the period end date ${ctx.inputs.period_end || ''}. Check ${ctx.inputs.cut_off_days || 10} days either side. Identify any transactions that may be recorded in the wrong period.`,
      system_instruction: 'You are a statutory auditor testing cut-off per ISA 500. Identify transactions near the period end that may be in the wrong period.',
      requires_review: true,
    },
  };
  return handleAiAnalysis(cutOffCtx);
}

async function handleCompareBankToTB(ctx: ActionHandlerContext): Promise<ActionHandlerResult> {
  const { inputs } = ctx;
  const bankData = inputs.bank_data;
  const tbBalance = inputs.tb_balance;

  if (!bankData || tbBalance === undefined) {
    return { action: 'error', outputs: {}, errorMessage: 'Bank data and TB balance are required for reconciliation.' };
  }

  // Simple reconciliation: sum bank transactions and compare to TB
  let bankTotal = 0;
  if (Array.isArray(bankData)) {
    for (const row of bankData) {
      bankTotal += Number(row.amount || row.Amount || row.balance || 0);
    }
  } else {
    bankTotal = Number(bankData) || 0;
  }

  const variance = Math.round((bankTotal - Number(tbBalance)) * 100) / 100;
  const reconciled = Math.abs(variance) < 0.01;

  return {
    action: 'continue',
    outputs: {
      bank_total: bankTotal,
      tb_balance: Number(tbBalance),
      variance,
      pass_fail: reconciled ? 'pass' : 'fail',
      data_table: [{ bank_total: bankTotal, tb_balance: Number(tbBalance), variance, reconciled }],
    },
  };
}

async function handleVerifyEvidence(ctx: ActionHandlerContext): Promise<ActionHandlerResult> {
  // Evidence verification requires human review of documents
  return {
    action: 'pause',
    outputs: {
      status: 'awaiting_verification',
      assertions: ctx.inputs.assertions || [],
      item_count: Array.isArray(ctx.inputs.sample_items) ? ctx.inputs.sample_items.length : 0,
    },
    pauseReason: 'review',
    pauseRefId: `verify_${ctx.stepIndex}`,
  };
}

/**
 * Resolve the active data group set for a verify_property_assets run.
 * Prefers the runtime selection (from the resume payload) and falls back
 * to the action's configured defaults, then to ['ownership'] if nothing
 * was configured. Sanitises any unrecognised group names.
 */
function resolveDataGroups(runtime: any, defaults: any): DataGroup[] {
  const source = Array.isArray(runtime) && runtime.length > 0
    ? runtime
    : Array.isArray(defaults)
      ? defaults
      : [];
  const clean = source.filter((g: any): g is DataGroup => DATA_GROUPS.includes(g));
  return clean.length > 0 ? clean : ['ownership'];
}

/**
 * Verify UK Property Assets — multi-phase action that drives the full
 * HMLR pipeline.
 *
 * Phase flow (stored on pipelineState[stepIndex].phase):
 *   awaiting_addresses → awaiting_sample → awaiting_review → completed
 *
 * Each pause returns control to the UI so the auditor (or client) can
 * supply the next piece of data. `resumePipelineExecution` merges the
 * resume payload into pipelineState[stepIndex] before re-entering this
 * handler, so we always read the latest phase marker from stepState.
 */
async function handleVerifyPropertyAssets(ctx: ActionHandlerContext): Promise<ActionHandlerResult> {
  const { engagementId, inputs, executionId, stepIndex, pipelineState, config } = ctx;
  const stepState = pipelineState[stepIndex] || {};
  const phase: string = stepState.phase || 'new';

  const engagement = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    select: { clientId: true, firmId: true },
  });
  if (!engagement) {
    return { action: 'error', outputs: {}, errorMessage: 'Engagement not found' };
  }

  const hmlrCtx = {
    firmId: engagement.firmId,
    clientId: engagement.clientId,
    engagementId,
    executionId,
    userId: config.userId,
  };

  try {
    // ── Phase A: kick off — create a portal request for addresses ─────────
    if (phase === 'new') {
      const requestingUser = await prisma.user.findUnique({
        where: { id: config.userId },
        select: { name: true, email: true },
      });
      const portalRequest = await prisma.portalRequest.create({
        data: {
          clientId: engagement.clientId,
          engagementId,
          section: 'property_verification',
          question: inputs.message_to_client || 'Please provide a list of UK properties owned by the entity with full postal addresses.',
          status: 'outstanding',
          requestedById: config.userId,
          requestedByName: requestingUser?.name || requestingUser?.email || 'Audit Team',
          evidenceTag: 'property_verification',
        },
      });
      await prisma.outstandingItem.create({
        data: {
          engagementId,
          executionId,
          type: 'portal_request',
          title: 'Land Registry — request property list from client',
          description: inputs.message_to_client,
          source: 'flow',
          assignedTo: 'client',
          status: 'awaiting_client',
          fsLine: config.fsLine,
          testName: config.testDescription,
          portalRequestId: portalRequest.id,
        },
      });
      return {
        action: 'pause',
        outputs: { phase: 'awaiting_addresses', portal_request_id: portalRequest.id, repeatOnResume: true },
        pauseReason: 'portal_response',
        pauseRefId: portalRequest.id,
      };
    }

    // ── Phase B: client responded — parse addresses and pause for sample ─
    if (phase === 'addresses_received') {
      const portalRequestId = stepState.portal_request_id as string | undefined;
      let addresses: ExtractedAddress[] = Array.isArray(stepState.addresses) ? stepState.addresses : [];
      if (addresses.length === 0 && portalRequestId) {
        addresses = await extractAddressesFromPortalResponse(portalRequestId);
      }
      if (addresses.length === 0) {
        return {
          action: 'pause',
          outputs: {
            phase: 'awaiting_addresses',
            portal_request_id: portalRequestId,
            parse_error: 'Could not parse any addresses from the client response. Please ask the client to resend with one address per line.',
            repeatOnResume: true,
          },
          pauseReason: 'portal_response',
          pauseRefId: portalRequestId,
        };
      }
      return {
        action: 'pause',
        outputs: {
          phase: 'awaiting_sample',
          portal_request_id: portalRequestId,
          addresses,
          data_table: addresses,
          repeatOnResume: true,
        },
        pauseReason: 'sampling',
        pauseRefId: `property_sample_${stepIndex}`,
      };
    }

    // ── Phase C: sample chosen — run HMLR pipeline per property ──────────
    // Data groups come from the resume payload (the UI's checkbox state)
    // or fall back to the action's configured defaults. The runtime UI
    // is authoritative — the config value is just the initial checkbox
    // state.
    if (phase === 'sample_selected') {
      const addresses: ExtractedAddress[] = Array.isArray(stepState.addresses) ? stepState.addresses : [];
      const selectedIndices: number[] = Array.isArray(stepState.selectedIndices) ? stepState.selectedIndices : [];
      const valuesByIndex: Record<number, number> = stepState.valuesByIndex || {};
      const selected = selectedIndices
        .map(i => addresses[i])
        .filter(Boolean)
        .map((addr, j) => ({ ...addr, value: valuesByIndex[selectedIndices[j]] }));

      if (selected.length === 0) {
        return { action: 'error', outputs: {}, errorMessage: 'No properties were selected for testing.' };
      }

      const dataGroups = resolveDataGroups(stepState.dataGroups, inputs.default_data_groups);
      const options = {
        dataGroups,
        restrictionStrategy: (inputs.restriction_api || 'register_summary') as 'register_summary' | 'dedicated_search',
      };

      const results = await runBatch(
        selected,
        options,
        hmlrCtx,
        inputs.client_name || 'the audit client',
        inputs.period_end,
      );
      // Merge user-supplied values back onto the results for display.
      results.forEach((r, i) => { r.valueGbp = selected[i]?.value; });

      const totalCost = results.reduce((s, r) => s + r.totalCostGbp, 0);
      const exceptionCount = results.filter(r => r.flags.length > 0).length;
      const allDocuments = results.flatMap(r => r.documents);

      return {
        action: 'pause',
        outputs: {
          phase: 'awaiting_review',
          addresses,
          selectedIndices,
          valuesByIndex,
          dataGroups,
          properties: results,
          documents: allDocuments,
          total_cost_gbp: Math.round(totalCost * 100) / 100,
          exception_count: exceptionCount,
          repeatOnResume: true,
        },
        pauseReason: 'review',
        pauseRefId: `property_review_${stepIndex}`,
      };
    }

    // ── Phase C2: auditor ticked additional data groups on the review UI
    //    and asked to fetch the delta. Re-runs only the APIs for the
    //    newly-enabled groups; already-fetched APIs are reused verbatim.
    if (phase === 'fetch_additional') {
      const addresses: ExtractedAddress[] = Array.isArray(stepState.addresses) ? stepState.addresses : [];
      const selectedIndices: number[] = Array.isArray(stepState.selectedIndices) ? stepState.selectedIndices : [];
      const valuesByIndex: Record<number, number> = stepState.valuesByIndex || {};
      const previousResults: PropertyVerificationResult[] = Array.isArray(stepState.properties) ? stepState.properties : [];
      const nextGroups = resolveDataGroups(stepState.dataGroups, inputs.default_data_groups);

      const selected = selectedIndices
        .map(i => addresses[i])
        .filter(Boolean)
        .map((addr, j) => ({ ...addr, value: valuesByIndex[selectedIndices[j]] }));

      // Index previous results by property id so runBatch can feed each
      // property its own cached call list.
      const previousById: Record<string, PropertyVerificationResult> = {};
      for (const r of previousResults) previousById[r.id] = r;

      const options = {
        dataGroups: nextGroups,
        restrictionStrategy: (inputs.restriction_api || 'register_summary') as 'register_summary' | 'dedicated_search',
      };

      const results = await runBatch(
        selected,
        options,
        hmlrCtx,
        inputs.client_name || 'the audit client',
        inputs.period_end,
        previousById,
      );
      results.forEach((r, i) => { r.valueGbp = selected[i]?.value; });

      const totalCost = results.reduce((s, r) => s + r.totalCostGbp, 0);
      const exceptionCount = results.filter(r => r.flags.length > 0).length;
      const allDocuments = results.flatMap(r => r.documents);

      return {
        action: 'pause',
        outputs: {
          phase: 'awaiting_review',
          addresses,
          selectedIndices,
          valuesByIndex,
          dataGroups: nextGroups,
          properties: results,
          documents: allDocuments,
          total_cost_gbp: Math.round(totalCost * 100) / 100,
          exception_count: exceptionCount,
          repeatOnResume: true,
        },
        pauseReason: 'review',
        pauseRefId: `property_review_${stepIndex}`,
      };
    }

    // ── Phase D: reviewer has signed everything off — finalise ───────────
    if (phase === 'reviewed') {
      const properties: PropertyVerificationResult[] = Array.isArray(stepState.properties) ? stepState.properties : [];
      const conclusion = stepState.conclusion || (stepState.exception_count > 0 ? 'fail' : 'pass');
      return {
        action: 'continue',
        outputs: {
          phase: 'completed',
          properties,
          documents: stepState.documents || [],
          total_cost_gbp: stepState.total_cost_gbp || 0,
          exception_count: stepState.exception_count || 0,
          pass_fail: conclusion === 'green' || conclusion === 'pass' ? 'pass' : conclusion === 'orange' ? 'review' : 'fail',
        },
      };
    }

    return { action: 'error', outputs: {}, errorMessage: `Unknown phase: ${phase}` };
  } catch (err: any) {
    console.error('[verify_property_assets] handler error:', err);
    return { action: 'error', outputs: {}, errorMessage: err?.message || 'Property verification failed' };
  }
}

async function handleTeamReview(ctx: ActionHandlerContext): Promise<ActionHandlerResult> {
  const { engagementId, inputs } = ctx;

  // Create outstanding item for team review
  await prisma.outstandingItem.create({
    data: {
      engagementId,
      executionId: ctx.executionId,
      type: 'review_point',
      title: `Review: ${ctx.config.testDescription}`,
      description: inputs.instructions || 'Please review the test results.',
      source: 'flow',
      assignedTo: inputs.reviewer_role || 'preparer',
      status: 'pending',
      fsLine: ctx.config.fsLine,
      testName: ctx.config.testDescription,
    },
  });

  return {
    action: 'pause',
    outputs: { status: 'awaiting_review', reviewer_role: inputs.reviewer_role },
    pauseReason: 'review',
    pauseRefId: `review_${ctx.stepIndex}`,
  };
}
