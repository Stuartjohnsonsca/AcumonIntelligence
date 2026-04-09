import { sendEmail } from './email';

const BASE_URL = process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://app.acumonintelligence.com';

function brandedTemplate(title: string, body: string): string {
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); padding: 24px 32px; border-radius: 12px 12px 0 0;">
        <h1 style="color: white; font-size: 20px; margin: 0;">Acumon Intelligence</h1>
        <p style="color: rgba(255,255,255,0.8); font-size: 13px; margin: 4px 0 0;">${title}</p>
      </div>
      <div style="background: white; padding: 24px 32px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 12px 12px;">
        ${body}
      </div>
      <div style="text-align: center; padding: 16px; color: #94a3b8; font-size: 11px;">
        Acumon Intelligence — Audit Management Platform
      </div>
    </div>
  `;
}

/** Sent when "Start Audit" is clicked — notifies main client contact of portal access */
export async function sendAuditStartEmail(
  to: string,
  contactName: string,
  clientName: string,
  firmName: string,
  periodLabel: string,
  auditType: string,
): Promise<void> {
  const portalUrl = `${BASE_URL}/portal`;
  const html = brandedTemplate('Audit Engagement Notification', `
    <p style="color: #334155; font-size: 14px;">Dear ${contactName},</p>
    <p style="color: #475569; font-size: 14px;">
      We are writing to inform you that the <strong>${auditType}</strong> audit engagement for
      <strong>${clientName}</strong> (period: ${periodLabel}) has been initiated by ${firmName}.
    </p>
    <p style="color: #475569; font-size: 14px;">
      You have been granted access to the <strong>Client Portal</strong> where you can:
    </p>
    <ul style="color: #475569; font-size: 14px; padding-left: 20px;">
      <li>View and respond to information requests</li>
      <li>Upload requested documents securely</li>
      <li>Track the progress of the engagement</li>
    </ul>
    <div style="text-align: center; margin: 24px 0;">
      <a href="${portalUrl}" style="display: inline-block; padding: 12px 32px; background: linear-gradient(135deg, #1e40af, #3b82f6); color: white; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 14px;">
        Access Client Portal
      </a>
    </div>
    <p style="color: #94a3b8; font-size: 12px;">
      If you have any questions, please contact your audit team directly.
    </p>
  `);

  await sendEmail(to, `Audit Engagement Started — ${clientName}`, html, { displayName: contactName });
}

/** Sent when a document is requested from the client */
export async function sendDocumentRequestEmail(
  to: string,
  contactName: string,
  clientName: string,
  documentName: string,
  requestedBy: string,
): Promise<void> {
  const portalUrl = `${BASE_URL}/portal`;
  const html = brandedTemplate('Document Request', `
    <p style="color: #334155; font-size: 14px;">Dear ${contactName},</p>
    <p style="color: #475569; font-size: 14px;">
      The audit team has requested the following document for <strong>${clientName}</strong>:
    </p>
    <div style="background: #f1f5f9; padding: 12px 16px; border-radius: 8px; margin: 16px 0; border-left: 4px solid #3b82f6;">
      <strong style="color: #1e40af; font-size: 14px;">${documentName}</strong>
      <p style="color: #64748b; font-size: 12px; margin: 4px 0 0;">Requested by: ${requestedBy}</p>
    </div>
    <p style="color: #475569; font-size: 14px;">
      Please upload this document through the Client Portal at your earliest convenience.
    </p>
    <div style="text-align: center; margin: 24px 0;">
      <a href="${portalUrl}" style="display: inline-block; padding: 10px 24px; background: linear-gradient(135deg, #1e40af, #3b82f6); color: white; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 13px;">
        Upload Document
      </a>
    </div>
  `);

  await sendEmail(to, `Document Request — ${documentName}`, html, { displayName: contactName });
}

/** Sent when PAR items are sent to management for comment */
export async function sendPARManagementEmail(
  to: string,
  contactName: string,
  clientName: string,
  items: { particulars: string; variance: string; variancePercent: string }[],
): Promise<void> {
  const itemRows = items.map(item => `
    <tr>
      <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; font-size: 13px; color: #334155;">${item.particulars}</td>
      <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; font-size: 13px; color: #334155; text-align: right;">${item.variance}</td>
      <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; font-size: 13px; color: #334155; text-align: right;">${item.variancePercent}</td>
    </tr>
  `).join('');

  const html = brandedTemplate('Management Inquiry — Preliminary Analytical Review', `
    <p style="color: #334155; font-size: 14px;">Dear ${contactName},</p>
    <p style="color: #475569; font-size: 14px;">
      As part of our audit of <strong>${clientName}</strong>, we have identified the following
      significant variances that require management explanation:
    </p>
    <table style="width: 100%; border-collapse: collapse; margin: 16px 0; border: 1px solid #e2e8f0; border-radius: 8px;">
      <thead>
        <tr style="background: #f8fafc;">
          <th style="padding: 8px 12px; text-align: left; font-size: 12px; color: #64748b; border-bottom: 2px solid #e2e8f0;">Item</th>
          <th style="padding: 8px 12px; text-align: right; font-size: 12px; color: #64748b; border-bottom: 2px solid #e2e8f0;">Variance</th>
          <th style="padding: 8px 12px; text-align: right; font-size: 12px; color: #64748b; border-bottom: 2px solid #e2e8f0;">Variance %</th>
        </tr>
      </thead>
      <tbody>${itemRows}</tbody>
    </table>
    <p style="color: #475569; font-size: 14px;">
      Please provide explanations for the above variances through the Client Portal
      or by responding to this email.
    </p>
  `);

  await sendEmail(to, `Management Inquiry — ${clientName} Analytical Review`, html, { displayName: contactName });
}

/** Sent when meeting action items need to be shared with team members */
export async function sendMeetingActionsEmail(
  to: string,
  recipientName: string,
  clientName: string,
  meetingTitle: string,
  meetingDate: string,
  summary: string,
  actionItems: { action: string; assignedTo: string; deadline: string | null }[],
): Promise<void> {
  const actionRows = actionItems.map(item => `
    <tr>
      <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; font-size: 13px; color: #334155;">${item.action}</td>
      <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; font-size: 13px; color: #334155;">${item.assignedTo}</td>
      <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; font-size: 13px; color: #64748b;">${item.deadline || 'TBC'}</td>
    </tr>
  `).join('');

  const html = brandedTemplate('Meeting Action Items', `
    <p style="color: #334155; font-size: 14px;">Dear ${recipientName},</p>
    <p style="color: #475569; font-size: 14px;">
      The following action items were recorded from the meeting <strong>${meetingTitle}</strong>
      (${meetingDate}) regarding <strong>${clientName}</strong>:
    </p>
    ${summary ? `<p style="color: #64748b; font-size: 13px; font-style: italic; margin: 12px 0;">${summary}</p>` : ''}
    <table style="width: 100%; border-collapse: collapse; margin: 16px 0; border: 1px solid #e2e8f0; border-radius: 8px;">
      <thead>
        <tr style="background: #f8fafc;">
          <th style="padding: 8px 12px; text-align: left; font-size: 12px; color: #64748b; border-bottom: 2px solid #e2e8f0;">Action</th>
          <th style="padding: 8px 12px; text-align: left; font-size: 12px; color: #64748b; border-bottom: 2px solid #e2e8f0;">Assigned To</th>
          <th style="padding: 8px 12px; text-align: left; font-size: 12px; color: #64748b; border-bottom: 2px solid #e2e8f0;">Deadline</th>
        </tr>
      </thead>
      <tbody>${actionRows}</tbody>
    </table>
    <p style="color: #475569; font-size: 14px;">
      Please review and confirm the above action items.
    </p>
  `);

  await sendEmail(to, `Meeting Actions — ${meetingTitle} (${clientName})`, html, { displayName: recipientName });
}

/** Sent to expert with meeting summary and actions for confirmation */
export async function sendExpertActionEmail(
  to: string,
  expertName: string,
  clientName: string,
  meetingTitle: string,
  meetingDate: string,
  summary: string,
  actionItems: { action: string; assignedTo: string; deadline: string | null }[],
): Promise<void> {
  const actionRows = actionItems.map(item => `
    <tr>
      <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; font-size: 13px; color: #334155;">${item.action}</td>
      <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; font-size: 13px; color: #334155;">${item.assignedTo}</td>
      <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; font-size: 13px; color: #64748b;">${item.deadline || 'TBC'}</td>
    </tr>
  `).join('');

  const html = brandedTemplate('Expert Review — Meeting Summary & Actions', `
    <p style="color: #334155; font-size: 14px;">Dear ${expertName},</p>
    <p style="color: #475569; font-size: 14px;">
      Please find below a summary of the meeting <strong>${meetingTitle}</strong>
      (${meetingDate}) regarding <strong>${clientName}</strong>.
    </p>
    <div style="background: #f1f5f9; padding: 12px 16px; border-radius: 8px; margin: 16px 0; border-left: 4px solid #8b5cf6;">
      <p style="color: #475569; font-size: 13px; margin: 0;">${summary}</p>
    </div>
    ${actionItems.length > 0 ? `
    <p style="color: #475569; font-size: 14px;">
      The following action items were identified:
    </p>
    <table style="width: 100%; border-collapse: collapse; margin: 16px 0; border: 1px solid #e2e8f0; border-radius: 8px;">
      <thead>
        <tr style="background: #f8fafc;">
          <th style="padding: 8px 12px; text-align: left; font-size: 12px; color: #64748b; border-bottom: 2px solid #e2e8f0;">Action</th>
          <th style="padding: 8px 12px; text-align: left; font-size: 12px; color: #64748b; border-bottom: 2px solid #e2e8f0;">Assigned To</th>
          <th style="padding: 8px 12px; text-align: left; font-size: 12px; color: #64748b; border-bottom: 2px solid #e2e8f0;">Deadline</th>
        </tr>
      </thead>
      <tbody>${actionRows}</tbody>
    </table>
    ` : ''}
    <p style="color: #475569; font-size: 14px;">
      Please review this summary and confirm accuracy by replying to this email.
      If any amendments are required, please detail them in your response.
    </p>
  `);

  await sendEmail(to, `Expert Review — ${meetingTitle} (${clientName})`, html, { displayName: expertName });
}
