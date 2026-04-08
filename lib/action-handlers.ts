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

  // Create a portal request for the client
  try {
    const portalRequest = await prisma.portalRequest.create({
      data: {
        engagementId,
        section: 'evidence',
        questionText: inputs.message_to_client || 'Please provide the requested documents.',
        status: 'outstanding',
        requestedById: ctx.config.userId,
        fsLine: ctx.config.fsLine,
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
      where: { clientId: engagement.clientId, isActive: true },
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
