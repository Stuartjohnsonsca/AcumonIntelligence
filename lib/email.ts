import { EmailClient } from '@azure/communication-email';

const connectionString = process.env.AZURE_COMMUNICATION_CONNECTION_STRING || '';
const senderAddress = process.env.EMAIL_FROM || 'DoNotReply@acumonintelligence.com';

async function sendEmail(to: string, subject: string, html: string): Promise<{ messageId?: string }> {
  if (!connectionString) {
    throw new Error('AZURE_COMMUNICATION_CONNECTION_STRING is not configured');
  }

  console.log(`[Email] Sending to ${to}, subject: "${subject}", sender: ${senderAddress}`);

  const client = new EmailClient(connectionString);
  const poller = await client.beginSend({
    senderAddress,
    content: { subject, html },
    recipients: { to: [{ address: to }] },
  });

  const result = await poller.pollUntilDone();
  console.log(`[Email] Result: status=${result.status}, id=${result.id}, error=${result.error?.message || 'none'}`);

  if (result.status !== 'Succeeded') {
    throw new Error(`Email send failed with status: ${result.status} — ${result.error?.message || 'Unknown error'}`);
  }

  return { messageId: result.id };
}

export async function sendTwoFactorCode(email: string, name: string, code: string): Promise<void> {
  await sendEmail(email, 'Your Acumon Intelligence verification code', `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: linear-gradient(135deg, #1e3a5f 0%, #2563eb 100%); padding: 30px; border-radius: 8px 8px 0 0;">
        <h1 style="color: white; margin: 0; font-size: 24px;">Acumon Intelligence</h1>
      </div>
      <div style="background: #f8fafc; padding: 30px; border-radius: 0 0 8px 8px; border: 1px solid #e2e8f0;">
        <p style="color: #374151; font-size: 16px;">Hello ${name},</p>
        <p style="color: #374151; font-size: 16px;">Your verification code is:</p>
        <div style="background: white; border: 2px solid #2563eb; border-radius: 8px; padding: 20px; text-align: center; margin: 20px 0;">
          <span style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #1e3a5f;">${code}</span>
        </div>
        <p style="color: #6b7280; font-size: 14px;">This code expires in 10 minutes. Do not share this code with anyone.</p>
        <p style="color: #6b7280; font-size: 14px;">If you did not request this code, please ignore this email.</p>
      </div>
    </div>
  `);
}

export async function sendPasswordResetEmail(email: string, name: string, resetUrl: string): Promise<void> {
  await sendEmail(email, 'Reset your Acumon Intelligence password', `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: linear-gradient(135deg, #1e3a5f 0%, #2563eb 100%); padding: 30px; border-radius: 8px 8px 0 0;">
        <h1 style="color: white; margin: 0; font-size: 24px;">Acumon Intelligence</h1>
      </div>
      <div style="background: #f8fafc; padding: 30px; border-radius: 0 0 8px 8px; border: 1px solid #e2e8f0;">
        <p style="color: #374151; font-size: 16px;">Hello ${name},</p>
        <p style="color: #374151; font-size: 16px;">You requested a password reset. Click the button below to set a new password:</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${resetUrl}" style="background: #2563eb; color: white; padding: 12px 30px; border-radius: 6px; text-decoration: none; font-size: 16px; font-weight: 600;">Reset Password</a>
        </div>
        <p style="color: #6b7280; font-size: 14px;">This link expires in 1 hour. If you did not request a password reset, please ignore this email.</p>
      </div>
    </div>
  `);
}

export async function sendAccessRequestEmail(
  managerEmail: string,
  managerName: string,
  requesterName: string,
  clientName: string,
  approveUrl: string,
): Promise<void> {
  await sendEmail(managerEmail, `Access request: ${requesterName} → ${clientName}`, `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: linear-gradient(135deg, #1e3a5f 0%, #2563eb 100%); padding: 30px; border-radius: 8px 8px 0 0;">
        <h1 style="color: white; margin: 0; font-size: 24px;">Acumon Intelligence</h1>
      </div>
      <div style="background: #f8fafc; padding: 30px; border-radius: 0 0 8px 8px; border: 1px solid #e2e8f0;">
        <p style="color: #374151; font-size: 16px;">Hello ${managerName},</p>
        <p style="color: #374151; font-size: 16px;"><strong>${requesterName}</strong> has requested access to client <strong>${clientName}</strong>.</p>
        <p style="color: #374151; font-size: 16px;">Click the button below to approve this request:</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${approveUrl}" style="background: #16a34a; color: white; padding: 12px 30px; border-radius: 6px; text-decoration: none; font-size: 16px; font-weight: 600;">Approve Access</a>
        </div>
        <p style="color: #6b7280; font-size: 14px;">This link expires in 7 days. If you do not wish to grant access, simply ignore this email.</p>
      </div>
    </div>
  `);
}

