/**
 * Flow Execution Engine
 *
 * Step-at-a-time state machine that processes one node per invocation,
 * saves state to DB between steps, and pauses for external events.
 * Designed for Vercel serverless (max 60s per invocation).
 */

import { prisma } from '@/lib/db';
import { resolveTemplate, resolveInputs, type ExecutionContext } from './flow-template';
import { parsePortalResponseFiles } from './flow-file-parser';
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

async function buildContext(engagementId: string, fsLine: string, testDescription: string): Promise<ExecutionContext> {
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
  const tbRow = engagement.tbRows[0];

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
    nodes: {},
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

async function handleActionAI(
  flow: FlowData,
  node: FlowNode,
  ctx: ExecutionContext,
  executionId: string,
  engagementId: string,
): Promise<NodeResult> {
  const execDef = node.data.executionDef;
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
    return { action: 'pause', pauseReason: 'sampling', pauseRefId: item.id, output: parsedOutput };
  }

  // If requires review, pause for team
  if (execDef.requiresReview) {
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

  const subject = resolveTemplate(execDef?.requestTemplate?.subject || node.data.label || 'Audit Request', ctx, inputBindings);
  const message = resolveTemplate(execDef?.requestTemplate?.message || node.data.description || '', ctx, inputBindings);

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
          populationData = parsedFiles[0].rows;
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

// ─── Main Engine ───

export async function startExecution(
  engagementId: string,
  fsLine: string,
  testDescription: string,
  testTypeCode: string | null,
  flowData: FlowData,
  userId: string,
): Promise<string> {
  const eng = await prisma.auditEngagement.findUnique({ where: { id: engagementId }, select: { firmId: true } });
  if (!eng) throw new Error('Engagement not found');

  const ctx = await buildContext(engagementId, fsLine, testDescription);

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
  const startTime = Date.now();
  const MAX_DURATION = 45_000; // 45s budget
  const MAX_STEPS = 15;
  let steps = 0;

  while (steps < MAX_STEPS && (Date.now() - startTime) < MAX_DURATION) {
    steps++;

    const execution = await prisma.testExecution.findUnique({ where: { id: executionId } });
    if (!execution || execution.status !== 'running') return;

    const flow = execution.flowSnapshot as unknown as FlowData;
    const ctx = execution.context as unknown as ExecutionContext;

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

    // Create node run record
    const nodeRun = await prisma.testExecutionNodeRun.create({
      data: {
        executionId,
        nodeId: currentNode.id,
        nodeType: currentNode.type || 'action',
        assignee: currentNode.data?.assignee || null,
        label: currentNode.data?.label || null,
        status: 'running',
      },
    });

    let result: NodeResult;
    try {
      const assignee = currentNode.data?.assignee;

      switch (currentNode.type) {
        case 'start':
          result = await handleStart(flow, currentNode);
          break;
        case 'end':
          result = await handleEnd();
          break;
        case 'decision':
          result = await handleDecision(flow, currentNode, ctx);
          break;
        case 'wait':
          result = await handleWait(flow, currentNode, ctx, executionId, execution.engagementId);
          break;
        case 'action':
        default:
          if (assignee === 'ai') {
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

    // Update node run
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

    // Update execution context with this node's output
    const updatedContext = { ...ctx, nodes: { ...ctx.nodes, [currentNode.id]: result.output } };

    switch (result.action) {
      case 'continue':
        await prisma.testExecution.update({
          where: { id: executionId },
          data: { currentNodeId: result.nextNodeId || null, context: updatedContext as any },
        });
        continue; // Process next node in loop

      case 'pause':
        await prisma.testExecution.update({
          where: { id: executionId },
          data: {
            status: 'paused',
            currentNodeId: currentNode.id,
            pauseReason: result.pauseReason || null,
            pauseRefId: result.pauseRefId || null,
            context: updatedContext as any,
          },
        });
        return; // Exit — will resume via event

      case 'complete':
        await prisma.testExecution.update({
          where: { id: executionId },
          data: { status: 'completed', completedAt: new Date(), context: updatedContext as any },
        });
        return;

      case 'error':
        await prisma.testExecution.update({
          where: { id: executionId },
          data: { status: 'failed', errorMessage: result.errorMessage, context: updatedContext as any },
        });
        return;
    }
  }
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
          externalData.populationData = parsedFiles[0].rows; // First file's rows as population data
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

    // Advance to next node
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
