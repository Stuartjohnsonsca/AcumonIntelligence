import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { assertAdmin, clipString, jsonError, parseDate, parseFloatSafe } from '../_auth';

export async function GET() {
  const gate = await assertAdmin();
  if ('error' in gate) return gate.error;
  const items = await prisma.perfPeopleSnapshot.findMany({
    where: { firmId: gate.session.user.firmId },
    orderBy: [{ periodEnd: 'desc' }],
  });
  return NextResponse.json({ items });
}

export async function POST(req: Request) {
  const gate = await assertAdmin();
  if ('error' in gate) return gate.error;
  const body = await req.json().catch(() => null);
  if (!body) return jsonError('JSON body required');
  const periodLabel = clipString(body.periodLabel, 60);
  const periodEnd = parseDate(body.periodEnd);
  if (!periodLabel) return jsonError('periodLabel required');
  if (!periodEnd) return jsonError('periodEnd required (ISO date)');

  try {
    const created = await prisma.perfPeopleSnapshot.create({
      data: {
        firmId: gate.session.user.firmId,
        periodLabel,
        periodEnd,
        trainingEffectivenessPct: parseFloatSafe(body.trainingEffectivenessPct),
        staffUtilisationPct: parseFloatSafe(body.staffUtilisationPct),
        cultureSurveyScore: parseFloatSafe(body.cultureSurveyScore),
        attritionPct: parseFloatSafe(body.attritionPct),
        notes: clipString(body.notes, 5000),
      },
    });
    return NextResponse.json({ item: created }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Save failed';
    return jsonError(msg.includes('Unique') ? 'A snapshot with this period label already exists' : msg, 400);
  }
}

export async function PATCH(req: Request) {
  const gate = await assertAdmin();
  if ('error' in gate) return gate.error;
  const body = await req.json().catch(() => null);
  const id = clipString(body?.id, 64);
  if (!id) return jsonError('id required');

  const existing = await prisma.perfPeopleSnapshot.findUnique({ where: { id } });
  if (!existing || existing.firmId !== gate.session.user.firmId) return jsonError('Not found', 404);

  const data: Record<string, unknown> = {};
  if (body.periodLabel !== undefined) data.periodLabel = clipString(body.periodLabel, 60) ?? existing.periodLabel;
  if (body.periodEnd !== undefined) { const d = parseDate(body.periodEnd); if (d) data.periodEnd = d; }
  if (body.trainingEffectivenessPct !== undefined) data.trainingEffectivenessPct = parseFloatSafe(body.trainingEffectivenessPct);
  if (body.staffUtilisationPct !== undefined) data.staffUtilisationPct = parseFloatSafe(body.staffUtilisationPct);
  if (body.cultureSurveyScore !== undefined) data.cultureSurveyScore = parseFloatSafe(body.cultureSurveyScore);
  if (body.attritionPct !== undefined) data.attritionPct = parseFloatSafe(body.attritionPct);
  if (body.notes !== undefined) data.notes = clipString(body.notes, 5000);

  const updated = await prisma.perfPeopleSnapshot.update({ where: { id }, data });
  return NextResponse.json({ item: updated });
}

export async function DELETE(req: Request) {
  const gate = await assertAdmin();
  if ('error' in gate) return gate.error;
  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  if (!id) return jsonError('id required');

  const existing = await prisma.perfPeopleSnapshot.findUnique({ where: { id } });
  if (!existing || existing.firmId !== gate.session.user.firmId) return jsonError('Not found', 404);

  await prisma.perfPeopleSnapshot.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
