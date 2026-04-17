import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

/**
 * Sample-item markers for an execution — the R/O/G dots the UI renders
 * in the Year-End Accruals test output (and any future pipeline that
 * uses the same marker pattern).
 *
 * GET  /api/engagements/:eid/test-execution/:exid/sample-markers
 *   Returns { markers: SampleItemMarker[] }. Only the executing firm's
 *   users can read.
 *
 * PATCH ?id=<markerId>
 *   Body: { colour: 'red'|'orange'|'green', reason?: string }
 *   Auditor override. Captures user id/name/timestamp and stores the
 *   original handler-emitted colour in `originalColour` for traceability.
 *
 * POST /resolve
 *   Body: { id, resolution: 'error'|'in_tb', errorAmount?, description? }
 *   Marks a Red item as either booked to the error schedule or treated
 *   as already-in-TB. The "error" path creates an AuditErrorSchedule row
 *   linked via sampleItemMarkerId; the "in_tb" path creates a lightweight
 *   row with resolution='in_tb' (no contribution to materiality but
 *   retained for traceability).
 */

type Ctx = { params: Promise<{ engagementId: string; executionId: string }> };

async function assertCanAccess(engagementId: string, executionId: string) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return { error: 'Forbidden', status: 403 as const };
  const execution = await prisma.testExecution.findUnique({
    where: { id: executionId },
    select: { engagementId: true, engagement: { select: { firmId: true } } },
  });
  if (!execution || execution.engagementId !== engagementId) {
    return { error: 'Execution not found', status: 404 as const };
  }
  if (execution.engagement.firmId !== session.user.firmId && !session.user.isSuperAdmin) {
    return { error: 'Forbidden', status: 403 as const };
  }
  return { session };
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { engagementId, executionId } = await ctx.params;
  const check = await assertCanAccess(engagementId, executionId);
  if ('error' in check) return NextResponse.json({ error: check.error }, { status: check.status });

  const markers = await prisma.sampleItemMarker.findMany({
    where: { executionId },
    orderBy: [{ stepIndex: 'asc' }, { createdAt: 'asc' }],
  });
  return NextResponse.json({ markers });
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { engagementId, executionId } = await ctx.params;
  const check = await assertCanAccess(engagementId, executionId);
  if ('error' in check) return NextResponse.json({ error: check.error }, { status: check.status });

  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id query param required' }, { status: 400 });

  const body = await req.json();
  const colour = body?.colour;
  if (!['red', 'orange', 'green'].includes(colour)) {
    return NextResponse.json({ error: 'colour must be red | orange | green' }, { status: 400 });
  }

  const existing = await prisma.sampleItemMarker.findFirst({
    where: { id, executionId },
  });
  if (!existing) return NextResponse.json({ error: 'Marker not found' }, { status: 404 });

  const session = check.session;
  const userName = session.user.name || session.user.email || 'Auditor';
  // Snapshot the colour we're overriding from *the first time* the user
  // overrides — if they toggle twice, originalColour still points to the
  // handler's decision, not their previous manual pick.
  const originalColour = existing.originalColour ?? existing.colour;

  const updated = await prisma.sampleItemMarker.update({
    where: { id },
    data: {
      colour,
      overriddenBy: session.user.id,
      overriddenByName: userName,
      overriddenAt: new Date(),
      overrideReason: typeof body?.reason === 'string' ? body.reason : null,
      originalColour,
    },
  });
  return NextResponse.json({ marker: updated });
}

/**
 * POST /resolve — Findings & Conclusions section uses this to commit a
 * Red item as either "error" (create error-schedule row) or "in_tb"
 * (record the decision without booking an error).
 *
 * Route reuses the main path with ?action=resolve. Two buttons in the
 * Findings section map to this; selecting one clears the other
 * server-side so the two outcomes are mutually exclusive per marker.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  const { engagementId, executionId } = await ctx.params;
  const check = await assertCanAccess(engagementId, executionId);
  if ('error' in check) return NextResponse.json({ error: check.error }, { status: check.status });

  const body = await req.json();
  const markerId: string | undefined = body?.id;
  const resolution: string | undefined = body?.resolution;
  if (!markerId || !['error', 'in_tb'].includes(resolution || '')) {
    return NextResponse.json({ error: 'id and resolution (error | in_tb) required' }, { status: 400 });
  }

  const marker = await prisma.sampleItemMarker.findFirst({
    where: { id: markerId, executionId },
  });
  if (!marker) return NextResponse.json({ error: 'Marker not found' }, { status: 404 });

  const execution = await prisma.testExecution.findUnique({
    where: { id: executionId },
    select: { fsLine: true, testDescription: true },
  });

  const session = check.session;
  const userName = session.user.name || session.user.email || 'Auditor';

  // Mutually exclusive: remove any prior Error-Schedule row that this
  // marker had created before (so toggling Error → In TB re-creates with
  // the new resolution rather than leaving a stale row).
  await prisma.auditErrorSchedule.deleteMany({ where: { sampleItemMarkerId: markerId } });

  const calc = (marker.calcJson as Record<string, any>) || {};
  const description = typeof body?.description === 'string' && body.description.length > 0
    ? body.description
    : `${marker.markerType || 'Finding'} — ${marker.reason.slice(0, 180)}`;
  const errorAmount = typeof body?.errorAmount === 'number'
    ? body.errorAmount
    : (typeof calc.variance === 'number' ? Math.abs(calc.variance) : (typeof calc.sample_amount === 'number' ? calc.sample_amount : 0));

  const row = await prisma.auditErrorSchedule.create({
    data: {
      engagementId,
      fsLine: execution?.fsLine || 'Accruals',
      description,
      errorAmount: resolution === 'error' ? errorAmount : 0,
      errorType: 'factual',
      explanation: marker.reason,
      sampleItemMarkerId: markerId,
      resolution,
      resolvedBy: session.user.id,
      resolvedByName: userName,
      resolvedAt: new Date(),
      committedBy: session.user.id,
      committedByName: userName,
      committedAt: new Date(),
    },
  });

  return NextResponse.json({ errorScheduleItem: row });
}
