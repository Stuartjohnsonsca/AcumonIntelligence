import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getAccounts, getTransactions, batchFetchHistories } from '@/lib/xero';
import { verifyClientAccess } from '@/lib/client-access';

export const maxDuration = 120;

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const clientId = searchParams.get('clientId');
  const type = searchParams.get('type');

  if (!clientId) {
    return NextResponse.json({ error: 'clientId required' }, { status: 400 });
  }

  const access = await verifyClientAccess(session.user as { id: string; firmId: string; isSuperAdmin?: boolean }, clientId);
  if (!access.allowed) {
    return NextResponse.json({ error: access.reason || 'Forbidden' }, { status: 403 });
  }

  try {
    if (type === 'accounts') {
      // Fast path: only 3 retries for pre-load (avoid 504 timeout)
      const accounts = await getAccounts(clientId, 3);
      return NextResponse.json({ accounts });
    }

    if (type === 'transactions') {
      const codes = searchParams.get('accountCodes')?.split(',').filter(Boolean) || [];
      const dateFrom = searchParams.get('dateFrom');
      const dateTo = searchParams.get('dateTo');
      const excludeManualJournals = searchParams.get('excludeManualJournals') === 'true';

      if (!dateFrom || !dateTo) {
        return NextResponse.json({ error: 'dateFrom and dateTo required' }, { status: 400 });
      }

      const [allTransactions, allAccounts] = await Promise.all([
        getTransactions(clientId, codes, dateFrom, dateTo),
        getAccounts(clientId),
      ]);

      let transactions = allTransactions;
      if (excludeManualJournals) {
        transactions = transactions.filter(
          (txn: { Type: string }) => txn.Type !== 'MANJOURNAL' && txn.Type !== 'MANUAL JOURNAL'
        );
      }

      const accountMap = new Map<string, { name: string; description: string }>();
      for (const acc of allAccounts) {
        accountMap.set(acc.Code, { name: acc.Name, description: acc.Description || '' });
      }

      const uniqueTxns: { id: string; type: 'Invoice' | 'BankTransaction' }[] = [];
      const seenIds = new Set<string>();
      for (const txn of transactions) {
        const txnId = txn.InvoiceID || txn.BankTransactionID || '';
        if (txnId && !seenIds.has(txnId)) {
          seenIds.add(txnId);
          uniqueTxns.push({ id: txnId, type: txn.InvoiceID ? 'Invoice' : 'BankTransaction' });
        }
      }

      let historyMap = new Map<string, { createdBy: string; approvedBy: string }>();
      try {
        historyMap = await batchFetchHistories(clientId, uniqueTxns);
      } catch { /* non-fatal */ }

      function normaliseXeroDate(raw: string | undefined): string {
        if (!raw) return '';
        const msMatch = raw.match(/\/Date\((\d+)([+-]\d+)?\)\//);
        if (msMatch) return new Date(parseInt(msMatch[1], 10)).toISOString();
        const d = new Date(raw);
        return isNaN(d.getTime()) ? raw : d.toISOString();
      }

      const rows = transactions.map(txn => {
        const txnId = txn.InvoiceID || txn.BankTransactionID || '';
        const audit = historyMap.get(txnId) || { createdBy: '', approvedBy: '' };
        return {
          date: normaliseXeroDate(txn.Date),
          reference: txn.Reference || '',
          contact: txn.Contact?.Name || '',
          type: txn.Type,
          status: txn.Status || '',
          invoiceNumber: txn.InvoiceNumber || '',
          dueDate: normaliseXeroDate(txn.DueDate),
          currencyCode: txn.CurrencyCode || '',
          isReconciled: txn.IsReconciled ?? null,
          bankAccountName: txn.BankAccount?.Name || '',
          subtotal: txn.SubTotal,
          tax: txn.TotalTax,
          total: txn.Total,
          transactionId: txnId,
          transactionType: txn.InvoiceID ? 'Invoice' as const : 'BankTransaction' as const,
          hasAttachments: txn.HasAttachments ?? false,
          createdBy: audit.createdBy,
          approvedBy: audit.approvedBy,
          xeroUrl: txn.Url || '',
          lineItems: txn.LineItems?.map(li => {
            const acct = accountMap.get(li.AccountCode);
            return {
              description: li.Description,
              quantity: li.Quantity,
              unitAmount: li.UnitAmount,
              taxAmount: li.TaxAmount,
              lineAmount: li.LineAmount,
              accountCode: li.AccountCode,
              accountName: acct?.name || '',
              tracking: li.Tracking?.map(t => `${t.Name}: ${t.Option}`).join('; ') || '',
            };
          }) || [],
        };
      });

      return NextResponse.json({ rows });
    }

    return NextResponse.json({ error: 'type must be "accounts" or "transactions"' }, { status: 400 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('Xero data error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
