/**
 * WeChat Official Account provider.
 *
 * Unlike SMS/WhatsApp/Telegram, WeChat doesn't expose a generic "send
 * a message to a phone number" API. Clients have to follow the firm's
 * Official Account (公众号) first; we then send via the customer-
 * service message API by OpenID. The user identifier is the OpenID,
 * which is per-Official-Account — the same person has different
 * OpenIDs on different accounts.
 *
 * Onboarding flow:
 *   1. Portal user clicks "Connect WeChat" — we mint a one-time
 *      `wechatLinkCode` and ask the WeChat API for a QR ticket with
 *      that code as the scene parameter.
 *   2. User scans the QR. If they're not already a follower, WeChat
 *      walks them through following the Official Account. Either
 *      way, the Account's webhook fires with an event of `subscribe`
 *      (new follower) or `SCAN` (existing follower) carrying both
 *      the user's OpenID and the scene code.
 *   3. Webhook handler binds OpenID → portal user via the link code,
 *      flips wechatOptIn = true.
 *   4. Subsequent sends use the customer-service message API with
 *      the bound OpenID.
 *
 * Note: the customer-service API has a 48-hour rolling window — you
 * can only send after the user has interacted with the Account in
 * the last 48 hours. For longer-running notifications, register a
 * template message and use the template-message API (each template
 * needs WeChat approval).
 *
 * Webhook signature scheme (from the WeChat docs):
 *   sort [token, timestamp, nonce] lexicographically, concatenate,
 *   sha1, compare to the `signature` query param.
 *
 * Env:
 *   WECHAT_APP_ID        — Official Account AppID
 *   WECHAT_APP_SECRET    — Official Account AppSecret
 *   WECHAT_TOKEN         — webhook verification token (set in dashboard)
 *   WECHAT_API_BASE      — optional override; defaults to api.weixin.qq.com
 *                          (use a mainland proxy when not deploying in CN)
 */

import crypto from 'crypto';
import type { OutboundMessage, SendResult } from './types';
import { getProviderConfig, type WeComConfig } from './provider-config';

const DEFAULT_API_BASE = 'https://api.weixin.qq.com';
async function apiBase(): Promise<string> {
  const { config } = await getProviderConfig<WeComConfig>('wecom');
  return (config.apiBase || DEFAULT_API_BASE).replace(/\/+$/, '');
}

export async function isWeChatConfigured(): Promise<boolean> {
  const { enabled, config } = await getProviderConfig<WeComConfig>('wecom');
  return enabled
    && !!config.corpId
    && !!config.appSecret
    && !!config.token;
}

// In-process access-token cache. WeChat issues a 2-hour token; we
// refresh 5 minutes before expiry. Stateless serverless invocations
// (Vercel) will re-fetch on a cold start, but the API allows up to
// 2,000 fetches/day per Account so we don't actually need a persistent
// cache for typical traffic — and skipping Redis keeps the deploy
// simpler. If usage scales up, move this to a DB cache.
let cachedToken: { token: string; expiresAt: number } | null = null;

async function fetchAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 5 * 60_000) {
    return cachedToken.token;
  }
  const { config } = await getProviderConfig<WeComConfig>('wecom');
  const appId = config.corpId;
  const appSecret = config.appSecret;
  if (!appId || !appSecret) throw new Error('WeCom corpId + appSecret not set');
  const url = `${await apiBase()}/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(appId)}&secret=${encodeURIComponent(appSecret)}`;
  const res = await fetch(url);
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || !json?.access_token) {
    throw new Error(`WeChat token fetch failed: ${json?.errmsg || res.status}`);
  }
  const expiresIn = Number(json.expires_in) || 7200;
  cachedToken = { token: json.access_token, expiresAt: now + expiresIn * 1000 };
  return cachedToken.token;
}

/**
 * Send a customer-service text message to a WeChat OpenID. Subject
 * to the 48-hour-since-last-user-interaction rule.
 *
 *   https://developers.weixin.qq.com/doc/offiaccount/Message_Management/Service_Center_messages.html
 */
