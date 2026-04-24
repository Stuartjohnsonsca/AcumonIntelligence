import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

/**
 * Firm-wide defaults for Portal Principal escalation-day columns.
 * Used by the Methodology Admin → Firm-Wide Assumptions area so a
 * firm only has to set these once and every engagement picks them
 * up automatically (unless the team overrides on the Opening tab).
 *
 * GET  — returns the current three day values for the caller's firm.
 * PUT  — updates them. Only super admins and methodology admins
 *        may write.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!session.user.firmId) return NextResponse.json({ error: 'No firm' }, { status: 400 });

  try {
    const firm = await prisma.firm.findUnique({
      where: { id: session.user.firmId },
      select: {
        defaultPortalEscalationDays1: true,
        defaultPortalEscalationDays2: true,
        defaultPortalEscalationDays3: true,
      },
    });
    return NextResponse.json({
      days1: firm?.defaultPortalEscalationDays1 ?? 3,
      days2: firm?.defaultPortalEscalationDays2 ?? 3,
      days3: firm?.defaultPortalEscalationDays3 ?? 3,
    });
  } catch (err: any) {
    // Schema drift fallback — if columns aren't live yet, return hard
    // defaults so the admin UI still renders.
    console.error('[portal-escalation-defaults] GET fallback:', err?.message || err);
    return NextResponse.json({ days1: 3, days2: 3, days3: 3, schemaNotReady: true });
  }
}

export async function PUT(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!session.user.firmId) return NextResponse.json({ error: 'No firm' }, { status: 400 });
  if (!session.user.isSuperAdmin && !session.user.isMethodologyAdmin) {
    return NextResponse.json({ error: 'Only super admins and methodology admins can set firm-wide defaults.' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const clamp = (v: any) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return 3;
    return Math.max(1, Math.min(90, Math.round(n)));
  };
  const data = {
    defaultPortalEscalationDays1: clamp(body.days1),
    defaultPortalEscalationDays2: clamp(body.days2),
    defaultPortalEscalationDays3: clamp(body.days3),
  };

  try {
    await prisma.firm.update({ where: { id: session.user.firmId }, data });
    return NextResponse.json({ ok: true, ...{ days1: data.defaultPortalEscalationDays1, days2: data.defaultPortalEscalationDays2, days3: data.defaultPortalEscalationDays3 } });
  } catch (err: any) {
    console.error('[portal-escalation-defaults] PUT failed:', err?.message || err);
    return NextResponse.json({ error: 'Failed to save — columns may not yet be live. Run scripts/sql/portal-principal.sql and retry.' }, { status: 500 });
  }
}
