import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

// POST /api/resource-planning/setup
// Applies default role limits to all audit staff who have a resource setting but no per-role limits set.
// Safe to run multiple times — only updates staff where all per-role limits are currently null/zero.
export async function POST() {
  const session = await auth();
  if (!session?.user?.firmId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!session.user.isResourceAdmin && !session.user.isSuperAdmin) {
    return Response.json({ error: 'Forbidden: Resource Admin required' }, { status: 403 });
  }

  const firmId = session.user.firmId;

  // Find all staff in this firm with a resource setting but no per-role limits configured
  const staffToUpdate = await prisma.resourceStaffSetting.findMany({
    where: {
      user: { firmId, isActive: true },
      preparerJobLimit: null,
      reviewerJobLimit: null,
      riJobLimit: null,
    },
    select: { id: true, userId: true, user: { select: { name: true } } },
  });

  if (staffToUpdate.length === 0) {
    return Response.json({ updated: 0, message: 'All staff already have role limits configured' });
  }

  await prisma.resourceStaffSetting.updateMany({
    where: { id: { in: staffToUpdate.map((s) => s.id) } },
    data: {
      preparerJobLimit: 99,
      reviewerJobLimit: 99,
      riJobLimit: 99,
      isRI: true,
      overtimeHrs: 20,
    },
  });

  return Response.json({
    updated: staffToUpdate.length,
    names: staffToUpdate.map((s) => s.user.name),
  });
}
