import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { renderTemplateToDocx, renderEmailTemplate } from '@/lib/template-render';
import { sendEmail } from '@/lib/email';
import { uploadToContainer } from '@/lib/azure-blob';

/**
 * POST /api/engagements/:engagementId/send-planning-letter
 *
 * Three-step Planning Letter workflow:
 *   1. Render the Planning Letter document template into a .docx.
 *   2. Upload the .docx to the `portal-documents` blob container and
 *      create a PortalDocument row so clients can see it on their
 *      portal.
 *   3. Email the .docx as an attachment to every contact flagged as
 *      `isInformedManagement=true` who also has Client Portal access
 *      (matching email in ClientPortalUser). Subject + body come from
 *      a separately-chosen email template (kind='email').
 *
 * Aborts BEFORE any rendering if no Informed Management contact has
 * portal access — returns 422 with a clear message so the modal can
 * show it. This matches the rule the user asked for: Planning Letter
 * goes to Informed Management, and if none of them have portal
 * access we stop before doing any work.
 *
 * Body: { documentTemplateId: string; emailTemplateId: string }
 * Response: { ok: true, recipients: Array<{name,email,messageId?}>,
 *              portalDocumentId: string, fileName: string }
 */
type Ctx = { params: Promise<{ engagementId: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { engagementId } = await ctx.params;
  const body = await req.json().catch(() => null);
  const documentTemplateId = typeof body?.documentTemplateId === 'string' ? body.documentTemplateId : '';
  const emailTemplateId = typeof body?.emailTemplateId === 'string' ? body.emailTemplateId : '';
  if (!documentTemplateId || !emailTemplateId) {
    return NextResponse.json({ error: 'documentTemplateId and emailTemplateId are both required' }, { status: 400 });
  }

  // Tenant check + fetch client id for blob path + notifications.
  const engagement = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    select: { id: true, firmId: true, clientId: true },
  });
  if (!engagement) return NextResponse.json({ error: 'Engagement not found' }, { status: 404 });
  if (!session.user.isSuperAdmin && engagement.firmId !== session.user.firmId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // ── Step 0: recipient gate ──────────────────────────────────────────
  // Find every Informed Management contact with a matching active
  // ClientPortalUser on the same client. If the list is empty we stop
  // BEFORE rendering anything — the rule is that the Planning Letter
  // must reach Informed Management, and without portal access there's
  // no secure channel. The modal surfaces this error to the admin.
  const informedContacts = await prisma.auditClientContact.findMany({
    where: { engagementId, isInformedManagement: true },
  });
  const informedEmails = informedContacts
    .map(c => (c.email || '').trim().toLowerCase())
    .filter(e => e.length > 0);

  const portalUsers = informedEmails.length > 0
    ? await prisma.clientPortalUser.findMany({
        where: {
          clientId: engagement.clientId,
          isActive: true,
          email: { in: informedEmails, mode: 'insensitive' as const },
        },
      })
    : [];
  const portalEmailSet = new Set(portalUsers.map(u => u.email.toLowerCase()));

  // Intersect: contacts who are BOTH Informed Management AND have
  // portal access. If empty, stop.
  const eligible = informedContacts.filter(c => {
    const e = (c.email || '').trim().toLowerCase();
    return e && portalEmailSet.has(e);
  });

  if (eligible.length === 0) {
    return NextResponse.json({
      error: 'No recipient available',
      reason: 'no_informed_management_with_portal_access',
      detail: informedContacts.length === 0
        ? 'No contacts on this engagement are flagged as Informed Management. Tick at least one contact as Informed Management, make sure they have Portal Access, and try again.'
        : 'One or more contacts are flagged as Informed Management, but none of them have Client Portal access. Grant Portal Access to at least one Informed Management contact and try again.',
    }, { status: 422 });
  }

  // ── Step 1: render .docx ────────────────────────────────────────────
  let rendered: Awaited<ReturnType<typeof renderTemplateToDocx>>;
  try {
    rendered = await renderTemplateToDocx(documentTemplateId, engagementId);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Document render failed' }, { status: 422 });
  }
  const { buffer, fileName, templateName } = rendered;

  // ── Step 2: upload to portal-documents blob + persist ──────────────
  // Path `${clientId}/${id}_${fileName}` keeps blobs scoped by client
  // so tenant-wide listings never cross over. The ID is generated
  // ahead of time because we want the same value in the DB row and
  // the blob key for easy correlation.
  const documentId = crypto.randomUUID();
  const blobPath = `${engagement.clientId}/${documentId}_${fileName}`;
  const containerName = 'portal-documents';
  const contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  try {
    await uploadToContainer(containerName, blobPath, buffer, contentType);
  } catch (err: any) {
    return NextResponse.json({ error: `Portal upload failed: ${err?.message || 'unknown error'}` }, { status: 500 });
  }
  const portalDoc = await prisma.portalDocument.create({
    data: {
      id: documentId,
      firmId: engagement.firmId,
      clientId: engagement.clientId,
      engagementId,
      templateId: documentTemplateId,
      name: templateName,
      category: 'audit_planning_letter',
      fileName,
      contentType,
      fileSize: buffer.length,
      blobPath,
      containerName,
      uploadedById: session.user.id,
      uploadedByName: session.user.name || session.user.email || null,
    },
  });

  // ── Step 3: render covering email + send to each eligible recipient ─
  let email: Awaited<ReturnType<typeof renderEmailTemplate>>;
  try {
    email = await renderEmailTemplate(emailTemplateId, engagementId);
  } catch (err: any) {
    // The portal upload has already happened — the admin can still
    // see the letter on the portal. Surface the email error but
    // don't roll back the upload.
    return NextResponse.json({
      error: `Covering email render failed: ${err?.message || 'unknown error'}`,
      portalDocumentId: portalDoc.id,
    }, { status: 422 });
  }

  // Attach once, reuse across recipients.
  const attachment = {
    name: fileName,
    contentType,
    contentInBase64: buffer.toString('base64'),
  };

  const recipients: Array<{ id: string; name: string; email: string; status: 'sent' | 'failed'; messageId?: string; error?: string }> = [];
  for (const c of eligible) {
    const to = (c.email || '').trim();
    if (!to) continue;
    try {
      const { messageId } = await sendEmail(to, email.subject, email.html, {
        displayName: c.name,
        attachments: [attachment],
      });
      recipients.push({ id: c.id, name: c.name, email: to, status: 'sent', messageId });
    } catch (err: any) {
      recipients.push({ id: c.id, name: c.name, email: to, status: 'failed', error: err?.message || 'send failed' });
    }
  }

  // ── Audit log — Communication-tab-equivalent for now ───────────────
  // The Communication tab is a pending rebuild; until then we log a
  // structured ActivityLog entry the future Communication tab can
  // ingest without migration.
  try {
    await (prisma as any).activityLog?.create?.({
      data: {
        userId: session.user.id,
        firmId: engagement.firmId,
        clientId: engagement.clientId,
        action: 'send_planning_letter',
        tool: 'rmm',
        detail: {
          engagementId,
          documentTemplateId,
          emailTemplateId,
          portalDocumentId: portalDoc.id,
          fileName,
          recipients,
        },
      },
    });
  } catch { /* activity log table may be absent in some envs — tolerant */ }

  const anyFailed = recipients.some(r => r.status === 'failed');
  return NextResponse.json({
    ok: !anyFailed,
    portalDocumentId: portalDoc.id,
    fileName,
    recipients,
    subject: email.subject,
    sentCount: recipients.filter(r => r.status === 'sent').length,
    failedCount: recipients.filter(r => r.status === 'failed').length,
  }, { status: 200 });
}
