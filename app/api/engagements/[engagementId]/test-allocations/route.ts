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
      methodologyVersion: { select: { config: true } },
    },
  });

  if (!engagement) {
    return NextResponse.json({ error: 'Engagement not found' }, { status: 404 });
  }
  if (engagement.firmId !== session.user.firmId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Get industry from methodology config (used for filtering, but we return all allocations)
  const config = (engagement.methodologyVersion?.config as any) || {};
  const industryId = config.industryId || config.industry;
  let effectiveIndustryId = industryId;
  if (!effectiveIndustryId) {
    const defaultIndustry = await prisma.methodologyIndustry.findFirst({
      where: { firmId: engagement.firmId, isDefault: true, isActive: true },
      select: { id: true },
    });
    effectiveIndustryId = defaultIndustry?.id;
  }

  // Return ALL allocations for the firm (client filters by industry if needed).
  // Drafts are excluded — they're hidden from every engagement's audit plan
  // and from the Plan Customiser. They remain visible in the Test Bank admin
  // so the Methodology Admin can finish building them and toggle off Draft.
  const [allocations, fsLines, allTests] = await Promise.all([
    prisma.methodologyTestAllocation.findMany({
      where: {
        test: { firmId: engagement.firmId, isActive: true, isDraft: false },
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
            category: true,
            outputFormat: true,
            isIngest: true,
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
    // Also return all tests so the client can match by name if no allocations exist
    // (drafts excluded — see comment on the allocations query above).
    prisma.methodologyTest.findMany({
      where: { firmId: engagement.firmId, isActive: true, isDraft: false },
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
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    }),
  ]);

  // One-time migration: rename "Other" → "Normal" category (runs once, idempotent)
  prisma.methodologyTest.updateMany({
    where: { firmId: engagement.firmId, category: 'Other' },
    data: { category: 'Normal' },
  }).catch(() => {});

  return NextResponse.json({ allocations, fsLines, tests: allTests, industryId: effectiveIndustryId });
}
