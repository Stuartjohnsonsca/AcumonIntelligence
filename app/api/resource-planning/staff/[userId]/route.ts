import { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!session.user.isResourceAdmin && !session.user.isSuperAdmin) {
    return Response.json({ error: 'Forbidden: Resource Admin required' }, { status: 403 });
  }

  const { userId } = await params;
  const body = await request.json();
  const {
    resourceRole,
    concurrentJobLimit,
    isRI,
    weeklyCapacityHrs,
    overtimeHrs,
    preparerJobLimit,
    reviewerJobLimit,
    riJobLimit,
    specialistJobLimit,
  } = body;

  const setting = await prisma.resourceStaffSetting.upsert({
    where: { userId },
    update: {
      ...(resourceRole !== undefined && { resourceRole }),
      ...(concurrentJobLimit !== undefined && { concurrentJobLimit }),
      ...(isRI !== undefined && { isRI }),
      ...(weeklyCapacityHrs !== undefined && { weeklyCapacityHrs }),
      ...(overtimeHrs !== undefined && { overtimeHrs }),
      ...(preparerJobLimit !== undefined && { preparerJobLimit }),
      ...(reviewerJobLimit !== undefined && { reviewerJobLimit }),
      ...(riJobLimit !== undefined && { riJobLimit }),
      ...(specialistJobLimit !== undefined && { specialistJobLimit }),
    },
    create: {
      userId,
      firmId: session.user.firmId,
      resourceRole: resourceRole ?? 'Preparer',
      concurrentJobLimit: concurrentJobLimit ?? 3,
      isRI: isRI ?? false,
      weeklyCapacityHrs: weeklyCapacityHrs ?? 37.5,
      overtimeHrs: overtimeHrs ?? 0,
      preparerJobLimit: preparerJobLimit ?? null,
      reviewerJobLimit: reviewerJobLimit ?? null,
      riJobLimit: riJobLimit ?? null,
      specialistJobLimit: specialistJobLimit ?? null,
    },
  });

  return Response.json({ setting });
}
