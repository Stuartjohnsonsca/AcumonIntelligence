import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

/**
 * GET /api/engagements/[engagementId]/vat-reconciliation/source
 *
 * Tells the VAT Reconciliation panel where its VAT-return data
 * should come from for THIS engagement, so the auditor sees a
 * single button labelled appropriately rather than having to know
 * which connector the firm has wired up. Read-only — the actual
 * extraction / portal-request fan-out lives on the sibling
 * `/extract` and `/request-returns` endpoints.
 *
 * Decision tree:
 *   1. Accounting connection on the client (Xero / Sage / QB) AND
 *      the connector reports VAT-return data is available →
 *      `kind: 'accounting'`. Panel renders 'Fetch VAT returns from
 *      <System>' and POSTs to /extract.
 *   2. No connector, OR connector exists but doesn't surface VAT
 *      returns → `kind: 'portal'`. Panel falls back to the existing
 *      'Request VAT returns via portal' button, POSTing to
 *      /request-returns.
 *
 * Xero is wired: the connection now holds `accounting.reports.read`
 * (which surfaces P&L per-account-per-period — what the auto-extract
 * path uses to derive Net Revenue + Net Purchases) plus
 * `accounting.journals.read` for completeness. The /extract sibling
 * fetches a P&L per period, sums income / cost-of-sales / expenses
 * sections, and writes the results back into periodRows.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { engagementId } = await params;
  const engagement = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    select: { firmId: true, clientId: true },
  });
  if (!engagement) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (engagement.firmId !== session.user.firmId && !session.user.isSuperAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const conn = await prisma.accountingConnection.findFirst({
    where: { clientId: engagement.clientId },
    select: { system: true, orgName: true, expiresAt: true },
  });

  if (!conn) {
    return NextResponse.json({ kind: 'portal' });
  }

  const systemLabel = labelFor(conn.system);

  // Per-system support gate. As each connector grows VAT-return
  // extraction, flip its case to return kind:'accounting'.
  switch (conn.system) {
    case 'xero': {
      // Xero now holds accounting.reports.read, so the P&L report
      // (used by /extract to derive Net Revenue + Net Purchases per
      // period) is reachable. If the connection pre-dates the
      // widened scope set the auditor will see a 403 surface from
      // /extract; the panel handles that with a graceful fallback
      // and a reconnect hint.
      return NextResponse.json({
        kind: 'accounting',
        connector: { system: conn.system, label: systemLabel, orgName: conn.orgName ?? null },
      });
    }
    default: {
      return NextResponse.json({
        kind: 'portal',
        connector: { system: conn.system, label: systemLabel, orgName: conn.orgName ?? null },
        hint: `${systemLabel} is connected but our VAT-return extractor for that system hasn't been wired yet — falling back to portal request.`,
      });
    }
  }
}

function labelFor(system: string): string {
  if (system === 'xero') return 'Xero';
  if (system === 'sage') return 'Sage';
  if (system === 'quickbooks') return 'QuickBooks';
  return system.charAt(0).toUpperCase() + system.slice(1);
}
