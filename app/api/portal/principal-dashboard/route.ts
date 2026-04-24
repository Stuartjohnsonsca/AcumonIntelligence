import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { resolvePortalUserFromToken } from '@/lib/portal-session';
import { assertPortalPrincipal, resolveEscalationDays } from '@/lib/portal-principal';

/**
 * GET /api/portal/principal-dashboard?token=X&engagementId=Y
 *
 * Aggregates every portal request for an engagement into:
 *   - list view (paginated — sent from the client as &limit=&offset=)
 *   - status totals (outstanding / responded / overdue / escalated)
 *   - speed metrics per-staff: mean / median / p90 response hours
 *   - accuracy proxy: verified vs returned-for-more-info counts
 *     (respondedById → verifiedAt present = verified; chatHistory
 *     contains a firm message AFTER the client reply = returned)
 *   - escalation history: count per level across the engagement
 *   - simple time-series of outstanding count over the last 30 days,
 *     suitable for the dashboard trend chart.
 *
 * Only the Portal Principal for the engagement can call this.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get('token');
  const engagementId = searchParams.get('engagementId');
  if (!token || !engagementId) return NextResponse.json({ error: 'token and engagementId required' }, { status: 400 });

  const user = await resolvePortalUserFromToken(token);
  if (!user) return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 });

  const guard = await assertPortalPrincipal(user.id, engagementId);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status || 403 });

  // Filters from query string — all optional; used to narrow the list
  // view without re-computing the summary metrics (which always cover
  // the full engagement so the header numbers are consistent).
  const status = searchParams.get('status'); // outstanding | responded | escalated
  // Multi-select filters. Accept comma-separated id/code lists so the
  // URL can encode either single-value or multi-value selections
  // cleanly. Fall back to the legacy singular `fsLineId` / `assigneeId`
  // params so any bookmarked URL or drill-down link keeps working.
  const rawFsLineIds = searchParams.get('fsLineIds') || searchParams.get('fsLineId') || '';
  const rawTbCodes = searchParams.get('tbAccountCodes') || '';
  const fsLineIdSet = new Set(rawFsLineIds.split(',').map(s => s.trim()).filter(Boolean));
  const tbAccountCodeSet = new Set(rawTbCodes.split(',').map(s => s.trim()).filter(Boolean));
  const assigneeId = searchParams.get('assigneeId');
  const searchText = (searchParams.get('q') || '').trim();
  // Chart drill-down: narrows the list to a single day's bucket.
  //  day         = ISO yyyy-mm-dd
  //  dayMetric   = 'responded' → show requests responded on that day
  //                'outstanding' → show requests outstanding at end of day
  const day = searchParams.get('day');
  const dayMetric = searchParams.get('dayMetric'); // 'responded' | 'outstanding'
  const limit = Math.min(200, Math.max(10, Number(searchParams.get('limit') || 50)));
  const offset = Math.max(0, Number(searchParams.get('offset') || 0));

  const sla = await resolveEscalationDays(engagementId);
  const now = new Date();

  // All requests for the engagement. We fetch the full set so metric
  // computation is client-server consistent; list view slices after
  // filters are applied.
  const all = await prisma.portalRequest.findMany({
    where: { engagementId },
    select: {
      id: true,
      section: true,
      question: true,
      status: true,
      requestedAt: true,
      respondedAt: true,
      respondedById: true,
      respondedByName: true,
      verifiedAt: true,
      routingFsLineId: true,
      routingTbAccountCode: true,
      assignedPortalUserId: true,
      assignedAt: true,
      escalationLevel: true,
      escalationLog: true,
      chatHistory: true,
      evidenceTag: true,
    },
    orderBy: { requestedAt: 'desc' },
  }).catch(() => [] as any[]);

  // Resolve FS Line names for filter pills + list rendering.
  const fsLineIdsInRequests = [...new Set(all.map(r => r.routingFsLineId).filter(Boolean) as string[])];
  const fsLines = fsLineIdsInRequests.length > 0
    ? await prisma.methodologyFsLine.findMany({
        where: { id: { in: fsLineIdsInRequests } },
        select: { id: true, name: true },
      })
    : [];
  const fsNameById = new Map(fsLines.map(l => [l.id, l.name]));

  // TB codes per FS Line — fed to the multi-select filter UI so the
  // Principal can drill in past just FS Line. We resolve the codes
  // from AuditTBRow (authoritative source) rather than from requests
  // alone, so the filter shows every TB code under an FS Line even
  // when no request has been raised against it yet.
  const tbRowsForFilter = fsLineIdsInRequests.length > 0
    ? await prisma.auditTBRow.findMany({
        where: { engagementId, fsLineId: { in: fsLineIdsInRequests } },
        select: { accountCode: true, description: true, fsLineId: true },
        orderBy: [{ fsLineId: 'asc' }, { accountCode: 'asc' }],
      })
    : [];
  const tbByFsLine = new Map<string, Array<{ accountCode: string; description: string }>>();
  for (const r of tbRowsForFilter) {
    if (!r.fsLineId) continue;
    if (!tbByFsLine.has(r.fsLineId)) tbByFsLine.set(r.fsLineId, []);
    tbByFsLine.get(r.fsLineId)!.push({ accountCode: r.accountCode, description: r.description });
  }

  // Staff name lookup for assignee rendering.
  const staff = await prisma.clientPortalStaffMember.findMany({
    where: { engagementId },
    select: { portalUserId: true, name: true, email: true },
  });
  const nameByUser = new Map<string, string>();
  for (const s of staff) if (s.portalUserId) nameByUser.set(s.portalUserId, s.name);
  const principalRow = await prisma.clientPortalUser.findUnique({
    where: { id: user.id },
    select: { name: true },
  });
  if (user.id && principalRow) nameByUser.set(user.id, `${principalRow.name} (Principal)`);

  // ── Summary metrics ─────────────────────────────────────────────────
  const outstandingRows = all.filter(r => r.status === 'outstanding');
  const respondedRows = all.filter(r => r.status === 'responded' || !!r.respondedAt);
  const verifiedRows = all.filter(r => !!r.verifiedAt);
  const escalatedRows = outstandingRows.filter(r => (r.escalationLevel ?? 0) > 0);
  const overdueRows = outstandingRows.filter(r => {
    if (!r.assignedAt) return false;
    const hours = (now.getTime() - new Date(r.assignedAt).getTime()) / 3_600_000;
    const columnSla = r.escalationLevel === 0 ? sla.days1 : r.escalationLevel === 1 ? sla.days2 : sla.days3;
    return hours > columnSla * 24;
  });

  const responseHoursByStaff = new Map<string, number[]>();
  for (const r of respondedRows) {
    if (!r.respondedAt || !r.assignedAt) continue;
    const hours = (new Date(r.respondedAt).getTime() - new Date(r.assignedAt).getTime()) / 3_600_000;
    const assignedTo = r.assignedPortalUserId || 'unassigned';
    const arr = responseHoursByStaff.get(assignedTo) || [];
    arr.push(hours);
    responseHoursByStaff.set(assignedTo, arr);
  }

  function stats(values: number[]) {
    if (values.length === 0) return { n: 0, meanHours: null, medianHours: null, p90Hours: null };
    const sorted = [...values].sort((a, b) => a - b);
    const mean = sorted.reduce((s, v) => s + v, 0) / sorted.length;
    const median = sorted[Math.floor(sorted.length / 2)];
    const p90 = sorted[Math.floor(sorted.length * 0.9)] ?? sorted[sorted.length - 1];
    return {
      n: sorted.length,
      meanHours: Math.round(mean * 10) / 10,
      medianHours: Math.round(median * 10) / 10,
      p90Hours: Math.round(p90 * 10) / 10,
    };
  }

  const overallResponseStats = stats([...responseHoursByStaff.values()].flat());
  const perStaffStats = [...responseHoursByStaff.entries()].map(([userId, arr]) => ({
    userId,
    name: nameByUser.get(userId) || userId,
    ...stats(arr),
  })).sort((a, b) => (b.n - a.n));

  // Accuracy proxy: a request is "clean" when it went through without
  // the firm sending any follow-up messages after the client reply. A
  // "returned" request has at least one firm chatHistory entry dated
  // after the client's reply. Cheap heuristic; good enough for a
  // speedometer graph.
  function isReturnedForMore(r: any): boolean {
    const history = Array.isArray(r.chatHistory) ? r.chatHistory : [];
    let sawClient = false;
    for (const msg of history) {
      if (msg?.from === 'client') { sawClient = true; continue; }
      if (sawClient && msg?.from === 'firm') return true;
    }
    return false;
  }
  const returnedForMore = respondedRows.filter(isReturnedForMore).length;
  const cleanFirstTime = respondedRows.length - returnedForMore;

  // 30-day outstanding trend — one bucket per day for the last 30 days.
  const trend: Array<{ date: string; outstanding: number; responded: number }> = [];
  for (let i = 29; i >= 0; i--) {
    const day = new Date(now);
    day.setUTCHours(0, 0, 0, 0);
    day.setUTCDate(day.getUTCDate() - i);
    const next = new Date(day);
    next.setUTCDate(day.getUTCDate() + 1);
    const outstandingCount = all.filter(r =>
      new Date(r.requestedAt) <= next
      && (!r.respondedAt || new Date(r.respondedAt) > next),
    ).length;
    const respondedCount = all.filter(r =>
      r.respondedAt && new Date(r.respondedAt) >= day && new Date(r.respondedAt) < next,
    ).length;
    trend.push({
      date: day.toISOString().slice(0, 10),
      outstanding: outstandingCount,
      responded: respondedCount,
    });
  }

  // Pre-compute the day bucket [dayStart, dayEnd) once so the list
  // filter doesn't re-parse it per row.
  let dayStart: Date | null = null;
  let dayEnd: Date | null = null;
  if (day && /^\d{4}-\d{2}-\d{2}$/.test(day)) {
    dayStart = new Date(`${day}T00:00:00.000Z`);
    dayEnd = new Date(dayStart.getTime() + 86_400_000);
  }

  // ── Filtered list view ──────────────────────────────────────────────
  const filtered = all.filter(r => {
    if (status === 'outstanding' && r.status !== 'outstanding') return false;
    if (status === 'responded' && !r.respondedAt) return false;
    if (status === 'escalated' && (r.escalationLevel ?? 0) === 0) return false;
    if (status === 'overdue') {
      if (r.status !== 'outstanding' || !r.assignedAt) return false;
      const hours = (now.getTime() - new Date(r.assignedAt).getTime()) / 3_600_000;
      const columnSla = r.escalationLevel === 0 ? sla.days1 : r.escalationLevel === 1 ? sla.days2 : sla.days3;
      if (hours <= columnSla * 24) return false;
    }
    // Multi-select semantics: a request matches if EITHER its
    // routingFsLineId is in the selected FS Lines OR its
    // routingTbAccountCode is in the selected TB codes. An empty
    // selection means "no filter". Picking FS Line + TB code at
    // the same time shows requests matching either — the UX is
    // an additive filter, not an intersection.
    if (fsLineIdSet.size > 0 || tbAccountCodeSet.size > 0) {
      const fsHit = !!r.routingFsLineId && fsLineIdSet.has(r.routingFsLineId);
      const tbHit = !!r.routingTbAccountCode && tbAccountCodeSet.has(r.routingTbAccountCode);
      if (!fsHit && !tbHit) return false;
    }
    if (assigneeId && r.assignedPortalUserId !== assigneeId) return false;
    if (searchText && !(r.question || '').toLowerCase().includes(searchText.toLowerCase())) return false;
    if (dayStart && dayEnd) {
      if (dayMetric === 'responded') {
        if (!r.respondedAt) return false;
        const t = new Date(r.respondedAt);
        if (t < dayStart || t >= dayEnd) return false;
      } else {
        // outstanding-on-day: requested on/before the day AND not yet
        // responded by end of the day.
        if (new Date(r.requestedAt) > dayEnd) return false;
        if (r.respondedAt && new Date(r.respondedAt) < dayEnd) return false;
      }
    }
    return true;
  });

  const page = filtered.slice(offset, offset + limit).map(r => ({
    id: r.id,
    section: r.section,
    question: (r.question || '').slice(0, 400),
    status: r.status,
    requestedAt: r.requestedAt,
    respondedAt: r.respondedAt,
    respondedByName: r.respondedByName,
    escalationLevel: r.escalationLevel ?? 0,
    assignedPortalUserId: r.assignedPortalUserId,
    assignedPortalUserName: r.assignedPortalUserId ? (nameByUser.get(r.assignedPortalUserId) || null) : null,
    routingFsLineId: r.routingFsLineId,
    routingFsLineName: r.routingFsLineId ? (fsNameById.get(r.routingFsLineId) || null) : null,
    routingTbAccountCode: r.routingTbAccountCode,
    isReturned: isReturnedForMore(r),
  }));

  return NextResponse.json({
    engagementId,
    sla,
    totals: {
      all: all.length,
      outstanding: outstandingRows.length,
      responded: respondedRows.length,
      verified: verifiedRows.length,
      overdue: overdueRows.length,
      escalated: escalatedRows.length,
      cleanFirstTime,
      returnedForMore,
    },
    responseStats: {
      overall: overallResponseStats,
      perStaff: perStaffStats,
    },
    trend,
    filters: {
      // fsLines carries a nested `tbCodes` array so the filter UI
      // can render a multi-select popover with TB codes embedded
      // under each FS Line. Empty tbCodes = FS Line has no TB rows
      // (the filter just shows the FS Line itself, no children).
      fsLines: fsLines.map(l => ({
        id: l.id,
        name: l.name,
        tbCodes: tbByFsLine.get(l.id) || [],
      })),
      staff: [...nameByUser.entries()].map(([id, name]) => ({ id, name })),
    },
    list: {
      rows: page,
      total: filtered.length,
      limit,
      offset,
    },
  });
}
