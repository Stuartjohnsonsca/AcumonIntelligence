import { EmailClient } from '@azure/communication-email';

const connectionString = process.env.AZURE_COMMUNICATION_CONNECTION_STRING || '';
const senderAddress = process.env.EMAIL_FROM || 'DoNotReply@acumonintelligence.com';

async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  if (!connectionString) {
    console.error('[Portal Email] AZURE_COMMUNICATION_CONNECTION_STRING not configured');
    throw new Error('Email service not configured');
  }

  console.log(`[Portal Email] Sending to ${to}: "${subject}"`);
  const client = new EmailClient(connectionString);
  try {
    const poller = await client.beginSend({
      senderAddress,
      content: { subject, html },
      recipients: { to: [{ address: to }] },
    });
    const result = await poller.pollUntilDone();
    console.log(`[Portal Email] Sent successfully to ${to}, status: ${result.status}`);
    if (result.status !== 'Succeeded') {
      console.error(`[Portal Email] Send status was ${result.status}:`, JSON.stringify(result));
      throw new Error(`Email send status: ${result.status}`);
    }
  } catch (err) {
    console.error(`[Portal Email] Failed to send to ${to}:`, err);
    throw err;
  }
}

export async function sendPortalVerificationCode(email: string, name: string, code: string): Promise<void> {
  await sendEmail(
    email,
    `Your verification code: ${code}`,
    `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:20px">
      <h2 style="color:#1e40af;margin-bottom:4px">Acumon Client Portal</h2>
      <p style="color:#475569;font-size:14px">Hi ${name},</p>
      <p style="color:#475569;font-size:14px">Your verification code is:</p>
      <div style="background:#f1f5f9;border-radius:8px;padding:16px;text-align:center;margin:16px 0">
        <span style="font-size:32px;font-weight:bold;letter-spacing:8px;color:#1e293b">${code}</span>
      </div>
      <p style="color:#94a3b8;font-size:12px">This code expires in 10 minutes. If you did not request this, please ignore this email.</p>
    </div>`,
  );
}

export async function sendPortalPasswordResetCode(email: string, name: string, code: string): Promise<void> {
  await sendEmail(
    email,
    `Password reset code: ${code}`,
    `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:20px">
      <h2 style="color:#1e40af;margin-bottom:4px">Acumon Client Portal</h2>
      <p style="color:#475569;font-size:14px">Hi ${name},</p>
      <p style="color:#475569;font-size:14px">You requested a password reset. Your code is:</p>
      <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px;text-align:center;margin:16px 0">
        <span style="font-size:32px;font-weight:bold;letter-spacing:8px;color:#1e293b">${code}</span>
      </div>
      <p style="color:#94a3b8;font-size:12px">This code expires in 15 minutes. If you did not request a password reset, please ignore this email — your password will remain unchanged.</p>
    </div>`,
  );
}

export async function sendPortalWelcomeEmail(email: string, name: string, tempPassword: string): Promise<void> {
  const portalUrl = `${process.env.NEXTAUTH_URL || 'https://acumon-intelligence.vercel.app'}/portal`;
  await sendEmail(
    email,
    'Your Audit Portal Access',
    `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:20px">
      <h2 style="color:#1e40af;margin-bottom:4px">Acumon Client Portal</h2>
      <p style="color:#475569;font-size:14px">Hi ${name},</p>
      <p style="color:#475569;font-size:14px">You have been granted access to the Client Audit Portal. Use the credentials below to sign in:</p>
      <div style="background:#f1f5f9;border-radius:8px;padding:16px;margin:16px 0">
        <p style="margin:0 0 8px 0;color:#475569;font-size:13px"><strong>Email:</strong> ${email}</p>
        <p style="margin:0 0 8px 0;color:#475569;font-size:13px"><strong>Temporary Password:</strong> <code style="background:#e2e8f0;padding:2px 6px;border-radius:4px;font-size:14px">${tempPassword}</code></p>
        <p style="margin:0;color:#475569;font-size:13px"><strong>Portal:</strong> <a href="${portalUrl}" style="color:#2563eb">${portalUrl}</a></p>
      </div>
      <p style="color:#ef4444;font-size:12px;font-weight:600">Please change your password after first login using the "Forgot your password?" link.</p>
      <p style="color:#94a3b8;font-size:12px">If you did not expect this email, please contact your auditor.</p>
    </div>`,
  );
}

export async function sendEvidenceUploadNotification(
  firmEmail: string,
  clientName: string,
  uploadCount: number,
  hasErrors: boolean,
): Promise<void> {
  await sendEmail(
    firmEmail,
    hasErrors
      ? `[Action Required] Evidence upload issue — ${clientName}`
      : `Evidence uploaded — ${clientName}`,
    `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:20px">
      <h2 style="color:#1e40af;margin-bottom:4px">Acumon Intelligence</h2>
      <p style="color:#475569;font-size:14px">
        ${hasErrors
          ? `An evidence upload from <strong>${clientName}</strong> requires your attention. ${uploadCount} file(s) were uploaded but may not match the requested evidence.`
          : `<strong>${clientName}</strong> has uploaded ${uploadCount} evidence file(s) that have been verified and matched to audit requests.`
        }
      </p>
      <p style="color:#475569;font-size:14px">
        <a href="${process.env.NEXTAUTH_URL || 'https://acumon-intelligence.vercel.app'}/tools/sampling" style="color:#2563eb">View in Acumon</a>
      </p>
    </div>`,
  );
}
