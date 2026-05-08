import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function POST(req: Request, { params }: { params: Promise<{ engagementId: string; executionId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId, executionId } = await params;

  const body = await req.json();
  const { itemIndex, field, newFlag } = body as { itemIndex: number; field: 'pre_ye_flag' | 'accruals_flag'; newFlag: 'red' | 'green' };

  if (itemIndex === undefined || !field || !newFlag) {
    return NextResponse.json({ error: 'itemIndex, field, and newFlag are required' }, { status: 400 });
  }

  const execution = await prisma.testExecution.findUnique({ where: { id: executionId } });
  if (!execution || execution.engagementId !== engagementId) {
    return NextResponse.json({ error: 'Execution not found' }, { status: 404 });
  }

  const pipelineState = (execution.pipelineState || {}) as Record<string, any>;

  // Find the step that contains analysis_results (step 3 typically)
  for (const stepKey of Object.keys(pipelineState)) {
    const stepOutput = pipelineState[stepKey];
    if (stepOutput?.analysis_results && Array.isArray(stepOutput.analysis_results)) {
      const item = stepOutput.analysis_results.find((r: any) => r.index === itemIndex);
      if (item) {
        item[field] = newFlag;
        item.flaggedBy = 'user';
        item.overrideTimestamp = new Date().toISOString();
        item.overrideUserName = session.user.name || session.user.email || 'User';
        // Recalculate overall flag
        item.overall_flag = (item.pre_ye_flag === 'red' || item.accruals_flag === 'red') ? 'red' : 'green';

        await prisma.testExecution.update({
          where: { id: executionId },
          data: { pipelineState: pipelineState as any },
        });

        return NextResponse.json({ item });
      }
    }
  }

  return NextResponse.json({ error: 'Item not found in pipeline state' }, { status: 404 });
}
