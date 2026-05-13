/**
 * /api/portal/messaging-channels/wechat-link
 *
 * Generate a WeChat connect QR for the signed-in portal user.
 * Returns the QR image URL the UI renders + the scene code so the
 * caller can fall back to a deep-link if the user is on the WeChat
 * mobile app. Codes expire in 30 minutes; the bound OpenID, once
 * stored, never expires until the user opts out.
 */

import { NextResponse } from 'next/server';
import { resolvePortalUserFromToken } from '@/lib/portal-session';
import {
  generateWeChatLinkCode,
  createWeChatLoginQr,
  isWeChatConfigured,
} from '@/lib/messaging';

export async function POST(req: Request) {
  if (!isWeChatConfigured()) {
    return NextResponse.json({ error: 'WeChat is not configured on this server' }, { status: 503 });
  }
  const body = await req.json().catch(() => ({}));
  const me = await resolvePortalUserFromToken(body.token);
  if (!me) return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 });

  const code = await generateWeChatLinkCode(me.id);
  try {
    const qr = await createWeChatLoginQr({ sceneStr: code, expireSeconds: 30 * 60 });
    return NextResponse.json({
      code,
      qrUrl: qr.qrUrl,
      ticket: qr.ticket,
      expiresAt: qr.expiresAt.toISOString(),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed to generate WeChat QR' }, { status: 502 });
  }
}
