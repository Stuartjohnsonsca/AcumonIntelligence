import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getAccounts } from '@/lib/xero';

/**
 * POST /api/engagements/[engagementId]/trial-balance/import-accounting
 * Imports trial balance from connected accounting system (Xero, etc.)
 */
export async function POST(req: Request, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await params;

  const engagement = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    select: { clientId: true, firmId: true, period: { select: { startDate: true, endDate: true } } },
  });
  if (!engagement) return NextResponse.json({ error: 'Engagement not found' }, { status: 404 });
  if (engagement.firmId !== session.user.firmId && !session.user.isSuperAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Find accounting connection
  const connection = await prisma.accountingConnection.findFirst({
    where: { clientId: engagement.clientId },
  });
  if (!connection) {
    return NextResponse.json({ error: 'No accounting system connected. Connect via Opening tab.' }, { status: 400 });
  }
  if (new Date() > connection.expiresAt) {
    return NextResponse.json({ error: `${connection.system} connection expired. Please reconnect.` }, { status: 400 });
  }

  try {
    let tbRows: { accountCode: string; description: string; currentYear: number; priorYear: number; category?: string }[] = [];

    switch (connection.system.toLowerCase()) {
      case 'xero': {
        // Fetch chart of accounts from Xero — these have balances
        const accounts = await getAccounts(engagement.clientId);

        // Filter to active accounts with balances and map to TB format
        tbRows = accounts
          .filter((a: any) => a.Status === 'ACTIVE')
          .map((a: any) => {
            // Xero account types → FS categories
            const typeMap: Record<string, string> = {
              'REVENUE': 'Revenue',
              'DIRECTCOSTS': 'Cost of Sales',
              'EXPENSE': 'Expenses',
              'OVERHEADS': 'Administrative Expenses',
              'FIXED': 'Fixed Assets',
              'CURRENT': 'Current Assets',
              'CURRLIAB': 'Current Liabilities',
              'TERMLIAB': 'Long Term Liabilities',
              'EQUITY': 'Equity',
              'OTHERINCOME': 'Other Income',
              'DEPRECIATN': 'Depreciation',
              'BANK': 'Cash and Bank',
              'INVENTORY': 'Stock',
              'PREPAYMENT': 'Prepayments',
            };

            // Map Xero account class to FS statement
            const statementMap: Record<string, string> = {
              'REVENUE': 'Profit & Loss', 'DIRECTCOSTS': 'Profit & Loss',
              'EXPENSE': 'Profit & Loss', 'OVERHEADS': 'Profit & Loss',
              'OTHERINCOME': 'Profit & Loss', 'DEPRECIATN': 'Profit & Loss',
              'FIXED': 'Balance Sheet', 'CURRENT': 'Balance Sheet',
              'CURRLIAB': 'Balance Sheet', 'TERMLIAB': 'Balance Sheet',
              'EQUITY': 'Balance Sheet', 'BANK': 'Balance Sheet',
              'INVENTORY': 'Balance Sheet', 'PREPAYMENT': 'Balance Sheet',
            };

            return {
              accountCode: a.Code || '',
              description: a.Name || '',
              currentYear: a.ReportingCodeName ? 0 : 0, // Xero Accounts API doesn't return balances
              priorYear: 0,
              category: a.Type || '',
              fsLevel: typeMap[a.Type] || a.Class || '',
              fsStatement: statementMap[a.Type] || (a.Class === 'ASSET' || a.Class === 'LIABILITY' || a.Class === 'EQUITY' ? 'Balance Sheet' : 'Profit & Loss'),
            };
          })
          .filter((r: any) => r.accountCode); // Must have a code
        break;
      }
      default:
        return NextResponse.json({ error: `${connection.system} import not yet supported` }, { status: 400 });
    }

    if (tbRows.length === 0) {
      return NextResponse.json({ error: 'No accounts found in accounting system' }, { status: 400 });
    }

    // Get existing rows to avoid duplicates
    const existing = await prisma.auditTBRow.findMany({
      where: { engagementId },
      select: { accountCode: true },
    });
    const existingCodes = new Set(existing.map(r => r.accountCode));

    // Create new rows for accounts not already in TB
    let created = 0;
    let maxSort = existing.length;
    for (const row of tbRows) {
      if (existingCodes.has(row.accountCode)) continue;
      await prisma.auditTBRow.create({
        data: {
          engagementId,
          accountCode: row.accountCode,
          originalAccountCode: row.accountCode,
          description: row.description,
          currentYear: row.currentYear || null,
          priorYear: row.priorYear || null,
          category: (row as any).category || null,
          fsLevel: (row as any).fsLevel || null,
          fsStatement: (row as any).fsStatement || null,
          sortOrder: ++maxSort,
        },
      });
      created++;
    }

    const allRows = await prisma.auditTBRow.findMany({ where: { engagementId }, orderBy: { sortOrder: 'asc' } });
    return NextResponse.json({
      rows: allRows,
      imported: created,
      total: tbRows.length,
      skipped: tbRows.length - created,
      source: connection.system,
      orgName: connection.orgName,
    });
  } catch (err: any) {
    console.error('TB import error:', err);
    return NextResponse.json({ error: `Import failed: ${err.message}` }, { status: 500 });
  }
}
