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
    // Xero returns cumulative P&L from its financial year start, so we need
    // 4 TB snapshots to isolate single-period P&L figures:
    //   CY P&L = TB@cyEnd - TB@cyPLBase
    //   PY P&L = TB@pyEnd - TB@pyPLBase
    // Balance sheet items are point-in-time and don't need subtraction.
    const formatDate = (d: Date) => d.toISOString().split('T')[0];

    const cyEndDate = formatDate(engagement.period.endDate);              // e.g. 2025-03-31

    const cyPLBaseRaw = new Date(engagement.period.startDate);
    cyPLBaseRaw.setDate(cyPLBaseRaw.getDate() - 1);
    const cyPLBaseDate = formatDate(cyPLBaseRaw);                         // e.g. 2025-02-28

    const pyEndDate = cyPLBaseDate;                                       // PY end = CY P&L base

    // Mirror the period back using calendar month arithmetic to compute PY P&L base.
    // We subtract the same year/month offset from pyEnd as exists between cyPLBase and cyEnd,
    // then use end-of-month to handle varying month lengths correctly.
    // e.g. CY 1/3→31/3 (1 month): pyEnd=28/2, go back 1 month → end of Jan = 31/1
    // e.g. CY 1/1→31/3 (3 months): pyEnd=31/12, go back 3 months → end of Sep = 30/9
    const periodStart = new Date(engagement.period.startDate);
    const periodEnd = new Date(engagement.period.endDate);
    const monthSpan = (periodEnd.getFullYear() - periodStart.getFullYear()) * 12
      + periodEnd.getMonth() - periodStart.getMonth() + 1;

    // PY period start = periodStart minus monthSpan months.
    // PY P&L base = that date minus 1 day (end of month before PY period).
    const pyPeriodStart = new Date(Date.UTC(
      periodStart.getUTCFullYear(),
      periodStart.getUTCMonth() - monthSpan,
      periodStart.getUTCDate()
    ));
    pyPeriodStart.setUTCDate(pyPeriodStart.getUTCDate() - 1);
    const pyPLBaseDate = formatDate(pyPeriodStart);                       // e.g. 2025-01-31

    console.log(`[TB Import] Dates — CY end: ${cyEndDate}, CY P&L base: ${cyPLBaseDate}, PY end: ${pyEndDate}, PY P&L base: ${pyPLBaseDate}, period months: ${monthSpan}`);

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
        console.log(`[TB Import] Got ${accounts.length} accounts, fetching 4 TB reports...`);
        const [cyEndTB, cyPLBaseTB, pyEndTB, pyPLBaseTB] = await Promise.all([
          getTrialBalanceReport(engagement.clientId, cyEndDate, xeroAuth),
          getTrialBalanceReport(engagement.clientId, cyPLBaseDate, xeroAuth),
          getTrialBalanceReport(engagement.clientId, pyEndDate, xeroAuth),
          getTrialBalanceReport(engagement.clientId, pyPLBaseDate, xeroAuth),
        ]);
        console.log(`[TB Import] TB reports: CY end=${cyEndTB.size}, CY P&L base=${cyPLBaseTB.size}, PY end=${pyEndTB.size}, PY P&L base=${pyPLBaseTB.size}`);

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

        // ── Build lookup from chart of accounts (ALL accounts, not just ACTIVE) ──
        // Keyed by AccountID for direct match, plus name-based fallback
        const accountById = new Map<string, any>();
        const accountByName = new Map<string, any>();
        for (const a of accounts) {
          if (a.AccountID) accountById.set(a.AccountID, a);
          if (a.Name) accountByName.set(a.Name.toLowerCase(), a);
        }

        console.log(`[TB Import] Chart of accounts: ${accounts.length} total, ${accounts.filter((a: any) => a.Status === 'ACTIVE').length} active`);

        // Credit-normal account types: use credit - debit so values are positive
        const creditNormalTypes = new Set(['REVENUE', 'OTHERINCOME', 'CURRLIAB', 'TERMLIAB', 'EQUITY']);
        function netBalance(entry: { debit: number; credit: number } | undefined, accountType: string): number {
          if (!entry) return 0;
          return creditNormalTypes.has(accountType)
            ? entry.credit - entry.debit   // Revenue/liabilities/equity: positive when credit balance
            : entry.debit - entry.credit;  // Assets/expenses: positive when debit balance
        }

        // ── Collect ALL unique account IDs across ALL 4 TB reports ──
        // This is TB-report-driven: every account with any balance in any period is included.
        const allAccountIds = new Set<string>();
        for (const tb of [cyEndTB, cyPLBaseTB, pyEndTB, pyPLBaseTB]) {
          for (const accountId of tb.keys()) allAccountIds.add(accountId);
        }
        console.log(`[TB Import] Unique account IDs across all 4 TB reports: ${allAccountIds.size}`);

        // ── Build rows: iterate every TB account, enrich with chart of accounts metadata ──
        // Track imbalance so we can add a balancing "Profit/Loss for Period" equity line.
        // Debit-normal accounts contribute positively, credit-normal accounts negatively.
        let cyImbalance = 0, pyImbalance = 0;
        let matchedById = 0, matchedByName = 0, noMetadata = 0;

        for (const accountId of allAccountIds) {
          // Look up chart-of-accounts metadata by AccountID, then by name
          let acct = accountById.get(accountId);
          if (!acct) {
            // Try name-based fallback using the account name from whichever TB has this entry
            const tbEntry = cyEndTB.get(accountId) || pyEndTB.get(accountId)
              || cyPLBaseTB.get(accountId) || pyPLBaseTB.get(accountId);
            if (tbEntry) {
              acct = accountByName.get(tbEntry.accountName.toLowerCase());
              if (acct) matchedByName++;
            }
            if (!acct) noMetadata++;
          } else {
            matchedById++;
          }

          const accountType = acct?.Type || '';
          const accountName = acct?.Name
            || cyEndTB.get(accountId)?.accountName
            || pyEndTB.get(accountId)?.accountName
            || cyPLBaseTB.get(accountId)?.accountName
            || pyPLBaseTB.get(accountId)?.accountName
            || accountId;

          // Use Code if available, otherwise AccountID as the code (never blank)
          const accountCode = acct?.Code || accountId;

          const isPnL = accountType ? statementMap[accountType] === 'Profit & Loss' : false;

          // BS: point-in-time at period end. P&L: subtract base to isolate period.
          const cyEnd = cyEndTB.get(accountId);
          const cyBase = cyPLBaseTB.get(accountId);
          const pyEnd = pyEndTB.get(accountId);
          const pyBase = pyPLBaseTB.get(accountId);

          const cyAmount = isPnL
            ? netBalance(cyEnd, accountType) - netBalance(cyBase, accountType)
            : netBalance(cyEnd, accountType);
          const pyAmount = isPnL
            ? netBalance(pyEnd, accountType) - netBalance(pyBase, accountType)
            : netBalance(pyEnd, accountType);

          // Track imbalance: debit-normal adds, credit-normal subtracts
          if (creditNormalTypes.has(accountType)) {
            cyImbalance -= cyAmount;
            pyImbalance -= pyAmount;
          } else {
            cyImbalance += cyAmount;
            pyImbalance += pyAmount;
          }

          tbRows.push({
            accountCode,
            description: accountName,
            currentYear: cyAmount,
            priorYear: pyAmount,
            category: typeMap[accountType] || accountType || undefined,
            fsLevel: typeMap[accountType] || acct?.Class || '',
            fsStatement: statementMap[accountType] || (acct?.Class === 'ASSET' || acct?.Class === 'LIABILITY' || acct?.Class === 'EQUITY' ? 'Balance Sheet' : 'Profit & Loss'),
          } as any);
        }

        // Also include active chart-of-accounts entries with zero balances
        // (ensures the full chart is represented even for accounts with no activity)
        const includedIds = new Set(allAccountIds);
        for (const a of accounts) {
          if (a.Status !== 'ACTIVE') continue;
          if (!a.AccountID || includedIds.has(a.AccountID)) continue;
          const accountCode = a.Code || a.AccountID;
          tbRows.push({
            accountCode,
            description: a.Name || '',
            currentYear: 0,
            priorYear: 0,
            category: typeMap[a.Type] || a.Type || undefined,
            fsLevel: typeMap[a.Type] || a.Class || '',
            fsStatement: statementMap[a.Type] || (a.Class === 'ASSET' || a.Class === 'LIABILITY' || a.Class === 'EQUITY' ? 'Balance Sheet' : 'Profit & Loss'),
          } as any);
          includedIds.add(a.AccountID);
        }

        // ── Add balancing "Profit/Loss for Period" equity line ──
        // When P&L is stripped to a single period, the BS still reflects full cumulative
        // equity. This line bridges the gap so the TB always totals zero.
        if (cyImbalance !== 0 || pyImbalance !== 0) {
          tbRows.push({
            accountCode: 'PL-PERIOD',
            description: 'Profit/Loss for Period',
            currentYear: cyImbalance,   // credit-normal: stored positive = credit balance
            priorYear: pyImbalance,
            category: 'Equity',
            fsLevel: 'Equity',
            fsStatement: 'Balance Sheet',
          } as any);
          console.log(`[TB Import] Added Profit/Loss for Period — CY: ${cyImbalance}, PY: ${pyImbalance}`);
        }

        debugInfo = `Accounts: ${accounts.length}, TB unique IDs: ${allAccountIds.size}, matched by ID: ${matchedById}, by name: ${matchedByName}, no metadata: ${noMetadata}, total rows: ${tbRows.length}`;
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
        // Update balances on existing row (preserve user-edited accountCode, metadata, etc.)
        await prisma.auditTBRow.update({
          where: { id: match.id },
          data: {
            currentYear: row.currentYear ?? null,
            priorYear: row.priorYear ?? null,
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
