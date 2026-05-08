import { NextResponse } from 'next/server';
import { assertEngagementWriteAccess } from '@/lib/auth/engagement-auth';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { sendDocumentRequestEmail } from '@/lib/audit-email';

async function verifyAccess(engagementId: string, firmId: string | undefined, isSuperAdmin: boolean) {
  const e = await prisma.auditEngagement.findUnique({ where: { id: engagementId }, select: { firmId: true, clientId: true } });
  if (!e || (e.firmId !== firmId && !isSuperAdmin)) return null;
  return e;
}

export async function GET(req: Request, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await params;
  if (!await verifyAccess(engagementId, session.user.firmId, session.user.isSuperAdmin)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const documents = await prisma.auditDocument.findMany({
    where: { engagementId },
    include: {
      requestedBy: { select: { id: true, name: true } },
      uploadedBy: { select: { id: true, name: true } },
      tabAllocations: { select: { tab: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  // Surface multi-tab allocations as a flat string[] so the UI
  // doesn't have to know about the join table. Union with the
  // legacy single-tab field so older docs still have at least one
  // entry; deduplicate so multi-write paths don't double-count.
  const enriched = documents.map(d => {
    const fromAllocations = d.tabAllocations.map(a => a.tab);
    const utilisedTabs = Array.from(
      new Set(d.utilisedTab ? [...fromAllocations, d.utilisedTab] : fromAllocations),
    );
    const { tabAllocations: _strip, ...rest } = d;
    return { ...rest, utilisedTabs };
  });

  return NextResponse.json({ documents: enriched });
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
  const { action } = body;

  // Create document request. New `deliveryMethod` (portal | email |
  // download) extends the old behaviour:
  //   - download: just creates the request row (legacy default).
  //   - email:    creates the row AND emails the 'Requested To'
  //     address via sendDocumentRequestEmail.
  //   - portal:   verifies the email maps to a ClientPortalUser of
  //     this engagement's client; if it does, opens a portalRequest
  //     row so the document shows up on the client portal. If it
  //     doesn't, returns 400 with a portalUserMissing flag so the UI
  //     can render the "cannot action — recipient is not a portal
  //     user" warning.
  if (action === 'request') {
    const { documentName, requestedFrom, mappedItems, source, usageLocation, documentType, deliveryMethod } = body;
    if (!documentName) return NextResponse.json({ error: 'documentName required' }, { status: 400 });
    const method: 'portal' | 'email' | 'download' =
      deliveryMethod === 'portal' || deliveryMethod === 'email' ? deliveryMethod : 'download';

    // Portal-mode pre-check: must be a real portal user. Bail BEFORE
    // creating any rows so the user gets a clean error and can switch
    // the recipient or the delivery method.
    let portalUser: { id: string; name: string } | null = null;
    if (method === 'portal') {
      const recipientEmail = typeof requestedFrom === 'string' ? requestedFrom.trim().toLowerCase() : '';
      if (!recipientEmail) {
        return NextResponse.json({ error: 'Portal delivery requires a recipient email' }, { status: 400 });
      }
      const found = await prisma.clientPortalUser.findFirst({
        where: { clientId: engagement.clientId, email: { equals: recipientEmail, mode: 'insensitive' }, isActive: true },
        select: { id: true, name: true },
      });
      if (!found) {
        return NextResponse.json({
          error: `Cannot send via portal — ${recipientEmail} is not registered as a Client Portal user for this engagement's client. Invite them via the Portal tab → Manage Staff or pick Email / Download instead.`,
          portalUserMissing: true,
        }, { status: 400 });
      }
      portalUser = found;
    }

    if (method === 'email' && (!requestedFrom || typeof requestedFrom !== 'string' || !requestedFrom.trim())) {
      return NextResponse.json({ error: 'Email delivery requires a recipient email' }, { status: 400 });
    }

    const doc = await prisma.auditDocument.create({
      data: {
        engagementId, documentName, requestedFrom: requestedFrom || null,
        requestedDate: new Date(), requestedById: session.user.id,
        mappedItems: mappedItems || null,
        source: source || null,
        usageLocation: usageLocation || null,
        documentType: documentType || null,
      },
      include: { requestedBy: { select: { id: true, name: true } }, uploadedBy: { select: { id: true, name: true } } },
    });

    if (method === 'portal' && portalUser) {
      // Open a portalRequest so the document shows up under the client's
      // portal "documents" inbox. We use the same shape as
      // generate-document/send_portal: clientId, section='documents',
      // question = the requested document name.
      await prisma.portalRequest.create({
        data: {
          engagementId,
          clientId: engagement.clientId,
          section: 'documents',
          question: `Document request: ${documentName}`,
          status: 'outstanding',
          requestedByName: session.user.name || session.user.email || 'System',
          requestedById: session.user.id,
          attachments: [],
        } as any,
      });
    } else if (method === 'email') {
      try {
        const clientName = (await prisma.client.findUnique({
          where: { id: engagement.clientId },
          select: { clientName: true },
        }))?.clientName || 'the client';
        await sendDocumentRequestEmail(
          requestedFrom,
          requestedFrom,
          clientName,
          documentName,
          session.user.name || session.user.email || 'the audit team',
        );
      } catch (err: any) {
        console.error('[documents/request] email failed:', err);
        // Don't roll back the doc row — the auditor will see the
        // request in the UI and can re-trigger the email later via a
        // resend action if we add one.
        return NextResponse.json({
          document: doc,
          warning: `Request created, but the email could not be sent (${err?.message || 'unknown error'}). Resend manually if needed.`,
        }, { status: 201 });
      }
    }

    return NextResponse.json({ document: doc, deliveryMethod: method }, { status: 201 });
  }

  // Upload metadata (file upload handled via blob storage separately)
  if (action === 'upload') {
    const { documentId, storagePath, fileSize, mimeType } = body;
    if (!documentId) return NextResponse.json({ error: 'documentId required' }, { status: 400 });
    const doc = await prisma.auditDocument.update({
      where: { id: documentId },
      data: {
        uploadedDate: new Date(), uploadedById: session.user.id,
        storagePath: storagePath || null, fileSize: fileSize || null, mimeType: mimeType || null,
        // Auto-set received
        receivedByName: session.user.name || session.user.email, receivedAt: new Date(),
      },
      include: { requestedBy: { select: { id: true, name: true } }, uploadedBy: { select: { id: true, name: true } } },
    });

    // Auto-verify with AI (mark as AI verified)
    await prisma.auditDocument.update({
      where: { id: documentId },
      data: { verifiedOn: new Date(), verifiedByName: 'AI' },
    });

    return NextResponse.json({ document: doc });
  }

  // Mark received (dot 1)
  if (action === 'receive') {
    const { documentId } = body;
    if (!documentId) return NextResponse.json({ error: 'documentId required' }, { status: 400 });
    const doc = await prisma.auditDocument.update({
      where: { id: documentId },
      data: { receivedByName: session.user.name || session.user.email, receivedAt: new Date() },
    });
    return NextResponse.json({ document: doc });
  }

  // Mark verified (dot 2) — typically "AI" but can be manual
  if (action === 'verify') {
    const { documentId } = body;
    if (!documentId) return NextResponse.json({ error: 'documentId required' }, { status: 400 });
    const doc = await prisma.auditDocument.update({
      where: { id: documentId },
      data: { verifiedOn: new Date(), verifiedByName: body.verifiedBy || 'AI' },
    });
    return NextResponse.json({ document: doc });
  }

  // Mark utilised (dot 3)
  if (action === 'utilise') {
    const { documentId, tabName } = body;
    if (!documentId) return NextResponse.json({ error: 'documentId required' }, { status: 400 });
    const doc = await prisma.auditDocument.update({
      where: { id: documentId },
      data: { utilisedOn: new Date(), utilisedByName: session.user.name || session.user.email, utilisedTab: tabName || null },
    });
    return NextResponse.json({ document: doc });
  }

  // Toggle visibility to client
  if (action === 'toggle_visibility') {
    const { documentId } = body;
    if (!documentId) return NextResponse.json({ error: 'documentId required' }, { status: 400 });
    const existing = await prisma.auditDocument.findUnique({ where: { id: documentId } });
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const doc = await prisma.auditDocument.update({
      where: { id: documentId },
      data: { visibleToClient: !existing.visibleToClient },
    });
    return NextResponse.json({ document: doc });
  }

  // Update categorisation fields
  if (action === 'update_categories') {
    const { documentId, source, usageLocation, documentType } = body;
    if (!documentId) return NextResponse.json({ error: 'documentId required' }, { status: 400 });
    const doc = await prisma.auditDocument.update({
      where: { id: documentId },
      data: {
        ...(source !== undefined && { source: source || null }),
        ...(usageLocation !== undefined && { usageLocation: usageLocation || null }),
        // When the user explicitly sets documentType (whether to a new
        // value or to none), clear the AI-suggested flag — the human
        // has now confirmed/edited the value, so the yellow dashed
        // outline should drop.
        ...(documentType !== undefined && { documentType: documentType || null, documentTypeAiSuggested: false }),
      },
    });
    return NextResponse.json({ document: doc });
  }

  // Update mapped items
  if (action === 'update_mapping') {
    const { documentId, mappedItems } = body;
    if (!documentId) return NextResponse.json({ error: 'documentId required' }, { status: 400 });
    const doc = await prisma.auditDocument.update({
      where: { id: documentId },
      data: { mappedItems: mappedItems || null },
    });
    return NextResponse.json({ document: doc });
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { engagementId } = await params;
  if (!await verifyAccess(engagementId, session.user.firmId, session.user.isSuperAdmin)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const __eqrGuard = await assertEngagementWriteAccess(engagementId, session);
  if (__eqrGuard instanceof NextResponse) return __eqrGuard;
  const body = await req.json();
  if (!body.documentId) return NextResponse.json({ error: 'documentId required' }, { status: 400 });
  await prisma.auditDocument.delete({ where: { id: body.documentId } });
  return NextResponse.json({ success: true });
}
