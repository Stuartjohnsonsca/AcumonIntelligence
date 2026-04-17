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
  requestAccrualsListing: handleRequestAccrualsListing,
  extractAccrualsEvidence: handleExtractAccrualsEvidence,
  verifyAccrualsSample: handleVerifyAccrualsSample,
  extractPostYeBankPayments: handleExtractPostYeBankPayments,
  selectUnrecordedLiabilitiesSample: handleSelectUnrecordedLiabilitiesSample,
  verifyUnrecordedLiabilitiesSample: handleVerifyUnrecordedLiabilitiesSample,
  requestGmData: handleRequestGmData,
  computeGmAnalysis: handleComputeGmAnalysis,
  requestGmExplanations: handleRequestGmExplanations,
  assessGmExplanations: handleAssessGmExplanations,
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

// ─── Year-End Accruals Handlers ────────────────────────────────────────────

/**
 * Parse an uploaded accruals listing into row objects. Shared between the
 * initial parse and any manual re-parse triggered by the UI. Supports
 * XLSX / CSV / JSON. For anything else (PDF scans, images), we return
 * empty rows and let the UI prompt for a structured file or manual entry.
 */
async function parseListingFromPortalUploads(portalRequestId: string): Promise<Array<Record<string, any>>> {
  const uploads = await prisma.portalUpload.findMany({
    where: { portalRequestId },
    orderBy: { createdAt: 'asc' },
  });
  if (uploads.length === 0) return [];

  const { getBlobAsBase64 } = await import('@/lib/azure-blob');
  const rows: Array<Record<string, any>> = [];
  for (const up of uploads) {
    try {
      const base64 = await getBlobAsBase64(up.storagePath, up.containerName);
      const buf = Buffer.from(base64, 'base64');
      const name = (up.originalName || '').toLowerCase();
      if (name.endsWith('.csv')) {
        const text = buf.toString('utf8');
        // Minimal CSV → objects parser (handles quoted fields with commas).
        const lines = text.split(/\r?\n/).filter(l => l.length > 0);
        if (lines.length < 2) continue;
        const split = (s: string): string[] => {
          const out: string[] = [];
          let cur = '';
          let inQ = false;
          for (let i = 0; i < s.length; i++) {
            const c = s[i];
            if (c === '"') { if (inQ && s[i + 1] === '"') { cur += '"'; i++; } else inQ = !inQ; }
            else if (c === ',' && !inQ) { out.push(cur); cur = ''; }
            else cur += c;
          }
          out.push(cur);
          return out;
        };
        const headers = split(lines[0]).map(h => h.trim());
        for (const line of lines.slice(1)) {
          const cells = split(line);
          const row: Record<string, any> = {};
          headers.forEach((h, i) => {
            const v = (cells[i] ?? '').trim();
            const n = Number(v);
            row[h] = v !== '' && !Number.isNaN(n) && /^-?\d/.test(v) ? n : v;
          });
          rows.push(row);
        }
      } else if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
        const XLSX = await import('xlsx');
        const wb = XLSX.read(buf, { type: 'buffer' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const parsed = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: null });
        rows.push(...parsed);
      } else if (name.endsWith('.json')) {
        const parsed = JSON.parse(buf.toString('utf8'));
        if (Array.isArray(parsed)) rows.push(...parsed);
      }
      // Unsupported formats are silently skipped — the AI extraction path
      // for PDFs is the job of extract_accruals_evidence; the listing step
      // expects a structured file from the client.
    } catch (err) {
      console.warn(`[request_accruals_listing] failed to parse upload ${up.originalName}:`, err);
    }
  }
  return rows;
}

/**
 * Step 1–3 of the spec: request the accruals listing, reconcile to TB.
 *
 * Phases:
 *   new                → create portal request, pause (awaiting_listing)
 *   listing_received   → parse, compute listing total vs TB accrual total
 *                        - reconciled:    continue (next step starts sampling)
 *                        - not reconciled: pause (awaiting_client) with variance
 *                          raised on an OutstandingItem so the client can respond
 */
