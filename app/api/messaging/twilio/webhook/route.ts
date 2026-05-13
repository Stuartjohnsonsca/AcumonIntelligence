/**
 * Twilio inbound webhook — receives SMS and WhatsApp replies.
 *
 * Twilio POSTs application/x-www-form-urlencoded to this endpoint
 * with the message body, sender, recipient, and any media URLs. We
 *   1. Verify the X-Twilio-Signature header to reject spoofed posts.
 *   2. Parse the body, identify the channel (sms vs whatsapp by the
 *      `whatsapp:` prefix on the `From` field).
 *   3. Resolve the sender to a ClientPortalUser by their stored phone
 *      number (or leave portalUserId=null for triage).
 *   4. Look up the most recent open PortalRequest assigned to that
 *      user so the reply gets stitched to the request thread.
 *   5. Persist a portal_messages row.
 *   6. Respond with empty TwiML (Twilio expects an XML reply or 204).
 *
 * Configure Twilio: on each number / WhatsApp sender in the console,
 * set the messaging webhook to POST → https://<host>/api/messaging/
 * twilio/webhook.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { verifyTwilioSignature } from '@/lib/messaging/twilio';
import { findPortalUserByAddress, recordInboundMessage } from '@/lib/messaging';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  // Twilio sends form-encoded; consume + parse once into a plain
  // params record so we can both verify and read fields.
  const raw = await req.text();
  const params: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(raw)) params[k] = v;

  // The signature is computed over the URL Twilio called. When the
  // service is behind a proxy we may need to override via env to
  // match what Twilio sees — TWILIO_WEBHOOK_PUBLIC_URL takes
  // precedence, otherwise fall back to req.url.
  const overrideBase = process.env.TWILIO_WEBHOOK_PUBLIC_URL;
  const url = overrideBase
    ? `${overrideBase.replace(/\/+$/, '')}/api/messaging/twilio/webhook`
    : req.url;
  const signature = req.headers.get('x-twilio-signature') || '';
  if (!(await verifyTwilioSignature({ url, params, signature }))) {
    // We log + 403 rather than silently dropping so misconfiguration
    // is obvious from the Twilio debugger.
    console.warn('[twilio webhook] signature verification failed', { url });
    return NextResponse.json({ error: 'Signature verification failed' }, { status: 403 });
  }

  const from = params['From'] || '';
  const to = params['To'] || '';
  const body = params['Body'] || '';
  const channel = from.startsWith('whatsapp:') ? 'whatsapp' : 'sms';
  const numMedia = Number(params['NumMedia'] || '0');
  const mediaUrls: string[] = [];
  for (let i = 0; i < numMedia; i++) {
    const url = params[`MediaUrl${i}`];
    if (url) mediaUrls.push(url);
  }

  // Resolve sender → ClientPortalUser. We strip the `whatsapp:`
  // prefix Twilio adds so the stored phone-number columns match.
  const matched = await findPortalUserByAddress(channel, from);

  // Best-effort: link the reply to the most recent open request the
  // user is assigned to. If they're not assigned to anything open we
  // still persist the message with relatedRequestId=null so the
  // firm-side inbox shows it.
  let relatedRequestId: string | null = null;
  if (matched) {
    const open = await prisma.portalRequest.findFirst({
      where: {
        clientId: matched.clientId,
        assignedPortalUserId: matched.id,
        status: { in: ['outstanding', 'chat_replied'] },
      },
      orderBy: { requestedAt: 'desc' },
      select: { id: true },
    });
    relatedRequestId = open?.id ?? null;

    // Append the inbound text to the request's chat history so the
    // existing portal request UI shows it inline alongside email
    // replies. We keep this best-effort — failures don't bubble up.
    if (relatedRequestId) {
      try {
        const existing = await prisma.portalRequest.findUnique({
          where: { id: relatedRequestId },
          select: { chatHistory: true },
        });
        const history = Array.isArray(existing?.chatHistory) ? (existing!.chatHistory as any[]) : [];
        history.push({
          from: 'client',
          name: 'Client (via ' + channel + ')',
          message: body,
          timestamp: new Date().toISOString(),
          channel,
        });
        await prisma.portalRequest.update({
          where: { id: relatedRequestId },
          data: { chatHistory: history, status: 'chat_replied' },
        });
      } catch (err) {
        console.error('[twilio webhook] failed to append chat history', err);
      }
    }
  }

  // For unmatched inbounds we still need a clientId to file under.
  // Without one we can't persist (FK NOT NULL). Skip persistence with
  // a console warn — orphan inbound from an unknown number.
  if (!matched) {
    console.warn('[twilio webhook] inbound from unknown number — dropped', {
      channel,
      from: from.replace(/.(?=.{4})/g, '*'), // mask all but last 4 digits in logs
    });
    return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response/>', {
      headers: { 'Content-Type': 'text/xml' },
    });
  }

  await recordInboundMessage({
    clientId: matched.clientId,
    portalUserId: matched.id,
    channel,
    from,
    to,
    body,
    mediaUrls,
    providerMessageId: params['MessageSid'],
    providerRaw: params,
    relatedRequestId,
  });

  // TwiML empty response — Twilio is happy with 200 + XML or 204.
  return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response/>', {
    headers: { 'Content-Type': 'text/xml' },
  });
}
