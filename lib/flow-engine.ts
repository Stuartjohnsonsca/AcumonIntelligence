/**
 * Flow Execution Engine
 *
 * Step-at-a-time state machine that processes one node per invocation,
 * saves state to DB between steps, and pauses for external events.
 * Designed for Vercel serverless (max 60s per invocation).
 */

import { prisma } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { resolveTemplate, resolveInputs, type ExecutionContext } from './flow-template';
import { parsePortalResponseFiles } from './flow-file-parser';
import { getTransactions as xeroGetTransactions, type XeroTransaction } from './xero';
import OpenAI from 'openai';

// ─── Types ───

interface FlowNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: Record<string, any>;
}

interface FlowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  label?: string;
}

interface FlowData {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

interface NodeResult {
  action: 'continue' | 'pause' | 'complete' | 'error';
  nextNodeId?: string;
  output?: any;
  pauseReason?: string;
  pauseRefId?: string;
  errorMessage?: string;
}

// ─── AI Client (reuse pattern from lib/assurance-ai.ts) ───

let _aiClient: OpenAI | null = null;

function summariseLoopItem(item: any): string {
  if (typeof item !== 'object') return String(item);
  const find = (...names: string[]): string => {
    for (const n of names) {
      const key = Object.keys(item).find(k => k.toLowerCase() === n.toLowerCase());
      if (key && item[key] != null && String(item[key]).trim()) return String(item[key]);
    }
    return '';
  };
  const parts: string[] = [];
  const customer = find('ContactName', 'Customer', 'ClientName', 'Name');
  const ref = find('InvoiceNumber', 'Invoice', 'Reference', 'Ref');
  const desc = find('Description', 'Desc', 'Narrative');
  const date = find('InvoiceDate', 'Date');
  const gross = find('Total', 'Gross', 'InvoiceAmountDue');
  const net = find('LineAmount', 'Net', 'UnitAmount');
  const tax = find('TaxTotal', 'TaxAmount', 'Tax');

  if (customer) parts.push(`Customer: ${customer}`);
  if (ref) parts.push(`Reference: ${ref}`);
  if (date) parts.push(`Date: ${date}`);
  if (desc) parts.push(`Description: ${desc}`);
  if (net) parts.push(`Net: £${Number(net).toLocaleString('en-GB', { minimumFractionDigits: 2 })}`);
  if (tax && Number(tax) !== 0) parts.push(`VAT: £${Number(tax).toLocaleString('en-GB', { minimumFractionDigits: 2 })}`);
  if (gross) parts.push(`Gross: £${Number(gross).toLocaleString('en-GB', { minimumFractionDigits: 2 })}`);

  return parts.join('\n');
}

function getAIClient(): OpenAI {
  const key = process.env.TOGETHER_DOC_SUMMARY_KEY || process.env.TOGETHER_API_KEY;
  if (!key) throw new Error('No Together AI key configured');
  if (!_aiClient) {
    _aiClient = new OpenAI({ apiKey: key, baseURL: 'https://api.together.xyz/v1' });
  }
  return _aiClient;
}

async function callAI(systemPrompt: string, userPrompt: string): Promise<{ text: string; tokensUsed: number; model: string }> {
  const model = 'meta-llama/Llama-3.3-70B-Instruct-Turbo';
  const client = getAIClient();
  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.3,
    max_tokens: 2000,
  });
  return {
    text: response.choices[0]?.message?.content || '',
    tokensUsed: response.usage?.total_tokens || 0,
    model,
  };
}

// ─── Context Builder ───

async function buildContext(
  engagementId: string,
  fsLine: string,
  testDescription: string,
  triggeringRow?: { accountCode: string; description: string; currentYear: number | null; priorYear: number | null; fsNote?: string | null },
): Promise<ExecutionContext> {
  const engagement = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    include: {
      client: true,
      period: true,
      materiality: true,
      tbRows: { where: { fsLevel: fsLine } },
    },
  });

  if (!engagement) throw new Error(`Engagement ${engagementId} not found`);

  const matData = engagement.materiality?.data as any || {};
  const tbRows = engagement.tbRows;

  // Calculate TB totals for this FS line
  const tbCurrentYear = tbRows.reduce((s, r) => s + (r.currentYear || 0), 0);
  const tbPriorYear = tbRows.reduce((s, r) => s + (r.priorYear || 0), 0);
  const tbVariance = tbCurrentYear - tbPriorYear;

  // Get all unique account codes and descriptions
  const tbAccounts = tbRows.map(r => ({
    code: r.accountCode,
    description: r.description,
    currentYear: r.currentYear || 0,
    priorYear: r.priorYear || 0,
  }));

  return {
    engagement: {
      clientName: engagement.client.clientName,
      periodStart: engagement.period.startDate.toISOString().split('T')[0],
      periodEnd: engagement.period.endDate.toISOString().split('T')[0],
      materiality: matData.overallMateriality || 0,
      performanceMateriality: matData.performanceMateriality || 0,
      clearlyTrivial: matData.clearlyTrivial || 0,
      framework: matData.framework || 'FRS102',
      auditType: engagement.auditType,
    },
    test: {
      description: testDescription,
      fsLine,
      assertion: '',
    },
    tb: {
      currentYear: tbCurrentYear,
      priorYear: tbPriorYear,
      variance: tbVariance,
      variancePct: tbPriorYear !== 0 ? ((tbVariance / Math.abs(tbPriorYear)) * 100) : 0,
      accountCount: tbRows.length,
      accounts: tbAccounts,
      // Triggering row's account (from the specific row clicked in Audit Plan)
      accountCode: triggeringRow?.accountCode || tbRows[0]?.accountCode || '',
      description: triggeringRow?.description || tbRows[0]?.description || '',
      // Triggering row specific amounts (if available)
      rowCurrentYear: triggeringRow?.currentYear ?? tbCurrentYear,
      rowPriorYear: triggeringRow?.priorYear ?? tbPriorYear,
      fsNote: triggeringRow?.fsNote || '',
    },
    nodes: {},
    vars: {
      tbBalance: tbCurrentYear,
      tbPriorYear,
      tbVariance,
      tbAccountCode: triggeringRow?.accountCode || tbRows[0]?.accountCode || '',
      tbDescription: triggeringRow?.description || tbRows[0]?.description || '',
      tbRowBalance: triggeringRow?.currentYear ?? tbCurrentYear,
    },
  };
}

// ─── Flow Navigation ───

function findNode(flow: FlowData, nodeId: string): FlowNode | undefined {
  return flow.nodes.find(n => n.id === nodeId);
}

function findStartNode(flow: FlowData): FlowNode | undefined {
  return flow.nodes.find(n => n.type === 'start');
}

