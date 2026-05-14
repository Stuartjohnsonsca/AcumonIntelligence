/**
 * Shared messaging-connector client.
 *
 * Every provider (Twilio, sent.dm, Telegram, WeCom) supports a
 * uniform connector pattern: the firm runs a separate service that
 * holds the real provider credentials, and Acumon POSTs to it with
 * a stable JSON shape. This module is the single place that builds
 * those POSTs so each provider's send module stays short and the
 * contract is enforced in one spot.
 *
 *   POST {baseUrl}/send
 *     headers:
 *       {authHeader}: {authValue}              (defaults: Authorization)
 *       Content-Type: application/json
 *     body:
 *       {
 *         providerId: string,                   // multi-tenant routing
 *         channel:   'sms'|'whatsapp'|'telegram'|'wecom',
 *         to:        string,                    // E.164 / chat_id / open_id
 *         body:      string,
 *         mediaUrls?: string[],
 *       }
 *     returns:
 *       200 { ok: true,  providerMessageId?: string, providerRaw?: unknown }
 *       4xx/5xx { ok: false, error: string, providerRaw?: unknown }
 *
 *   GET {baseUrl}{healthPath} → 200 when the connector is healthy.
 *
 * Callers do `const r = await sendViaConnector(...)`. When the
 * provider config has no `proConnectorUrl`, the function returns
 * `null` so the caller can fall back to the direct-API path.
 */

import type { MessageChannel, OutboundMessage, SendResult } from './types';
import {
  getProviderConfig,
  type MessagingConnectorConfig,
  type ProviderKey,
} from './provider-config';

interface ConnectorSendArgs {
  providerKey: ProviderKey;
  channel: MessageChannel;
  message: OutboundMessage;
  /** Optional per-call timeout in ms. Default 15 000. */
  timeoutMs?: number;
}

/**
 * Returns `null` when the provider has no connector URL configured —
 * callers should fall back to the direct API in that case. Returns
 * a SendResult otherwise (success or failure).
 */
export async function sendViaConnector(args: ConnectorSendArgs): Promise<SendResult | null> {
  const { config } = await getProviderConfig<MessagingConnectorConfig>(args.providerKey);
  if (!config.proConnectorUrl) return null;

  const baseUrl = stripTrailingSlash(config.proConnectorUrl);
  const headerName = config.proConnectorAuthHeader?.trim() || 'Authorization';
  const headerValue = config.proConnectorAuthValue;
  const providerId = config.proConnectorProviderId?.trim() || 'prov-main';

  // Surface a configuration-error SendResult rather than a thrown
  // exception so the orchestrator's try/catch + portal_messages
  // logging captures it predictably.
  if (!headerValue) {
    return {
      ok: false,
      error: `Connector URL set for ${args.providerKey} but no auth value provided — paste it in SuperAdmin → Messaging Providers.`,
    };
  }

  const payload = {
    providerId,
    channel: args.channel,
    to: args.message.to,
    body: args.message.body,
    mediaUrls: args.message.mediaUrls ?? undefined,
  };

  // AbortController is needed because the default fetch on Vercel has
  // no client-side timeout; a hung connector would block the request
  // path indefinitely. 15 s is generous for a real send but bounded.
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), args.timeoutMs ?? 15_000);
  try {
    const res = await fetch(`${baseUrl}/send`, {
      method: 'POST',
      headers: {
        [headerName]: headerValue,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok || json?.ok === false) {
      return {
        ok: false,
        error: json?.error || json?.message || `Connector HTTP ${res.status}`,
        providerRaw: json,
      };
    }
    return {
      ok: true,
      providerMessageId: typeof json?.providerMessageId === 'string' ? json.providerMessageId : undefined,
      providerRaw: json?.providerRaw ?? json,
    };
  } catch (err: any) {
    const aborted = err?.name === 'AbortError';
    return {
      ok: false,
      error: aborted
        ? `Connector request timed out after ${args.timeoutMs ?? 15_000}ms`
        : err?.message || String(err),
    };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Probe the connector's healthcheck endpoint. Returns a structured
 * result the SuperAdmin "Test connector" button can render. Times
 * out fast (5 s) because a healthy connector responds in
 * milliseconds.
 */
export async function probeConnectorHealth(args: { providerKey: ProviderKey }): Promise<{
  ok: boolean;
  status?: number;
  error?: string;
}> {
  const { config } = await getProviderConfig<MessagingConnectorConfig>(args.providerKey);
  if (!config.proConnectorUrl) {
    return { ok: false, error: 'No connector URL configured.' };
  }
  const baseUrl = stripTrailingSlash(config.proConnectorUrl);
  const healthPath = normalisePath(config.proConnectorHealthPath || '/health');
  const headerName = config.proConnectorAuthHeader?.trim() || 'Authorization';
  const headerValue = config.proConnectorAuthValue;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 5_000);
  try {
    const res = await fetch(`${baseUrl}${healthPath}`, {
      method: 'GET',
      // Health endpoints typically don't require auth, but pass the
      // header when we have one so a connector that gates /health
      // behind auth still works.
      headers: headerValue ? { [headerName]: headerValue } : undefined,
      signal: ctrl.signal,
    });
    return { ok: res.ok, status: res.status };
  } catch (err: any) {
    return { ok: false, error: err?.name === 'AbortError' ? 'Healthcheck timed out (5s)' : (err?.message || String(err)) };
  } finally {
    clearTimeout(t);
  }
}

function stripTrailingSlash(u: string): string {
  return u.endsWith('/') ? u.slice(0, -1) : u;
}
function normalisePath(p: string): string {
  if (!p) return '/health';
  return p.startsWith('/') ? p : '/' + p;
}
