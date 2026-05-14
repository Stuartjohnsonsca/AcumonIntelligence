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

export interface TwilioConfig {
  accountSid?: string;
  authToken?: string;
  smsFrom?: string;
  whatsappFrom?: string;
  webhookPublicUrl?: string;
}
export interface SentDmConfig {
  apiKey?: string;
  templateId?: string;
  smsTemplateId?: string;
  whatsappTemplateId?: string;
}
export interface TelegramConfig {
  botToken?: string;
  botUsername?: string;
  webhookSecret?: string;
}
export interface WeComConfig {
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

  // ── WeCom Pro connector (external service the firm runs) ─────────
  //
  // For Model 3 the firm runs a separate service that talks to
  // Tencent's WeCom Pro APIs. Acumon POSTs to it instead of calling
  // Tencent directly. The connector handles access-token caching,
  // Contact Way generation, sending, webhook decoding, etc. These
  // fields are how Acumon finds and authenticates with the firm's
  // connector. Concrete request/response shape is defined by the
  // firm's connector implementation — Acumon just stores the URL +
  // auth and uses them at send time.
  proConnectorUrl?: string;
  /// Path on the connector that responds to GET with 200 when the
  /// service is healthy. Used by Acumon's connector smoke-test
  /// button and by future health-check schedules. Defaults to
  /// `/health` if unset.
  proConnectorHealthPath?: string;
  /// Logical identifier for which connector "tenant" or provider
  /// instance Acumon is talking to. Sent through to the connector
  /// on every call so a single connector deployment can multiplex
  /// several firms / corp IDs behind one URL. Defaults to
  /// `prov-main` when unset.
  proConnectorProviderId?: string;
  /// HTTP header name carrying the connector auth. Defaults to
  /// `Authorization` when unset; some connectors prefer
  /// `X-Api-Key` or a custom header.
  proConnectorAuthHeader?: string;
  /// The value placed in the header above. Treat as a secret — the
  /// SuperAdmin UI renders this as a password input.
  proConnectorAuthValue?: string;
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
