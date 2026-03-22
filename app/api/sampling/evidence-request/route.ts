import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { verifyClientAccess } from '@/lib/client-access';
import { apiAction } from '@/lib/logger';

/**
 * POST /api/sampling/evidence-request
 * Create evidence requests for sampled items and optionally notify client team.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const action = apiAction(req, session.user as { id: string; firmId?: string }, '/api/sampling/evidence-request', 'sampling');

  try {
    const body = await req.json();
    const { runId, clientId, periodId, items, evidenceTypes, assignedTo } = body;

    if (!runId || !clientId || !periodId || !items?.length) {
      return NextResponse.json({ error: 'runId, clientId, periodId, and items are required' }, { status: 400 });
    }

    const access = await verifyClientAccess(
      session.user as { id: string; firmId: string; isSuperAdmin?: boolean },
      clientId,
    );
    if (!access.allowed) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Build evidence type flags
    const evidenceFlags: Record<string, boolean> = {};
    for (const type of (evidenceTypes || [])) {
      evidenceFlags[type] = true;
    }

    // Create evidence requests for each sampled item
    const requests = await prisma.$transaction(
      items.map((item: { transactionId: string; description: string; amount: number; date: string; reference: string; contact: string }) =>
        prisma.auditEvidenceRequest.create({
          data: {
            runId,
            clientId,
            periodId,
            createdBy: session.user!.id,
            transactionId: item.transactionId,
            description: item.description,
            amount: item.amount,
            date: item.date,
            reference: item.reference,
            contact: item.contact,
            invoiceRequired: !!evidenceFlags.invoiceRequired,
            paymentRequired: !!evidenceFlags.paymentRequired,
            supplierConfirmation: !!evidenceFlags.supplierConfirmation,
            debtorConfirmation: !!evidenceFlags.debtorConfirmation,
            contractRequired: !!evidenceFlags.contractRequired,
            intercompanyRequired: !!evidenceFlags.intercompanyRequired,
            directorMatters: !!evidenceFlags.directorMatters,
            assignedTo: assignedTo || [],
          },
        })
      ),
    );

    await action.success('Evidence requests created', { count: requests.length, runId });

    return NextResponse.json({
      created: requests.length,
      requestIds: requests.map((r: { id: string }) => r.id),
    });
  } catch (error) {
    await action.error(error, { stage: 'create_evidence_requests' });
    return action.errorResponse(error);
  }
}

/**
 * GET /api/sampling/evidence-request?runId=X
 * List evidence requests for a sampling run.
 */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const runId = searchParams.get('runId');

  if (!runId) {
    return NextResponse.json({ error: 'runId required' }, { status: 400 });
  }

  const requests = await prisma.auditEvidenceRequest.findMany({
    where: { runId },
    include: {
      uploads: {
        select: { id: true, evidenceType: true, aiVerified: true, firmAccepted: true, originalName: true, createdAt: true },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  return NextResponse.json(requests);
}
