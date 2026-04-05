import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getAccounts, getTrialBalanceReport, getValidAccessToken } from '@/lib/xero';

export const maxDuration = 60;

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
    let debugInfo = '';

    // Compute dates for TB report
    // CY = TB as at period end date (e.g. 31/3/2025)
    // PY = TB as at day before period start (e.g. 31/3/2024)
    // Values are imported exactly as Xero returns them — no manipulation.
    const formatDate = (d: Date) => d.toISOString().split('T')[0];
    const currentYearDate = formatDate(engagement.period.endDate);
    const priorDate = new Date(engagement.period.startDate);
    priorDate.setDate(priorDate.getDate() - 1);
    const priorYearDate = formatDate(priorDate);

    console.log(`[TB Import] Dates — CY: ${currentYearDate}, PY: ${priorYearDate}`);

    switch (connection.system.toLowerCase()) {
      case 'xero': {
        // Get a fresh token, fetch accounts first (sequential to avoid 401 races)
        let xeroAuth = await getValidAccessToken(engagement.clientId);
        console.log(`[TB Import] Token obtained, fetching accounts...`);
        let accounts: any[];
        try {
          accounts = await getAccounts(engagement.clientId, undefined, xeroAuth);
        } catch (err: any) {
          // Token might have just expired — refresh and retry once
          console.warn(`[TB Import] getAccounts failed: ${err.message}, refreshing token and retrying...`);
          xeroAuth = await getValidAccessToken(engagement.clientId);
          accounts = await getAccounts(engagement.clientId, undefined, xeroAuth);
        }
        console.log(`[TB Import] Got ${accounts.length} accounts, fetching TB reports...`);
        const [currentTB, priorTB] = await Promise.all([
          getTrialBalanceReport(engagement.clientId, currentYearDate, xeroAuth),
          getTrialBalanceReport(engagement.clientId, priorYearDate, xeroAuth),
        ]);
        console.log(`[TB Import] TB reports: CY=${currentTB.size} entries, PY=${priorTB.size} entries`);

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

        console.log(`[TB Import] Chart of accounts: ${accounts.length} total, ${accounts.filter((a: any) => a.Status === 'ACTIVE').length} active`);

        // TB sign convention: debit = positive, credit = negative.
        // This ensures the TB always totals to zero (sum of all debits = sum of all credits).
        function netBalance(entry: { debit: number; credit: number } | undefined): number {
          if (!entry) return 0;
          return entry.debit - entry.credit;
        }

        // ── Chart-of-accounts-driven: import EVERY account, look up exact TB values ──
        // No P&L manipulation — values match Xero exactly.
        let matched = 0;

        for (const a of accounts) {
          const accountId = a.AccountID || '';
          const accountType = a.Type || '';
          const accountCode = a.Code || accountId;

          // Look up TB values by AccountID — exact figures from Xero
          const cy = currentTB.get(accountId);
          const py = priorTB.get(accountId);

          if (cy || py) matched++;

          const cyAmount = netBalance(cy);
          const pyAmount = netBalance(py);

          tbRows.push({
            accountCode,
            description: a.Name || '',
            currentYear: cyAmount,
            priorYear: pyAmount,
            // Category from Xero account type (informational only — not FS classification)
            category: typeMap[accountType] || accountType || undefined,
            // FS fields left blank — populated by AI Classification from firm taxonomy
            // Store additional accounting system metadata to help AI classification
            sourceMetadata: { xeroType: accountType, xeroClass: a.Class || '', xeroDescription: a.Description || '' },
          } as any);
        }

        // Remove rows that are zero in both CY and PY (no activity)
        const beforeFilter = tbRows.length;
        tbRows = tbRows.filter(r => r.currentYear !== 0 || r.priorYear !== 0);

        // Compute raw Xero TB totals for verification display
        let xeroCyTotal = 0, xeroPyTotal = 0;
        for (const [, entry] of currentTB) xeroCyTotal += (entry.debit - entry.credit);
        for (const [, entry] of priorTB) xeroPyTotal += (entry.debit - entry.credit);

        // Store Xero summary on engagement for verification in the TB tab
        await prisma.auditEngagement.update({
          where: { id: engagementId },
          data: {
            tbXeroSummary: {
              source: connection.system,
              cyDate: currentYearDate,
              pyDate: priorYearDate,
              cyTotal: Math.round(xeroCyTotal * 100) / 100,
              pyTotal: Math.round(xeroPyTotal * 100) / 100,
              cyEntries: currentTB.size,
              pyEntries: priorTB.size,
              importedAt: new Date().toISOString(),
            },
          },
        });

        debugInfo = `Accounts: ${accounts.length}, matched TB: ${matched}, rows before filter: ${beforeFilter}, after: ${tbRows.length}`;
        console.log(`[TB Import] ${debugInfo}`);
        break;
      }
      default:
        return NextResponse.json({ error: `${connection.system} import not yet supported` }, { status: 400 });
    }

    if (tbRows.length === 0) {
      return NextResponse.json({ error: 'No accounts found in accounting system' }, { status: 400 });
    }

    // Get existing rows — match on originalAccountCode (never changes after first import)
    // so re-imports update even if user has edited accountCode
    const existing = await prisma.auditTBRow.findMany({
      where: { engagementId },
      select: { id: true, accountCode: true, originalAccountCode: true },
    });
    // Build lookup: import code → existing row (check originalAccountCode first, then accountCode)
    const existingByOriginal = new Map<string, typeof existing[0]>();
    const existingByCode = new Map<string, typeof existing[0]>();
    for (const r of existing) {
      if (r.originalAccountCode) existingByOriginal.set(r.originalAccountCode, r);
      existingByCode.set(r.accountCode, r);
    }

    // Update existing rows or create new ones
    let created = 0;
    let updated = 0;
    let maxSort = existing.length;
    for (const row of tbRows) {
      const match = existingByOriginal.get(row.accountCode) || existingByCode.get(row.accountCode);
      if (match) {
        // Update balances and metadata on existing row, clear FS fields for re-classification
        await prisma.auditTBRow.update({
          where: { id: match.id },
          data: {
            currentYear: row.currentYear ?? null,
            priorYear: row.priorYear ?? null,
            sourceMetadata: (row as any).sourceMetadata ?? undefined,
            category: (row as any).category ?? undefined,
            fsNoteLevel: null,
            fsLevel: null,
            fsStatement: null,
            aiConfidence: null,
          },
        });
        updated++;
      } else {
        await prisma.auditTBRow.create({
          data: {
            engagementId,
            accountCode: row.accountCode,
            originalAccountCode: row.accountCode,
            description: row.description,
            currentYear: row.currentYear ?? null,
            priorYear: row.priorYear ?? null,
            category: (row as any).category ?? null,
            fsLevel: (row as any).fsLevel ?? null,
            fsStatement: (row as any).fsStatement ?? null,
            sourceMetadata: (row as any).sourceMetadata ?? null,
            sortOrder: ++maxSort,
          },
        });
        created++;
      }
    }

    const allRows = await prisma.auditTBRow.findMany({ where: { engagementId }, orderBy: { sortOrder: 'asc' } });
    return NextResponse.json({
      rows: allRows,
      imported: created,
      updated,
      total: tbRows.length,
      skipped: tbRows.length - created - updated,
      source: connection.system,
      orgName: connection.orgName,
      debug: debugInfo,
    });
  } catch (err: any) {
    console.error('TB import error:', err);
    return NextResponse.json({ error: `Import failed: ${err.message}` }, { status: 500 });
  }
}
