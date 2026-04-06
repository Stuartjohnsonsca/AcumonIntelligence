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
      periodEndPlus2M: (() => { const d = new Date(engagement.period.endDate); d.setMonth(d.getMonth() + 2); return d.toISOString().split('T')[0]; })(),
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

// ─── Require Prior Evidence ───
// Gate node: checks that extracted/stored data exists for the given evidenceTag.
// If found, passes the data through to the next node.
// If NOT found, FAILS the test with a clear prerequisite error message.
async function handleRequirePriorEvidence(
  flow: FlowData,
  node: FlowNode,
  ctx: ExecutionContext,
  executionId: string,
  engagementId: string,
): Promise<NodeResult> {
  const evidenceTag = node.data.evidenceTag || node.data.executionDef?.evidenceTag;
  if (!evidenceTag) {
    return { action: 'error', errorMessage: 'require_prior_evidence node requires an evidenceTag' };
  }

  console.log(`[flow-engine] Checking prerequisite evidence: tag="${evidenceTag}"`);

  // First check AuditDocument library (from store_extracted_bank_data)
  const docs = await prisma.auditDocument.findMany({
    where: {
      engagementId,
      mappedItems: { path: ['evidenceTag'], equals: evidenceTag },
    },
    select: { id: true, documentName: true, storagePath: true, containerName: true },
  });

  if (docs.length > 0) {
    // Load the stored data from each document
    const { downloadBlob } = await import('@/lib/azure-blob');
    const allRows: any[] = [];
    for (const doc of docs) {
      try {
        const buffer = await downloadBlob(doc.storagePath, doc.containerName || 'upload-inbox');
        const parsed = JSON.parse(buffer.toString('utf-8'));
        if (parsed.rows && Array.isArray(parsed.rows)) {
          allRows.push(...parsed.rows);
        }
      } catch (err) {
        console.warn(`[flow-engine] Failed to load document ${doc.id}:`, (err as Error).message);
      }
    }

    console.log(`[flow-engine] Prerequisite met: ${docs.length} documents, ${allRows.length} rows for tag="${evidenceTag}"`);
    return {
      action: 'continue',
      nextNodeId: getNextNodeId(flow, node.id),
      output: {
        evidenceFound: true,
        evidenceTag,
        dataTable: allRows,
        transactionCount: allRows.length,
        documentCount: docs.length,
        documents: docs.map(d => ({ id: d.id, name: d.documentName })),
      },
    };
  }

  // Fallback: check portal uploads (from use_prior_evidence pattern)
  const portalRequests = await prisma.portalRequest.findMany({
    where: { engagementId, evidenceTag, status: { in: ['responded', 'verified', 'committed'] } },
    select: { id: true },
  });

  if (portalRequests.length > 0) {
    // Evidence has been uploaded but not yet extracted/stored
    return {
      action: 'error',
      errorMessage: `Prerequisite incomplete: Bank statements have been uploaded (tag: "${evidenceTag}") but not yet extracted and stored. Run the "Extract Bank Statement Data" test first.`,
    };
  }

  // Nothing found at all
  return {
    action: 'error',
    errorMessage: `Prerequisite not met: No data found for tag "${evidenceTag}". The prerequisite test (e.g. BS In Year Review + Extract Bank Statement Data) must be completed first.`,
  };
}

// ─── Use Prior Evidence ───
// Looks up already-uploaded evidence by evidenceTag from prior portal requests.
// Avoids re-requesting documents the client has already provided.
async function handleUsePriorEvidence(
  flow: FlowData,
  node: FlowNode,
  ctx: ExecutionContext,
  executionId: string,
  engagementId: string,
): Promise<NodeResult> {
  const evidenceTag = node.data.evidenceTag || node.data.executionDef?.evidenceTag;
  if (!evidenceTag) {
    return { action: 'error', errorMessage: 'use_prior_evidence node requires an evidenceTag (e.g. "bank_statements")' };
  }

  console.log(`[flow-engine] Looking up prior evidence: tag="${evidenceTag}" engagement="${engagementId}"`);

  // Find all portal requests for this engagement with the matching evidenceTag that have been responded to
  const portalRequests = await prisma.portalRequest.findMany({
    where: {
      engagementId,
      evidenceTag,
      status: { in: ['responded', 'verified', 'committed', 'chat_replied'] },
    },
    select: { id: true, question: true, response: true, status: true },
  });

  if (portalRequests.length === 0) {
    console.log(`[flow-engine] No prior evidence found for tag="${evidenceTag}"`);
    return {
      action: 'continue',
      nextNodeId: getNextNodeId(flow, node.id),
      output: { evidenceFound: false, evidenceTag, message: `No prior evidence with tag "${evidenceTag}" found. The prerequisite test may not have been run yet.`, files: [], requests: [] },
    };
  }

  // Find all uploads linked to these portal requests
  const requestIds = portalRequests.map(r => r.id);
  const uploads = await prisma.portalUpload.findMany({
    where: { portalRequestId: { in: requestIds } },
    select: { id: true, portalRequestId: true, originalName: true, storagePath: true, containerName: true, mimeType: true, createdAt: true },
  });

  console.log(`[flow-engine] Found ${portalRequests.length} portal requests, ${uploads.length} uploads for tag="${evidenceTag}"`);

  // Parse uploaded spreadsheet files using the existing parser
  const { parsePortalResponseFiles } = await import('@/lib/flow-file-parser');
  const allParsedFiles: any[] = [];
  for (const reqId of requestIds) {
    try {
      const parsed = await parsePortalResponseFiles(reqId);
      allParsedFiles.push(...parsed);
    } catch (err) {
      console.warn(`[flow-engine] Failed to parse files for request ${reqId}:`, (err as Error).message);
    }
  }

  return {
    action: 'continue',
    nextNodeId: getNextNodeId(flow, node.id),
    output: {
      evidenceFound: true,
      evidenceTag,
      requestCount: portalRequests.length,
      uploadCount: uploads.length,
      parsedFiles: allParsedFiles,
      uploads: uploads.map(u => ({ id: u.id, fileName: u.originalName, storagePath: u.storagePath, containerName: u.containerName })),
      requests: portalRequests.map(r => ({ id: r.id, question: r.question, response: r.response, status: r.status })),
    },
  };
}

