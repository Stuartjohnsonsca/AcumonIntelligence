/**
 * Planning Letter background processor.
 *
 * Called as fire-and-forget from the Planning Letter send endpoint. The
 * job row is the source of truth for status / error / completion — the
 * client polls a thin listing endpoint and surfaces an orange badge on
 * the originating tab when something failed. Every code path that can
 * throw is wrapped so an unhandled rejection can never leave a job
 * stuck in `processing` forever.
 */

import { prisma } from '@/lib/db';
import { renderTemplateToDocx, renderEmailTemplate } from '@/lib/template-render';
import { sendEmail } from '@/lib/email';
import { uploadToContainer } from '@/lib/azure-blob';

export interface PlanningLetterJobInput {
  engagementId: string;
  clientId: string;
  firmId: string;
  documentTemplateId: string;
  emailTemplateId: string;
  actorUserId: string;
  actorUserName: string | null;
}

interface RecipientResult {
  id: string;
  name: string;
  email: string;
  status: 'sent' | 'failed';
  messageId?: string;
  error?: string;
}

async function setStatus(jobId: string, patch: Record<string, unknown>) {
  try {
    await (prisma as any).planningLetterJob.update({
      where: { id: jobId },
      data: patch,
    });
  } catch (e) {
    // If the update itself fails we have nowhere left to record the
    // failure — log it loudly so it surfaces in server logs even
    // though the user-facing job row will look stuck.
    console.error('[planning-letter-job] failed to persist status update', jobId, e);
  }
}

export async function runPlanningLetterJob(jobId: string, input: PlanningLetterJobInput): Promise<void> {
  const { engagementId, clientId, firmId, documentTemplateId, emailTemplateId, actorUserId, actorUserName } = input;

  await setStatus(jobId, { status: 'processing', startedAt: new Date() });

  try {
    // Re-fetch eligible recipients inside the job so we don't trust
    // the caller's snapshot — the user may have edited contacts
    // between modal submit and the processor pickup.
    const informedContacts = await prisma.auditClientContact.findMany({
      where: { engagementId, isInformedManagement: true },
    });
    const informedEmails = informedContacts
      .map(c => (c.email || '').trim().toLowerCase())
      .filter(e => e.length > 0);
    const portalUsers = informedEmails.length > 0
      ? await prisma.clientPortalUser.findMany({
          where: {
            clientId,
            isActive: true,
            email: { in: informedEmails, mode: 'insensitive' as const },
          },
        })
      : [];
    const portalEmailSet = new Set(portalUsers.map(u => u.email.toLowerCase()));
    const eligible = informedContacts.filter(c => {
      const e = (c.email || '').trim().toLowerCase();
      return e && portalEmailSet.has(e);
    });
    if (eligible.length === 0) {
      await setStatus(jobId, {
        status: 'failed',
        errorMessage: 'No Informed Management contact with Client Portal access — recipient list was empty at send time.',
        completedAt: new Date(),
      });
      return;
    }

    // ── Step 1: render .docx ──────────────────────────────────────────
    const rendered = await renderTemplateToDocx(documentTemplateId, engagementId);
    const { buffer, fileName, templateName } = rendered;

    // ── Step 2: upload to portal-documents blob + persist ────────────
    const documentId = crypto.randomUUID();
    const blobPath = `${clientId}/${documentId}_${fileName}`;
    const containerName = 'portal-documents';
    const contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    await uploadToContainer(containerName, blobPath, buffer, contentType);
    const portalDoc = await prisma.portalDocument.create({
      data: {
        id: documentId,
        firmId,
        clientId,
        engagementId,
        templateId: documentTemplateId,
        name: templateName,
        category: 'audit_planning_letter',
        fileName,
        contentType,
        fileSize: buffer.length,
        blobPath,
        containerName,
        uploadedById: actorUserId,
        uploadedByName: actorUserName,
      },
    });

    // ── Step 3: render covering email + send to each recipient ───────
    const email = await renderEmailTemplate(emailTemplateId, engagementId);
    const attachment = {
      name: fileName,
      contentType,
      contentInBase64: buffer.toString('base64'),
    };
    const recipients: RecipientResult[] = [];
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

    const anyFailed = recipients.some(r => r.status === 'failed');

    // Mark the job appropriately. A partial failure (some sent, some
    // failed) is still 'failed' so the orange badge surfaces — the
    // recipient breakdown sits inside the job row for the tooltip.
    await setStatus(jobId, {
      status: anyFailed ? 'failed' : 'success',
      portalDocumentId: portalDoc.id,
      fileName,
      subject: email.subject,
      recipients: recipients as any,
      errorMessage: anyFailed
        ? `Email failed for ${recipients.filter(r => r.status === 'failed').length} of ${recipients.length} recipients.`
        : null,
      completedAt: new Date(),
    });

    // Audit log (same shape the synchronous endpoint used). Failing
    // this is silent — never block the job outcome on telemetry.
    try {
      await (prisma as any).activityLog?.create?.({
        data: {
          userId: actorUserId,
          firmId,
          clientId,
          action: 'send_planning_letter',
          tool: 'rmm',
          detail: {
            engagementId,
            jobId,
            documentTemplateId,
            emailTemplateId,
            portalDocumentId: portalDoc.id,
            fileName,
            recipients,
          },
        },
      });
    } catch { /* tolerant */ }
  } catch (err: any) {
    await setStatus(jobId, {
      status: 'failed',
      errorMessage: err?.message || 'Unknown error during background processing',
      completedAt: new Date(),
    });
  }
}
