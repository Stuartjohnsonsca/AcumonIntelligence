import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

/**
 * GET /api/engagements/[engagementId]/action-log
 *
 * Returns the full audit trail of button-triggered actions for this
 * engagement, newest first. Used by the Outstanding tab's Audit Trail
 * panel so firm users can see who did what, when — including actions
 * that bypass the green-dot sign-off flow (send to RMM, send for
 * specialist review, accept/reject, template generation, etc.).
 *
 * Scoped by firm — cross-firm reads 404.
 * No pagination yet; engagement-scoped log volume is typically low
 * (dozens to low hundreds per engagement over its lifecycle). Add
 * cursor pagination later if that changes.
 *
 * Query params (optional):
 *   limit=N    — cap the returned count (default 500)
 *   action=X   — filter to a single action slug
 */
export async function GET(req: Request, { params }: { params: Promise<{ engagementId: string }> }) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { engagementId } = await params;

  const eng = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    select: { firmId: true },
  });
  if (!eng || (eng.firmId !== session.user.firmId && !session.user.isSuperAdmin)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const url = new URL(req.url);
  const limitRaw = Number(url.searchParams.get('limit'));
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 && limitRaw <= 2000 ? limitRaw : 500;
  const action = url.searchParams.get('action') || undefined;

  try {
    const model: any = (prisma as any).engagementActionLog;
    if (!model) {
      // Prisma client hasn't been regenerated against the new schema
      // yet — return an empty log rather than 500ing so the UI can
      // render its "no actions recorded yet" empty state.
      return NextResponse.json({ entries: [] });
    }
    const entries = await model.findMany({
      where: { engagementId, ...(action ? { action } : {}) },
      orderBy: { occurredAt: 'desc' },
      take: limit,
    });
    return NextResponse.json({ entries });
  } catch (err: any) {
    // 42P01 = undefined_table. Migration not applied on this env —
    // treat as "no entries yet" rather than failing the UI.
    const code = err?.code || err?.meta?.code;
    if (code === '42P01' || /engagement_action_logs/i.test(String(err?.message || ''))) {
      return NextResponse.json({ entries: [], migrationPending: true });
    }
    console.error('[action-log] read failed:', err);
    return NextResponse.json({ error: err?.message || 'Failed to load audit trail' }, { status: 500 });
  }
}