function deduplicateTransactions(txns: any[]): any[] {
  const seen = new Set<string>();
  return txns.filter(txn => {
    const key = `${txn.date}|${txn.description}|${txn.debit}|${txn.credit}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─── Bank Statement PDF Extractor ───
// Processes ONE PAGE per invocation (with the page split into thirds by the AI extractor).
// Saves progress after each page. Loops back to this node for the next page.
// Handles large PDFs (50+ pages) without timeout issues.
async function handleBankStatementExtract(
  flow: FlowData,
  node: FlowNode,
  ctx: ExecutionContext,
  executionId: string,
  engagementId: string,
): Promise<NodeResult> {
  console.log(`[flow-engine] Bank statement extract for "${node.data.label}"`);

  // Find uploads from previous node output or context
  const prevNodeId = getPreviousNodeId(flow, node.id);
  const prevOutput = prevNodeId ? ctx.nodes[prevNodeId] : null;
  const uploads: { id?: string; fileName: string; storagePath: string; containerName: string }[] =
    prevOutput?.uploads || [];

  if (uploads.length === 0) {
    return {
      action: 'continue',
      nextNodeId: getNextNodeId(flow, node.id),
      output: { extracted: false, message: 'No uploaded files found from previous node', statements: [], allTransactions: [] },
    };
  }

  // Resume from saved progress
  const saved = ctx.nodes[node.id] || {};
  const allTransactions: any[] = saved.allTransactions || [];
  const statements: any[] = saved.statements || [];
  let totalTokens: number = saved.aiTokensUsed || 0;
  // Work queue: [{fileIdx, pageIdx}] — built once, then consumed page by page
  let workQueue: { fileIdx: number; pageIdx: number; totalPages: number }[] = saved.workQueue || [];
  let workIndex: number = saved.workIndex || 0;

  const { downloadBlob } = await import('@/lib/azure-blob');

  // First invocation: build the work queue by counting pages in each PDF
  if (workQueue.length === 0) {
    console.log(`[flow-engine] Building work queue for ${uploads.length} files...`);
    for (let fi = 0; fi < uploads.length; fi++) {
      const u = uploads[fi];
      const fname = (u.fileName || '').toLowerCase();
      if (!fname.endsWith('.pdf') && !fname.endsWith('.png') && !fname.endsWith('.jpg') && !fname.endsWith('.jpeg')) continue;

      let pageCount = 1;
      if (fname.endsWith('.pdf')) {
        try {
          const buffer = await downloadBlob(u.storagePath, u.containerName || 'upload-inbox');
          const { PDFDocument } = await import('pdf-lib');
          const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
          pageCount = doc.getPageCount();
        } catch { /* assume 1 page */ }
      }
      for (let pi = 0; pi < pageCount; pi++) {
        workQueue.push({ fileIdx: fi, pageIdx: pi, totalPages: pageCount });
      }
    }
    console.log(`[flow-engine] Work queue: ${workQueue.length} pages across ${uploads.length} files`);
  }

  // All pages done?
  if (workIndex >= workQueue.length) {
    // Deduplicate transactions from overlapping thirds
    const seen = new Set<string>();
    const deduped: any[] = [];
    for (const txn of allTransactions) {
      const key = `${txn.date}|${txn.description}|${txn.debit}|${txn.credit}`;
      if (!seen.has(key)) { seen.add(key); deduped.push(txn); }
    }
    const dupsRemoved = allTransactions.length - deduped.length;
    console.log(`[flow-engine] All pages done: ${deduped.length} txns (${dupsRemoved} dups removed) from ${statements.length} files`);

    return {
      action: 'continue',
      nextNodeId: getNextNodeId(flow, node.id),
      output: {
        extracted: true, statements, allTransactions: deduped,
        transactionCount: deduped.length, fileCount: statements.length,
        dataTable: deduped, aiTokensUsed: totalTokens,
      },
    };
  }

  // Try Azure Document Intelligence first — processes entire PDF in seconds
  if (!saved.azureDIAttempted) {
    try {
      const { isAzureDIConfigured, extractBankStatementWithAzureDI } = await import('@/lib/azure-document-intelligence');
      if (isAzureDIConfigured()) {
        const { downloadBlob } = await import('@/lib/azure-blob');
        console.log(`[flow-engine] Using Azure Document Intelligence for fast extraction`);

        for (let fi = 0; fi < uploads.length; fi++) {
          const u = uploads[fi];
          const fname = (u.fileName || '').toLowerCase();
          if (!fname.endsWith('.pdf') && !fname.endsWith('.png') && !fname.endsWith('.jpg') && !fname.endsWith('.jpeg')) continue;

          try {
            const buffer = await downloadBlob(u.storagePath, u.containerName || 'upload-inbox');
            const result = await extractBankStatementWithAzureDI(buffer, u.fileName);

            statements.push({
              fileName: u.fileName, bankName: result.bankName, sortCode: result.sortCode,
              accountNumber: result.accountNumber, statementDate: result.statementDate,
              openingBalance: result.openingBalance, closingBalance: result.closingBalance,
              currency: result.currency, transactionCount: result.transactions.length,
            });
            for (const txn of result.transactions) {
              allTransactions.push({ ...txn, sourceFile: u.fileName, accountNumber: result.accountNumber });
            }
            console.log(`[flow-engine] Azure DI: ${result.transactions.length} txns from ${u.fileName}`);
          } catch (err) {
            console.error(`[flow-engine] Azure DI failed for ${u.fileName}:`, (err as Error).message);
            statements.push({ fileName: u.fileName, error: (err as Error).message, transactionCount: 0 });
          }

          // Save progress after each file
          await prisma.testExecution.update({
            where: { id: executionId },
            data: { context: { ...ctx, nodes: { ...ctx.nodes, [node.id]: {
              extracted: false, statements, allTransactions, transactionCount: allTransactions.length,
              azureDIAttempted: true, workQueue: [], workIndex: 0,
              progress: `Azure DI: ${fi + 1}/${uploads.length} files`,
            } } } as any },
          });
        }

        // All files done via Azure DI
        const deduped = deduplicateTransactions(allTransactions);
        console.log(`[flow-engine] Azure DI complete: ${deduped.length} txns from ${statements.length} files`);
        return {
          action: 'continue',
          nextNodeId: getNextNodeId(flow, node.id),
          output: { extracted: true, statements, allTransactions: deduped, transactionCount: deduped.length, fileCount: statements.length, dataTable: deduped },
        };
      }
    } catch (err) {
      console.warn(`[flow-engine] Azure DI not available, falling back to AI vision:`, (err as Error).message);
    }
  }

  // ── Fallback: AI vision page-by-page (slow but works without Azure DI) ──

  // Process ONE page this invocation
  const work = workQueue[workIndex];
  const upload = uploads[work.fileIdx];
  console.log(`[flow-engine] Page ${workIndex + 1}/${workQueue.length}: ${upload.fileName} page ${work.pageIdx + 1}/${work.totalPages}`);

  try {
    const buffer = await downloadBlob(upload.storagePath, upload.containerName || 'upload-inbox');
    const fname = (upload.fileName || '').toLowerCase();

    if (fname.endsWith('.pdf')) {
      // Extract single page as its own PDF and send to the AI extractor
      const { PDFDocument } = await import('pdf-lib');
      const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
      const singlePageDoc = await PDFDocument.create();
      const [copiedPage] = await singlePageDoc.copyPages(pdfDoc, [work.pageIdx]);
      singlePageDoc.addPage(copiedPage);
      const singlePageBytes = await singlePageDoc.save();
      const base64 = Buffer.from(singlePageBytes).toString('base64');

      const { extractBankStatementFromBase64 } = await import('@/lib/ai-extractor');
      const result = await extractBankStatementFromBase64(base64, 'application/pdf', `${upload.fileName}_p${work.pageIdx + 1}`);

      // Collect metadata from first page
      if (work.pageIdx === 0) {
        statements.push({
          fileName: upload.fileName, bankName: result.bankName, sortCode: result.sortCode,
          accountNumber: result.accountNumber, statementDate: result.statementDate,
          openingBalance: result.openingBalance, closingBalance: result.closingBalance,
          currency: result.currency, transactionCount: 0, totalPages: work.totalPages,
        });
      }

      // Add transactions with source reference
      const stmt = statements.find((s: any) => s.fileName === upload.fileName);
      for (const txn of result.transactions) {
        allTransactions.push({ ...txn, sourceFile: upload.fileName, accountNumber: stmt?.accountNumber || result.accountNumber, page: work.pageIdx + 1 });
      }
      if (stmt) stmt.transactionCount = (stmt.transactionCount || 0) + result.transactions.length;

      totalTokens += (result.usage?.totalTokens || 0);
      console.log(`[flow-engine] Page ${work.pageIdx + 1}: ${result.transactions.length} txns extracted`);
    } else {
      // Image file — process directly
      const base64 = buffer.toString('base64');
      const mimeType = fname.endsWith('.png') ? 'image/png' : 'image/jpeg';
      const { extractBankStatementFromBase64 } = await import('@/lib/ai-extractor');
      const result = await extractBankStatementFromBase64(base64, mimeType, upload.fileName);
      statements.push({
        fileName: upload.fileName, bankName: result.bankName, sortCode: result.sortCode,
        accountNumber: result.accountNumber, transactionCount: result.transactions.length,
      });
      for (const txn of result.transactions) {
        allTransactions.push({ ...txn, sourceFile: upload.fileName, accountNumber: result.accountNumber });
      }
      totalTokens += (result.usage?.totalTokens || 0);
    }
  } catch (err) {
    console.error(`[flow-engine] Failed page ${work.pageIdx + 1} of ${upload.fileName}:`, (err as Error).message);
    // Don't fail the whole extraction — skip this page
  }

  workIndex++;

  // Save progress
  const progressOutput = {
    extracted: false, statements, allTransactions,
    transactionCount: allTransactions.length, aiTokensUsed: totalTokens,
    workQueue, workIndex,
    progress: `Page ${workIndex}/${workQueue.length}`,
  };

  await prisma.testExecution.update({
    where: { id: executionId },
    data: { context: { ...ctx, nodes: { ...ctx.nodes, [node.id]: progressOutput } } as any },
  });

  // Loop back for the next page
  if (workIndex < workQueue.length) {
    return { action: 'continue', nextNodeId: node.id, output: progressOutput };
  }

  // Final page done — deduplicate and finish
  const seen = new Set<string>();
  const deduped: any[] = [];
  for (const txn of allTransactions) {
    const key = `${txn.date}|${txn.description}|${txn.debit}|${txn.credit}`;
    if (!seen.has(key)) { seen.add(key); deduped.push(txn); }
  }

  console.log(`[flow-engine] Extract complete: ${deduped.length} txns from ${workQueue.length} pages`);
  return {
    action: 'continue',
    nextNodeId: getNextNodeId(flow, node.id),
    output: { ...progressOutput, extracted: true, allTransactions: deduped, dataTable: deduped, transactionCount: deduped.length },
  };
}

// ─── Process Bank Data ───
// Merges multi-page statement data per account, flattens headers into every row,
// trims to engagement period, and translates foreign currency via FX rates.
async function handleProcessBankData(
  flow: FlowData,
  node: FlowNode,
  ctx: ExecutionContext,
  executionId: string,
  engagementId: string,
): Promise<NodeResult> {
  console.log(`[flow-engine] Processing bank data for "${node.data.label}"`);

  // Get raw extracted data from previous node
  const prevNodeId = getPreviousNodeId(flow, node.id);
  const prevOutput = prevNodeId ? ctx.nodes[prevNodeId] : null;
  const rawStatements: any[] = prevOutput?.statements || [];
  const rawTransactions: any[] = prevOutput?.allTransactions || prevOutput?.dataTable || [];

  if (rawTransactions.length === 0) {
    return {
      action: 'continue',
      nextNodeId: getNextNodeId(flow, node.id),
      output: { processed: false, message: 'No transaction data from previous node', dataTable: [], transactionCount: 0 },
    };
  }

  // Get engagement period for trimming
  const periodStart = ctx.engagement.periodStart; // YYYY-MM-DD
  const periodEnd = ctx.engagement.periodEnd;

  // Look up functional currency from Permanent File
  let functionalCurrency = 'GBP'; // default
  try {
    const engagement = await prisma.auditEngagement.findUnique({
      where: { id: engagementId },
      select: { id: true },
    });
    if (engagement) {
      const pfData = await prisma.auditPermanentFileData.findMany({
        where: { engagementId },
      });
      for (const pf of pfData) {
        const answers = pf.data as any;
        if (answers && typeof answers === 'object') {
          // Search for functional currency in permanent file answers
          for (const [key, val] of Object.entries(answers)) {
            if (key.toLowerCase().includes('functional') && key.toLowerCase().includes('currency') && typeof val === 'string' && val.length <= 5) {
              functionalCurrency = val.toUpperCase();
              break;
            }
          }
        }
      }
    }
  } catch (err) {
    console.warn(`[flow-engine] Failed to look up functional currency:`, (err as Error).message);
  }
  console.log(`[flow-engine] Functional currency: ${functionalCurrency}`);

  // Look up FX provider from firm settings
  let fxProvider = 'frankfurter';
  try {
    const execution = await prisma.testExecution.findUnique({
      where: { id: executionId },
      select: { firmId: true },
    });
    if (execution?.firmId) {
      const fxSetting = await prisma.methodologyRiskTable.findUnique({
        where: { firmId_tableType: { firmId: execution.firmId, tableType: 'fxProvider' } },
      });
      if (fxSetting?.data && (fxSetting.data as any).provider) {
        fxProvider = (fxSetting.data as any).provider;
      }
    }
  } catch { /* use default */ }

  // FX rate cache to avoid duplicate API calls for same currency+date
  const fxCache = new Map<string, number>();

  async function getFxRate(fromCurrency: string, toCurrency: string, date: string): Promise<number> {
    if (fromCurrency === toCurrency) return 1;
    const cacheKey = `${fromCurrency}_${toCurrency}_${date}`;
    if (fxCache.has(cacheKey)) return fxCache.get(cacheKey)!;

    let rate = 1;
    if (fxProvider === 'manual') {
      // Manual mode — no automatic lookup, rate stays 1
      fxCache.set(cacheKey, rate);
      return rate;
    }

    try {
      // Use frankfurter.app directly (server-side, no need for internal API call)
      const url = `https://api.frankfurter.app/${date}?from=${fromCurrency}&to=${toCurrency}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        if (data.rates?.[toCurrency]) {
          rate = data.rates[toCurrency];
        }
      }
    } catch (err) {
      console.warn(`[flow-engine] FX rate lookup failed for ${fromCurrency}→${toCurrency} on ${date}:`, (err as Error).message);
    }

    fxCache.set(cacheKey, rate);
    return rate;
  }

  // Process transactions: flatten headers, trim to period, FX translate
  const processedRows: any[] = [];
  let trimmedCount = 0;

  for (const txn of rawTransactions) {
    // Trim: skip transactions outside the engagement period
    if (txn.date && periodStart && periodEnd) {
      if (txn.date < periodStart || txn.date > periodEnd) {
        trimmedCount++;
        continue;
      }
    }

    const currency = (txn.currency || '').toUpperCase() || functionalCurrency;
    const fxRate = await getFxRate(currency, functionalCurrency, txn.date || periodEnd);

    processedRows.push({
      date: txn.date,
      description: txn.description || '',
      reference: txn.reference || '',
      debit: txn.debit || 0,
      credit: txn.credit || 0,
      balance: txn.balance || 0,
      bank: txn.bankName || txn.bank || '',
      accountHolder: txn.accountHolder || '',
      sortCode: txn.sortCode || '',
      accountNumber: txn.accountNumber || '',
      currency,
      tbAccountCode: txn.tbAccountCode || txn.sourceFile || '',
      functionalCurrency,
      fxRate,
      debitFC: Math.round((txn.debit || 0) * fxRate * 100) / 100,
      creditFC: Math.round((txn.credit || 0) * fxRate * 100) / 100,
      balanceFC: Math.round((txn.balance || 0) * fxRate * 100) / 100,
    });
  }

  console.log(`[flow-engine] Processed ${processedRows.length} transactions (trimmed ${trimmedCount} outside period ${periodStart} to ${periodEnd}), ${fxCache.size} FX lookups`);

  return {
    action: 'continue',
    nextNodeId: getNextNodeId(flow, node.id),
    output: {
      processed: true,
      dataTable: processedRows,
      transactionCount: processedRows.length,
      trimmedCount,
      functionalCurrency,
      fxProvider,
      fxRatesUsed: Object.fromEntries(fxCache),
      statements: rawStatements,
    },
  };
}

