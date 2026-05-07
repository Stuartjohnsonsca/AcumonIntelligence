import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { TAB_PURGE_DEFS, findPurgeTabDef, resolveTargetsWithCascade } from '@/lib/data-purge-registry';
import { logEngagementAction } from '@/lib/engagement-action-log';

/**
 * Methodology Admin → Reset Tab Data.
 *
 * Wipes the data for one tab (chosen from the registry) across every
 * engagement in the calling user's firm. Super admin can also see
 * this endpoint; the firmId is always the session user's firmId, so
 * super admin can only wipe their own firm — to wipe a different
 * firm they'd need to switch firms first (intentional — there's no
 * cross-firm purge here).
 *
 * Safety:
 *   - twoFactorVerified + isMethodologyAdmin (or isSuperAdmin)
 *   - Body must include `confirmation: 'DELETE'` exactly. Anything
 *     else returns 400 without touching data.
 *   - Every purge writes one row to engagement_action_logs per
 *     engagement (action: 'data-purge.<tab-key>') so the audit trail
 *     captures who wiped what and when.
 */

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!session.user.isSuperAdmin && !session.user.isMethodologyAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const firmId = session.user.firmId;
  // Optional `clientId` query param: when present we return the
  // periods that have engagements for that client, scoped to the
  // firm. Lets the UI build a dependent Client → Period dropdown
  // without two endpoints.
  const { searchParams } = new URL(req.url);
  const filterClientId = searchParams.get('clientId') || undefined;

  const [clients, periods] = await Promise.all([
    prisma.client.findMany({
      where: {
        firmId,
        periods: { some: { auditEngagements: { some: {} } } },
      },
      select: { id: true, clientName: true },
      orderBy: { clientName: 'asc' },
    }),
    filterClientId
      ? prisma.clientPeriod.findMany({
        where: {
          clientId: filterClientId,
          client: { firmId },
          auditEngagements: { some: {} },
        },
        select: { id: true, startDate: true, endDate: true },
        orderBy: { endDate: 'desc' },
      })
      : Promise.resolve([] as Array<{ id: string; startDate: Date; endDate: Date }>),
  ]);

  return NextResponse.json({
    tabs: TAB_PURGE_DEFS.map(t => ({
      key: t.key,
      label: t.label,
      description: t.description,
      cascade: t.cascade || [],
      // Pre-resolved expansion so the UI can display "purging this
      // also wipes …" without re-implementing the cascade walker.
      expandedKeys: resolveTargetsWithCascade(t.key).expandedKeys,
    })),
    clients: clients.map(c => ({ id: c.id, name: c.clientName })),
    periods: periods.map(p => ({
      id: p.id,
      startDate: p.startDate?.toISOString() || null,
      endDate: p.endDate?.toISOString() || null,
    })),
  });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!session.user.isSuperAdmin && !session.user.isMethodologyAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Body required' }, { status: 400 });
  }
  const tabKey = typeof body.tab === 'string' ? body.tab : '';
  const clientId = typeof body.clientId === 'string' ? body.clientId.trim() : '';
  const periodId = typeof body.periodId === 'string' ? body.periodId.trim() : '';
  const confirmation = typeof body.confirmation === 'string' ? body.confirmation : '';
  if (!clientId || !periodId) {
    return NextResponse.json({ error: 'clientId and periodId are required — purges are scoped to one Client + Period' }, { status: 400 });
  }
  if (confirmation !== 'DELETE') {
    return NextResponse.json({ error: "confirmation must be exactly 'DELETE'" }, { status: 400 });
  }
  const def = findPurgeTabDef(tabKey);
  if (!def) {
    return NextResponse.json({ error: `Unknown tab: ${tabKey}` }, { status: 400 });
  }

  const firmId = session.user.firmId;
  // Verify the chosen client + period actually belong to this firm
  // before we touch anything. Without this, a crafted body could
  // (in theory) pass another firm's clientId. The findFirst is on
  // (firmId, clientId, periodId) — only matches when all three line
  // up.
  const scopeCheck = await prisma.auditEngagement.findFirst({
    where: { firmId, clientId, periodId },
    select: { id: true },
  });
  if (!scopeCheck) {
    return NextResponse.json({ error: 'No engagement found for this firm + client + period' }, { status: 404 });
  }

  // Resolve every engagement under (firmId, clientId, periodId) —
  // a client+period pair can carry multiple engagements (one per
  // audit type, e.g. SME vs GROUP). All matching engagements get
  // wiped together since they share the period's data context.
  const engagements = await prisma.auditEngagement.findMany({
    where: { firmId, clientId, periodId },
    select: { id: true },
  });
  const engagementIds = engagements.map(e => e.id);

  // Resolve cascades — the registry lets a tab's purge sweep up the
  // artifacts it spawned via triggers (Specialist chats, Schedule
  // Specialist Reviews, Outstanding Items, etc.) so resetting a tab
  // genuinely returns the engagement to a clean state.
  const { targets, expandedKeys } = resolveTargetsWithCascade(def.key);

  const perTargetCounts: Array<{ model: string; count: number; extraWhere?: Record<string, unknown> }> = [];
  if (engagementIds.length > 0) {
    for (const target of targets) {
      // Type-erase to call deleteMany on the chosen model. The
      // Prisma client surfaces every model as a property on the
      // client; we look it up by name from the registry so adding
      // a new tab is a one-line change in the registry.
      const model = (prisma as any)[target.model];
      if (!model || typeof model.deleteMany !== 'function') {
        perTargetCounts.push({ model: target.model, count: -1, extraWhere: target.extraWhere });
        continue;
      }
      const where: Record<string, unknown> = {
        engagementId: { in: engagementIds },
        ...(target.extraWhere || {}),
      };
      try {
        const result = await model.deleteMany({ where });
        perTargetCounts.push({ model: target.model, count: result?.count ?? 0, extraWhere: target.extraWhere });
      } catch (err: any) {
        console.error(`[data-purge] ${target.model} deleteMany failed:`, err?.message || err);
        perTargetCounts.push({ model: target.model, count: -1, extraWhere: target.extraWhere });
      }
    }
  }

  const totalDeleted = perTargetCounts
    .filter(t => t.count >= 0)
    .reduce((s, t) => s + t.count, 0);

  // Write one engagement-action-log row per engagement so each
  // engagement's audit trail records the wipe — not just the
  // firm-level summary. Skips if no engagements existed.
  for (const engagementId of engagementIds) {
    await logEngagementAction({
      engagementId,
      firmId,
      actorUserId: session.user.id || null,
      actorName: session.user.name || session.user.email || 'methodology-admin',
      action: `data-purge.${def.key}`,
      summary: `Methodology Admin purged "${def.label}" data for this client+period — ${totalDeleted} rows total`,
      targetType: 'data-purge',
      targetId: def.key,
      metadata: {
        tabKey: def.key,
        tabLabel: def.label,
        cascadedKeys: expandedKeys,
        targets: perTargetCounts,
        totalDeleted,
        engagementCount: engagementIds.length,
        clientId,
        periodId,
      },
    });
  }

  console.log(`[data-purge] firm=${firmId} client=${clientId} period=${periodId} tab=${def.key} cascaded=[${expandedKeys.join(',')}] deleted=${totalDeleted} byUser=${session.user.id} (${session.user.email})`);
  return NextResponse.json({
    ok: true,
    tab: def.key,
    label: def.label,
    cascadedKeys: expandedKeys,
    targets: perTargetCounts,
    totalDeleted,
    engagementCount: engagementIds.length,
    clientId,
    periodId,
  });
}
