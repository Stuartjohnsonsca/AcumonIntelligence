import { NextRequest, NextResponse } from 'next/server';
import { assertEngagementWriteAccess } from '@/lib/auth/engagement-auth';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getProfitAndLossReport } from '@/lib/xero';
import type { VatPeriodRow, VatRecData } from '@/lib/vat-reconciliation';

/**
 * POST /api/engagements/[engagementId]/vat-reconciliation/extract
 *
 * Pull the four per-period figures (Net Revenue, Net Purchases, Sales
 * VAT, Purchase VAT) straight from the connected accounting system
 * — no portal round-trip needed. Today only Xero is implemented.
 *
 * Per-period maths:
 *   - Call Xero's Profit & Loss report scoped to the period's
 *     start..end dates.
 *   - Sum the Income section → Net Revenue.
 *   - Sum the Cost-of-Sales + Operating Expenses sections → Net Purchases.
 *   - Sales VAT is derived from the firm's revenue mappings:
 *         sum (revenue line × applicable VAT rate %)
 *     where the line's account code maps to a firm rate. Lines that
 *     don't have a mapping contribute zero VAT (the auditor can fix
 *     up the mapping in the panel and re-run).
 *   - Purchase VAT is left null in this pass — the panel doesn't
 *     yet capture purchase-side rate mappings, so there's nothing to
 *     multiply against. Auditor types it manually; the grid's
 *     buffered NumCell now makes that painless.
 *
 * Existing manual values on a row are preserved unless the extraction
 * actually carries a number — null fields never overwrite live data.
 *
 * Body: { periodEndings: string[] }   — the ISO dates the panel sees
 *        as periodRow.periodEnding for non-opening rows. We use these
 *        as a filter so the extract only touches rows the auditor
 *        currently sees.
 *
 * Response (success):
 *   { periodRows: VatPeriodRow[], sourceLabel: 'Xero' }
 *
 * Response shape on a partial / scope failure mirrors the success
 * shape — periodRows just won't carry the figures the failing report
 * was meant to feed. The grid still benefits from any rows that did
 * extract.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { engagementId } = await params;
  const __eqrGuard = await assertEngagementWriteAccess(engagementId, session);
  if (__eqrGuard instanceof NextResponse) return __eqrGuard;

  const engagement = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    select: { firmId: true, clientId: true },
  });
  if (!engagement) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (engagement.firmId !== session.user.firmId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const conn = await prisma.accountingConnection.findFirst({
    where: { clientId: engagement.clientId },
    select: { system: true, orgName: true },
  });
  if (!conn) {
    return NextResponse.json({
      error: 'No accounting connection on this client — use the portal request instead.',
    }, { status: 412 });
  }

  // Load the existing audit_vat_reconciliations.data so we can
  // (a) read the firm-level revenue mappings + the existing periodRows
  // (b) write the patched rows back without clobbering bank
  //     verifications, mappings, opening row, conclusion etc.
  const existingRow = await (prisma as any).auditVatReconciliation?.findUnique({
    where: { engagementId },
  });
  const baseData = (existingRow?.data && typeof existingRow.data === 'object' && !Array.isArray(existingRow.data))
    ? existingRow.data as unknown as VatRecData
    : null;
  const existingRows: VatPeriodRow[] = baseData?.periodRows ?? [];
  if (existingRows.length === 0) {
    return NextResponse.json({
      error: 'No period rows generated yet — open the VAT Reconciliation panel once so the schedule is built, then retry the fetch.',
    }, { status: 412 });
  }

  // Body shape {periodEndings: string[]}. We tolerate it being absent
  // / malformed and just process every non-opening row.
  let bodyEndings: string[] | null = null;
  try {
    const body = await req.json();
    if (Array.isArray(body?.periodEndings)) {
      bodyEndings = body.periodEndings.filter((s: unknown): s is string => typeof s === 'string' && s.length > 0);
    }
  } catch { /* tolerate */ }

  const targetRows = existingRows.filter(r => {
    if (r.isOpening) return false;
    if (!bodyEndings || bodyEndings.length === 0) return true;
    return bodyEndings.includes(r.periodEnding);
  });

  // Look up the firm's VAT rates so we can apply per-revenue-account
  // percentages when deriving Sales VAT. Mappings live on the
  // engagement (data.revenueMappings); rates live in a firm-wide
  // MethodologyRiskTable row keyed by tableType='firm_vat_config' —
  // same source readFirmVatConfig() uses on the client. Both are
  // needed to derive Sales VAT.
  let firmRates: Array<{ id: string; ratePercent: number }> = [];
  try {
    const firmVatTable = await prisma.methodologyRiskTable.findUnique({
      where: { firmId_tableType: { firmId: engagement.firmId, tableType: 'firm_vat_config' } },
    });
    const tableData = firmVatTable?.data as { rates?: unknown } | null;
    if (tableData && Array.isArray(tableData.rates)) {
      firmRates = (tableData.rates as Array<{ id: string; ratePercent: number }>).filter(
        r => typeof r?.id === 'string' && Number.isFinite(Number(r?.ratePercent)),
      );
    }
  } catch (err) {
    console.warn('[vat-extract] firm_vat_config lookup failed (non-fatal):', err);
  }
  const rateById = new Map<string, number>(firmRates.map(r => [r.id, Number(r.ratePercent) || 0]));
  const revenueMappings: Record<string, { vatRateId: string; ratePercentOverride?: number | null }> =
    (baseData?.revenueMappings as any) ?? {};

  switch (conn.system) {
    case 'xero': {
      const patched: VatPeriodRow[] = existingRows.map(r => ({ ...r }));
      let extractedAny = false;
      const reports: Array<{ periodEnding: string; ok: boolean; reason?: string }> = [];

      for (const row of targetRows) {
        // P&L is summed per-period from periodStart..periodEnd, but
        // generateVatPeriodRows produces only periodEnd + days fields
        // on the row. Reconstruct periodStart by stepping back
        // (daysInPeriod - 1) days from the period end (Xero P&L is
        // inclusive of both bounds).
        const endDate = new Date(row.periodEnding);
        if (Number.isNaN(endDate.getTime())) {
          reports.push({ periodEnding: row.periodEnding, ok: false, reason: 'invalid period end' });
          continue;
        }
        const days = Math.max(1, row.daysInPeriod || 1);
        const startDate = new Date(endDate.getTime() - (days - 1) * 86_400_000);
        const fromIso = startDate.toISOString().slice(0, 10);
        const toIso = endDate.toISOString().slice(0, 10);

        try {
          const pl = await getProfitAndLossReport(engagement.clientId, fromIso, toIso);
          if (pl.lines.length === 0 && pl.totalIncome === 0 && pl.totalExpenses === 0 && pl.totalCostOfSales === 0) {
            reports.push({ periodEnding: row.periodEnding, ok: false, reason: 'empty P&L (scope or no activity)' });
            continue;
          }

          // Net Revenue + Net Purchases come from section totals so
          // we don't double-count when Xero subtotals aren't matched
          // perfectly by line sums.
          const netRevenue = round2(pl.totalIncome);
          const netPurchases = round2(pl.totalCostOfSales + pl.totalExpenses);

          // Sales VAT — sum (incomeLine × applicable rate %) over
          // every income line whose account code has a mapping. Lines
          // without a mapping contribute zero. The Xero P&L row's
          // account code lives in cells[0].Attributes; our parser
          // surfaces it as accountId — but the auditor's mappings are
          // keyed by accountCode. Xero reuses the same string for
          // both in the report's account attribute, so the lookup is
          // direct.
          let salesVat = 0;
          for (const line of pl.lines) {
            if (line.section !== 'income') continue;
            const map = revenueMappings[line.accountId];
            if (!map) continue;
            const pct = (typeof map.ratePercentOverride === 'number' && map.ratePercentOverride >= 0)
              ? map.ratePercentOverride
              : (rateById.get(map.vatRateId) ?? 0);
            salesVat += line.amount * (pct / 100);
          }
          salesVat = round2(salesVat);

          const idx = patched.findIndex(r => r.id === row.id);
          if (idx >= 0) {
            patched[idx] = {
              ...patched[idx],
              netRevenue: netRevenue || patched[idx].netRevenue,
              netPurchases: netPurchases || patched[idx].netPurchases,
              salesVat: salesVat || patched[idx].salesVat,
              // purchaseVat intentionally not touched — see comment
              // at the top of this file.
            };
            extractedAny = true;
            reports.push({ periodEnding: row.periodEnding, ok: true });
          }
        } catch (err) {
          console.warn(`[vat-extract/xero] period ${row.periodEnding} failed:`, err instanceof Error ? err.message : err);
          reports.push({
            periodEnding: row.periodEnding,
            ok: false,
            reason: err instanceof Error ? err.message : 'unknown error',
          });
        }
      }

      if (!extractedAny) {
        return NextResponse.json({
          error: 'Could not extract any periods from Xero. Reconnect Xero (the connection may pre-date the widened scope set) and retry.',
          reports,
        }, { status: 502 });
      }

      // Persist + return. The panel updates its own state from the
      // periodRows in the response; the upsert here is so a refresh
      // doesn't lose the extraction.
      const mergedData: VatRecData = { ...(baseData ?? { ratesConsistent: null, revenueMappings: {}, periodRows: [], bankVerifications: [], tbVatRows: [] }), periodRows: patched };
      try {
        await (prisma as any).auditVatReconciliation?.upsert({
          where: { engagementId },
          create: { id: crypto.randomUUID(), engagementId, data: mergedData as unknown as object },
          update: { data: mergedData as unknown as object },
        });
      } catch (err) {
        console.warn('[vat-extract/xero] persist failed (non-fatal):', err);
      }

      return NextResponse.json({
        periodRows: patched,
        sourceLabel: 'Xero',
        reports,
      });
    }

    default:
      return NextResponse.json({
        error: `VAT-return extraction from ${conn.system} isn't wired in this build yet — please use the portal request instead.`,
        notImplemented: true,
      }, { status: 501 });
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