export async function sendWeChatMessage(msg: OutboundMessage): Promise<SendResult> {
  try {
    if (!/^[A-Za-z0-9_-]{20,}$/.test(msg.to)) {
      return { ok: false, error: 'WeChat recipient must be an OpenID — link the user via the Connect WeChat flow first.' };
    }
    const token = await fetchAccessToken();
    const url = `${await apiBase()}/cgi-bin/message/custom/send?access_token=${encodeURIComponent(token)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      // WeChat insists on UTF-8 with no escape on Chinese characters;
      // JSON.stringify is fine — we just need to NOT use ascii-safe
      // encoders. Body shape per the customer-service docs.
      body: JSON.stringify({
        touser: msg.to,
        msgtype: 'text',
        text: { content: msg.body.slice(0, 600) },
      }),
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok || (json?.errcode && json.errcode !== 0)) {
      return { ok: false, error: json?.errmsg || `HTTP ${res.status}`, providerRaw: json };
    }
    return {
      ok: true,
      providerMessageId: typeof json?.msgid === 'string' || typeof json?.msgid === 'number'
        ? String(json.msgid) : undefined,
      providerRaw: json,
    };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
}

/**
 * Mint a temporary QR ticket the portal user can scan to follow the
 * Official Account and bind their OpenID to our `sceneStr` (the
 * one-time link code we stored on ClientPortalUser).
 *
 * Returns the QR-image URL the UI can render. WeChat hosts the
 * image so we don't need to generate one ourselves.
 *
 *   https://developers.weixin.qq.com/doc/offiaccount/Account_Management/Generating_a_Parametric_QR_Code.html
 *
 * `expireSeconds` clamped to WeChat's max of 2,592,000s (30 days);
 * we typically pass 30 minutes so a leaked QR can't be reused.
 */
export async function createWeChatLoginQr(args: {
  sceneStr: string;
  expireSeconds: number;
}): Promise<{ ticket: string; qrUrl: string; expiresAt: Date }> {
  const token = await fetchAccessToken();
  const url = `${await apiBase()}/cgi-bin/qrcode/create?access_token=${encodeURIComponent(token)}`;
  const clamped = Math.min(2_592_000, Math.max(60, Math.floor(args.expireSeconds)));
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      expire_seconds: clamped,
      action_name: 'QR_STR_SCENE',
      action_info: { scene: { scene_str: args.sceneStr } },
    }),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || !json?.ticket) {
    throw new Error(`WeChat QR ticket fetch failed: ${json?.errmsg || res.status}`);
  }
  return {
    ticket: json.ticket,
    qrUrl: `https://mp.weixin.qq.com/cgi-bin/showqrcode?ticket=${encodeURIComponent(json.ticket)}`,
    expiresAt: new Date(Date.now() + clamped * 1000),
  };
}

/**
 * Verify the signature WeChat puts on every webhook request. Used
 * both for the initial GET handshake (echo back `echostr`) and for
 * every subsequent POST.
 *
 * Algorithm: sha1(sort([token, timestamp, nonce]).join('')) === signature.
 */
export async function verifyWeChatSignature(args: {
  signature: string;
  timestamp: string;
  nonce: string;
  token?: string;
}): Promise<boolean> {
  let token = args.token;
  if (!token) {
    const { config } = await getProviderConfig<WeComConfig>('wecom');
    token = config.token;
  }
  if (!token) return false;
  const parts = [token, String(args.timestamp), String(args.nonce)].sort();
  const expected = crypto.createHash('sha1').update(parts.join('')).digest('hex');
  try {
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(args.signature, 'utf8');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Minimal WeChat XML parser. Inbound webhooks come as `<xml>…</xml>`
 * with one level of children. We only need a handful of tags so a
 * regex-based parser is plenty — avoids pulling in a dependency for
 * a tiny payload.
 */
export function parseWeChatXml(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /<(\w+)>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([\s\S]*?))<\/\1>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    out[m[1]] = (m[2] ?? m[3] ?? '').trim();
  }
  return out;
}
