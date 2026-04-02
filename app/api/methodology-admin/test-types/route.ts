import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function GET() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const types = await prisma.methodologyTestType.findMany({
    where: { firmId: session.user.firmId },
    orderBy: { name: 'asc' },
  });

  return NextResponse.json({ types });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified || (!session.user.isSuperAdmin && !session.user.isMethodologyAdmin)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { name, code, actionType, codeSection, executionDef } = await req.json();
  const firmId = session.user.firmId;

  if (!name?.trim()) {
    return NextResponse.json({ error: 'Action name is required' }, { status: 400 });
  }

  // Auto-generate code if not provided
  const finalCode = code?.trim() || name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

  const existing = await prisma.methodologyTestType.findUnique({
    where: { firmId_code: { firmId, code: finalCode } },
  });
  if (existing) {
    return NextResponse.json({ error: 'Test type code already exists' }, { status: 400 });
  }

  const testType = await prisma.methodologyTestType.create({
    data: {
      firmId,
      name: name.trim(),
      code: finalCode,
      actionType: actionType || 'human_action',
      codeSection: codeSection || null,
      executionDef: executionDef || null,
      isActive: true,
    },
  });

  return NextResponse.json({ testType });
}

export async function PATCH(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified || (!session.user.isSuperAdmin && !session.user.isMethodologyAdmin)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id, name, actionType, codeSection, isActive, executionDef } = await req.json();
  const data: Record<string, any> = {};
  if (name !== undefined) data.name = name;
  if (actionType !== undefined) data.actionType = actionType;
  if (codeSection !== undefined) data.codeSection = codeSection;
  if (isActive !== undefined) data.isActive = isActive;
  if (executionDef !== undefined) data.executionDef = executionDef;

  const testType = await prisma.methodologyTestType.update({
    where: { id },
    data,
  });

  return NextResponse.json({ testType });
}

export async function DELETE(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified || (!session.user.isSuperAdmin && !session.user.isMethodologyAdmin)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await req.json();
  await prisma.methodologyTestType.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
