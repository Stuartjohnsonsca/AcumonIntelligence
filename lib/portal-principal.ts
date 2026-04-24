/**
 * Portal Principal — shared helpers for the client-portal access /
 * staff-allocation feature.
 *
 * All logic that decides (a) who the Portal Principal is for a given
 * engagement, (b) whether a client portal user is allowed to log in,
 * and (c) how requests get routed to staff slots lives here so the
 * API routes and server components can share the same rules.
 *
 * Schema drift resilience — every helper is try/catch'd so a missing
 * column (prior to running scripts/sql/portal-principal.sql) returns
 * a sensible default rather than 500ing every portal request.
 */

import { prisma } from '@/lib/db';

// ─── Access gating ──────────────────────────────────────────────────────────

export interface PortalAccessDecision {
  allowed: boolean;
  reason:
    | 'ok'
    | 'portal-principal'                   // caller is the Portal Principal for at least one engagement → always allowed
    | 'legacy-client'                      // client hasn't onboarded Portal Principal yet → fall back to old behaviour
    | 'no-allocation'                      // no engagement allocates this user — block
    | 'awaiting-setup'                     // allocated but Portal Principal hasn't completed setup
    | 'access-not-confirmed'               // allocated but Portal Principal hasn't ticked accessConfirmed for this user
    | 'db-error';
  engagementIds: string[];                  // engagements this user is allowed to see
  isPortalPrincipalFor: string[];           // engagements where this user is the Portal Principal
}

/**
 * Decide whether a ClientPortalUser can act on this tenant.
 *
 * Rules (strictly enforced):
 *  1. If the user is the Portal Principal for any of the client's
 *     engagements → ALLOWED (they ARE the gate-keeper; we can't gate
 *     them behind themselves).
 *  2. Otherwise, the user must appear on a ClientPortalStaffMember row
 *     whose accessConfirmed = true AND whose engagement has
 *     portalSetupCompletedAt set (the Portal Principal has finished
 *     the first-sign-in setup).
 *  3. If neither condition is met → DENY. The login route surfaces
 *     the `reason` so the UI can tell the user what to do next.
 *
 * Returns a list of engagementIds the user is allowed to see so
 * downstream guards don't have to re-run this query.
 */