// ─── Store Extracted Data ───
// Persists processed data to AuditDocument library for reuse by other tests.
async function handleStoreExtractedData(
  flow: FlowData,
  node: FlowNode,
  ctx: ExecutionContext,
  executionId: string,
  engagementId: string,
): Promise<NodeResult> {
  const evidenceTag = node.data.evidenceTag || node.data.executionDef?.evidenceTag || 'extracted_data';
  console.log(`[flow-engine] Storing extracted data as AuditDocument, tag="${evidenceTag}"`);

  // Get data from previous node
  const prevNodeId = getPreviousNodeId(flow, node.id);
  const prevOutput = prevNodeId ? ctx.nodes[prevNodeId] : null;
  const dataTable = prevOutput?.dataTable || [];
  const statements = prevOutput?.statements || [];

  if (dataTable.length === 0) {
    return {
      action: 'continue',
      nextNodeId: getNextNodeId(flow, node.id),
      output: { stored: false, message: 'No data to store', documentCount: 0 },
    };
  }

  // Group transactions by account number for separate documents
  const byAccount = new Map<string, any[]>();
  for (const row of dataTable) {
    const key = row.accountNumber || row.tbAccountCode || 'unknown';
    if (!byAccount.has(key)) byAccount.set(key, []);
    byAccount.get(key)!.push(row);
  }

  const documentIds: string[] = [];

  for (const [accountKey, rows] of byAccount) {
    const firstRow = rows[0];
    const docName = `${evidenceTag} — ${accountKey} ${firstRow.bank || ''} ${firstRow.accountHolder || ''}`.trim();

    // Store as JSON blob in Azure
    const jsonData = JSON.stringify({ rows, metadata: { evidenceTag, accountKey, transactionCount: rows.length, functionalCurrency: firstRow.functionalCurrency } });
    const blobName = `extracted-data/${engagementId}/${evidenceTag}/${accountKey}.json`;

    try {
      const { uploadToInbox } = await import('@/lib/azure-blob');
      await uploadToInbox(blobName, Buffer.from(jsonData, 'utf-8'), 'application/json');

      // Create or update AuditDocument
      const existing = await prisma.auditDocument.findFirst({
        where: { engagementId, documentName: docName },
      });

      if (existing) {
        await prisma.auditDocument.update({
          where: { id: existing.id },
          data: { storagePath: blobName, containerName: 'upload-inbox', uploadedDate: new Date(), mappedItems: { evidenceTag, rows: rows.length } as any },
        });
        documentIds.push(existing.id);
      } else {
        const doc = await prisma.auditDocument.create({
          data: {
            engagementId,
            documentName: docName,
            storagePath: blobName,
            containerName: 'upload-inbox',
            uploadedDate: new Date(),
            mappedItems: { evidenceTag, rows: rows.length } as any,
          },
        });
        documentIds.push(doc.id);
      }
    } catch (err) {
      console.error(`[flow-engine] Failed to store document for ${accountKey}:`, (err as Error).message);
    }
  }

  console.log(`[flow-engine] Stored ${documentIds.length} documents for tag="${evidenceTag}"`);

  return {
    action: 'continue',
    nextNodeId: getNextNodeId(flow, node.id),
    output: {
      stored: true,
      evidenceTag,
      documentCount: documentIds.length,
      documentIds,
      totalRows: dataTable.length,
      accountCount: byAccount.size,
    },
  };
}

