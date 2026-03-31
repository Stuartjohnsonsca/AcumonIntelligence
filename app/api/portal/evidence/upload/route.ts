import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { uploadToInbox } from '@/lib/azure-blob';
import { sendEvidenceUploadNotification } from '@/lib/email-portal';
import { fireTrigger } from '@/lib/trigger-engine';

/**
 * POST /api/portal/evidence/upload
 * Upload evidence file from client portal.
 */
export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const requestId = formData.get('requestId') as string;
    const evidenceType = formData.get('evidenceType') as string;
    const token = formData.get('token') as string;

    if (!file || !requestId || !evidenceType || !token) {
      return NextResponse.json({ error: 'file, requestId, evidenceType, and token are required' }, { status: 400 });
    }

    // Find all portal users to get accessible client IDs
    const portalUsers = await prisma.clientPortalUser.findMany({
      where: { isActive: true },
      select: { id: true, clientId: true },
    });

    if (portalUsers.length === 0) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const accessibleClientIds = new Set(portalUsers.map(u => u.clientId));
    const uploaderId = portalUsers[0].id;

    // Verify the request belongs to an accessible client
    const request = await prisma.auditEvidenceRequest.findUnique({
      where: { id: requestId },
      include: {
        run: {
          include: {
            engagement: {
              include: {
                user: { select: { email: true, name: true } },
              },
            },
          },
        },
      },
    });

    if (!request || !accessibleClientIds.has(request.clientId)) {
      return NextResponse.json({ error: 'Request not found' }, { status: 404 });
    }

    // Upload to Azure Blob Storage
    const buffer = Buffer.from(await file.arrayBuffer());
    const blobName = `audit-evidence/${requestId}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

    await uploadToInbox(blobName, buffer, file.type || 'application/octet-stream');

    // Create upload record
    const upload = await prisma.evidenceUpload.create({
      data: {
        requestId,
        uploadedBy: uploaderId,
        originalName: file.name,
        storagePath: blobName,
        containerName: 'upload-inbox',
        fileSize: buffer.length,
        mimeType: file.type || null,
        evidenceType,
        // AI verification would happen here asynchronously
        // For now, mark as uploaded (orange dot)
        aiVerified: null,
      },
    });

    // Update request status
    await prisma.auditEvidenceRequest.update({
      where: { id: requestId },
      data: { status: 'partial' },
    });

    // Notify firm team
    try {
      const firmUserEmail = request.run.engagement.user.email;
      if (firmUserEmail) {
        const client = await prisma.client.findUnique({
          where: { id: request.clientId },
          select: { clientName: true },
        });
        await sendEvidenceUploadNotification(
          firmUserEmail,
          client?.clientName || 'Client',
          1,
          false,
        );
      }
    } catch (notifyErr) {
      console.warn('Failed to send upload notification (non-fatal):', notifyErr);
    }

    // Fire "On Upload" trigger
    if (request.run?.engagement) {
      const eng = request.run.engagement as any;
      fireTrigger({
        triggerName: 'On Upload',
        engagementId: eng.id || '',
        clientId: request.clientId,
        auditType: eng.auditType || '',
        firmId: eng.firmId || '',
        userId: uploaderId,
      }).catch(err => console.error('[Trigger] On Upload failed:', err));
    }

    return NextResponse.json({
      uploadId: upload.id,
      fileName: file.name,
      status: 'uploaded',
    });
  } catch (error) {
    console.error('Portal evidence upload error:', error);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}