export async function decidePortalAccess(portalUserId: string, clientId: string): Promise<PortalAccessDecision> {
  try {
    // Check Portal Principal status first — it's the unconditional pass.
    const principalEngagements = await prisma.auditEngagement.findMany({
      where: { clientId, portalPrincipalId: portalUserId },
      select: { id: true },
    }).catch(() => [] as Array<{ id: string }>);

    if (principalEngagements.length > 0) {
      return {
        allowed: true,
        reason: 'portal-principal',
        engagementIds: principalEngagements.map(e => e.id),
        isPortalPrincipalFor: principalEngagements.map(e => e.id),
      };
    }

    // Staff-member route: must have an active, access-confirmed row on
    // an engagement whose Portal Principal has completed setup.
    const memberships = await prisma.clientPortalStaffMember.findMany({
      where: {
        portalUserId,
        isActive: true,
        accessConfirmed: true,
        engagement: { clientId, portalSetupCompletedAt: { not: null } },
      },
      select: { engagementId: true },
    }).catch(() => [] as Array<{ engagementId: string }>);

    if (memberships.length > 0) {
      return {
        allowed: true,
        reason: 'ok',
        engagementIds: memberships.map(m => m.engagementId),
        isPortalPrincipalFor: [],
      };
    }

    // Legacy-client bridge — if the client has never been onboarded
    // to the Portal Principal feature (no engagements with a Portal
    // Principal designated AND no staff-member rows exist for this
    // client anywhere), we fall back to the old login behaviour: any
    // active ClientPortalUser for the client can log in. This stops
    // the Phase 1a deploy from silently locking out every pre-existing
    // portal user until their audit team nominates a Portal Principal.
    // Once anyone on the client opts in to the new feature, the
    // strict gate re-engages for that client.
    const [clientPrincipalCount, clientStaffCount] = await Promise.all([
      prisma.auditEngagement.count({
        where: { clientId, portalPrincipalId: { not: null } },
      }).catch(() => 0),
      prisma.clientPortalStaffMember.count({
        where: { engagement: { clientId } },
      }).catch(() => 0),
    ]);
    if (clientPrincipalCount === 0 && clientStaffCount === 0) {
      return {
        allowed: true,
        reason: 'legacy-client',
        engagementIds: [],
        isPortalPrincipalFor: [],
      };
    }

    // Distinguish "allocated but not confirmed / awaiting setup" from
    // "never allocated" — surface the specific reason so the UI can
    // tell the user whether to chase the Portal Principal or raise
    // the access request with the audit team.
    const anyAllocations = await prisma.clientPortalStaffMember.findMany({
      where: {
        portalUserId,
        engagement: { clientId },
      },
      select: {
        engagementId: true,
        accessConfirmed: true,
        isActive: true,
        engagement: { select: { portalSetupCompletedAt: true } },
      },
    }).catch(() => [] as any[]);

    if (anyAllocations.length === 0) {
      return { allowed: false, reason: 'no-allocation', engagementIds: [], isPortalPrincipalFor: [] };
    }

    const setupIncomplete = anyAllocations.some(a => !a.engagement?.portalSetupCompletedAt);
    if (setupIncomplete) {
      return { allowed: false, reason: 'awaiting-setup', engagementIds: [], isPortalPrincipalFor: [] };
    }

    return { allowed: false, reason: 'access-not-confirmed', engagementIds: [], isPortalPrincipalFor: [] };
  } catch (err) {
    // Schema drift safety net — if the new columns / tables aren't
    // live yet we fall back to DENY (strictest option), which is the
    // correct default for an access check.
    console.error('[portal-principal] decidePortalAccess failed:', (err as any)?.message || err);
    return { allowed: false, reason: 'db-error', engagementIds: [], isPortalPrincipalFor: [] };
  }
}

// ─── Escalation days resolution ─────────────────────────────────────────────

export interface EscalationDays {
  days1: number;
  days2: number;
  days3: number;
  source: 'engagement-override' | 'firm-default' | 'hard-default';
}

/**
 * Resolve the 3 escalation day values for an engagement. Resolution
 * order:
 *   1. engagement-level override (portalEscalationDaysN) if set
 *   2. firm-level default (Firm.defaultPortalEscalationDaysN) if set
 *   3. hard-coded 3 days per column
 */
export async function resolveEscalationDays(engagementId: string): Promise<EscalationDays> {
  try {
    const eng = await prisma.auditEngagement.findUnique({
      where: { id: engagementId },
      select: {
        portalEscalationDays1: true,
        portalEscalationDays2: true,
        portalEscalationDays3: true,
        firm: {
          select: {
            defaultPortalEscalationDays1: true,
            defaultPortalEscalationDays2: true,
            defaultPortalEscalationDays3: true,
          },
        },
      },
    }).catch(() => null) as any;

    const overrides = eng && (eng.portalEscalationDays1 != null || eng.portalEscalationDays2 != null || eng.portalEscalationDays3 != null);
    if (overrides) {
      return {
        days1: eng.portalEscalationDays1 ?? eng.firm?.defaultPortalEscalationDays1 ?? 3,
        days2: eng.portalEscalationDays2 ?? eng.firm?.defaultPortalEscalationDays2 ?? 3,
        days3: eng.portalEscalationDays3 ?? eng.firm?.defaultPortalEscalationDays3 ?? 3,
        source: 'engagement-override',
      };
    }
    if (eng?.firm) {
      return {
        days1: eng.firm.defaultPortalEscalationDays1 ?? 3,
        days2: eng.firm.defaultPortalEscalationDays2 ?? 3,
        days3: eng.firm.defaultPortalEscalationDays3 ?? 3,
        source: 'firm-default',
      };
    }
  } catch (err) {
    console.error('[portal-principal] resolveEscalationDays failed:', (err as any)?.message || err);
  }
  return { days1: 3, days2: 3, days3: 3, source: 'hard-default' };
}

