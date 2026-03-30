import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified || (!session.user.isSuperAdmin && !session.user.isMethodologyAdmin)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json();
  const { items, auditType } = body;

  const existing = await prisma.methodologyTemplate.findFirst({
    where: { id, firmId: session.user.firmId },
  });
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const template = await prisma.methodologyTemplate.update({
    where: { id },
    data: {
      ...(items !== undefined && { items }),
      ...(auditType !== undefined && { auditType }),
    },
  });

  return NextResponse.json(template);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified || (!session.user.isSuperAdmin && !session.user.isMethodologyAdmin)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await params;
  const existing = await prisma.methodologyTemplate.findFirst({
    where: { id, firmId: session.user.firmId },
  });
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  await prisma.methodologyTemplate.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
