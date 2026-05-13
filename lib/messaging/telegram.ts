/**
 * Telegram Bot provider.
 *
 * The Telegram Bot API is free + has no per-message quota for normal
 * accounts. Each firm-side bot has one BotFather token; users link
 * their Telegram account to a portal user by opening a deep-link
 *   https://t.me/<bot_username>?start=<one_time_code>
 * The bot's webhook receives `/start <code>` as the first message,
 * matches it to a ClientPortalUser by `telegramLinkCode`, and stores
 * the chat_id on the user row so subsequent sends can target them
 * directly.
 *
 * Outbound sends use sendMessage with parse_mode='HTML' so we can
 * embed clickable links back into the portal.
 *
 * Inbound verification: we set `secret_token` on setWebhook; Telegram
 * echoes it back in `X-Telegram-Bot-Api-Secret-Token` on every push,
 * so a constant-time compare keeps spoofers out without HMAC.
 */

import type { OutboundMessage, SendResult } from './types';
import { getProviderConfig, type TelegramConfig } from './provider-config';

async function getToken(): Promise<string> {
  const { config } = await getProviderConfig<TelegramConfig>('telegram');
  if (!config.botToken) {
    throw new Error('Telegram is not configured: set credentials in SuperAdmin → Messaging Providers or via TELEGRAM_BOT_TOKEN.');
  }
  return config.botToken;
}

/** True when the bot token is configured. Async — DB-first via the
 *  provider-config layer, env-fallback. */
export async function isTelegramConfigured(): Promise<boolean> {
  const { enabled, config } = await getProviderConfig<TelegramConfig>('telegram');
  return enabled && !!config.botToken;
}

/** Bot's public @username — required to build deep-links for the
 *  "Connect Telegram" UX. Falls back to undefined when not set;
 *  callers should show a friendly "Telegram not yet enabled" hint. */
export async function telegramBotUsername(): Promise<string | undefined> {
  const { config } = await getProviderConfig<TelegramConfig>('telegram');
  return config.botUsername || undefined;
}

/**
 * Build the deep-link a portal user opens to connect their Telegram
 * account. `code` is the one-time link code we wrote to
 * client_portal_users.telegram_link_code; the bot's webhook resolves
 * it on /start.
 */
export async function buildTelegramConnectUrl(code: string): Promise<string | undefined> {
  const username = await telegramBotUsername();
  if (!username) return undefined;
  return `https://t.me/${username}?start=${encodeURIComponent(code)}`;
}

/**
 * Send a text message to a Telegram chat_id. `to` must be the numeric
 * chat_id we captured from the /start handshake; '@username' is not
 * supported on personal accounts.
 *
 * Media: Telegram requires a separate API per media kind (sendPhoto /
 * sendDocument). We POST a sendMessage first, then loop over mediaUrls
 * with sendDocument so attachments arrive in the same conversation.
 */
export async function sendTelegramMessage(msg: OutboundMessage): Promise<SendResult> {
  try {
    const token = await getToken();
    const chatId = msg.to;
    if (!/^-?\d+$/.test(chatId)) {
      return { ok: false, error: 'Telegram chat_id must be numeric — link the user via /start first.' };
    }

    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: msg.body,
        parse_mode: 'HTML',
        disable_web_page_preview: false,
      }),
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok || !json?.ok) {
      return { ok: false, error: json?.description || `HTTP ${res.status}`, providerRaw: json };
    }
    const providerMessageId = json?.result?.message_id ? String(json.result.message_id) : undefined;

    // Best-effort media attachment. Failures are non-fatal — the
    // textual message has already gone out.
    if (msg.mediaUrls?.length) {
      for (const url of msg.mediaUrls) {
        await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, document: url }),
        }).catch(() => {});
      }
    }

    return { ok: true, providerMessageId, providerRaw: json };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
}

/**
 * Verify the secret token on an inbound Telegram webhook. Telegram
 * echoes the value we set on setWebhook in
 * `X-Telegram-Bot-Api-Secret-Token`; comparing constant-time keeps
 * spoofers out without HMAC.
 */
export async function verifyTelegramSecret(headerValue: string | null | undefined): Promise<boolean> {
  const { config } = await getProviderConfig<TelegramConfig>('telegram');
  const expected = config.webhookSecret;
  if (!expected) return false;
  if (!headerValue) return false;
  if (headerValue.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ headerValue.charCodeAt(i);
  }
  return diff === 0;
}
