/**
 * Portal request routing engine — Phase 2 of the Portal Principal
 * feature.
 *
 * Two entry points:
 *   resolveAssigneeForRequest  — pure function: given a new request's
 *     routingFsLineId / routingTbAccountCode, decide who the primary
 *     assignee is. Used by every code path that creates a PortalRequest.
 *   escalatePendingRequests    — sweep job: looks at every outstanding
 *     request whose current escalation level has timed out, promotes
 *     the level, and notifies the next column's staff. After all three
 *     columns, the Portal Principal gets the escalation. Idempotent:
 *     safe to run every 15 minutes, an hour, or whatever fits the
 *     firm's cadence.
 *
 * The heart of the assignment logic:
 *   1. If the request specifies (fsLineId, tbAccountCode), look for a
 *      matching WorkAllocation row. Fall back to (fsLineId, null).
 *      Fall back to the catch-all row (null, null). Fall back to the
 *      Portal Principal directly.
 *   2. Within the chosen row, pick the LEFTMOST non-null staff slot
 *      as the primary assignee. Null-left → slot 2 → slot 3 → Portal
 *      Principal (the "defaults to Portal Principal until a staff
 *      member is allocated" requirement).
 *   3. If a staff slot points at a user who is no longer active /
 *      access-confirmed, treat the slot as null and fall through.
 */

import { prisma } from '@/lib/db';
import { resolveEscalationDays } from '@/lib/portal-principal';

export interface AssigneeResolution {
  assignedPortalUserId: string | null;
  matchedAllocationId: string | null;
  matchedLevel: 'tb' | 'fs' | 'catch_all' | 'principal' | 'none';
  escalationSlots: {
    slot1: string | null;
    slot2: string | null;
    slot3: string | null;
    principal: string | null;
  };
  reason: string;
}

/**
 * Pick the primary assignee for a new (or re-routed) portal request.
 * Deterministic; no DB writes.
 */
export async function resolveAssigneeForRequest(input: {
  engagementId: string;
  routingFsLineId?: string | null;
  routingTbAccountCode?: string | null;
}): Promise<AssigneeResolution> {
  const { engagementId, routingFsLineId, routingTbAccountCode } = input;

  const eng = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    select: { portalPrincipalId: true, portalSetupCompletedAt: true },
  }).catch(() => null);

  const principalId = eng?.portalPrincipalId ?? null;

  // If setup is not complete there's nobody to route to except the
  // Portal Principal. Defensive — the creation path shouldn't be
  // hitting this if the gate is wired correctly, but belt-and-braces.
  if (!eng?.portalSetupCompletedAt) {
    return {
      assignedPortalUserId: principalId,
      matchedAllocationId: null,
      matchedLevel: 'principal',
      escalationSlots: { slot1: null, slot2: null, slot3: null, principal: principalId },
      reason: principalId
        ? 'Portal Principal setup not yet complete — routing to the Principal directly.'
        : 'No Portal Principal is designated; request will sit unassigned until one is nominated on the Opening tab.',
    };
  }

  // Candidate allocation rows, in order of specificity.
  const candidates: Array<{ fsLineId: string | null; tbAccountCode: string | null; label: 'tb' | 'fs' | 'catch_all' }> = [];
  if (routingFsLineId && routingTbAccountCode) candidates.push({ fsLineId: routingFsLineId, tbAccountCode: routingTbAccountCode, label: 'tb' });
  if (routingFsLineId)                         candidates.push({ fsLineId: routingFsLineId, tbAccountCode: null,                label: 'fs' });
  candidates.push({ fsLineId: null, tbAccountCode: null, label: 'catch_all' });

  // Validate each slot against active / accessConfirmed staff rows.
  async function usableStaffId(userId: string | null): Promise<string | null> {
    if (!userId) return null;
    if (userId === principalId) return principalId; // Portal Principal is always usable
    const hit = await prisma.clientPortalStaffMember.findFirst({
      where: { engagementId, portalUserId: userId, isActive: true, accessConfirmed: true },
      select: { portalUserId: true },
    }).catch(() => null);
    return hit ? hit.portalUserId : null;
  }

  for (const c of candidates) {
    const row = await prisma.clientPortalWorkAllocation.findFirst({
      where: {
        engagementId,
        fsLineId: c.fsLineId,
        tbAccountCode: c.tbAccountCode,
      },
      select: { id: true, staff1UserId: true, staff2UserId: true, staff3UserId: true },
    }).catch(() => null);
    if (!row) continue;

    const [slot1, slot2, slot3] = await Promise.all([
      usableStaffId(row.staff1UserId),
      usableStaffId(row.staff2UserId),
      usableStaffId(row.staff3UserId),
    ]);

    // Leftmost non-null wins as the primary assignee; if all three are
    // null we fall back to the Portal Principal.
    const primary = slot1 ?? slot2 ?? slot3 ?? principalId;
    return {
      assignedPortalUserId: primary,
      matchedAllocationId: row.id,
      matchedLevel: c.label,
      escalationSlots: { slot1, slot2, slot3, principal: principalId },
      reason: `Matched ${c.label === 'tb' ? 'TB-code' : c.label === 'fs' ? 'FS-Line' : 'catch-all'} allocation row; picked ${
        primary === slot1 ? 'column 1' : primary === slot2 ? 'column 2' : primary === slot3 ? 'column 3' : 'Portal Principal fallback'
      }.`,
    };
  }

  // No allocation rows matched — fall back to Portal Principal.
  return {
    assignedPortalUserId: principalId,
    matchedAllocationId: null,
    matchedLevel: 'principal',
    escalationSlots: { slot1: null, slot2: null, slot3: null, principal: principalId },
    reason: 'No matching work-allocation row; routing to the Portal Principal.',
  };
}

