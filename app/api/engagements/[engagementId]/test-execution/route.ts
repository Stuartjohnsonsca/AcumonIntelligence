import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { startExecution } from '@/lib/flow-engine';

// POST: Start a new test execution
export async function POST(req: NextRequest, { params }: { params: Promise<{ engagementId: string }> }) {
  const { engagementId } = await params;
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const { fsLine, testDescription, testTypeCode, flowData } = await req.json();

  if (!fsLine || !testDescription) {
    return NextResponse.json({ error: 'fsLine and testDescription are required' }, { status: 400 });
  }

  try {
    // If flowData is provided, use it directly. Otherwise look up from test bank.
    let flow = flowData;

    if (!flow && testTypeCode) {
      const testType = await prisma.methodologyTestType.findFirst({
        where: { code: testTypeCode, firmId: session.user.firmId },
      });
      if (testType?.executionDef) {
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
      }
    }

    if (!flow) {
      return NextResponse.json({ error: 'No flow data or test type found — configure a flow in the Flow Builder first' }, { status: 400 });
    }

    const executionId = await startExecution(engagementId, fsLine, testDescription, testTypeCode || null, flow, session.user.id);

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

  const where: any = { engagementId };
  if (fsLine) where.fsLine = fsLine;
  if (status) where.status = status;

  const executions = await prisma.testExecution.findMany({
    where,
    include: {
      nodeRuns: { orderBy: { startedAt: 'asc' } },
    },
    orderBy: { startedAt: 'desc' },
  });

  return NextResponse.json({ executions });
}
