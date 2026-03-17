import { NextResponse } from 'next/server';
import { EmailClient } from '@azure/communication-email';

export const maxDuration = 30;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const to = searchParams.get('to') || 'stuart@acumon.com';
  const mode = searchParams.get('mode') || 'simple';

  const connectionString = process.env.AZURE_COMMUNICATION_CONNECTION_STRING || '';
  const senderAddress = process.env.EMAIL_FROM || 'DoNotReply@9a3b0f92-2a07-4b75-98c6-3e9cecf2c5c4.azurecomm.net';

  if (!connectionString) {
    return NextResponse.json({ error: 'AZURE_COMMUNICATION_CONNECTION_STRING not set' }, { status: 500 });
  }

  const subject = mode === 'xero'
    ? 'Xero access request for Test Client — Acumon Intelligence'
    : 'Acumon Intelligence — Email Test';

  const html = mode === 'xero'
    ? `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #1e3a5f 0%, #2563eb 100%); padding: 30px; border-radius: 8px 8px 0 0;">
          <h1 style="color: white; margin: 0; font-size: 24px;">Acumon Intelligence</h1>
        </div>
        <div style="background: #f8fafc; padding: 30px; border-radius: 0 0 8px 8px; border: 1px solid #e2e8f0;">
          <p style="color: #374151; font-size: 16px;">Hello Test User,</p>
          <p style="color: #374151; font-size: 16px;">
            <strong>Test Auditor</strong> has requested read-only access to the <strong>Test Client</strong> Xero account
            for the purpose of conducting audit and assurance work.
          </p>
          <p style="color: #374151; font-size: 16px;">
            If you approve, please click the button below. You will be asked to sign in to Xero and authorise the connection.
            Access will be <strong>read-only</strong> and will automatically expire after <strong>30 days</strong>.
          </p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="https://acumon-intelligence.vercel.app/xero-authorise/test-token-12345" style="background: #13b5ea; color: white; padding: 14px 36px; border-radius: 6px; text-decoration: none; font-size: 16px; font-weight: 600;">Authorise Xero Access</a>
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
      </div>`
    : `<p>This is a test email from Acumon Intelligence at ${new Date().toISOString()}.</p>`;

  try {
    const client = new EmailClient(connectionString);
    const poller = await client.beginSend({
      senderAddress,
      content: { subject, html },
      recipients: { to: [{ address: to }] },
    });

    const result = await poller.pollUntilDone();

    return NextResponse.json({
      status: result.status,
      id: result.id,
      error: result.error?.message || null,
      sender: senderAddress,
      to,
      mode,
      connectionStringPrefix: connectionString.substring(0, 60) + '...',
    });
  } catch (err) {
    return NextResponse.json({
      error: err instanceof Error ? err.message : 'Unknown error',
      sender: senderAddress,
      to,
      connectionStringPrefix: connectionString.substring(0, 60) + '...',
    }, { status: 500 });
  }
}
