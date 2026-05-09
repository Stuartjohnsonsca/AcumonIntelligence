import { NextRequest, NextResponse } from 'next/server';
import { assertEngagementWriteAccess } from '@/lib/auth/engagement-auth';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

/**
 * POST /api/engagements/[engagementId]/vat-reconciliation/extract
 *
 * Pulls filed VAT returns straight from whichever accounting connector
 * is wired on the client (Xero / Sage / QuickBooks) so the auditor
 * doesn't have to go via the portal. The response shape mirrors the
 * grid's `periodRows` so the panel can splice it in via onPatch.
 *
 * Today this endpoint is a STUB. The Xero connection now holds the
 * widened scope set (accounting.reports.read + journals + budgets),
 * so filed VAT returns are reachable in principle — but the per-system
 * fetch + period-bucket aggregation hasn't been written yet, and the
 * Sage/QuickBooks branches don't exist. A future commit will replace
 * the 501 response below with the real implementation.
 *
 * The /source sibling endpoint already gates the UI so we should
 * never reach this path with a non-supportive connector — but the
 * 501 fallback is here as a defence-in-depth so the grid surfaces a
 * clear message and the auditor can fall back to the portal in one
 * extra click.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ engagementId: string }> }) {
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

  // Per-system extractor. Each branch returns either
  //   { periodRows: VatPeriodRow[], sourceLabel: string }
  // for the grid to splice in, or surfaces a 501 with a hint when
  // VAT returns aren't reachable through the connector's current
  // scope set / API surface.
  switch (conn.system) {
    case 'xero':
    default:
      return NextResponse.json({
        error: `VAT-return extraction from ${conn.system} isn't wired in this build yet — please use the portal request instead.`,
        notImplemented: true,
      }, { status: 501 });
  }
}
