import { EmailClient } from '@azure/communication-email';

const connectionString = process.env.AZURE_COMMUNICATION_CONNECTION_STRING || '';
const senderAddress = process.env.EMAIL_FROM || 'DoNotReply@9a3b0f92-2a07-4b75-98c6-3e9cecf2c5c4.azurecomm.net';

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
  return sendEmail(recipientEmail, `Xero access request for ${clientName} — Acumon Intelligence`, `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: linear-gradient(135deg, #1e3a5f 0%, #2563eb 100%); padding: 30px; border-radius: 8px 8px 0 0;">
        <h1 style="color: white; margin: 0; font-size: 24px;">Acumon Intelligence</h1>
      </div>
      <div style="background: #f8fafc; padding: 30px; border-radius: 0 0 8px 8px; border: 1px solid #e2e8f0;">
        <p style="color: #374151; font-size: 16px;">Hello ${recipientName},</p>
        <p style="color: #374151; font-size: 16px;">
          <strong>${auditorName}</strong> has requested read-only access to the <strong>${clientName}</strong> Xero account
          for the purpose of conducting audit and assurance work.
        </p>
        <p style="color: #374151; font-size: 16px;">
          If you approve, please click the button below. You will be asked to sign in to Xero and authorise the connection.
          Access will be <strong>read-only</strong> and will automatically expire after <strong>30 days</strong>.
        </p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${authoriseUrl}" style="background: #13b5ea; color: white; padding: 14px 36px; border-radius: 6px; text-decoration: none; font-size: 16px; font-weight: 600;">Authorise Xero Access</a>
        </div>
        <div style="background: #fef3c7; border: 1px solid #f59e0b; border-radius: 6px; padding: 16px; margin: 20px 0;">
          <p style="color: #92400e; font-size: 14px; margin: 0;">
            <strong>What this grants:</strong> Read-only access to transactions, account codes, and contacts in your Xero organisation.
            No changes will be made to your data. The connection will be automatically removed after 30 days.
          </p>
        </div>
        <p style="color: #6b7280; font-size: 14px;">This link expires in 7 days. If you did not expect this request, please ignore this email.</p>
        <p style="color: #6b7280; font-size: 12px; margin-top: 20px;">
          Acumon Intelligence · <a href="https://www.acumonintelligence.com" style="color: #2563eb;">www.acumonintelligence.com</a>
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