function findOutgoingEdges(flow: FlowData, nodeId: string): FlowEdge[] {
  return flow.edges.filter(e => e.source === nodeId);
}

function findIncomingEdges(flow: FlowData, nodeId: string): FlowEdge[] {
  return flow.edges.filter(e => e.target === nodeId);
}

function getNextNodeId(flow: FlowData, nodeId: string, handleFilter?: string): string | undefined {
  const edges = findOutgoingEdges(flow, nodeId);
  if (handleFilter) {
    const edge = edges.find(e => e.sourceHandle === handleFilter);
    return edge?.target;
  }
  return edges[0]?.target;
}

function getPreviousNodeId(flow: FlowData, nodeId: string): string | undefined {
  const edges = findIncomingEdges(flow, nodeId);
  return edges[0]?.source;
}

// ─── Node Handlers ───

async function handleStart(flow: FlowData, node: FlowNode): Promise<NodeResult> {
  const nextId = getNextNodeId(flow, node.id);
  if (!nextId) return { action: 'error', errorMessage: 'Start node has no outgoing connection' };
  return { action: 'continue', nextNodeId: nextId, output: { started: true } };
}

async function handleEnd(): Promise<NodeResult> {
  return { action: 'complete', output: { completed: true } };
}

// ─── Date parser for accounting systems ───
function parseAccountingDate(raw: any): string {
  if (!raw) return '';
  const s = String(raw);
  // Xero .NET JSON date: /Date(1609459200000+0000)/
  const dotNetMatch = s.match(/\/Date\((\d+)([+-]\d+)?\)\//);
  if (dotNetMatch) {
    const d = new Date(parseInt(dotNetMatch[1], 10));
    if (!isNaN(d.getTime())) return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
  }
  // ISO 8601: 2026-03-15T00:00:00
  if (s.match(/^\d{4}-\d{2}-\d{2}/)) {
    const d = new Date(s);
    if (!isNaN(d.getTime())) return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
  }
  // DD/MM/YYYY or DD-MM-YYYY
  const ukMatch = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (ukMatch) return `${ukMatch[1].padStart(2, '0')}-${ukMatch[2].padStart(2, '0')}-${ukMatch[3]}`;
  // MM/DD/YYYY (US format) — try parsing
  const usMatch = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (usMatch) {
    const month = parseInt(usMatch[1], 10);
    if (month > 12) return `${usMatch[1].padStart(2, '0')}-${usMatch[2].padStart(2, '0')}-${usMatch[3]}`;
  }
  // Epoch milliseconds
  if (/^\d{13}$/.test(s)) {
    const d = new Date(parseInt(s, 10));
    if (!isNaN(d.getTime())) return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
  }
  // Epoch seconds
  if (/^\d{10}$/.test(s)) {
    const d = new Date(parseInt(s, 10) * 1000);
    if (!isNaN(d.getTime())) return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
  }
  // Last resort: try native Date parse
  const d = new Date(s);
  if (!isNaN(d.getTime())) return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
  return s; // Return raw if nothing works
}

// ─── Accounting System Extractor ───
// Calls the connected accounting system API directly (no AI)
async function handleAccountingExtract(
  flow: FlowData,
  node: FlowNode,
  ctx: ExecutionContext,
  executionId: string,
  engagementId: string,
): Promise<NodeResult> {
  const startTime = Date.now();

  // Get client ID from engagement
  const engagement = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    select: {
      clientId: true,
      period: { select: { startDate: true, endDate: true } },
    },
  });
  if (!engagement) {
    return { action: 'error', errorMessage: 'Engagement not found' };
  }

  // Find accounting connection
  const connection = await prisma.accountingConnection.findFirst({
    where: { clientId: engagement.clientId },
  });
  if (!connection) {
    return { action: 'error', errorMessage: 'No accounting system connected for this client. Connect via the Opening tab → Connection section.' };
  }

  // Check if connection is expired
  if (new Date() > connection.expiresAt) {
    return { action: 'error', errorMessage: `${connection.system} connection expired on ${connection.expiresAt.toLocaleDateString()}. Please reconnect via the Opening tab.` };
  }

  // Get account code from TB row context or node description
  const accountCode = ctx.test.tbRow?.accountCode || '';
  const accountCodes = accountCode ? [accountCode] : [];

  // Get date range from engagement period
  const dateFrom = engagement.period?.startDate
    ? new Date(engagement.period.startDate).toISOString().split('T')[0]
    : new Date(new Date().getFullYear(), 0, 1).toISOString().split('T')[0];
  const dateTo = engagement.period?.endDate
    ? new Date(engagement.period.endDate).toISOString().split('T')[0]
    : new Date().toISOString().split('T')[0];

  try {
    let populationData: any[] = [];

    switch (connection.system.toLowerCase()) {
      case 'xero': {
        const transactions = await xeroGetTransactions(engagement.clientId, accountCodes, dateFrom, dateTo);
        // Flatten transactions into rows for sampling calculator
        populationData = transactions.flatMap((txn: XeroTransaction) => {
          return (txn.LineItems || []).map(li => ({
            date: parseAccountingDate(txn.Date),
            reference: txn.Reference || txn.InvoiceNumber || '',
            invoiceNumber: txn.InvoiceNumber || '',
            contact: txn.Contact?.Name || '',
            description: li.Description || '',
            accountCode: li.AccountCode || '',
            amount: li.LineAmount || 0,
            taxAmount: li.TaxAmount || 0,
            total: txn.Total || 0,
            type: txn.Type || '',
            status: txn.Status || '',
            dueDate: parseAccountingDate(txn.DueDate),
          }));
        });
        break;
      }
      // Future: case 'sage': ...
      // Future: case 'quickbooks': ...
      default:
        return { action: 'error', errorMessage: `Accounting system "${connection.system}" is not yet supported for data extraction. Currently supported: Xero.` };
    }

    const duration = Date.now() - startTime;
    console.log(`[flow-engine] accounting_extract: ${connection.system} returned ${populationData.length} rows in ${duration}ms`);

    return {
      action: 'continue',
      nextNodeId: getNextNodeId(flow, node.id),
      output: {
        populationData,
        dataTable: populationData,
        rowCount: populationData.length,
        source: connection.system,
        orgName: connection.orgName,
        accountCodes,
        dateRange: { from: dateFrom, to: dateTo },
        duration,
      },
    };
  } catch (err: any) {
    return { action: 'error', errorMessage: `Failed to extract data from ${connection.system}: ${err.message || 'Unknown error'}` };
  }
}

