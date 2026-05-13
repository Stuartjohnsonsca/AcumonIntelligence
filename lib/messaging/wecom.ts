/**
 * WeCom (企业微信 / WeChat Work) provider.
 *
 * Two patterns we support:
 *
 *  1. Group Robot webhook (recommended for v1).
 *     Each WeCom group chat can have a "robot" with a fixed webhook
 *     URL. POSTing JSON to it drops a message into the group — same
 *     shape as Microsoft Teams Incoming Webhooks. No access-token
 *     management, no per-user OpenID binding; the group's members
 *     (including external WeChat clients you've added) see the post.
 *
 *  2. App Message API (internal users only).
 *     For the audit firm's own staff. Uses an access token + UserID.
 *     Implemented behind isWeComAppConfigured() for completeness;
 *     the orchestrator only switches it on when the firm explicitly
 *     sets up an internal-app channel.
 *
 * For consumer clients (the mainland-China + SE-Asia audit-firm case
 * that drove the WeChat work) Group Robot is the practical path —
 * clients use WeChat, the audit firm uses WeCom, the two interop
 * through External Contacts which sit in groups together with the
 * robot.
 *
 *   https://developer.work.weixin.qq.com/document/path/91770  (Group Robot)
 *   https://developer.work.weixin.qq.com/document/path/90235  (App Message)
 */

import type { OutboundMessage, SendResult } from './types';

/** True when at least one WeCom path is configured. The orchestrator
 *  uses this to decide whether the `wechat` channel can route via
 *  WeCom at all. Individual paths have their own readiness checks. */
export function isWeComConfigured(): boolean {
  return isWeComRobotConfigured() || isWeComAppConfigured();
}

/** Firm-wide default Group Robot webhook URL. Used when an engagement
 *  hasn't set its own. Optional — most setups will configure a
 *  per-engagement URL on Monitoring Reports / Portal Principal Setup
 *  rather than a global one. */
export function isWeComRobotConfigured(): boolean {
  return !!process.env.WECOM_GROUP_WEBHOOK_URL;
}

/** Internal App Message path — for sending to the firm's own WeCom
 *  users. Out-of-scope for client-portal v1 but plumbed so it's a
 *  short follow-up when the firm wants it. */
export function isWeComAppConfigured(): boolean {
  return !!process.env.WECOM_CORP_ID
    && !!process.env.WECOM_AGENT_ID
    && !!process.env.WECOM_APP_SECRET;
}

/**
 * Send a text message to a WeCom Group Robot via its webhook URL.
 *
 * `msg.to` carries the webhook URL when called from the orchestrator
 * with a per-engagement override; otherwise we fall back to
 * WECOM_GROUP_WEBHOOK_URL. Both forms are HTTPS URLs WeCom hosts on
 * qyapi.weixin.qq.com and start with /cgi-bin/webhook/send?key=...
 */
export async function sendWeComGroupMessage(msg: OutboundMessage & {
  /** Optional override; ignored when msg.to is already a webhook URL. */
  webhookUrl?: string;
}): Promise<SendResult> {
  try {
    // `to` may carry an OpenID (legacy from the OA provider) or a
    // webhook URL. Detect by HTTPS prefix. When it's not a URL we
    // fall back to the env default — the orchestrator passes the
    // user's `wechatOpenId` field as `to`, which for WeCom-only
    // setups will typically be unset, so the env URL becomes the
    // operative target.
    const webhookUrl = (msg.webhookUrl || (msg.to.startsWith('https://') ? msg.to : '') || process.env.WECOM_GROUP_WEBHOOK_URL || '').trim();
    if (!webhookUrl) {
      return { ok: false, error: 'No WeCom group webhook URL configured (set WECOM_GROUP_WEBHOOK_URL or pass webhookUrl).' };
    }
    if (!/^https:\/\/qyapi\.weixin\.qq\.com\/.+key=/.test(webhookUrl)) {
      return { ok: false, error: 'WeCom webhook URL looks wrong — expected https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...' };
    }

    // Group robot text message. 4,096-byte cap on `content` per Tencent
    // docs; we trim defensively. Markdown (`msgtype: 'markdown'`) is
    // an option if the team wants richer formatting later — for now
    // plain text avoids "** does not render" surprises.
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        msgtype: 'text',
        text: { content: (msg.body || '').slice(0, 3800) },
      }),
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok || (json?.errcode && json.errcode !== 0)) {
      return { ok: false, error: json?.errmsg || `HTTP ${res.status}`, providerRaw: json };
    }
    // Group robot responses don't include a message-id. We tag the
    // providerRaw with the request URL host so log readers can tell
    // it routed via WeCom — useful when sent.dm / Twilio / WeCom
    // all appear in the same audit trail.
    return { ok: true, providerRaw: { ...json, _via: 'wecom-group-robot' } };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
}

// ── WeCom App Message (internal users only) ─────────────────────────
//
// Stubbed for now: cached access-token + send-message scaffolding so
// the orchestrator can call it when the firm opts into the App Message
// path. Per-user UserIDs come from the WeCom address book; outside the
// scope of consumer-client portal notifications.

let cachedAppToken: { token: string; expiresAt: number } | null = null;

async function fetchAppAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedAppToken && cachedAppToken.expiresAt > now + 5 * 60_000) {
    return cachedAppToken.token;
  }
  const corpId = process.env.WECOM_CORP_ID;
  const secret = process.env.WECOM_APP_SECRET;
  if (!corpId || !secret) throw new Error('WECOM_CORP_ID + WECOM_APP_SECRET not set');
  const url = `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${encodeURIComponent(corpId)}&corpsecret=${encodeURIComponent(secret)}`;
  const res = await fetch(url);
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || !json?.access_token) {
    throw new Error(`WeCom token fetch failed: ${json?.errmsg || res.status}`);
  }
  const expiresIn = Number(json.expires_in) || 7200;
  cachedAppToken = { token: json.access_token, expiresAt: now + expiresIn * 1000 };
  return cachedAppToken.token;
}

/**
 * Send a text app-message to an internal WeCom user (UserID). Used
 * when the firm wires up an internal app for staff notifications.
 * Not the client-portal path.
 */
export async function sendWeComAppMessage(args: {
  toUser: string;
  body: string;
}): Promise<SendResult> {
  try {
    const agentId = process.env.WECOM_AGENT_ID;
    if (!agentId) return { ok: false, error: 'WECOM_AGENT_ID not set' };
    const token = await fetchAppAccessToken();
    const res = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        touser: args.toUser,
        msgtype: 'text',
        agentid: Number(agentId),
        text: { content: (args.body || '').slice(0, 2000) },
      }),
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok || (json?.errcode && json.errcode !== 0)) {
      return { ok: false, error: json?.errmsg || `HTTP ${res.status}`, providerRaw: json };
    }
    return { ok: true, providerRaw: { ...json, _via: 'wecom-app' } };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
}
