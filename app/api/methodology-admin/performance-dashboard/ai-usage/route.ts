import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { assertAdmin, clipString, jsonError, parseDate } from '../_auth';

const DECISIONS = ['accepted', 'overridden', 'partial', 'rejected'];
const MATERIALITY = ['low', 'medium', 'high', 'critical'];

export async function GET(req: Request) {
  const gate = await assertAdmin();
  if ('error' in gate) return gate.error;
  const url = new URL(req.url);
  const toolId = url.searchParams.get('toolId') || undefined;
  const items = await prisma.perfAiUsage.findMany({
    where: { firmId: gate.session.user.firmId, ...(toolId ? { toolId } : {}) },
    orderBy: [{ usedDate: 'desc' }],
    include: { tool: { select: { id: true, name: true, riskRating: true } } },
    take: 500,
  });
  return NextResponse.json({ items });
}

export async function POST(req: Request) {
  const gate = await assertAdmin();
  if ('error' in gate) return gate.error;
  const body = await req.json().catch(() => null);
  if (!body) return jsonError('JSON body required');

  const toolId = clipString(body.toolId, 64);
  const outputDecision = body.outputDecision;
  if (!toolId) return jsonError('toolId required');
  if (!DECISIONS.includes(outputDecision)) return jsonError(`outputDecision must be one of: ${DECISIONS.join(', ')}`);

  const tool = await prisma.perfAiTool.findUnique({ where: { id: toolId } });
  if (!tool || tool.firmId !== gate.session.user.firmId) return jsonError('tool not found', 404);

  const created = await prisma.perfAiUsage.create({
    data: {
      firmId: gate.session.user.firmId,
      toolId,
      engagementName: clipString(body.engagementName, 200),
      engagementId: clipString(body.engagementId, 64),
      usedDate: parseDate(body.usedDate) ?? new Date(),
      reviewerName: clipString(body.reviewerName, 120),
      outputDecision,
      materiality: MATERIALITY.includes(body.materiality) ? body.materiality : 'medium',
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

  const existing = await prisma.perfAiUsage.findUnique({ where: { id } });
  if (!existing || existing.firmId !== gate.session.user.firmId) return jsonError('Not found', 404);

  const data: Record<string, unknown> = {};
  if (body.engagementName !== undefined) data.engagementName = clipString(body.engagementName, 200);
  if (body.engagementId !== undefined) data.engagementId = clipString(body.engagementId, 64);
  if (body.usedDate !== undefined) { const d = parseDate(body.usedDate); if (d) data.usedDate = d; }
  if (body.reviewerName !== undefined) data.reviewerName = clipString(body.reviewerName, 120);
  if (body.outputDecision !== undefined && DECISIONS.includes(body.outputDecision)) data.outputDecision = body.outputDecision;
  if (body.materiality !== undefined && MATERIALITY.includes(body.materiality)) data.materiality = body.materiality;
  if (body.notes !== undefined) data.notes = clipString(body.notes, 5000);

  const updated = await prisma.perfAiUsage.update({ where: { id }, data });
  return NextResponse.json({ item: updated });
}

export async function DELETE(req: Request) {
  const gate = await assertAdmin();
  if ('error' in gate) return gate.error;
  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  if (!id) return jsonError('id required');

  const existing = await prisma.perfAiUsage.findUnique({ where: { id } });
  if (!existing || existing.firmId !== gate.session.user.firmId) return jsonError('Not found', 404);

  await prisma.perfAiUsage.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
