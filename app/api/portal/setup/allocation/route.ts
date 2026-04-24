import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { resolvePortalUserFromToken } from '@/lib/portal-session';
import { assertPortalPrincipal } from '@/lib/portal-principal';

/**
 * PUT /api/portal/setup/allocation?token=X
 * Body: {
 *   engagementId,
 *   fsLineId?:      null → catch-all row
 *   tbAccountCode?: null → FS-Line-level row, set → per-TB-code override
 *   staff1UserId?,
 *   staff2UserId?,
 *   staff3UserId?,
 * }
 *
 * Upsert a work-allocation row. Identity is (engagementId, fsLineId,
 * tbAccountCode). Any of the staff slots can be null — that column is
 * shown as blank on the client side and falls back to the next-
 * leftmost column's user at request-routing time.
 *
 * All three staff references are validated against the curated staff
 * list — you can't pick someone who isn't an active, approved staff
 * member for this engagement.
 */
export async function PUT(req: Request) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get('token');
  if (!token) return NextResponse.json({ error: 'token required' }, { status: 400 });

  const user = await resolvePortalUserFromToken(token);
  if (!user) return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { engagementId, fsLineId, tbAccountCode, staff1UserId, staff2UserId, staff3UserId } = body;
  if (!engagementId) return NextResponse.json({ error: 'engagementId required' }, { status: 400 });

  const guard = await assertPortalPrincipal(user.id, engagementId);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status || 403 });

  // Validate any staff assignments are on the active, approved staff
  // list. Skip validation for the Portal Principal themselves — they
  // can always be assigned as a fallback.
  const assigned = [staff1UserId, staff2UserId, staff3UserId].filter(Boolean) as string[];
  if (assigned.length > 0) {
    const validStaff = await prisma.clientPortalStaffMember.findMany({
      where: {
        engagementId,
        isActive: true,
        accessConfirmed: true,
        portalUserId: { in: assigned },
      },
      select: { portalUserId: true },
    });
    const validIds = new Set(validStaff.map(s => s.portalUserId).filter(Boolean) as string[]);
    validIds.add(user.id); // Portal Principal is always valid
    const invalid = assigned.filter(id => !validIds.has(id));
    if (invalid.length > 0) {
      return NextResponse.json({
        error: 'One or more assigned staff are not on the approved staff list for this engagement. Approve them first in the Staff section.',
      }, { status: 400 });
    }
  }

  // Upsert by (engagementId, fsLineId|null, tbAccountCode|null). Prisma's
  // composite-unique operations don't handle nulls in compound keys
  // gracefully, so we do a two-step: find existing + update, else create.
  const existing = await prisma.clientPortalWorkAllocation.findFirst({
    where: {
      engagementId,
      fsLineId: fsLineId ?? null,
      tbAccountCode: tbAccountCode ?? null,
    },
    select: { id: true },
  });
  const data = {
    clientId: guard.clientId!,
    engagementId,
    fsLineId: fsLineId ?? null,
    tbAccountCode: tbAccountCode ?? null,
    staff1UserId: staff1UserId ?? null,
    staff2UserId: staff2UserId ?? null,
    staff3UserId: staff3UserId ?? null,
  };
  const row = existing
    ? await prisma.clientPortalWorkAllocation.update({ where: { id: existing.id }, data })
    : await prisma.clientPortalWorkAllocation.create({ data });

  return NextResponse.json({ ok: true, allocation: row });
}

/**
 * DELETE /api/portal/setup/allocation?token=X&id=<allocationId>
 *
 * Remove a work-allocation row entirely. Useful if the Portal
 * Principal decides a TB-code-level override isn't needed after
 * all (the row will fall back to its FS-Line-level row, which
 * falls back to the Portal Principal).
 */
export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get('token');
  const id = searchParams.get('id');
  if (!token || !id) return NextResponse.json({ error: 'token and id required' }, { status: 400 });

  const user = await resolvePortalUserFromToken(token);
  if (!user) return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 });

  const row = await prisma.clientPortalWorkAllocation.findUnique({
    where: { id },
    select: { id: true, engagementId: true },
  });
  if (!row) return NextResponse.json({ error: 'Allocation not found' }, { status: 404 });

  const guard = await assertPortalPrincipal(user.id, row.engagementId);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status || 403 });

  await prisma.clientPortalWorkAllocation.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
