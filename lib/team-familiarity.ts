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
  /** 'team' = TeamFamiliarityEntry / engagement team member.
   *  'specialist' = synthesised from AuditEngagement.specialists. The
   *  latter have no userId of their own — we key them by email-or-name
   *  so cross-engagement appearances aggregate into a single row. */
  memberType: 'team' | 'specialist';
  /** Distinct audit categories the engagements behind this row carried
   *  (PIE / Listed / Charity etc — the per-engagement field added to
   *  AuditEngagement). Rendered as pills next to the member name in the
   *  Audit Rotation Record table; drives the multi-select category
   *  filter. */
  auditCategories: string[];
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
        // auditCategory is read with `as any` because it was added by
        // a recent schema change; tolerate clients that haven't pushed
        // the schema yet by treating missing values as null.
        teamMembers: { select: { userId: true, role: true } },
        specialists: { select: { name: true, email: true, specialistType: true } },
        period: { select: { endDate: true } },
      } as any,
    }) as Promise<any[]>,
    getFamiliarityLimits(firmId),
  ]);

  // Build (clientId|userId|role) -> sorted periodEnd ISO strings map +
  // a parallel categories-per-tuple map so each row can render the
  // distinct categories that have appeared on its engagements.
  const periodMap = new Map<string, string[]>();
  const categoriesMap = new Map<string, Set<string>>();
  function note(key: string, periodEnd: Date | null | undefined, auditCategory: string | null | undefined) {
    if (!periodMap.has(key)) periodMap.set(key, []);
    if (periodEnd) periodMap.get(key)!.push(periodEnd.toISOString());
    if (auditCategory && auditCategory.trim()) {
      if (!categoriesMap.has(key)) categoriesMap.set(key, new Set<string>());
      categoriesMap.get(key)!.add(auditCategory.trim());
    }
  }

  for (const e of engagements) {
    const cat = (e as any).auditCategory ?? null;
    for (const tm of e.teamMembers) {
      note(`${e.clientId}|${tm.userId}|${tm.role}`, e.period?.endDate, cat);
    }
    // Synthesised specialist rows — one (client, person, type) tuple
    // per engagement.specialists entry. Specialists are typically
    // external and have no userId, so we key by normalised email
    // (falling back to name) so the same person across engagements
    // aggregates into a single row.
    for (const sp of (e.specialists || []) as Array<{ name: string; email: string | null; specialistType: string }>) {
      const key = `${e.clientId}|spec:${specialistKey(sp)}|${sp.specialistType}`;
      note(key, e.period?.endDate, cat);
    }
  }
  for (const arr of periodMap.values()) arr.sort();

  // Real team-member rows
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
      memberType: 'team',
      auditCategories: Array.from(categoriesMap.get(key) || []).sort(),
    };
  });

  // Synthesised specialist rows — derived afresh on every read since
  // they have no TeamFamiliarityEntry to back them. Use the periodMap
  // keys we noted above to discover all (client, specialist, type)
  // tuples and look up the human details from the latest engagement
  // that featured them.
  const specialistMeta = new Map<string, { name: string; email: string | null }>();
  for (const e of engagements) {
    for (const sp of (e.specialists || []) as Array<{ name: string; email: string | null; specialistType: string }>) {
      const innerKey = specialistKey(sp);
      if (!specialistMeta.has(innerKey)) specialistMeta.set(innerKey, { name: sp.name, email: sp.email });
    }
  }
  const clientNameById = new Map<string, { name: string; isPIE: boolean }>();
  for (const r of rows) clientNameById.set(r.clientId, { name: r.clientName, isPIE: r.clientIsPIE });
  // Some clients may only have specialist rows and no team-member
  // rows — fill in their names too.
  if (engagements.length > 0) {
    const missing = Array.from(new Set(engagements.map((e: any) => e.clientId))).filter(c => !clientNameById.has(c));
    if (missing.length > 0) {
      const clients = await prisma.client.findMany({
        where: { id: { in: missing } },
        select: { id: true, clientName: true, isPIE: true },
      });
      for (const c of clients) clientNameById.set(c.id, { name: c.clientName, isPIE: !!c.isPIE });
    }
  }
  for (const key of periodMap.keys()) {
    if (!key.includes('|spec:')) continue;
    const [clientId, specPart, role] = key.split('|');
    const innerKey = specPart.slice('spec:'.length);
    const meta = specialistMeta.get(innerKey);
    if (!meta) continue;
    const client = clientNameById.get(clientId);
    const servedPeriods = Array.from(new Set(periodMap.get(key) || []));
    rows.push({
      id: `spec:${clientId}:${innerKey}:${role}`,
      clientId,
      clientName: client?.name || '',
      clientIsPIE: !!client?.isPIE,
      userId: `spec:${innerKey}`,
      userName: meta.name || meta.email || '(unnamed specialist)',
      role,
      engagementStartDate: null,
      roleStartedDate: null,
      ceasedActingDate: null,
      servedPeriods,
      memberType: 'specialist',
      auditCategories: Array.from(categoriesMap.get(key) || []).sort(),
    });
  }

  // Sort by client name then user name then role
  rows.sort((a, b) => a.clientName.localeCompare(b.clientName) || a.userName.localeCompare(b.userName) || a.role.localeCompare(b.role));

  return { rows, limits };
}

/** Normalised key used to group specialist appearances across
 *  engagements into a single rotation row. Email wins when present
 *  (more reliable across spelling variants); name is the fallback. */
function specialistKey(sp: { name: string; email: string | null }): string {
  const e = (sp.email || '').trim().toLowerCase();
  if (e) return `e:${e}`;
  return `n:${(sp.name || '').trim().toLowerCase()}`;
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
