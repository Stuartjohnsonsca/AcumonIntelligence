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
  const status = searchParams.get('status'); // outstanding | responded | committed | all
  const engagementId = searchParams.get('engagementId');

  if (!clientId) {
    return NextResponse.json({ error: 'clientId required' }, { status: 400 });
  }

  const section = searchParams.get('section');

  const where: Record<string, unknown> = { clientId };
  if (engagementId) where.engagementId = engagementId;
  if (section) where.section = section;
  if (status && status !== 'all') {
    where.status = status === 'responded' ? { in: ['responded', 'verified', 'committed'] } : status;
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
        // Move to committed status — appears in Communication tab, removed from Outstanding
        // Append a closing message to chat history
        const commitHistory = (request.chatHistory as any[] || []);
        commitHistory.push({
          from: 'firm',
          name: 'System',
          message: 'Chat closed and committed to Communication.',
          timestamp: new Date().toISOString(),
        });
        const updated = await prisma.portalRequest.update({
          where: { id: requestId },
          data: {
            status: 'committed',
            chatHistory: commitHistory as any,
            verifiedAt: new Date(),
          },
        });
        return NextResponse.json({ request: updated });
      }

      case 'chat': {
        // Append message to chat history thread on the same request
        const history = (request.chatHistory as any[] || []);
        const newMessage = {
          from: itemType === 'client' ? 'firm' : 'firm',
          name: body.fromUserName || 'Audit Team',
          message,
          timestamp: new Date().toISOString(),
          attachments: body.attachments || [], // [{name, url, size}]
        };
        history.push(newMessage);

        if (itemType === 'client') {
          // Keep on the same request — set status back to outstanding for client to see the reply
          await prisma.portalRequest.update({
            where: { id: requestId },
            data: { chatHistory: history as any, status: 'outstanding' },
          });
        } else {
          // Team chat — keep as responded, append to history
          await prisma.portalRequest.update({
            where: { id: requestId },
            data: { chatHistory: history as any },
          });
        }
        return NextResponse.json({ success: true, chatHistory: history });
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
        // Assign to a specialist (firm-side)
        const updated = await prisma.portalRequest.update({
          where: { id: requestId },
          data: {
            status: 'outstanding',
            requestedByName: `${request.requestedByName} → ${assignToSpecialist || assignToName || 'Specialist'}${note ? ` (${note})` : ''}`,
          },
        });
        return NextResponse.json({ request: updated });
      }

      case 'assign_portal': {
        // Assign to a client team member — stays outstanding in the portal
        const assigneeName = body.assignTo || '';
        // Store assignee in chatHistory as a system message
        const assignHistory = (request.chatHistory as any[] || []);
        assignHistory.push({
          from: 'client',
          name: 'System',
          message: `Assigned to ${assigneeName}`,
          timestamp: new Date().toISOString(),
        });
        await prisma.portalRequest.update({
          where: { id: requestId },
          data: {
            chatHistory: assignHistory as any,
            respondedByName: assigneeName || request.respondedByName,
            // Status stays 'outstanding' — not sent to audit team
          },
        });
        return NextResponse.json({ success: true, assignedTo: assigneeName });
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (error) {
    console.error('Portal request action error:', error);
    return NextResponse.json({ error: 'Action failed' }, { status: 500 });
  }
}
