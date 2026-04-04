import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

// GET /api/engagements/[engagementId]/test-allocations
// Returns test allocations for the engagement's industry, with full test + fsLine details
export async function GET(
  req: Request,
  { params }: { params: Promise<{ engagementId: string }> }
) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { engagementId } = await params;

  const engagement = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    select: {
      firmId: true,
      methodologyConfig: { select: { config: true } },
    },
  });

  if (!engagement) {
    return NextResponse.json({ error: 'Engagement not found' }, { status: 404 });
  }
  if (engagement.firmId !== session.user.firmId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Get industry from methodology config
  const config = (engagement.methodologyConfig as any)?.config || {};
  const industryId = config.industryId || config.industry;

  // If no industry configured, try default industry
  let effectiveIndustryId = industryId;
  if (!effectiveIndustryId) {
    const defaultIndustry = await prisma.methodologyIndustry.findFirst({
      where: { firmId: engagement.firmId, isDefault: true, isActive: true },
      select: { id: true },
    });
    effectiveIndustryId = defaultIndustry?.id;
  }

  if (!effectiveIndustryId) {
    return NextResponse.json({ allocations: [], fsLines: [] });
  }

  const [allocations, fsLines] = await Promise.all([
    prisma.methodologyTestAllocation.findMany({
      where: {
        industryId: effectiveIndustryId,
        test: { firmId: engagement.firmId, isActive: true },
      },
      include: {
        test: {
          select: {
            id: true,
            name: true,
            description: true,
            testTypeCode: true,
            assertions: true,
            framework: true,
            significantRisk: true,
            flow: true,
          },
        },
        fsLine: {
          select: { id: true, name: true, lineType: true, fsCategory: true },
        },
      },
      orderBy: { sortOrder: 'asc' },
    }),
    prisma.methodologyFsLine.findMany({
      where: { firmId: engagement.firmId, isActive: true },
      select: { id: true, name: true, lineType: true, fsCategory: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    }),
  ]);

  return NextResponse.json({ allocations, fsLines, industryId: effectiveIndustryId });
}