async function handleActionAI(
  flow: FlowData,
  node: FlowNode,
  ctx: ExecutionContext,
  executionId: string,
  engagementId: string,
): Promise<NodeResult> {
  // Prefer latest execution def from test type (by actionId), fall back to embedded snapshot
  let execDef = node.data.executionDef;
  if (node.data.actionId) {
    const latestType = await prisma.methodologyTestType.findUnique({
      where: { id: node.data.actionId as string },
      select: { executionDef: true },
    });
    if (latestType?.executionDef) {
      execDef = latestType.executionDef as any;
    }
  }
  if (!execDef) {
    return { action: 'continue', nextNodeId: getNextNodeId(flow, node.id), output: { skipped: true, reason: 'No execution definition' } };
  }

  const prevNodeId = getPreviousNodeId(flow, node.id);
  const inputBindings = resolveInputs(execDef.inputs, ctx, prevNodeId || undefined);

  const systemPrompt = execDef.systemInstruction || 'You are a UK statutory audit assistant. Be precise and reference specific figures.';
  const userPrompt = resolveTemplate(execDef.promptTemplate || '', ctx, inputBindings);

  if (!userPrompt.trim()) {
    return { action: 'continue', nextNodeId: getNextNodeId(flow, node.id), output: { skipped: true, reason: 'Empty prompt template' } };
  }

  const startTime = Date.now();
  const aiResult = await callAI(systemPrompt, userPrompt);
  const duration = Date.now() - startTime;

  // Parse output based on format
  let parsedOutput: any = { raw: aiResult.text, model: aiResult.model, tokensUsed: aiResult.tokensUsed, duration };

  if (execDef.outputFormat === 'pass_fail' || execDef.outputFormat === 'pass_fail_forward') {
    const lower = aiResult.text.toLowerCase();
    parsedOutput.result = lower.includes('pass') ? 'pass' : lower.includes('fail') ? 'fail' : 'inconclusive';
    if (execDef.outputFormat === 'pass_fail_forward' && parsedOutput.result === 'pass') {
      parsedOutput.verifiedData = inputBindings;
    }
  }

  // data_table output — AI returns cleaned/filtered data as JSON array
  if (execDef.outputFormat === 'data_table') {
    try {
      const jsonMatch = aiResult.text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (Array.isArray(parsed)) {
          parsedOutput.populationData = parsed;
          parsedOutput.dataTable = parsed;
          parsedOutput.rowCount = parsed.length;
        }
      }
    } catch {
      // AI didn't return valid JSON — store raw text
      parsedOutput.rawData = aiResult.text;
    }
  }

  // Log for debugging pause issues
  console.log(`[flow-engine] AI action "${node.data.label}" outputFormat="${execDef.outputFormat}" requiresReview=${execDef.requiresReview}`);

  // Handle trigger outputs
  if (execDef.outputFormat === 'trigger_portal_request') {
    const message = execDef.aiCompose ? aiResult.text : resolveTemplate(execDef.requestTemplate?.message || userPrompt, ctx, inputBindings);
    const portalRequest = await prisma.portalRequest.create({
      data: {
        clientId: (await prisma.auditEngagement.findUnique({ where: { id: engagementId }, select: { clientId: true } }))!.clientId,
        engagementId,
        section: 'questions',
        question: message,
        status: 'outstanding',
        requestedById: 'system',
        requestedByName: 'Audit System (AI)',
      },
    });

    // Create outstanding item
    await prisma.outstandingItem.create({
      data: {
        engagementId,
        executionId,
        nodeId: node.id,
        type: 'portal_request',
        title: node.data.label || 'Portal Request',
        description: message.substring(0, 200),
        source: 'flow',
        status: 'awaiting_client',
        fsLine: ctx.test.fsLine,
        testName: ctx.test.description,
        flowNodeType: 'action',
        portalRequestId: portalRequest.id,
      },
    });

    parsedOutput.portalRequestId = portalRequest.id;
    return { action: 'pause', pauseReason: 'portal_response', pauseRefId: portalRequest.id, output: parsedOutput };
  }

  if (execDef.outputFormat === 'trigger_sampling') {
    parsedOutput.triggerType = 'sampling';

    // Search all previous node outputs for population/table data
    for (const [nodeKey, nodeOutput] of Object.entries(ctx.nodes)) {
      const out = nodeOutput as any;
      if (parsedOutput.populationData) break;
      // Check all common data keys
      if (out?.populationData?.length > 0) { parsedOutput.populationData = out.populationData; break; }
      if (out?.dataTable?.length > 0) { parsedOutput.populationData = out.dataTable; break; }
      if (out?.data?.length > 0 && Array.isArray(out.data)) { parsedOutput.populationData = out.data; break; }
      if (out?.rows?.length > 0) { parsedOutput.populationData = out.rows; break; }
      if (out?.items?.length > 0) { parsedOutput.populationData = out.items; break; }
      if (out?.invoices?.length > 0) { parsedOutput.populationData = out.invoices; break; }
      if (out?.transactions?.length > 0) { parsedOutput.populationData = out.transactions; break; }
      // Try parsing raw AI text from any node that might contain JSON array
      if (out?.raw && !parsedOutput.populationData) {
        try {
          const jsonMatch = (out.raw as string).match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            if (Array.isArray(parsed) && parsed.length > 0) { parsedOutput.populationData = parsed; break; }
          }
        } catch {}
      }
    }

    // Also try to parse this step's own AI result as data
    if (!parsedOutput.populationData) {
      try {
        const jsonMatch = aiResult.text.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          if (Array.isArray(parsed) && parsed.length > 0) parsedOutput.populationData = parsed;
        }
      } catch {}
    }

    // Last resort: read from completed node runs in DB
    if (!parsedOutput.populationData) {
      const priorRuns = await prisma.testExecutionNodeRun.findMany({
        where: { executionId, status: 'completed' },
        orderBy: { completedAt: 'desc' },
      });
      for (const run of priorRuns) {
        const out = run.output as any;
        if (!out) continue;
        if (out.populationData?.length > 0) { parsedOutput.populationData = out.populationData; break; }
        if (out.dataTable?.length > 0) { parsedOutput.populationData = out.dataTable; break; }
        if (out.data?.length > 0 && Array.isArray(out.data)) { parsedOutput.populationData = out.data; break; }
        if (out.rows?.length > 0) { parsedOutput.populationData = out.rows; break; }
        // Try parsing raw text
        if (out.raw) {
          try {
            const m = (out.raw as string).match(/\[[\s\S]*\]/);
            if (m) { const p = JSON.parse(m[0]); if (Array.isArray(p) && p.length > 0) { parsedOutput.populationData = p; break; } }
          } catch {}
        }
      }
    }

    console.log(`[flow-engine] trigger_sampling: populationData found = ${!!parsedOutput.populationData}, items = ${parsedOutput.populationData?.length || 0}`);
    // Create outstanding item for team to run the calculator
    const item = await prisma.outstandingItem.create({
      data: {
        engagementId,
        executionId,
        nodeId: node.id,
        type: 'flow_task',
        title: `Run Sampling Calculator: ${ctx.test.fsLine}`,
        description: `Review and run the sampling calculator for ${ctx.test.description}. Population data has been pre-loaded.`,
        source: 'flow',
        status: 'awaiting_team',
        fsLine: ctx.test.fsLine,
        testName: ctx.test.description,
        flowNodeType: 'action',
      },
    });
    parsedOutput.outstandingItemId = item.id;
    return { action: 'pause', pauseReason: 'sampling', pauseRefId: item.id, output: parsedOutput };
  }

  // If requires review, pause for team (must be explicitly set to true)
  if (execDef.requiresReview === true) {
    const item = await prisma.outstandingItem.create({
      data: {
        engagementId,
        executionId,
        nodeId: node.id,
        type: 'review_point',
        title: `Review: ${node.data.label || 'AI Result'}`,
        description: `AI produced a ${execDef.outputFormat} result for ${ctx.test.description}. Please review.`,
        source: 'flow',
        status: 'awaiting_team',
        fsLine: ctx.test.fsLine,
        testName: ctx.test.description,
        flowNodeType: 'action',
      },
    });
    return { action: 'pause', pauseReason: 'review', pauseRefId: item.id, output: parsedOutput };
  }

  return { action: 'continue', nextNodeId: getNextNodeId(flow, node.id), output: parsedOutput };
}

