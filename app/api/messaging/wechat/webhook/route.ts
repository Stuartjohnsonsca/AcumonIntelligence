/**
 * WeChat Official Account webhook.
 *
 * Configure in the WeChat dashboard:
 *   - Server URL: https://<host>/api/messaging/wechat/webhook
 *   - Token: matches WECHAT_TOKEN env var
 *   - Message format: XML (plaintext)
 *
 * Two phases:
 *   1. GET — initial handshake. WeChat sends ?signature=&timestamp=
 *      &nonce=&echostr=. We verify the signature and echo `echostr`
 *      back as plain text. The dashboard refuses to save the URL
 *      until this round-trip succeeds.
 *   2. POST — every inbound event. Body is XML. We care about:
 *        • event=subscribe (new follower, with EventKey=qrscene_<code>)
 *        • event=SCAN (existing follower scanned a parametric QR,
 *          EventKey=<code>)
 *        • text messages — appended to the most recent open
 *          PortalRequest's chat history when the OpenID resolves to
 *          a portal user, so the firm-side sees the reply.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import {
  verifyWeChatSignature,
  parseWeChatXml,
  isWeChatConfigured,
} from '@/lib/messaging/wechat';
import {
  redeemWeChatLinkCode,
  findPortalUserByAddress,
  recordInboundMessage,
} from '@/lib/messaging';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!(await isWeChatConfigured())) {
    return new NextResponse('not configured', { status: 503 });
  }
  const url = new URL(req.url);
  const signature = url.searchParams.get('signature') || '';
  const timestamp = url.searchParams.get('timestamp') || '';
  const nonce = url.searchParams.get('nonce') || '';
  const echostr = url.searchParams.get('echostr') || '';
  if (!(await verifyWeChatSignature({ signature, timestamp, nonce }))) {
    console.warn('[wechat webhook] signature mismatch on handshake');
    return new NextResponse('forbidden', { status: 403 });
  }
  // WeChat expects the plain echostr body — no JSON, no quotes.
  return new NextResponse(echostr, { status: 200, headers: { 'Content-Type': 'text/plain' } });
}

export async function POST(req: NextRequest) {
  if (!(await isWeChatConfigured())) {
    return new NextResponse('not configured', { status: 503 });
  }
  // Even on POST WeChat appends the signature query params for every
  // request. Verify before doing anything.
  const url = new URL(req.url);
  const signature = url.searchParams.get('signature') || '';
  const timestamp = url.searchParams.get('timestamp') || '';
  const nonce = url.searchParams.get('nonce') || '';
  if (!(await verifyWeChatSignature({ signature, timestamp, nonce }))) {
    console.warn('[wechat webhook] signature mismatch on POST');
    return new NextResponse('forbidden', { status: 403 });
  }

  const body = await req.text();
  const payload = parseWeChatXml(body);
  const openId = payload['FromUserName'] || '';
  const event = payload['Event'] || '';
  const msgType = payload['MsgType'] || '';

  // Scan / subscribe — bind OpenID to portal user via the scene code.
  // subscribe brings EventKey=qrscene_<code>; SCAN brings EventKey=<code>.
  if (msgType === 'event' && (event === 'subscribe' || event === 'SCAN')) {
    const eventKey = payload['EventKey'] || '';
    const code = eventKey.replace(/^qrscene_/, '').trim();
    if (code && openId) {
      const result = await redeemWeChatLinkCode({ code, openId });
      if (result) {
        // Reply with a confirmation message so the user sees the
        // link worked. We respond inline with a text message — the
        // WeChat docs call this "passive reply".
        return new NextResponse(buildTextReply(openId, payload['ToUserName'] || '',
          '✅ Your portal account is now linked. You\'ll receive request alerts here. Reply to any message to respond to the firm.'),
          { headers: { 'Content-Type': 'application/xml' } });
      }
      return new NextResponse(buildTextReply(openId, payload['ToUserName'] || '',
        'That link is invalid or expired. Open the "Connect WeChat" link in the portal again to generate a fresh QR.'),
        { headers: { 'Content-Type': 'application/xml' } });
    }
    // No scene code (user found the Account some other way) — fall
    // through to the standard "empty reply" path so WeChat doesn't
    // retry. The Account's auto-reply settings handle these in the
    // dashboard.
    return new NextResponse('', { status: 200 });
  }

  // Regular text reply — append to the user's open request and ack.
  if (msgType === 'text' && openId) {
    const matched = await findPortalUserByAddress('wechat', openId);
    if (!matched) {
      console.warn('[wechat webhook] text from unbound openId — dropped');
      return new NextResponse('', { status: 200 });
    }
    const text = payload['Content'] || '';
    let relatedRequestId: string | null = null;
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

    if (relatedRequestId && text) {
      try {
        const existing = await prisma.portalRequest.findUnique({
          where: { id: relatedRequestId },
          select: { chatHistory: true },
        });
        const history = Array.isArray(existing?.chatHistory) ? (existing!.chatHistory as any[]) : [];
        history.push({
          from: 'client',
          name: 'Client (via wechat)',
          message: text,
          timestamp: new Date().toISOString(),
          channel: 'wechat',
        });
        await prisma.portalRequest.update({
          where: { id: relatedRequestId },
          data: { chatHistory: history, status: 'chat_replied' },
        });
      } catch (err) {
        console.error('[wechat webhook] failed to append chat history', err);
      }
    }

    await recordInboundMessage({
      clientId: matched.clientId,
      portalUserId: matched.id,
      channel: 'wechat',
      from: openId,
      body: text,
      providerMessageId: payload['MsgId'] || undefined,
      providerRaw: payload,
      relatedRequestId,
    });
  }

  // Empty 200 tells WeChat "we got it, no passive reply" — same
  // semantics as the Twilio empty TwiML response.
  return new NextResponse('', { status: 200 });
}

/**
 * Build a WeChat passive-reply XML envelope. WeChat's contract:
 * within 5s of receiving a webhook the server may return an XML
 * response that becomes a message back to the user. Larger / async
 * sends go via the customer-service API instead.
 */
function buildTextReply(toUser: string, fromUser: string, content: string): string {
  const ts = Math.floor(Date.now() / 1000);
  return [
    '<xml>',
    `<ToUserName><![CDATA[${escapeCdata(toUser)}]]></ToUserName>`,
    `<FromUserName><![CDATA[${escapeCdata(fromUser)}]]></FromUserName>`,
    `<CreateTime>${ts}</CreateTime>`,
    '<MsgType><![CDATA[text]]></MsgType>',
    `<Content><![CDATA[${escapeCdata(content)}]]></Content>`,
    '</xml>',
  ].join('');
}

function escapeCdata(s: string): string {
  // CDATA forbids the closing sequence — split it across two CDATA
  // sections if the rare case crops up. Otherwise nothing else needs
  // escaping inside CDATA.
  return s.replace(/]]>/g, ']]]]><![CDATA[>');
}
