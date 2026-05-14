/**
 * Twilio provider — SMS + WhatsApp.
 *
 * We talk to the Twilio REST API directly via fetch() rather than the
 * Node SDK to keep our bundle small and avoid an extra dependency.
 * The API surface we use is stable and well-documented:
 *   https://www.twilio.com/docs/messaging/api/message-resource
 *
 * Auth: HTTP Basic with AccountSid:AuthToken.
 *
 * Channels:
 *   • SMS      — `From` is a Twilio long code or alphanumeric sender id
 *                (TWILIO_SMS_FROM).
 *   • WhatsApp — `From` is `whatsapp:<E.164>` (TWILIO_WHATSAPP_FROM).
 *                Recipients are likewise prefixed with `whatsapp:`.
 *
 * Inbound verification (used by the webhook): Twilio signs every
 * webhook with `X-Twilio-Signature` (HMAC-SHA1 over the request URL +
 * sorted form params, keyed by the account auth token). verifyTwilio
 * Signature() implements RFC-style equivalence check.
 */

import crypto from 'crypto';
import type { OutboundMessage, SendResult } from './types';
import { getProviderConfig, type TwilioConfig } from './provider-config';
import { sendViaConnector } from './connector';

const TWILIO_API_BASE = 'https://api.twilio.com/2010-04-01';

async function getCreds() {
  const { config } = await getProviderConfig<TwilioConfig>('twilio');
  if (!config.accountSid || !config.authToken) {
    throw new Error('Twilio is not configured: set credentials in SuperAdmin → Messaging Providers or via TWILIO_* env vars.');
  }
  return { sid: config.accountSid, token: config.authToken };
}

/** True when Twilio is reachable — either through a configured
 *  connector OR direct Twilio creds. Async because the DB lookup
 *  is async; sync callers should await. */
export async function isTwilioConfigured(): Promise<boolean> {
  const { enabled, config } = await getProviderConfig<TwilioConfig>('twilio');
  if (!enabled) return false;
  // Connector path counts as configured even when direct creds are
  // blank — the connector holds the real account-side credentials.
  if (config.proConnectorUrl && config.proConnectorAuthValue) return true;
  return !!config.accountSid && !!config.authToken;
}

/** Send an SMS. Routes through the firm's connector when one is
 *  configured; falls back to Twilio's REST API otherwise. */
export async function sendTwilioSms(msg: OutboundMessage): Promise<SendResult> {
  const viaConnector = await sendViaConnector({ providerKey: 'twilio', channel: 'sms', message: msg });
  if (viaConnector) return viaConnector;

  const { config } = await getProviderConfig<TwilioConfig>('twilio');
  if (!config.smsFrom) return { ok: false, error: 'Twilio SMS sender not set (smsFrom) and no connector configured.' };
  return await postMessage({ From: config.smsFrom, To: msg.to, Body: msg.body, MediaUrls: msg.mediaUrls });
}

/** Send a WhatsApp message. Connector path mirrors the connector
 *  contract (channel: 'whatsapp', plain E.164 in `to`) — the
 *  connector adds the `whatsapp:` prefix internally. */
export async function sendTwilioWhatsApp(msg: OutboundMessage): Promise<SendResult> {
  const viaConnector = await sendViaConnector({
    providerKey: 'twilio',
    channel: 'whatsapp',
    // Strip whatsapp: prefix on the way out — the connector's
    // contract is plain E.164.
    message: { ...msg, to: msg.to.replace(/^whatsapp:/, '') },
  });
  if (viaConnector) return viaConnector;

  const { config } = await getProviderConfig<TwilioConfig>('twilio');
  if (!config.whatsappFrom) return { ok: false, error: 'Twilio WhatsApp sender not set (whatsappFrom) and no connector configured.' };
  const From = config.whatsappFrom.startsWith('whatsapp:') ? config.whatsappFrom : `whatsapp:${config.whatsappFrom}`;
  const To = msg.to.startsWith('whatsapp:') ? msg.to : `whatsapp:${msg.to}`;
  return await postMessage({ From, To, Body: msg.body, MediaUrls: msg.mediaUrls });
}

/**
 * Shared POST helper. Twilio expects application/x-www-form-urlencoded
 * with repeated `MediaUrl` keys for multiple attachments.
 */
async function postMessage(args: {
  From: string;
  To: string;
  Body: string;
  MediaUrls?: string[];
}): Promise<SendResult> {
  try {
    const { sid, token } = await getCreds();
    const params = new URLSearchParams();
    params.set('From', args.From);
    params.set('To', args.To);
    params.set('Body', args.Body);
    if (args.MediaUrls) {
      for (const url of args.MediaUrls) params.append('MediaUrl', url);
    }

    const url = `${TWILIO_API_BASE}/Accounts/${sid}/Messages.json`;
    const auth = Buffer.from(`${sid}:${token}`).toString('base64');
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      // Twilio's error JSON is { code, message, more_info, status }.
      // Surface the message so callers can decide whether to retry.
      const detail = json?.message || `HTTP ${res.status}`;
      return { ok: false, error: detail, providerRaw: json };
    }
    return {
      ok: true,
      providerMessageId: typeof json?.sid === 'string' ? json.sid : undefined,
      providerRaw: json,
    };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
}

/**
 * Verify a Twilio webhook signature. Returns true when the signature
 * matches; false otherwise. Implements the spec at
 *   https://www.twilio.com/docs/usage/webhooks/webhooks-security
 *
 *   1. Take the full request URL (incl. query string).
 *   2. Append the POST params sorted alphabetically by key, each
 *      key concatenated with its value.
 *   3. HMAC-SHA1 with the auth token, then base64.
 *   4. Compare against the X-Twilio-Signature header.
 *
 * `params` should be the urlencoded form body, parsed into a plain
 * object. The provided URL must be the one Twilio was configured
 * with — typically your https://… webhook URL.
 */
export async function verifyTwilioSignature(args: {
  url: string;
  params: Record<string, string>;
  signature: string;
  authToken?: string;
}): Promise<boolean> {
  let token = args.authToken;
  if (!token) {
    const { config } = await getProviderConfig<TwilioConfig>('twilio');
    token = config.authToken;
  }
  if (!token) return false;
  const sortedKeys = Object.keys(args.params).sort();
  let data = args.url;
  for (const k of sortedKeys) data += k + args.params[k];
  const expected = crypto.createHmac('sha1', token).update(data, 'utf8').digest('base64');
  try {
    // timingSafeEqual requires same-length buffers.
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(args.signature, 'utf8');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