async function handleActionClient(
  flow: FlowData,
  node: FlowNode,
  ctx: ExecutionContext,
  executionId: string,
  engagementId: string,
): Promise<NodeResult> {
  const execDef = node.data.executionDef;
  const inputBindings = resolveInputs(execDef?.inputs, ctx, getPreviousNodeId(flow, node.id) || undefined);

  // Build subject and message from execution def template, with flow context
  let subject = resolveTemplate(execDef?.requestTemplate?.subject || '', ctx, inputBindings);
  let message = resolveTemplate(execDef?.requestTemplate?.message || '', ctx, inputBindings);

  // If no custom template, build a structured default with flow context
  if (!subject && !message) {
    const itemSummary = ctx.loop?.currentItem ? summariseLoopItem(ctx.loop.currentItem) : '';
    subject = `${ctx.test.fsLine} — ${node.data.label || 'Document Request'}`;
    message = [
      `As part of our ${ctx.test.fsLine} audit for ${ctx.engagement.clientName} (period ending ${ctx.engagement.periodEnd}):`,
      '',
      `Test: ${ctx.test.description}`,
      '',
      itemSummary ? `Please provide the supporting document for:\n${itemSummary}` : (node.data.description || 'Please provide the requested information.'),
    ].join('\n');
  } else {
    // Always prepend flow context if not already in the message
    if (!message.includes(ctx.test.fsLine) && !subject.includes(ctx.test.fsLine)) {
      subject = `${ctx.test.fsLine} — ${subject}`;
    }
    if (!message.includes(ctx.engagement.clientName)) {
      message = `Audit: ${ctx.test.fsLine} for ${ctx.engagement.clientName} (period ending ${ctx.engagement.periodEnd})\n\n${message}`;
    }
  }

  const eng = await prisma.auditEngagement.findUnique({ where: { id: engagementId }, select: { clientId: true } });
  const portalRequest = await prisma.portalRequest.create({
    data: {
      clientId: eng!.clientId,
      engagementId,
      section: 'questions',
      question: `${subject}\n\n${message}`,
      status: 'outstanding',
      requestedById: 'system',
      requestedByName: 'Audit System',
    },
  });

  // Check if inside a forEach loop — use ctx.loop as indicator (no DB read needed)
  const isInsideLoop = !!ctx.loop;

  if (!isInsideLoop) {
    // Only create OutstandingItem for non-loop requests (reduces DB writes in loops)
    await prisma.outstandingItem.create({
      data: {
        engagementId,
        executionId,
        nodeId: node.id,
        type: 'portal_request',
        title: subject,
        description: message.substring(0, 200),
        source: 'flow',
        status: 'awaiting_client',
        fsLine: ctx.test.fsLine,
        testName: ctx.test.description,
        flowNodeType: 'action',
        portalRequestId: portalRequest.id,
      },
    });
  }

  if (isInsideLoop) {
    // Fire and forget — don't pause, don't create outstanding item per iteration
    return { action: 'continue', nextNodeId: getNextNodeId(flow, node.id), output: { portalRequestId: portalRequest.id, subject, fireAndForget: true } };
  }

  return { action: 'pause', pauseReason: 'portal_response', pauseRefId: portalRequest.id, output: { portalRequestId: portalRequest.id, subject } };
}

async function handleActionTeam(
  flow: FlowData,
  node: FlowNode,
  ctx: ExecutionContext,
  executionId: string,
  engagementId: string,
): Promise<NodeResult> {
  const execDef = node.data.executionDef;
  const instructions = resolveTemplate(execDef?.instructions || node.data.description || '', ctx);

  const item = await prisma.outstandingItem.create({
    data: {
      engagementId,
      executionId,
      nodeId: node.id,
      type: 'flow_task',
      title: node.data.label || 'Team Task',
      description: instructions,
      source: 'flow',
      status: 'awaiting_team',
      fsLine: ctx.test.fsLine,
      testName: ctx.test.description,
      flowNodeType: 'action',
    },
  });

  return { action: 'pause', pauseReason: 'team_task', pauseRefId: item.id, output: { outstandingItemId: item.id } };
}

async function handleDecision(
  flow: FlowData,
  node: FlowNode,
  ctx: ExecutionContext,
): Promise<NodeResult> {
  const prevNodeId = getPreviousNodeId(flow, node.id);
  const prevOutput = prevNodeId ? ctx.nodes[prevNodeId] : null;

  // Try to determine yes/no from previous output
  let isYes = false;

  if (prevOutput?.result === 'pass') isYes = true;
  else if (prevOutput?.result === 'fail') isYes = false;
  else {
    // Use AI judgment
    const question = node.data.question || node.data.label || 'Does this pass?';
    const aiResult = await callAI(
      'You are an audit decision assistant. Answer YES or NO only, based on the context.',
      `Previous step result: ${JSON.stringify(prevOutput)}\n\nQuestion: ${question}`
    );
    isYes = aiResult.text.toLowerCase().includes('yes');
  }

  const yesNodeId = getNextNodeId(flow, node.id, 'yes');
  const noNodeId = getNextNodeId(flow, node.id, 'no');
  const nextId = isYes ? yesNodeId : noNodeId;

  if (!nextId) {
    // Fallback: try any outgoing edge
    const fallback = getNextNodeId(flow, node.id);
    return { action: fallback ? 'continue' : 'error', nextNodeId: fallback, output: { decision: isYes ? 'yes' : 'no' }, errorMessage: fallback ? undefined : `Decision node has no ${isYes ? 'Yes' : 'No'} branch` };
  }

  return { action: 'continue', nextNodeId: nextId, output: { decision: isYes ? 'yes' : 'no' } };
}

