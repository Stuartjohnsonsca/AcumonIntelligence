import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { assertEngagementWriteAccess } from '@/lib/auth/engagement-auth';
import { resolveEscalationDays } from '@/lib/portal-principal';

/**
 * Portal Principal designation + escalation-day overrides for an
 * engagement. Used by the Opening tab so the audit team can pick
 * which client portal user acts as the Portal Principal and, if
 * they want to deviate from the firm-wide defaults, set specific
 * escalation days per column.
 *
 * GET  — returns the current Portal Principal (if any), the
 *        resolved escalation days + their source, and the list of
 *        portal-user candidates (all ClientPortalUser rows for the
 *        engagement's client) the picker can choose from.
 * PUT  — updates portal_principal_id and / or the three escalation
 *        day overrides. Null override fields fall back to firm
 *        defaults at runtime.
 */
async function verifyEngagementAccess(engagementId: string, firmId: string | undefined, isSuperAdmin: boolean) {
  const engagement = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    select: { firmId: true, clientId: true },
  });
  if (!engagement) return null;
  if (engagement.firmId !== firmId && !isSuperAdmin) return null;
  return engagement;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ engagementId: string }> },
) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { engagementId } = await params;
  const access = await verifyEngagementAccess(engagementId, session.user.firmId, session.user.isSuperAdmin);
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const eng = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    select: {
      portalPrincipalId: true,
      portalEscalationDays1: true,
      portalEscalationDays2: true,
      portalEscalationDays3: true,
      portalSetupCompletedAt: true,
    },
  }).catch(() => null) as any;

  const portalUsers = await prisma.clientPortalUser.findMany({
    where: { clientId: access.clientId, isActive: true },
    select: { id: true, name: true, email: true, role: true, isClientAdmin: true },
    orderBy: [{ isClientAdmin: 'desc' }, { name: 'asc' }],
  });

  const resolved = await resolveEscalationDays(engagementId);

  return NextResponse.json({
    portalPrincipalId: eng?.portalPrincipalId ?? null,
    overrides: {
      days1: eng?.portalEscalationDays1 ?? null,
      days2: eng?.portalEscalationDays2 ?? null,
      days3: eng?.portalEscalationDays3 ?? null,
    },
    resolved,
    setupCompletedAt: eng?.portalSetupCompletedAt ?? null,
    candidates: portalUsers,
  });
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ engagementId: string }> },
) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { engagementId } = await params;
  const access = await verifyEngagementAccess(engagementId, session.user.firmId, session.user.isSuperAdmin);
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const writeGuard = await assertEngagementWriteAccess(engagementId, session);
  if (writeGuard instanceof NextResponse) return writeGuard;

  const body = await req.json().catch(() => ({}));
  const { portalPrincipalId, portalEscalationDays1, portalEscalationDays2, portalEscalationDays3 } = body;

  // Validate the picked portal user belongs to this client — prevents
  // cross-tenant leakage if the UI sends a stale ID.
  if (portalPrincipalId) {
    const candidate = await prisma.clientPortalUser.findUnique({
      where: { id: portalPrincipalId },
      select: { clientId: true, isActive: true },
    });
    if (!candidate || candidate.clientId !== access.clientId || !candidate.isActive) {
      return NextResponse.json({ error: 'Portal Principal candidate not valid for this client.' }, { status: 400 });
    }
  }

  const data: Record<string, any> = {};
  if (portalPrincipalId !== undefined) data.portalPrincipalId = portalPrincipalId || null;
  if (portalEscalationDays1 !== undefined) data.portalEscalationDays1 = normaliseDays(portalEscalationDays1);
  if (portalEscalationDays2 !== undefined) data.portalEscalationDays2 = normaliseDays(portalEscalationDays2);
  if (portalEscalationDays3 !== undefined) data.portalEscalationDays3 = normaliseDays(portalEscalationDays3);

  try {
    await prisma.auditEngagement.update({ where: { id: engagementId }, data });
  } catch (err: any) {
    console.error('[portal-principal] PUT failed:', err?.message || err);
    return NextResponse.json({ error: 'Failed to save — the Portal Principal columns may not yet be live in this database. Run scripts/sql/portal-principal.sql and retry.' }, { status: 500 });
  }

  const resolved = await resolveEscalationDays(engagementId);
  return NextResponse.json({ ok: true, resolved });
}

/**
 * Empty string / null / undefined → null (fall back to firm default).
 * Anything else goes through Number + clamping to a sensible range so
 * a rogue "-1" or "10000" can't brick the escalation engine.
 */
function normaliseDays(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(1, Math.min(90, Math.round(n)));
}
