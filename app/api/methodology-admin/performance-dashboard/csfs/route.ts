import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { assertAdmin, clipString, jsonError, parseDate, parseInteger } from '../_auth';

const PILLARS = ['goodwill', 'governance', 'growth', 'quality'];
const RAG = ['green', 'amber', 'red', 'grey'];

export async function GET() {
  const gate = await assertAdmin();
  if ('error' in gate) return gate.error;
  const items = await prisma.perfCsf.findMany({
    where: { firmId: gate.session.user.firmId },
    orderBy: [{ pillar: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
  });
  return NextResponse.json({ items });
}

export async function POST(req: Request) {
  const gate = await assertAdmin();
  if ('error' in gate) return gate.error;
  const body = await req.json().catch(() => null);
  if (!body) return jsonError('JSON body required');
  if (!PILLARS.includes(body.pillar)) return jsonError(`pillar must be one of: ${PILLARS.join(', ')}`);
  const subComponent = clipString(body.subComponent, 80);
  const name = clipString(body.name, 240);
  if (!subComponent) return jsonError('subComponent required');
  if (!name) return jsonError('name required');

  const created = await prisma.perfCsf.create({
    data: {
      firmId: gate.session.user.firmId,
      pillar: body.pillar,
      subComponent,
      name,
      targetMetric: clipString(body.targetMetric, 240),
      currentMetric: clipString(body.currentMetric, 240),
      rag: RAG.includes(body.rag) ? body.rag : 'grey',
      ownerName: clipString(body.ownerName, 120),
      reviewedDate: parseDate(body.reviewedDate),
      notes: clipString(body.notes, 5000),
      isActive: body.isActive !== false,
      sortOrder: parseInteger(body.sortOrder) ?? 0,
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

  const existing = await prisma.perfCsf.findUnique({ where: { id } });
  if (!existing || existing.firmId !== gate.session.user.firmId) return jsonError('Not found', 404);

  const data: Record<string, unknown> = {};
  if (body.pillar !== undefined && PILLARS.includes(body.pillar)) data.pillar = body.pillar;
  if (body.subComponent !== undefined) data.subComponent = clipString(body.subComponent, 80) ?? existing.subComponent;
  if (body.name !== undefined) data.name = clipString(body.name, 240) ?? existing.name;
  if (body.targetMetric !== undefined) data.targetMetric = clipString(body.targetMetric, 240);
  if (body.currentMetric !== undefined) data.currentMetric = clipString(body.currentMetric, 240);
  if (body.rag !== undefined && RAG.includes(body.rag)) data.rag = body.rag;
  if (body.ownerName !== undefined) data.ownerName = clipString(body.ownerName, 120);
  if (body.reviewedDate !== undefined) data.reviewedDate = parseDate(body.reviewedDate);
  if (body.notes !== undefined) data.notes = clipString(body.notes, 5000);
  if (body.isActive !== undefined) data.isActive = body.isActive !== false;
  if (body.sortOrder !== undefined) data.sortOrder = parseInteger(body.sortOrder) ?? 0;

  const updated = await prisma.perfCsf.update({ where: { id }, data });
  return NextResponse.json({ item: updated });
}

export async function DELETE(req: Request) {
  const gate = await assertAdmin();
  if ('error' in gate) return gate.error;
  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  if (!id) return jsonError('id required');

  const existing = await prisma.perfCsf.findUnique({ where: { id } });
  if (!existing || existing.firmId !== gate.session.user.firmId) return jsonError('Not found', 404);

  await prisma.perfCsf.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