async function handleWait(
  flow: FlowData,
  node: FlowNode,
  ctx: ExecutionContext,
  executionId: string,
  engagementId: string,
): Promise<NodeResult> {
  const waitFor = node.data.waitFor || 'team_task_complete';

  // Check if the waited-for event has ALREADY happened
  // by examining previous node outputs and the engagement state
  const prevNodeId = getPreviousNodeId(flow, node.id);
  const prevOutput = prevNodeId ? ctx.nodes[prevNodeId] : null;

  // If previous node was a portal request that has a response, evidence is already here
  if (waitFor === 'evidence_received' || waitFor === 'portal_response' || waitFor === 'client_confirmation') {
    if (prevOutput?.response || prevOutput?.committed || prevOutput?.chatHistory) {
      return {
        action: 'continue',
        nextNodeId: getNextNodeId(flow, node.id),
        output: { waitingFor: waitFor, satisfied: true, data: prevOutput },
      };
    }

    // Check if there are any responded/committed portal requests for this engagement
    const respondedRequests = await prisma.portalRequest.findMany({
      where: { engagementId, status: { in: ['responded', 'committed'] } },
      orderBy: { respondedAt: 'desc' },
      take: 1,
    });
    if (respondedRequests.length > 0) {
      // Try to parse any uploaded files from this portal request
      let populationData: any[] = [];
      let parsedColumns: string[] = [];
      let parsedFileName = '';
      try {
        const parsedFiles = await parsePortalResponseFiles(respondedRequests[0].id);
        if (parsedFiles.length > 0) {
          populationData = parsedFiles[0].aggregatedRows.length > 0 ? parsedFiles[0].aggregatedRows : parsedFiles[0].rows;
          parsedColumns = parsedFiles[0].columns;
          parsedFileName = parsedFiles[0].fileName;
          console.log(`[FlowEngine] Wait node parsed ${parsedFiles[0].rowCount} rows from ${parsedFileName}`);
        }
      } catch {}

      return {
        action: 'continue',
        nextNodeId: getNextNodeId(flow, node.id),
        output: {
          waitingFor: waitFor,
          satisfied: true,
          populationData,
          columns: parsedColumns,
          fileName: parsedFileName,
          data: {
            response: respondedRequests[0].response,
            portalRequestId: respondedRequests[0].id,
            respondedAt: respondedRequests[0].respondedAt?.toISOString(),
            populationData,
          },
        },
      };
    }
  }

  // If previous node output indicates completion, pass through
  if (waitFor === 'sampling_complete' && prevOutput?.samplingEngagementId) {
    return { action: 'continue', nextNodeId: getNextNodeId(flow, node.id), output: { waitingFor: waitFor, satisfied: true, data: prevOutput } };
  }
  if (waitFor === 'team_task_complete' && prevOutput?.completed) {
    return { action: 'continue', nextNodeId: getNextNodeId(flow, node.id), output: { waitingFor: waitFor, satisfied: true, data: prevOutput } };
  }
  if (waitFor === 'review_resolved' && prevOutput?.resolved) {
    return { action: 'continue', nextNodeId: getNextNodeId(flow, node.id), output: { waitingFor: waitFor, satisfied: true, data: prevOutput } };
  }

  // Not yet satisfied — pause and wait
  // Create an OutstandingItem so it shows in the Outstanding tab
  const item = await prisma.outstandingItem.create({
    data: {
      engagementId,
      executionId,
      nodeId: node.id,
      type: 'flow_task',
      title: node.data.label || `Wait: ${waitFor.replace(/_/g, ' ')}`,
      description: `Flow is waiting for: ${waitFor.replace(/_/g, ' ')}`,
      source: 'flow',
      status: 'awaiting_team',
      flowNodeType: 'wait',
    },
  });

  return { action: 'pause', pauseReason: waitFor, pauseRefId: item.id, output: { waitingFor: waitFor, outstandingItemId: item.id } };
}

// ─── Loop Handlers ───

async function handleForEach(
  flow: FlowData,
  node: FlowNode,
  ctx: ExecutionContext,
  execution: any,
): Promise<NodeResult> {
  const collection = node.data.collection || 'sample_items';
  let loopState = execution.loopState as { nodeId: string; items: any[]; index: number; results: any[] } | null;

  // First entry — initialise the loop
  if (!loopState || loopState.nodeId !== node.id) {
    // Resolve the collection from context
    let items: any[] = [];

    // Look for data in previous nodes
    const prevNodeId = getPreviousNodeId(flow, node.id);
    const prevOutput = prevNodeId ? ctx.nodes[prevNodeId] : null;

    if (collection === 'sample_items') {
      // From sampling results — resolve selectedIndices against populationData
      // Search all nodes for population data and sampling results
      let populationData: any[] = [];
      let selectedIndices: number[] = [];

      for (const [, nodeOut] of Object.entries(ctx.nodes)) {
        const out = nodeOut as any;
        if (!out) continue;
        if (out.populationData?.length > 0 && populationData.length === 0) populationData = out.populationData;
        if (out.dataTable?.length > 0 && populationData.length === 0) populationData = out.dataTable;
        if (out.selectedIndices?.length > 0 && selectedIndices.length === 0) selectedIndices = out.selectedIndices;
        if (out.sampleItems?.length > 0 && items.length === 0) items = out.sampleItems;
      }

      if (selectedIndices.length > 0 && populationData.length > 0) {
        // Map indices to actual row objects
        items = selectedIndices.map((idx: number) => populationData[idx]).filter(Boolean);
      } else if (items.length === 0 && populationData.length > 0) {
        items = populationData; // Fallback: use full population
      }
    } else if (collection === 'evidence_files') {
      items = prevOutput?.parsedFiles || prevOutput?.files || [];
    } else {
      // Generic: try to get array data from previous node
      items = Array.isArray(prevOutput) ? prevOutput :
              prevOutput?.items || prevOutput?.rows || prevOutput?.data || prevOutput?.populationData || [];
    }

    if (!Array.isArray(items)) items = [];

    if (items.length === 0) {
      // Empty collection — skip loop body, go to "done" exit
      const doneNodeId = getNextNodeId(flow, node.id, 'done');
      return { action: 'continue', nextNodeId: doneNodeId, output: { loopCompleted: true, itemCount: 0, results: [] } };
    }

    loopState = { nodeId: node.id, items, index: 0, results: [] };

    // Save loop state and set context for first iteration
    await prisma.testExecution.update({
      where: { id: execution.id },
      data: { loopState: loopState as any },
    });
  }

  // Check if we've processed all items
  if (loopState.index >= loopState.items.length) {
    // Done — clear loop state and follow "done" exit
    await prisma.testExecution.update({
      where: { id: execution.id },
      data: { loopState: Prisma.DbNull },
    });
    const doneNodeId = getNextNodeId(flow, node.id, 'done');
    return { action: 'continue', nextNodeId: doneNodeId, output: { loopCompleted: true, itemCount: loopState.items.length, results: loopState.results } };
  }

  // Set loop context for this iteration
  ctx.loop = { currentItem: loopState.items[loopState.index], index: loopState.index };

  // Follow "body" exit for this iteration
  let bodyNodeId = getNextNodeId(flow, node.id, 'body');
  if (!bodyNodeId) {
    // No body branch — skip all items
    await prisma.testExecution.update({ where: { id: execution.id }, data: { loopState: Prisma.DbNull } });
    const doneNodeId = getNextNodeId(flow, node.id, 'done');
    return { action: 'continue', nextNodeId: doneNodeId, output: { loopCompleted: true, itemCount: loopState.items.length, skipped: true } };
  }


  // Increment index for next iteration (saved to DB)
  loopState.index++;
  await prisma.testExecution.update({
    where: { id: execution.id },
    data: { loopState: loopState as any, context: { ...ctx as any } },
  });

  return {
    action: 'continue',
    nextNodeId: bodyNodeId,
    output: { iterating: true, index: loopState.index - 1, item: ctx.loop.currentItem, totalItems: loopState.items.length },
  };
}

