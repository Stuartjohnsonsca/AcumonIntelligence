import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { resolvePortalUserFromToken } from '@/lib/portal-session';
import { assertPortalPrincipal } from '@/lib/portal-principal';

/**
 * PUT /api/portal/setup/staff/[staffId]?token=X
 * Body: { accessConfirmed?, role?, name? }
 *
 * Update a staff member row. The primary use is for toggling
 * accessConfirmed — until that's true, the staff member can't log
 * in (enforced in /api/portal/auth/login via decidePortalAccess).
 *
 * DELETE /api/portal/setup/staff/[staffId]?token=X
 *
 * Soft-delete (isActive=false). Any work-allocation slots that
 * referenced this portal user fall back to the Portal Principal at
 * request-routing time (Phase 2 of the feature).
 */
type Ctx = { params: Promise<{ staffId: string }> };

async function guardAndLoad(req: Request, ctx: Ctx) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get('token');
  if (!token) return { error: 'token required', status: 400 } as const;
  const user = await resolvePortalUserFromToken(token);
  if (!user) return { error: 'Invalid or expired session', status: 401 } as const;

  const { staffId } = await ctx.params;
  const row = await prisma.clientPortalStaffMember.findUnique({
    where: { id: staffId },
    select: { id: true, engagementId: true },
  }).catch(() => null);
  if (!row) return { error: 'Staff row not found', status: 404 } as const;

  const guard = await assertPortalPrincipal(user.id, row.engagementId);
  if (!guard.ok) return { error: guard.error, status: guard.status || 403 } as const;

  return { ok: true as const, staffId, user };
}

export async function PUT(req: Request, ctx: Ctx) {
  const g = await guardAndLoad(req, ctx);
  if ('error' in g) return NextResponse.json({ error: g.error }, { status: g.status });

  const body = await req.json().catch(() => ({}));
  const patch: Record<string, any> = {};
  if (typeof body.accessConfirmed === 'boolean') patch.accessConfirmed = body.accessConfirmed;
  if (typeof body.role === 'string' || body.role === null) patch.role = body.role || null;
  if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim();

  // Messaging channel hints — captured by the Principal during
  // staff setup so a user logging in for the first time already has
  // sensible defaults to confirm. Mirror-written through to the
  // linked ClientPortalUser when one exists so subsequent
  // notifyPortalUser() calls see them right away.
  if ('whatsappNumber' in body) patch.whatsappNumber = normalisePhone(body.whatsappNumber);
  if (typeof body.whatsappOptIn === 'boolean') patch.whatsappOptIn = body.whatsappOptIn;
  if ('telegramHandle' in body) patch.telegramHandle = body.telegramHandle ? String(body.telegramHandle).trim() : null;
  if (typeof body.telegramOptIn === 'boolean') patch.telegramOptIn = body.telegramOptIn;
  if ('smsNumber' in body) patch.smsNumber = normalisePhone(body.smsNumber);
  if (typeof body.smsOptIn === 'boolean') patch.smsOptIn = body.smsOptIn;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'No updatable fields provided' }, { status: 400 });
  }

  const row = await prisma.clientPortalStaffMember.update({ where: { id: g.staffId }, data: patch });

  // Mirror the channel patch through to the linked ClientPortalUser
  // (when one exists) so notifyPortalUser sees the new values on the
  // very next portal request. We never set telegramChatId here — it
  // only flips on the bot's /start handshake.
  const channelPatch: Record<string, any> = {};
  for (const k of ['whatsappNumber', 'whatsappOptIn', 'telegramHandle', 'telegramOptIn', 'smsNumber', 'smsOptIn'] as const) {
    if (k in patch) channelPatch[k] = patch[k];
  }
  if (row.portalUserId && Object.keys(channelPatch).length > 0) {
    try {
      await prisma.clientPortalUser.update({ where: { id: row.portalUserId }, data: channelPatch });
    } catch (err) {
      // Don't fail the staff update if the mirror write blows up —
      // the staff row is still the source of truth for setup.
      console.error('[portal staff PUT] failed to mirror channels to portal user', err);
    }
  }

  return NextResponse.json({ ok: true, staff: row });
}

function normalisePhone(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return null;
  const trimmed = value.replace(/[\s\-()]/g, '').trim();
  if (!trimmed) return null;
  return trimmed;
}

export async function DELETE(req: Request, ctx: Ctx) {
  const g = await guardAndLoad(req, ctx);
  if ('error' in g) return NextResponse.json({ error: g.error }, { status: g.status });

  await prisma.clientPortalStaffMember.update({
    where: { id: g.staffId },
    data: { isActive: false, accessConfirmed: false },
  });
  return NextResponse.json({ ok: true });
}
