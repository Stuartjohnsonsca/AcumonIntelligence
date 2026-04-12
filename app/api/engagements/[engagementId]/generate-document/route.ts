import { NextResponse } from 'next/server';
import { assertEngagementWriteAccess } from '@/lib/auth/engagement-auth';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { populateMergeFields } from '@/lib/template-merge';
import { generatePdfFromTemplate, type PdfOptions } from '@/lib/template-pdf';
import { AUDIT_TYPE_LABELS } from '@/types/methodology';
import { downloadBlob, CONTAINERS } from '@/lib/azure-blob';

async function verifyAccess(engagementId: string, firmId: string | undefined, isSuperAdmin: boolean) {
  const e = await prisma.auditEngagement.findUnique({ where: { id: engagementId }, select: { firmId: true, auditType: true } });
  if (!e || (e.firmId !== firmId && !isSuperAdmin)) return null;
  return e;
}

export async function GET(req: Request, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await params;
  const engagement = await verifyAccess(engagementId, session.user.firmId, session.user.isSuperAdmin);
  if (!engagement) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // List available templates for this engagement's audit type
  const templates = await prisma.documentTemplate.findMany({
    where: {
      firmId: session.user.firmId,
      isActive: true,
      auditType: { in: [engagement.auditType, 'ALL'] },
    },
    select: { id: true, name: true, category: true, subject: true, recipients: true },
    orderBy: [{ category: 'asc' }, { name: 'asc' }],
  });

  return NextResponse.json({ templates });
}