// ─── Prior-period / sibling-group staff carry-forward ───────────────────────

/**
 * Returns candidate staff members to seed the Portal Principal's
 * first-sign-in screen with. Looks at (in priority order):
 *
 *   1. Same client, prior-period engagement (preferred — same
 *      business, same people)
 *   2. Other engagements on the same client with completed setup
 *      (e.g. a parallel group engagement)
 *
 * Deduplicated by normalised email. Only rows whose Portal Principal
 * already confirmed access are surfaced — an unconfirmed row would
 * mean the prior PP never actually authorised that person, so we
 * don't re-present them as a suggested carry-forward.
 */
export async function suggestStaffCarryForward(engagementId: string): Promise<Array<{
  sourceEngagementId: string;
  portalUserId: string | null;
  name: string;
  email: string;
  role: string | null;
}>> {
  const eng = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    select: { clientId: true, priorPeriodEngagementId: true },
  }).catch(() => null);
  if (!eng) return [];

  const candidateEngagementIds: string[] = [];
  if (eng.priorPeriodEngagementId) candidateEngagementIds.push(eng.priorPeriodEngagementId);

  // Sibling engagements on the same client (e.g. group audit).
  const siblings = await prisma.auditEngagement.findMany({
    where: {
      clientId: eng.clientId,
      id: { not: engagementId },
      portalSetupCompletedAt: { not: null },
    },
    select: { id: true },
    orderBy: { updatedAt: 'desc' },
    take: 5,
  }).catch(() => [] as Array<{ id: string }>);
  for (const s of siblings) {
    if (!candidateEngagementIds.includes(s.id)) candidateEngagementIds.push(s.id);
  }

  if (candidateEngagementIds.length === 0) return [];

  const priorMembers = await prisma.clientPortalStaffMember.findMany({
    where: {
      engagementId: { in: candidateEngagementIds },
      accessConfirmed: true,
      isActive: true,
    },
    select: {
      engagementId: true,
      portalUserId: true,
      name: true,
      email: true,
      role: true,
    },
    orderBy: { updatedAt: 'desc' },
  }).catch(() => [] as any[]);

  // Dedupe by normalised email, keeping the first (most recent).
  const seen = new Set<string>();
  const out: Array<{ sourceEngagementId: string; portalUserId: string | null; name: string; email: string; role: string | null }> = [];
  for (const m of priorMembers) {
    const key = (m.email || '').toLowerCase().trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({
      sourceEngagementId: m.engagementId,
      portalUserId: m.portalUserId ?? null,
      name: m.name,
      email: m.email,
      role: m.role ?? null,
    });
  }
  return out;
}

// ─── Principal-only guard (for /api/portal/setup/* endpoints) ───────────────

export interface PrincipalGuardResult {
  ok: boolean;
  portalUserId?: string;
  clientId?: string;
  error?: string;
  status?: number;
}

/**
 * Assert that the given portal user is the Portal Principal for the
 * given engagement. Used by every /api/portal/setup/* endpoint so a
 * staff member can't elevate themselves by calling the setup APIs
 * directly.
 */
export async function assertPortalPrincipal(portalUserId: string, engagementId: string): Promise<PrincipalGuardResult> {
  const eng = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    select: { clientId: true, portalPrincipalId: true },
  }).catch(() => null);
  if (!eng) return { ok: false, error: 'Engagement not found', status: 404 };
  if (!eng.portalPrincipalId) {
    return { ok: false, error: 'No Portal Principal is designated for this engagement yet. Ask the audit team to nominate one on the Opening tab.', status: 409 };
  }
  if (eng.portalPrincipalId !== portalUserId) {
    return { ok: false, error: 'Only the Portal Principal can perform this action.', status: 403 };
  }
  return { ok: true, portalUserId, clientId: eng.clientId };
}