export async function sendExtractionExpiryReminder(
  email: string,
  name: string,
  clientName: string,
  daysRemaining: number,
  downloadUrl: string,
): Promise<void> {
  const isFinal = daysRemaining <= 40;
  const subject = isFinal
    ? `Final reminder: Extraction data for ${clientName} expires in ${daysRemaining} days`
    : `Reminder: Extraction data for ${clientName} will expire in ${daysRemaining} days`;

  await sendEmail(email, subject, `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: linear-gradient(135deg, #1e3a5f 0%, #2563eb 100%); padding: 30px; border-radius: 8px 8px 0 0;">
        <h1 style="color: white; margin: 0; font-size: 24px;">Acumon Intelligence</h1>
      </div>
      <div style="background: #f8fafc; padding: 30px; border-radius: 0 0 8px 8px; border: 1px solid #e2e8f0;">
        <p style="color: #374151; font-size: 16px;">Hello ${name},</p>
        <p style="color: #374151; font-size: 16px;">
          Your extraction data for <strong>${clientName}</strong> will be automatically deleted in <strong>${daysRemaining} days</strong>.
        </p>
        ${isFinal ? '<p style="color: #dc2626; font-size: 16px; font-weight: 600;">This is your final reminder. Please download your files before they are permanently deleted.</p>' : ''}
        <p style="color: #374151; font-size: 16px;">Click below to download your files now:</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${downloadUrl}" style="background: #2563eb; color: white; padding: 12px 30px; border-radius: 6px; text-decoration: none; font-size: 16px; font-weight: 600;">Download Files</a>
        </div>
        <p style="color: #6b7280; font-size: 14px;">Documents are retained for 121 days from extraction. After this period, all files will be permanently removed.</p>
      </div>
    </div>
  `);
}

export async function sendXeroAccessRequestEmail(
  recipientEmail: string,
  recipientName: string,
  clientName: string,
  auditorName: string,
  authoriseUrl: string,
): Promise<{ messageId?: string }> {
  return sendEmail(recipientEmail, `${clientName} — Accounting data access (Acumon Intelligence)`, `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="padding: 20px 0;">
        <p style="color: #374151; font-size: 16px; margin: 0 0 16px 0;">Hello ${recipientName},</p>
        <p style="color: #374151; font-size: 16px; margin: 0 0 16px 0;">
          ${auditorName} is conducting audit work for ${clientName} and has requested
          temporary read-only access to your Xero accounting data via Acumon Intelligence.
        </p>
        <p style="color: #374151; font-size: 16px; margin: 0 0 16px 0;">
          To review and approve this request, please visit the link below. You will be
          directed to Xero's own sign-in page to confirm the connection.
        </p>
        <p style="color: #374151; font-size: 16px; margin: 0 0 8px 0;">
          <strong>Review request:</strong>
        </p>
        <p style="color: #2563eb; font-size: 14px; word-break: break-all; margin: 0 0 24px 0;">
          <a href="${authoriseUrl}" style="color: #2563eb;">${authoriseUrl}</a>
        </p>
        <p style="color: #374151; font-size: 14px; margin: 0 0 8px 0;">Details:</p>
        <ul style="color: #374151; font-size: 14px; margin: 0 0 16px 0; padding-left: 20px;">
          <li>Access type: Read-only (no changes to your data)</li>
          <li>Duration: Automatically removed after 30 days</li>
          <li>Link valid for: 7 days</li>
        </ul>
        <p style="color: #6b7280; font-size: 13px; margin: 0 0 8px 0;">
          If you did not expect this request or have questions, please contact ${auditorName} directly.
        </p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
        <p style="color: #9ca3af; font-size: 12px; margin: 0;">
          Sent by Acumon Intelligence on behalf of ${auditorName}.
        </p>
      </div>
    </div>
  `);
}

export async function sendWelcomeEmail(email: string, name: string, loginUrl: string): Promise<void> {
  await sendEmail(email, 'Welcome to Acumon Intelligence', `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: linear-gradient(135deg, #1e3a5f 0%, #2563eb 100%); padding: 30px; border-radius: 8px 8px 0 0;">
        <h1 style="color: white; margin: 0; font-size: 24px;">Acumon Intelligence</h1>
      </div>
      <div style="background: #f8fafc; padding: 30px; border-radius: 0 0 8px 8px; border: 1px solid #e2e8f0;">
        <p style="color: #374151; font-size: 16px;">Hello ${name},</p>
        <p style="color: #374151; font-size: 16px;">Welcome to Acumon Intelligence. Your account has been created. Please log in and set up your password.</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${loginUrl}" style="background: #2563eb; color: white; padding: 12px 30px; border-radius: 6px; text-decoration: none; font-size: 16px; font-weight: 600;">Login Now</a>
        </div>
      </div>
    </div>
  `);
}
