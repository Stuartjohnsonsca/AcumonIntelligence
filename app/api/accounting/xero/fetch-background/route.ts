import { NextResponse, after } from 'next/server';
import { auth } from '@/lib/auth';
import { getTransactions, getAccounts, batchFetchHistories, getTaxRates, batchFetchContactGroups } from '@/lib/xero';
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
    const updateProgress = (progress: Record<string, unknown>) =>
      prisma.backgroundTask.update({
        where: { id: task.id },
        data: { progress: progress as never },
      });

    try {
      const codes = accountCodes ? accountCodes.split(',').filter(Boolean) : [];

      await updateProgress({ phase: 'fetching', message: 'Fetching transactions from Xero...' });

      const [transactions, accounts, taxRateMap] = await Promise.all([
        getTransactions(clientId, codes, dateFrom, dateTo),
        getAccounts(clientId),
        getTaxRates(clientId),
      ]);

      await updateProgress({ phase: 'fetching', message: `Fetched ${transactions.length} transactions. Processing...` });

      const accountMap = new Map<string, { name: string; description: string }>();
      for (const acc of accounts) {
        accountMap.set(acc.Code, { name: acc.Name, description: acc.Description || '' });
      }

      function normaliseXeroDate(raw: string | undefined): string {
        if (!raw) return '';
        const msMatch = raw.match(/\/Date\((\d+)([+-]\d+)?\)\//);
        if (msMatch) return new Date(parseInt(msMatch[1], 10)).toISOString();
        const d = new Date(raw);
        return isNaN(d.getTime()) ? raw : d.toISOString();
      }

      const uniqueTxns: { id: string; type: 'Invoice' | 'BankTransaction' }[] = [];
      const seenIds = new Set<string>();
      for (const txn of transactions) {
        const txnId = txn.InvoiceID || txn.BankTransactionID || '';
        if (txnId && !seenIds.has(txnId)) {
          seenIds.add(txnId);
          uniqueTxns.push({
            id: txnId,
            type: txn.InvoiceID ? 'Invoice' : 'BankTransaction',
          });
        }
      }

      await updateProgress({ phase: 'histories', message: `Fetching audit history for ${uniqueTxns.length} transactions...` });

      const uniqueContactIds = [...new Set(
        transactions.map(t => t.Contact?.ContactID).filter((id): id is string => !!id)
      )];

      const [historyMap, contactGroupMap] = await Promise.all([
        batchFetchHistories(clientId, uniqueTxns).catch(err => {
          console.warn('History fetch failed (non-fatal):', err instanceof Error ? err.message : err);
          return new Map<string, { createdBy: string; approvedBy: string }>();
        }),
        batchFetchContactGroups(clientId, uniqueContactIds).catch(err => {
          console.warn('Contact group fetch failed (non-fatal):', err instanceof Error ? err.message : err);
          return new Map<string, string>();
        }),
      ]);

      await updateProgress({ phase: 'processing', message: `Building ${transactions.length} rows...` });

      const rows = [];
      for (const txn of transactions) {
        const isManualJournal = txn.Type === 'MANUAL_JOURNAL' || txn.Type === 'ManualJournal';
        if (excludeManualJournals && isManualJournal) continue;

        const txnId = txn.InvoiceID || txn.BankTransactionID || '';
        const txnType = txn.InvoiceID ? 'Invoice' : 'BankTransaction';
        const hasAttachments = txn.HasAttachments ?? false;
        const audit = historyMap.get(txnId) || { createdBy: '', approvedBy: '' };

        // Payment summary
        const paymentCount = txn.Payments?.length ?? 0;
        const paymentTotal = txn.Payments?.reduce((s, p) => s + (p.Amount || 0), 0) ?? 0;
        const lastPaymentDate = txn.Payments?.length
          ? normaliseXeroDate(txn.Payments[txn.Payments.length - 1].Date)
          : '';
        const creditNoteCount = txn.CreditNotes?.length ?? 0;
        const creditNoteTotal = txn.CreditNotes?.reduce((s, c) => s + (c.Total || 0), 0) ?? 0;

        const baseFields = {
          date: normaliseXeroDate(txn.Date),
          reference: txn.Reference || '',
          contact: txn.Contact?.Name || '',
          contactGroup: txn.Contact?.ContactID ? (contactGroupMap.get(txn.Contact.ContactID) || '') : '',
          type: txn.Type,
          status: txn.Status || '',
          invoiceNumber: txn.InvoiceNumber || '',
          dueDate: normaliseXeroDate(txn.DueDate),
          expectedPaymentDate: normaliseXeroDate(txn.ExpectedPaymentDate),
          fullyPaidOnDate: normaliseXeroDate(txn.FullyPaidOnDate),
          currencyCode: txn.CurrencyCode || '',
          currencyRate: txn.CurrencyRate ?? null,
          lineAmountTypes: txn.LineAmountTypes || '',
          isReconciled: txn.IsReconciled ?? null,
          sentToContact: txn.SentToContact ?? null,
          bankAccountCode: txn.BankAccount?.Code || '',
          bankAccountName: txn.BankAccount?.Name || '',
          subtotal: txn.SubTotal,
          tax: txn.TotalTax,
          total: txn.Total,
          amountDue: txn.AmountDue ?? null,
          amountPaid: txn.AmountPaid ?? null,
          amountCredited: txn.AmountCredited ?? null,
          paymentCount,
          paymentTotal: paymentCount > 0 ? paymentTotal : null,
          lastPaymentDate,
          creditNoteCount,
          creditNoteTotal: creditNoteCount > 0 ? creditNoteTotal : null,
          transactionId: txnId,
          transactionType: txnType,
          hasAttachments,
          createdBy: audit.createdBy,
          approvedBy: audit.approvedBy,
          xeroUrl: txn.Url || '',
          source: txn.SourceTransactionID || '',
          processDateTime: normaliseXeroDate(txn.UpdatedDateUTC),
        };

        if (txn.LineItems && txn.LineItems.length > 0) {
          for (const li of txn.LineItems) {
            const acct = accountMap.get(li.AccountCode);
            const trackingStr = li.Tracking?.map(t => `${t.Name}: ${t.Option}`).join('; ') || '';
            const vatRate = li.TaxType ? (taxRateMap.get(li.TaxType) ?? null) : null;
            rows.push({
              ...baseFields,
              description: li.Description || '',
              accountCode: li.AccountCode || '',
              accountName: acct?.name || '',
              lineAmount: li.LineAmount,
              taxAmount: li.TaxAmount,
              vatRate,
              taxType: li.TaxType || '',
              quantity: li.Quantity ?? null,
              unitAmount: li.UnitAmount ?? null,
              discountRate: li.DiscountRate ?? null,
              itemCode: li.ItemCode || '',
              tracking: trackingStr,
            });
          }
        } else {
          rows.push({
            ...baseFields,
            description: '',
            accountCode: '',
            accountName: '',
            lineAmount: null,
            taxAmount: null,
            vatRate: null,
            taxType: '',
            quantity: null,
            unitAmount: null,
            discountRate: null,
            itemCode: '',
            tracking: '',
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
    progress: task.status === 'running' ? task.progress : undefined,
    error: task.error,
  });
}
