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
import { getProviderConfig, type WeComConfig } from './provider-config';

/** True when at least one WeCom path is configured. */
export async function isWeComConfigured(): Promise<boolean> {
  return (await isWeComRobotConfigured()) || (await isWeComAppConfigured());
}

/** Group Robot webhook URL (firm-wide default). */
export async function isWeComRobotConfigured(): Promise<boolean> {
  const { enabled, config } = await getProviderConfig<WeComConfig>('wecom');
  return enabled && !!config.groupWebhookUrl;
}

/** Internal / Pro App Message path. */
export async function isWeComAppConfigured(): Promise<boolean> {
  const { enabled, config } = await getProviderConfig<WeComConfig>('wecom');
  return enabled && !!config.corpId && !!config.agentId && !!config.appSecret;
}

/** WeCom Pro External Contact path — requires External Contact
 *  secret (or App secret fallback) on top of basic creds, and the
 *  SuperAdmin must have selected the external-contact-pro mode. */
export async function isWeComExternalContactConfigured(): Promise<boolean> {
  const { enabled, config } = await getProviderConfig<WeComConfig>('wecom');
  return enabled
    && config.mode === 'external_contact_pro'
    && !!config.corpId
    && !!(config.externalContactSecret || config.appSecret);
}

/** Which WeCom mode is selected by the SuperAdmin. */
export async function getWeComMode(): Promise<'group_robot' | 'external_contact_pro'> {
  const { config } = await getProviderConfig<WeComConfig>('wecom');
  return config.mode === 'external_contact_pro' ? 'external_contact_pro' : 'group_robot';
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
    const { config } = await getProviderConfig<WeComConfig>('wecom');
    const webhookUrl = (msg.webhookUrl || (msg.to.startsWith('https://') ? msg.to : '') || config.groupWebhookUrl || '').trim();
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

async function fetchAppAccessToken(options: { useExternalContactSecret?: boolean } = {}): Promise<string> {
  const now = Date.now();
  if (cachedAppToken && cachedAppToken.expiresAt > now + 5 * 60_000) {
    return cachedAppToken.token;
  }
  const { config } = await getProviderConfig<WeComConfig>('wecom');
  const corpId = config.corpId;
  // External Contact API needs its own secret (configured separately
  // in the WeCom dashboard). If the caller asked for that path but
  // it isn't set, fall back to the main app secret so legacy setups
  // still work — but log a warning so the operator knows.
  const secret = options.useExternalContactSecret
    ? (config.externalContactSecret || config.appSecret)
    : config.appSecret;
  if (!corpId || !secret) throw new Error('WeCom corpId + appSecret not set');
  if (options.useExternalContactSecret && !config.externalContactSecret) {
    console.warn('[wecom] external-contact path using app secret; configure externalContactSecret for separate scoping.');
  }
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
    const { config } = await getProviderConfig<WeComConfig>('wecom');
    const agentId = config.agentId;
    if (!agentId) return { ok: false, error: 'WeCom agentId not set' };
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

// ── WeCom Pro: External Contact API ─────────────────────────────────
//
// Pro-only path that lets the firm message WeChat clients 1:1 by
// External Contact UserID (issued by WeCom when the client taps an
// "Add as External Contact" link sent by the firm). The client sees
// the firm employee as a regular WeChat contact; the firm sees them
// as an External Contact in WeCom. Replies arrive via the same
// /api/messaging/wechat/webhook route as the OA path (different event
// type — `change_external_contact` for adds, `external_contact_*`
// for messages).
//
//   https://developer.work.weixin.qq.com/document/path/91570  (External Contact API)

/**
 * Generate an "Add as External Contact" link for a portal user. The
 * portal sends the URL via email; the client taps once, lands in
 * WeChat with the firm employee's contact card and an "Add" button.
 * Once accepted, the change_external_contact webhook fires with the
 * client's external_userid and the state parameter we passed in.
 *
 * `userIdToAdd` is the WeCom UserID of the firm employee the client
 * should be routed to (typically the audit team's WeCom admin or a
 * round-robin pool). `state` is the one-time link code we use to
 * match the eventual webhook back to the portal user.
 */
export async function createWeComExternalContactWay(args: {
  userIdsToAdd: string[];
  state: string;
  remark?: string;
}): Promise<{ ok: boolean; configId?: string; qrUrl?: string; error?: string }> {
  try {
    const token = await fetchAppAccessToken({ useExternalContactSecret: true });
    const res = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/externalcontact/add_contact_way?access_token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        // type: 1 = single-employee QR; type: 2 = multi-employee pool.
        type: args.userIdsToAdd.length > 1 ? 2 : 1,
        // scene: 2 = QR shared outside the firm. The other scene (1)
        // is for QRs shown only inside the firm.
        scene: 2,
        style: 1,
        remark: args.remark?.slice(0, 30) || 'Portal client',
        skip_verify: true,        // auto-accept the add — Pro feature
        state: args.state,        // echoed back in the webhook for binding
        user: args.userIdsToAdd,
      }),
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok || (json?.errcode && json.errcode !== 0)) {
      return { ok: false, error: json?.errmsg || `HTTP ${res.status}` };
    }
    return { ok: true, configId: json?.config_id, qrUrl: json?.qr_code };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
}

/**
 * Send a free-text "welcome" message to an External Contact. Pro-
 * only API. Used for the FIRST send right after the client adds the
 * employee — within Tencent's "welcome message window" (~20s) there's
 * no 48-hour restriction. After the welcome window, subsequent sends
 * need a pre-approved template via add_msg_template.
 */
export async function sendWeComWelcomeMessage(args: {
  welcomeCode: string;
  body: string;
}): Promise<SendResult> {
  try {
    const token = await fetchAppAccessToken({ useExternalContactSecret: true });
    const res = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/externalcontact/send_welcome_msg?access_token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        welcome_code: args.welcomeCode,
        text: { content: (args.body || '').slice(0, 3000) },
      }),
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok || (json?.errcode && json.errcode !== 0)) {
      return { ok: false, error: json?.errmsg || `HTTP ${res.status}`, providerRaw: json };
    }
    return { ok: true, providerRaw: { ...json, _via: 'wecom-pro-welcome' } };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
}

/**
 * Send a template message to one or more External Contacts. The
 * actual "ongoing notifications" API once a client is past their
 * welcome window. Requires the template to be approved by Tencent
 * — see docs/wecom-setup.md for the template-approval process.
 *
 * `chatType` of 'single' targets external_userids directly;
 * 'group' targets external group chats by chat_id.
 */
export async function sendWeComExternalTemplate(args: {
  externalUserIds: string[];
  text: string;
  /** WeCom Pro employee user id sending on behalf of. */
  sender: string;
}): Promise<SendResult> {
  try {
    const token = await fetchAppAccessToken({ useExternalContactSecret: true });
    const res = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/externalcontact/add_msg_template?access_token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        chat_type: 'single',
        external_userid: args.externalUserIds,
        sender: args.sender,
        text: { content: (args.text || '').slice(0, 3000) },
      }),
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok || (json?.errcode && json.errcode !== 0)) {
      return { ok: false, error: json?.errmsg || `HTTP ${res.status}`, providerRaw: json };
    }
    return {
      ok: true,
      providerMessageId: typeof json?.msgid === 'string' ? json.msgid : undefined,
      providerRaw: { ...json, _via: 'wecom-pro-template' },
    };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
}
