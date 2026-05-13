/**
 * Portal Messaging — orchestrator.
 *
 * Single entry point used by the rest of the codebase. Callers say
 * "notify this portal user that a new request is available" and the
 * orchestrator works out which channels they've opted into, sends to
 * each, and persists every attempt to portal_messages so the audit
 * trail on the related request shows what went out.
 *
 *   notifyPortalUser({
 *     portalUserId,
 *     body: 'A new request needs your input — open the portal here: …',
 *     relatedRequestId,
 *   })
 *
 * Returns a per-channel { ok, providerMessageId? } so the caller can
 * surface failures in the UI (e.g. "SMS bounced, retry?").
 *
 * Sends are best-effort and non-blocking: a Twilio outage shouldn't
 * stop the email going out. The orchestrator catches every error and
 * persists 'failed' rows so the firm can chase up unreliable channels.
 */

import { prisma } from '@/lib/db';
import {
  isTwilioConfigured,
  sendTwilioSms,
  sendTwilioWhatsApp,
} from './twilio';
import { isTelegramConfigured, sendTelegramMessage } from './telegram';
import {
  isSentDmConfigured,
  sendSentDmSms,
  sendSentDmWhatsApp,
} from './sent-dm';
import { isWeChatConfigured, sendWeChatMessage } from './wechat';
import type { MessageChannel, SendResult } from './types';

export type { MessageChannel } from './types';
export {
  isTwilioConfigured,
  verifyTwilioSignature,
} from './twilio';
export {
  isTelegramConfigured,
  verifyTelegramSecret,
  buildTelegramConnectUrl,
  telegramBotUsername,
} from './telegram';
export { isSentDmConfigured } from './sent-dm';
export {
  isWeChatConfigured,
  verifyWeChatSignature,
  parseWeChatXml,
  createWeChatLoginQr,
} from './wechat';

interface NotifyArgs {
  portalUserId: string;
  body: string;
  /** Optional mediaUrls forwarded to whichever channels support them. */
  mediaUrls?: string[];
  /** When set, every persisted portal_messages row is tagged with this
   *  PortalRequest id so the request UI can render a thread alongside
   *  the email history. */
  relatedRequestId?: string;
  /** Optional channel filter — defaults to every opted-in channel. */
  channels?: MessageChannel[];
}

interface NotifyResult {
  attempted: MessageChannel[];
  results: Partial<Record<MessageChannel, SendResult>>;
}

/**
 * Resolve a portal user, work out which channels they've opted into,
 * send across each, and log every attempt. The function never throws
 * — channel-level failures land in the returned results map and a
 * 'failed' portal_messages row.
 */
