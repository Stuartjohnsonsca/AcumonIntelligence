import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { fireTrigger } from '@/lib/trigger-engine';
import { resumeExecution, resumePipelineExecution } from '@/lib/flow-engine';

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
    include: { uploads: { select: { id: true, originalName: true, storagePath: true, containerName: true, mimeType: true, fileSize: true } } },
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
    const { requestId, response, respondedByName, respondedById, attachments } = await req.json();

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

    // Append to chat history (include attachments if present)
    const existingHistory = (request.chatHistory as any[] || []);
    const chatEntry: Record<string, any> = {
      from: 'client',
      name: respondedByName || 'Portal User',
      message: response,
      timestamp: new Date().toISOString(),
    };
    if (attachments && Array.isArray(attachments) && attachments.length > 0) {
      chatEntry.attachments = attachments.map((a: any) => ({
        name: a.name || a.fileName,
        url: a.url || '',
        uploadId: a.uploadId || '',
        storagePath: a.storagePath || '',
      }));
    }
    existingHistory.push(chatEntry);

    const updated = await prisma.portalRequest.update({
      where: { id: requestId },
      data: {
        response,
        status: 'responded',
        respondedById: respondedById || null,
        respondedByName: respondedByName || 'Portal User',
        respondedAt: new Date(),
        chatHistory: existingHistory as any,
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

      // Update any linked OutstandingItem to show client has responded
      try {
        await prisma.outstandingItem.updateMany({
          where: { portalRequestId: requestId, status: { in: ['pending', 'awaiting_client'] } },
          data: { status: 'awaiting_team', responseData: { response: updated.response, respondedByName: updated.respondedByName, respondedAt: updated.respondedAt?.toISOString() } as any },
        });
      } catch {}

      // Auto-resume any action-pipeline execution paused on this portal
      // request. Specific to the verify_property_assets action (section =
      // 'property_verification'), but the mechanism is generic — any action
      // whose pause refs the portal request id picks up automatically.
      try {
        const pausedExecutions = await prisma.testExecution.findMany({
          where: {
            executionMode: 'action_pipeline',
            status: 'paused',
            pauseReason: 'portal_response',
            pauseRefId: requestId,
          },
          select: { id: true },
        });
        for (const exec of pausedExecutions) {
          // For property verification, advance to the `addresses_received`
          // phase so the handler knows to parse the portal response. Other
          // action types can add their own phase markers here as needed.
          const externalData = request.section === 'property_verification'
            ? { phase: 'addresses_received' }
            : undefined;
          resumePipelineExecution(exec.id, externalData).catch(err =>
            console.error('[Portal Response] Failed to resume pipeline execution', exec.id, err),
          );
        }
      } catch (err) {
        console.error('[Portal Response] Failed to lookup paused executions:', err);
      }

      // Auto-advance walkthrough stage: if this portal request originated from a walkthrough,
      // update the permanent file stage to 'received' and import the client response as narrative
      const isWalkthrough = request.section === 'walkthroughs' || request.question?.includes('[Walkthrough:') || request.question?.includes('[Walkthrough Verification:');
      console.log('[Portal Response] isWalkthrough:', isWalkthrough, 'section:', request.section, 'engagementId:', updated.engagementId, 'requestId:', requestId);
      if (isWalkthrough && updated.engagementId) {
        try {
          // Find which walkthrough process this request belongs to by checking all process statuses
          const allPf = await prisma.auditPermanentFile.findMany({
            where: { engagementId: updated.engagementId, sectionKey: { startsWith: 'walkthrough_' } },
          });
          for (const pf of allPf) {
            if (!pf.sectionKey.endsWith('_status')) continue;
            const statusData = pf.data as any;
            // Match by portalRequestId or verificationRequestId, and stage must be awaiting a response
            const isMatch = (statusData?.portalRequestId === requestId || statusData?.verificationRequestId === requestId)
              && ['requested', 'sent_for_verification'].includes(statusData?.stage);
            console.log('[Portal Response] Checking PF:', pf.sectionKey, 'portalRequestId:', statusData?.portalRequestId, 'stage:', statusData?.stage, 'match:', isMatch);
            if (isMatch) {
              // Fetch portal uploads linked to this request
              const portalUploads = await prisma.portalUpload.findMany({ where: { portalRequestId: requestId } });

              // Determine next stage based on current stage
              const nextStage = statusData.stage === 'sent_for_verification' ? 'verified' : 'received';

              // Add uploads to evidence and advance stage
              const existingEvidence = statusData.evidence || [];
              const newEvidence = portalUploads.map(u => ({
                id: u.id,
                name: u.originalName,
                type: u.mimeType || 'application/octet-stream',
                storagePath: u.storagePath,
              }));
              const updatedStatus: any = {
                ...statusData,
                stage: nextStage,
                evidence: [...existingEvidence, ...newEvidence],
              };
              // Set confirmation timestamp when client verifies
              if (nextStage === 'verified') {
                updatedStatus.flowchartConfirmedAt = new Date().toISOString();
                updatedStatus.flowchartEditedAfterConfirm = false;
              }
              await prisma.auditPermanentFile.update({
                where: { id: pf.id },
                data: { data: updatedStatus },
              });
              console.log('[Portal Response] Walkthrough auto-advanced:', pf.sectionKey, '→', nextStage, 'evidence:', newEvidence.length, 'files');

              // Import the client response text into the walkthrough narrative
              const processKey = pf.sectionKey.replace('_status', '');
              const narrativePf = await prisma.auditPermanentFile.findFirst({
                where: { engagementId: updated.engagementId, sectionKey: processKey },
              });
              if (narrativePf) {
                const narrativeData = narrativePf.data as any;
                await prisma.auditPermanentFile.update({
                  where: { id: narrativePf.id },
                  data: { data: { ...narrativeData, narrative: updated.response || narrativeData.narrative } },
                });
              }

              // Register files in the Document Repository for the engagement
              if (portalUploads.length > 0 && updated.engagementId) {
                for (const u of portalUploads) {
                  await prisma.auditDocument.create({
                    data: {
                      engagementId: updated.engagementId,
                      documentName: u.originalName,
                      storagePath: u.storagePath,
                      containerName: u.containerName || 'upload-inbox',
                      fileSize: u.fileSize,
                      mimeType: u.mimeType,
                      source: 'Client Portal',
                      documentType: 'Walkthrough Documentation',
                      receivedAt: new Date(),
                      receivedByName: updated.respondedByName || 'Portal Client',
                    },
                  });
                }
              }
              break;
            }
          }
        } catch (err) {
          console.error('[Walkthrough] Failed to auto-advance stage:', err);
        }
      }

      // Resume any paused test execution waiting on this portal request
      try {
        const pausedExecution = await prisma.testExecution.findFirst({
          where: { pauseRefId: requestId, status: 'paused', pauseReason: 'portal_response' },
        });
        if (pausedExecution) {
          console.log(`[FlowEngine] Resuming execution ${pausedExecution.id} — portal response received for request ${requestId}`);
          await resumeExecution(pausedExecution.id, {
            response: updated.response,
            respondedByName: updated.respondedByName,
            respondedAt: updated.respondedAt?.toISOString(),
            chatHistory: updated.chatHistory,
            portalRequestId: requestId,
          });
        }
      } catch (err) {
        console.error('[FlowEngine] Failed to resume paused execution:', err);
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

        // If this came from PAR (section=explanations), paste back to the PAR row
        if (request.section === 'explanations' && request.engagementId) {
          try {
            // Extract the particulars (first line of question)
            const particulars = request.question.split('\n')[0];

            // Build the full response text with chat history
            const chatMsgs = commitHistory
              .filter((m: any) => m.name !== 'System')
              .map((m: any) => `[${m.name}, ${new Date(m.timestamp).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}]: ${m.message}`)
              .join('\n');
            const responseText = [request.response, chatMsgs].filter(Boolean).join('\n\n');

            // Find the matching PAR row
            const parRow = await prisma.auditPARRow.findFirst({
              where: { engagementId: request.engagementId, particulars },
            });

            if (parRow) {
              // Extract attachment references from chat history
              const attachments = commitHistory
                .flatMap((m: any) => (m.attachments || []).map((a: any) => a.name))
                .filter(Boolean);
              const attachmentNote = attachments.length > 0 ? `\n[Attachments: ${attachments.join(', ')}]` : '';

              await prisma.auditPARRow.update({
                where: { id: parRow.id },
                data: {
                  reasons: responseText + attachmentNote,
                  managementResponseStatus: 'responded',
                  sentToManagement: true,
                  sendMgtData: {
                    ...(parRow.sendMgtData as any || {}),
                    respondedAt: new Date().toISOString(),
                    clientExplanation: responseText,
                  },
                },
              });
            }
          } catch (err) {
            console.error('[Commit] Failed to paste back to PAR:', err);
          }
        }

        // Resume any paused test execution waiting on this portal request
        try {
          const pausedExecution = await prisma.testExecution.findFirst({
            where: { pauseRefId: requestId, status: 'paused' },
          });
          if (pausedExecution) {
            console.log(`[FlowEngine] Resuming execution ${pausedExecution.id} — commit action on request ${requestId}`);
            resumeExecution(pausedExecution.id, {
              response: request.response,
              chatHistory: commitHistory,
              committed: true,
              portalRequestId: requestId,
            }).catch(err => console.error('[FlowEngine] Resume on commit failed:', err));
          }

          // Also mark any linked OutstandingItem as complete
          await prisma.outstandingItem.updateMany({
            where: { portalRequestId: requestId, status: { not: 'complete' } },
            data: { status: 'complete', completedAt: new Date() },
          });
        } catch (err) {
          console.error('[FlowEngine] Failed to resume on commit:', err);
        }

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
