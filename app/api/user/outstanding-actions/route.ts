import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

/**
 * GET /api/user/outstanding-actions
 * Returns pending actions for the current user across all their audit engagements.
 * ?countOnly=true — returns just { totalCount } for navbar badge polling.
 */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = session.user.id;
  const { searchParams } = new URL(req.url);
  const countOnly = searchParams.get('countOnly') === 'true';

  // 1. Get all engagements where user is a team member
  const memberships = await prisma.auditTeamMember.findMany({
    where: { userId },
    include: {
      engagement: {
        include: {
          client: { select: { id: true, clientName: true } },
          period: { select: { id: true, startDate: true, endDate: true } },
        },
      },
    },
  });

  const engagementIds = memberships.map(m => m.engagementId);

  // 2. Collect pending user_action records (e.g. Land Registry selections)
  const pendingActions = await prisma.methodologyTemplate.findMany({
    where: {
      templateType: 'user_action',
      items: { path: ['userId'], equals: userId },
    },
  });

  const userActions = pendingActions
    .map((r: any) => {
      const items = typeof r.items === 'object' && r.items !== null ? r.items as Record<string, unknown> : {};
      if ((items.status as string) === 'completed') return null;
      return {
        id: r.id,
        type: (items.actionType as string) || 'unknown',
        title: (items.title as string) || 'Pending Action',
        description: (items.description as string) || '',
        engagementId: (items.engagementId as string) || null,
        data: items.data || null,
        createdAt: r.createdAt?.toISOString(),
      };
    })
    .filter(Boolean);

  // 3. Build engagement context map
  const engMap = new Map(
    memberships.map(m => [
      m.engagementId,
      {
        clientName: m.engagement.client?.clientName || 'Unknown',
        clientId: m.engagement.clientId,
        auditType: m.engagement.auditType,
        periodEnd: m.engagement.period?.endDate ? new Date(m.engagement.period.endDate).toLocaleDateString('en-GB') : '',
      },
    ])
  );

  // 4. Enrich actions with engagement context
  const actions = userActions.map((a: any) => ({
    ...a,
    engagementContext: a.engagementId ? engMap.get(a.engagementId) || null : null,
  }));

  const totalCount = actions.length;

  if (countOnly) {
    return NextResponse.json({ totalCount });
  }

  return NextResponse.json({ totalCount, actions });
}
