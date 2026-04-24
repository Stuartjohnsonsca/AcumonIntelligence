import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { resolvePortalUserFromToken } from '@/lib/portal-session';
import { assertPortalPrincipal } from '@/lib/portal-principal';
import { interpretSearchQuery, logPortalSearch, type AiSearchContext } from '@/lib/portal-ai-search';

/**
 * POST /api/portal/ai-search?token=X
 * Body: { engagementIds: string[], query: string }
 *
 * Turn a natural-language query into the structured filter shape the
 * Principal dashboard already understands. The dashboard applies the
 * filter locally — this endpoint doesn't return results, just the
 * filter object. That way the dashboard keeps its existing filter +
 * pagination plumbing and the AI step is layered on top.
 *
 * Each call is logged to PortalSearchLog so Methodology Admins can
 * later promote popular queries to "featured" for the whole firm.
 */
export async function POST(req: Request) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get('token');
  if (!token) return NextResponse.json({ error: 'token required' }, { status: 400 });

  const user = await resolvePortalUserFromToken(token);
  if (!user) return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { engagementIds, query } = body as { engagementIds: string[]; query: string };
  if (!Array.isArray(engagementIds) || engagementIds.length === 0) {
    return NextResponse.json({ error: 'engagementIds required' }, { status: 400 });
  }
  if (!query || typeof query !== 'string' || !query.trim()) {
    return NextResponse.json({ error: 'query required' }, { status: 400 });
  }

  // Authorise each engagementId — Principal gate for now (the feature
  // will extend beyond Principal later, but the gate is the same
  // pattern). Silently drop any id the caller doesn't have access to,
  // so a stale multi-select can't lock the whole search.
  const validEngagementIds: string[] = [];
  for (const id of engagementIds) {
    const g = await assertPortalPrincipal(user.id, id);
    if (g.ok) validEngagementIds.push(id);
  }
  if (validEngagementIds.length === 0) {
    return NextResponse.json({ error: 'No accessible engagements for this caller.' }, { status: 403 });
  }

  // Build the catalogue the LLM will be grounded on.
  const [tbRows, staff, principalRow, engagements] = await Promise.all([
    prisma.auditTBRow.findMany({
      where: { engagementId: { in: validEngagementIds } },
      select: { accountCode: true, description: true, fsLineId: true, fsNoteLevel: true, fsLevel: true },
    }).catch(() => []),
    prisma.clientPortalStaffMember.findMany({
      where: { engagementId: { in: validEngagementIds }, isActive: true },
      select: { portalUserId: true, name: true },
    }).catch(() => []),
    prisma.clientPortalUser.findUnique({
      where: { id: user.id },
      select: { id: true, name: true },
    }),
    prisma.auditEngagement.findMany({
      where: { id: { in: validEngagementIds } },
      select: { id: true, firmId: true, clientId: true, firm: { select: { id: true } } },
    }).catch(() => []),
  ]);

  // Collate FS Lines from the TB rows (same resolution as the
  // Principal dashboard does) — canonical fsLineId preferred, then
  // fsNoteLevel string as a synthetic group.
  const firmId = engagements[0]?.firmId ?? null;
  const firmCatalogue = firmId
    ? await prisma.methodologyFsLine.findMany({
        where: { firmId, isActive: true },
        select: { id: true, name: true },
      })
    : [];
  const fsByName = new Map<string, { id: string; name: string }>();
  for (const f of firmCatalogue) fsByName.set((f.name || '').trim().toLowerCase(), f);

  const fsLineMap = new Map<string, string>();         // id → displayName
  const tbCodeRows: Array<{ accountCode: string; description: string; fsLineName?: string }> = [];
  for (const r of tbRows) {
    const desc = (r.description || '').trim();
    if (!desc) continue;
    let resolvedId = r.fsLineId ?? null;
    if (!resolvedId && r.fsNoteLevel) resolvedId = fsByName.get(r.fsNoteLevel.trim().toLowerCase())?.id ?? null;
    if (!resolvedId && r.fsLevel) resolvedId = fsByName.get(r.fsLevel.trim().toLowerCase())?.id ?? null;
    const groupKey = resolvedId || `note:${(r.fsNoteLevel || '').trim()}`;
    const fsName = resolvedId
      ? (firmCatalogue.find(f => f.id === resolvedId)?.name || r.fsNoteLevel || 'Unclassified')
      : (r.fsNoteLevel || 'Unclassified');
    if (!groupKey) continue;
    fsLineMap.set(groupKey, fsName);
    tbCodeRows.push({ accountCode: r.accountCode, description: desc, fsLineName: fsName });
  }

  const ctx: AiSearchContext = {
    engagementIds: validEngagementIds,
    fsLines: [...fsLineMap.entries()].map(([id, name]) => ({ id, name })),
    tbCodes: tbCodeRows,
    staff: [...new Set(staff.map(s => s.portalUserId).filter(Boolean) as string[])]
      .map(id => ({ id, name: staff.find(s => s.portalUserId === id)?.name || '' }))
      .concat(principalRow ? [{ id: principalRow.id, name: `${principalRow.name} (Principal)` }] : []),
  };

  const interpreted = await interpretSearchQuery(query, ctx);

  const logId = await logPortalSearch({
    firmId: firmId || '',
    engagementId: validEngagementIds.length === 1 ? validEngagementIds[0] : null,
    clientId: engagements[0]?.clientId || null,
    portalUserId: user.id,
    firmUserId: null,
    query,
    resultCount: 0, // client-side computed after applying filter
    interpretedFilters: interpreted,
  });

  return NextResponse.json({
    ok: true,
    logId,
    interpreted,
  });
}
