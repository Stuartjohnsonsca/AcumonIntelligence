import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export type EngagementRole = 'Junior' | 'Manager' | 'RI' | 'Partner' | 'EQR' | null;

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
 * Rejects EQR users with 403 — they are read-only everywhere except the Review Points route,
 * which opts out by passing { allowEQR: true }.
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
  return { role };
}
