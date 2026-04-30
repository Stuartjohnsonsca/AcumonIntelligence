import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { assertAdmin, clipString, jsonError, parseDate, parseFloatSafe, parseInteger } from '../_auth';

const TEST_TYPES = ['accuracy', 'bias', 'regression', 'edge_case', 'drift', 'golden_set', 'other'];
const RESULTS = ['pass', 'fail', 'partial'];

export async function GET() {
  const gate = await assertAdmin();
  if ('error' in gate) return gate.error;
  const items = await prisma.perfAiValidation.findMany({
    where: { firmId: gate.session.user.firmId },
    orderBy: [{ testDate: 'desc' }],
    include: { tool: { select: { id: true, name: true } } },
  });
  return NextResponse.json({ items });
}

export async function POST(req: Request) {
  const gate = await assertAdmin();
  if ('error' in gate) return gate.error;
  const body = await req.json().catch(() => null);
  if (!body) return jsonError('JSON body required');

  const toolId = clipString(body.toolId, 64);
  if (!toolId) return jsonError('toolId required');
  if (!TEST_TYPES.includes(body.testType)) return jsonError(`testType must be one of: ${TEST_TYPES.join(', ')}`);
  if (!RESULTS.includes(body.result)) return jsonError(`result must be one of: ${RESULTS.join(', ')}`);

  const tool = await prisma.perfAiTool.findUnique({ where: { id: toolId } });
  if (!tool || tool.firmId !== gate.session.user.firmId) return jsonError('tool not found', 404);

  const created = await prisma.perfAiValidation.create({
    data: {
      firmId: gate.session.user.firmId,
      toolId,
      testDate: parseDate(body.testDate) ?? new Date(),
      testType: body.testType,
      result: body.result,
      performedBy: clipString(body.performedBy, 120),
      sampleSize: parseInteger(body.sampleSize),
      accuracyPct: parseFloatSafe(body.accuracyPct),
      evidenceUrl: clipString(body.evidenceUrl, 500),
      notes: clipString(body.notes, 5000),
    },
  });

  // If this is a passing validation, update the tool's lastValidatedDate
  // and bump validationStatus to 'validated'.
  if (body.result === 'pass') {
    await prisma.perfAiTool.update({
      where: { id: toolId },
      data: {
        lastValidatedDate: created.testDate,
        validationStatus: 'validated',
      },
    });
  }

  return NextResponse.json({ item: created }, { status: 201 });
}

export async function DELETE(req: Request) {
  const gate = await assertAdmin();
  if ('error' in gate) return gate.error;
  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  if (!id) return jsonError('id required');

  const existing = await prisma.perfAiValidation.findUnique({ where: { id } });
  if (!existing || existing.firmId !== gate.session.user.firmId) return jsonError('Not found', 404);

  await prisma.perfAiValidation.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
