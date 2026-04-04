import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

// GET: List allocations for an industry (or all)
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const url = new URL(req.url);
  const industryId = url.searchParams.get('industryId');

  const where: any = {};
  if (industryId) where.industryId = industryId;
  // Scope to firm via the test relation
  where.test = { firmId: session.user.firmId };

  const allocations = await prisma.methodologyTestAllocation.findMany({
    where,
    include: {
      test: { select: { id: true, name: true, testTypeCode: true, assertions: true, framework: true, significantRisk: true, flow: true } },
      fsLine: { select: { id: true, name: true, lineType: true, fsCategory: true } },
      industry: { select: { id: true, name: true } },
    },
    orderBy: [{ sortOrder: 'asc' }],
  });

  return NextResponse.json({ allocations });
}

// PUT: Bulk set allocations for an FS line + industry
export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified || (!session.user.isSuperAdmin && !session.user.isMethodologyAdmin)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { fsLineId, industryId, testIds } = await req.json();
  if (!fsLineId || !industryId || !Array.isArray(testIds)) {
    return NextResponse.json({ error: 'fsLineId, industryId, and testIds[] required' }, { status: 400 });
  }

  // Delete existing allocations for this FS line + industry
  await prisma.methodologyTestAllocation.deleteMany({
    where: { fsLineId, industryId },
  });

  // Create new allocations
  if (testIds.length > 0) {
    await prisma.methodologyTestAllocation.createMany({
      data: testIds.map((testId: string, i: number) => ({
        testId,
        fsLineId,
        industryId,
        sortOrder: i,
      })),
      skipDuplicates: true,
    });
  }

  // Return updated allocations
  const allocations = await prisma.methodologyTestAllocation.findMany({
    where: { fsLineId, industryId },
    include: {
      test: { select: { id: true, name: true, testTypeCode: true, assertions: true, framework: true, significantRisk: true } },
      fsLine: { select: { id: true, name: true } },
    },
    orderBy: { sortOrder: 'asc' },
  });

  return NextResponse.json({ allocations });
}

// POST: Copy allocations from one industry to another
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified || (!session.user.isSuperAdmin && !session.user.isMethodologyAdmin)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { action, sourceIndustryId, targetIndustryId } = await req.json();

  if (action === 'copy' && sourceIndustryId && targetIndustryId) {
    // Get source allocations
    const source = await prisma.methodologyTestAllocation.findMany({
      where: { industryId: sourceIndustryId, test: { firmId: session.user.firmId } },
    });

    // Delete target
    await prisma.methodologyTestAllocation.deleteMany({
      where: { industryId: targetIndustryId },
    });

    // Copy
    if (source.length > 0) {
      await prisma.methodologyTestAllocation.createMany({
        data: source.map(s => ({
          testId: s.testId,
          fsLineId: s.fsLineId,
          industryId: targetIndustryId,
          sortOrder: s.sortOrder,
        })),
        skipDuplicates: true,
      });
    }

    return NextResponse.json({ copied: source.length });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}

// DELETE: Remove specific allocation
export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified || (!session.user.isSuperAdmin && !session.user.isMethodologyAdmin)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await req.json();
  await prisma.methodologyTestAllocation.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
