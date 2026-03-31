import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified || !session.user.isSuperAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json();

  const existing = await prisma.methodologyTemplate.findFirst({
    where: { id, firmId: '__global__', templateType: 'aggregator_connector' },
  });
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const currentItems = typeof existing.items === 'object' && existing.items !== null
    ? existing.items as Record<string, unknown> : {};

  const updated = await prisma.methodologyTemplate.update({
    where: { id },
    data: {
      items: {
        ...currentItems,
        ...(body.config !== undefined && { config: body.config }),
        ...(body.label !== undefined && { label: body.label }),
        ...(body.status !== undefined && { status: body.status }),
        ...(body.lastTestedAt !== undefined && { lastTestedAt: body.lastTestedAt }),
        ...(body.lastTestResult !== undefined && { lastTestResult: body.lastTestResult }),
      },
    },
  });

  return NextResponse.json({ success: true, updatedAt: updated.updatedAt?.toISOString() });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified || !session.user.isSuperAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await params;
  const existing = await prisma.methodologyTemplate.findFirst({
    where: { id, firmId: '__global__', templateType: 'aggregator_connector' },
  });
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  await prisma.methodologyTemplate.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
