import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import type { ProposalRow } from '@/lib/import-options/types';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ engagementId: string; proposalId: string }> },
) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { engagementId, proposalId } = await params;
  const proposal = await prisma.importExtractionProposal.findUnique({
    where: { id: proposalId },
    include: { engagement: { select: { firmId: true, id: true } } },
  });
  if (!proposal || proposal.engagementId !== engagementId
      || proposal.engagement.firmId !== session.user.firmId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json({
    proposal: {
      id: proposal.id,
      status: proposal.status,
      sourceLabel: proposal.sourceLabel,
      sourceArchiveDocumentId: proposal.sourceArchiveDocumentId,
      proposals: proposal.proposals as unknown as ProposalRow[],
      aiModel: proposal.aiModel,
      createdAt: proposal.createdAt,
    },
  });
}

// DELETE — mark cancelled. Does not delete (audit trail).
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ engagementId: string; proposalId: string }> },
) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { engagementId, proposalId } = await params;
  const proposal = await prisma.importExtractionProposal.findUnique({
    where: { id: proposalId },
    include: { engagement: { select: { firmId: true } } },
  });
  if (!proposal || proposal.engagementId !== engagementId
      || proposal.engagement.firmId !== session.user.firmId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (proposal.status !== 'pending') {
    return NextResponse.json({ ok: true, status: proposal.status });
  }
  await prisma.importExtractionProposal.update({
    where: { id: proposalId },
    data: { status: 'cancelled' },
  });
  return NextResponse.json({ ok: true, status: 'cancelled' });
}
