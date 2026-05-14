/**
 * /api/admin/messaging-providers
 *
 * Platform-wide messaging provider configuration. Super-Admin only.
 * (Previously /api/methodology-admin/messaging-providers — relocated
 * because providers are a system-level service Acumon runs across
 * every firm and meters for billing, not firm-specific config.)
 *
 *   GET   → list every provider (twilio, sent_dm, telegram, wecom)
 *           with current enabled flag + config blob. Secrets are
 *           returned as-is to the SuperAdmin so they can edit them.
 *           Falls back to env-var values for any provider that
 *           hasn't been configured in the DB yet, with a `source`
 *           hint so the UI can show "(from env)" badges.
 *   PUT   → upsert one provider's config. Body: { provider, enabled,
 *           config }.
 *
 * The actual messaging libraries read through lib/messaging/
 * provider-config.ts which DB-first / env-fallback. Cache is
 * invalidated on every PUT so the next send picks up the change
 * immediately.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import {
  getProviderConfig,
  invalidateProviderCache,
  type ProviderKey,
} from '@/lib/messaging/provider-config';

const ALLOWED: ProviderKey[] = ['twilio', 'sent_dm', 'telegram', 'wecom'];

async function requireSuperAdmin() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified || !session.user.isSuperAdmin) {
    return null;
  }
  return session;
}

export async function GET() {
  const session = await requireSuperAdmin();
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  // Pull current state for every provider — getProviderConfig handles
  // env-fallback when the row is missing, so the UI always has the
  // four rows it expects to render.
  const providers = await Promise.all(ALLOWED.map(async (key) => {
    const row = await prisma.messagingProviderConfig.findUnique({
      where: { provider: key },
      select: { enabled: true, config: true, updatedAt: true, updatedByName: true },
    }).catch(() => null);
    const resolved = await getProviderConfig(key);
    return {
      provider: key,
      enabled: row?.enabled ?? false,
      config: (row?.config as Record<string, unknown>) ?? {},
      // Effective config (after env fallback) — useful for the UI to
      // pre-fill placeholders showing what env-vars would supply if
      // the DB row stays unset.
      effective: resolved.config,
      source: resolved.source,
      updatedAt: row?.updatedAt?.toISOString() ?? null,
      updatedByName: row?.updatedByName ?? null,
    };
  }));
  return NextResponse.json({ providers });
}

export async function PUT(req: Request) {
  const session = await requireSuperAdmin();
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const provider = String(body.provider || '');
  if (!ALLOWED.includes(provider as ProviderKey)) {
    return NextResponse.json({ error: `provider must be one of ${ALLOWED.join(', ')}` }, { status: 400 });
  }
  const enabled = body.enabled === true;
  const config = (body.config && typeof body.config === 'object') ? body.config as Record<string, unknown> : {};

  // Per-provider validation. Cheap shape checks here so the UI never
  // accepts something the runtime will choke on.
  if (provider === 'wecom') {
    const mode = config.mode;
    if (mode !== undefined && mode !== 'group_robot' && mode !== 'external_contact_pro') {
      return NextResponse.json({ error: 'wecom.mode must be group_robot or external_contact_pro' }, { status: 400 });
    }
    if (typeof config.groupWebhookUrl === 'string' && config.groupWebhookUrl &&
        !/^https:\/\/qyapi\.weixin\.qq\.com\/.+key=/.test(config.groupWebhookUrl)) {
      return NextResponse.json({ error: 'wecom.groupWebhookUrl must be the qyapi.weixin.qq.com Group Robot URL.' }, { status: 400 });
    }
    // Connector URL: require HTTPS to catch typos. We don't pin the
    // host because the firm picks where to deploy their connector.
    if (typeof config.proConnectorUrl === 'string' && config.proConnectorUrl &&
        !/^https:\/\//i.test(config.proConnectorUrl)) {
      return NextResponse.json({ error: 'wecom.proConnectorUrl must start with https://' }, { status: 400 });
    }
  }

  const updatedByName = session.user.name || session.user.email || null;
  const updatedById = session.user.id;

  // Upsert by provider key. Existing rows update; the seed SQL
  // created the four canonical rows so this PUT typically updates.
  const row = await prisma.messagingProviderConfig.upsert({
    where: { provider },
    create: { provider, enabled, config: config as any, updatedById, updatedByName },
    update: { enabled, config: config as any, updatedById, updatedByName },
  });

  invalidateProviderCache(provider as ProviderKey);

  return NextResponse.json({
    ok: true,
    provider: {
      provider: row.provider,
      enabled: row.enabled,
      config: row.config,
      updatedAt: row.updatedAt.toISOString(),
      updatedByName: row.updatedByName,
    },
  });
}