// ─── Accounting System Extractor ───
// Calls the connected accounting system API directly (no AI)
// ─── Fetch Evidence: Xero first, Portal fallback ───

async function handleFetchEvidenceOrPortal(
  flow: FlowData,
  node: FlowNode,
  ctx: ExecutionContext,
  executionId: string,
  engagementId: string,
): Promise<NodeResult> {
  // Get the current loop item (reference, amount, etc.)
  const loopItem = ctx.loop?.currentItem || {};
  const reference = loopItem.reference || loopItem.invoiceNumber || loopItem.ref || '';
  const description = loopItem.description || '';

  // Try to fetch from accounting system first
  const engagement = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    select: { clientId: true },
  });

  if (engagement) {
    const connection = await prisma.accountingConnection.findFirst({
      where: { clientId: engagement.clientId },
    });

    if (connection && new Date() <= connection.expiresAt && connection.system.toLowerCase() === 'xero' && reference) {
      try {
        // Try to get the invoice from Xero by reference/invoice number
        const { getInvoiceByNumber } = await import('./xero');
        const invoice = await getInvoiceByNumber(engagement.clientId, reference);
        if (invoice) {
          return {
            action: 'continue',
            nextNodeId: getNextNodeId(flow, node.id),
            output: {
              evidenceSource: 'accounting_system',
              system: connection.system,
              found: true,
              invoice,
              reference,
              fileName: `${reference}_xero.json`,
            },
          };
        }
      } catch (err) {
        console.log(`[flow-engine] Xero invoice lookup failed for ${reference}: ${(err as Error).message}`);
        // Fall through to portal request
      }
    }
  }

  // Fallback: create portal request
  const portalTemplate = node.data?.executionDef?.portalFallbackTemplate || {
    subject: `Evidence Required: ${reference || description}`,
    message: `Please provide the supporting document for: ${description} (${reference})`,
  };

  // Resolve template placeholders
  const subject = (portalTemplate.subject || '')
    .replace(/\{\{reference\}\}/g, reference)
    .replace(/\{\{description\}\}/g, description)
    .replace(/\{\{amount\}\}/g, String(loopItem.amount || ''))
    .replace(/\{\{date\}\}/g, loopItem.date || '');
  const message = (portalTemplate.message || '')
    .replace(/\{\{reference\}\}/g, reference)
    .replace(/\{\{description\}\}/g, description)
    .replace(/\{\{amount\}\}/g, String(loopItem.amount || ''))
    .replace(/\{\{date\}\}/g, loopItem.date || '');

  try {
    const item = await prisma.outstandingItem.create({
      data: {
        engagementId,
        executionId,
        nodeId: node.id,
        type: 'portal_request',
        title: subject,
        description: message,
        source: 'flow',
        status: 'awaiting_client',
        flowNodeType: 'action',
      },
    });

    return {
      action: 'pause',
      pauseReason: 'portal_response',
      pauseRefId: item.id,
      output: {
        evidenceSource: 'portal_request',
        found: false,
        portalRequestCreated: true,
        outstandingItemId: item.id,
        reference,
      },
    };
  } catch (err) {
    return { action: 'error', errorMessage: `Failed to create evidence request: ${(err as Error).message}` };
  }
}

async function handleAccountingExtract(
  flow: FlowData,
  node: FlowNode,
  ctx: ExecutionContext,
  executionId: string,
  engagementId: string,
  cutoffMode: boolean = false,
  fallbackToBankData: boolean = false,
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
    if (fallbackToBankData) {
      // No accounting connection — try to use previously extracted bank statement data
      let bankData: any[] = [];
      let bankSource = '';
      for (const [, nodeOut] of Object.entries(ctx.nodes)) {
        const out = nodeOut as any;
        if (!out) continue;
        if (out.dataTable?.length > 0 && bankData.length === 0) { bankData = out.dataTable; bankSource = 'Previous flow step'; }
        if (out.populationData?.length > 0 && bankData.length === 0) { bankData = out.populationData; bankSource = 'Previous flow step'; }
      }
      // Also check for stored bank data via require_prior_evidence
      if (bankData.length === 0) {
        try {
          const docs = await prisma.auditDocument.findMany({
            where: { engagementId },
            orderBy: { createdAt: 'desc' },
          });
          const bankDocs = docs.filter(d => {
            const items = d.mappedItems as any;
            return Array.isArray(items) ? items.includes('bank_data') : false;
          }).slice(0, 1);
          if (bankDocs[0]?.storagePath) {
            const { downloadBlob } = await import('@/lib/azure-blob');
            const buffer = await downloadBlob(bankDocs[0].storagePath, 'upload-inbox');
            try { bankData = JSON.parse(buffer.toString('utf-8')); bankSource = `Stored bank data (${bankDocs[0].documentName || bankDocs[0].id})`; } catch {}
          }
        } catch {}
      }
      if (bankData.length > 0) {
        return {
          action: 'continue',
          nextNodeId: getNextNodeId(flow, node.id),
          output: {
            populationData: bankData, dataTable: bankData, rowCount: bankData.length,
            source: 'bank_statements', fallbackUsed: true,
            decisionLog: [
              { step: 'Check accounting connection', result: 'No accounting system connected for this client' },
              { step: 'Fallback to bank statement data', result: `Found ${bankData.length} transactions from: ${bankSource}` },
            ],
            summary: `No accounting system connected. Used bank statement data (${bankData.length} transactions) from: ${bankSource}.`,
          },
        };
      }
      return { action: 'error', errorMessage: 'No accounting system connected and no bank statement data available. Connect Xero via the Opening tab, or extract bank statements first.' };
    }
    return { action: 'error', errorMessage: 'No accounting system connected for this client. Connect via the Opening tab → Connection section.' };
  }

  // Check if connection is expired
  if (new Date() > connection.expiresAt) {
    return { action: 'error', errorMessage: `${connection.system} connection expired on ${connection.expiresAt.toLocaleDateString()}. Please reconnect via the Opening tab.` };
  }

  // Get account codes — resolve merged codes to real codes via originalAccountCode
  const accountCode = ctx.test.tbRow?.accountCode || '';
  let accountCodes: string[] = [];
  if (accountCode) {
    // Check if this is a merged code by looking for TB rows with this accountCode that have originalAccountCode set
    const mergedRows = await prisma.auditTBRow.findMany({
      where: { engagementId, accountCode, originalAccountCode: { not: null } },
      select: { originalAccountCode: true },
    });
    if (mergedRows.length > 0) {
      // Use all original (real) account codes from the merged group
      accountCodes = mergedRows.map(r => r.originalAccountCode!).filter(Boolean);
    } else {
      accountCodes = [accountCode];
    }
  }

  // Get date range — cutoff mode uses a narrow window around period end
  let dateFrom: string;
  let dateTo: string;
  if (cutoffMode && engagement.period?.endDate) {
    const periodEnd = new Date(engagement.period.endDate);
    const windowStart = new Date(periodEnd);
    windowStart.setDate(windowStart.getDate() - 14); // 2 weeks before
    const windowEnd = new Date(periodEnd);
    windowEnd.setDate(windowEnd.getDate() + 14); // 2 weeks after
    dateFrom = windowStart.toISOString().split('T')[0];
    dateTo = windowEnd.toISOString().split('T')[0];
  } else {
    dateFrom = engagement.period?.startDate
      ? new Date(engagement.period.startDate).toISOString().split('T')[0]
      : new Date(new Date().getFullYear(), 0, 1).toISOString().split('T')[0];
    dateTo = engagement.period?.endDate
      ? new Date(engagement.period.endDate).toISOString().split('T')[0]
      : new Date().toISOString().split('T')[0];
  }

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

    const dateDesc = cutoffMode ? `Cut-off window: ${dateFrom} to ${dateTo}` : `Full period: ${dateFrom} to ${dateTo}`;
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
        ...(cutoffMode && { cutoffMode: true, periodEnd: engagement.period?.endDate?.toISOString().split('T')[0] }),
        decisionLog: [
          { step: 'Check accounting connection', result: `Connected to ${connection.system} (${connection.orgName || 'N/A'})` },
          { step: 'Determine date range', result: dateDesc },
          { step: 'Extract transactions', result: `Retrieved ${populationData.length} transactions for account codes: ${accountCodes.join(', ') || 'all'} in ${duration}ms` },
        ],
        summary: `Extracted ${populationData.length} transactions from ${connection.system} (${connection.orgName || ''}). ${dateDesc}. Account codes: ${accountCodes.join(', ') || 'all'}.`,
      },
    };
  } catch (err: any) {
    return { action: 'error', errorMessage: `Failed to extract data from ${connection.system}: ${err.message || 'Unknown error'}` };
  }
}

