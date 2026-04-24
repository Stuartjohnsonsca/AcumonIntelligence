import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { assertEngagementWriteAccess } from '@/lib/auth/engagement-auth';
import { resolveEscalationDays } from '@/lib/portal-principal';
import { sendPortalPrincipalDesignationEmail } from '@/lib/email-portal';

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

  // Read the current principal BEFORE the update so we can detect a
  // true transition (null → X, or userA → userB) and only email the
  // NEW principal when designation actually changed. Re-saving the
  // same principal must not re-send the designation email.
  const before = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    select: { portalPrincipalId: true },
  }).catch(() => null) as { portalPrincipalId: string | null } | null;
  const previousPrincipalId = before?.portalPrincipalId ?? null;

  // Validate the picked portal user belongs to this client — prevents
  // cross-tenant leakage if the UI sends a stale ID. Also pull the
  // candidate's name + email so we can email them without a second
  // round-trip after the update.
  let pickedUser: { id: string; name: string; email: string } | null = null;
  if (portalPrincipalId) {
    const candidate = await prisma.clientPortalUser.findUnique({
      where: { id: portalPrincipalId },
      select: { id: true, clientId: true, isActive: true, name: true, email: true },
    });
    if (!candidate || candidate.clientId !== access.clientId || !candidate.isActive) {
      return NextResponse.json({ error: 'Portal Principal candidate not valid for this client.' }, { status: 400 });
    }
    pickedUser = { id: candidate.id, name: candidate.name, email: candidate.email };
  }

  const data: Record<string, any> = {};
  if (portalPrincipalId !== undefined) data.portalPrincipalId = portalPrincipalId || null;
  if (portalEscalationDays1 !== undefined) data.portalEscalationDays1 = normaliseDays(portalEscalationDays1);
  if (portalEscalationDays2 !== undefined) data.portalEscalationDays2 = normaliseDays(portalEscalationDays2);
  if (portalEscalationDays3 !== undefined) data.portalEscalationDays3 = normaliseDays(portalEscalationDays3);

  try {
    // Explicit `select: { id: true }` so Prisma doesn't implicit-SELECT *
    // on AuditEngagement after the UPDATE — that would include columns
    // a client may not have migrated yet (P2022) and always 500. This
    // pattern matches the fix applied to /api/engagements earlier.
    await prisma.auditEngagement.update({
      where: { id: engagementId },
      data,
      select: { id: true },
    });
  } catch (err: any) {
    const code = err?.code || 'unknown';
    const message = err?.message || String(err);
    console.error('[portal-principal] PUT failed:', { code, message, meta: err?.meta });
    let hint: string;
    if (code === 'P2022') {
      hint = 'Column missing in database — run scripts/sql/portal-principal.sql in Supabase SQL Editor and retry.';
    } else if (code === 'P2003') {
      hint = 'Foreign-key violation — the selected Portal Principal user does not exist or belongs to a different client.';
    } else if (code === 'P2025') {
      hint = 'Engagement not found.';
    } else {
      hint = `Database error ${code}. Check server logs for detail.`;
    }
    return NextResponse.json({ error: hint, code, detail: message.slice(0, 300) }, { status: 500 });
  }

  // Fire the "you've been designated Portal Principal" email only on
  // a genuine transition to a new non-null principal. No email on:
  //   - same principal re-saved (no change)
  //   - unsetting the principal (null-out — no-one to notify)
  //   - escalation-day-only update (principal unchanged)
  // We await the email inline so the user sees the principal's
  // greenlight status immediately after save — failing silently if
  // email fails so the core save still succeeds.
  if (pickedUser && portalPrincipalId && portalPrincipalId !== previousPrincipalId) {
    try {
      const eng = await prisma.auditEngagement.findUnique({
        where: { id: engagementId },
        select: {
          auditType: true,
          client: { select: { clientName: true } },
          period: { select: { startDate: true, endDate: true } },
          firm:   { select: { name: true } },
        },
      });
      const periodLabel = eng?.period
        ? `${new Date(eng.period.startDate).toLocaleDateString('en-GB')} – ${new Date(eng.period.endDate).toLocaleDateString('en-GB')}`
        : '';
      const base = process.env.NEXTAUTH_URL || 'https://acumon-website.vercel.app';
      const setupUrl = `${base}/portal/setup/${engagementId}`;
      await sendPortalPrincipalDesignationEmail(pickedUser.email, pickedUser.name, {
        clientName: eng?.client?.clientName || 'your client',
        periodLabel,
        auditType: eng?.auditType || '',
        setupUrl,
        firmName: eng?.firm?.name ?? null,
      });
    } catch (err) {
      console.error('[portal-principal] designation email failed (non-blocking):', (err as any)?.message || err);
    }
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
