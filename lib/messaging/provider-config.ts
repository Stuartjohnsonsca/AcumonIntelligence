/**
 * Centralised messaging-provider configuration.
 *
 * One source of truth that every provider (Twilio, sent.dm, Telegram,
 * WeCom) consults instead of reading process.env directly. Reads from
 * the messaging_provider_configs table when the row is enabled, falls
 * back to env vars otherwise. Lets the SuperAdmin manage credentials
 * via UI without redeploying.
 *
 * Cache: 60-second in-memory TTL so a single hot request path doesn't
 * round-trip to Postgres for every send. SuperAdmin UI bumps the
 * cache when it writes (invalidateProviderCache).
 *
 * Provider config shapes:
 *
 *   twilio:   { accountSid, authToken, smsFrom, whatsappFrom,
 *               webhookPublicUrl? }
 *   sent_dm:  { apiKey, templateId, smsTemplateId?,
 *               whatsappTemplateId? }
 *   telegram: { botToken, botUsername, webhookSecret }
 *   wecom:    { mode: 'group_robot' | 'external_contact_pro',
 *               groupWebhookUrl?, corpId?, agentId?, appSecret?,
 *               token?, apiBase? }
 */

import { prisma } from '@/lib/db';

export type ProviderKey = 'twilio' | 'sent_dm' | 'telegram' | 'wecom';

/**
 * Connector fields shared by every messaging provider.
 *
 * Acumon prefers to talk to a stand-alone connector service rather
 * than call provider SDKs directly — same pattern as WeCom. The
 * connector lives outside Acumon (typically Railway / Render /
 * Fly), can be reused by other tools the firm builds, and holds the
 * actual Twilio / sent.dm / Telegram / WeCom credentials internally.
 *
 * SuperAdmin pastes the connector URL + auth value here; the rest
 * (channel-specific from-numbers, templates, etc.) live inside the
 * connector. Direct-API credentials remain in each provider's config
 * as a fallback for setups that haven't built a connector yet.
 *
 * Connector contract (the same shape across all four providers):
 *
 *   POST {baseUrl}/send
 *     headers: { [authHeader]: authValue, Content-Type: application/json }
 *     body:    {
 *       providerId: "prov-main" | ...,
 *       channel:    "sms" | "whatsapp" | "telegram" | "wecom",
 *       to:         string,
 *       body:       string,
 *       mediaUrls?: string[]
 *     }
 *     200 →    { ok: true,  providerMessageId?, providerRaw? }
 *     non-2xx →{ ok: false, error,             providerRaw? }
 *
 *   GET {baseUrl}{healthPath} → 200 when healthy
 *
 * Naming kept as `proConnector*` for historical consistency with
 * the existing WeCom Pro fields — the "Pro" prefix is now generic.
 */
export interface MessagingConnectorConfig {
  /** HTTPS root of the connector service. */
  proConnectorUrl?: string;
  /** Path appended to baseUrl for GET health probes. Defaults to /health. */
  proConnectorHealthPath?: string;
  /** Logical tenant id sent through to the connector so one
   *  connector deployment can serve several firms / accounts.
   *  Defaults to `prov-main` when blank. */
  proConnectorProviderId?: string;
  /** HTTP header name. Defaults to `Authorization`. */
  proConnectorAuthHeader?: string;
  /** Secret value placed in the auth header. */
  proConnectorAuthValue?: string;
}

export interface TwilioConfig extends MessagingConnectorConfig {
  accountSid?: string;
  authToken?: string;
  smsFrom?: string;
  whatsappFrom?: string;
  webhookPublicUrl?: string;
}
export interface SentDmConfig extends MessagingConnectorConfig {
  apiKey?: string;
  templateId?: string;
  smsTemplateId?: string;
  whatsappTemplateId?: string;
}
export interface TelegramConfig extends MessagingConnectorConfig {
  botToken?: string;
  botUsername?: string;
  webhookSecret?: string;
}
export interface WeComConfig extends MessagingConnectorConfig {
  mode?: 'group_robot' | 'external_contact_pro';
  groupWebhookUrl?: string;
  corpId?: string;
  agentId?: string;
  appSecret?: string;
  /// External Contact API uses its own secret distinct from the main
  /// app secret. Optional — falls back to appSecret if unset.
  externalContactSecret?: string;
  /// The WeCom UserID of the firm-side employee whose customer roster
  /// holds all bound external contacts. With `skip_verify=true` on
  /// Contact Way generation, this user auto-accepts every client
  /// add — no in-app gesture required.
  senderUserId?: string;
  token?: string;
  apiBase?: string;
  // Connector fields (proConnectorUrl / proConnectorAuthValue / …)
  // are inherited from MessagingConnectorConfig above.
}

export interface ProviderConfig<T = unknown> {
  enabled: boolean;
  config: T;
  /// True when the values came from the DB row; false when we fell
  /// back to env vars. Useful for the SuperAdmin UI's "Source: env"
  /// indicator on rows the SuperAdmin hasn't filled in yet.
  source: 'db' | 'env';
}

