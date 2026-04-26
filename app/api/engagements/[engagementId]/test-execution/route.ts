import { NextRequest, NextResponse, after } from 'next/server';
import { assertEngagementWriteAccess } from '@/lib/auth/engagement-auth';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { startExecution, startPipelineExecution } from '@/lib/flow-engine';
import { scheduleSelfContinuation } from '@/lib/test-execution-continuation';

export const maxDuration = 300; // Allow up to 2 minutes for AI extraction steps

// POST: Start a new test execution
export async function POST(req: NextRequest, { params }: { params: Promise<{ engagementId: string }> }) {
  const { engagementId } = await params;
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  const __eqrGuard = await assertEngagementWriteAccess(engagementId, session);
  if (__eqrGuard instanceof NextResponse) return __eqrGuard;

  const { fsLine, fsLineId, testDescription, testTypeCode, flowData, tbRow, additionalItems, pipelineTestId } = await req.json();

  if (!fsLine || !testDescription) {
    return NextResponse.json({ error: 'fsLine and testDescription are required' }, { status: 400 });
  }

  try {
    // Pipeline mode: execute as action pipeline
    if (pipelineTestId) {
      const test = await prisma.methodologyTest.findUnique({ where: { id: pipelineTestId } });
      if (test?.executionMode === 'action_pipeline') {
        const executionId = await startPipelineExecution(
          engagementId, fsLine, testDescription, pipelineTestId,
          session.user.id, tbRow, fsLineId || undefined,
        );
        // Server-driven continuation — keep firing chained calls until
        // the execution reaches a terminal state, so the test runs to
        // completion even if the user closes the browser.
        after(() => scheduleSelfContinuation(engagementId, executionId, req));
        return NextResponse.json({ executionId, status: 'running', mode: 'action_pipeline' });
      }
    }

    // Additional items mode: skip scoring, go straight to evidence fetch forEach
    if (additionalItems && Array.isArray(additionalItems) && additionalItems.length > 0) {
      const evidenceFetchFlow = {
        nodes: [
          { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: { label: 'Start' } },
          { id: 'n_wait_review', type: 'wait', position: { x: 0, y: 80 }, data: { label: 'Review Items', waitFor: 'review_flagged' } },
          { id: 'n_foreach', type: 'forEach', position: { x: 0, y: 160 }, data: { label: 'For Each Item', collection: 'sample_items' } },
          { id: 'n_fetch_evidence', type: 'action', position: { x: 150, y: 160 }, data: { label: 'Fetch Evidence', assignee: 'system', executionDef: { type: 'fetch_evidence_or_portal' } } },
          { id: 'end', type: 'end', position: { x: 0, y: 240 }, data: { label: 'Complete' } },
        ],
        edges: [
          { id: 'e1', source: 'start', target: 'n_wait_review' },
          { id: 'e2', source: 'n_wait_review', target: 'n_foreach' },
          { id: 'e3', source: 'n_foreach', target: 'n_fetch_evidence', sourceHandle: 'body' },
          { id: 'e4', source: 'n_foreach', target: 'end', sourceHandle: 'done' },
        ],
      };

      // Pre-populate context with the additional items as sampleItems so forEach picks them up
      const executionId = await startExecution(
        engagementId, fsLine,
        testDescription + ' (additional items)',
        testTypeCode || null,
        evidenceFetchFlow,
        session.user.id,
        tbRow,
        { sampleItems: additionalItems, selectedIndices: additionalItems.map((_: any, i: number) => i), samplingDone: true },
        fsLineId || undefined,
      );

      after(() => scheduleSelfContinuation(engagementId, executionId, req));
      return NextResponse.json({ executionId, status: 'running' });
    }

    // If flowData is provided, use it directly. Otherwise look up from test bank.
    let flow = flowData;

    const diagnostics: string[] = [];

    if (!flow) {
      diagnostics.push('No flow data passed from the test entry (build a flow via the Flow Builder icon in the Test Bank popup)');
    }

    if (!flow && testTypeCode) {
      const testType = await prisma.methodologyTestType.findFirst({
        where: { code: testTypeCode, firmId: session.user.firmId },
      });
      if (!testType) {
        diagnostics.push(`Test Action with code "${testTypeCode}" not found in your firm's Test Actions`);
      } else if (!testType.executionDef) {
        diagnostics.push(`Test Action "${testType.name}" (${testTypeCode}) exists but has no execution definition — click Configure in the Test Actions tab`);
      } else {
        // Wrap single execution def in a simple flow: start → action → end
        flow = {
          nodes: [
            { id: 'start_auto', type: 'start', position: { x: 0, y: 0 }, data: { label: 'Start' } },
            { id: 'action_auto', type: 'action', position: { x: 0, y: 100 }, data: { label: testDescription, assignee: testType.actionType === 'ai_action' ? 'ai' : testType.actionType === 'client_action' ? 'client' : 'team', executionDef: testType.executionDef } },
            { id: 'end_auto', type: 'end', position: { x: 0, y: 200 }, data: { label: 'Complete' } },
          ],
          edges: [
            { id: 'e1', source: 'start_auto', target: 'action_auto' },
            { id: 'e2', source: 'action_auto', target: 'end_auto' },
          ],
        };
        diagnostics.length = 0; // Clear diagnostics — we found a valid flow
      }
    }

    if (!flow) {
      if (!testTypeCode) diagnostics.push('No Test Action type assigned to this test');
      return NextResponse.json({
        error: 'Cannot execute — no flow or execution definition found',
        diagnostics,
        help: 'Either: (1) Build a flow in Test Bank → click industry dot → Flow icon on the test, OR (2) Assign a Test Action with a configured execution definition',
      }, { status: 400 });
    }

    // Start execution in background so response returns immediately
    const executionId = await startExecution(engagementId, fsLine, testDescription, testTypeCode || null, flow, session.user.id, tbRow, undefined, fsLineId || undefined);

    // Server-driven continuation — startExecution processes the first
    // ~55s batch synchronously; this kicks off a chained continue
    // call after the response so the rest of the flow runs to
    // completion server-side without needing the client to be open.
    after(() => scheduleSelfContinuation(engagementId, executionId, req));

    return NextResponse.json({ executionId, status: 'running' });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to start execution' }, { status: 500 });
  }
}

