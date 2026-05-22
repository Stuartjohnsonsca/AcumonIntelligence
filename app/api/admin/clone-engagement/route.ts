import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { cloneEngagement } from '@/lib/clone-engagement';

/**
 * POST /api/admin/clone-engagement
 *
 * Super-Admin-only. Body: { sourceEngagementId: string, cloneLabel?: string }
 *
 * Returns: { newEngagementId, cloneIndex, cloneLabel, copied, stripped }
 *
 * Behaviour locked with the user 2026-05-22:
 *   • Same client + same period, new engagement id (cloneIndex distinguishes)
 *   • Methodology + setup data carried over
 *   • Test executions / conclusions / sign-offs / findings stripped
 *   • Portal client-interaction tables stripped (requests, messages,
 *     uploads, preview sessions, comms preferences)
 *
 * See lib/clone-engagement.ts for the exhaustive table list.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!session.user.isSuperAdmin) return NextResponse.json({ error: 'Super Admin only' }, { status: 403 });

  const body = await req.json().catch(() => null);
  const sourceEngagementId = typeof body?.sourceEngagementId === 'string' ? body.sourceEngagementId : '';
  const cloneLabel = typeof body?.cloneLabel === 'string' && body.cloneLabel.trim().length > 0
    ? body.cloneLabel.trim().slice(0, 200)
    : null;

  if (!sourceEngagementId) {
    return NextResponse.json({ error: 'sourceEngagementId required' }, { status: 400 });
  }

  try {
    const result = await cloneEngagement({
      sourceEngagementId,
      cloneLabel,
      createdById: session.user.id,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Clone failed' }, { status: 500 });
  }
}

/**
 * GET /api/admin/clone-engagement?firmId=X
 *
 * Lists every engagement on the firm so the Super Admin can pick a
 * source. Returns minimal fields for the picker UI; the actual clone
 * uses the engagement id only. Without firmId, returns every firm's
 * engagements (capped at 500 to keep payloads sane).
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!session.user.isSuperAdmin) return NextResponse.json({ error: 'Super Admin only' }, { status: 403 });

  const firmId = new URL(req.url).searchParams.get('firmId');

  // Cast the select payload as `any` because the three new clone-*
  // columns won't be known to the generated Prisma types until the
  // user runs `prisma db push` after this commit.
  const engagements = await (prisma.auditEngagement.findMany as any)({
    where: firmId ? { firmId } : {},
    select: {
      id: true,
      auditType: true,
      framework: true,
      status: true,
      cloneOfId: true,
      cloneIndex: true,
      cloneLabel: true,
      createdAt: true,
      client: { select: { id: true, clientName: true } },
      period: { select: { id: true, startDate: true, endDate: true } },
      firm: { select: { id: true, name: true } },
    },
    orderBy: [{ firmId: 'asc' }, { createdAt: 'desc' }],
    take: 500,
  });

  return NextResponse.json({ engagements });
}