export async function notifyPortalUser(args: NotifyArgs): Promise<NotifyResult> {
  const user = await prisma.clientPortalUser.findUnique({
    where: { id: args.portalUserId },
    select: {
      id: true,
      clientId: true,
      whatsappNumber: true,
      whatsappOptIn: true,
      telegramChatId: true,
      telegramOptIn: true,
      smsNumber: true,
      smsOptIn: true,
      wechatOpenId: true,
      wechatOptIn: true,
    },
  });
  if (!user) {
    return { attempted: [], results: {} };
  }

  // Compute the active channel set as (filter ∩ opted-in ∩ has contact).
  const channels: MessageChannel[] = [];
  const filter = args.channels ? new Set(args.channels) : null;
  if ((!filter || filter.has('whatsapp')) && user.whatsappOptIn && user.whatsappNumber) {
    channels.push('whatsapp');
  }
  if ((!filter || filter.has('telegram')) && user.telegramOptIn && user.telegramChatId) {
    channels.push('telegram');
  }
  if ((!filter || filter.has('sms')) && user.smsOptIn && user.smsNumber) {
    channels.push('sms');
  }
  if ((!filter || filter.has('wechat')) && user.wechatOptIn && user.wechatOpenId) {
    channels.push('wechat');
  }

  const results: Partial<Record<MessageChannel, SendResult>> = {};
  for (const channel of channels) {
    let to = '';
    if (channel === 'whatsapp') to = user.whatsappNumber!;
    if (channel === 'telegram') to = user.telegramChatId!;
    if (channel === 'sms') to = user.smsNumber!;
    if (channel === 'wechat') to = user.wechatOpenId!;

    // SMS + WhatsApp go through sent.dm first (unified messaging API,
    // template-based) and fall back to Twilio on any failure so a
    // sent.dm template-not-approved / quota-exhausted incident doesn't
    // silently drop messages. Telegram remains direct Bot API — sent.dm
    // doesn't cover Telegram.
    let result: SendResult;
    let fallbackUsed = false;
    try {
      if (channel === 'sms') {
        const outbound = { channel, body: args.body, to, mediaUrls: args.mediaUrls };
        if (isSentDmConfigured()) {
          result = await sendSentDmSms(outbound);
          if (!result.ok && isTwilioConfigured()) {
            console.warn(`[messaging] sent.dm SMS failed (${result.error}); falling back to Twilio`);
            const fallback = await sendTwilioSms(outbound);
            if (fallback.ok) fallbackUsed = true;
            // Preserve the sent.dm error context on the providerRaw so
            // we can still see why the primary failed even after a
            // successful fallback.
            result = fallback.ok
              ? { ...fallback, providerRaw: { primary: result.providerRaw, fallback: fallback.providerRaw } }
              : { ok: false, error: `sent.dm: ${result.error}; twilio: ${fallback.error}` };
          }
        } else {
          result = isTwilioConfigured()
            ? await sendTwilioSms(outbound)
            : { ok: false, error: 'No SMS provider configured (need sent.dm or Twilio)' };
        }
      } else if (channel === 'whatsapp') {
        const outbound = { channel, body: args.body, to, mediaUrls: args.mediaUrls };
        if (isSentDmConfigured()) {
          result = await sendSentDmWhatsApp(outbound);
          if (!result.ok && isTwilioConfigured()) {
            console.warn(`[messaging] sent.dm WhatsApp failed (${result.error}); falling back to Twilio`);
            const fallback = await sendTwilioWhatsApp(outbound);
            if (fallback.ok) fallbackUsed = true;
            result = fallback.ok
              ? { ...fallback, providerRaw: { primary: result.providerRaw, fallback: fallback.providerRaw } }
              : { ok: false, error: `sent.dm: ${result.error}; twilio: ${fallback.error}` };
          }
        } else {
          result = isTwilioConfigured()
            ? await sendTwilioWhatsApp(outbound)
            : { ok: false, error: 'No WhatsApp provider configured (need sent.dm or Twilio)' };
        }
      } else if (channel === 'telegram') {
        result = isTelegramConfigured()
          ? await sendTelegramMessage({ channel, body: args.body, to, mediaUrls: args.mediaUrls })
          : { ok: false, error: 'Telegram not configured' };
      } else {
        // wechat — sends customer-service text via the bound OpenID.
        // Subject to WeChat's 48-hour-since-last-interaction rule;
        // failures land as 'failed' rows in portal_messages so the
        // firm can prompt the user to send any message to the Account
        // first.
        result = isWeChatConfigured()
          ? await sendWeChatMessage({ channel, body: args.body, to, mediaUrls: args.mediaUrls })
          : { ok: false, error: 'WeChat not configured' };
      }
    } catch (err: any) {
      result = { ok: false, error: err?.message || String(err) };
    }
    results[channel] = result;
    if (fallbackUsed) {
      // Tag the providerRaw so log readers can spot which channel
      // ran through the fallback. Doesn't affect the SendResult ok
      // flag — the message still got out.
      result.providerRaw = { ...(typeof result.providerRaw === 'object' && result.providerRaw ? result.providerRaw : {}), _fallback: 'twilio' };
    }

    // Persist the attempt regardless of success. Failed rows are
    // valuable for chasing up flaky channels and for re-send tooling.
    try {
      await prisma.portalMessage.create({
        data: {
          clientId: user.clientId,
          portalUserId: user.id,
          relatedRequestId: args.relatedRequestId ?? null,
          direction: 'outbound',
          channel,
          providerMessageId: result.providerMessageId ?? null,
          fromAddress: null,
          toAddress: to,
          body: args.body,
          mediaJson: args.mediaUrls?.length ? args.mediaUrls.map(url => ({ url })) : undefined,
          status: result.ok ? 'sent' : 'failed',
          errorMessage: result.ok ? null : (result.error || 'Unknown error'),
          providerRaw: (result.providerRaw as any) ?? undefined,
        },
      });
    } catch (logErr) {
      // Don't let a logging failure surface to the caller — the user-
      // visible behaviour is still "the message either sent or it
      // didn't". We do console.error so prod logs catch DB issues.
      console.error('[messaging] failed to persist portal_messages row', logErr);
    }
  }

  return { attempted: channels, results };
}

