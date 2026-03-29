import { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.firmId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!session.user.isResourceAdmin && !session.user.isSuperAdmin) {
    return Response.json({ error: 'Forbidden: Resource Admin required' }, { status: 403 });
  }

  const { id } = await params;

  // Verify the job exists
  const job = await prisma.resourceJob.findUnique({ where: { id } });
  if (!job) {
    return Response.json({ error: 'Job not found' }, { status: 404 });
  }

  // Stub: return empty proposal for now
  return Response.json({
    proposal: {
      jobId: id,
      allocations: [],
      conflicts: [],
    },
  });
}
