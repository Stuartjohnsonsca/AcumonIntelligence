import { NextResponse } from 'next/server';
import { EmailClient } from '@azure/communication-email';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const to = searchParams.get('to');
  if (!to) return NextResponse.json({ error: 'Pass ?to=email@example.com' }, { status: 400 });

  const connectionString = process.env.AZURE_COMMUNICATION_CONNECTION_STRING || '';
  const senderAddress = process.env.EMAIL_FROM || 'DoNotReply@9a3b0f92-2a07-4b75-98c6-3e9cecf2c5c4.azurecomm.net';

  if (!connectionString) {
    return NextResponse.json({ error: 'AZURE_COMMUNICATION_CONNECTION_STRING not set', hasVar: false });
  }

  try {
    const client = new EmailClient(connectionString);
    const poller = await client.beginSend({
      senderAddress,
      content: {
        subject: 'Vercel email test — Acumon Intelligence',
        html: '<h2>Vercel Email Test</h2><p>This email was sent from the Vercel production environment to verify Azure Communication Services works.</p><p><a href="https://acumon-intelligence.vercel.app">Visit App</a></p>',
      },
      recipients: { to: [{ address: to }] },
    });

    const result = await poller.pollUntilDone();
    return NextResponse.json({
      status: result.status,
      error: result.error || null,
      sender: senderAddress,
      to,
      connectionStringPrefix: connectionString.substring(0, 50) + '...',
    });
  } catch (err) {
    return NextResponse.json({
      error: err instanceof Error ? err.message : String(err),
      sender: senderAddress,
      connectionStringPrefix: connectionString.substring(0, 50) + '...',
    }, { status: 500 });
  }
}
