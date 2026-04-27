import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { assertAdmin, clipString, jsonError, parseDate } from '../_auth';

const STATUS = ['not_started', 'in_progress', 'implemented', 'retested', 'overdue'];

export async function GET() {
  const gate = await assertAdmin();
  if ('error' in gate) return gate.error;
  const items = await prisma.perfRemediation.findMany({
    where: { firmId: gate.session.user.firmId },
    orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
    include: { finding: { select: { title: true, id: true } } },
  });
  return NextResponse.json({ items });
}

export async function POST(req: Request) {
  const gate = await assertAdmin();
  if ('error' in gate) return gate.error;
  const body = await req.json().catch(() => null);
  if (!body) return jsonError('JSON body required');
  const findingId = clipString(body.findingId, 64);
  const description = clipString(body.description, 5000);
  if (!findingId) return jsonError('findingId required');
  if (!description) return jsonError('description required');

  const finding = await prisma.perfFinding.findUnique({ where: { id: findingId } });
  if (!finding || finding.firmId !== gate.session.user.firmId) return jsonError('finding not found', 404);

  const effective = body.effective === true ? true : body.effective === false ? false : null;

  const created = await prisma.perfRemediation.create({
    data: {
      firmId: gate.session.user.firmId,
      findingId,
      description,
      ownerName: clipString(body.ownerName, 120),
      dueDate: parseDate(body.dueDate),
      status: STATUS.includes(body.status) ? body.status : 'not_started',
      retestedDate: parseDate(body.retestedDate),
      effective,
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

  const existing = await prisma.perfRemediation.findUnique({ where: { id } });
  if (!existing || existing.firmId !== gate.session.user.firmId) return jsonError('Not found', 404);

  const data: Record<string, unknown> = {};
  if (body.description !== undefined) data.description = clipString(body.description, 5000) ?? existing.description;
  if (body.ownerName !== undefined) data.ownerName = clipString(body.ownerName, 120);
  if (body.dueDate !== undefined) data.dueDate = parseDate(body.dueDate);
  if (body.status !== undefined && STATUS.includes(body.status)) data.status = body.status;
  if (body.retestedDate !== undefined) data.retestedDate = parseDate(body.retestedDate);
  if (body.effective !== undefined) data.effective = body.effective === true ? true : body.effective === false ? false : null;
  if (body.notes !== undefined) data.notes = clipString(body.notes, 5000);

  const updated = await prisma.perfRemediation.update({ where: { id }, data });
  return NextResponse.json({ item: updated });
}

export async function DELETE(req: Request) {
  const gate = await assertAdmin();
  if ('error' in gate) return gate.error;
  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  if (!id) return jsonError('id required');

  const existing = await prisma.perfRemediation.findUnique({ where: { id } });
  if (!existing || existing.firmId !== gate.session.user.firmId) return jsonError('Not found', 404);

  await prisma.perfRemediation.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
