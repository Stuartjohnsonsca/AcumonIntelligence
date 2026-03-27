import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ResourceManagementClient } from '@/components/my-account/ResourceManagementClient';

export default async function ResourceManagementPage() {
  const session = await auth();

  if (!session?.user || !session.user.twoFactorVerified) {
    redirect('/login?callbackUrl=/my-account/resource-management');
  }

  if (!session.user.isResourceAdmin && !session.user.isSuperAdmin) {
    redirect('/my-account');
  }

  const firmId = session.user.firmId;

  // Fetch specialist roles from firm assumptions
  const specialistRolesTable = await prisma.methodologyRiskTable.findUnique({
    where: { firmId_tableType: { firmId, tableType: 'specialistRoles' } },
  });
  const specialistRoles: string[] = (specialistRolesTable?.data as any)?.roles ?? ['EQR', 'Valuations', 'Ethics', 'Technical'];

  // Fetch staff with resource settings (audit staff only)
  const staffRaw = await prisma.user.findMany({
    where: { firmId, isActive: true, isAuditStaff: true },
    select: {
      id: true,
      displayId: true,
      name: true,
      email: true,
      jobTitle: true,
      isActive: true,
      resourceStaffSetting: true,
    },
    orderBy: { name: 'asc' },
  });

  // Fetch job profiles
  const profiles = await prisma.resourceJobProfile.findMany({
    where: { firmId },
    orderBy: { name: 'asc' },
  });

  // Fetch clients with resource settings
  const clientsRaw = await prisma.client.findMany({
    where: { firmId },
    select: {
      id: true,
      clientName: true,
      resourceClientSetting: {
        include: { resourceCategory: { select: { id: true, name: true } } },
      },
    },
    orderBy: { clientName: 'asc' },
  });

  const staff = staffRaw.map((s) => ({
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
          specialistJobLimits: s.resourceStaffSetting.specialistJobLimits as Record<string, number | null> | null,
        }
      : null,
  }));

  const clients = clientsRaw.map((c) => ({
    id: c.id,
    clientName: c.clientName,
    resourceCategoryId: c.resourceClientSetting?.resourceCategoryId ?? null,
    resourceCategoryName: c.resourceClientSetting?.resourceCategory?.name ?? null,
    serviceType: c.resourceClientSetting?.serviceType ?? null,
    rollForwardTimeframe: c.resourceClientSetting?.rollForwardTimeframe ?? null,
  }));

  return (
    <div className="container mx-auto px-4 py-10 max-w-6xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900">Resource Management</h1>
        <p className="text-slate-600 mt-1">Manage staff settings, client resources, and job profiles</p>
      </div>
      <ResourceManagementClient
        staff={staff}
        clients={clients}
        profiles={profiles}
        firmId={firmId}
        specialistRoles={specialistRoles}
      />
    </div>
  );
}
