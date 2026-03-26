import { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function GET() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const firmId = session.user.firmId;

  const profiles = await prisma.resourceJobProfile.findMany({
    where: { firmId },
    orderBy: { name: 'asc' },
  });

  return Response.json({ profiles });
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!session.user.isResourceAdmin && !session.user.isSuperAdmin) {
    return Response.json({ error: 'Forbidden: Resource Admin required' }, { status: 403 });
  }

  const body = await request.json();
  const { name, budgetHoursSpecialist, budgetHoursRI, budgetHoursReviewer, budgetHoursPreparer, isDefault } = body;

  if (!name) {
    return Response.json({ error: 'Name is required' }, { status: 400 });
  }

  const profile = await prisma.resourceJobProfile.create({
    data: {
      firmId: session.user.firmId,
      name,
      budgetHoursSpecialist: budgetHoursSpecialist ?? 0,
      budgetHoursRI: budgetHoursRI ?? 0,
      budgetHoursReviewer: budgetHoursReviewer ?? 0,
      budgetHoursPreparer: budgetHoursPreparer ?? 0,
      isDefault: isDefault ?? false,
    },
  });

  return Response.json({ profile }, { status: 201 });
}