/**
 * Persist an inbound message. Called from the webhook handlers once
 * they've matched the from-address to a ClientPortalUser (or left
 * portalUserId null for unrecognised senders so the firm can triage).
 */
export async function recordInboundMessage(args: {
  clientId: string;
  portalUserId: string | null;
  channel: MessageChannel;
  from: string;
  to?: string;
  body: string;
  mediaUrls?: string[];
  providerMessageId?: string;
  providerRaw?: unknown;
  relatedRequestId?: string | null;
}): Promise<void> {
  await prisma.portalMessage.create({
    data: {
      clientId: args.clientId,
      portalUserId: args.portalUserId,
      relatedRequestId: args.relatedRequestId ?? null,
      direction: 'inbound',
      channel: args.channel,
      providerMessageId: args.providerMessageId ?? null,
      fromAddress: args.from,
      toAddress: args.to ?? null,
      body: args.body,
      mediaJson: args.mediaUrls?.length ? args.mediaUrls.map(url => ({ url })) : undefined,
      status: 'delivered',
      providerRaw: (args.providerRaw as any) ?? undefined,
    },
  });
}

/**
 * Find a portal user by an inbound from-address. Used by both Twilio
 * (SMS/WhatsApp) and Telegram webhooks to route a reply back to the
 * matching ClientPortalUser. Returns null when no user matches — the
 * webhook still records the message but with portalUserId=null so a
 * firm admin can triage.
 *
 * Phone numbers are normalised by stripping the `whatsapp:` prefix
 * Twilio adds before comparison. Telegram chat_ids are numeric and
 * compared verbatim.
 */
export async function findPortalUserByAddress(
  channel: MessageChannel,
  rawFrom: string,
): Promise<{ id: string; clientId: string } | null> {
  const from = rawFrom.replace(/^whatsapp:/, '').trim();
  if (channel === 'whatsapp') {
    return prisma.clientPortalUser.findFirst({ where: { whatsappNumber: from }, select: { id: true, clientId: true } });
  }
  if (channel === 'sms') {
    return prisma.clientPortalUser.findFirst({ where: { smsNumber: from }, select: { id: true, clientId: true } });
  }
  if (channel === 'telegram') {
    return prisma.clientPortalUser.findFirst({ where: { telegramChatId: from }, select: { id: true, clientId: true } });
  }
  // wechat — `from` is the user's OpenID.
  return prisma.clientPortalUser.findFirst({ where: { wechatOpenId: from }, select: { id: true, clientId: true } });
}

/**
 * Generate a one-time Telegram link code for a portal user. Valid for
 * 30 minutes — long enough for the user to switch to Telegram, open
 * the bot, and press Start; short enough that a leaked code can't be
 * reused indefinitely.
 *
 * Writing the code clears any previous unredeemed code on the user,
 * so the latest "Connect Telegram" click always wins.
 */
