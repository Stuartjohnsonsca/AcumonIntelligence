import { NextResponse } from 'next/server';
import { assertEngagementWriteAccess } from '@/lib/auth/engagement-auth';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

/**
 * POST /api/engagements/[engagementId]/loan-calculator/copy-from-prior
 *
 * Copies the prior-period engagement's loan-calculator JSON blob (loans,
 * headers, schedules, covenants, penalties) into the current engagement
 * — clearing the current-period flow figures so the auditor can refresh
 * them, but preserving the loan setup, lender names, agreement dates,
 * and any custom covenant/penalty rows.
 *
 * No body. The endpoint reads `priorPeriodEngagementId` off the current
 * engagement and returns the merged blob.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { engagementId } = await params;
  const guard = await assertEngagementWriteAccess(engagementId, session);
  if (guard instanceof NextResponse) return guard;

  const engagement = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    select: { firmId: true, priorPeriodEngagementId: true },
  });
  if (!engagement || engagement.firmId !== session.user.firmId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (!engagement.priorPeriodEngagementId) {
    return NextResponse.json({ error: 'No prior-period engagement linked to this audit.' }, { status: 412 });
  }

  const priorRow = await (prisma as any).auditLoanCalculator?.findUnique({
    where: { engagementId: engagement.priorPeriodEngagementId },
  });
  if (!priorRow?.data) {
    return NextResponse.json({ error: 'Prior engagement has no Loan Calculator data to copy.' }, { status: 404 });
  }
  const prior = priorRow.data as Record<string, any>;

  // Carry header + covenants + penalties forward; reset flow figures and
  // tests so the auditor re-evaluates them for the new period.
  const carriedLoans = Array.isArray(prior.loans) ? prior.loans.map((l: any) => ({
    id: l.id,
    label: l.label,
    header: l.header,
    documents: [], // documents don't carry — they live against their original engagement
    covenants: Array.isArray(l.covenants) ? l.covenants.map((c: any) => ({
      ...c,
      clientConfirmedViaPortal: false,
      portalRequestId: undefined,
      portalSentAt: undefined,
      metStatus: '',
    })) : [],
    penalties: Array.isArray(l.penalties) ? l.penalties : [],
    schedule: [], // reset — auditor regenerates / extracts for new period
  })) : [];

  const existing = await (prisma as any).auditLoanCalculator?.findUnique({ where: { engagementId } });
  const baseData = (existing?.data && typeof existing.data === 'object' && !Array.isArray(existing.data))
    ? existing.data as Record<string, unknown>
    : {};
  const merged = {
    ...baseData,
    side: prior.side || (baseData.side ?? 'liability'),
    setup: prior.setup || baseData.setup || { loanCount: carriedLoans.length, maxTranches: 1 },
    loans: carriedLoans,
    copiedFromPriorAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await (prisma as any).auditLoanCalculator?.upsert({
    where: { engagementId },
    create: { engagementId, data: merged as object },
    update: { data: merged as object },
  });

  return NextResponse.json({ success: true, data: merged });
}
