import { auth } from '@/lib/auth';

export async function POST() {
  const session = await auth();
  if (!session?.user?.firmId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!session.user.isResourceAdmin && !session.user.isSuperAdmin) {
    return Response.json({ error: 'Forbidden: Resource Admin required' }, { status: 403 });
  }

  // Stub: CRM sync not yet implemented
  return Response.json({
    newJobs: 0,
    completedJobs: 0,
    updatedHours: 0,
  });
}
