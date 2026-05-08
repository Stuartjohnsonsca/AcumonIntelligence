import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function POST(req: Request, { params }: { params: Promise<{ engagementId: string; executionId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId, executionId } = await params;

  const body = await req.json();
  const { itemIndex, action, fsLine, item } = body as {
    itemIndex: number;
    action: 'error' | 'in_tb';
    fsLine?: string;
    item?: { date?: string; description?: string; amount?: number; pre_ye_reasoning?: string; accruals_reasoning?: string };
  };

  if (itemIndex === undefined || !action) {
    return NextResponse.json({ error: 'itemIndex and action are required' }, { status: 400 });
  }

  const execution = await prisma.testExecution.findUnique({ where: { id: executionId } });
  if (!execution || execution.engagementId !== engagementId) {
    return NextResponse.json({ error: 'Execution not found' }, { status: 404 });
  }

  const pipelineState = (execution.pipelineState || {}) as Record<string, any>;

  // Find and update the item in analysis_results
  let targetItem: any = null;
  for (const stepKey of Object.keys(pipelineState)) {
    const stepOutput = pipelineState[stepKey];
    if (stepOutput?.analysis_results && Array.isArray(stepOutput.analysis_results)) {
      targetItem = stepOutput.analysis_results.find((r: any) => r.index === itemIndex);
      if (targetItem) break;
    }
  }

  if (action === 'error') {
    // Create error schedule record
    const errorRecord = await prisma.auditErrorSchedule.create({
      data: {
        engagementId,
        fsLine: fsLine || 'Accruals',
        description: `Post YE payment: ${item?.description || targetItem?.description || ''} (${item?.date || targetItem?.date || ''})`,
        errorAmount: Number(item?.amount || targetItem?.amount || 0),
        errorType: 'factual',
        explanation: `${item?.pre_ye_reasoning || targetItem?.pre_ye_reasoning || ''} ${item?.accruals_reasoning || targetItem?.accruals_reasoning || ''}`.trim(),
        isFraud: false,
        committedBy: session.user.id!,
        committedByName: session.user.name || session.user.email || 'User',
        committedAt: new Date(),
      },
    });

    // Store error schedule ID in pipeline state
    if (targetItem) {
      targetItem.errorAction = 'error';
      targetItem.errorScheduleId = errorRecord.id;
      await prisma.testExecution.update({
        where: { id: executionId },
        data: { pipelineState: pipelineState as any },
      });
    }

    return NextResponse.json({ action: 'error', errorScheduleId: errorRecord.id });
  }

  if (action === 'in_tb') {
    // Remove error schedule record if it exists
    if (targetItem?.errorScheduleId) {
      try {
        await prisma.auditErrorSchedule.delete({ where: { id: targetItem.errorScheduleId } });
      } catch { /* already deleted */ }
    }

    if (targetItem) {
      targetItem.errorAction = 'in_tb';
      targetItem.errorScheduleId = undefined;
      await prisma.testExecution.update({
        where: { id: executionId },
        data: { pipelineState: pipelineState as any },
      });
    }

    return NextResponse.json({ action: 'in_tb' });
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}
