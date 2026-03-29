import { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.firmId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const firmId = session.user.firmId;

  const staff = await prisma.user.findMany({
    where: { firmId, isActive: true },
    select: {
      id: true,
      displayId: true,
      name: true,
      email: true,
      jobTitle: true,
      isActive: true,
      resourceStaffSetting: {
        select: {
          id: true,
          resourceRole: true,
          concurrentJobLimit: true,
          isRI: true,
          weeklyCapacityHrs: true,
          overtimeHrs: true,
          preparerJobLimit: true,
          reviewerJobLimit: true,
          riJobLimit: true,
          specialistJobLimit: true,
        },
      },
    },
    orderBy: { name: 'asc' },
  });

  const mapped = staff.map((s) => ({
    id: s.id,
    displayId: s.displayId,
    name: s.name,
    email: s.email,
    jobTitle: s.jobTitle,
    isActive: s.isActive,
    resourceSetting: s.resourceStaffSetting
      ? {
          id: s.resourceStaffSetting.id,
          resourceRole: s.resourceStaffSetting.resourceRole,
          concurrentJobLimit: s.resourceStaffSetting.concurrentJobLimit,
          isRI: s.resourceStaffSetting.isRI,
          weeklyCapacityHrs: s.resourceStaffSetting.weeklyCapacityHrs,
          overtimeHrs: s.resourceStaffSetting.overtimeHrs,
          preparerJobLimit: s.resourceStaffSetting.preparerJobLimit,
          reviewerJobLimit: s.resourceStaffSetting.reviewerJobLimit,
          riJobLimit: s.resourceStaffSetting.riJobLimit,
          specialistJobLimit: s.resourceStaffSetting.specialistJobLimit,
        }
      : null,
  }));

  return Response.json({ staff: mapped });
}
