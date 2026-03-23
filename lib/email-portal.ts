import { EmailClient } from '@azure/communication-email';

const connectionString = process.env.AZURE_COMMUNICATION_CONNECTION_STRING || '';
const senderAddress = process.env.EMAIL_FROM || 'DoNotReply@acumonintelligence.com';

async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  if (!connectionString) {
    console.warn('[Portal Email] AZURE_COMMUNICATION_CONNECTION_STRING not configured — skipping email');
    return;
  }

  const client = new EmailClient(connectionString);
  const poller = await client.beginSend({
    senderAddress,
    content: { subject, html },
    recipients: { to: [{ address: to }] },
  });
  await poller.pollUntilDone();
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
