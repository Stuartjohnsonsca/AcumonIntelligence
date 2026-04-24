import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

/**
 * PATCH /api/methodology-admin/portal-searches/[id]
 * Body: { featured: boolean, label?: string }
 *
 * Toggle the featured flag on a search-log row (the "representative"
 * of an aggregated query). When featured=true, the chip appears on
 * every Principal dashboard for the firm with the admin-supplied
 * label. Setting featured=false un-promotes it.
 *
 * We apply the toggle to ONLY the passed id, not to every log row
 * with the same query, so the admin retains full control of which
 * specific interpretation gets promoted.
 */
type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!session.user.firmId) return NextResponse.json({ error: 'No firm' }, { status: 400 });
  if (!session.user.isSuperAdmin && !session.user.isMethodologyAdmin) {
    return NextResponse.json({ error: 'Methodology-admin access required.' }, { status: 403 });
  }

  const { id } = await ctx.params;
  const row = await prisma.portalSearchLog.findUnique({
    where: { id },
    select: { id: true, firmId: true, query: true, queryNormalised: true },
  });
  if (!row || row.firmId !== session.user.firmId) {
    return NextResponse.json({ error: 'Search log not found.' }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const { featured, label } = body as { featured: boolean; label?: string };

  if (featured === true) {
    // Un-feature any other log row with the same normalised query
    // so the Principal dashboard doesn't render duplicate chips.
    if (row.queryNormalised) {
      await prisma.portalSearchLog.updateMany({
        where: { firmId: row.firmId, queryNormalised: row.queryNormalised, featured: true, id: { not: id } },
        data: { featured: false, featuredLabel: null, featuredAt: null, featuredById: null },
      });
    }
    await prisma.portalSearchLog.update({
      where: { id },
      data: {
        featured: true,
        featuredLabel: (label || row.query).slice(0, 80),
        featuredById: session.user.id,
        featuredAt: new Date(),
      },
    });
  } else {
    await prisma.portalSearchLog.update({
      where: { id },
      data: { featured: false, featuredLabel: null, featuredById: null, featuredAt: null },
    });
  }

  return NextResponse.json({ ok: true });
}
