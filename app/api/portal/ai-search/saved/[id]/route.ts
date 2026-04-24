import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { resolvePortalUserFromToken } from '@/lib/portal-session';

/**
 * DELETE /api/portal/ai-search/saved/[id]?token=X
 *
 * Un-save a search (caller only). We don't delete the log row —
 * that stays for Methodology Admin analytics — we just clear the
 * saved-by / label / saved-at fields so the user's saved list no
 * longer includes it.
 */
type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(req: Request, ctx: Ctx) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get('token');
  if (!token) return NextResponse.json({ error: 'token required' }, { status: 400 });
  const user = await resolvePortalUserFromToken(token);
  if (!user) return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 });

  const { id } = await ctx.params;
  const row = await prisma.portalSearchLog.findUnique({
    where: { id },
    select: { id: true, savedByPortalUserId: true },
  });
  if (!row || row.savedByPortalUserId !== user.id) {
    return NextResponse.json({ error: 'Saved search not found for this user.' }, { status: 404 });
  }
  await prisma.portalSearchLog.update({
    where: { id },
    data: { savedByPortalUserId: null, savedLabel: null, savedAt: null },
  });
  return NextResponse.json({ ok: true });
}