// GET: List executions for engagement
export async function GET(req: NextRequest, { params }: { params: Promise<{ engagementId: string }> }) {
  const { engagementId } = await params;
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const url = new URL(req.url);
  const fsLine = url.searchParams.get('fsLine');
  const status = url.searchParams.get('status');
  // Lite mode: skip the potentially-huge nodeRuns payload and return only
  // aggregate counts. Used by consumers that just need summary info (e.g. the
  // Audit Plan panel's initial load and the audit log table). A full fetch is
  // still available for callers that need individual node runs (flow details
  // modal, etc.) — they simply omit ?lite=true.
  const lite = url.searchParams.get('lite') === 'true';

  const where: any = { engagementId };
  if (fsLine) where.fsLine = fsLine;
  if (status) where.status = status;

  if (lite) {
    // Return summary fields + per-execution aggregate node-run counts so the
    // Audit Log table can still render "completed / failed / total" without
    // pulling every node_run row.
    const execs = await prisma.testExecution.findMany({
      where,
      select: {
        id: true,
        engagementId: true,
        testDescription: true,
        fsLine: true,
        fsLineId: true,
        testTypeCode: true,
        status: true,
        startedAt: true,
        completedAt: true,
        pauseReason: true,
        pauseRefId: true,
        currentNodeId: true,
        errorMessage: true,
        executionMode: true,
      },
      orderBy: { startedAt: 'desc' },
    });

    // One grouped-count query instead of N per-execution joins
    const counts = execs.length > 0
      ? await prisma.testExecutionNodeRun.groupBy({
          by: ['executionId', 'status'],
          where: { executionId: { in: execs.map(e => e.id) } },
          _count: { _all: true },
        })
      : [];

    const countsByExec = new Map<string, { total: number; completed: number; failed: number }>();
    for (const row of counts) {
      const entry = countsByExec.get(row.executionId) || { total: 0, completed: 0, failed: 0 };
      entry.total += row._count._all;
      if (row.status === 'completed') entry.completed += row._count._all;
      if (row.status === 'failed') entry.failed += row._count._all;
      countsByExec.set(row.executionId, entry);
    }

    const executions = execs.map(e => {
      const c = countsByExec.get(e.id) || { total: 0, completed: 0, failed: 0 };
      return {
        ...e,
        nodeRunsTotal: c.total,
        nodeRunsCompleted: c.completed,
        nodeRunsFailed: c.failed,
        // Preserve the legacy shape so UI code reading `nodeRuns` doesn't crash.
        // It's an empty array in lite mode — callers use the aggregate counts above.
        nodeRuns: [],
      };
    });

    return NextResponse.json({ executions });
  }

  const executions = await prisma.testExecution.findMany({
    where,
    include: {
      nodeRuns: { orderBy: { startedAt: 'asc' } },
    },
    orderBy: { startedAt: 'desc' },
  });

  return NextResponse.json({ executions });
}
