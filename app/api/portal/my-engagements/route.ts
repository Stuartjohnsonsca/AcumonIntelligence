import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { resolvePortalUserFromToken } from '@/lib/portal-session';

/**
 * GET /api/portal/my-engagements?token=X
 *
 * For the logged-in ClientPortalUser, return the engagements they can
 * see on the portal along with their role (Portal Principal vs staff)
 * and, if Principal, whether setup is outstanding so the dashboard can
 * show a "Finish setup" banner with a direct link.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get('token');
  if (!token) return NextResponse.json({ error: 'token required' }, { status: 400 });

  const user = await resolvePortalUserFromToken(token);
  if (!user) return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 });

  // Engagements where the user is the Portal Principal (always shown,
  // even if setup is not complete — the whole point is to let them
  // finish it).
  const principalEngagements = await prisma.auditEngagement.findMany({
    where: { clientId: user.clientId, portalPrincipalId: user.id },
    select: {
      id: true,
      auditType: true,
      portalSetupCompletedAt: true,
      client: { select: { clientName: true } },
      period: { select: { startDate: true, endDate: true } },
    },
    orderBy: { updatedAt: 'desc' },
  }).catch(() => [] as any[]);

  // Engagements where this user is an approved staff member (so we can
  // show request counts later on). Only surface engagements whose
  // Portal Principal has completed setup — others are effectively
  // invisible to this user.
  const staffEngagements = await prisma.clientPortalStaffMember.findMany({
    where: {
      portalUserId: user.id,
      isActive: true,
      accessConfirmed: true,
      engagement: { portalSetupCompletedAt: { not: null } },
    },
    select: {
      engagement: {
        select: {
          id: true,
          auditType: true,
          portalSetupCompletedAt: true,
          client: { select: { clientName: true } },
          period: { select: { startDate: true, endDate: true } },
        },
      },
    },
  }).catch(() => [] as any[]);

  return NextResponse.json({
    userId: user.id,
    principalFor: principalEngagements.map(e => ({
      id: e.id,
      clientName: e.client.clientName,
      auditType: e.auditType,
      periodStart: e.period?.startDate,
      periodEnd: e.period?.endDate,
      setupCompletedAt: e.portalSetupCompletedAt,
    })),
    staffOn: staffEngagements.map(s => s.engagement ? ({
      id: s.engagement.id,
      clientName: s.engagement.client.clientName,
      auditType: s.engagement.auditType,
      periodStart: s.engagement.period?.startDate,
      periodEnd: s.engagement.period?.endDate,
      setupCompletedAt: s.engagement.portalSetupCompletedAt,
    }) : null).filter(Boolean),
  });
}
