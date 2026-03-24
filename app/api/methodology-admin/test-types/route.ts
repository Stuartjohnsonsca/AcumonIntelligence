import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function GET() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified || (!session.user.isSuperAdmin && !session.user.isMethodologyAdmin)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
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

  const { name, code } = await req.json();
  const firmId = session.user.firmId;

  const existing = await prisma.methodologyTestType.findUnique({
    where: { firmId_code: { firmId, code } },
  });
  if (existing) {
    return NextResponse.json({ error: 'Test type code already exists' }, { status: 400 });
  }

  const testType = await prisma.methodologyTestType.create({
    data: { firmId, name, code, isActive: true },
  });

  return NextResponse.json({ testType });
}

export async function PATCH(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified || (!session.user.isSuperAdmin && !session.user.isMethodologyAdmin)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id, name, isActive } = await req.json();
  const data: any = {};
  if (name !== undefined) data.name = name;
  if (isActive !== undefined) data.isActive = isActive;

  const testType = await prisma.methodologyTestType.update({
    where: { id },
    data,
  });

  return NextResponse.json({ testType });
}