// ─── Verify Evidence Handler ───
// AI verifies uploaded evidence against sample items using assertion-driven checks.
// Assertions are read from the MethodologyTest at runtime (not hardcoded).
async function handleVerifyEvidence(
  flow: FlowData,
  node: FlowNode,
  ctx: ExecutionContext,
  executionId: string,
  engagementId: string,
): Promise<NodeResult> {
  const startTime = Date.now();

  // Get the test's assertions from the MethodologyTest
  let assertions: string[] = [];
  const testDescription = ctx.test?.description || '';

  // Try to find the test by name to get its assertions
  const test = await prisma.methodologyTest.findFirst({
    where: { name: testDescription, isActive: true },
    select: { assertions: true },
  });
  if (test?.assertions && Array.isArray(test.assertions)) {
    assertions = test.assertions as string[];
  }

  // Collect sample items and evidence from previous flow steps
  let sampleItems: any[] = [];
  let evidenceData: any[] = [];

  for (const [, nodeOut] of Object.entries(ctx.nodes)) {
    const out = nodeOut as any;
    if (!out) continue;
    // Sample items from sampling step
    if (out.selectedIndices?.length > 0 && sampleItems.length === 0) {
      const popData = Object.values(ctx.nodes).find((n: any) => n?.populationData?.length > 0) as any;
      if (popData?.populationData) {
        sampleItems = out.selectedIndices.map((idx: number) => popData.populationData[idx]).filter(Boolean);
      }
    }
    if (out.sampleItems?.length > 0 && sampleItems.length === 0) sampleItems = out.sampleItems;
    if (out.populationData?.length > 0 && sampleItems.length === 0) sampleItems = out.populationData;
    // Evidence from portal responses or uploads
    if (out.parsedFiles?.length > 0) evidenceData.push(...out.parsedFiles);
    if (out.evidenceData?.length > 0) evidenceData.push(...out.evidenceData);
  }

  // Build verification prompt based on assertions
  const assertionChecks = assertions.length > 0
    ? assertions.map(a => {
        const checks: Record<string, string> = {
          'Completeness': 'Check all items have supporting evidence. Flag any missing documents.',
          'Occurrence & Accuracy': 'Verify amounts match exactly between the ledger and evidence. Report any differences.',
          'Cut Off': 'Verify transaction dates fall within the audit period. Flag any items outside the period.',
          'Classification': 'Verify the transaction is recorded in the correct account classification.',
          'Presentation': 'Verify proper presentation and disclosure.',
          'Existence': 'Verify the transaction/asset exists — check for genuine evidence of goods/services.',
          'Valuation': 'Verify the valuation amount is correctly calculated.',
          'Rights & Obligations': 'Verify the entity on the evidence is the audit client.',
        };
        return checks[a] || `Check: ${a}`;
      }).join('\n')
    : 'Check amount match, date match, period correctness, and consistency of description.';

  const systemPrompt = `You are a UK statutory auditor performing substantive testing. For each sample item, verify it against the evidence provided. Be precise and reference specific figures. Return results as a JSON array.`;

  const userPrompt = `Verify the following ${sampleItems.length} sample items against available evidence.

ASSERTIONS TO CHECK:
${assertionChecks}

ALWAYS CHECK: Is the description on the evidence consistent with the account code description? (Consistency check)

SAMPLE ITEMS:
${JSON.stringify(sampleItems.slice(0, 30), null, 2)}

EVIDENCE:
${JSON.stringify(evidenceData.slice(0, 30), null, 2)}

For each sample item, return a JSON array with objects containing:
- itemIndex (number)
- checks: object with keys for each check performed, values "pass"|"fail"|"pending"
- overallResult: "pass"|"fail"
- notes: brief explanation of findings
- difference: numeric difference if amount mismatch (0 if matched)

Return ONLY the JSON array, no other text.`;

  try {
    const aiResult = await callAI(systemPrompt, userPrompt);
    const duration = Date.now() - startTime;

    let verificationResults: any[] = [];
    try {
      const jsonMatch = aiResult.text.match(/\[[\s\S]*\]/);
      if (jsonMatch) verificationResults = JSON.parse(jsonMatch[0]);
    } catch {
      // AI didn't return valid JSON
    }

    return {
      action: 'continue',
      nextNodeId: getNextNodeId(flow, node.id),
      output: {
        verificationResults,
        assertions,
        sampleCount: sampleItems.length,
        evidenceCount: evidenceData.length,
        passCount: verificationResults.filter((r: any) => r.overallResult === 'pass').length,
        failCount: verificationResults.filter((r: any) => r.overallResult === 'fail').length,
        raw: aiResult.text,
        model: aiResult.model,
        tokensUsed: aiResult.tokensUsed,
        duration,
      },
    };
  } catch (err: any) {
    return { action: 'error', errorMessage: `Evidence verification failed: ${err.message || 'Unknown error'}` };
  }
}

// ─── Programmatic Bank-to-TB Comparison ───

