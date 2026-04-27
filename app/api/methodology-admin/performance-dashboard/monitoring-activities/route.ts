import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { assertAdmin, clipString, jsonError, parseDate, parseInteger } from '../_auth';

const ACTIVITY_TYPES = ['cold', 'hot', 'spot', 'thematic', 'eqr', 'consultation', 'preissuance', 'ethical'];
const STATUSES = ['planned', 'in_progress', 'complete', 'overdue', 'cancelled'];
const OUTCOMES = ['good', 'limited_improvements', 'improvements_required', 'significant_improvements'];

export async function GET() {
  const gate = await assertAdmin();
  if ('error' in gate) return gate.error;
  const items = await prisma.perfMonitoringActivity.findMany({
    where: { firmId: gate.session.user.firmId },
    orderBy: [{ plannedDate: 'desc' }, { createdAt: 'desc' }],
  });
  return NextResponse.json({ items });
}

export async function POST(req: Request) {
  const gate = await assertAdmin();
  if ('error' in gate) return gate.error;
  const body = await req.json().catch(() => null);
  if (!body) return jsonError('JSON body required');

  const activityType = String(body.activityType || '');
  if (!ACTIVITY_TYPES.includes(activityType)) return jsonError(`activityType must be one of: ${ACTIVITY_TYPES.join(', ')}`);

  const status = STATUSES.includes(body.status) ? body.status : 'planned';
  const outcomeRating = body.outcomeRating && OUTCOMES.includes(body.outcomeRating) ? body.outcomeRating : null;

  const created = await prisma.perfMonitoringActivity.create({
    data: {
      firmId: gate.session.user.firmId,
      activityType,
      engagementName: clipString(body.engagementName, 200),
      engagementId: clipString(body.engagementId, 64),
      responsibleIndividualName: clipString(body.responsibleIndividualName, 120),
      managerName: clipString(body.managerName, 120),
      reviewerName: clipString(body.reviewerName, 120),
      plannedDate: parseDate(body.plannedDate),
      startedDate: parseDate(body.startedDate),
      completedDate: parseDate(body.completedDate),
      status,
      outcomeRating,
      qualityScore: parseInteger(body.qualityScore),
      findingsCount: parseInteger(body.findingsCount) ?? 0,
      notes: clipString(body.notes, 5000),
      createdById: gate.session.user.id,
    },
  });
  return NextResponse.json({ item: created }, { status: 201 });
}

export async function PATCH(req: Request) {
  const gate = await assertAdmin();
  if ('error' in gate) return gate.error;
  const body = await req.json().catch(() => null);
  const id = clipString(body?.id, 64);
  if (!id) return jsonError('id required');

  const existing = await prisma.perfMonitoringActivity.findUnique({ where: { id } });
  if (!existing || existing.firmId !== gate.session.user.firmId) return jsonError('Not found', 404);

  const data: Record<string, unknown> = {};
  if (body.activityType !== undefined && ACTIVITY_TYPES.includes(body.activityType)) data.activityType = body.activityType;
  if (body.engagementName !== undefined) data.engagementName = clipString(body.engagementName, 200);
  if (body.engagementId !== undefined) data.engagementId = clipString(body.engagementId, 64);
  if (body.responsibleIndividualName !== undefined) data.responsibleIndividualName = clipString(body.responsibleIndividualName, 120);
  if (body.managerName !== undefined) data.managerName = clipString(body.managerName, 120);
  if (body.reviewerName !== undefined) data.reviewerName = clipString(body.reviewerName, 120);
  if (body.plannedDate !== undefined) data.plannedDate = parseDate(body.plannedDate);
  if (body.startedDate !== undefined) data.startedDate = parseDate(body.startedDate);
  if (body.completedDate !== undefined) data.completedDate = parseDate(body.completedDate);
  if (body.status !== undefined && STATUSES.includes(body.status)) data.status = body.status;
  if (body.outcomeRating !== undefined) data.outcomeRating = body.outcomeRating && OUTCOMES.includes(body.outcomeRating) ? body.outcomeRating : null;
  if (body.qualityScore !== undefined) data.qualityScore = parseInteger(body.qualityScore);
  if (body.findingsCount !== undefined) data.findingsCount = parseInteger(body.findingsCount) ?? 0;
  if (body.notes !== undefined) data.notes = clipString(body.notes, 5000);

  const updated = await prisma.perfMonitoringActivity.update({ where: { id }, data });
  return NextResponse.json({ item: updated });
}

export async function DELETE(req: Request) {
  const gate = await assertAdmin();
  if ('error' in gate) return gate.error;
  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  if (!id) return jsonError('id required');

  const existing = await prisma.perfMonitoringActivity.findUnique({ where: { id } });
  if (!existing || existing.firmId !== gate.session.user.firmId) return jsonError('Not found', 404);

  await prisma.perfMonitoringActivity.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