export async function POST(req: Request, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await params;
  const engagement = await verifyAccess(engagementId, session.user.firmId, session.user.isSuperAdmin);
  const __eqrGuard = await assertEngagementWriteAccess(engagementId, session);
  if (__eqrGuard instanceof NextResponse) return __eqrGuard;
  if (!engagement) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json();
  const { action, templateId } = body;
  const auditPlanDetail = body.auditPlanDetail === 'detailed' ? 'detailed' : 'high';

  if (!templateId) return NextResponse.json({ error: 'templateId required' }, { status: 400 });

  // Load template
  const template = await prisma.documentTemplate.findUnique({ where: { id: templateId } });
  if (!template) return NextResponse.json({ error: 'Template not found' }, { status: 404 });

  // Populate merge fields (scalar + block expansion + detail option)
  const recipient = body.recipientName ? { name: body.recipientName, email: body.recipientEmail } : undefined;
  const populatedHtml = await populateMergeFields(
    template.content,
    engagementId,
    session.user.name || session.user.email || '',
    recipient,
    { auditPlanDetail },
  );

  // Also populate the subject line
  const populatedSubject = template.subject
    ? await populateMergeFields(template.subject, engagementId, session.user.name || '', recipient)
    : template.name;

  // Load firm branding (all fields needed by the letterhead renderer)
  const firm = await prisma.firm.findUnique({
    where: { id: session.user.firmId! },
    select: {
      name: true,
      logoStoragePath: true,
      groupLogoStoragePath: true,
      letterheadHeaderText: true,
      letterheadFooterText: true,
    },
  });

  // Load client (for recipient block)
  const engagementWithClient = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    select: { client: { select: { clientName: true, address: true } } },
  });
  const client = engagementWithClient?.client;

  // Fetch logo blob bytes (best effort — don't block generation)
  let firmLogoBytes: Uint8Array | undefined;
  let firmLogoMime: string | undefined;
  let groupLogoBytes: Uint8Array | undefined;
  let groupLogoMime: string | undefined;
  if (firm?.logoStoragePath) {
    try {
      const buf = await downloadBlob(firm.logoStoragePath, CONTAINERS.INBOX);
      firmLogoBytes = new Uint8Array(buf);
      firmLogoMime = firm.logoStoragePath.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
    } catch (err) { console.error('[Generate Document] firm logo fetch failed:', err); }
  }
  if (firm?.groupLogoStoragePath) {
    try {
      const buf = await downloadBlob(firm.groupLogoStoragePath, CONTAINERS.INBOX);
      groupLogoBytes = new Uint8Array(buf);
      groupLogoMime = firm.groupLogoStoragePath.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
    } catch (err) { console.error('[Generate Document] group logo fetch failed:', err); }
  }

  const currentDate = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });

  const pdfOptions: PdfOptions = {
    documentTitle: template.name,
    firmName: firm?.name || '',
    firmLogoBytes,
    firmLogoMime,
    groupLogoBytes,
    groupLogoMime,
    letterheadHeaderText: firm?.letterheadHeaderText || undefined,
    letterheadFooterText: firm?.letterheadFooterText || undefined,
    recipientHeadline: 'For the attention of the members',
    clientNameUpper: (client?.clientName || '').toUpperCase(),
    clientAddress: client?.address || undefined,
    currentDate,
  };

  // ── Preview: return populated HTML for display ──
  if (action === 'preview_html') {
    return NextResponse.json({ html: populatedHtml, subject: populatedSubject });
  }

  // ── Generate PDF and return as download ──
  if (action === 'preview' || action === 'download') {
    const pdfBuffer = await generatePdfFromTemplate(populatedHtml, pdfOptions);

    // Save to document repository
    const doc = await prisma.auditDocument.create({
      data: {
        engagementId,
        documentName: `${template.name}.pdf`,
        requestedDate: new Date(),
        requestedById: session.user.id,
        uploadedDate: new Date(),
        uploadedById: session.user.id,
        mimeType: 'application/pdf',
        fileSize: pdfBuffer.length,
        source: 'System Generated',
        documentType: template.category,
        usageLocation: 'General',
        receivedByName: 'System',
        receivedAt: new Date(),
        verifiedOn: new Date(),
        verifiedByName: 'System',
      },
    });

    return new Response(new Uint8Array(pdfBuffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${template.name.replace(/[^a-zA-Z0-9 ]/g, '_')}.pdf"`,
        'X-Document-Id': doc.id,
      },
    });
  }

  // ── Send via email ──
  if (action === 'send_email') {
    const recipientEmail = body.recipientEmail;
    if (!recipientEmail) return NextResponse.json({ error: 'recipientEmail required' }, { status: 400 });

    const pdfBuffer = await generatePdfFromTemplate(populatedHtml, pdfOptions);

    // Send email with PDF attachment
    const connectionString = process.env.AZURE_COMMUNICATION_CONNECTION_STRING;
    if (!connectionString) return NextResponse.json({ error: 'Email service not configured' }, { status: 503 });

    try {
      const { EmailClient } = await import('@azure/communication-email');
      const client = new EmailClient(connectionString);
      const senderAddress = process.env.EMAIL_FROM || 'DoNotReply@acumonintelligence.com';

      const poller = await client.beginSend({
        senderAddress,
        content: {
          subject: populatedSubject,
          html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
            <p>Please find the attached document.</p>
            <p style="color:#64748b;font-size:12px;margin-top:20px">Sent from ${firm?.name || 'Acumon Intelligence'}</p>
          </div>`,
        },
        recipients: { to: [{ address: recipientEmail, displayName: body.recipientName || '' }] },
        attachments: [{
          name: `${template.name.replace(/[^a-zA-Z0-9 ]/g, '_')}.pdf`,
          contentType: 'application/pdf',
          contentInBase64: pdfBuffer.toString('base64'),
        }],
      });

      const result = await poller.pollUntilDone();

      // Save to document repository
      await prisma.auditDocument.create({
        data: {
          engagementId,
          documentName: `${template.name}.pdf (sent to ${recipientEmail})`,
          requestedDate: new Date(),
          requestedById: session.user.id,
          uploadedDate: new Date(),
          uploadedById: session.user.id,
          mimeType: 'application/pdf',
          fileSize: pdfBuffer.length,
          source: 'System Generated',
          documentType: template.category,
          usageLocation: 'General',
          receivedByName: 'System',
          receivedAt: new Date(),
          verifiedOn: new Date(),
          verifiedByName: 'System',
        },
      });

      return NextResponse.json({ success: true, emailStatus: result.status });
    } catch (err: any) {
      console.error('[Generate Document] Email failed:', err);
      return NextResponse.json({ error: err.message || 'Email failed' }, { status: 500 });
    }
  }

  // ── Send to portal ──
  if (action === 'send_portal') {
    const pdfBuffer = await generatePdfFromTemplate(populatedHtml, pdfOptions);

    // Upload to Azure Blob
    let storagePath: string | null = null;
    try {
      const { uploadToInbox } = await import('@/lib/azure-blob');
      const blobName = `documents/${engagementId}/${Date.now()}_${template.name.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
      await uploadToInbox(blobName, pdfBuffer, 'application/pdf');
      storagePath = blobName;
    } catch (err) {
      console.error('[Generate Document] Blob upload failed:', err);
    }

    // Create portal request with the document
    const portalRequest = await prisma.portalRequest.create({
      data: {
        engagementId,
        clientId: (await prisma.auditEngagement.findUnique({ where: { id: engagementId }, select: { clientId: true } }))!.clientId,
        section: 'documents',
        question: `Document: ${template.name}`,
        status: 'outstanding',
        requestedByName: session.user.name || session.user.email || 'System',
        requestedById: session.user.id,
        attachments: storagePath ? [{ name: `${template.name}.pdf`, path: storagePath }] : [],
      } as any,
    });

    // Also save to document repository
    await prisma.auditDocument.create({
      data: {
        engagementId,
        documentName: `${template.name}.pdf (portal)`,
        requestedDate: new Date(),
        requestedById: session.user.id,
        uploadedDate: new Date(),
        uploadedById: session.user.id,
        storagePath,
        mimeType: 'application/pdf',
        fileSize: pdfBuffer.length,
        source: 'System Generated',
        documentType: template.category,
        usageLocation: 'General',
        visibleToClient: true,
        receivedByName: 'System',
        receivedAt: new Date(),
        verifiedOn: new Date(),
        verifiedByName: 'System',
      },
    });

    return NextResponse.json({ success: true, portalRequestId: portalRequest.id });
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}
