import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const clientId = searchParams.get('clientId');
  if (!clientId) return NextResponse.json({ error: 'clientId required' }, { status: 400 });

  const jobs = await prisma.extractionJob.findMany({
    where: {
      clientId,
      userId: session.user.id,
      status: { in: ['complete', 'processing', 'failed', 'expired'] },
    },
    select: {
      id: true,
      status: true,
      totalFiles: true,
      processedCount: true,
      failedCount: true,
      createdAt: true,
      extractedAt: true,
      expiresAt: true,
      accountingSystem: true,
      orgName: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });

  return NextResponse.json(jobs);
}