async function handleLoopUntil(
  flow: FlowData,
  node: FlowNode,
  ctx: ExecutionContext,
  execution: any,
): Promise<NodeResult> {
  const condition = node.data.condition || '';
  const maxIterations = node.data.maxIterations || 3;
  let loopState = execution.loopState as { nodeId: string; iteration: number } | null;

  if (!loopState || loopState.nodeId !== node.id) {
    loopState = { nodeId: node.id, iteration: 0 };
  }

  // Check if max iterations exceeded
  if (loopState.iteration >= maxIterations) {
    await prisma.testExecution.update({ where: { id: execution.id }, data: { loopState: Prisma.DbNull } });
    const doneNodeId = getNextNodeId(flow, node.id, 'done');
    return { action: 'continue', nextNodeId: doneNodeId, output: { loopCompleted: true, reason: 'max_iterations', iterations: loopState.iteration } };
  }

  // Check condition from previous node output
  const prevNodeId = getPreviousNodeId(flow, node.id);
  const prevOutput = prevNodeId ? ctx.nodes[prevNodeId] : null;

  if (prevOutput?.result === 'pass' || prevOutput?.satisfied || prevOutput?.completed) {
    // Condition met — exit via "done"
    await prisma.testExecution.update({ where: { id: execution.id }, data: { loopState: Prisma.DbNull } });
    const doneNodeId = getNextNodeId(flow, node.id, 'done');
    return { action: 'continue', nextNodeId: doneNodeId, output: { loopCompleted: true, reason: 'condition_met', iterations: loopState.iteration } };
  }

  // Condition not met — repeat via "repeat" branch
  loopState.iteration++;
  await prisma.testExecution.update({ where: { id: execution.id }, data: { loopState: loopState as any } });

  const repeatNodeId = getNextNodeId(flow, node.id, 'repeat');
  if (!repeatNodeId) {
    await prisma.testExecution.update({ where: { id: execution.id }, data: { loopState: Prisma.DbNull } });
    const doneNodeId = getNextNodeId(flow, node.id, 'done');
    return { action: 'continue', nextNodeId: doneNodeId, output: { loopCompleted: true, reason: 'no_repeat_branch' } };
  }

  return { action: 'continue', nextNodeId: repeatNodeId, output: { repeating: true, iteration: loopState.iteration } };
}

// ─── Sub-Flow Handler ───

async function handleSubFlow(
  flow: FlowData,
  node: FlowNode,
  ctx: ExecutionContext,
  execution: any,
  executionId: string,
): Promise<NodeResult> {
  const subFlowId = node.data.subFlowId;
  if (!subFlowId) {
    return { action: 'continue', nextNodeId: getNextNodeId(flow, node.id), output: { skipped: true, reason: 'No sub-flow selected' } };
  }

  // Parse subFlowId format: "testBankEntryId::testDescription"
  const [entryId, testDesc] = subFlowId.split('::');

  // Look up the test bank entry and find the test with a flow
  const entry = await prisma.methodologyTestBank.findUnique({ where: { id: entryId } });
  if (!entry) {
    return { action: 'continue', nextNodeId: getNextNodeId(flow, node.id), output: { skipped: true, reason: `Sub-flow entry ${entryId} not found` } };
  }

  const tests = (entry.tests as any[]) || [];
  const test = tests.find(t => t.description === testDesc && t.flow?.nodes?.length > 0);
  if (!test?.flow) {
    return { action: 'continue', nextNodeId: getNextNodeId(flow, node.id), output: { skipped: true, reason: `Sub-flow "${testDesc}" has no flow data` } };
  }

  const subFlow = test.flow as FlowData;

  // Push current flow state onto a stack (stored in execution context)
  const flowStack = (ctx as any)._flowStack || [];
  flowStack.push({
    flowSnapshot: flow,
    currentNodeId: node.id,
    returnToNodeId: getNextNodeId(flow, node.id), // Where to go when sub-flow ends
    loopState: execution.loopState,
  });

  // Switch execution to the sub-flow
  const startNode = subFlow.nodes.find(n => n.type === 'start');
  const firstNodeId = startNode ? getNextNodeId(subFlow, startNode.id) : null;

  await prisma.testExecution.update({
    where: { id: executionId },
    data: {
      flowSnapshot: subFlow as any,
      currentNodeId: firstNodeId,
      context: { ...ctx, _flowStack: flowStack } as any,
      loopState: Prisma.DbNull, // Clear loop state for sub-flow
    },
  });

  return {
    action: 'continue',
    nextNodeId: firstNodeId || undefined,
    output: { subFlowStarted: true, subFlowName: node.data.subFlowName || testDesc, entryId },
  };
}

// Handle returning from a sub-flow when it hits an End node
async function handleSubFlowReturn(
  ctx: ExecutionContext,
  executionId: string,
  endOutput: any,
): Promise<{ restored: boolean; nextNodeId?: string }> {
  const flowStack = (ctx as any)._flowStack;
  if (!flowStack || flowStack.length === 0) return { restored: false };

  // Pop the parent flow state
  const frame = flowStack.pop();

  await prisma.testExecution.update({
    where: { id: executionId },
    data: {
      flowSnapshot: frame.flowSnapshot as any,
      currentNodeId: frame.returnToNodeId,
      context: { ...ctx, _flowStack: flowStack } as any,
      loopState: frame.loopState || Prisma.DbNull,
    },
  });

  return { restored: true, nextNodeId: frame.returnToNodeId };
}