interface CacheEntry { value: ProviderConfig<unknown>; expiresAt: number }
const TTL_MS = 60_000;
const cache = new Map<ProviderKey, CacheEntry>();

/** Drop the in-memory cache. Called after a SuperAdmin write so the
 *  next request picks the new values up. */
export function invalidateProviderCache(provider?: ProviderKey) {
  if (provider) cache.delete(provider);
  else cache.clear();
}

/**
 * Read the live config for a provider. DB-first; env-fallback when
 * the row is missing OR `enabled=false`. Disabled rows behave as
 * "not configured" so a SuperAdmin can hard-disable a provider
 * without deleting credentials.
 */
export async function getProviderConfig<T = unknown>(provider: ProviderKey): Promise<ProviderConfig<T>> {
  const now = Date.now();
  const cached = cache.get(provider);
  if (cached && cached.expiresAt > now) {
    return cached.value as ProviderConfig<T>;
  }
  const row = await prisma.messagingProviderConfig.findUnique({
    where: { provider },
    select: { enabled: true, config: true },
  }).catch(() => null);

  let resolved: ProviderConfig<T>;
  if (row?.enabled) {
    resolved = { enabled: true, config: (row.config as T) ?? ({} as T), source: 'db' };
  } else {
    resolved = { enabled: hasEnvConfig(provider), config: readEnvConfig(provider) as T, source: 'env' };
  }
  cache.set(provider, { value: resolved as ProviderConfig<unknown>, expiresAt: now + TTL_MS });
  return resolved;
}

/** Convenience boolean — true iff getProviderConfig().enabled. Used
 *  by isXxxConfigured() helpers in each provider's lib file. */
export async function isProviderEnabled(provider: ProviderKey): Promise<boolean> {
  const cfg = await getProviderConfig(provider);
  return cfg.enabled;
}

// ── Env-var fallback shapes ─────────────────────────────────────────

function hasEnvConfig(provider: ProviderKey): boolean {
  if (provider === 'twilio') {
    return !!process.env.TWILIO_ACCOUNT_SID && !!process.env.TWILIO_AUTH_TOKEN;
  }
  if (provider === 'sent_dm') {
    return !!process.env.SENT_DM_API_KEY && !!process.env.SENT_DM_TEMPLATE_ID;
  }
  if (provider === 'telegram') {
    return !!process.env.TELEGRAM_BOT_TOKEN;
  }
  if (provider === 'wecom') {
    return !!process.env.WECOM_GROUP_WEBHOOK_URL
        || (!!process.env.WECOM_APP_ID && !!process.env.WECOM_APP_SECRET)
        || (!!process.env.WECOM_CORP_ID && !!process.env.WECOM_APP_SECRET);
  }
  return false;
}

function readEnvConfig(provider: ProviderKey): Record<string, unknown> {
  if (provider === 'twilio') {
    return {
      accountSid: process.env.TWILIO_ACCOUNT_SID,
      authToken: process.env.TWILIO_AUTH_TOKEN,
      smsFrom: process.env.TWILIO_SMS_FROM,
      whatsappFrom: process.env.TWILIO_WHATSAPP_FROM,
      webhookPublicUrl: process.env.TWILIO_WEBHOOK_PUBLIC_URL,
    } satisfies TwilioConfig;
  }
  if (provider === 'sent_dm') {
    return {
      apiKey: process.env.SENT_DM_API_KEY,
      templateId: process.env.SENT_DM_TEMPLATE_ID,
      smsTemplateId: process.env.SENT_DM_SMS_TEMPLATE_ID,
      whatsappTemplateId: process.env.SENT_DM_WHATSAPP_TEMPLATE_ID,
    } satisfies SentDmConfig;
  }
  if (provider === 'telegram') {
    return {
      botToken: process.env.TELEGRAM_BOT_TOKEN,
      botUsername: process.env.TELEGRAM_BOT_USERNAME,
      webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET,
    } satisfies TelegramConfig;
  }
  if (provider === 'wecom') {
    const groupOnly = !process.env.WECOM_CORP_ID && !!process.env.WECOM_GROUP_WEBHOOK_URL;
    return {
      mode: groupOnly ? 'group_robot' : 'external_contact_pro',
      groupWebhookUrl: process.env.WECOM_GROUP_WEBHOOK_URL,
      corpId: process.env.WECOM_CORP_ID,
      agentId: process.env.WECOM_AGENT_ID,
      appSecret: process.env.WECOM_APP_SECRET,
      externalContactSecret: process.env.WECOM_EXTERNAL_CONTACT_SECRET,
      senderUserId: process.env.WECOM_SENDER_USER_ID,
      token: process.env.WECOM_TOKEN,
      apiBase: process.env.WECHAT_API_BASE,
    } satisfies WeComConfig;
  }
  return {};
}
