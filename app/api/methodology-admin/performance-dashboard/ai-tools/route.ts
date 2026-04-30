import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { assertAdmin, clipString, jsonError, parseDate } from '../_auth';

const RISK = ['low', 'medium', 'high', 'critical'];
const STATUS = ['pending', 'validated', 'under_review', 'withdrawn'];
const AREAS = ['revenue', 'je_testing', 'risk_assessment', 'controls', 'analytics', 'documentation', 'research', 'other'];

export async function GET() {
  const gate = await assertAdmin();
  if ('error' in gate) return gate.error;
  const items = await prisma.perfAiTool.findMany({
    where: { firmId: gate.session.user.firmId },
    orderBy: [{ riskRating: 'desc' }, { name: 'asc' }],
    include: {
      _count: { select: { usage: true, validations: true } },
    },
  });
  return NextResponse.json({ items });
}

export async function POST(req: Request) {
  const gate = await assertAdmin();
  if ('error' in gate) return gate.error;
  const body = await req.json().catch(() => null);
  if (!body) return jsonError('JSON body required');
  const name = clipString(body.name, 240);
  if (!name) return jsonError('name required');

  const created = await prisma.perfAiTool.create({
    data: {
      firmId: gate.session.user.firmId,
      name,
      vendor: clipString(body.vendor, 120),
      modelVersion: clipString(body.modelVersion, 120),
      auditArea: AREAS.includes(body.auditArea) ? body.auditArea : null,
      scopeOfUse: clipString(body.scopeOfUse, 5000),
      riskRating: RISK.includes(body.riskRating) ? body.riskRating : 'medium',
      ownerName: clipString(body.ownerName, 120),
      validationStatus: STATUS.includes(body.validationStatus) ? body.validationStatus : 'pending',
      lastValidatedDate: parseDate(body.lastValidatedDate),
      nextValidationDue: parseDate(body.nextValidationDue),
      approvedForUse: body.approvedForUse === true,
      approvedByName: clipString(body.approvedByName, 120),
      approvedDate: parseDate(body.approvedDate),
      humanInLoop: body.humanInLoop !== false,
      notes: clipString(body.notes, 5000),
      isActive: body.isActive !== false,
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

  const existing = await prisma.perfAiTool.findUnique({ where: { id } });
  if (!existing || existing.firmId !== gate.session.user.firmId) return jsonError('Not found', 404);

  const data: Record<string, unknown> = {};
  if (body.name !== undefined) data.name = clipString(body.name, 240) ?? existing.name;
  if (body.vendor !== undefined) data.vendor = clipString(body.vendor, 120);
  if (body.modelVersion !== undefined) data.modelVersion = clipString(body.modelVersion, 120);
  if (body.auditArea !== undefined) data.auditArea = AREAS.includes(body.auditArea) ? body.auditArea : null;
  if (body.scopeOfUse !== undefined) data.scopeOfUse = clipString(body.scopeOfUse, 5000);
  if (body.riskRating !== undefined && RISK.includes(body.riskRating)) data.riskRating = body.riskRating;
  if (body.ownerName !== undefined) data.ownerName = clipString(body.ownerName, 120);
  if (body.validationStatus !== undefined && STATUS.includes(body.validationStatus)) data.validationStatus = body.validationStatus;
  if (body.lastValidatedDate !== undefined) data.lastValidatedDate = parseDate(body.lastValidatedDate);
  if (body.nextValidationDue !== undefined) data.nextValidationDue = parseDate(body.nextValidationDue);
  if (body.approvedForUse !== undefined) data.approvedForUse = body.approvedForUse === true;
  if (body.approvedByName !== undefined) data.approvedByName = clipString(body.approvedByName, 120);
  if (body.approvedDate !== undefined) data.approvedDate = parseDate(body.approvedDate);
  if (body.humanInLoop !== undefined) data.humanInLoop = body.humanInLoop !== false;
  if (body.notes !== undefined) data.notes = clipString(body.notes, 5000);
  if (body.isActive !== undefined) data.isActive = body.isActive !== false;

  const updated = await prisma.perfAiTool.update({ where: { id }, data });
  return NextResponse.json({ item: updated });
}

export async function DELETE(req: Request) {
  const gate = await assertAdmin();
  if ('error' in gate) return gate.error;
  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  if (!id) return jsonError('id required');

  const existing = await prisma.perfAiTool.findUnique({ where: { id } });
  if (!existing || existing.firmId !== gate.session.user.firmId) return jsonError('Not found', 404);

  await prisma.perfAiTool.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
