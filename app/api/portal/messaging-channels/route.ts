/**
 * /api/portal/messaging-channels
 *
 * Lets the signed-in portal user view + edit their own WhatsApp /
 * Telegram / SMS contact details + opt-in flags. Telegram linking is
 * a two-step handshake — the user clicks "Connect Telegram", which
 * POSTs to /telegram-link below to get a one-time code, then opens
 * t.me/<bot>?start=<code>. The bot's webhook redeems the code.
 *
 * Auth: portal session token (?token=… on GET, body.token on PUT).
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { resolvePortalUserFromToken } from '@/lib/portal-session';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get('token');
  const me = await resolvePortalUserFromToken(token);
  if (!me) return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 });

  const user = await prisma.clientPortalUser.findUnique({
    where: { id: me.id },
    select: {
      whatsappNumber: true,
      whatsappOptIn: true,
      telegramHandle: true,
      telegramChatId: true,
      telegramOptIn: true,
      telegramLinkExpiresAt: true,
      smsNumber: true,
      smsOptIn: true,
    },
  });
  return NextResponse.json({ channels: user });
}

export async function PUT(req: Request) {
  const body = await req.json().catch(() => ({}));
  const me = await resolvePortalUserFromToken(body.token);
  if (!me) return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 });

  // Whitelisted writeable fields. telegramChatId is intentionally
  // NOT writeable here — only the bot webhook can set it via the
  // /start handshake, so an attacker can't claim someone else's
  // chat by posting their chat_id.
  const patch: Record<string, unknown> = {};
  if (typeof body.whatsappNumber === 'string' || body.whatsappNumber === null) {
    patch.whatsappNumber = normalisePhone(body.whatsappNumber);
  }
  if (typeof body.whatsappOptIn === 'boolean') patch.whatsappOptIn = body.whatsappOptIn;
  if (typeof body.telegramHandle === 'string' || body.telegramHandle === null) {
    patch.telegramHandle = body.telegramHandle ? String(body.telegramHandle).trim() : null;
  }
  if (typeof body.telegramOptIn === 'boolean') patch.telegramOptIn = body.telegramOptIn;
  if (typeof body.smsNumber === 'string' || body.smsNumber === null) {
    patch.smsNumber = normalisePhone(body.smsNumber);
  }
  if (typeof body.smsOptIn === 'boolean') patch.smsOptIn = body.smsOptIn;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'No writeable fields supplied' }, { status: 400 });
  }

  const user = await prisma.clientPortalUser.update({
    where: { id: me.id },
    data: patch,
    select: {
      whatsappNumber: true,
      whatsappOptIn: true,
      telegramHandle: true,
      telegramChatId: true,
      telegramOptIn: true,
      smsNumber: true,
      smsOptIn: true,
    },
  });
  return NextResponse.json({ channels: user });
}

/**
 * Loose phone-number normaliser. We accept any string, strip spaces /
 * hyphens, ensure an optional leading + survives, and reject obvious
 * empties. Strict E.164 validation lives at provider-call time so the
 * UI doesn't need to enforce a specific format.
 */
function normalisePhone(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return null;
  const trimmed = value.replace(/[\s\-()]/g, '').trim();
  if (!trimmed) return null;
  return trimmed;
}
