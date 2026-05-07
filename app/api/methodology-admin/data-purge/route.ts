import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { TAB_PURGE_DEFS, findPurgeTabDef } from '@/lib/data-purge-registry';
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

export async function GET() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!session.user.isSuperAdmin && !session.user.isMethodologyAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  // Surfaces the registry to the UI so the dropdown options stay
  // server-driven.
  return NextResponse.json({
    tabs: TAB_PURGE_DEFS.map(t => ({
      key: t.key,
      label: t.label,
      description: t.description,
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
  const confirmation = typeof body.confirmation === 'string' ? body.confirmation : '';
  if (confirmation !== 'DELETE') {
    return NextResponse.json({ error: "confirmation must be exactly 'DELETE'" }, { status: 400 });
  }
  const def = findPurgeTabDef(tabKey);
  if (!def) {
    return NextResponse.json({ error: `Unknown tab: ${tabKey}` }, { status: 400 });
  }

  const firmId = session.user.firmId;
  // Resolve every engagement in this firm — we filter the per-table
  // deleteMany by `engagementId IN (...)` so one tab purge can't
  // accidentally cross firms via a missing scope filter.
  const engagements = await prisma.auditEngagement.findMany({
    where: { firmId },
    select: { id: true },
  });
  const engagementIds = engagements.map(e => e.id);

  const perTargetCounts: Array<{ model: string; count: number }> = [];
  if (engagementIds.length > 0) {
    for (const target of def.targets) {
      // Type-erase to call deleteMany on the chosen model. The
      // Prisma client surfaces every model as a property on the
      // client; we look it up by name from the registry so adding
      // a new tab is a one-line change in the registry.
      const model = (prisma as any)[target.model];
      if (!model || typeof model.deleteMany !== 'function') {
        perTargetCounts.push({ model: target.model, count: -1 });
        continue;
      }
      const where: Record<string, unknown> = {
        engagementId: { in: engagementIds },
        ...(target.extraWhere || {}),
      };
      try {
        const result = await model.deleteMany({ where });
        perTargetCounts.push({ model: target.model, count: result?.count ?? 0 });
      } catch (err: any) {
        console.error(`[data-purge] ${target.model} deleteMany failed:`, err?.message || err);
        perTargetCounts.push({ model: target.model, count: -1 });
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
      summary: `Methodology Admin purged "${def.label}" data across the firm — ${totalDeleted} rows total`,
      targetType: 'data-purge',
      targetId: def.key,
      metadata: {
        tabKey: def.key,
        tabLabel: def.label,
        targets: perTargetCounts,
        totalDeleted,
        engagementCount: engagementIds.length,
      },
    });
  }

  console.log(`[data-purge] firm=${firmId} tab=${def.key} deleted=${totalDeleted} byUser=${session.user.id} (${session.user.email})`);
  return NextResponse.json({
    ok: true,
    tab: def.key,
    label: def.label,
    targets: perTargetCounts,
    totalDeleted,
    engagementCount: engagementIds.length,
  });
}
