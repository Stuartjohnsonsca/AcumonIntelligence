import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export type EngagementRole = 'Junior' | 'Manager' | 'RI' | 'Partner' | 'EQR' | 'RegulatoryReviewer' | null;

/**
 * Look up the current user's team role on a given engagement.
 * Returns null if the user is not on the team (e.g. super-admin looking at any engagement).
 */
export async function getEngagementUserRole(engagementId: string, userId: string): Promise<EngagementRole> {
  const tm = await prisma.auditTeamMember.findFirst({
    where: { engagementId, userId },
    select: { role: true },
  });
  return (tm?.role as EngagementRole) ?? null;
}

/**
 * Gate for every WRITE handler under /api/engagements/[engagementId]/*.
 *
 * Rejects:
 *   • EQR users with 403 — read-only everywhere except Review Points
 *     (Review Points routes pass { allowEQR: true } to opt out).
 *   • RegulatoryReviewer users with 403 — fully read-only, no opt-out.
 *     The role is added by a Methodology Administrator and grants
 *     unlimited READ access to one engagement (audit + period + client)
 *     without ever permitting writes.
 *
 * Returns the resolved role on success, or a NextResponse on failure — caller should do:
 *
 *   const access = await assertEngagementWriteAccess(engagementId, session);
 *   if (access instanceof NextResponse) return access;
 *
 * The helper does NOT perform the existing firm-access check — continue calling your
 * existing verifyEngagementAccess helper before or after this one.
 */
export async function assertEngagementWriteAccess(
  engagementId: string,
  session: { user?: { id?: string } } | null | undefined,
  opts: { allowEQR?: boolean } = {},
): Promise<{ role: EngagementRole } | NextResponse> {
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const role = await getEngagementUserRole(engagementId, userId);
  if (role === 'EQR' && !opts.allowEQR) {
    return NextResponse.json(
      { error: 'EQR users are read-only except for Review Points' },
      { status: 403 },
    );
  }
  // Regulatory Reviewers are unconditionally read-only — no opt-out
  // flag. The role exists so an external regulator can review the
  // file without leaving their fingerprints on the data.
  if (role === 'RegulatoryReviewer') {
    return NextResponse.json(
      { error: 'Regulatory Reviewers have read-only access and cannot make changes' },
      { status: 403 },
    );
  }
  return { role };
}

/**
 * True iff the role is purely read-only — useful for UI guards that
 * want to hide / disable write controls. Mirrors the server-side
 * gate above.
 */
export function isReadOnlyRole(role: EngagementRole): boolean {
  return role === 'EQR' || role === 'RegulatoryReviewer';
}