// ─── Main Engine ───

export async function startExecution(
  engagementId: string,
  fsLine: string,
  testDescription: string,
  testTypeCode: string | null,
  flowData: FlowData,
  userId: string,
  tbRow?: { accountCode: string; description: string; currentYear: number | null; priorYear: number | null; fsNote?: string | null },
): Promise<string> {
  const eng = await prisma.auditEngagement.findUnique({ where: { id: engagementId }, select: { firmId: true } });
  if (!eng) throw new Error('Engagement not found');

  const ctx = await buildContext(engagementId, fsLine, testDescription, tbRow);

  const execution = await prisma.testExecution.create({
    data: {
      engagementId,
      firmId: eng.firmId,
      fsLine,
      testDescription,
      testTypeCode,
      flowSnapshot: flowData as any,
      status: 'running',
      context: ctx as any,
      startedById: userId,
    },
  });

  // Start processing from the start node
  await processNextNode(execution.id);

  return execution.id;
}

export async function processNextNode(executionId: string): Promise<void> {
  let startTime = Date.now();
  const MAX_DURATION = 55_000; // 55s budget (Vercel allows 60s)
  const MAX_STEPS = 100; // High budget for loops that fire many requests
  let steps = 0;

  // Load execution ONCE, cache and update in-memory
  const initialExec = await prisma.testExecution.findUnique({ where: { id: executionId } });
  if (!initialExec || initialExec.status !== 'running') return;

  let execution: NonNullable<typeof initialExec> = initialExec;
  let flow = execution.flowSnapshot as unknown as FlowData;
  let ctx = execution.context as unknown as ExecutionContext;

  while (steps < MAX_STEPS && (Date.now() - startTime) < MAX_DURATION) {
    steps++;

    // Reload from DB every 10 steps to pick up external changes
    if (steps % 10 === 0) {
      const refreshed = await prisma.testExecution.findUnique({ where: { id: executionId } });
      if (!refreshed || refreshed.status !== 'running') return;
      execution = refreshed;
      flow = refreshed.flowSnapshot as unknown as FlowData;
      ctx = refreshed.context as unknown as ExecutionContext;
    }

    // Determine current node
    let currentNode: FlowNode | undefined;
    if (execution.currentNodeId) {
      currentNode = findNode(flow, execution.currentNodeId);
    } else {
      // First step — find start node's first target
      const startNode = findStartNode(flow);
      if (!startNode) {
        await prisma.testExecution.update({ where: { id: executionId }, data: { status: 'failed', errorMessage: 'No start node in flow' } });
        return;
      }
      // Record start node run
      await prisma.testExecutionNodeRun.create({
        data: { executionId, nodeId: startNode.id, nodeType: 'start', label: 'Start', status: 'completed', completedAt: new Date() },
      });
      const nextId = getNextNodeId(flow, startNode.id);
      if (!nextId) {
        await prisma.testExecution.update({ where: { id: executionId }, data: { status: 'failed', errorMessage: 'Start node has no connection' } });
        return;
      }
      currentNode = findNode(flow, nextId);
      await prisma.testExecution.update({ where: { id: executionId }, data: { currentNodeId: nextId } });
    }

    if (!currentNode) {
      await prisma.testExecution.update({ where: { id: executionId }, data: { status: 'failed', errorMessage: `Node ${execution.currentNodeId} not found in flow` } });
      return;
    }

    // Create node run record — skip for forEach iterations to reduce DB writes
    const isLoopIteration = ctx.loop && (currentNode.type === 'forEach' || (execution.loopState && currentNode.type === 'action'));
    let nodeRun: { id: string } | null = null;
    if (!isLoopIteration) {
      nodeRun = await prisma.testExecutionNodeRun.create({
        data: {
          executionId,
          nodeId: currentNode.id,
          nodeType: currentNode.type || 'action',
          assignee: currentNode.data?.assignee || null,
          label: currentNode.data?.label || null,
          status: 'running',
        },
      });
    }

    let result: NodeResult;
    try {
      const assignee = currentNode.data?.assignee;

      switch (currentNode.type) {
        case 'start':
          result = await handleStart(flow, currentNode);
          break;
        case 'end': {
          // Check if we're in a sub-flow — if so, return to parent
          const subReturn = await handleSubFlowReturn(ctx, executionId, { completed: true });
          if (subReturn.restored) {
            // Reload execution state after restoring parent flow
            const refreshed = await prisma.testExecution.findUnique({ where: { id: executionId } });
            if (refreshed) {
              execution = refreshed as any;
              flow = refreshed.flowSnapshot as unknown as FlowData;
              ctx = refreshed.context as unknown as ExecutionContext;
            }
            result = { action: 'continue', nextNodeId: subReturn.nextNodeId, output: { subFlowCompleted: true } };
          } else {
            result = await handleEnd();
          }
          break;
        }
        case 'decision':
          result = await handleDecision(flow, currentNode, ctx);
          break;
        case 'wait':
          result = await handleWait(flow, currentNode, ctx, executionId, execution.engagementId);
          break;
        case 'forEach':
          result = await handleForEach(flow, currentNode, ctx, execution);
          break;
        case 'loopUntil':
          result = await handleLoopUntil(flow, currentNode, ctx, execution);
          break;
        case 'subFlow':
          result = await handleSubFlow(flow, currentNode, ctx, execution, executionId);
          break;
        case 'action':
        default:
          // Check for system-level input types that bypass AI/Client/Team routing
          if (currentNode.data?.inputType === 'accounting_extract') {
            result = await handleAccountingExtract(flow, currentNode, ctx, executionId, execution.engagementId);
          } else if (assignee === 'ai') {
            result = await handleActionAI(flow, currentNode, ctx, executionId, execution.engagementId);
          } else if (assignee === 'client') {
            result = await handleActionClient(flow, currentNode, ctx, executionId, execution.engagementId);
          } else {
            result = await handleActionTeam(flow, currentNode, ctx, executionId, execution.engagementId);
          }
          break;
      }
    } catch (err: any) {
      result = { action: 'error', errorMessage: err.message || 'Node execution failed' };
    }

    // Update node run (if created)
    if (nodeRun) {
      await prisma.testExecutionNodeRun.update({
        where: { id: nodeRun.id },
        data: {
          status: result.action === 'error' ? 'failed' : result.action === 'pause' ? 'paused' : 'completed',
          output: result.output || null,
          errorMessage: result.errorMessage || null,
          completedAt: result.action === 'continue' || result.action === 'complete' ? new Date() : null,
          duration: Date.now() - startTime,
        },
      });
    }

    // Merge custom variables from the node's data into both node output AND flow vars
    const customVars = currentNode.data?.customVars;
    let nodeOutput = result.output;
    if (customVars?.length > 0) {
      const varEntries = Object.fromEntries(customVars.filter((v: any) => v.key).map((v: any) => [v.key, v.value]));
      nodeOutput = { ...nodeOutput, ...varEntries };
      // Write to flow-level vars so they persist across nodes and sub-flows
      ctx = { ...ctx, vars: { ...ctx.vars, ...varEntries } };
    }

    // Auto-set flow variables from common node outputs
    const autoVars: Record<string, any> = {};
    if (nodeOutput?.populationData?.length) autoVars.populationCount = nodeOutput.populationData.length;
    if (nodeOutput?.selectedIndices?.length) autoVars.sampleCount = nodeOutput.selectedIndices.length;
    if (nodeOutput?.sampleSize) autoVars.sampleCount = nodeOutput.sampleSize;
    if (nodeOutput?.coverage) autoVars.sampleCoverage = nodeOutput.coverage;
    if (nodeOutput?.itemCount) autoVars.sampleCount = nodeOutput.itemCount;
    if (nodeOutput?.loopCompleted && nodeOutput?.results?.length) autoVars.verifiedCount = nodeOutput.results.length;
    if (nodeOutput?.portalRequestId) autoVars.lastPortalRequestId = nodeOutput.portalRequestId;
    if (nodeOutput?.result === 'pass' || nodeOutput?.result === 'fail') autoVars.lastResult = nodeOutput.result;
    if (Object.keys(autoVars).length > 0) {
      ctx = { ...ctx, vars: { ...ctx.vars, ...autoVars } };
    }

    // Update execution context in memory
    ctx = { ...ctx, nodes: { ...ctx.nodes, [currentNode.id]: nodeOutput } };

    switch (result.action) {
      case 'continue': {
        let nextId = result.nextNodeId || null;

        // If we're at a dead end inside a loop body, return to the forEach/loopUntil node
        if (!nextId && execution.loopState) {
          const ls = execution.loopState as any;
          if (ls.nodeId) nextId = ls.nodeId;
        }

        // Update DB — but only every 5 steps in a loop to reduce writes
        const shouldSaveNow = !ctx.loop || steps % 5 === 0;
        if (shouldSaveNow) {
          await prisma.testExecution.update({
            where: { id: executionId },
            data: { currentNodeId: nextId, context: ctx as any },
          });
        }
        // Refresh loopState from DB if it might have changed (forEach/loopUntil handlers write directly)
        if (currentNode.type === 'forEach' || currentNode.type === 'loopUntil' || (execution.loopState && !nextId)) {
          const refreshed = await prisma.testExecution.findUnique({ where: { id: executionId }, select: { loopState: true } });
          if (refreshed) execution = { ...execution, loopState: refreshed.loopState } as any;
        }
        // Update in-memory execution state
        execution = { ...execution, currentNodeId: nextId, context: ctx as any } as any;
        continue; // Process next node in loop
      }

      case 'pause':
        await prisma.testExecution.update({
          where: { id: executionId },
          data: {
            status: 'paused',
            currentNodeId: currentNode.id,
            pauseReason: result.pauseReason || null,
            pauseRefId: result.pauseRefId || null,
            context: ctx as any,
          },
        });
        return; // Exit — will resume via event

      case 'complete':
        await prisma.testExecution.update({
          where: { id: executionId },
          data: { status: 'completed', completedAt: new Date(), context: ctx as any },
        });
        return;

      case 'error':
        await prisma.testExecution.update({
          where: { id: executionId },
          data: { status: 'failed', errorMessage: result.errorMessage, context: ctx as any },
        });
        return;
    }
  }

  // Time/step budget exhausted — save final state so auto-continuation can pick up
  await prisma.testExecution.update({
    where: { id: executionId },
    data: { context: ctx as any },
  });
}

