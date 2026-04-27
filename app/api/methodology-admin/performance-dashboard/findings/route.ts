import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { assertAdmin, clipString, jsonError, parseDate } from '../_auth';

const ROOT_CAUSE = ['process', 'methodology', 'supervision', 'data_ipe', 'resourcing', 'other'];
const SEVERITY = ['low', 'medium', 'high', 'critical'];
const STATUS = ['open', 'rca_in_progress', 'rca_complete', 'closed'];

export async function GET() {
  const gate = await assertAdmin();
  if ('error' in gate) return gate.error;
  const items = await prisma.perfFinding.findMany({
    where: { firmId: gate.session.user.firmId },
    orderBy: [{ raisedDate: 'desc' }],
    include: { remediations: true },
  });
  return NextResponse.json({ items });
}

export async function POST(req: Request) {
  const gate = await assertAdmin();
  if ('error' in gate) return gate.error;
  const body = await req.json().catch(() => null);
  if (!body) return jsonError('JSON body required');
  const title = clipString(body.title, 240);
  if (!title) return jsonError('title required');

  const created = await prisma.perfFinding.create({
    data: {
      firmId: gate.session.user.firmId,
      activityId: clipString(body.activityId, 64),
      title,
      description: clipString(body.description, 5000),
      rootCauseCategory: ROOT_CAUSE.includes(body.rootCauseCategory) ? body.rootCauseCategory : null,
      severity: SEVERITY.includes(body.severity) ? body.severity : 'medium',
      raisedDate: parseDate(body.raisedDate) ?? new Date(),
      rcaCompletedDate: parseDate(body.rcaCompletedDate),
      closedDate: parseDate(body.closedDate),
      status: STATUS.includes(body.status) ? body.status : 'open',
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

  const existing = await prisma.perfFinding.findUnique({ where: { id } });
  if (!existing || existing.firmId !== gate.session.user.firmId) return jsonError('Not found', 404);

  const data: Record<string, unknown> = {};
  if (body.activityId !== undefined) data.activityId = clipString(body.activityId, 64);
  if (body.title !== undefined) data.title = clipString(body.title, 240) ?? existing.title;
  if (body.description !== undefined) data.description = clipString(body.description, 5000);
  if (body.rootCauseCategory !== undefined) data.rootCauseCategory = ROOT_CAUSE.includes(body.rootCauseCategory) ? body.rootCauseCategory : null;
  if (body.severity !== undefined && SEVERITY.includes(body.severity)) data.severity = body.severity;
  if (body.raisedDate !== undefined) { const d = parseDate(body.raisedDate); if (d) data.raisedDate = d; }
  if (body.rcaCompletedDate !== undefined) data.rcaCompletedDate = parseDate(body.rcaCompletedDate);
  if (body.closedDate !== undefined) data.closedDate = parseDate(body.closedDate);
  if (body.status !== undefined && STATUS.includes(body.status)) data.status = body.status;
  if (body.notes !== undefined) data.notes = clipString(body.notes, 5000);

  const updated = await prisma.perfFinding.update({ where: { id }, data });
  return NextResponse.json({ item: updated });
}

export async function DELETE(req: Request) {
  const gate = await assertAdmin();
  if ('error' in gate) return gate.error;
  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  if (!id) return jsonError('id required');

  const existing = await prisma.perfFinding.findUnique({ where: { id } });
  if (!existing || existing.firmId !== gate.session.user.firmId) return jsonError('Not found', 404);

  await prisma.perfFinding.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
