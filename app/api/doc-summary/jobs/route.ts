import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { verifyClientAccess } from '@/lib/client-access';

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const clientId = searchParams.get('clientId');
  if (!clientId) {
    return NextResponse.json({ error: 'clientId required' }, { status: 400 });
  }

  const access = await verifyClientAccess(
    session.user as { id: string; firmId: string; isSuperAdmin?: boolean },
    clientId,
  );
  if (!access.allowed) {
    return NextResponse.json({ error: access.reason || 'Forbidden' }, { status: 403 });
  }

  try {
    const jobs = await prisma.docSummaryJob.findMany({
      where: { clientId, userId: session.user.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        status: true,
        totalFiles: true,
        processedCount: true,
        failedCount: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { files: true, findings: true } },
        files: {
          select: { originalName: true },
          orderBy: { createdAt: 'asc' },
          take: 5,
        },
      },
    });

    return NextResponse.json(jobs);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[DocSummary:Jobs] Failed | clientId=${clientId} | error=${msg}`);
    return NextResponse.json({ error: 'Failed to fetch jobs' }, { status: 500 });
  }
}
