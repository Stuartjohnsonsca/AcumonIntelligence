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

/**
 * The /my-account/admin page guard already redirects any non-
 * SuperAdmin and any session that hasn't 2FA-verified. By the time
 * this endpoint is called from the Messaging Providers tab the
 * caller is necessarily a verified SuperAdmin. Gating on
 * `isSuperAdmin` alone avoids spurious 403s when `twoFactorVerified`
 * flickers off in the session token mid-panel — the panel is the
 * source of truth for 2FA, the API just enforces authorization.
 */
async function requireSuperAdmin() {
  const session = await auth();
  if (!session?.user?.isSuperAdmin) {
    console.warn('[messaging-providers] forbidden', {
      hasSession: !!session,
      userId: session?.user?.id,
      email: session?.user?.email,
    });
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
  }

  // Connector URL: HTTPS required across every provider. We don't
  // pin the host because the firm picks where to deploy their
  // connector. Applies uniformly to twilio / sent_dm / telegram /
  // wecom — all four providers share the same connector contract.
  if (typeof config.proConnectorUrl === 'string' && config.proConnectorUrl &&
      !/^https:\/\//i.test(config.proConnectorUrl)) {
    return NextResponse.json({ error: `${provider}.proConnectorUrl must start with https://` }, { status: 400 });
  }
  // Healthcheck path: starts with / when supplied. Anything else
  // would silently mean "appended directly to baseUrl" which is
  // almost never what the SuperAdmin meant.
  if (typeof config.proConnectorHealthPath === 'string' && config.proConnectorHealthPath &&
      !config.proConnectorHealthPath.startsWith('/')) {
    return NextResponse.json({ error: `${provider}.proConnectorHealthPath must start with /` }, { status: 400 });
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
