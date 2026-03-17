import { NextResponse, after } from 'next/server';
import { auth } from '@/lib/auth';
import { getTransactions } from '@/lib/xero';
import { prisma } from '@/lib/db';
import { verifyClientAccess } from '@/lib/client-access';

export const maxDuration = 120;

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

  const access = await verifyClientAccess(session.user as { id: string; firmId: string; isSuperAdmin?: boolean }, clientId);
  if (!access.allowed) {
    return NextResponse.json({ error: access.reason || 'Forbidden' }, { status: 403 });
  }

  const task = await prisma.backgroundTask.create({
    data: {
      userId: session.user.id,
      clientId,
      type: 'xero-fetch',
      status: 'running',
    },
  });

  after(async () => {
    try {
      const codes = accountCodes ? accountCodes.split(',').filter(Boolean) : [];
      const transactions = await getTransactions(clientId, codes, dateFrom, dateTo);

      function normaliseXeroDate(raw: string | undefined): string {
        if (!raw) return '';
        const msMatch = raw.match(/\/Date\((\d+)([+-]\d+)?\)\//);
        if (msMatch) return new Date(parseInt(msMatch[1], 10)).toISOString();
        const d = new Date(raw);
        return isNaN(d.getTime()) ? raw : d.toISOString();
      }

      const rows = [];
      for (const txn of transactions) {
        const isManualJournal = txn.Type === 'MANUAL_JOURNAL' || txn.Type === 'ManualJournal';
        if (excludeManualJournals && isManualJournal) continue;

        const txnId = txn.InvoiceID || txn.BankTransactionID || '';
        const txnType = txn.InvoiceID ? 'Invoice' : 'BankTransaction';
        const hasAttachments = txn.HasAttachments ?? false;

        if (txn.LineItems && txn.LineItems.length > 0) {
          for (const li of txn.LineItems) {
            rows.push({
              date: normaliseXeroDate(txn.Date),
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
              transactionId: txnId,
              transactionType: txnType,
              hasAttachments,
            });
          }
        } else {
          rows.push({
            date: normaliseXeroDate(txn.Date),
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
            transactionId: txnId,
            transactionType: txnType,
            hasAttachments,
          });
        }
      }

      await prisma.backgroundTask.update({
        where: { id: task.id },
        data: {
          status: 'completed',
          result: { rows, count: rows.length },
        },
      });
    } catch (err) {
      await prisma.backgroundTask.update({
        where: { id: task.id },
        data: {
          status: 'error',
          error: err instanceof Error ? err.message : 'Unknown error',
        },
      });
    }
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

  return NextResponse.json({
    status: task.status,
    data: task.status === 'completed' ? task.result : undefined,
    error: task.error,
  });
}
