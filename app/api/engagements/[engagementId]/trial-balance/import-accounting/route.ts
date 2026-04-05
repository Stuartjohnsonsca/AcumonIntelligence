import { NextResponse, after } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getAccounts, getTrialBalanceReport, getValidAccessToken } from '@/lib/xero';

export const maxDuration = 120;

/**
 * POST /api/engagements/[engagementId]/trial-balance/import-accounting
 * Imports trial balance from connected accounting system (Xero, etc.)
 * Runs as a background task — returns taskId immediately.
 * Poll with { action: 'poll', taskId } to check progress.
 */
export async function POST(req: Request, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await params;

  const body = await req.json().catch(() => ({}));

  // Poll for task status
  if (body.action === 'poll' && body.taskId) {
    const task = await prisma.backgroundTask.findUnique({ where: { id: body.taskId } });
    if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    return NextResponse.json({ status: task.status, progress: task.progress, error: task.error, result: task.result });
  }

  const engagement = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    select: { clientId: true, firmId: true, period: { select: { startDate: true, endDate: true } } },
  });
  if (!engagement) return NextResponse.json({ error: 'Engagement not found' }, { status: 404 });
  if (engagement.firmId !== session.user.firmId && !session.user.isSuperAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const connection = await prisma.accountingConnection.findFirst({
    where: { clientId: engagement.clientId },
  });
  if (!connection) {
    return NextResponse.json({ error: 'No accounting system connected. Connect via Opening tab.' }, { status: 400 });
  }
  if (new Date() > connection.expiresAt) {
    return NextResponse.json({ error: `${connection.system} connection expired. Please reconnect.` }, { status: 400 });
  }

  // Create background task and return immediately
  const task = await prisma.backgroundTask.create({
    data: { userId: session.user.id, type: 'tb-import', status: 'running', progress: { phase: 'starting' } as any },
  });

  // Run import in background — continues even if user navigates away
  after(async () => {
    try {
      let tbRows: { accountCode: string; description: string; currentYear: number; priorYear: number; category?: string; sourceMetadata?: any }[] = [];
      let debugInfo = '';

      const formatDate = (d: Date) => d.toISOString().split('T')[0];
      const currentYearDate = formatDate(engagement.period.endDate);
      const priorDate = new Date(engagement.period.startDate);
      priorDate.setDate(priorDate.getDate() - 1);
      const priorYearDate = formatDate(priorDate);

      await prisma.backgroundTask.update({
        where: { id: task.id },
        data: { progress: { phase: 'connecting', message: `Connecting to ${connection.system}...` } as any },
      });

      switch (connection.system.toLowerCase()) {
        case 'xero': {
          let xeroAuth = await getValidAccessToken(engagement.clientId);
          let accounts: any[];
          try {
            accounts = await getAccounts(engagement.clientId, undefined, xeroAuth);
          } catch (err: any) {
            xeroAuth = await getValidAccessToken(engagement.clientId);
            accounts = await getAccounts(engagement.clientId, undefined, xeroAuth);
          }

          await prisma.backgroundTask.update({
            where: { id: task.id },
            data: { progress: { phase: 'fetching', message: `Fetching TB reports for ${accounts.length} accounts...` } as any },
          });

          const [currentTB, priorTB] = await Promise.all([
            getTrialBalanceReport(engagement.clientId, currentYearDate, xeroAuth),
            getTrialBalanceReport(engagement.clientId, priorYearDate, xeroAuth),
          ]);

          const typeMap: Record<string, string> = {
            'REVENUE': 'Revenue', 'DIRECTCOSTS': 'Cost of Sales', 'EXPENSE': 'Expenses',
            'OVERHEADS': 'Administrative Expenses', 'FIXED': 'Fixed Assets', 'CURRENT': 'Current Assets',
            'CURRLIAB': 'Current Liabilities', 'TERMLIAB': 'Long Term Liabilities', 'EQUITY': 'Equity',
            'OTHERINCOME': 'Other Income', 'DEPRECIATN': 'Depreciation', 'BANK': 'Cash and Bank',
            'INVENTORY': 'Stock', 'PREPAYMENT': 'Prepayments',
          };

          function netBalance(entry: { debit: number; credit: number } | undefined): number {
            if (!entry) return 0;
            return entry.debit - entry.credit;
          }

          let matched = 0;
          for (const a of accounts) {
            const accountId = a.AccountID || '';
            const accountType = a.Type || '';
            const accountCode = a.Code || accountId;
            const cy = currentTB.get(accountId);
            const py = priorTB.get(accountId);
            if (cy || py) matched++;
            tbRows.push({
              accountCode,
              description: a.Name || '',
              currentYear: netBalance(cy),
              priorYear: netBalance(py),
              category: typeMap[accountType] || accountType || undefined,
              sourceMetadata: { xeroType: accountType, xeroClass: a.Class || '', xeroDescription: a.Description || '' },
            });
          }

          const beforeFilter = tbRows.length;
          tbRows = tbRows.filter(r => r.currentYear !== 0 || r.priorYear !== 0);

          let xeroCyTotal = 0, xeroPyTotal = 0;
          for (const [, entry] of currentTB) xeroCyTotal += (entry.debit - entry.credit);
          for (const [, entry] of priorTB) xeroPyTotal += (entry.debit - entry.credit);

          await prisma.auditEngagement.update({
            where: { id: engagementId },
            data: {
              tbXeroSummary: {
                source: connection.system, cyDate: currentYearDate, pyDate: priorYearDate,
                cyTotal: Math.round(xeroCyTotal * 100) / 100, pyTotal: Math.round(xeroPyTotal * 100) / 100,
                cyEntries: currentTB.size, pyEntries: priorTB.size, importedAt: new Date().toISOString(),
              },
            },
          });

          debugInfo = `Accounts: ${accounts.length}, matched TB: ${matched}, before filter: ${beforeFilter}, after: ${tbRows.length}`;
          break;
        }
        default:
          throw new Error(`${connection.system} import not yet supported`);
      }

      if (tbRows.length === 0) {
        throw new Error('No accounts found in accounting system');
      }

      await prisma.backgroundTask.update({
        where: { id: task.id },
        data: { progress: { phase: 'saving', message: `Saving ${tbRows.length} rows...` } as any },
      });

      // Get existing rows for matching
      const existing = await prisma.auditTBRow.findMany({
        where: { engagementId },
        select: { id: true, accountCode: true, originalAccountCode: true },
      });
      const existingByOriginal = new Map<string, typeof existing[0]>();
      const existingByCode = new Map<string, typeof existing[0]>();
      for (const r of existing) {
        if (r.originalAccountCode) existingByOriginal.set(r.originalAccountCode, r);
        existingByCode.set(r.accountCode, r);
      }

      let created = 0, updated = 0;
      let maxSort = existing.length;
      for (const row of tbRows) {
        const match = existingByOriginal.get(row.accountCode) || existingByCode.get(row.accountCode);
        if (match) {
          await prisma.auditTBRow.update({
            where: { id: match.id },
            data: {
              currentYear: row.currentYear ?? null, priorYear: row.priorYear ?? null,
              sourceMetadata: row.sourceMetadata ?? undefined,
              category: row.category ?? undefined,
              fsNoteLevel: null, fsLevel: null, fsStatement: null, aiConfidence: null,
            },
          });
          updated++;
        } else {
          await prisma.auditTBRow.create({
            data: {
              engagementId, accountCode: row.accountCode, originalAccountCode: row.accountCode,
              description: row.description, currentYear: row.currentYear ?? null, priorYear: row.priorYear ?? null,
              category: row.category ?? null, sourceMetadata: row.sourceMetadata ?? null, sortOrder: ++maxSort,
            },
          });
          created++;
        }
      }

      await prisma.backgroundTask.update({
        where: { id: task.id },
        data: {
          status: 'completed',
          result: { imported: created, updated, total: tbRows.length, source: connection.system, orgName: connection.orgName, debug: debugInfo } as any,
        },
      });
    } catch (err: any) {
      console.error('TB import error:', err);
      await prisma.backgroundTask.update({
        where: { id: task.id },
        data: { status: 'error', error: err.message || 'Import failed' },
      });
    }
  });

  return NextResponse.json({ taskId: task.id, status: 'running' });
}
