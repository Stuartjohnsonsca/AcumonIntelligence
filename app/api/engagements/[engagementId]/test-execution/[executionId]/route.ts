import { NextRequest, NextResponse, after } from 'next/server';
import { assertEngagementWriteAccess } from '@/lib/auth/engagement-auth';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { resumeExecution, processNextNode, resumePipelineExecution, processPipelineStep } from '@/lib/flow-engine';
import { scheduleSelfContinuation, isInternalContinuationCall } from '@/lib/test-execution-continuation';

export const maxDuration = 300;

// GET: Full execution detail with node runs
export async function GET(req: NextRequest, { params }: { params: Promise<{ engagementId: string; executionId: string }> }) {
  const { executionId } = await params;
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const execution = await prisma.testExecution.findUnique({
    where: { id: executionId },
    include: {
      nodeRuns: { orderBy: { startedAt: 'asc' } },
      outstandingItems: { orderBy: { createdAt: 'desc' } },
    },
  });

  if (!execution) return NextResponse.json({ error: 'Execution not found' }, { status: 404 });

  // For action-pipeline executions, resolve the currently-executing action
  // definition so the client can render per-action UI (e.g. the property
  // verification section) without needing a separate round-trip. We follow
  // the same test-lookup pattern as processPipelineStep in lib/flow-engine.ts
  // (firmId + testDescription), since there's no FK on TestExecution.
  let currentAction: { code: string; name: string; handlerName: string | null } | null = null;
  if (execution.executionMode === 'action_pipeline') {
    try {
      const currentStepIndex = execution.currentStepIndex ?? 0;
      const eng = await prisma.auditEngagement.findUnique({
        where: { id: execution.engagementId },
        select: { firmId: true },
      });
      if (eng) {
        const test = await prisma.methodologyTest.findFirst({
          where: { firmId: eng.firmId, name: execution.testDescription, executionMode: 'action_pipeline' },
          select: { id: true },
        });
        if (test) {
          const step = await prisma.testActionStep.findFirst({
            where: { testId: test.id, stepOrder: currentStepIndex, isActive: true },
            include: { actionDefinition: { select: { code: true, name: true, handlerName: true } } },
          });
          if (step?.actionDefinition) {
            currentAction = {
              code: step.actionDefinition.code,
              name: step.actionDefinition.name,
              handlerName: step.actionDefinition.handlerName,
            };
          }
        }
      }
    } catch (err) {
      console.error('[test-execution] Failed to resolve current action:', err);
    }
  }

  // Build flow steps sorted by execution order (completed first, then pending)
  const flow = execution.flowSnapshot as any;
  const flowSteps = (flow.nodes || [])
    .filter((n: any) => n.type !== 'start')
    .map((n: any) => {
      const nodeRun = execution.nodeRuns.find(r => r.nodeId === n.id);
      return {
        id: n.id,
        label: n.data?.label || n.type,
        nodeType: n.type,
        status: nodeRun?.status || 'pending',
        output: nodeRun?.output,
        errorMessage: nodeRun?.errorMessage,
        duration: nodeRun?.duration,
        startedAt: nodeRun?.startedAt,
        completedAt: nodeRun?.completedAt,
      };
    })
    .sort((a: any, b: any) => {
      // Executed nodes first (by startedAt), then pending nodes in original order
      if (a.startedAt && !b.startedAt) return -1;
      if (!a.startedAt && b.startedAt) return 1;
      if (a.startedAt && b.startedAt) return new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime();
      return 0;
    });

  return NextResponse.json({
    execution: {
      id: execution.id,
      status: execution.status,
      fsLine: execution.fsLine,
      testDescription: execution.testDescription,
      currentNodeId: execution.currentNodeId,
      pauseReason: execution.pauseReason,
      pauseRefId: execution.pauseRefId,
      errorMessage: execution.errorMessage,
      startedAt: execution.startedAt,
      completedAt: execution.completedAt,
      updatedAt: execution.updatedAt,
      context: execution.context, // Includes forEach body outputs not captured in nodeRuns
      executionMode: execution.executionMode,
      currentStepIndex: execution.currentStepIndex,
      pipelineState: execution.pipelineState,
      currentAction,
    },
    flowSnapshot: execution.flowSnapshot,
    flowSteps,
    nodeRuns: execution.nodeRuns,
    outstandingItems: execution.outstandingItems,
  });
}

// POST: Control execution (resume, cancel, retry, continue)
//
// Auth: normal session auth for user-driven actions. The 'continue'
// action additionally accepts an internal Bearer token (CRON_SECRET)
// so the server can chain its own continuations without a session —
// see lib/test-execution-continuation.ts for the why.
export async function POST(req: NextRequest, { params }: { params: Promise<{ engagementId: string; executionId: string }> }) {
  const { engagementId, executionId } = await params;
  const isInternal = isInternalContinuationCall(req);
  if (!isInternal) {
    const session = await auth();
    if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    const __eqrGuard = await assertEngagementWriteAccess(engagementId, session);
    if (__eqrGuard instanceof NextResponse) return __eqrGuard;
  }

  const { action, responseData } = await req.json();

  // Internal token only authorises 'continue'. Anything else still
  // requires a real user session.
  if (isInternal && action !== 'continue') {
    return NextResponse.json({ error: 'Internal token only valid for action=continue' }, { status: 403 });
  }

  const execution = await prisma.testExecution.findUnique({ where: { id: executionId } });
  if (!execution) return NextResponse.json({ error: 'Execution not found' }, { status: 404 });

  switch (action) {
    case 'resume':
      if (execution.status !== 'paused') return NextResponse.json({ error: 'Execution is not paused' }, { status: 400 });
      if (execution.executionMode === 'action_pipeline') {
        await resumePipelineExecution(executionId, responseData);
      } else {
        await resumeExecution(executionId, responseData);
      }
      // Resuming from a pause is the start of a new run-to-completion
      // window — chain server-side continuation so a long flow doesn't
      // stall when this function's budget runs out.
      after(() => scheduleSelfContinuation(engagementId, executionId, req));
      return NextResponse.json({ status: 'resumed' });

    case 'cancel':
      await prisma.testExecution.update({ where: { id: executionId }, data: { status: 'cancelled' } });
      return NextResponse.json({ status: 'cancelled' });

    case 'retry':
      if (execution.status !== 'failed') return NextResponse.json({ error: 'Execution is not failed' }, { status: 400 });
      await prisma.testExecution.update({ where: { id: executionId }, data: { status: 'running', errorMessage: null } });
      if (execution.executionMode === 'action_pipeline') {
        await processPipelineStep(executionId);
      } else {
        await processNextNode(executionId);
      }
      after(() => scheduleSelfContinuation(engagementId, executionId, req));
      return NextResponse.json({ status: 'retrying' });

    case 'continue':
      if (execution.status !== 'running') return NextResponse.json({ error: 'Execution is not running' }, { status: 400 });
      if (execution.executionMode === 'action_pipeline') {
        await processPipelineStep(executionId);
      } else {
        await processNextNode(executionId);
      }
      // Chain another continuation if the previous batch hit the
      // function's time budget without finishing the flow. The helper
      // re-checks status from the DB so already-terminal executions
      // don't trigger a chain.
      after(() => scheduleSelfContinuation(engagementId, executionId, req));
      return NextResponse.json({ status: 'continuing' });

    default:
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  }
}
