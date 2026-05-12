import { NextResponse } from 'next/server';
import { assertEngagementWriteAccess } from '@/lib/auth/engagement-auth';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { parseLoanCalcRoot } from '@/lib/loan-calculator';

/**
 * POST /api/engagements/[engagementId]/loan-calculator/copy-from-prior
 *
 * Returns the prior-period engagement's loan-calculator data for the
 * loan group matching the supplied `priorGroupId` (or the first group
 * if not specified). The response carries the loan header(s), schedule,
 * covenants and penalties — flow figures and tests are reset by the
 * client so the auditor re-evaluates them for the new period.
 *
 * This endpoint is READ-ONLY against the current engagement. The
 * panel merges the response into the currently-active group via its
 * normal save() flow, which preserves every OTHER group already on
 * the engagement (the previous version of this endpoint wrote the
 * legacy flat shape and clobbered any sibling groups).
 *
 * Body (optional): { priorGroupId?: string }
 */
export async function POST(req: Request, { params }: { params: Promise<{ engagementId: string }> }) {
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

  const body = await req.json().catch(() => ({}));
  const priorGroupId: string | undefined = typeof body?.priorGroupId === 'string' ? body.priorGroupId : undefined;

  const priorRow = await (prisma as any).auditLoanCalculator?.findUnique({
    where: { engagementId: engagement.priorPeriodEngagementId },
  });
  if (!priorRow?.data) {
    return NextResponse.json({ error: 'Prior engagement has no Loan Calculator data to copy.' }, { status: 404 });
  }
  const priorRoot = parseLoanCalcRoot(priorRow.data);
  if (priorRoot.groups.length === 0) {
    return NextResponse.json({ error: 'Prior engagement has no loan groups to copy.' }, { status: 404 });
  }
  const sourceGroup = priorGroupId
    ? priorRoot.groups.find(g => g.id === priorGroupId) || priorRoot.groups[0]
    : priorRoot.groups[0];

  // Carry header + covenants + penalties forward; reset flow figures and
  // tests so the auditor re-evaluates them for the new period.
  const carriedLoans = sourceGroup.loans.map(l => ({
    id: l.id,
    label: l.label,
    header: l.header,
    documents: [], // documents don't carry — they live against their original engagement
    covenants: (l.covenants || []).map(c => ({
      ...c,
      clientConfirmedViaPortal: false,
      portalRequestId: undefined,
      portalSentAt: undefined,
      metStatus: '' as const,
    })),
    penalties: l.penalties || [],
    schedule: [], // reset — auditor regenerates / extracts for new period
  }));

  return NextResponse.json({
    success: true,
    side: sourceGroup.side,
    setup: sourceGroup.setup,
    loans: carriedLoans,
    sourceLabel: sourceGroup.label,
    sourceFsLines: sourceGroup.fsLines,
  });
}