async function handleCompareBankToTB(
  flow: FlowData,
  node: FlowNode,
  ctx: ExecutionContext,
  executionId: string,
  engagementId: string,
): Promise<NodeResult> {
  try {
    // 1. Find bank statement data from previous nodes
    let bankData: any[] = [];
    for (const [, nodeOut] of Object.entries(ctx.nodes)) {
      const out = nodeOut as any;
      if (!out) continue;
      if (out.dataTable?.length > 0 && bankData.length === 0) bankData = out.dataTable;
      if (out.populationData?.length > 0 && bankData.length === 0) bankData = out.populationData;
    }

    if (bankData.length === 0) {
      return { action: 'error', errorMessage: 'No bank statement data found. Ensure bank data is extracted before running this test.' };
    }

    // 2. Get TB data
    const tbAccounts = (ctx.tb as any)?.accounts || [];
    if (tbAccounts.length === 0) {
      return { action: 'error', errorMessage: 'No trial balance data available for this FS line.' };
    }

    // 3. Extract closing balances per bank account
    // Group transactions by account number, take last balance as closing balance
    // Also collect all unique identifiers from bank data for matching
    const accountBalances = new Map<string, { accountNumber: string; closingBalance: number; transactionCount: number; lastDate: string; allIdentifiers: Set<string> }>();
    for (const txn of bankData) {
      const accNum = txn.accountNumber || '';
      // Also extract account number from tbAccountCode (PDF filename like "Statement 13-FEB-25 AC 70540862...")
      const tbAccCodeMatch = (txn.tbAccountCode || '').match(/AC\s*(\d+)/i) || (txn.tbAccountCode || '').match(/(\d{6,})/);
      const extractedAcc = tbAccCodeMatch?.[1] || '';
      const primaryKey = accNum || extractedAcc || '';
      if (!primaryKey) continue;

      const existing = accountBalances.get(primaryKey);
      const balance = Number(txn.balance || txn.balanceFC || 0);
      const date = txn.date || '';

      const identifiers = existing?.allIdentifiers || new Set<string>();
      if (accNum) identifiers.add(accNum);
      if (extractedAcc) identifiers.add(extractedAcc);
      // Extract sort code if present
      if (txn.sortCode) identifiers.add(txn.sortCode);
      // Add account holder name
      if (txn.accountHolder) identifiers.add(txn.accountHolder.toLowerCase());
      // Add bank name from description
      if (txn.bank) identifiers.add(txn.bank.toLowerCase());

      if (!existing || date >= existing.lastDate) {
        accountBalances.set(primaryKey, {
          accountNumber: primaryKey,
          closingBalance: balance,
          transactionCount: (existing?.transactionCount || 0) + 1,
          lastDate: date,
          allIdentifiers: identifiers,
        });
      } else if (existing) {
        existing.transactionCount++;
        existing.allIdentifiers = identifiers;
      }
    }

    // 4. Compare to TB — smart matching using multiple identifiers
    const clearlyTrivial = (ctx.engagement as any)?.clearlyTrivial || 0;
    const results: any[] = [];
    let totalDifference = 0;
    let matchCount = 0;
    let differenceCount = 0;

    for (const tbAcc of tbAccounts) {
      const tbBalance = Number(tbAcc.currentYear || 0);
      const tbCode = (tbAcc.code || '').toLowerCase();
      const tbDesc = (tbAcc.description || '').toLowerCase();
      // Extract any numbers from TB description that look like account numbers (6+ digits)
      const tbNumbers = (tbAcc.description || '').match(/\d{6,}/g) || [];

      // Try multiple matching strategies
      const bankAcc = Array.from(accountBalances.values()).find(ba => {
        // Direct: TB code or description contains bank account number
        if (ba.accountNumber && (tbCode.includes(ba.accountNumber) || tbDesc.includes(ba.accountNumber))) return true;
        // Reverse: bank identifiers contain numbers found in TB description
        for (const num of tbNumbers) {
          if (ba.allIdentifiers.has(num)) return true;
        }
        // Fuzzy: bank identifiers overlap with TB description words
        for (const ident of ba.allIdentifiers) {
          if (ident.length > 3 && tbDesc.includes(ident)) return true;
        }
        return false;
      });

      if (bankAcc) {
        const diff = Math.abs(tbBalance) - Math.abs(bankAcc.closingBalance);
        const absDiff = Math.abs(diff);
        const status = absDiff <= 0.01 ? 'matched' : absDiff <= clearlyTrivial ? 'immaterial_difference' : 'material_difference';
        results.push({
          accountCode: tbAcc.code,
          accountName: tbAcc.description,
          bankAccountNumber: bankAcc.accountNumber,
          bankBalance: bankAcc.closingBalance,
          tbBalance,
          difference: diff,
          transactionCount: bankAcc.transactionCount,
          status,
        });
        totalDifference += absDiff;
        if (status === 'matched' || status === 'immaterial_difference') matchCount++;
        else differenceCount++;
      } else {
        results.push({
          accountCode: tbAcc.code,
          accountName: tbAcc.description,
          bankAccountNumber: null,
          bankBalance: null,
          tbBalance,
          difference: null,
          transactionCount: 0,
          status: tbBalance === 0 ? 'zero_balance' : 'no_bank_data',
        });
      }
    }

    // 5. Collect bank metadata from statement data in previous nodes
    const bankMeta: any[] = [];
    for (const [, nodeOut] of Object.entries(ctx.nodes)) {
      const out = nodeOut as any;
      if (!out?.statements) continue;
      for (const stmt of out.statements) {
        if (stmt.bankName || stmt.accountNumber) {
          bankMeta.push({
            bankName: stmt.bankName || '',
            sortCode: stmt.sortCode || '',
            accountNumber: stmt.accountNumber || '',
            accountHolder: stmt.accountHolder || '',
            statementDate: stmt.statementDate || '',
            fileName: stmt.fileName || '',
            closingBalance: stmt.closingBalance,
            openingBalance: stmt.openingBalance,
            currency: stmt.currency || 'GBP',
          });
        }
      }
    }

    // 6. Build document references for preview links
    const documentRefs: any[] = [];
    for (const [, nodeOut] of Object.entries(ctx.nodes)) {
      const out = nodeOut as any;
      if (out?.documents?.length > 0) {
        for (const doc of out.documents) {
          documentRefs.push({ id: doc.id, name: doc.documentName || doc.fileName, storagePath: doc.storagePath });
        }
      }
    }

    // 7. Determine overall result
    const overallResult = differenceCount > 0 ? 'fail' : 'pass';
    const summary = `Compared ${bankData.length} bank transactions across ${accountBalances.size} account(s) to ${tbAccounts.length} TB account(s). ${matchCount} matched, ${differenceCount} with material differences. Total absolute difference: £${totalDifference.toFixed(2)}.`;

    return {
      action: 'continue',
      nextNodeId: getNextNodeId(flow, node.id),
      output: {
        result: overallResult,
        summary,
        // Simple 3-figure comparison table
        comparisons: results,
        dataTable: results,
        // Bank metadata
        bankMetadata: bankMeta,
        documentRefs,
        // Counts
        bankAccountCount: accountBalances.size,
        tbAccountCount: tbAccounts.length,
        totalTransactions: bankData.length,
        totalDifference,
        matchCount,
        differenceCount,
        clearlyTrivialThreshold: clearlyTrivial,
      },
    };
  } catch (err: any) {
    return { action: 'error', errorMessage: `Bank-to-TB comparison failed: ${err.message}` };
  }
}

// ─── Programmatic Cut-Off Analysis ───

async function handleAnalyseCutOff(
  flow: FlowData, node: FlowNode, ctx: ExecutionContext, executionId: string, engagementId: string,
): Promise<NodeResult> {
  try {
    let fullPopulation: any[] = [];
    let selectedIndices: number[] = [];
    for (const [, nodeOut] of Object.entries(ctx.nodes)) {
      const out = nodeOut as any;
      if (!out) continue;
      if (out.dataTable?.length > 0 && fullPopulation.length === 0) fullPopulation = out.dataTable;
      if (out.populationData?.length > 0 && fullPopulation.length === 0) fullPopulation = out.populationData;
      if (out.selectedIndices?.length > 0 && selectedIndices.length === 0) selectedIndices = out.selectedIndices;
    }
    if (fullPopulation.length === 0) return { action: 'error', errorMessage: 'No bank data found for cut-off analysis.' };

    // Use sampled items if sampling was done, otherwise full population
    const bankData = selectedIndices.length > 0
      ? selectedIndices.map(i => fullPopulation[i]).filter(Boolean)
      : fullPopulation;

    const periodEnd = (ctx.engagement as any)?.periodEnd;
    if (!periodEnd) return { action: 'error', errorMessage: 'No period end date available.' };

    const peDate = new Date(periodEnd);
    const windowStart = new Date(peDate); windowStart.setDate(windowStart.getDate() - 7);
    const windowEnd = new Date(peDate); windowEnd.setDate(windowEnd.getDate() + 7);

    // Check if bank data has dates
    const txnsWithDates = bankData.filter(txn => txn.date && txn.date.toString().trim());
    if (txnsWithDates.length === 0) {
      // No dates in bank data — try to extract from tbAccountCode (statement filename often has date)
      // Report this as an issue but not a failure
      const totalDebit = bankData.reduce((s, t) => s + Math.abs(Number(t.debit || t.debitFC || 0)), 0);
      const totalCredit = bankData.reduce((s, t) => s + Math.abs(Number(t.credit || t.creditFC || 0)), 0);
      return {
        action: 'continue', nextNodeId: getNextNodeId(flow, node.id),
        output: {
          result: 'inconclusive',
          summary: `Cut-off analysis could not be performed: ${bankData.length} bank transactions found but none have transaction dates. Total debits: £${totalDebit.toFixed(2)}, credits: £${totalCredit.toFixed(2)}. The bank statement data needs date fields populated for cut-off testing. Consider re-extracting bank statements with date parsing enabled.`,
          cutOffDate: periodEnd, totalTransactions: bankData.length,
          dataTable: [],
          issue: 'no_dates_in_bank_data',
        },
      };
    }

    // Filter transactions in the cut-off window
    const cutOffTxns = txnsWithDates.filter(txn => {
      const d = new Date(txn.date);
      return d >= windowStart && d <= windowEnd;
    });

    const beforePE = cutOffTxns.filter(t => new Date(t.date) <= peDate);
    const afterPE = cutOffTxns.filter(t => new Date(t.date) > peDate);
    const clearlyTrivial = (ctx.engagement as any)?.clearlyTrivial || 0;

    // Flag large items near cut-off
    const flagged = cutOffTxns.filter(t => {
      const amt = Math.abs(Number(t.debit || t.debitFC || 0)) + Math.abs(Number(t.credit || t.creditFC || 0));
      return amt > clearlyTrivial;
    }).map(t => ({
      date: t.date, description: t.description,
      amount: Number(t.debit || t.debitFC || 0) || Number(t.credit || t.creditFC || 0),
      accountNumber: t.accountNumber, type: new Date(t.date) <= peDate ? 'before_period_end' : 'after_period_end',
    }));

    const result = flagged.length > 0 ? 'fail' : 'pass';
    const samplingNote = selectedIndices.length > 0 ? ` (sampled ${bankData.length} from population of ${fullPopulation.length})` : ` (full population of ${bankData.length})`;
    const summary = `Cut-off window: ${windowStart.toISOString().slice(0, 10)} to ${windowEnd.toISOString().slice(0, 10)}${samplingNote}. ${txnsWithDates.length} dated transactions analysed. ${beforePE.length} before period end, ${afterPE.length} after. ${flagged.length} item(s) above CT (£${clearlyTrivial}) flagged for review.`;

    return {
      action: 'continue', nextNodeId: getNextNodeId(flow, node.id),
      output: { result, summary, cutOffDate: periodEnd, transactionsBefore: beforePE.length, transactionsAfter: afterPE.length, flaggedItems: flagged, dataTable: bankData, populationData: bankData, totalInWindow: cutOffTxns.length },
    };
  } catch (err: any) { return { action: 'error', errorMessage: `Cut-off analysis failed: ${err.message}` }; }
}

