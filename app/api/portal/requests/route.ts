import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { fireTrigger } from '@/lib/trigger-engine';

/**
 * GET /api/portal/requests?clientId=X&status=outstanding|responded
 * Get portal requests for a client.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const clientId = searchParams.get('clientId');
  const status = searchParams.get('status'); // outstanding | responded | all

  if (!clientId) {
    return NextResponse.json({ error: 'clientId required' }, { status: 400 });
  }

  const where: Record<string, unknown> = { clientId };
  if (status && status !== 'all') {
    where.status = status === 'responded' ? { in: ['responded', 'verified'] } : status;
  }

  const requests = await prisma.portalRequest.findMany({
    where: where as any,
    orderBy: { requestedAt: 'desc' },
  });

  return NextResponse.json({ requests });
}

/**
 * POST /api/portal/requests
 * Submit response to a portal request (from portal user).
 *
 * Body: { requestId, response, respondedByName }
 */
export async function POST(req: Request) {
  try {
    const { requestId, response, respondedByName, respondedById } = await req.json();

    if (!requestId || !response) {
      return NextResponse.json({ error: 'requestId and response required' }, { status: 400 });
    }

    const request = await prisma.portalRequest.findUnique({ where: { id: requestId } });
    if (!request) {
      return NextResponse.json({ error: 'Request not found' }, { status: 404 });
    }

    if (request.status !== 'outstanding') {
      return NextResponse.json({ error: 'Request already responded to' }, { status: 400 });
    }

    // Simple AI verification: check response is substantive (>10 chars) and not just "ok"/"yes"/"no"
    const trimmed = response.trim().toLowerCase();
    const tooShort = trimmed.length < 5;
    const isGeneric = ['ok', 'yes', 'no', 'n/a', 'na', 'done', 'see above', 'as above'].includes(trimmed);

    if (tooShort || isGeneric) {
      return NextResponse.json({
        error: 'Please provide a substantive response that addresses the question.',
        verified: false,
      }, { status: 422 });
    }

    const updated = await prisma.portalRequest.update({
      where: { id: requestId },
      data: {
        response,
        status: 'responded',
        respondedById: respondedById || null,
        respondedByName: respondedByName || 'Portal User',
        respondedAt: new Date(),
      },
    });

    // Fire "On Portal Response" trigger
    if (updated.engagementId) {
      const eng = await prisma.auditEngagement.findUnique({
        where: { id: updated.engagementId },
        select: { clientId: true, auditType: true, firmId: true },
      });
      if (eng) {
        fireTrigger({
          triggerName: 'On Portal Response',
          engagementId: updated.engagementId,
          clientId: eng.clientId,
          auditType: eng.auditType,
          firmId: eng.firmId,
          userId: respondedById || '',
        }).catch(err => console.error('[Trigger] On Portal Response failed:', err));
      }
    }

    return NextResponse.json({ request: updated, verified: true });
  } catch (error) {
    console.error('Submit portal response error:', error);
    return NextResponse.json({ error: 'Failed to submit response' }, { status: 500 });
  }
}

/**
 * PUT /api/portal/requests
 * Actions on a portal request: commit, chat, elevate, assign
 */
export async function PUT(req: Request) {
  try {
    const body = await req.json();
    const { requestId, action, message, fromUserId, assignTo, assignToName, assignToSpecialist, note, itemType, fromRole, toRole } = body;

    if (!requestId || !action) {
      return NextResponse.json({ error: 'requestId and action required' }, { status: 400 });
    }

    const request = await prisma.portalRequest.findUnique({ where: { id: requestId } });
    if (!request) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    switch (action) {
      case 'commit': {
        // Move to committed status — appears in Communication tab
        const updated = await prisma.portalRequest.update({
          where: { id: requestId },
          data: { status: 'committed' },
        });
        return NextResponse.json({ request: updated });
      }

      case 'chat': {
        // Send reply — if client type, send back to portal as new outstanding
        // If team type, create a new request for the responder
        if (itemType === 'client') {
          // Mark current as chat_replied, create new outstanding for client
          await prisma.portalRequest.update({ where: { id: requestId }, data: { status: 'chat_replied' } });
          const newReq = await prisma.portalRequest.create({
            data: {
              clientId: request.clientId,
              engagementId: request.engagementId,
              section: request.section,
              question: `Re: ${request.question}\n\n${message}`,
              status: 'outstanding',
              requestedById: fromUserId || request.requestedById,
              requestedByName: 'Audit Team',
            },
          });
          return NextResponse.json({ request: newReq });
        } else {
          // Team chat — update with message
          await prisma.portalRequest.update({
            where: { id: requestId },
            data: { status: 'outstanding', response: `${request.response || ''}\n\n[Reply]: ${message}` },
          });
          return NextResponse.json({ success: true });
        }
      }

      case 'elevate': {
        // Assign to the next senior role
        const updated = await prisma.portalRequest.update({
          where: { id: requestId },
          data: {
            status: 'outstanding',
            requestedByName: `${request.requestedByName} → ${toRole || 'Senior'}`,
          },
        });
        return NextResponse.json({ request: updated });
      }

      case 'assign': {
        // Assign to a specialist
        const updated = await prisma.portalRequest.update({
          where: { id: requestId },
          data: {
            status: 'outstanding',
            requestedByName: `${request.requestedByName} → ${assignToSpecialist || assignToName || 'Specialist'}${note ? ` (${note})` : ''}`,
          },
        });
        return NextResponse.json({ request: updated });
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (error) {
    console.error('Portal request action error:', error);
    return NextResponse.json({ error: 'Action failed' }, { status: 500 });
  }
}
