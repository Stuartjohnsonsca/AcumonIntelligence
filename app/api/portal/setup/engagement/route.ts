import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { resolvePortalUserFromToken } from '@/lib/portal-session';
import { assertPortalPrincipal, suggestStaffCarryForward, resolveEscalationDays } from '@/lib/portal-principal';

/**
 * GET /api/portal/setup/engagement?token=X&engagementId=Y
 *
 * Portal-side, called by the Portal Principal during first-sign-in.
 * Returns everything the setup UI needs in one hop:
 *
 *   - engagement summary (client name, period dates, audit type)
 *   - current Portal Principal (just for display confirmation)
 *   - currently-approved staff members
 *   - suggested carry-forward staff from prior period / sibling engagements
 *   - FS Lines with TB rows grouped underneath (for the work-allocation grid)
 *   - current work-allocation rows
 *   - resolved escalation-day values (column headers on the grid)
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get('token');
  const engagementId = searchParams.get('engagementId');
  if (!token || !engagementId) {
    return NextResponse.json({ error: 'token and engagementId required' }, { status: 400 });
  }

  const user = await resolvePortalUserFromToken(token);
  if (!user) return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 });

  const guard = await assertPortalPrincipal(user.id, engagementId);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status || 403 });

  const eng = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    select: {
      id: true,
      clientId: true,
      portalPrincipalId: true,
      portalSetupCompletedAt: true,
      auditType: true,
      client: { select: { clientName: true } },
      period: { select: { startDate: true, endDate: true } },
    },
  });
  if (!eng) return NextResponse.json({ error: 'Engagement not found' }, { status: 404 });

  // Current staff members
  const staff = await prisma.clientPortalStaffMember.findMany({
    where: { engagementId, isActive: true },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      accessConfirmed: true,
      portalUserId: true,
      inheritedFromEngagementId: true,
      createdAt: true,
    },
    orderBy: [{ accessConfirmed: 'desc' }, { name: 'asc' }],
  }).catch(() => [] as any[]);

  // Suggestions come from three places, de-duplicated by email so the
  // Principal never sees the same person twice:
  //
  //   1. Prior-period / sibling-group carry-forward (existing behaviour)
  //   2. Active ClientPortalUsers for this client that aren't yet on
  //      the engagement's staff list — catches people the audit team
  //      added via the Opening tab's Contacts panel BEFORE the
  //      Principal was designated (the POST /api/portal/users side
  //      now auto-inserts them forward from the moment a Principal
  //      IS set, but for back-fill we still need to surface them here)
  const already = new Set(staff.map(s => (s.email || '').toLowerCase().trim()));
  const rawSuggestions = await suggestStaffCarryForward(engagementId);
  const contactsList = await prisma.clientPortalUser.findMany({
    where: { clientId: eng.clientId, isActive: true },
    select: { id: true, name: true, email: true, role: true },
  }).catch(() => [] as any[]);

  interface Suggestion { sourceEngagementId: string | null; portalUserId: string | null; name: string; email: string; role: string | null; source: 'prior_period' | 'contacts'; }
  const seen = new Set<string>();
  const suggestions: Suggestion[] = [];
  // Carry-forward first — they're the more specific signal.
  for (const s of rawSuggestions) {
    const key = (s.email || '').toLowerCase().trim();
    if (!key || already.has(key) || seen.has(key)) continue;
    seen.add(key);
    suggestions.push({ ...s, source: 'prior_period' });
  }
  // Then backfill from client-level Contacts-panel users.
  for (const c of contactsList) {
    const key = (c.email || '').toLowerCase().trim();
    if (!key || already.has(key) || seen.has(key)) continue;
    seen.add(key);
    suggestions.push({
      sourceEngagementId: null,
      portalUserId: c.id,
      name: c.name,
      email: c.email,
      role: c.role ?? null,
      source: 'contacts',
    });
  }

  // FS Lines + TB rows for the work-allocation grid. Group by fsLineId.
  // Also surface the list of TB rows that don't yet have an FS Line
  // mapping as "Unmapped" so they can still be allocated.
  const tbRows = await prisma.auditTBRow.findMany({
    where: { engagementId },
    select: { id: true, accountCode: true, description: true, fsLineId: true, sortOrder: true },
    orderBy: [{ fsLineId: 'asc' }, { sortOrder: 'asc' }, { accountCode: 'asc' }],
  });
  const fsLineIds = [...new Set(tbRows.map(r => r.fsLineId).filter(Boolean) as string[])];
  const fsLines = fsLineIds.length > 0
    ? await prisma.methodologyFsLine.findMany({
        where: { id: { in: fsLineIds } },
        select: { id: true, name: true, fsLevelName: true, fsStatementName: true, sortOrder: true },
      })
    : [];
  const fsById = new Map(fsLines.map(l => [l.id, l]));

  interface FsGroup {
    fsLineId: string | null;
    fsLineName: string;
    fsStatementName: string | null;
    fsLevelName: string | null;
    sortOrder: number;
    tbRows: Array<{ accountCode: string; description: string }>;
  }
  const grouped = new Map<string, FsGroup>();
  for (const r of tbRows) {
    const key = r.fsLineId ?? '__unmapped__';
    if (!grouped.has(key)) {
      const fs = r.fsLineId ? fsById.get(r.fsLineId) : null;
      grouped.set(key, {
        fsLineId: r.fsLineId,
        fsLineName: fs?.name ?? 'Unmapped (no FS Line assigned)',
        fsStatementName: fs?.fsStatementName ?? null,
        fsLevelName: fs?.fsLevelName ?? null,
        sortOrder: fs?.sortOrder ?? 9999,
        tbRows: [],
      });
    }
    grouped.get(key)!.tbRows.push({ accountCode: r.accountCode, description: r.description });
  }
  const fsLineGroups = [...grouped.values()].sort((a, b) => a.sortOrder - b.sortOrder);

  const allocations = await prisma.clientPortalWorkAllocation.findMany({
    where: { engagementId },
    select: {
      id: true,
      fsLineId: true,
      tbAccountCode: true,
      staff1UserId: true,
      staff2UserId: true,
      staff3UserId: true,
    },
  }).catch(() => [] as any[]);

  const resolved = await resolveEscalationDays(engagementId);

  return NextResponse.json({
    engagement: {
      id: eng.id,
      clientName: eng.client.clientName,
      periodStart: eng.period?.startDate,
      periodEnd: eng.period?.endDate,
      auditType: eng.auditType,
      setupCompletedAt: eng.portalSetupCompletedAt,
      portalPrincipalId: eng.portalPrincipalId,
    },
    staff,
    suggestions,
    fsLineGroups,
    allocations,
    escalationDays: resolved,
  });
}
