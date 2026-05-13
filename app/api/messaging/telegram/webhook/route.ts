/**
 * Telegram inbound webhook.
 *
 * Configure via Telegram's setWebhook:
 *   curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
 *        -d "url=https://<host>/api/messaging/telegram/webhook" \
 *        -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"
 *
 * Telegram echoes the secret in `X-Telegram-Bot-Api-Secret-Token` on
 * every push. We verify it before doing any DB writes.
 *
 * Two flows land here:
 *   1. /start <code> — the user just clicked the "Connect Telegram"
 *      deep-link. We resolve the one-time code to a ClientPortalUser
 *      and record their chat_id so subsequent outbound sends reach
 *      them.
 *   2. Any other text — a reply. We look up the user by chat_id and
 *      stitch the message to their most recent open request (mirrors
 *      the Twilio webhook).
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import {
  verifyTelegramSecret,
  isTelegramConfigured,
} from '@/lib/messaging/telegram';
import { getProviderConfig, type TelegramConfig } from '@/lib/messaging/provider-config';
import {
  findPortalUserByAddress,
  recordInboundMessage,
  redeemTelegramLinkCode,
} from '@/lib/messaging';

export const dynamic = 'force-dynamic';

interface TelegramUpdate {
  update_id?: number;
  message?: {
    message_id?: number;
    chat?: { id?: number; username?: string };
    from?: { id?: number; username?: string; first_name?: string };
    text?: string;
    document?: { file_id?: string; file_name?: string };
    photo?: Array<{ file_id?: string }>;
  };
}

export async function POST(req: NextRequest) {
  if (!(await isTelegramConfigured())) {
    return NextResponse.json({ ok: true }); // 200 so Telegram doesn't retry
  }

  const secret = req.headers.get('x-telegram-bot-api-secret-token');
  if (!(await verifyTelegramSecret(secret))) {
    console.warn('[telegram webhook] secret token mismatch');
    // 401 prompts Telegram to retry — once setWebhook is correct this
    // never fires; logging the rejection is enough for triage.
    return NextResponse.json({ error: 'Forbidden' }, { status: 401 });
  }

  let update: TelegramUpdate;
  try {
    update = await req.json();
  } catch {
    return NextResponse.json({ ok: true });
  }
  const msg = update.message;
  if (!msg) return NextResponse.json({ ok: true });

  const chatId = msg.chat?.id;
  if (typeof chatId !== 'number') return NextResponse.json({ ok: true });
  const chatIdStr = String(chatId);
  const text = msg.text || '';
  const handle = msg.from?.username ? '@' + msg.from.username : undefined;

  // Flow 1 — /start <code> handshake.
  const startMatch = text.match(/^\/start\s+(\S+)/i);
  if (startMatch) {
    const code = startMatch[1].trim();
    const result = await redeemTelegramLinkCode({
      code,
      telegramChatId: chatIdStr,
      telegramHandle: handle,
    });
    if (result) {
      // Confirm to the user inside Telegram so they know the link
      // worked. We don't fail the webhook if the send errors.
      const token = (await getProviderConfig<TelegramConfig>('telegram')).config.botToken!;
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: '✅ Your account is now linked. You\'ll receive portal request alerts here. Reply to any message to respond to the firm.',
        }),
      }).catch(() => {});
    } else {
      const token = (await getProviderConfig<TelegramConfig>('telegram')).config.botToken!;
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: 'That link is invalid or has expired. Please open the "Connect Telegram" link in the portal again to get a fresh one.',
        }),
      }).catch(() => {});
    }
    return NextResponse.json({ ok: true });
  }

  // Flow 2 — regular reply. Match to a portal user by chat_id.
  const matched = await findPortalUserByAddress('telegram', chatIdStr);
  if (!matched) {
    console.warn('[telegram webhook] inbound from unlinked chat_id — dropped', { chatIdStr });
    return NextResponse.json({ ok: true });
  }

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
        name: 'Client (via telegram)',
        message: text,
        timestamp: new Date().toISOString(),
        channel: 'telegram',
      });
      await prisma.portalRequest.update({
        where: { id: relatedRequestId },
        data: { chatHistory: history, status: 'chat_replied' },
      });
    } catch (err) {
      console.error('[telegram webhook] failed to append chat history', err);
    }
  }

  await recordInboundMessage({
    clientId: matched.clientId,
    portalUserId: matched.id,
    channel: 'telegram',
    from: chatIdStr,
    body: text,
    providerMessageId: msg.message_id ? String(msg.message_id) : undefined,
    providerRaw: update as any,
    relatedRequestId,
  });

  return NextResponse.json({ ok: true });
}
