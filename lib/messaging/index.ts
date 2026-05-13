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
import { isWeComConfigured, isWeComRobotConfigured, sendWeComGroupMessage } from './wecom';
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
export {
  isWeComConfigured,
  isWeComRobotConfigured,
  isWeComAppConfigured,
  isWeComExternalContactConfigured,
  getWeComMode,
  sendWeComGroupMessage,
  sendWeComAppMessage,
  createWeComExternalContactWay,
  sendWeComWelcomeMessage,
  sendWeComExternalTemplate,
} from './wecom';

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
      preferredCommunicationChannel: true,
    },
  });
  if (!user) {
    return { attempted: [], results: {} };
  }

  // Single-select preferred channel — the radio button on the user's
  // /portal/my-details page drives this. Fallback when null is
  // 'email' (a no-op here — email is sent by the request creator,
  // not by this orchestrator). 'none' explicitly suppresses chat
  // notifications entirely.
  const pref = user.preferredCommunicationChannel || 'email';
  const channels: MessageChannel[] = [];

  // Filter (args.channels) lets callers force a specific channel
  // regardless of preference (e.g. a "send a test WhatsApp" admin
  // action). When the filter excludes the user's preferred channel
  // we fall back to fanning out to every channel the user has the
  // contact for + opted in to — mirrors the pre-preference
  // behaviour. Without an args.channels filter we just send to the
  // single preferred channel.
  const filter = args.channels ? new Set(args.channels) : null;
  if (filter) {
    if (filter.has('whatsapp') && user.whatsappOptIn && user.whatsappNumber) channels.push('whatsapp');
    if (filter.has('telegram') && user.telegramOptIn && user.telegramChatId) channels.push('telegram');
    if (filter.has('sms') && user.smsOptIn && user.smsNumber) channels.push('sms');
    if (filter.has('wechat') && user.wechatOptIn && user.wechatOpenId) channels.push('wechat');
  } else {
    // Single-channel mode driven by the user's preference. We still
    // require the contact value to be present — otherwise the send
    // would error immediately. When the contact is missing we log a
    // 'failed' portal_messages row with a helpful error so the firm
    // can prompt the user to complete setup.
    if (pref === 'whatsapp' && user.whatsappNumber) channels.push('whatsapp');
    else if (pref === 'telegram' && user.telegramChatId) channels.push('telegram');
    else if (pref === 'sms' && user.smsNumber) channels.push('sms');
    else if (pref === 'wechat' && user.wechatOpenId) channels.push('wechat');
    // pref === 'email' / 'none' / null with no contact → channels stays
    // empty. notifyPortalUser's caller fires email separately so the
    // user still gets reached; 'none' is the explicit opt-out.
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
    // Resolve configured flags up front so the branch below stays
    // sync-looking. Avoids `await` inside each if-check making the
    // logic harder to read.
    const [twilioOn, sentDmOn, telegramOn, wecomRobotOn, wechatOaOn] = await Promise.all([
      isTwilioConfigured(),
      isSentDmConfigured(),
      isTelegramConfigured(),
      isWeComRobotConfigured(),
      isWeChatConfigured(),
    ]);
    try {
      if (channel === 'sms') {
        const outbound = { channel, body: args.body, to, mediaUrls: args.mediaUrls };
        if (sentDmOn) {
          result = await sendSentDmSms(outbound);
          if (!result.ok && twilioOn) {
            console.warn(`[messaging] sent.dm SMS failed (${result.error}); falling back to Twilio`);
            const fallback = await sendTwilioSms(outbound);
            if (fallback.ok) fallbackUsed = true;
            result = fallback.ok
              ? { ...fallback, providerRaw: { primary: result.providerRaw, fallback: fallback.providerRaw } }
              : { ok: false, error: `sent.dm: ${result.error}; twilio: ${fallback.error}` };
          }
        } else {
          result = twilioOn
            ? await sendTwilioSms(outbound)
            : { ok: false, error: 'No SMS provider configured (need sent.dm or Twilio)' };
        }
      } else if (channel === 'whatsapp') {
        const outbound = { channel, body: args.body, to, mediaUrls: args.mediaUrls };
        if (sentDmOn) {
          result = await sendSentDmWhatsApp(outbound);
          if (!result.ok && twilioOn) {
            console.warn(`[messaging] sent.dm WhatsApp failed (${result.error}); falling back to Twilio`);
            const fallback = await sendTwilioWhatsApp(outbound);
            if (fallback.ok) fallbackUsed = true;
            result = fallback.ok
              ? { ...fallback, providerRaw: { primary: result.providerRaw, fallback: fallback.providerRaw } }
              : { ok: false, error: `sent.dm: ${result.error}; twilio: ${fallback.error}` };
          }
        } else {
          result = twilioOn
            ? await sendTwilioWhatsApp(outbound)
            : { ok: false, error: 'No WhatsApp provider configured (need sent.dm or Twilio)' };
        }
      } else if (channel === 'telegram') {
        result = telegramOn
          ? await sendTelegramMessage({ channel, body: args.body, to, mediaUrls: args.mediaUrls })
          : { ok: false, error: 'Telegram not configured' };
      } else {
        // wechat channel — provider priority:
        //   1. WeCom Group Robot if WECOM_GROUP_WEBHOOK_URL is set.
        //      POSTs to a fixed group webhook so every linked client
        //      in that group sees the message. No per-user binding
        //      needed; works on the free WeCom tier and doesn't
        //      require a mainland Chinese phone for setup.
        //   2. WeChat Official Account customer-service text via the
        //      bound OpenID (subject to the 48h rule).
        //   3. Failed with a friendly error if neither is configured.
        // WeCom takes precedence because it's the path most UK firms
        // can actually onboard without a mainland phone number.
        if (wecomRobotOn) {
          result = await sendWeComGroupMessage({ channel, body: args.body, to, mediaUrls: args.mediaUrls });
        } else if (wechatOaOn) {
          result = await sendWeChatMessage({ channel, body: args.body, to, mediaUrls: args.mediaUrls });
        } else {
          result = { ok: false, error: 'Neither WeCom nor WeChat Official Account configured' };
        }
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
 * Generate a one-time WeCom Pro bind code for the External Contact
 * flow. The caller passes it as the `state` parameter on a Contact
 * Way QR; WeCom echoes it back in the change_external_contact
 * webhook so we can match the inbound external_userid to this portal
 * user. 30-minute TTL.
 *
 * Used by the Pro mode of /api/portal/messaging-channels/wechat-link.
 * The Group Robot / Official Account modes use generateWeChatLinkCode
 * below (which targets the OA webhook flow instead).
 */
export async function generateWeComBindCode(portalUserId: string): Promise<string> {
  const code = randomCode();
  const expiresAt = new Date(Date.now() + 30 * 60_000);
  await prisma.clientPortalUser.update({
    where: { id: portalUserId },
    data: { wecomBindCode: code, wecomBindCodeExpiresAt: expiresAt },
  });
  return code;
}

/**
 * Redeem a WeCom Pro bind code via the change_external_contact
 * webhook. Persists the external_userid against the portal user,
 * flips wechatOptIn true so notifyPortalUser can pick the WeChat
 * channel, and clears the one-time code so it can't be re-redeemed.
 *
 * Returns the matched portal user when successful, null otherwise
 * (expired code, no match — webhook caller logs but doesn't
 * surface this to WeCom).
 */
export async function redeemWeComBindCode(args: {
  code: string;
  externalUserId: string;
  nickname?: string;
  configId?: string;
}): Promise<{ portalUserId: string; clientId: string } | null> {
  const user = await prisma.clientPortalUser.findUnique({
    where: { wecomBindCode: args.code },
    select: { id: true, clientId: true, wecomBindCodeExpiresAt: true },
  });
  if (!user) return null;
  if (user.wecomBindCodeExpiresAt && user.wecomBindCodeExpiresAt < new Date()) {
    return null;
  }
  await prisma.clientPortalUser.update({
    where: { id: user.id },
    data: {
      wecomExternalUserId: args.externalUserId,
      wechatNickname: args.nickname ?? undefined,
      wechatOptIn: true,
      wecomConfigId: args.configId ?? undefined,
      wecomBindCode: null,
      wecomBindCodeExpiresAt: null,
    },
  });
  return { portalUserId: user.id, clientId: user.clientId };
}

/**
 * When a client deletes the firm employee from their WeChat (or the
 * employee deletes them), WeCom fires `del_external_contact` /
 * `del_follow_user`. We clear the bound external_userid so future
 * notifications fall back to email / portal-only. The historical
 * portal_messages rows stay intact for the audit trail.
 */
export async function unbindWeComExternalUser(externalUserId: string): Promise<void> {
  await prisma.clientPortalUser.updateMany({
    where: { wecomExternalUserId: externalUserId },
    data: { wecomExternalUserId: null, wechatNickname: null },
  });
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
