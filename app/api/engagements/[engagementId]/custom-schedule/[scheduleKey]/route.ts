import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { assertEngagementWriteAccess } from '@/lib/auth/engagement-auth';

/**
 * Generic save / load for "custom firm questions" attached to a
 * built-in tool panel (EQR Review, FS Review, Adj TB, …).
 *
 * Storage is one row in AuditPermanentFile keyed by the engagement +
 * `custom_${scheduleKey}` section. The answers blob is just a flat
 * `{questionId -> string|number|boolean|null}` map — the same shape
 * DynamicAppendixForm posts under the `data` field.
 *
 * Routes:
 *   GET   → `{ data: {...} }` matching the DynamicAppendixForm initialData contract
 *   PUT   body `{ data: {...} }` → upserts the row, returns the saved map
 *
 * No new Prisma model — re-uses AuditPermanentFile which already has
 * the (engagementId, sectionKey) unique index.
 */

type Ctx = { params: Promise<{ engagementId: string; scheduleKey: string }> };

function sectionFor(scheduleKey: string): string {
  // Strip the optional `_questions` suffix the legacy appendix template
  // type uses so we get a consistent key whether the caller passes
  // `eqr_review` or `eqr_review_questions`.
  const clean = String(scheduleKey || '').replace(/_(questions|categories)$/, '');
  return `custom_${clean}`;
}

async function loadEngagement(engagementId: string) {
  return prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    select: { id: true, firmId: true },
  });
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { engagementId, scheduleKey } = await ctx.params;
  const engagement = await loadEngagement(engagementId);
  if (!engagement) return NextResponse.json({ error: 'Engagement not found' }, { status: 404 });
  if (!session.user.isSuperAdmin && engagement.firmId !== session.user.firmId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const row = await prisma.auditPermanentFile.findUnique({
    where: { engagementId_sectionKey: { engagementId, sectionKey: sectionFor(scheduleKey) } },
  }).catch(() => null);

  const data = (row?.data as any)?.answers ?? {};
  return NextResponse.json({ data });
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { engagementId, scheduleKey } = await ctx.params;
  const guard = await assertEngagementWriteAccess(engagementId, session);
  if (guard instanceof NextResponse) return guard;

  const engagement = await loadEngagement(engagementId);
  if (!engagement) return NextResponse.json({ error: 'Engagement not found' }, { status: 404 });
  if (!session.user.isSuperAdmin && engagement.firmId !== session.user.firmId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const answers = body && typeof body === 'object' && body.data && typeof body.data === 'object'
    ? body.data
    : {};
  const sectionKey = sectionFor(scheduleKey);

  await prisma.auditPermanentFile.upsert({
    where: { engagementId_sectionKey: { engagementId, sectionKey } },
    create: { engagementId, sectionKey, data: { answers } as any },
    update: { data: { answers } as any },
  });

  return NextResponse.json({ data: answers });
}
