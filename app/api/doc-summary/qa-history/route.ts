import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { verifySummaryJobAccess } from '@/lib/client-access';

/**
 * GET /api/doc-summary/qa-history?jobId=X&fileId=Y
 * Returns all Q&A messages for a specific file, ordered by turn.
 */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const jobId = searchParams.get('jobId');
  const fileId = searchParams.get('fileId');

  if (!jobId || !fileId) {
    return NextResponse.json({ error: 'jobId and fileId are required' }, { status: 400 });
  }

  const jobAccess = await verifySummaryJobAccess(
    session.user as { id: string; firmId: string; isSuperAdmin?: boolean },
    jobId,
  );
  if (!jobAccess.allowed) {
    return NextResponse.json({ error: jobAccess.reason || 'Forbidden' }, { status: 403 });
  }

  const messages = await prisma.docSummaryQA.findMany({
    where: { jobId, fileId },
    orderBy: { turnOrder: 'asc' },
    select: {
      id: true,
      role: true,
      content: true,
      turnOrder: true,
      createdAt: true,
    },
  });

  return NextResponse.json(messages);
}