export async function resumeExecution(executionId: string, externalData?: any): Promise<void> {
  const execution = await prisma.testExecution.findUnique({ where: { id: executionId } });
  if (!execution || execution.status !== 'paused') return;

  const flow = execution.flowSnapshot as unknown as FlowData;
  const ctx = execution.context as unknown as ExecutionContext;

  // Store external data as the paused node's output
  if (execution.currentNodeId && externalData) {
    // If this is a portal response, parse any uploaded files
    if (externalData.portalRequestId && execution.pauseReason === 'portal_response') {
      try {
        const parsedFiles = await parsePortalResponseFiles(externalData.portalRequestId);
        if (parsedFiles.length > 0) {
          externalData.parsedFiles = parsedFiles;
          externalData.populationData = parsedFiles[0].aggregatedRows.length > 0 ? parsedFiles[0].aggregatedRows : parsedFiles[0].rows;
          externalData.rawLineItems = parsedFiles[0].rows; // Keep raw line items for reference
          externalData.columns = parsedFiles[0].columns;
          externalData.fileName = parsedFiles[0].fileName;
          console.log(`[FlowEngine] Parsed ${parsedFiles.length} file(s) from portal response: ${parsedFiles.map(f => `${f.fileName} (${f.rowCount} rows)`).join(', ')}`);
        }
      } catch (err) {
        console.error('[FlowEngine] Failed to parse portal response files:', err);
      }
    }

    const updatedContext = { ...ctx, nodes: { ...ctx.nodes, [execution.currentNodeId]: { ...ctx.nodes[execution.currentNodeId], ...externalData } } };

    // Mark the paused node run as completed
    await prisma.testExecutionNodeRun.updateMany({
      where: { executionId, nodeId: execution.currentNodeId, status: 'paused' },
      data: { status: 'completed', completedAt: new Date(), output: externalData },
    });

    // Advance to next node — use updatedContext so sampling results / external data are available to next step
    const nextNodeId = getNextNodeId(flow, execution.currentNodeId);
    await prisma.testExecution.update({
      where: { id: executionId },
      data: { status: 'running', currentNodeId: nextNodeId || null, pauseReason: null, pauseRefId: null, context: updatedContext as any },
    });
  } else {
    // Resume without new data — just advance
    const nextNodeId = execution.currentNodeId ? getNextNodeId(flow, execution.currentNodeId) : null;
    await prisma.testExecution.update({
      where: { id: executionId },
      data: { status: 'running', currentNodeId: nextNodeId || null, pauseReason: null, pauseRefId: null },
    });
  }

  // Continue processing
  await processNextNode(executionId);
}
