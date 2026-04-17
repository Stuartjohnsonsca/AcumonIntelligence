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
