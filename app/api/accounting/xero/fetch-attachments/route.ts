import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { verifyClientAccess } from '@/lib/client-access';

interface TransactionRef {
  id: string;
  type: 'Invoice' | 'BankTransaction';
  hasAttachments: boolean;
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const body = await req.json();
  const { clientId, transactions } = body as {
    clientId: string;
    transactions: TransactionRef[];
  };

  if (!clientId || !transactions?.length) {
    return NextResponse.json({ error: 'clientId and transactions required' }, { status: 400 });
  }

  const access = await verifyClientAccess(session.user as { id: string; firmId: string; isSuperAdmin?: boolean }, clientId);
  if (!access.allowed) {
    return NextResponse.json({ error: access.reason || 'Forbidden' }, { status: 403 });
  }

  // Create a pending task for the extraction worker to pick up
  const task = await prisma.backgroundTask.create({
    data: {
      userId: session.user.id,
      clientId,
      type: 'xero-attachments',
      status: 'pending',
      result: { transactions, clientId } as never,
    },
  });

  return NextResponse.json({ taskId: task.id });
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const taskId = searchParams.get('taskId');

  if (!taskId) {
    return NextResponse.json({ error: 'taskId required' }, { status: 400 });
  }

  const task = await prisma.backgroundTask.findUnique({
    where: { id: taskId },
  });

  if (!task) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 });
  }

  if (task.userId !== session.user.id && !session.user.isSuperAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Detect stalled tasks: running for >6 minutes with no updates
  if (task.status === 'running') {
    const stalledMs = 6 * 60 * 1000;
    const lastUpdate = task.updatedAt.getTime();
    if (Date.now() - lastUpdate > stalledMs) {
      await prisma.backgroundTask.update({
        where: { id: task.id },
        data: {
          status: 'error',
          error: 'Task appears to have stalled. Please try again.',
        },
      });
      return NextResponse.json({
        status: 'error',
        error: 'Task appears to have stalled. Please try again.',
      });
    }
  }

  const result = task.result as Record<string, unknown> | null;
  const progress = task.progress as Record<string, unknown> | null;

  return NextResponse.json({
    status: task.status,
    data: task.status === 'completed' ? result : undefined,
    progress,
    error: task.error,
  });
}
