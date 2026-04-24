import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

/**
 * GET /api/methodology-admin/portal-searches
 *
 * Lists the firm's portal-search-log rows, aggregated by normalised
 * query for easier promotion decisions:
 *
 *   - Each distinct query appears once
 *   - Shows run count, average result count, first / last run, latest logId
 *   - `featured` flag + label appear when any row with this query is featured
 *
 * Methodology Admins use this page to decide which queries are popular
 * or valuable enough to promote to "featured" — featured queries appear
 * as quick-filter chips on EVERY Principal dashboard for the firm, so
 * individual portal users don't have to re-type common ones.
 *
 * Query params:
 *   ?featuredOnly=true  — only return featured rows
 *   ?limit=N            — cap at N distinct queries (default 100, max 500)
 */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!session.user.firmId) return NextResponse.json({ error: 'No firm' }, { status: 400 });
  if (!session.user.isSuperAdmin && !session.user.isMethodologyAdmin) {
    return NextResponse.json({ error: 'Methodology-admin access required.' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const featuredOnly = searchParams.get('featuredOnly') === 'true';
  const limit = Math.min(500, Math.max(10, Number(searchParams.get('limit') || 100)));

  const rows = await prisma.portalSearchLog.findMany({
    where: {
      firmId: session.user.firmId,
      ...(featuredOnly ? { featured: true } : {}),
    },
    select: {
      id: true,
      query: true,
      queryNormalised: true,
      resultCount: true,
      featured: true,
      featuredLabel: true,
      featuredById: true,
      featuredAt: true,
      interpretedFilters: true,
      createdAt: true,
      portalUserId: true,
    },
    orderBy: [{ featured: 'desc' }, { createdAt: 'desc' }],
    take: limit * 3, // pull extra so aggregation doesn't miss dupes
  }).catch(() => [] as any[]);

  // Aggregate by normalised query. Pick the MOST RECENT row as the
  // "representative" for each group — that's the row the admin
  // toggles featured on.
  interface Agg {
    representativeId: string;
    query: string;
    queryNormalised: string | null;
    runCount: number;
    avgResults: number;
    firstRunAt: string;
    lastRunAt: string;
    distinctUsers: number;
    featured: boolean;
    featuredLabel: string | null;
    featuredAt: string | null;
    interpretedFilters: any;
  }
  const byKey = new Map<string, Agg & { _userIds: Set<string>; _totalResults: number }>();
  for (const r of rows) {
    const key = r.queryNormalised || r.query.trim().toLowerCase();
    let agg = byKey.get(key);
    if (!agg) {
      agg = {
        representativeId: r.id,
        query: r.query,
        queryNormalised: r.queryNormalised,
        runCount: 0,
        avgResults: 0,
        firstRunAt: r.createdAt.toISOString(),
        lastRunAt: r.createdAt.toISOString(),
        distinctUsers: 0,
        featured: r.featured,
        featuredLabel: r.featuredLabel,
        featuredAt: r.featuredAt ? r.featuredAt.toISOString() : null,
        interpretedFilters: r.interpretedFilters,
        _userIds: new Set<string>(),
        _totalResults: 0,
      };
      byKey.set(key, agg);
    }
    agg.runCount += 1;
    agg._totalResults += r.resultCount;
    if (r.portalUserId) agg._userIds.add(r.portalUserId);
    if (r.createdAt.toISOString() < agg.firstRunAt) agg.firstRunAt = r.createdAt.toISOString();
    if (r.createdAt.toISOString() > agg.lastRunAt) {
      agg.lastRunAt = r.createdAt.toISOString();
      agg.representativeId = r.id;
      agg.interpretedFilters = r.interpretedFilters;
    }
    if (r.featured && !agg.featured) {
      agg.featured = true;
      agg.featuredLabel = r.featuredLabel;
      agg.featuredAt = r.featuredAt ? r.featuredAt.toISOString() : null;
    }
  }
  const aggregated = [...byKey.values()].map(a => {
    const { _userIds, _totalResults, ...rest } = a;
    return {
      ...rest,
      avgResults: a.runCount > 0 ? Math.round(_totalResults / a.runCount) : 0,
      distinctUsers: _userIds.size,
    };
  });
  aggregated.sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0) || b.runCount - a.runCount);

  return NextResponse.json({ searches: aggregated.slice(0, limit) });
}