async function handleRequestAccrualsListing(ctx: ActionHandlerContext): Promise<ActionHandlerResult> {
  const { engagementId, executionId, stepIndex, pipelineState, inputs, config } = ctx;
  const stepState = pipelineState[stepIndex] || {};
  const phase: string = stepState.phase || 'new';

  try {
    if (phase === 'new') {
      const engagement = await prisma.auditEngagement.findUnique({
        where: { id: engagementId },
        select: { clientId: true },
      });
      if (!engagement) {
        return { action: 'error', outputs: {}, errorMessage: 'Engagement not found' };
      }
      const requestingUser = await prisma.user.findUnique({
        where: { id: config.userId },
        select: { name: true, email: true },
      });
      const portalRequest = await prisma.portalRequest.create({
        data: {
          clientId: engagement.clientId,
          engagementId,
          section: 'evidence',
          question: inputs.message_to_client || 'Please provide the year-end accruals listing as at period end.',
          status: 'outstanding',
          requestedById: config.userId,
          requestedByName: requestingUser?.name || requestingUser?.email || 'Audit Team',
          evidenceTag: 'accruals_listing',
        },
      });
      await prisma.outstandingItem.create({
        data: {
          engagementId,
          executionId,
          type: 'portal_request',
          title: 'Year-end accruals listing — request from client',
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
        outputs: { phase: 'awaiting_listing', portal_request_id: portalRequest.id, repeatOnResume: true },
        pauseReason: 'portal_response',
        pauseRefId: portalRequest.id,
      };
    }

    if (phase === 'listing_received') {
      const portalRequestId = stepState.portal_request_id as string | undefined;
      if (!portalRequestId) {
        return { action: 'error', outputs: {}, errorMessage: 'No portal request id on step state' };
      }

      const rows = await parseListingFromPortalUploads(portalRequestId);
      if (rows.length === 0) {
        return {
          action: 'pause',
          outputs: {
            phase: 'awaiting_listing',
            portal_request_id: portalRequestId,
            parse_error: 'Could not parse any rows from the uploaded accruals listing. Please upload an Excel (.xlsx) or CSV file with one row per accrual.',
            repeatOnResume: true,
          },
          pauseReason: 'portal_response',
          pauseRefId: portalRequestId,
        };
      }

      const { sumAccrualsAtPeriodEnd, sumAccrualsListing } = await import('@/lib/accruals-tb-mapping');
      const { total: listingTotal } = sumAccrualsListing(rows);
      const { tbTotal, codes } = await sumAccrualsAtPeriodEnd(engagementId, inputs.accrual_account_codes);
      const tolerance = Number(inputs.tolerance_gbp || 1);
      const variance = Math.round((listingTotal - tbTotal) * 100) / 100;
      const reconciled = Math.abs(variance) <= tolerance;

      if (!reconciled) {
        // Raise a follow-up outstanding so the client is asked to explain
        // the variance. The pipeline stays paused at this step; resuming
        // with phase='listing_received' re-runs the reconciliation after
        // the client has uploaded a corrected/explained file.
        await prisma.outstandingItem.create({
          data: {
            engagementId,
            executionId,
            type: 'portal_request',
            title: `Accruals listing does not agree to TB (variance ${variance})`,
            description: `Listing total: ${listingTotal}. TB accrual total: ${tbTotal}. Variance: ${variance}. Please confirm the listing is complete or explain the difference.`,
            source: 'flow',
            assignedTo: 'client',
            status: 'awaiting_client',
            fsLine: config.fsLine,
            testName: config.testDescription,
            portalRequestId,
          },
        });
        return {
          action: 'pause',
          outputs: {
            phase: 'awaiting_listing',
            portal_request_id: portalRequestId,
            data_table: rows,
            listing_total: listingTotal,
            tb_total: tbTotal,
            variance,
            tb_reconciled: 'fail',
            account_codes_used: codes,
            repeatOnResume: true,
          },
          pauseReason: 'portal_response',
          pauseRefId: portalRequestId,
        };
      }

      // Reconciled — hand the listing forward as the sampling population.
      return {
        action: 'continue',
        outputs: {
          data_table: rows,
          listing_total: listingTotal,
          tb_total: tbTotal,
          variance,
          tb_reconciled: 'pass',
          account_codes_used: codes,
          portal_request_id: portalRequestId,
        },
      };
    }

    return { action: 'error', outputs: {}, errorMessage: `Unknown phase: ${phase}` };
  } catch (err: any) {
    console.error('[request_accruals_listing] handler error:', err);
    return { action: 'error', outputs: {}, errorMessage: err?.message || 'Accruals listing handler failed' };
  }
}

/**
 * Step 11 — server-side AI extraction of returned supporting evidence.
 * One row per document. Downstream matching to sample items happens in
 * verify_accruals_sample.
 */
async function handleExtractAccrualsEvidence(ctx: ActionHandlerContext): Promise<ActionHandlerResult> {
  const { inputs } = ctx;

  const docs: Array<{ id?: string; storagePath?: string; containerName?: string; originalName?: string; mimeType?: string }>
    = Array.isArray(inputs.source_documents) ? inputs.source_documents : [];

  if (docs.length === 0) {
    return {
      action: 'error',
      outputs: {},
      errorMessage: 'No source documents provided for accruals evidence extraction.',
    };
  }

  const { extractAccrualSupportingEvidence } = await import('@/lib/ai-extractor');
  const { getBlobAsBase64 } = await import('@/lib/azure-blob');

  const extracted: Array<Record<string, any>> = [];
  const issues: Array<Record<string, any>> = [];

  for (const doc of docs) {
    const fileName = doc.originalName || doc.id || 'document';
    try {
      if (!doc.storagePath) {
        issues.push({ file: fileName, issue: 'No storage path available' });
        continue;
      }
      const base64 = await getBlobAsBase64(doc.storagePath, doc.containerName || 'upload-inbox');
      const mime = doc.mimeType || (fileName.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg');
      const { evidence } = await extractAccrualSupportingEvidence(base64, mime, fileName);
      extracted.push({
        document_id: doc.id || null,
        file_name: fileName,
        supplier: evidence.supplier,
        amount: evidence.amount,
        currency: evidence.currency,
        invoice_date: evidence.invoiceDate,
        payment_date: evidence.paymentDate,
        service_period_start: evidence.servicePeriodStart,
        service_period_end: evidence.servicePeriodEnd,
        description: evidence.description,
        references: evidence.references,
        document_kind: evidence.documentKind,
        confidence: evidence.confidence,
        notes: evidence.notes,
      });
      if (evidence.confidence < 0.3) {
        issues.push({ file: fileName, issue: `Low extraction confidence (${evidence.confidence}). Review manually.` });
      }
    } catch (err: any) {
      issues.push({ file: fileName, issue: err?.message || 'Extraction failed' });
    }
  }

  return {
    action: 'continue',
    outputs: {
      extracted_evidence: extracted,
      data_table: extracted,
      document_ids: docs.map(d => d.id).filter(Boolean),
      extraction_issues: issues,
    },
  };
}

/**
 * Step 12–14 — the R/O/G marker logic.
 *
 * For each sample item we:
 *  (a) find best-matching extracted evidence (supplier + amount fuzzy match),
 *  (b) classify obligation as ≤ or > period end,
 *  (c) if ≤ period end, check supporting evidence within X days post-YE,
 *  (d) if not Red, detect a service period spanning YE → Orange (Spread),
 *  (e) for Orange items, time-apportion and re-test the ≤-YE portion.
 *
 * The decision logic is intentionally deterministic — we only call AI
 * once per document during extraction; matching and period assessment
 * run here server-side without further AI calls so the outputs are
 * reproducible and auditable. The free-text `reason` on each marker
 * explains the chain of checks so the reviewer can audit the logic.
 */
async function handleVerifyAccrualsSample(ctx: ActionHandlerContext): Promise<ActionHandlerResult> {
  const { executionId, stepIndex, inputs } = ctx;

  const samples: Array<Record<string, any>> = Array.isArray(inputs.sample_items) ? inputs.sample_items : [];
  const evidence: Array<Record<string, any>> = Array.isArray(inputs.extracted_evidence) ? inputs.extracted_evidence : [];

  if (samples.length === 0) {
    return { action: 'error', outputs: {}, errorMessage: 'No sample items to verify.' };
  }

  const periodEnd = inputs.period_end ? new Date(inputs.period_end) : null;
  if (!periodEnd || Number.isNaN(periodEnd.getTime())) {
    return { action: 'error', outputs: {}, errorMessage: 'Period end not resolved — cannot classify obligation period.' };
  }
  const xDays = Math.max(1, Number(inputs.x_days_post_ye || 60));
  const amountTol = Math.max(0, Number(inputs.amount_tolerance_gbp || 1));
  const windowEnd = new Date(periodEnd.getTime() + xDays * 86_400_000);

  // Normalise a string for loose supplier/description matching.
  const norm = (s: any) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const parseDate = (s: any): Date | null => {
    if (!s) return null;
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  };

  interface MarkerRow {
    sample_item_ref: string;
    sample_supplier: string | null;
    sample_description: string | null;
    sample_amount: number | null;
    sample_service_start: string | null;
    sample_service_end: string | null;
    colour: 'red' | 'orange' | 'green';
    marker_type: string;
    reason: string;
    calc: Record<string, any>;
  }

  const markers: MarkerRow[] = [];

  for (const s of samples) {
    const ref = String(s.id ?? s.ref ?? s.sample_id ?? s.reference ?? JSON.stringify(s).slice(0, 32));
    const supplier = s.supplier ?? s.payee ?? s.counterparty ?? null;
    const description = s.description ?? s.narrative ?? null;
    const amount = s.amount != null ? Number(s.amount) : null;
    const serviceStart = parseDate(s.service_period_start ?? s.servicePeriodStart ?? s.period_start);
    const serviceEnd = parseDate(s.service_period_end ?? s.servicePeriodEnd ?? s.period_end);

    // (a) Match extracted evidence by supplier + amount proximity.
    const candidates = evidence.map(e => {
      const sSupplier = norm(supplier);
      const eSupplier = norm(e.supplier);
      const supplierHit = sSupplier && eSupplier && (sSupplier.includes(eSupplier) || eSupplier.includes(sSupplier));
      const amt = e.amount != null ? Number(e.amount) : null;
      const amtDiff = amount != null && amt != null ? Math.abs(amt - amount) : null;
      // Simple score: supplier match counts 2, amount within tolerance counts 2, within 10% counts 1.
      let score = 0;
      if (supplierHit) score += 2;
      if (amtDiff != null && amtDiff <= amountTol) score += 2;
      else if (amount != null && amtDiff != null && amount !== 0 && amtDiff / Math.abs(amount) <= 0.10) score += 1;
      return { e, score, amtDiff };
    }).sort((a, b) => b.score - a.score);

    const matched = candidates.length > 0 && candidates[0].score >= 2 ? candidates[0] : null;
    const ev = matched?.e || null;

    // (b) Obligation-period classification. Preference order for the
    //     "obligation date" (i.e. when goods/services were received):
    //     sample service end → evidence service end → evidence invoice date.
    const obligationDate =
      serviceEnd
      || parseDate(ev?.service_period_end)
      || parseDate(ev?.invoice_date)
      || null;

    // If nothing tells us when the obligation was incurred, fall back to
    // Orange (Support Missing) — we can't defend pre-YE without evidence.
    if (!ev || !obligationDate) {
      markers.push({
        sample_item_ref: ref,
        sample_supplier: supplier ?? null,
        sample_description: description ?? null,
        sample_amount: amount ?? null,
        sample_service_start: serviceStart ? serviceStart.toISOString().slice(0, 10) : null,
        sample_service_end: serviceEnd ? serviceEnd.toISOString().slice(0, 10) : null,
        colour: 'orange',
        marker_type: 'Support Missing',
        reason: ev
          ? 'Evidence found but no obligation date (service end / invoice date) could be determined.'
          : 'No matching supporting evidence received within the post-YE window.',
        calc: { matched_document: ev?.file_name ?? null, match_score: matched?.score ?? 0 },
      });
      continue;
    }

    if (obligationDate > periodEnd) {
      markers.push({
        sample_item_ref: ref,
        sample_supplier: supplier ?? null,
        sample_description: description ?? null,
        sample_amount: amount ?? null,
        sample_service_start: serviceStart ? serviceStart.toISOString().slice(0, 10) : null,
        sample_service_end: serviceEnd ? serviceEnd.toISOString().slice(0, 10) : null,
        colour: 'red',
        marker_type: 'Incorrect Accrual',
        reason: `Obligation date ${obligationDate.toISOString().slice(0, 10)} is after period end (${periodEnd.toISOString().slice(0, 10)}). The goods/services had not been received/performed by year end, so the accrual is for an expense that did not belong to the period.`,
        calc: {
          matched_document: ev.file_name,
          obligation_date: obligationDate.toISOString().slice(0, 10),
          period_end: periodEnd.toISOString().slice(0, 10),
        },
      });
      continue;
    }

    // (c) Obligation ≤ period end. Check if subsequent evidence supports
    //     the accrued amount within the X-day window.
    const subsequentInWindow = evidence.filter(e => {
      const inv = parseDate(e.invoice_date);
      const pay = parseDate(e.payment_date);
      const hit = [inv, pay].some(d => d && d > periodEnd && d <= windowEnd);
      return hit;
    });
    const supportForThis = subsequentInWindow.find(e => {
      const sSupplier = norm(supplier);
      const eSupplier = norm(e.supplier);
      return sSupplier && eSupplier && (sSupplier.includes(eSupplier) || eSupplier.includes(sSupplier));
    });

    let amountMismatch = false;
    let contradictoryAmountDiff: number | null = null;
    if (supportForThis && amount != null && supportForThis.amount != null) {
      contradictoryAmountDiff = Math.round((Number(supportForThis.amount) - amount) * 100) / 100;
      if (Math.abs(contradictoryAmountDiff) > amountTol) amountMismatch = true;
    }

    if (!supportForThis) {
      markers.push({
        sample_item_ref: ref,
        sample_supplier: supplier ?? null,
        sample_description: description ?? null,
        sample_amount: amount ?? null,
        sample_service_start: serviceStart ? serviceStart.toISOString().slice(0, 10) : null,
        sample_service_end: serviceEnd ? serviceEnd.toISOString().slice(0, 10) : null,
        colour: 'orange',
        marker_type: 'Support Missing',
        reason: `Obligation is ≤ period end but no supporting invoice or payment was received within ${xDays} days post-YE.`,
        calc: {
          matched_document: ev.file_name,
          obligation_date: obligationDate.toISOString().slice(0, 10),
          window_end: windowEnd.toISOString().slice(0, 10),
        },
      });
      continue;
    }

    if (amountMismatch) {
      markers.push({
        sample_item_ref: ref,
        sample_supplier: supplier ?? null,
        sample_description: description ?? null,
        sample_amount: amount ?? null,
        sample_service_start: serviceStart ? serviceStart.toISOString().slice(0, 10) : null,
        sample_service_end: serviceEnd ? serviceEnd.toISOString().slice(0, 10) : null,
        colour: 'red',
        marker_type: 'Amount Mismatch',
        reason: `Supporting evidence (${supportForThis.file_name}) gives an amount that differs from the recorded accrual by ${contradictoryAmountDiff}, which exceeds the tolerance of ${amountTol}.`,
        calc: {
          matched_document: ev.file_name,
          supporting_document: supportForThis.file_name,
          supporting_amount: supportForThis.amount,
          sample_amount: amount,
          variance: contradictoryAmountDiff,
          tolerance: amountTol,
        },
      });
      continue;
    }

    // (d) Is it a continuous period spanning YE? Use service period if we
    //     have both ends; otherwise the evidence's service period.
    const effStart = serviceStart ?? parseDate(ev.service_period_start);
    const effEnd = serviceEnd ?? parseDate(ev.service_period_end);
    const spansYe = !!(effStart && effEnd && effStart < periodEnd && effEnd > periodEnd);

    if (!spansYe) {
      markers.push({
        sample_item_ref: ref,
        sample_supplier: supplier ?? null,
        sample_description: description ?? null,
        sample_amount: amount ?? null,
        sample_service_start: effStart ? effStart.toISOString().slice(0, 10) : null,
        sample_service_end: effEnd ? effEnd.toISOString().slice(0, 10) : null,
        colour: 'green',
        marker_type: 'Accrual Supported',
        reason: `Obligation ≤ period end and subsequent invoice/payment within ${xDays} days post-YE supports the recorded amount (variance ${contradictoryAmountDiff ?? 0} within tolerance ${amountTol}).`,
        calc: {
          matched_document: ev.file_name,
          supporting_document: supportForThis.file_name,
          obligation_date: obligationDate.toISOString().slice(0, 10),
        },
      });
      continue;
    }

    // (e) Orange (Spread) → time-apportion and re-test the ≤-YE slice.
    if (amount == null || !effStart || !effEnd) {
      markers.push({
        sample_item_ref: ref,
        sample_supplier: supplier ?? null,
        sample_description: description ?? null,
        sample_amount: amount ?? null,
        sample_service_start: effStart ? effStart.toISOString().slice(0, 10) : null,
        sample_service_end: effEnd ? effEnd.toISOString().slice(0, 10) : null,
        colour: 'orange',
        marker_type: 'Spread',
        reason: 'Service period spans year end but missing data prevents time apportionment.',
        calc: {},
      });
      continue;
    }
    const totalDays = Math.max(1, Math.round((effEnd.getTime() - effStart.getTime()) / 86_400_000) + 1);
    const preEndMs = Math.min(periodEnd.getTime(), effEnd.getTime());
    const preDays = Math.max(0, Math.round((preEndMs - effStart.getTime()) / 86_400_000) + 1);
    const preYePortion = Math.round((amount * (preDays / totalDays)) * 100) / 100;
    const recordedAccrual = s.recorded_accrual != null ? Number(s.recorded_accrual) : amount;
    const apportionVariance = Math.round((recordedAccrual - preYePortion) * 100) / 100;
    const apportionWithinTol = Math.abs(apportionVariance) <= amountTol;

    markers.push({
      sample_item_ref: ref,
      sample_supplier: supplier ?? null,
      sample_description: description ?? null,
      sample_amount: amount,
      sample_service_start: effStart.toISOString().slice(0, 10),
      sample_service_end: effEnd.toISOString().slice(0, 10),
      colour: apportionWithinTol ? 'green' : 'red',
      marker_type: apportionWithinTol ? 'Apportionment OK' : 'Apportionment Mismatch',
      reason: apportionWithinTol
        ? `Service period spans YE. Time apportionment (${preDays}/${totalDays} days = ${preYePortion}) agrees with the recorded accrual within tolerance.`
        : `Service period spans YE. Time apportionment gives a ≤-YE portion of ${preYePortion}, but the recorded accrual of ${recordedAccrual} differs by ${apportionVariance}.`,
      calc: {
        service_start: effStart.toISOString().slice(0, 10),
        service_end: effEnd.toISOString().slice(0, 10),
        total_days: totalDays,
        pre_ye_days: preDays,
        pre_ye_portion: preYePortion,
        recorded_accrual: recordedAccrual,
        variance: apportionVariance,
        tolerance: amountTol,
      },
    });
  }

  // Persist markers (upsert by unique key so re-runs refresh rather than duplicate).
  const dbOps = markers.map(m =>
    prisma.sampleItemMarker.upsert({
      where: {
        executionId_stepIndex_sampleItemRef: {
          executionId,
          stepIndex,
          sampleItemRef: m.sample_item_ref,
        },
      },
      update: {
        colour: m.colour,
        reason: m.reason,
        markerType: m.marker_type,
        calcJson: m.calc as any,
        // Clear any prior override whenever the handler re-runs; the UI
        // layer is responsible for re-applying user overrides via the
        // dedicated PATCH endpoint.
        overriddenBy: null,
        overriddenByName: null,
        overriddenAt: null,
        overrideReason: null,
        originalColour: null,
      },
      create: {
        executionId,
        stepIndex,
        sampleItemRef: m.sample_item_ref,
        colour: m.colour,
        reason: m.reason,
        markerType: m.marker_type,
        calcJson: m.calc as any,
      },
    }),
  );
  await Promise.all(dbOps);

  const red = markers.filter(m => m.colour === 'red');
  const orange = markers.filter(m => m.colour === 'orange');
  const green = markers.filter(m => m.colour === 'green');

  return {
    action: 'continue',
    outputs: {
      markers,
      data_table: markers,
      red_count: red.length,
      orange_count: orange.length,
      green_count: green.length,
      findings: red.map(m => ({
        sample_item_ref: m.sample_item_ref,
        date: m.sample_service_end,
        description: m.sample_description,
        amount: m.sample_amount,
        marker_type: m.marker_type,
        reason: m.reason,
      })),
      pass_fail: red.length === 0 ? (orange.length === 0 ? 'pass' : 'review') : 'fail',
    },
  };
}

// ─── Unrecorded Liabilities Handlers ───────────────────────────────────────

/**
 * Step 5 — parse returned bank statements / transaction exports into a
 * flat payments table. Supports XLSX / CSV (structured) and PDF
 * (vision extraction via ai-extractor). Only debits (payments) dated
 * between Period.End+1 and Period.End+X are kept.
 */
async function handleExtractPostYeBankPayments(ctx: ActionHandlerContext): Promise<ActionHandlerResult> {
  const { inputs } = ctx;

  const docs: Array<{ id?: string; storagePath?: string; containerName?: string; originalName?: string; mimeType?: string }>
    = Array.isArray(inputs.source_documents) ? inputs.source_documents : [];
  if (docs.length === 0) {
    return { action: 'error', outputs: {}, errorMessage: 'No bank statement / transaction documents provided.' };
  }

  const periodEnd = inputs.period_end ? new Date(inputs.period_end) : null;
  if (!periodEnd || Number.isNaN(periodEnd.getTime())) {
    return { action: 'error', outputs: {}, errorMessage: 'Period end not resolved.' };
  }
  const xDays = Math.max(1, Number(inputs.x_days_post_ye || 60));
  const windowStart = new Date(periodEnd.getTime() + 86_400_000);
  const windowEnd = new Date(periodEnd.getTime() + xDays * 86_400_000);

  const { getBlobAsBase64 } = await import('@/lib/azure-blob');
  const { extractBankStatementFromBase64 } = await import('@/lib/ai-extractor');

  const payments: Array<Record<string, any>> = [];
  const issues: Array<Record<string, any>> = [];

  for (const doc of docs) {
    const fileName = doc.originalName || doc.id || 'document';
    try {
      if (!doc.storagePath) { issues.push({ file: fileName, issue: 'No storage path' }); continue; }
      const base64 = await getBlobAsBase64(doc.storagePath, doc.containerName || 'upload-inbox');
      const buf = Buffer.from(base64, 'base64');
      const name = fileName.toLowerCase();

      // Structured CSV / XLSX: treat any row with a "Debit" / "Amount Out"
      // column (or a negative amount) as a payment.
      if (name.endsWith('.csv') || name.endsWith('.xlsx') || name.endsWith('.xls')) {
        let rows: Array<Record<string, any>> = [];
        if (name.endsWith('.csv')) {
          const text = buf.toString('utf8');
          const lines = text.split(/\r?\n/).filter(l => l.length > 0);
          if (lines.length < 2) continue;
          const split = (s: string): string[] => {
            const out: string[] = [];
            let cur = '';
            let inQ = false;
            for (let i = 0; i < s.length; i++) {
              const c = s[i];
              if (c === '"') { if (inQ && s[i + 1] === '"') { cur += '"'; i++; } else inQ = !inQ; }
              else if (c === ',' && !inQ) { out.push(cur); cur = ''; }
              else cur += c;
            }
            out.push(cur);
            return out;
          };
          const headers = split(lines[0]).map(h => h.trim());
          rows = lines.slice(1).map(line => {
            const cells = split(line);
            const r: Record<string, any> = {};
            headers.forEach((h, i) => { r[h] = (cells[i] ?? '').trim(); });
            return r;
          });
        } else {
          const XLSX = await import('xlsx');
          const wb = XLSX.read(buf, { type: 'buffer' });
          const sheet = wb.Sheets[wb.SheetNames[0]];
          rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: null });
        }

        for (const r of rows) {
          // Tolerant column discovery.
          const find = (...patterns: RegExp[]) => {
            const k = Object.keys(r).find(key => patterns.some(p => p.test(key.toLowerCase().replace(/[\s_-]/g, ''))));
            return k ? r[k] : null;
          };
          const rawDate = find(/^date$/, /transactiondate/, /postingdate/);
          const date = rawDate ? new Date(rawDate) : null;
          if (!date || Number.isNaN(date.getTime())) continue;
          if (date < windowStart || date > windowEnd) continue;

          const debit = Number(find(/^debit$/, /amountout/, /paidout/)) || 0;
          const credit = Number(find(/^credit$/, /amountin/, /paidin/)) || 0;
          const signed = Number(find(/^amount$/, /^value$/)) || 0;
          const payment = debit > 0 ? debit : (credit > 0 ? 0 : (signed < 0 ? Math.abs(signed) : 0));
          if (payment <= 0) continue;

          payments.push({
            date: date.toISOString().slice(0, 10),
            payee: String(find(/payee/, /counterparty/, /description/) || '').trim(),
            amount: Math.round(payment * 100) / 100,
            reference: String(find(/reference/, /^ref$/, /chequeno/) || '').trim(),
            narrative: String(find(/narrative/, /memo/, /details/) || '').trim(),
            bank_account: String(find(/account/, /sortcode/) || '').trim(),
            source_document: fileName,
          });
        }
        continue;
      }

      // PDF / image statements — reuse the existing bank-statement extractor.
      const mime = doc.mimeType || (name.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg');
      const result = await extractBankStatementFromBase64(base64, mime, fileName);
      for (const t of result.transactions) {
        const d = new Date(t.date);
        if (Number.isNaN(d.getTime())) continue;
        if (d < windowStart || d > windowEnd) continue;
        if (!t.debit || t.debit <= 0) continue;
        payments.push({
          date: d.toISOString().slice(0, 10),
          payee: t.description || '',
          amount: Math.round(t.debit * 100) / 100,
          reference: t.reference || '',
          narrative: t.description || '',
          bank_account: [result.bankName, result.accountNumber].filter(Boolean).join(' / '),
          source_document: fileName,
        });
      }
    } catch (err: any) {
      issues.push({ file: fileName, issue: err?.message || 'Extraction failed' });
    }
  }

  const totalValue = Math.round(payments.reduce((s, p) => s + (Number(p.amount) || 0), 0) * 100) / 100;

  return {
    action: 'continue',
    outputs: {
      data_table: payments,
      population_size: payments.length,
      total_value: totalValue,
      extraction_issues: issues,
    },
  };
}

/**
 * Three-layer sampling for unrecorded liabilities:
 *   1. Above-threshold (≥ threshold or performance materiality) — always kept.
 *   2. AI risk-ranked top-N of the remainder — keyword + pattern scoring done
 *      server-side without an external AI call to keep the handler
 *      deterministic for audit replay (the scoring model is documented in
 *      computeRiskScore).
 *   3. Residual sampling (MUS / stratified / haphazard) on what's left.
 *
 * Each selected row gets a `select_reason` column so the auditor can
 * justify inclusion per sample item.
 */
function computeRiskScore(p: Record<string, any>, periodEnd: Date): number {
  // Heuristic scoring — higher = more likely to be a prior-period obligation.
  // (The spec asks for AI risk-ranking; we score deterministically using
  // features the AI would otherwise look at, so the ranking is auditable.)
  let score = 0;
  const payee = String(p.payee || '').toLowerCase();
  const narr = String(p.narrative || '').toLowerCase();
  const blob = `${payee} ${narr}`;

  // Payee keywords that commonly indicate prior-period obligations.
  const PRIOR_KEYWORDS = [
    'audit', 'legal', 'consult', 'accountancy', 'accountant', 'tax', 'rent', 'rates',
    'insur', 'utility', 'utilities', 'electric', 'gas ', 'water', 'council',
    'subscription', 'licence', 'license', 'telecom', 'broadband',
    'professional', 'service fee', 'retainer',
  ];
  for (const kw of PRIOR_KEYWORDS) if (blob.includes(kw)) { score += 2; break; }

  // Explicit references to the prior period in the narrative.
  const y = periodEnd.getFullYear();
  if (blob.includes(String(y))) score += 2;
  const monthsBeforeYe = ['december', 'november', 'october'];
  for (const m of monthsBeforeYe) if (blob.includes(m)) { score += 1; break; }

  // Round-pound figures are more common for accrual-style payments.
  const amt = Number(p.amount) || 0;
  if (amt > 0 && amt % 1 === 0) score += 1;
  // Larger amounts get a mild bump (log-scaled).
  if (amt > 0) score += Math.min(3, Math.log10(amt));

  // Payment date close to year end (within ~30 days) is lower risk, as
  // auditors will likely capture these via cut-off. Later payments
  // (30+ days) with prior-period narrative are more interesting.
  const d = new Date(p.date);
  if (!Number.isNaN(d.getTime())) {
    const daysAfter = Math.round((d.getTime() - periodEnd.getTime()) / 86_400_000);
    if (daysAfter > 30) score += 0.5;
  }
  return Math.round(score * 100) / 100;
}

async function handleSelectUnrecordedLiabilitiesSample(ctx: ActionHandlerContext): Promise<ActionHandlerResult> {
  const { engagementId, inputs } = ctx;

  const population: Array<Record<string, any>> = Array.isArray(inputs.population) ? inputs.population : [];
  if (population.length === 0) {
    return { action: 'error', outputs: {}, errorMessage: 'Empty population — no post-YE payments to sample.' };
  }

  // Resolve threshold: explicit input > engagement performance materiality.
  let threshold = Number(inputs.threshold_gbp);
  if (!threshold || Number.isNaN(threshold)) {
    const eng = await prisma.auditEngagement.findUnique({
      where: { id: engagementId },
      select: { performanceMateriality: true, materiality: true } as any,
    }) as any;
    threshold = Number(eng?.performanceMateriality ?? eng?.materiality ?? 0) || 0;
  }

  const enableAbove = inputs.enable_above_threshold !== false;
  const enableAi = inputs.enable_ai_risk_rank !== false;
  const aiTopN = Math.max(0, Number(inputs.ai_top_n || 10));
  const residualMethod = String(inputs.residual_method || 'none');
  const residualSize = Math.max(0, Number(inputs.residual_sample_size || 10));

  const periodEnd = ctx.inputs.period_end ? new Date(ctx.inputs.period_end) : new Date();

  // Layer 1: above-threshold.
  const indexed: Array<Record<string, any>> = population.map((p, i) => ({ ...p, __idx: i }));
  const above: Array<Record<string, any>> = [];
  const belowThreshold: Array<Record<string, any>> = [];
  for (const row of indexed) {
    const amt = Number(row.amount) || 0;
    if (enableAbove && threshold > 0 && amt >= threshold) {
      above.push({ ...row, select_reason: `Above threshold (≥ £${threshold})` });
    } else {
      belowThreshold.push(row);
    }
  }

  // Layer 2: AI risk ranking (top-N).
  let aiSelected: any[] = [];
  const riskScores: any[] = belowThreshold.map(r => ({
    __idx: r.__idx,
    date: r.date,
    payee: r.payee,
    amount: r.amount,
    risk_score: computeRiskScore(r, periodEnd),
  })).sort((a, b) => b.risk_score - a.risk_score);
  if (enableAi && aiTopN > 0) {
    const topIdx = new Set(riskScores.slice(0, aiTopN).map(r => r.__idx));
    aiSelected = belowThreshold.filter(r => topIdx.has(r.__idx)).map(r => ({
      ...r,
      select_reason: `AI risk rank (score ${riskScores.find(s => s.__idx === r.__idx)?.risk_score})`,
    }));
  }

  // Residual pool = below threshold AND not AI-selected.
  const aiSelectedIdx = new Set(aiSelected.map(r => r.__idx));
  const residualPool = belowThreshold.filter(r => !aiSelectedIdx.has(r.__idx));

  // Layer 3: residual sampling.
  let residualSelected: any[] = [];
  if (residualMethod !== 'none' && residualSize > 0 && residualPool.length > 0) {
    const n = Math.min(residualSize, residualPool.length);
    if (residualMethod === 'mus') {
      // Monetary-unit: cumulative sum, pick at regular intervals.
      const totals = residualPool.map(r => Math.max(0, Number(r.amount) || 0));
      const total = totals.reduce((s, v) => s + v, 0);
      if (total > 0) {
        const step = total / n;
        const picks = new Set<number>();
        let cum = 0;
        let target = step / 2;
        for (let i = 0; i < residualPool.length && picks.size < n; i++) {
          cum += totals[i];
          while (cum >= target && picks.size < n) {
            picks.add(i);
            target += step;
          }
        }
        residualSelected = [...picks].map(i => ({ ...residualPool[i], select_reason: 'MUS sampling' }));
      }
    } else if (residualMethod === 'stratified') {
      // Stratify by amount tertile; pick proportionally.
      const sorted = [...residualPool].sort((a, b) => (Number(a.amount) || 0) - (Number(b.amount) || 0));
      const third = Math.floor(sorted.length / 3);
      const strata = [sorted.slice(0, third), sorted.slice(third, 2 * third), sorted.slice(2 * third)];
      const each = Math.max(1, Math.floor(n / 3));
      for (const s of strata) {
        const pick = s.slice(0, each);
        residualSelected.push(...pick.map(r => ({ ...r, select_reason: 'Stratified sampling' })));
      }
    } else if (residualMethod === 'haphazard') {
      // Deterministic shuffle (rotate by amount hash) so replays match.
      const shuffled = [...residualPool].sort((a, b) => (Number(a.amount) || 0) - (Number(b.amount) || 0));
      const spacing = Math.max(1, Math.floor(shuffled.length / n));
      for (let i = 0; i < shuffled.length && residualSelected.length < n; i += spacing) {
        residualSelected.push({ ...shuffled[i], select_reason: 'Haphazard sampling' });
      }
    }
  }

  // Merge, dedupe by __idx, and strip the helper index.
  const mergedMap = new Map<number, any>();
  for (const r of [...above, ...aiSelected, ...residualSelected]) {
    if (!mergedMap.has(r.__idx)) mergedMap.set(r.__idx, r);
  }
  const merged = [...mergedMap.values()].map(r => {
    const { __idx, ...rest } = r;
    return { ...rest, sample_id: `pymt_${__idx}` };
  });

  return {
    action: 'continue',
    outputs: {
      sample_items: merged,
      data_table: merged,
      sample_size: merged.length,
      above_threshold_count: above.length,
      ai_selected_count: aiSelected.length,
      residual_selected_count: residualSelected.length,
      risk_scores: riskScores.slice(0, 50), // cap output for UI readability
    },
  };
}

/**
 * Parse a creditors/accruals listing out of a portal request for
 * per-supplier match lookup during verification. Reuses the listing
 * parser from the Accruals handler.
 */
async function loadCreditorsLookup(portalRequestId: string | null | undefined): Promise<Array<Record<string, any>>> {
  if (!portalRequestId) return [];
  try {
    return await parseListingFromPortalUploads(portalRequestId);
  } catch {
    return [];
  }
}

async function handleVerifyUnrecordedLiabilitiesSample(ctx: ActionHandlerContext): Promise<ActionHandlerResult> {
  const { executionId, stepIndex, inputs } = ctx;

  const samples: Array<Record<string, any>> = Array.isArray(inputs.sample_items) ? inputs.sample_items : [];
  const evidence: Array<Record<string, any>> = Array.isArray(inputs.extracted_evidence) ? inputs.extracted_evidence : [];
  if (samples.length === 0) {
    return { action: 'error', outputs: {}, errorMessage: 'No sample items to verify.' };
  }
  const periodEnd = inputs.period_end ? new Date(inputs.period_end) : null;
  if (!periodEnd || Number.isNaN(periodEnd.getTime())) {
    return { action: 'error', outputs: {}, errorMessage: 'Period end not resolved.' };
  }
  const amountTol = Math.max(0, Number(inputs.amount_tolerance_gbp || 1));

  const creditors = await loadCreditorsLookup(inputs.creditors_portal_request_id);

  const norm = (s: any) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const parseDate = (s: any): Date | null => {
    if (!s) return null;
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  };

  interface MarkerRow {
    sample_item_ref: string;
    sample_payee: string | null;
    sample_description: string | null;
    sample_amount: number | null;
    sample_date: string | null;
    colour: 'red' | 'orange' | 'green';
    marker_type: string;
    reason: string;
    calc: Record<string, any>;
  }
  const markers: MarkerRow[] = [];

  for (const s of samples) {
    const ref = String(s.sample_id ?? s.id ?? JSON.stringify(s).slice(0, 32));
    const payee = s.payee ?? s.counterparty ?? null;
    const amount = s.amount != null ? Number(s.amount) : null;
    const paymentDate = parseDate(s.date ?? s.payment_date);
    const narrative = s.narrative ?? s.description ?? null;

    // (a) Match extracted evidence by payee + amount.
    const matched = evidence.map(e => {
      const sP = norm(payee);
      const eP = norm(e.supplier ?? e.payee);
      const supplierHit = sP && eP && (sP.includes(eP) || eP.includes(sP));
      const amt = e.amount != null ? Number(e.amount) : null;
      const amtDiff = amount != null && amt != null ? Math.abs(amt - amount) : null;
      let score = 0;
      if (supplierHit) score += 2;
      if (amtDiff != null && amtDiff <= amountTol) score += 2;
      else if (amount != null && amtDiff != null && amount !== 0 && amtDiff / Math.abs(amount) <= 0.10) score += 1;
      return { e, score, amtDiff };
    }).sort((a, b) => b.score - a.score);

    const bestEvidence = matched.length > 0 && matched[0].score >= 2 ? matched[0].e : null;

    // If we can't match any evidence we can't assess obligation — Orange.
    if (!bestEvidence) {
      markers.push({
        sample_item_ref: ref,
        sample_payee: payee ?? null,
        sample_description: narrative ?? null,
        sample_amount: amount ?? null,
        sample_date: paymentDate ? paymentDate.toISOString().slice(0, 10) : null,
        colour: 'orange',
        marker_type: 'Support Missing',
        reason: 'No supporting invoice / remittance was matched to this bank payment — obligation period cannot be assessed.',
        calc: { matched_score: matched[0]?.score ?? 0 },
      });
      continue;
    }

    // (b) Classify obligation. Prefer evidence service period end;
    //     fall back to invoice date; last resort: the bank payment date.
    const serviceStart = parseDate(bestEvidence.service_period_start);
    const serviceEnd = parseDate(bestEvidence.service_period_end);
    const invoiceDate = parseDate(bestEvidence.invoice_date);
    const obligationDate: Date | null = serviceEnd || invoiceDate || paymentDate || null;
    if (!obligationDate) {
      markers.push({
        sample_item_ref: ref,
        sample_payee: payee ?? null,
        sample_description: narrative ?? null,
        sample_amount: amount ?? null,
        // paymentDate is also null in this branch (all three date sources
        // were falsy, which is how obligationDate reached null).
        sample_date: null,
        colour: 'orange',
        marker_type: 'Support Missing',
        reason: 'Matched evidence lacks any usable date to classify the obligation period.',
        calc: { matched_document: bestEvidence.file_name },
      });
      continue;
    }

    // Post-YE obligation → payment correctly outside the audited year → Green.
    if (obligationDate > periodEnd) {
      markers.push({
        sample_item_ref: ref,
        sample_payee: payee ?? null,
        sample_description: narrative ?? null,
        sample_amount: amount ?? null,
        sample_date: paymentDate ? paymentDate.toISOString().slice(0, 10) : null,
        colour: 'green',
        marker_type: 'Post-YE Obligation',
        reason: `Obligation date ${obligationDate.toISOString().slice(0, 10)} is after period end — payment relates to the post-year-end period, not the audited year.`,
        calc: {
          matched_document: bestEvidence.file_name,
          obligation_date: obligationDate.toISOString().slice(0, 10),
          period_end: periodEnd.toISOString().slice(0, 10),
        },
      });
      continue;
    }

    // (c) Obligation ≤ YE. Check creditors/accruals listing for a match.
    const creditorHit = creditors.find(c => {
      const sP = norm(payee);
      const cP = norm(c.supplier ?? c.payee ?? c.counterparty);
      const supplierHit = sP && cP && (sP.includes(cP) || cP.includes(sP));
      if (!supplierHit) return false;
      const cAmt = Number(c.amount ?? c.accrual ?? c.value ?? 0);
      if (amount == null) return true;
      return Math.abs(cAmt - amount) <= Math.max(amountTol, Math.abs(amount) * 0.10);
    });

    if (!creditorHit) {
      // Detect spread *before* finalising Red so we surface Orange where
      // only part of the obligation was pre-YE.
      const spansYe = !!(serviceStart && serviceEnd && serviceStart < periodEnd && serviceEnd > periodEnd);
      if (spansYe && amount != null && serviceStart && serviceEnd) {
        const totalDays = Math.max(1, Math.round((serviceEnd.getTime() - serviceStart.getTime()) / 86_400_000) + 1);
        const preEndMs = Math.min(periodEnd.getTime(), serviceEnd.getTime());
        const preDays = Math.max(0, Math.round((preEndMs - serviceStart.getTime()) / 86_400_000) + 1);
        const preYePortion = Math.round((amount * (preDays / totalDays)) * 100) / 100;

        // Match the apportioned pre-YE portion against creditors.
        const apportionedHit = creditors.find(c => {
          const sP = norm(payee);
          const cP = norm(c.supplier ?? c.payee ?? c.counterparty);
          const supplierHit = sP && cP && (sP.includes(cP) || cP.includes(sP));
          if (!supplierHit) return false;
          const cAmt = Number(c.amount ?? c.accrual ?? c.value ?? 0);
          return Math.abs(cAmt - preYePortion) <= amountTol;
        });
        if (apportionedHit) {
          markers.push({
            sample_item_ref: ref,
            sample_payee: payee ?? null,
            sample_description: narrative ?? null,
            sample_amount: amount,
            sample_date: paymentDate ? paymentDate.toISOString().slice(0, 10) : null,
            colour: 'green',
            marker_type: 'Apportionment OK',
            reason: `Service period spans YE; apportioned ≤-YE portion ${preYePortion} agrees to recorded creditor within tolerance.`,
            calc: { service_start: serviceStart.toISOString().slice(0, 10), service_end: serviceEnd.toISOString().slice(0, 10), total_days: totalDays, pre_ye_days: preDays, pre_ye_portion: preYePortion, creditor_amount: apportionedHit.amount ?? apportionedHit.accrual ?? null },
          });
          continue;
        }
        markers.push({
          sample_item_ref: ref,
          sample_payee: payee ?? null,
          sample_description: narrative ?? null,
          sample_amount: amount,
          sample_date: paymentDate ? paymentDate.toISOString().slice(0, 10) : null,
          colour: 'orange',
          marker_type: 'Spread',
          reason: `Service period spans YE. Time apportionment gives ≤-YE portion of ${preYePortion} but no matching creditor/accrual found.`,
          calc: { service_start: serviceStart.toISOString().slice(0, 10), service_end: serviceEnd.toISOString().slice(0, 10), total_days: totalDays, pre_ye_days: preDays, pre_ye_portion: preYePortion },
        });
        continue;
      }

      markers.push({
        sample_item_ref: ref,
        sample_payee: payee ?? null,
        sample_description: narrative ?? null,
        sample_amount: amount ?? null,
        sample_date: paymentDate ? paymentDate.toISOString().slice(0, 10) : null,
        colour: 'red',
        marker_type: 'Unrecorded Liability',
        reason: `Obligation date ${obligationDate.toISOString().slice(0, 10)} is ≤ period end but no matching creditor or accrual was found in the client-provided listing.`,
        calc: {
          matched_document: bestEvidence.file_name,
          obligation_date: obligationDate.toISOString().slice(0, 10),
          period_end: periodEnd.toISOString().slice(0, 10),
          sample_amount: amount,
        },
      });
      continue;
    }

    // (d) Creditor found for a ≤-YE obligation. Test whether service spans YE.
    const spansYe = !!(serviceStart && serviceEnd && serviceStart < periodEnd && serviceEnd > periodEnd);
    if (!spansYe) {
      markers.push({
        sample_item_ref: ref,
        sample_payee: payee ?? null,
        sample_description: narrative ?? null,
        sample_amount: amount ?? null,
        sample_date: paymentDate ? paymentDate.toISOString().slice(0, 10) : null,
        colour: 'green',
        marker_type: 'In TB',
        reason: 'Obligation ≤ period end and a matching creditor/accrual was found in the client listing within tolerance.',
        calc: {
          matched_document: bestEvidence.file_name,
          creditor_amount: creditorHit.amount ?? creditorHit.accrual ?? null,
          sample_amount: amount,
        },
      });
      continue;
    }

    // Spread + creditor found — apportion and re-test.
    if (amount == null || !serviceStart || !serviceEnd) {
      markers.push({
        sample_item_ref: ref,
        sample_payee: payee ?? null,
        sample_description: narrative ?? null,
        sample_amount: amount ?? null,
        sample_date: paymentDate ? paymentDate.toISOString().slice(0, 10) : null,
        colour: 'orange',
        marker_type: 'Spread',
        reason: 'Service period spans YE but data insufficient for apportionment.',
        calc: {},
      });
      continue;
    }
    const totalDays = Math.max(1, Math.round((serviceEnd.getTime() - serviceStart.getTime()) / 86_400_000) + 1);
    const preEndMs = Math.min(periodEnd.getTime(), serviceEnd.getTime());
    const preDays = Math.max(0, Math.round((preEndMs - serviceStart.getTime()) / 86_400_000) + 1);
    const preYePortion = Math.round((amount * (preDays / totalDays)) * 100) / 100;
    const creditorAmt = Number(creditorHit.amount ?? creditorHit.accrual ?? creditorHit.value ?? 0);
    const variance = Math.round((creditorAmt - preYePortion) * 100) / 100;
    const withinTol = Math.abs(variance) <= amountTol;

    markers.push({
      sample_item_ref: ref,
      sample_payee: payee ?? null,
      sample_description: narrative ?? null,
      sample_amount: amount,
      sample_date: paymentDate ? paymentDate.toISOString().slice(0, 10) : null,
      colour: withinTol ? 'green' : 'red',
      marker_type: withinTol ? 'Apportionment OK' : 'Apportionment Mismatch',
      reason: withinTol
        ? `Service period spans YE. Apportioned ≤-YE portion ${preYePortion} agrees to recorded creditor ${creditorAmt} within tolerance.`
        : `Service period spans YE. Apportioned ≤-YE portion ${preYePortion} differs from recorded creditor ${creditorAmt} by ${variance}.`,
      calc: {
        service_start: serviceStart.toISOString().slice(0, 10),
        service_end: serviceEnd.toISOString().slice(0, 10),
        total_days: totalDays,
        pre_ye_days: preDays,
        pre_ye_portion: preYePortion,
        creditor_amount: creditorAmt,
        variance,
      },
    });
  }

  // Persist markers (same upsert pattern as the accruals handler).
  await Promise.all(markers.map(m =>
    prisma.sampleItemMarker.upsert({
      where: {
        executionId_stepIndex_sampleItemRef: {
          executionId,
          stepIndex,
          sampleItemRef: m.sample_item_ref,
        },
      },
      update: {
        colour: m.colour,
        reason: m.reason,
        markerType: m.marker_type,
        calcJson: m.calc as any,
        overriddenBy: null,
        overriddenByName: null,
        overriddenAt: null,
        overrideReason: null,
        originalColour: null,
      },
      create: {
        executionId,
        stepIndex,
        sampleItemRef: m.sample_item_ref,
        colour: m.colour,
        reason: m.reason,
        markerType: m.marker_type,
        calcJson: m.calc as any,
      },
    }),
  ));

  const red = markers.filter(m => m.colour === 'red');
  const orange = markers.filter(m => m.colour === 'orange');
  const green = markers.filter(m => m.colour === 'green');

  return {
    action: 'continue',
    outputs: {
      markers,
      data_table: markers,
      red_count: red.length,
      orange_count: orange.length,
      green_count: green.length,
      findings: red.map(m => ({
        sample_item_ref: m.sample_item_ref,
        date: m.sample_date,
        description: `${m.sample_payee || ''} — ${m.sample_description || ''}`.trim(),
        amount: m.sample_amount,
        marker_type: m.marker_type,
        reason: m.reason,
      })),
      pass_fail: red.length === 0 ? (orange.length === 0 ? 'pass' : 'review') : 'fail',
    },
  };
}

// ─── Gross Margin Analytical Review Handlers ───────────────────────────────

interface GmPeriodRow {
  period_label: string;
  period_type: 'current' | 'prior' | 'prior_minus_1' | 'prior_minus_2' | 'budget' | 'benchmark' | 'other';
  revenue: number;
  cost_of_sales: number;
  gross_profit: number;
  gm_pct: number | null;   // null when revenue = 0
  source: 'client' | 'tb' | 'benchmark';
}

/**
 * Pick a numeric value from a row where the column name may vary.
 * Accepts several tolerant keys (case/space/punctuation insensitive).
 */
function pickNumber(row: Record<string, any>, ...patterns: RegExp[]): number {
  const key = Object.keys(row).find(k => patterns.some(p => p.test(k.toLowerCase().replace(/[\s_-]/g, ''))));
  if (!key) return 0;
  const v = Number(row[key]);
  return Number.isFinite(v) ? v : 0;
}

/**
 * Parse a returned P&L listing into one row per period. The client is
 * expected to provide an Excel/CSV with either:
 *   - one row per period (columns: period, revenue, cost_of_sales), OR
 *   - one row per category with period columns (Revenue_CY, COS_CY, Revenue_PY, etc.)
 * We probe both shapes. Anything else is surfaced to the auditor as a
 * parsing error rather than silently dropped.
 */
function parseGmRows(rows: Array<Record<string, any>>): GmPeriodRow[] {
  if (!Array.isArray(rows) || rows.length === 0) return [];

  // Shape A: one row per period.
  const hasPeriodColumn = rows.some(r => Object.keys(r).some(k => /period|year|fy/i.test(k)));
  const hasRevenueRow = rows.some(r => Object.keys(r).some(k => /revenue|sales/i.test(k)));
  if (hasPeriodColumn && hasRevenueRow) {
    const out: GmPeriodRow[] = [];
    for (const r of rows) {
      const label = String(
        Object.values(r).find((v, i) => /period|year|fy/i.test(Object.keys(r)[i])) ?? Object.values(r)[0] ?? 'Period',
      );
      const revenue = pickNumber(r, /^revenue$/, /^sales$/, /turnover/);
      const cos = pickNumber(r, /costofsales/, /^cos$/, /^cogs$/, /costofgoods/);
      if (!revenue && !cos) continue;
      const gp = revenue - cos;
      const gm = revenue !== 0 ? Math.round((gp / revenue) * 10000) / 100 : null;
      const lc = label.toLowerCase();
      const periodType: GmPeriodRow['period_type'] =
        /budget|forecast/.test(lc) ? 'budget'
        : /benchmark|industry/.test(lc) ? 'benchmark'
        : /current|cy|this/.test(lc) ? 'current'
        : /prior|py|previous/.test(lc) ? 'prior'
        : 'other';
      out.push({
        period_label: label,
        period_type: periodType,
        revenue,
        cost_of_sales: cos,
        gross_profit: gp,
        gm_pct: gm,
        source: periodType === 'benchmark' ? 'benchmark' : 'client',
      });
    }
    return out;
  }

  // Shape B: columns per period. Look for "_CY" / "_PY" / "_Budget" suffixes.
  const first = rows[0];
  const cyRev = pickNumber(rows.reduce((s, r) => { if (/revenue|sales/i.test(Object.keys(r)[0] || '')) return r; return s; }, first), /revenuecy/, /salescy/, /^revenue$/);
  // This shape is complicated in practice — fall back to empty if we can't
  // confidently interpret, rather than emit bad numbers. The auditor will
  // re-upload in Shape A.
  if (cyRev === 0) return [];
  return [];
}

/**
 * Best-effort "agrees to TB" check for the current-year figures returned
 * by the client. We sum all TB rows on the engagement whose fsLine name
 * is "Revenue" / "Sales" / "Turnover" and whose mirror for COS, then
 * compare magnitudes to the submitted CY revenue / CY COS. Within 1%
 * tolerance = reconciled.
 */
async function reconcileGmToTB(engagementId: string, cyRow: GmPeriodRow | undefined): Promise<'pass' | 'fail' | 'unknown'> {
  if (!cyRow) return 'unknown';
  const tbRows = await prisma.auditTBRow.findMany({
    where: { engagementId },
    include: { canonicalFsLine: { select: { name: true } } },
  });
  if (tbRows.length === 0) return 'unknown';

  let tbRevenue = 0;
  let tbCos = 0;
  for (const r of tbRows) {
    const fs = r.canonicalFsLine?.name?.toLowerCase() || '';
    const v = Number(r.currentYear || 0);
    if (/revenue|sales|turnover/.test(fs)) tbRevenue += v;
    else if (/cost.*sales|cost.*goods|cogs/.test(fs)) tbCos += v;
  }
  // TB stores revenue as negatives (credits); take magnitudes to compare.
  const revTb = Math.abs(tbRevenue);
  const cosTb = Math.abs(tbCos);
  if (revTb === 0 && cosTb === 0) return 'unknown';

  const revVariance = revTb === 0 ? 0 : Math.abs(cyRow.revenue - revTb) / revTb;
  const cosVariance = cosTb === 0 ? 0 : Math.abs(cyRow.cost_of_sales - cosTb) / cosTb;
  const tol = 0.01;
  return revVariance <= tol && cosVariance <= tol ? 'pass' : 'fail';
}

async function handleRequestGmData(ctx: ActionHandlerContext): Promise<ActionHandlerResult> {
  const { engagementId, executionId, stepIndex, pipelineState, inputs, config } = ctx;
  const stepState = pipelineState[stepIndex] || {};
  const phase: string = stepState.phase || 'new';

  try {
    if (phase === 'new') {
      const engagement = await prisma.auditEngagement.findUnique({
        where: { id: engagementId },
        select: { clientId: true },
      });
      if (!engagement) return { action: 'error', outputs: {}, errorMessage: 'Engagement not found' };
      const requestingUser = await prisma.user.findUnique({
        where: { id: config.userId },
        select: { name: true, email: true },
      });
      const portalRequest = await prisma.portalRequest.create({
        data: {
          clientId: engagement.clientId,
          engagementId,
          section: 'evidence',
          question: inputs.message_to_client || 'Please provide revenue and cost of sales breakdowns for the current and comparison periods, budget figures, and any prepared explanations for significant GM movements.',
          status: 'outstanding',
          requestedById: config.userId,
          requestedByName: requestingUser?.name || requestingUser?.email || 'Audit Team',
          evidenceTag: 'gm_analytical_review',
        },
      });
      await prisma.outstandingItem.create({
        data: {
          engagementId,
          executionId,
          type: 'portal_request',
          title: 'Gross Margin AR — data request',
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
        outputs: { phase: 'awaiting_data', portal_request_id: portalRequest.id, repeatOnResume: true },
        pauseReason: 'portal_response',
        pauseRefId: portalRequest.id,
      };
    }

    if (phase === 'data_received') {
      const portalRequestId = stepState.portal_request_id as string | undefined;
      if (!portalRequestId) {
        return { action: 'error', outputs: {}, errorMessage: 'No portal request id on step state' };
      }

      const rawRows = await parseListingFromPortalUploads(portalRequestId);
      const gmRows = parseGmRows(rawRows);
      if (gmRows.length === 0) {
        return {
          action: 'pause',
          outputs: {
            phase: 'awaiting_data',
            portal_request_id: portalRequestId,
            parse_error: 'Could not parse a period-by-period P&L from the uploaded file. Please provide an Excel / CSV with one row per period (columns: period, revenue, cost_of_sales).',
            repeatOnResume: true,
          },
          pauseReason: 'portal_response',
          pauseRefId: portalRequestId,
        };
      }

      // Find CY and reconcile to TB. CY takes the row labelled current,
      // otherwise the row whose period_label contains the engagement's
      // period-end year.
      const engagement = await prisma.auditEngagement.findUnique({
        where: { id: engagementId },
        include: { period: { select: { periodEnd: true } } as any } as any,
      }) as any;
      const periodEnd: Date | null = engagement?.period?.periodEnd || null;
      const yearStr = periodEnd ? String(periodEnd.getFullYear()) : '';
      const cyRow = gmRows.find(r => r.period_type === 'current')
        || gmRows.find(r => yearStr && r.period_label.includes(yearStr))
        || gmRows[0];
      const tbReconciled = await reconcileGmToTB(engagementId, cyRow);

      if (tbReconciled === 'fail') {
        await prisma.outstandingItem.create({
          data: {
            engagementId,
            executionId,
            type: 'portal_request',
            title: 'GM analytical review — CY P&L does not agree to TB',
            description: 'The revenue and cost-of-sales figures returned do not reconcile (within 1%) to the TB revenue/COS account totals. Please confirm the figures or identify the reconciling items.',
            source: 'flow',
            assignedTo: 'client',
            status: 'awaiting_client',
            fsLine: config.fsLine,
            testName: config.testDescription,
            portalRequestId,
          },
        });
        return {
          action: 'pause',
          outputs: {
            phase: 'awaiting_data',
            portal_request_id: portalRequestId,
            data_table: gmRows,
            tb_reconciled: 'fail',
            repeatOnResume: true,
          },
          pauseReason: 'portal_response',
          pauseRefId: portalRequestId,
        };
      }

      // Optionally pull management commentary from the portal request's chat
      // history. We treat the most recent non-empty message that isn't a
      // file upload pointer as the commentary.
      let commentary = '';
      try {
        const pr = await prisma.portalRequest.findUnique({
          where: { id: portalRequestId },
          select: { chatHistory: true },
        });
        const messages: any[] = Array.isArray(pr?.chatHistory) ? (pr!.chatHistory as any[]) : [];
        const clientMsgs = messages.filter(m => typeof m?.text === 'string' && m.text.trim().length > 0 && m.from !== 'team');
        if (clientMsgs.length > 0) commentary = String(clientMsgs[clientMsgs.length - 1].text);
      } catch {}

      return {
        action: 'continue',
        outputs: {
          data_table: gmRows,
          management_commentary: commentary,
          tb_reconciled: tbReconciled === 'pass' ? 'pass' : 'unknown',
          portal_request_id: portalRequestId,
        },
      };
    }

    return { action: 'error', outputs: {}, errorMessage: `Unknown phase: ${phase}` };
  } catch (err: any) {
    console.error('[request_gm_data] handler error:', err);
    return { action: 'error', outputs: {}, errorMessage: err?.message || 'GM data handler failed' };
  }
}

async function handleComputeGmAnalysis(ctx: ActionHandlerContext): Promise<ActionHandlerResult> {
  const { engagementId, inputs } = ctx;

  const rows: GmPeriodRow[] = Array.isArray(inputs.data_table) ? (inputs.data_table as GmPeriodRow[]) : [];
  if (rows.length === 0) {
    return { action: 'error', outputs: {}, errorMessage: 'No P&L rows available for the GM analysis.' };
  }

  // Resolve performance materiality once — used for the PM-linked tolerance.
  // AuditMateriality stores its full Appendix E in a JSON blob; pull the
  // performanceMateriality value if present.
  let pm = 0;
  try {
    const mat = await prisma.auditMateriality.findUnique({ where: { engagementId } as any, select: { data: true } as any }) as any;
    if (mat?.data && typeof mat.data === 'object') {
      const d: any = mat.data;
      pm = Number(d.performanceMateriality ?? d.pm ?? d.benchmarks?.performanceMateriality ?? 0) || 0;
    }
  } catch {}

  const tolPct = Math.max(0, Number(inputs.tolerance_pct || 2));
  const tolPmMult = Math.max(0, Number(inputs.tolerance_pm_multiple || 1));
  const tolAmount = pm * tolPmMult;

  const cy = rows.find(r => r.period_type === 'current') || rows[0];
  const priors = rows.filter(r => r.period_type === 'prior' || r.period_type === 'prior_minus_1' || r.period_type === 'prior_minus_2');
  const budget = rows.find(r => r.period_type === 'budget');
  const benchmark = rows.find(r => r.period_type === 'benchmark');

  // Expected GM% based on the selected model.
  const model = String(inputs.expectation_model || 'consistency_py');
  let expectedGmPct: number | null = null;
  let expectedLabel = '';
  if (model === 'consistency_py') {
    const prior = priors[0];
    if (prior?.gm_pct != null) { expectedGmPct = prior.gm_pct; expectedLabel = `Prior (${prior.period_label}) GM %`; }
  } else if (model === 'consistency_avg') {
    const pcts = priors.map(p => p.gm_pct).filter((v): v is number => v != null);
    if (pcts.length > 0) {
      expectedGmPct = Math.round((pcts.reduce((s, v) => s + v, 0) / pcts.length) * 100) / 100;
      expectedLabel = `Average of ${pcts.length} prior period(s)`;
    }
  } else if (model === 'budget') {
    if (budget?.gm_pct != null) { expectedGmPct = budget.gm_pct; expectedLabel = `Budget GM %`; }
  } else if (model === 'reasonableness') {
    // Apply prior-year margin to current revenue to derive expected GP, then
    // divide by current revenue to express as %. Same number as PY GM% but
    // the ££ impact is what matters for the tolerance check.
    const prior = priors[0];
    if (prior && prior.gm_pct != null) {
      expectedGmPct = prior.gm_pct;
      expectedLabel = `Reasonableness (PY GM % applied to CY revenue)`;
    }
  }

  const actualGmPct = cy.gm_pct;

  // Build the variance table. Always include a row for each comparison
  // period that exists, plus a headline "actual vs expected" row.
  interface VarianceRow {
    variance_ref: string;
    comparison_label: string;
    expected_gm_pct: number | null;
    actual_gm_pct: number | null;
    variance_pct: number | null;    // percentage-point delta
    variance_amount: number;        // £ impact on profit using CY revenue
    flagged: boolean;
    flag_reason: string | null;
    status: 'amber' | 'pending';
  }
  const variances: VarianceRow[] = [];

  function makeVariance(label: string, expected: number | null): VarianceRow {
    const vPct = expected != null && actualGmPct != null ? Math.round((actualGmPct - expected) * 100) / 100 : null;
    const vAmount = expected != null && actualGmPct != null
      ? Math.round(((actualGmPct - expected) / 100) * cy.revenue)
      : 0;
    const flaggedPct = vPct != null && Math.abs(vPct) > tolPct;
    const flaggedAmt = tolAmount > 0 && Math.abs(vAmount) > tolAmount;
    const flagged = flaggedPct || flaggedAmt;
    const reasons: string[] = [];
    if (flaggedPct) reasons.push(`GM% movement ${vPct}pp exceeds tolerance of ${tolPct}pp`);
    if (flaggedAmt) reasons.push(`£ impact ${vAmount} exceeds ${tolPmMult}× PM (${tolAmount})`);
    return {
      variance_ref: `var_${variances.length}`,
      comparison_label: label,
      expected_gm_pct: expected,
      actual_gm_pct: actualGmPct,
      variance_pct: vPct,
      variance_amount: vAmount,
      flagged,
      flag_reason: flagged ? reasons.join('; ') : null,
      status: flagged ? 'amber' : 'pending',
    };
  }

  // Headline: actual vs the expectation from the model.
  if (expectedGmPct != null) {
    variances.push(makeVariance(`Actual vs ${expectedLabel}`, expectedGmPct));
  }
  // Each comparison period gets its own variance row for transparency.
  for (const p of priors) variances.push(makeVariance(`Actual vs ${p.period_label}`, p.gm_pct));
  if (budget) variances.push(makeVariance(`Actual vs ${budget.period_label}`, budget.gm_pct));
  if (benchmark) variances.push(makeVariance(`Actual vs ${benchmark.period_label}`, benchmark.gm_pct));

  // Calculations table (for the Data & Sampling section).
  const calculations = rows.map(r => ({
    period_label: r.period_label,
    period_type: r.period_type,
    revenue: r.revenue,
    cost_of_sales: r.cost_of_sales,
    gross_profit: r.gross_profit,
    gm_pct: r.gm_pct,
    source: r.source,
  }));

  const flagged = variances.filter(v => v.flagged);

  return {
    action: 'continue',
    outputs: {
      calculations,
      variances,
      data_table: variances,
      expected_gm_pct: expectedGmPct,
      actual_gm_pct: actualGmPct,
      flagged_count: flagged.length,
      performance_materiality: pm,
    },
  };
}

async function handleRequestGmExplanations(ctx: ActionHandlerContext): Promise<ActionHandlerResult> {
  const { engagementId, executionId, stepIndex, pipelineState, inputs, config } = ctx;
  const stepState = pipelineState[stepIndex] || {};
  const phase: string = stepState.phase || 'new';

  // If there's nothing flagged we can skip straight past this step.
  const variances: any[] = Array.isArray(inputs.variances) ? inputs.variances : [];
  const flagged = variances.filter(v => v.flagged);

  if (phase === 'new' && flagged.length === 0) {
    return { action: 'continue', outputs: { explanations: [], portal_request_id: null } };
  }

  try {
    if (phase === 'new') {
      const engagement = await prisma.auditEngagement.findUnique({
        where: { id: engagementId },
        select: { clientId: true },
      });
      if (!engagement) return { action: 'error', outputs: {}, errorMessage: 'Engagement not found' };
      const requestingUser = await prisma.user.findUnique({
        where: { id: config.userId },
        select: { name: true, email: true },
      });
      const varianceSummary = flagged.map(v =>
        `- ${v.comparison_label}: actual ${v.actual_gm_pct}% vs expected ${v.expected_gm_pct}% (${v.variance_pct}pp, £${v.variance_amount})`,
      ).join('\n');
      const question = `${inputs.message_to_client || 'Please explain the following gross-margin variances:'}\n\n${varianceSummary}`;
      const portalRequest = await prisma.portalRequest.create({
        data: {
          clientId: engagement.clientId,
          engagementId,
          section: 'evidence',
          question,
          status: 'outstanding',
          requestedById: config.userId,
          requestedByName: requestingUser?.name || requestingUser?.email || 'Audit Team',
          evidenceTag: 'gm_variance_explanations',
        },
      });
      await prisma.outstandingItem.create({
        data: {
          engagementId,
          executionId,
          type: 'portal_request',
          title: `GM AR — ${flagged.length} variance explanation${flagged.length === 1 ? '' : 's'} requested`,
          description: varianceSummary,
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
        outputs: { phase: 'awaiting_explanations', portal_request_id: portalRequest.id, flagged_variances: flagged, repeatOnResume: true },
        pauseReason: 'portal_response',
        pauseRefId: portalRequest.id,
      };
    }

    if (phase === 'explanations_received') {
      const portalRequestId = stepState.portal_request_id as string | undefined;
      if (!portalRequestId) return { action: 'error', outputs: {}, errorMessage: 'No portal request id on step state' };

      // Pull the chat history + any attachments. We don't attempt to
      // align each message to a specific variance — the AI step reads the
      // full explanation blob and attributes it per variance.
      let explanationText = '';
      try {
        const pr = await prisma.portalRequest.findUnique({
          where: { id: portalRequestId },
          select: { chatHistory: true },
        });
        const messages: any[] = Array.isArray(pr?.chatHistory) ? (pr!.chatHistory as any[]) : [];
        explanationText = messages
          .filter(m => typeof m?.text === 'string' && m.text.trim().length > 0 && m.from !== 'team')
          .map(m => String(m.text))
          .join('\n\n');
      } catch {}
      const uploads = await prisma.portalUpload.findMany({
        where: { portalRequestId },
        select: { id: true, originalName: true, storagePath: true, containerName: true, mimeType: true },
      });

      // Emit one row per flagged variance with the full explanation blob
      // attached — the AI step reads it as context.
      const flaggedNow: any[] = Array.isArray(stepState.flagged_variances) ? stepState.flagged_variances : flagged;
      const explanations = flaggedNow.map(v => ({
        variance_ref: v.variance_ref,
        comparison_label: v.comparison_label,
        explanation_text: explanationText,
        attachments: uploads.map(u => ({ id: u.id, name: u.originalName, storagePath: u.storagePath, containerName: u.containerName, mimeType: u.mimeType })),
      }));

      return {
        action: 'continue',
        outputs: {
          portal_request_id: portalRequestId,
          explanations,
        },
      };
    }

    return { action: 'error', outputs: {}, errorMessage: `Unknown phase: ${phase}` };
  } catch (err: any) {
    console.error('[request_gm_explanations] handler error:', err);
    return { action: 'error', outputs: {}, errorMessage: err?.message || 'GM explanations handler failed' };
  }
}

/**
 * AI plausibility assessment. We call Llama 3.3 70B once with the full
 * variance table, calculations and explanation blob, asking for a JSON
 * verdict per variance. Each verdict becomes a SampleItemMarker so the
 * generic override / Error-vs-InTB resolution flow works identically to
 * the accruals pipeline.
 */
async function handleAssessGmExplanations(ctx: ActionHandlerContext): Promise<ActionHandlerResult> {
  const { executionId, stepIndex, inputs } = ctx;
  const variances: any[] = Array.isArray(inputs.variances) ? inputs.variances : [];
  const flagged = variances.filter(v => v.flagged);
  const explanations: any[] = Array.isArray(inputs.explanations) ? inputs.explanations : [];
  const calculations: any[] = Array.isArray(inputs.calculations) ? inputs.calculations : [];

  // Nothing flagged → green conclusion with a compact marker record so the
  // UI still renders a summary line rather than an empty section.
  if (flagged.length === 0) {
    return {
      action: 'continue',
      outputs: {
        markers: [],
        data_table: [],
        red_count: 0,
        orange_count: 0,
        green_count: 0,
        findings: [],
        additional_procedures_prompt: '',
        pass_fail: 'pass',
      },
    };
  }

  interface AiVerdict {
    variance_ref: string;
    colour: 'red' | 'orange' | 'green';
    reason: string;
    plausibility_notes: string;
    contradictions: string;
  }

  const OpenAI = (await import('openai')).default;
  const client = new OpenAI({
    apiKey: process.env.TOGETHER_API_KEY || '',
    baseURL: 'https://api.together.xyz/v1',
  });

  const context = {
    calculations,
    variances: flagged.map(v => ({
      variance_ref: v.variance_ref,
      comparison_label: v.comparison_label,
      expected_gm_pct: v.expected_gm_pct,
      actual_gm_pct: v.actual_gm_pct,
      variance_pct: v.variance_pct,
      variance_amount: v.variance_amount,
      flag_reason: v.flag_reason,
    })),
    explanations: explanations.map(e => ({
      variance_ref: e.variance_ref,
      explanation_text: e.explanation_text,
      attachment_names: Array.isArray(e.attachments) ? e.attachments.map((a: any) => a.name) : [],
    })),
  };

  const systemInstruction = `You are a statutory auditor evaluating management's explanations for gross-margin variances under ISA 520. For each variance you will:
  a) assess whether the explanation is consistent with known business activities, budgets, and prior period patterns;
  b) check whether the quantitative impacts described reconcile to the identified GM movement;
  c) flag any contradictory evidence within the financial data already extracted.

Return a JSON array with one object per variance_ref: { "variance_ref": "...", "colour": "green"|"orange"|"red", "reason": "...", "plausibility_notes": "...", "contradictions": "..." }.

Colour rules:
- "green" — explanation adequately explains and supports the variance.
- "orange" — explanation provided but is weak or only partially supported.
- "red" — variance not explained, or explanation is inconsistent with the evidence.

Return ONLY the JSON array, no prose, no markdown fences.`;

  let verdicts: AiVerdict[] = [];
  try {
    const response = await client.chat.completions.create({
      model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
      messages: [
        { role: 'system', content: systemInstruction },
        { role: 'user', content: JSON.stringify(context) },
      ],
      max_tokens: 2000,
      temperature: 0.1,
    });
    const text = response.choices[0]?.message?.content || '';
    const cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    const match = cleaned.match(/\[[\s\S]*\]/);
    const jsonText = match ? match[0] : cleaned;
    const parsed = JSON.parse(jsonText);
    if (Array.isArray(parsed)) verdicts = parsed;
  } catch (err: any) {
    console.warn('[assess_gm_explanations] AI call failed:', err?.message || err);
    // Fall back to Orange — explanation was received but we couldn't
    // complete the plausibility check server-side. Auditor resolves.
    verdicts = flagged.map(v => ({
      variance_ref: v.variance_ref,
      colour: 'orange' as const,
      reason: 'Explanation received but AI plausibility assessment could not be completed. Please review manually.',
      plausibility_notes: '',
      contradictions: '',
    }));
  }

  // Merge verdict by variance_ref; any variance the AI didn't rate falls
  // back to Orange (so nothing silently passes).
  const byRef: Record<string, AiVerdict> = {};
  for (const v of verdicts) if (v?.variance_ref) byRef[v.variance_ref] = v;

  interface MarkerRow {
    sample_item_ref: string;
    variance_label: string;
    variance_pct: number | null;
    variance_amount: number;
    colour: 'red' | 'orange' | 'green';
    marker_type: string;
    reason: string;
    calc: Record<string, any>;
  }
  const markers: MarkerRow[] = flagged.map(v => {
    const verdict: AiVerdict = byRef[v.variance_ref] || {
      variance_ref: v.variance_ref,
      colour: 'orange',
      reason: 'No explanation received for this variance.',
      plausibility_notes: '',
      contradictions: '',
    };
    const markerType = verdict.colour === 'green' ? 'Variance Explained'
      : verdict.colour === 'orange' ? 'Weak Explanation'
      : 'Unexplained Variance';
    return {
      sample_item_ref: v.variance_ref,
      variance_label: v.comparison_label,
      variance_pct: v.variance_pct,
      variance_amount: v.variance_amount,
      colour: verdict.colour,
      marker_type: markerType,
      reason: verdict.reason || v.flag_reason || 'No explanation received.',
      calc: {
        comparison_label: v.comparison_label,
        expected_gm_pct: v.expected_gm_pct,
        actual_gm_pct: v.actual_gm_pct,
        variance_pct: v.variance_pct,
        variance_amount: v.variance_amount,
        plausibility_notes: verdict.plausibility_notes,
        contradictions: verdict.contradictions,
      },
    };
  });

  // Persist markers.
  await Promise.all(markers.map(m =>
    prisma.sampleItemMarker.upsert({
      where: {
        executionId_stepIndex_sampleItemRef: {
          executionId,
          stepIndex,
          sampleItemRef: m.sample_item_ref,
        },
      },
      update: {
        colour: m.colour,
        reason: m.reason,
        markerType: m.marker_type,
        calcJson: m.calc as any,
        overriddenBy: null,
        overriddenByName: null,
        overriddenAt: null,
        overrideReason: null,
        originalColour: null,
      },
      create: {
        executionId,
        stepIndex,
        sampleItemRef: m.sample_item_ref,
        colour: m.colour,
        reason: m.reason,
        markerType: m.marker_type,
        calcJson: m.calc as any,
      },
    }),
  ));

  const red = markers.filter(m => m.colour === 'red');
  const orange = markers.filter(m => m.colour === 'orange');
  const green = markers.filter(m => m.colour === 'green');

  // Conclusion wording tuned to the declared analysis type.
  const analysisType = String(inputs.analysis_type || 'combination');
  const analysisPrefix =
    analysisType === 'trend' ? 'Trend analysis'
    : analysisType === 'ratio' ? 'Ratio analysis (gross margin %)'
    : analysisType === 'reasonableness' ? 'Reasonableness test'
    : 'Combined analytical review';

  const additionalProceduresPrompt = red.length > 0 || orange.length > 0
    ? `${analysisPrefix}: ${red.length} unexplained and ${orange.length} weakly-explained variance${orange.length === 1 ? '' : 's'} identified — analytical procedures alone do not provide sufficient appropriate audit evidence. Consider additional substantive test-of-details (see the test-of-details workflows for revenue / cost of sales).`
    : `${analysisPrefix}: all flagged variances adequately explained.`;

  return {
    action: 'continue',
    outputs: {
      markers,
      data_table: markers,
      red_count: red.length,
      orange_count: orange.length,
      green_count: green.length,
      findings: red.map(m => ({
        sample_item_ref: m.sample_item_ref,
        period: m.variance_label,
        gm_pct_movement: m.variance_pct,
        amount_impact: m.variance_amount,
        summary: m.reason,
      })),
      additional_procedures_prompt: additionalProceduresPrompt,
      pass_fail: red.length === 0 ? (orange.length === 0 ? 'pass' : 'review') : 'fail',
    },
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
