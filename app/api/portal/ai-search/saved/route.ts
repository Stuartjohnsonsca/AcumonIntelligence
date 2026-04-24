import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { resolvePortalUserFromToken } from '@/lib/portal-session';

/**
 * GET  /api/portal/ai-search/saved?token=X
 *    List the caller's saved searches (user-level). Each row carries
 *    the cached interpretedFilters so re-running is zero-cost — no
 *    AI call, just apply the filter.
 *
 * POST /api/portal/ai-search/saved?token=X
 *    Body: { logId, label }
 *    Mark an existing search-log row as saved by the caller. The
 *    same row can't be saved twice for the same user; attempting to
 *    do so updates the label. A user can save AT MOST 20 searches —
 *    older saves are returned but not editable beyond delete.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get('token');
  if (!token) return NextResponse.json({ error: 'token required' }, { status: 400 });
  const user = await resolvePortalUserFromToken(token);
  if (!user) return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 });

  const rows = await prisma.portalSearchLog.findMany({
    where: { savedByPortalUserId: user.id, savedLabel: { not: null } },
    select: {
      id: true,
      query: true,
      savedLabel: true,
      savedAt: true,
      interpretedFilters: true,
      resultCount: true,
    },
    orderBy: { savedAt: 'desc' },
    take: 20,
  }).catch(() => [] as any[]);

  return NextResponse.json({ saved: rows });
}

export async function POST(req: Request) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get('token');
  if (!token) return NextResponse.json({ error: 'token required' }, { status: 400 });
  const user = await resolvePortalUserFromToken(token);
  if (!user) return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { logId, label } = body as { logId: string; label: string };
  if (!logId || !label || !label.trim()) {
    return NextResponse.json({ error: 'logId and label required' }, { status: 400 });
  }

  // Verify the log row belongs to the caller so a user can't save
  // someone else's search.
  const log = await prisma.portalSearchLog.findUnique({
    where: { id: logId },
    select: { id: true, portalUserId: true },
  });
  if (!log || log.portalUserId !== user.id) {
    return NextResponse.json({ error: 'Search log not found for this user.' }, { status: 404 });
  }

  // Cap at 20 per user — if over, prune the oldest.
  const existing = await prisma.portalSearchLog.findMany({
    where: { savedByPortalUserId: user.id, savedLabel: { not: null } },
    select: { id: true, savedAt: true },
    orderBy: { savedAt: 'asc' },
  });
  if (existing.length >= 20 && !existing.some(e => e.id === logId)) {
    const oldest = existing[0];
    await prisma.portalSearchLog.update({
      where: { id: oldest.id },
      data: { savedByPortalUserId: null, savedLabel: null, savedAt: null },
    });
  }

  const updated = await prisma.portalSearchLog.update({
    where: { id: logId },
    data: {
      savedByPortalUserId: user.id,
      savedLabel: label.trim().slice(0, 80),
      savedAt: new Date(),
    },
    select: { id: true, savedLabel: true, savedAt: true, query: true, interpretedFilters: true },
  });

  return NextResponse.json({ ok: true, saved: updated });
}
