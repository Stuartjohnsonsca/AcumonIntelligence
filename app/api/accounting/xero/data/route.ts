import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getAccounts, getTransactions } from '@/lib/xero';

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

  try {
    if (type === 'accounts') {
      const accounts = await getAccounts(clientId);
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

      let transactions = await getTransactions(clientId, codes, dateFrom, dateTo);

      if (excludeManualJournals) {
        transactions = transactions.filter(
          (txn: { Type: string }) => txn.Type !== 'MANJOURNAL' && txn.Type !== 'MANUAL JOURNAL'
        );
      }

      const rows = transactions.map(txn => ({
        date: txn.Date,
        reference: txn.Reference || '',
        contact: txn.Contact?.Name || '',
        type: txn.Type,
        subtotal: txn.SubTotal,
        tax: txn.TotalTax,
        total: txn.Total,
        lineItems: txn.LineItems?.map(li => ({
          description: li.Description,
          quantity: li.Quantity,
          unitAmount: li.UnitAmount,
          taxAmount: li.TaxAmount,
          lineAmount: li.LineAmount,
          accountCode: li.AccountCode,
        })) || [],
      }));

      return NextResponse.json({ rows });
    }

    return NextResponse.json({ error: 'type must be "accounts" or "transactions"' }, { status: 400 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('Xero data error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
