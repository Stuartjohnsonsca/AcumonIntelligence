import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

// Toggle a FS line ↔ industry mapping
export async function PUT(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified || (!session.user.isMethodologyAdmin && !session.user.isSuperAdmin)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { fsLineId, industryId, enabled } = await req.json();
  if (!fsLineId || !industryId || enabled === undefined) {
    return NextResponse.json({ error: 'fsLineId, industryId, enabled required' }, { status: 400 });
  }

  if (enabled) {
    await prisma.methodologyFsLineIndustry.upsert({
      where: { fsLineId_industryId: { fsLineId, industryId } },
      create: { fsLineId, industryId },
      update: {},
    });
  } else {
    await prisma.methodologyFsLineIndustry.deleteMany({
      where: { fsLineId, industryId },
    });
  }

  return NextResponse.json({ success: true });
}

// Bulk set all mappings for an FS line
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified || (!session.user.isMethodologyAdmin && !session.user.isSuperAdmin)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { fsLineId, industryIds } = await req.json();
  if (!fsLineId || !Array.isArray(industryIds)) {
    return NextResponse.json({ error: 'fsLineId and industryIds array required' }, { status: 400 });
  }

  // Delete all existing, recreate
  await prisma.methodologyFsLineIndustry.deleteMany({ where: { fsLineId } });
  if (industryIds.length > 0) {
    await prisma.methodologyFsLineIndustry.createMany({
      data: industryIds.map((industryId: string) => ({ fsLineId, industryId })),
    });
  }

  return NextResponse.json({ success: true });
}
