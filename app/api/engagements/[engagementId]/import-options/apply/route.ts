import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { applyProposals } from '@/lib/import-options/apply-proposals';
import type { ImportOptionsState, ProposalRow } from '@/lib/import-options/types';

// POST /api/engagements/[id]/import-options/apply
// Body: { extractionId, proposals: ProposalRow[] }
// Writes approved (non-deleted) rows into the relevant tab storage and
// tags __fieldmeta so the orange dashed surround renders.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ engagementId: string }> },
) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { engagementId } = await params;

  const engagement = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    select: { firmId: true, importOptions: true },
  });
  if (!engagement || engagement.firmId !== session.user.firmId) {
    return NextResponse.json({ error: 'Engagement not found' }, { status: 404 });
  }

  const body = await req.json().catch(() => ({})) as {
    extractionId?: string;
    proposals?: ProposalRow[];
  };
  const { extractionId, proposals } = body;
  if (!extractionId || !Array.isArray(proposals)) {
    return NextResponse.json({ error: 'extractionId and proposals are required' }, { status: 400 });
  }

  const proposal = await prisma.importExtractionProposal.findUnique({ where: { id: extractionId } });
  if (!proposal || proposal.engagementId !== engagementId) {
    return NextResponse.json({ error: 'Extraction not found' }, { status: 404 });
  }
  if (proposal.status !== 'pending') {
    return NextResponse.json({ error: `Extraction already ${proposal.status}` }, { status: 409 });
  }

  const result = await applyProposals(engagementId, proposals, {
    userId: session.user.id,
    userName: session.user.name || session.user.email || 'Unknown',
    source: 'prior_period_ai',
  });

  // Mark proposals as applied and persist the user's edits for audit trail.
  await prisma.importExtractionProposal.update({
    where: { id: extractionId },
    data: {
      proposals: proposals as unknown as object,
      status: 'applied',
      appliedAt: new Date(),
      appliedById: session.user.id,
    },
  });

  // Update engagement.importOptions history.
  const at = new Date().toISOString();
  const me = { userId: session.user.id, userName: session.user.name || session.user.email || null };
  const prev = (engagement.importOptions as ImportOptionsState | null) || null;
  const next: ImportOptionsState = {
    ...(prev || { prompted: true, selections: [], status: 'pending' }),
    status: 'applied',
    history: [
      ...(prev?.history || []),
      { event: 'applied', at, by: me, note: `applied=${result.applied}, skipped=${result.skipped}` },
    ],
  };
  await prisma.auditEngagement.update({
    where: { id: engagementId },
    data: { importOptions: next as unknown as object },
  });

  return NextResponse.json(result);
}
