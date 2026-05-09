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
 * Today only Xero is wired, and Xero's public Reports API does NOT
 * expose filed VAT returns under the scopes this app currently
 * holds (accounting.reports.trialbalance.read only). So when a
 * Xero connection exists but VAT returns aren't reachable, we
 * report `kind: 'portal'` with a `hint` so the UI can explain the
 * fallback. A future commit will widen the Xero scope set + wire
 * the VAT-return aggregation, at which point this endpoint flips
 * to `kind: 'accounting'` for those clients automatically.
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
      // Today's Xero scope set (see SCOPES in lib/xero.ts) doesn't
      // include reports.read — the public VAT report endpoint
      // requires a wider scope and an HMRC MTD-enabled org. We hint
      // the UI so it can show the fallback rationale next to the
      // portal button instead of silently going to the client.
      return NextResponse.json({
        kind: 'portal',
        connector: { system: conn.system, label: systemLabel, orgName: conn.orgName ?? null },
        hint: `${systemLabel} is connected but VAT returns aren't yet reachable through our current ${systemLabel} scopes — falling back to portal request. We'll wire automatic extraction in a future update.`,
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