// ─── Programmatic Large & Unusual Transaction Analysis ───

async function handleAnalyseLargeUnusual(
  flow: FlowData, node: FlowNode, ctx: ExecutionContext, executionId: string, engagementId: string,
): Promise<NodeResult> {
  try {
    // 1. Get all transaction data
    let allTxns: any[] = [];
    for (const [, nodeOut] of Object.entries(ctx.nodes)) {
      const out = nodeOut as any;
      if (!out) continue;
      if (out.dataTable?.length > 0 && allTxns.length === 0) allTxns = out.dataTable;
      if (out.populationData?.length > 0 && allTxns.length === 0) allTxns = out.populationData;
    }
    if (allTxns.length === 0) return { action: 'error', errorMessage: 'No transaction data found.' };

    const pm = (ctx.engagement as any)?.performanceMateriality || 0;
    const ct = (ctx.engagement as any)?.clearlyTrivial || 0;

    // Load firm's configurable scoring rules (Methodology Admin can add/remove/adjust)
    const engagement = await prisma.auditEngagement.findUnique({ where: { id: engagementId }, select: { firmId: true } });
    const scoringTable = engagement ? await prisma.methodologyRiskTable.findUnique({
      where: { firmId_tableType: { firmId: engagement.firmId, tableType: 'large_unusual_scoring' } },
    }) : null;
    const scoringRules = (scoringTable?.data || {}) as any;

    // 2. Compute statistics for relative scoring
    const amounts = allTxns.map(t => Math.max(Math.abs(Number(t.debit || t.debitFC || t.amount || 0)), Math.abs(Number(t.credit || t.creditFC || 0)))).filter(a => a > 0);
    const totalValue = amounts.reduce((s, a) => s + a, 0);
    const meanAmt = amounts.length > 0 ? totalValue / amounts.length : 0;
    const stdDev = amounts.length > 0 ? Math.sqrt(amounts.reduce((s, a) => s + (a - meanAmt) ** 2, 0) / amounts.length) : 0;

    // Build a frequency map of descriptions to detect one-off vs recurring
    const descFreq = new Map<string, number>();
    for (const t of allTxns) {
      const key = (t.description || '').toLowerCase().trim().slice(0, 50);
      descFreq.set(key, (descFreq.get(key) || 0) + 1);
    }

    // Unusual nature patterns — from firm config or defaults
    const configuredPatterns = scoringRules.descriptionPatterns || [];
    const UNUSUAL_PATTERNS: { pattern: RegExp; category: string; weight: number }[] = configuredPatterns.length > 0
      ? configuredPatterns.map((p: any) => ({ pattern: new RegExp(p.pattern, 'i'), category: p.category, weight: p.weight }))
      : [
          { pattern: /director|shareholder|owner/i, category: 'Related party — director/shareholder', weight: 30 },
          { pattern: /loan|advance|lend/i, category: 'Loan/advance', weight: 25 },
          { pattern: /intercompany|group|subsidiary|parent/i, category: 'Intercompany/group', weight: 25 },
          { pattern: /related party/i, category: 'Related party', weight: 30 },
          { pattern: /refund|reversal|correction|adjust/i, category: 'Reversal/correction', weight: 15 },
          { pattern: /dividend|distribution/i, category: 'Distribution', weight: 20 },
          { pattern: /settlement|legal|solicitor|court/i, category: 'Legal/settlement', weight: 25 },
          { pattern: /penalty|fine|hmrc|tax/i, category: 'Tax/penalty', weight: 15 },
          { pattern: /cash|atm|withdraw/i, category: 'Cash withdrawal', weight: 20 },
          { pattern: /foreign|fx|transfer overseas|swift/i, category: 'Foreign/FX transfer', weight: 15 },
          { pattern: /consultancy|management fee|advisory/i, category: 'Consultancy/management fee', weight: 15 },
          { pattern: /donation|charity|gift/i, category: 'Donation/gift', weight: 20 },
          { pattern: /insurance|claim/i, category: 'Insurance/claim', weight: 10 },
          { pattern: /property|rent deposit|lease premium/i, category: 'Property/deposit', weight: 15 },
        ];

    // Scoring weights from config
    const sizeW = scoringRules.sizeScoring || { extreme3Sigma: 40, outlier2Sigma: 25, aboveAvg1Sigma: 10, abovePM: 20, aboveCT: 5 };
    const timingW = scoringRules.timingScoring || { weekend: 15, bankHoliday: 20 };
    const otherW = scoringRules.otherScoring || { roundThousands: 10, roundHundreds: 5, oneOff: 10, infrequent: 5, contraEntry: 10 };
    const thresholds = scoringRules.thresholds || { highRisk: 40, mediumRisk: 15 };

    // UK bank holidays
    const BANK_HOLIDAYS_2024 = ['2024-01-01','2024-03-29','2024-04-01','2024-05-06','2024-05-27','2024-08-26','2024-12-25','2024-12-26'];
    const BANK_HOLIDAYS_2025 = ['2025-01-01','2025-04-18','2025-04-21','2025-05-05','2025-05-26','2025-08-25','2025-12-25','2025-12-26'];
    const bankHolidays = new Set([...BANK_HOLIDAYS_2024, ...BANK_HOLIDAYS_2025]);

    // 3. Score EVERY transaction
    const scored = allTxns.map((txn: any, idx: number) => {
      const debit = Math.abs(Number(txn.debit || txn.debitFC || txn.amount || 0));
      const credit = Math.abs(Number(txn.credit || txn.creditFC || 0));
      const amt = Math.max(debit, credit);
      const desc = (txn.description || '').toLowerCase();
      const descKey = desc.trim().slice(0, 50);

      let score = 0;
      const reasons: string[] = [];

      // Size scoring — how large relative to the population
      if (amt > 0 && stdDev > 0) {
        const zScore = (amt - meanAmt) / stdDev;
        if (zScore > 3) { score += sizeW.extreme3Sigma; reasons.push(`Extreme outlier (${zScore.toFixed(1)}σ)`); }
        else if (zScore > 2) { score += sizeW.outlier2Sigma; reasons.push(`Statistical outlier (${zScore.toFixed(1)}σ)`); }
        else if (zScore > 1) { score += sizeW.aboveAvg1Sigma; reasons.push(`Above average (${zScore.toFixed(1)}σ)`); }
      }
      if (amt > pm && pm > 0) { score += sizeW.abovePM; reasons.push('Above Performance Materiality'); }
      else if (amt > ct && ct > 0) { score += sizeW.aboveCT; reasons.push('Above Clearly Trivial'); }

      // Round number
      if (amt >= 1000 && amt % 1000 === 0) { score += otherW.roundThousands; reasons.push('Round number (£' + amt.toLocaleString() + ')'); }
      if (amt >= 100 && amt % 100 === 0 && amt % 1000 !== 0) { score += otherW.roundHundreds; reasons.push('Round hundreds'); }

      // Timing — weekend, bank holiday
      const d = txn.date ? new Date(txn.date) : null;
      if (d && !isNaN(d.getTime())) {
        if (d.getDay() === 0 || d.getDay() === 6) { score += timingW.weekend; reasons.push('Weekend transaction'); }
        const dateStr = d.toISOString().split('T')[0];
        if (bankHolidays.has(dateStr)) { score += timingW.bankHoliday; reasons.push('Bank holiday transaction'); }
      }

      // Description / nature patterns
      for (const { pattern, category, weight } of UNUSUAL_PATTERNS) {
        if (pattern.test(txn.description || '')) { score += weight; reasons.push(category); }
      }

      // Rarity — one-off transactions score higher than recurring
      const freq = descFreq.get(descKey) || 1;
      if (freq === 1) { score += otherW.oneOff; reasons.push('One-off transaction (unique description)'); }
      else if (freq <= 3) { score += otherW.infrequent; reasons.push(`Infrequent (${freq} occurrences)`); }

      // Contra entries — opposite to the majority flow
      if (amt > ct) {
        const isDebit = debit > credit;
        const majorityDebit = amounts.length > 0 && allTxns.filter(t => Math.abs(Number(t.debit || t.debitFC || 0)) > Math.abs(Number(t.credit || t.creditFC || 0))).length > allTxns.length / 2;
        if (isDebit !== majorityDebit) { score += otherW.contraEntry; reasons.push('Contra entry (opposite to majority flow)'); }
      }

      return {
        _index: idx,
        _score: score,
        _reasons: reasons,
        _riskLevel: score >= thresholds.highRisk ? 'high' : score >= thresholds.mediumRisk ? 'medium' : 'low',
        _flagged: score >= thresholds.mediumRisk,
        ...txn,
      };
    });

    // 4. Sort by score (highest first) — this IS the output, ranked by unusualness
    scored.sort((a: any, b: any) => b._score - a._score);

    const flaggedItems = scored.filter((t: any) => t._flagged);
    const highRisk = flaggedItems.filter((t: any) => t._riskLevel === 'high').length;
    const mediumRisk = flaggedItems.filter((t: any) => t._riskLevel === 'medium').length;
    const flaggedValue = flaggedItems.reduce((s: number, t: any) => s + Math.max(Math.abs(Number(t.debit || t.debitFC || t.amount || 0)), Math.abs(Number(t.credit || t.creditFC || 0))), 0);

    const result = highRisk > 0 ? 'fail' : 'pass';
    const summary = `Scored and ranked ${allTxns.length} transactions. ${flaggedItems.length} flagged as large or unusual (${highRisk} high risk, ${mediumRisk} medium). Mean transaction: £${meanAmt.toFixed(2)}, Std Dev: £${stdDev.toFixed(2)}. PM: £${pm.toFixed(2)}, CT: £${ct.toFixed(2)}. Flagged value: £${flaggedValue.toFixed(2)}.`;

    return {
      action: 'continue', nextNodeId: getNextNodeId(flow, node.id),
      output: {
        result, summary,
        // Full population ranked by unusualness score — flagged items at top
        dataTable: scored,
        populationData: scored,
        flaggedItems,
        totalFlagged: flaggedItems.length, highRisk, mediumRisk,
        totalValueFlagged: flaggedValue,
        populationSize: allTxns.length,
        populationTotal: totalValue,
        statistics: { mean: meanAmt, stdDev, transactionCount: allTxns.length },
        decisionLog: [
          { step: 'Statistical analysis', result: `Population: ${allTxns.length} transactions, mean £${meanAmt.toFixed(2)}, std dev £${stdDev.toFixed(2)}` },
          { step: 'Scoring criteria', result: 'Size (z-score vs population), timing (weekends, bank holidays), description patterns (14 categories), transaction rarity, contra entries' },
          { step: 'Results', result: `${flaggedItems.length} items scored ≥15 points: ${highRisk} high risk (≥40), ${mediumRisk} medium risk (15-39). Ranked by composite score.` },
        ],
      },
    };
  } catch (err: any) { return { action: 'error', errorMessage: `Large & unusual analysis failed: ${err.message}` }; }
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

  // Detect garbage/hypothetical AI output and fail the test
  const garbageIndicators = ["let's assume", "for simplicity", "hypothetical", "not in a usable format", "i need to clarify", "i cannot", "i don't have access", "example data"];
  const lowerText = aiResult.text.toLowerCase();
  if (garbageIndicators.some(indicator => lowerText.includes(indicator))) {
    return {
      action: 'error',
      errorMessage: `AI did not produce a definitive result. The model was unable to process the actual data and returned hypothetical output. Test failed — needs reconfiguration or data correction.`,
      output: parsedOutput,
    };
  }

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
        evidenceTag: execDef.evidenceTag || node.data.evidenceTag || null,
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

  // Verify Evidence — assertion-driven verification using the standalone handler
  if (execDef.outputFormat === 'verify_evidence') {
    const verifyResult = await handleVerifyEvidence(flow, node, ctx, executionId, engagementId);
    // Merge AI raw output with verification results
    if (verifyResult.output) {
      verifyResult.output.raw = parsedOutput.raw;
      verifyResult.output.model = parsedOutput.model;
      verifyResult.output.tokensUsed = (verifyResult.output.tokensUsed || 0) + (parsedOutput.tokensUsed || 0);
    }
    return verifyResult;
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
      evidenceTag: execDef.evidenceTag || node.data.evidenceTag || null,
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

  // Sampling wait — pause for user to select sample from the population
  if (waitFor === 'sampling') {
    // Check if sampling was already done (resumed with selectedIndices)
    if (prevOutput?.samplingDone || prevOutput?.selectedIndices?.length > 0) {
      return {
        action: 'continue',
        nextNodeId: getNextNodeId(flow, node.id),
        output: { waitingFor: 'sampling', satisfied: true, triggerType: 'sampling', selectedIndices: prevOutput.selectedIndices, sampleSize: prevOutput.sampleSize, coverage: prevOutput.coverage, ...prevOutput },
      };
    }
    // Find population data from previous nodes to pass along
    let popCount = 0;
    for (const [, nOut] of Object.entries(ctx.nodes)) {
      const o = nOut as any;
      if (o?.dataTable?.length > 0) popCount = o.dataTable.length;
      if (o?.populationData?.length > 0) popCount = o.populationData.length;
    }
    return {
      action: 'pause',
      pauseReason: 'sampling',
      output: { waitingFor: 'sampling', triggerType: 'sampling', populationCount: popCount },
    };
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
    } else if (collection === 'tb_accounts') {
      // TB account codes for the FS line — one item per account
      items = (ctx.tb as any)?.accounts || [];
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
          if (currentNode.data?.inputType === 'require_prior_evidence') {
            result = await handleRequirePriorEvidence(flow, currentNode, ctx, executionId, execution.engagementId);
          } else if (currentNode.data?.inputType === 'use_prior_evidence') {
            result = await handleUsePriorEvidence(flow, currentNode, ctx, executionId, execution.engagementId);
          } else if (currentNode.data?.inputType === 'bank_statement_extract') {
            result = await handleBankStatementExtract(flow, currentNode, ctx, executionId, execution.engagementId);
          } else if (currentNode.data?.inputType === 'process_bank_data') {
            result = await handleProcessBankData(flow, currentNode, ctx, executionId, execution.engagementId);
          } else if (currentNode.data?.inputType === 'store_extracted_bank_data') {
            result = await handleStoreExtractedData(flow, currentNode, ctx, executionId, execution.engagementId);
          } else if (currentNode.data?.inputType === 'fetch_evidence_or_portal') {
            result = await handleFetchEvidenceOrPortal(flow, currentNode, ctx, executionId, execution.engagementId);
          } else if (currentNode.data?.inputType === 'accounting_extract' || currentNode.data?.inputType === 'accounting_extract_cutoff' || currentNode.data?.inputType === 'accounting_extract_or_bank') {
            result = await handleAccountingExtract(flow, currentNode, ctx, executionId, execution.engagementId, currentNode.data?.inputType === 'accounting_extract_cutoff', currentNode.data?.inputType === 'accounting_extract_or_bank');
          } else if (currentNode.data?.inputType === 'compare_bank_to_tb') {
            result = await handleCompareBankToTB(flow, currentNode, ctx, executionId, execution.engagementId);
          } else if (currentNode.data?.inputType === 'analyse_cut_off') {
            result = await handleAnalyseCutOff(flow, currentNode, ctx, executionId, execution.engagementId);
          } else if (currentNode.data?.inputType === 'analyse_large_unusual') {
            result = await handleAnalyseLargeUnusual(flow, currentNode, ctx, executionId, execution.engagementId);
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
    let nextNodeId = getNextNodeId(flow, execution.currentNodeId);
    // Dead-end inside a loop body? Bounce back to the forEach/loopUntil node
    if (!nextNodeId && execution.loopState) {
      const ls = execution.loopState as any;
      if (ls.nodeId) nextNodeId = ls.nodeId;
    }
    await prisma.testExecution.update({
      where: { id: executionId },
      data: { status: 'running', currentNodeId: nextNodeId || null, pauseReason: null, pauseRefId: null, context: updatedContext as any },
    });
  } else {
    // Resume without new data — just advance
    let nextNodeId = execution.currentNodeId ? getNextNodeId(flow, execution.currentNodeId) : null;
    // Dead-end inside a loop body? Bounce back to the forEach/loopUntil node
    if (!nextNodeId && execution.loopState) {
      const ls = execution.loopState as any;
      if (ls.nodeId) nextNodeId = ls.nodeId;
    }
    await prisma.testExecution.update({
      where: { id: executionId },
      data: { status: 'running', currentNodeId: nextNodeId || null, pauseReason: null, pauseRefId: null },
    });
  }

  // Continue processing
  await processNextNode(executionId);
}
