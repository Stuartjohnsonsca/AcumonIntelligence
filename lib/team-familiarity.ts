import { prisma } from '@/lib/db';

export type FamiliarityRow = {
  id: string;
  clientId: string;
  clientName: string;
  clientIsPIE: boolean;
  userId: string;
  userName: string;
  role: string;
  engagementStartDate: string | null;
  roleStartedDate: string | null;
  ceasedActingDate: string | null;
  /** Sorted list of period end dates this user served on this client in this role. Used to render the checkboxes. */
  servedPeriods: string[];
};

export type FamiliarityLimits = {
  riFamiliarityLimitNonPIE: number;
  riFamiliarityLimitPIE: number;
};

const LIMITS_KEY = 'team_familiarity_limits';

export async function getFamiliarityLimits(firmId: string): Promise<FamiliarityLimits> {
  const row = await prisma.methodologyRiskTable.findUnique({
    where: { firmId_tableType: { firmId, tableType: LIMITS_KEY } },
  });
  const data = (row?.data as any) || {};
  return {
    riFamiliarityLimitNonPIE: typeof data.riFamiliarityLimitNonPIE === 'number' ? data.riFamiliarityLimitNonPIE : 10,
    riFamiliarityLimitPIE: typeof data.riFamiliarityLimitPIE === 'number' ? data.riFamiliarityLimitPIE : 5,
  };
}

export async function setFamiliarityLimits(firmId: string, limits: FamiliarityLimits) {
  await prisma.methodologyRiskTable.upsert({
    where: { firmId_tableType: { firmId, tableType: LIMITS_KEY } },
    create: { firmId, tableType: LIMITS_KEY, data: limits as any },
    update: { data: limits as any },
  });
}

/**
 * Walk every engagement for the firm and rebuild TeamFamiliarityEntry rows so that
 * there is one entry per (clientId × userId × role) tuple ever encountered.
 * - Existing entries (with user-entered dates) are left untouched except for ceasedActingDate.
 * - New tuples get a fresh row.
 * - Tuples no longer represented on any current/future engagement get ceasedActingDate set
 *   to the max periodEnd they served on (only if not already set).
 */
export async function rebuildFamiliarityForFirm(firmId: string) {
  const engagements = await prisma.auditEngagement.findMany({
    where: { firmId },
    select: {
      id: true,
      clientId: true,
      teamMembers: { select: { userId: true, role: true } },
      period: { select: { endDate: true } },
    },
  });

  // Collect: (clientId, userId, role) -> set of periodEnd ISO strings
  const tuples = new Map<string, Set<string>>();
  function addTuple(clientId: string, userId: string, role: string, periodEnd: Date | null) {
    const key = `${clientId}|${userId}|${role}`;
    if (!tuples.has(key)) tuples.set(key, new Set<string>());
    if (periodEnd) tuples.get(key)!.add(periodEnd.toISOString());
  }

  for (const e of engagements) {
    for (const tm of e.teamMembers) {
      addTuple(e.clientId, tm.userId, tm.role, e.period?.endDate || null);
    }
  }

  // Upsert each tuple
  for (const [key, periodSet] of tuples) {
    const [clientId, userId, role] = key.split('|');
    const sortedPeriods = Array.from(periodSet).sort();
    const lastPeriod = sortedPeriods[sortedPeriods.length - 1];

    await prisma.teamFamiliarityEntry.upsert({
      where: {
        firmId_clientId_userId_role: { firmId, clientId, userId, role },
      },
      create: {
        firmId,
        clientId,
        userId,
        role,
      },
      update: {},
    });
  }

  return { tuples: tuples.size };
}

/**
 * Build the page-ready familiarity table for the firm.
 * Returns one row per (Client × User × Role) tuple, with system-derived served-periods.
 */
export async function getFamiliarityTable(firmId: string): Promise<{ rows: FamiliarityRow[]; limits: FamiliarityLimits }> {
  await rebuildFamiliarityForFirm(firmId);

  const [entries, engagements, limits] = await Promise.all([
    prisma.teamFamiliarityEntry.findMany({
      where: { firmId },
      include: {
        client: { select: { id: true, clientName: true, isPIE: true } },
        user: { select: { id: true, name: true } },
      },
    }),
    prisma.auditEngagement.findMany({
      where: { firmId },
      select: {
        clientId: true,
        teamMembers: { select: { userId: true, role: true } },
        period: { select: { endDate: true } },
      },
    }),
    getFamiliarityLimits(firmId),
  ]);

  // Build (clientId|userId|role) -> sorted periodEnd ISO strings map
  const periodMap = new Map<string, string[]>();
  for (const e of engagements) {
    for (const tm of e.teamMembers) {
      const key = `${e.clientId}|${tm.userId}|${tm.role}`;
      if (!periodMap.has(key)) periodMap.set(key, []);
      if (e.period?.endDate) periodMap.get(key)!.push(e.period.endDate.toISOString());
    }
  }
  for (const arr of periodMap.values()) arr.sort();

  const rows: FamiliarityRow[] = entries.map(e => {
    const key = `${e.clientId}|${e.userId}|${e.role}`;
    const servedPeriods = Array.from(new Set(periodMap.get(key) || []));
    return {
      id: e.id,
      clientId: e.clientId,
      clientName: e.client?.clientName || '',
      clientIsPIE: !!e.client?.isPIE,
      userId: e.userId,
      userName: e.user?.name || '',
      role: e.role,
      engagementStartDate: e.engagementStartDate?.toISOString() || null,
      roleStartedDate: e.roleStartedDate?.toISOString() || null,
      ceasedActingDate: e.ceasedActingDate?.toISOString() || null,
      servedPeriods,
    };
  });

  // Sort by client name then user name then role
  rows.sort((a, b) => a.clientName.localeCompare(b.clientName) || a.userName.localeCompare(b.userName) || a.role.localeCompare(b.role));

  return { rows, limits };
}

/**
 * Check whether assigning a given user as RI to a given engagement would breach the familiarity limit.
 * Used by the team PUT route to enforce the hard block.
 *
 * Returns:
 *   { allowed: true, projectedTotal, limit, oneAway: boolean }   — under the limit
 *   { allowed: false, projectedTotal, limit, reason }            — at or over the limit (block)
 */
export async function checkRIFamiliarityForAssignment(
  firmId: string,
  clientId: string,
  userId: string,
): Promise<{ allowed: boolean; projectedTotal: number; limit: number; oneAway: boolean; reason?: string }> {
  const [client, engagements, limits] = await Promise.all([
    prisma.client.findUnique({ where: { id: clientId }, select: { isPIE: true } }),
    prisma.auditEngagement.findMany({
      where: { firmId, clientId, teamMembers: { some: { userId, role: 'RI' } } },
      select: { id: true },
    }),
    getFamiliarityLimits(firmId),
  ]);

  const limit = client?.isPIE ? limits.riFamiliarityLimitPIE : limits.riFamiliarityLimitNonPIE;
  const currentCount = engagements.length;
  const projectedTotal = currentCount + 1;
  const oneAway = projectedTotal === limit - 1 || projectedTotal === limit;

  if (projectedTotal >= limit + 1) {
    return {
      allowed: false,
      projectedTotal,
      limit,
      oneAway: false,
      reason: `RI familiarity limit (${limit}) would be exceeded — this would be the user's ${projectedTotal}${ordinal(projectedTotal)} period as RI on this client.`,
    };
  }

  return { allowed: true, projectedTotal, limit, oneAway };
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}
