import { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!session.user.isResourceAdmin && !session.user.isSuperAdmin) {
    return Response.json({ error: 'Forbidden: Resource Admin required' }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json();
  const { name, budgetHoursSpecialist, budgetHoursRI, budgetHoursReviewer, budgetHoursPreparer, isDefault } = body;

  const profile = await prisma.resourceJobProfile.update({
    where: { id },
    data: {
      ...(name !== undefined && { name }),
      ...(budgetHoursSpecialist !== undefined && { budgetHoursSpecialist }),
      ...(budgetHoursRI !== undefined && { budgetHoursRI }),
      ...(budgetHoursReviewer !== undefined && { budgetHoursReviewer }),
      ...(budgetHoursPreparer !== undefined && { budgetHoursPreparer }),
      ...(isDefault !== undefined && { isDefault }),
    },
  });

  return Response.json({ profile });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!session.user.isResourceAdmin && !session.user.isSuperAdmin) {
    return Response.json({ error: 'Forbidden: Resource Admin required' }, { status: 403 });
  }

  const { id } = await params;

  // Check if profile is referenced by any client settings or jobs
  const [clientSettingCount, jobCount] = await Promise.all([
    prisma.resourceClientSetting.count({ where: { resourceCategoryId: id } }),
    prisma.resourceJob.count({ where: { jobProfileId: id } }),
  ]);

  if (clientSettingCount > 0 || jobCount > 0) {
    return Response.json(
      {
        error: 'Cannot delete profile: it is referenced by client settings or jobs',
        clientSettingCount,
        jobCount,
      },
      { status: 409 },
    );
  }

  await prisma.resourceJobProfile.delete({ where: { id } });

  return Response.json({ ok: true });
}
