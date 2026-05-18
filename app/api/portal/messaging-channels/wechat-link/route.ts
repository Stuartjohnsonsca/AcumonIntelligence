/**
 * /api/portal/messaging-channels/wechat-link
 *
 * Mint a one-time bind code for the signed-in portal user so the
 * firm's WeCom Pro connector (or the legacy Official Account flow)
 * can match a freshly-scanned client back to this portal user.
 *
 * Return shape depends on what's configured at the platform level:
 *
 *   external_contact_pro (Model 3, connector-driven):
 *     { mode: 'external_contact_pro', code, expiresAt,
 *       connectorUrl?: string }
 *     The UI POSTs `code` to the firm's connector — the connector
 *     calls WeCom's add_contact_way on the firm's behalf and
 *     returns the QR URL. We never call Tencent directly here.
 *
 *   official_account (legacy, no connector):
 *     { mode: 'official_account', code, qrUrl, ticket, expiresAt }
 *
 *   group_robot:
 *     { mode: 'group_robot' }
 *     UI falls back to the Principal-pasted join URL.
 *
 * Codes expire in 30 minutes.
 */

import { NextResponse } from 'next/server';
import { resolvePortalUserFromToken, requirePortalWriteAccess } from '@/lib/portal-session';
import {
  generateWeChatLinkCode,
  generateWeComBindCode,
  createWeChatLoginQr,
  isWeChatConfigured,
  isWeComExternalContactConfigured,
  getWeComMode,
} from '@/lib/messaging';
import { getProviderConfig, type WeComConfig } from '@/lib/messaging/provider-config';

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const me = await resolvePortalUserFromToken(body.token);
  if (!me) return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 });
  const writeGuard = requirePortalWriteAccess(me);
  if (!writeGuard.ok) return NextResponse.json(writeGuard.body, { status: writeGuard.status });

  // WeCom Pro path — mint a bind code, hand it (and the firm's
  // connector URL, if configured) back to the UI. The UI / firm's
  // connector takes over from here.
  if (await isWeComExternalContactConfigured()) {
    const { config } = await getProviderConfig<WeComConfig>('wecom');
    const code = await generateWeComBindCode(me.id);
    return NextResponse.json({
      mode: 'external_contact_pro',
      code,
      expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      connectorUrl: config.proConnectorUrl || null,
    });
  }

  // Legacy Official Account path — kept for firms that have OA but
  // not the WeCom Pro connector.
  if (await isWeChatConfigured()) {
    const code = await generateWeChatLinkCode(me.id);
    try {
      const qr = await createWeChatLoginQr({ sceneStr: code, expireSeconds: 30 * 60 });
      return NextResponse.json({
        mode: 'official_account',
        code,
        qrUrl: qr.qrUrl,
        ticket: qr.ticket,
        expiresAt: qr.expiresAt.toISOString(),
      });
    } catch (err: any) {
      return NextResponse.json({ error: err?.message || 'Failed to generate WeChat QR' }, { status: 502 });
    }
  }

  // Group Robot path — the Principal-pasted URL on the engagement is
  // the join link. No per-user mint needed; the UI surfaces it from
  // /api/portal/my-engagements.
  const mode = await getWeComMode();
  if (mode === 'group_robot') {
    return NextResponse.json({
      mode: 'group_robot',
      message: 'Using the Principal-pasted group join URL — no per-user Connect needed.',
    });
  }

  return NextResponse.json({
    error: 'No WeChat / WeCom provider configured. Ask your firm admin to set one up under SuperAdmin → Messaging Providers.',
  }, { status: 503 });
}
