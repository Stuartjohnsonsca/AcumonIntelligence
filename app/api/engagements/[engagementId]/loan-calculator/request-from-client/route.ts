import { NextRequest, NextResponse } from 'next/server';
import { assertEngagementWriteAccess } from '@/lib/auth/engagement-auth';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

/**
 * POST /api/engagements/[engagementId]/loan-calculator/request-from-client
 *
 * Body: { kind: 'documents'|'covenants'|'impairment_evidence',
 *         loanLabels?: string[], message?: string }
 *
 * Creates a PortalRequest scoped to the Loan Calculator. The `kind`
 * drives the section + question copy:
 *   - documents: ask the client to upload the loan agreement(s), drawdown
 *     notices and statements.
 *   - covenants: ask the client to confirm every covenant has been met
 *     for the period.
 *   - impairment_evidence: ask for performing-vs-non-performing evidence
 *     when the auditor flags potential impairment on a receivable.
 *
 * Persists the new PortalRequest id + timestamp on the engagement's
 * loan_calculator JSON blob so the panel can show a "Requested on X"
 * badge instead of re-firing the portal request.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { engagementId } = await params;
  const guard = await assertEngagementWriteAccess(engagementId, session);
  if (guard instanceof NextResponse) return guard;

  const engagement = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    select: { clientId: true, firmId: true },
  });
  if (!engagement || engagement.firmId !== session.user.firmId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const kind: 'documents' | 'covenants' | 'impairment_evidence' =
    body?.kind === 'covenants' || body?.kind === 'impairment_evidence' ? body.kind : 'documents';
  const loanLabels: string[] = Array.isArray(body?.loanLabels)
    ? body.loanLabels.filter((s: unknown): s is string => typeof s === 'string')
    : [];
  const message: string = typeof body?.message === 'string' ? body.message : '';
  // Optional group id — when present, the request pointer is written
  // into the matching group inside `data.groups[]` instead of the
  // legacy top-level keys. The panel always supplies it.
  const groupId: string | undefined = typeof body?.groupId === 'string' ? body.groupId : undefined;

  const loanListMd = loanLabels.length > 0
    ? loanLabels.map(l => `- ${l}`).join('\n')
    : '';

  let section: string;
  let question: string;
  if (kind === 'documents') {
    section = 'loan_documents';
    question = [
      'Please upload the loan documentation for each loan currently in place, including:',
      '',
      '- Signed facility / loan agreement',
      '- Any drawdown notices or variation letters',
      '- Most recent lender statement showing balance + interest charged',
      '- Any side-letters, security / debenture agreements',
      '',
      loanListMd ? `Loans in scope:\n${loanListMd}` : '',
      '',
      message,
    ].filter(Boolean).join('\n');
  } else if (kind === 'covenants') {
    section = 'loan_covenants';
    question = [
      'Please confirm that all covenants on the loan agreement(s) listed below have been met for the audit period, and provide any supporting workings (e.g. covenant calculation packs sent to the lender).',
      '',
      loanListMd ? `Loans in scope:\n${loanListMd}` : '',
      '',
      'Confirm Y / N for each loan and attach evidence.',
      '',
      message,
    ].filter(Boolean).join('\n');
  } else {
    section = 'loan_impairment_evidence';
    question = [
      'We are reviewing the recoverability of the loan receivable(s) listed below.',
      '',
      loanListMd ? `Loans in scope:\n${loanListMd}` : '',
      '',
      'Please provide evidence supporting whether each loan is currently a performing or non-performing loan — most recent borrower management accounts, repayment history, any communication with the borrower about deferrals or restructuring, and any security valuations.',
      '',
      message,
    ].filter(Boolean).join('\n');
  }

  const portalRequest = await prisma.portalRequest.create({
    data: {
      clientId: engagement.clientId,
      engagementId,
      section,
      question,
      status: 'outstanding',
      requestedById: session.user.id,
      requestedByName: session.user.name || session.user.email || 'Audit Team',
    },
  });

  // Persist a pointer on the loan-calculator blob — scoped to the
  // active group when `groupId` is supplied (the panel always does),
  // otherwise written at the top level for backward compatibility.
  try {
    const existing = await (prisma as any).auditLoanCalculator?.findUnique({ where: { engagementId } });
    const baseData = (existing?.data && typeof existing.data === 'object' && !Array.isArray(existing.data))
      ? existing.data as Record<string, unknown>
      : {};
    const sentAt = new Date().toISOString();
    let merged: Record<string, unknown>;
    if (groupId && Array.isArray((baseData as any).groups)) {
      const groups = ((baseData as any).groups as any[]).map(g => {
        if (!g || g.id !== groupId) return g;
        if (kind === 'documents') {
          return { ...g, documentsRequest: { portalRequestId: portalRequest.id, sentAt } };
        }
        if (kind === 'covenants') {
          const existingCov = (g.covenants && typeof g.covenants === 'object' && !Array.isArray(g.covenants)) ? g.covenants : {};
          return { ...g, covenants: { ...existingCov, portalRequestId: portalRequest.id, portalSentAt: sentAt } };
        }
        const existingImp = (g.impairment && typeof g.impairment === 'object' && !Array.isArray(g.impairment)) ? g.impairment : {};
        return { ...g, impairment: { ...existingImp, portalRequestId: portalRequest.id, portalSentAt: sentAt } };
      });
      merged = { ...baseData, groups, updatedAt: new Date().toISOString() };
    } else if (kind === 'documents') {
      merged = { ...baseData, documentsRequest: { portalRequestId: portalRequest.id, sentAt } };
    } else if (kind === 'covenants') {
      const existingCov = (baseData.covenants && typeof baseData.covenants === 'object' && !Array.isArray(baseData.covenants))
        ? baseData.covenants as Record<string, unknown>
        : {};
      merged = { ...baseData, covenants: { ...existingCov, portalRequestId: portalRequest.id, portalSentAt: sentAt } };
    } else {
      const existingImp = (baseData.impairment && typeof baseData.impairment === 'object' && !Array.isArray(baseData.impairment))
        ? baseData.impairment as Record<string, unknown>
        : {};
      merged = { ...baseData, impairment: { ...existingImp, portalRequestId: portalRequest.id, portalSentAt: sentAt } };
    }
    await (prisma as any).auditLoanCalculator?.upsert({
      where: { engagementId },
      create: { engagementId, data: merged as object },
      update: { data: merged as object },
    });
  } catch (err) {
    console.warn('[loan-calculator/request-from-client] persist pointer failed:', err);
  }

  return NextResponse.json({ id: portalRequest.id, sentAt: new Date().toISOString(), kind });
}
