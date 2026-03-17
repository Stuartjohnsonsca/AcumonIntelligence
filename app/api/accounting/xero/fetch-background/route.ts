import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getAccounts, getTransactions } from '@/lib/xero';
import crypto from 'crypto';

export const maxDuration = 120;

interface TaskResult {
  status: 'running' | 'completed' | 'error';
  data?: unknown;
  error?: string;
  userId: string;
  createdAt: number;
}

const taskStore = new Map<string, TaskResult>();

setInterval(() => {
  const cutoff = Date.now() - 4 * 60 * 60 * 1000;
  for (const [id, task] of taskStore) {
    if (task.createdAt < cutoff) taskStore.delete(id);
  }
}, 5 * 60 * 1000);

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const body = await req.json();
  const { clientId, accountCodes, dateFrom, dateTo, excludeManualJournals } = body;

  if (!clientId || !dateFrom || !dateTo) {
    return NextResponse.json({ error: 'clientId, dateFrom, dateTo required' }, { status: 400 });
  }

  const taskId = crypto.randomBytes(16).toString('hex');
  const userId = session.user.email || session.user.id || 'unknown';

  taskStore.set(taskId, { status: 'running', userId, createdAt: Date.now() });

  (async () => {
    try {
      const codes = accountCodes ? accountCodes.split(',').filter(Boolean) : [];
      const transactions = await getTransactions(clientId, codes, dateFrom, dateTo);

      const rows = [];
      for (const txn of transactions) {
        const isManualJournal = txn.Type === 'MANUAL_JOURNAL' || txn.Type === 'ManualJournal';
        if (excludeManualJournals && isManualJournal) continue;

        if (txn.LineItems && txn.LineItems.length > 0) {
          for (const li of txn.LineItems) {
            rows.push({
              date: txn.Date,
              reference: txn.Reference || '',
              contact: txn.Contact?.Name || '',
              type: txn.Type,
              description: li.Description || '',
              accountCode: li.AccountCode || '',
              lineAmount: li.LineAmount,
              taxAmount: li.TaxAmount,
              subtotal: txn.SubTotal,
              tax: txn.TotalTax,
              total: txn.Total,
            });
          }
        } else {
          rows.push({
            date: txn.Date,
            reference: txn.Reference || '',
            contact: txn.Contact?.Name || '',
            type: txn.Type,
            description: '',
            accountCode: '',
            lineAmount: null,
            taxAmount: null,
            subtotal: txn.SubTotal,
            tax: txn.TotalTax,
            total: txn.Total,
          });
        }
      }

      taskStore.set(taskId, {
        status: 'completed',
        data: { rows, count: rows.length },
        userId,
        createdAt: Date.now(),
      });
    } catch (err) {
      taskStore.set(taskId, {
        status: 'error',
        error: err instanceof Error ? err.message : 'Unknown error',
        userId,
        createdAt: Date.now(),
      });
    }
  })();

  return NextResponse.json({ taskId });
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

  const task = taskStore.get(taskId);
  if (!task) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 });
  }

  const userId = session.user.email || session.user.id || 'unknown';
  if (task.userId !== userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  return NextResponse.json({
    status: task.status,
    data: task.status === 'completed' ? task.data : undefined,
    error: task.error,
  });
}