export async function generateTelegramLinkCode(portalUserId: string): Promise<string> {
  const code = randomCode();
  const expiresAt = new Date(Date.now() + 30 * 60_000);
  await prisma.clientPortalUser.update({
    where: { id: portalUserId },
    data: { telegramLinkCode: code, telegramLinkExpiresAt: expiresAt },
  });
  return code;
}

/**
 * Redeem a Telegram link code emitted by generateTelegramLinkCode().
 * Called by the bot webhook on `/start <code>`. Returns the matched
 * user id when the code is valid + unexpired, null otherwise.
 *
 * On success: link-code fields are cleared, chat_id is recorded, and
 * the telegram opt-in flag is turned on so subsequent sends target
 * this chat.
 */
export async function redeemTelegramLinkCode(args: {
  code: string;
  telegramChatId: string;
  telegramHandle?: string;
}): Promise<{ portalUserId: string; clientId: string } | null> {
  const user = await prisma.clientPortalUser.findUnique({
    where: { telegramLinkCode: args.code },
    select: { id: true, clientId: true, telegramLinkExpiresAt: true },
  });
  if (!user) return null;
  if (user.telegramLinkExpiresAt && user.telegramLinkExpiresAt < new Date()) {
    return null;
  }
  await prisma.clientPortalUser.update({
    where: { id: user.id },
    data: {
      telegramChatId: args.telegramChatId,
      telegramHandle: args.telegramHandle ?? undefined,
      telegramOptIn: true,
      telegramLinkCode: null,
      telegramLinkExpiresAt: null,
    },
  });
  return { portalUserId: user.id, clientId: user.clientId };
}

/**
 * Generate a one-time WeChat link code. The caller embeds it as the
 * `sceneStr` on a parametric QR; when the user scans + follows, the
 * Account's webhook fires with this code and the bound OpenID, at
 * which point redeemWeChatLinkCode() turns it into a persistent
 * binding. 30-minute expiry mirrors Telegram.
 */
export async function generateWeChatLinkCode(portalUserId: string): Promise<string> {
  const code = randomCode();
  const expiresAt = new Date(Date.now() + 30 * 60_000);
  await prisma.clientPortalUser.update({
    where: { id: portalUserId },
    data: { wechatLinkCode: code, wechatLinkExpiresAt: expiresAt },
  });
  return code;
}

/**
 * Resolve a WeChat `subscribe` / `SCAN` event's sceneStr to a portal
 * user and persist their OpenID. Called from the WeChat webhook.
 *
 * On success: link-code fields cleared, OpenID stored, wechatOptIn
 * flipped true, returns the bound user ids.
 */
export async function redeemWeChatLinkCode(args: {
  code: string;
  openId: string;
  nickname?: string;
}): Promise<{ portalUserId: string; clientId: string } | null> {
  const user = await prisma.clientPortalUser.findUnique({
    where: { wechatLinkCode: args.code },
    select: { id: true, clientId: true, wechatLinkExpiresAt: true },
  });
  if (!user) return null;
  if (user.wechatLinkExpiresAt && user.wechatLinkExpiresAt < new Date()) {
    return null;
  }
  await prisma.clientPortalUser.update({
    where: { id: user.id },
    data: {
      wechatOpenId: args.openId,
      wechatNickname: args.nickname ?? undefined,
      wechatOptIn: true,
      wechatLinkCode: null,
      wechatLinkExpiresAt: null,
    },
  });
  return { portalUserId: user.id, clientId: user.clientId };
}

function randomCode(): string {
  // 16 hex chars — opaque enough to resist guessing, short enough to
  // travel cleanly through a Telegram deep-link.
  const bytes = new Uint8Array(8);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { randomFillSync } = require('crypto');
    randomFillSync(bytes);
  }
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
