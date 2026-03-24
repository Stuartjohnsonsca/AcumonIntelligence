import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified || (!session.user.isSuperAdmin && !session.user.isMethodologyAdmin)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { firmId, name, code } = await req.json();

  // Check for duplicate code
  const existing = await prisma.methodologyIndustry.findUnique({
    where: { firmId_code: { firmId, code } },
  });
  if (existing) {
    return NextResponse.json({ error: 'Industry code already exists' }, { status: 400 });
  }

  const industry = await prisma.methodologyIndustry.create({
    data: { firmId, name, code, isDefault: false, isActive: true },
  });

  return NextResponse.json({ industry });
}

export async function PATCH(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified || (!session.user.isSuperAdmin && !session.user.isMethodologyAdmin)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id, isActive, name } = await req.json();

  const data: any = {};
  if (isActive !== undefined) data.isActive = isActive;
  if (name !== undefined) data.name = name;

  const industry = await prisma.methodologyIndustry.update({
    where: { id },
    data,
  });

  return NextResponse.json({ industry });
}

export async function DELETE(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified || (!session.user.isSuperAdmin && !session.user.isMethodologyAdmin)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await req.json();

  // Don't allow deleting default
  const industry = await prisma.methodologyIndustry.findUnique({ where: { id } });
  if (industry?.isDefault) {
    return NextResponse.json({ error: 'Cannot delete the default industry' }, { status: 400 });
  }

  await prisma.methodologyIndustry.delete({ where: { id } });

  return NextResponse.json({ success: true });
}
