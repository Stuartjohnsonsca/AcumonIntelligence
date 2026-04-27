import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { assertAdmin, clipString, jsonError, parseDate, parseInteger } from '../_auth';

const STATUS = ['planned', 'on_track', 'at_risk', 'overdue', 'done'];

export async function GET(req: Request) {
  const gate = await assertAdmin();
  if ('error' in gate) return gate.error;
  const url = new URL(req.url);
  const yearParam = url.searchParams.get('year');
  const year = yearParam ? Number(yearParam) : null;

  const items = await prisma.perfActivitySchedule.findMany({
    where: { firmId: gate.session.user.firmId, ...(year ? { year } : {}) },
    orderBy: [{ year: 'asc' }, { monthIndex: 'asc' }, { sortOrder: 'asc' }],
  });
  return NextResponse.json({ items });
}

export async function POST(req: Request) {
  const gate = await assertAdmin();
  if ('error' in gate) return gate.error;
  const body = await req.json().catch(() => null);
  if (!body) return jsonError('JSON body required');
  const year = parseInteger(body.year);
  const monthIndex = parseInteger(body.monthIndex);
  const activityName = clipString(body.activityName, 240);
  if (year === null || year < 2000 || year > 2100) return jsonError('valid year required');
  if (monthIndex === null || monthIndex < 0 || monthIndex > 11) return jsonError('monthIndex 0-11 required');
  if (!activityName) return jsonError('activityName required');

  try {
    const created = await prisma.perfActivitySchedule.create({
      data: {
        firmId: gate.session.user.firmId,
        year,
        monthIndex,
        activityName,
        status: STATUS.includes(body.status) ? body.status : 'planned',
        ownerName: clipString(body.ownerName, 120),
        dueDate: parseDate(body.dueDate),
        completedDate: parseDate(body.completedDate),
        notes: clipString(body.notes, 5000),
        sortOrder: parseInteger(body.sortOrder) ?? 0,
      },
    });
    return NextResponse.json({ item: created }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Save failed';
    return jsonError(msg.includes('Unique') ? 'This activity already exists for that month' : msg, 400);
  }
}

export async function PATCH(req: Request) {
  const gate = await assertAdmin();
  if ('error' in gate) return gate.error;
  const body = await req.json().catch(() => null);
  const id = clipString(body?.id, 64);
  if (!id) return jsonError('id required');

  const existing = await prisma.perfActivitySchedule.findUnique({ where: { id } });
  if (!existing || existing.firmId !== gate.session.user.firmId) return jsonError('Not found', 404);

  const data: Record<string, unknown> = {};
  if (body.activityName !== undefined) data.activityName = clipString(body.activityName, 240) ?? existing.activityName;
  if (body.status !== undefined && STATUS.includes(body.status)) data.status = body.status;
  if (body.ownerName !== undefined) data.ownerName = clipString(body.ownerName, 120);
  if (body.dueDate !== undefined) data.dueDate = parseDate(body.dueDate);
  if (body.completedDate !== undefined) data.completedDate = parseDate(body.completedDate);
  if (body.notes !== undefined) data.notes = clipString(body.notes, 5000);
  if (body.sortOrder !== undefined) data.sortOrder = parseInteger(body.sortOrder) ?? 0;

  const updated = await prisma.perfActivitySchedule.update({ where: { id }, data });
  return NextResponse.json({ item: updated });
}

export async function DELETE(req: Request) {
  const gate = await assertAdmin();
  if ('error' in gate) return gate.error;
  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  if (!id) return jsonError('id required');

  const existing = await prisma.perfActivitySchedule.findUnique({ where: { id } });
  if (!existing || existing.firmId !== gate.session.user.firmId) return jsonError('Not found', 404);

  await prisma.perfActivitySchedule.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