/**
 * Sweep outstanding portal requests and advance their escalation
 * level when the column-N SLA has elapsed. Called by the
 * /api/cron/portal-escalation endpoint (attach to the firm's
 * scheduler — cron / Vercel cron / whatever cadence suits).
 *
 * Idempotent: running twice in quick succession is harmless.
 */
export async function escalatePendingRequests(opts: { firmId?: string; now?: Date } = {}): Promise<{
  inspected: number;
  escalated: number;
  logs: Array<{ requestId: string; fromLevel: number; toLevel: number; newAssigneeId: string | null; reason: string }>;
}> {
  const now = opts.now ?? new Date();

  // Scoped to a firm when set — otherwise sweeps globally (useful for
  // a single shared cron).
  const where: any = {
    status: 'outstanding',
    escalationLevel: { lt: 3 },
    assignedAt: { not: null },
    engagementId: { not: null },
  };
  if (opts.firmId) {
    where.engagement = { firmId: opts.firmId };
  }

  const candidates = await prisma.portalRequest.findMany({
    where,
    select: {
      id: true,
      engagementId: true,
      assignedAt: true,
      assignedPortalUserId: true,
      escalationLevel: true,
      escalationLog: true,
      routingFsLineId: true,
      routingTbAccountCode: true,
    },
  }).catch(() => [] as any[]);

  const logs: Array<{ requestId: string; fromLevel: number; toLevel: number; newAssigneeId: string | null; reason: string }> = [];
  let escalated = 0;

  // Cache SLA + routing lookups per engagement — we'll hit the same
  // engagement many times in a sweep.
  const slaCache = new Map<string, { days1: number; days2: number; days3: number }>();
  const routingCache = new Map<string, AssigneeResolution>();

  for (const req of candidates) {
    if (!req.engagementId || !req.assignedAt) continue;

    let sla = slaCache.get(req.engagementId);
    if (!sla) {
      sla = await resolveEscalationDays(req.engagementId);
      slaCache.set(req.engagementId, sla);
    }
    const currentSla = req.escalationLevel === 0 ? sla.days1 : req.escalationLevel === 1 ? sla.days2 : sla.days3;
    const elapsedDays = (now.getTime() - new Date(req.assignedAt).getTime()) / 86_400_000;
    if (elapsedDays < currentSla) continue;

    const routingKey = `${req.engagementId}|${req.routingFsLineId || ''}|${req.routingTbAccountCode || ''}`;
    let resolution = routingCache.get(routingKey);
    if (!resolution) {
      resolution = await resolveAssigneeForRequest({
        engagementId: req.engagementId,
        routingFsLineId: req.routingFsLineId,
        routingTbAccountCode: req.routingTbAccountCode,
      });
      routingCache.set(routingKey, resolution);
    }

    const nextLevel = req.escalationLevel + 1;
    let nextAssigneeId: string | null = null;
    let reason = '';
    if (nextLevel === 1) {
      nextAssigneeId = resolution.escalationSlots.slot2 ?? resolution.escalationSlots.slot3 ?? resolution.escalationSlots.principal ?? null;
      reason = `Column-1 SLA of ${sla.days1} day${sla.days1 === 1 ? '' : 's'} elapsed — notifying column 2.`;
    } else if (nextLevel === 2) {
      nextAssigneeId = resolution.escalationSlots.slot3 ?? resolution.escalationSlots.principal ?? null;
      reason = `Column-2 SLA of ${sla.days2} day${sla.days2 === 1 ? '' : 's'} elapsed — notifying column 3.`;
    } else {
      nextAssigneeId = resolution.escalationSlots.principal ?? null;
      reason = `Column-3 SLA of ${sla.days3} day${sla.days3 === 1 ? '' : 's'} elapsed — escalated to Portal Principal.`;
    }

    const existingLog = Array.isArray(req.escalationLog) ? req.escalationLog as any[] : [];
    const logEntry = {
      at: now.toISOString(),
      fromUserId: req.assignedPortalUserId,
      toUserId: nextAssigneeId,
      fromLevel: req.escalationLevel,
      toLevel: nextLevel,
      reason,
    };
    try {
      await prisma.portalRequest.update({
        where: { id: req.id },
        data: {
          escalationLevel: nextLevel,
          // We don't reassign the "primary" — the prior assignee stays
          // notified. assignedAt advances only so the next-level SLA
          // starts from the escalation point, matching "all three
          // notified staff members are able to respond".
          assignedAt: now,
          escalationLog: [...existingLog, logEntry] as any,
        },
      });
      escalated++;
      logs.push({ requestId: req.id, fromLevel: req.escalationLevel, toLevel: nextLevel, newAssigneeId: nextAssigneeId, reason });
    } catch (err) {
      console.error('[portal-escalation] update failed', req.id, (err as any)?.message || err);
    }
  }

  return { inspected: candidates.length, escalated, logs };
}

/**
 * Hook-in for request creators. Pass the new request's routing fields
 * + engagement id; returns the assigned user + metadata you should
 * persist alongside the PortalRequest row.
 */
export async function buildRoutingForNewRequest(input: {
  engagementId: string;
  routingFsLineId?: string | null;
  routingTbAccountCode?: string | null;
}) {
  const resolution = await resolveAssigneeForRequest(input);
  return {
    routingFsLineId: input.routingFsLineId ?? null,
    routingTbAccountCode: input.routingTbAccountCode ?? null,
    assignedPortalUserId: resolution.assignedPortalUserId,
    assignedAt: new Date(),
    escalationLevel: 0,
    escalationLog: [{
      at: new Date().toISOString(),
      fromUserId: null,
      toUserId: resolution.assignedPortalUserId,
      fromLevel: -1,
      toLevel: 0,
      reason: resolution.reason,
      matchedLevel: resolution.matchedLevel,
    }] as any,
  };
}
