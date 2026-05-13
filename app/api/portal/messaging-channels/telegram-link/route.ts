/**
 * /api/portal/messaging-channels/telegram-link
 *
 * Generates (or refreshes) a one-time Telegram link code for the
 * signed-in portal user and returns the deep-link URL they should
 * open to connect their Telegram account.
 *
 *   POST  →  { url, code, expiresAt }
 *
 * The bot's webhook redeems the code on /start. Codes live 30 minutes
 * — long enough for the user to switch apps, short enough that a
 * leaked code can't be reused indefinitely.
 */

import { NextResponse } from 'next/server';
import { resolvePortalUserFromToken } from '@/lib/portal-session';
import {
  generateTelegramLinkCode,
  buildTelegramConnectUrl,
  isTelegramConfigured,
  telegramBotUsername,
} from '@/lib/messaging';

export async function POST(req: Request) {
  if (!isTelegramConfigured()) {
    return NextResponse.json({ error: 'Telegram is not configured on this server' }, { status: 503 });
  }
  if (!telegramBotUsername()) {
    return NextResponse.json({ error: 'TELEGRAM_BOT_USERNAME is not set' }, { status: 503 });
  }
  const body = await req.json().catch(() => ({}));
  const me = await resolvePortalUserFromToken(body.token);
  if (!me) return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 });

  const code = await generateTelegramLinkCode(me.id);
  const url = buildTelegramConnectUrl(code);
  return NextResponse.json({
    url,
    code,
    expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
  });
}
