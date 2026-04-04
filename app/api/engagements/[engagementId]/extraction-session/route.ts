import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

/**
 * POST: Create a new extraction session linked to a test execution
 * GET: List extraction sessions for an engagement
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ engagementId: string }> }) {
  const { engagementId } = await params;
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const { testExecutionId, fsLine } = await req.json();

  const engagement = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    select: { clientId: true },
  });
  if (!engagement) return NextResponse.json({ error: 'Engagement not found' }, { status: 404 });

  // Check if a session already exists for this test execution
  if (testExecutionId) {
    const existing = await prisma.extractionJob.findFirst({
      where: { testExecutionId, status: { not: 'expired' } },
      include: { files: true, records: true },
    });
    if (existing) {
      return NextResponse.json({ job: existing, reused: true });
    }
  }

  // Create new extraction job linked to the engagement and test
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 121); // 121 day expiry

  const job = await prisma.extractionJob.create({
    data: {
      clientId: engagement.clientId,
      userId: session.user.id,
      engagementId,
      testExecutionId: testExecutionId || null,
      fsLine: fsLine || null,
      status: 'pending',
      expiresAt,
    },
  });

  return NextResponse.json({ job, reused: false });
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ engagementId: string }> }) {
  const { engagementId } = await params;
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const url = new URL(req.url);
  const testExecutionId = url.searchParams.get('testExecutionId');
  const fsLine = url.searchParams.get('fsLine');

  const where: any = { engagementId };
  if (testExecutionId) where.testExecutionId = testExecutionId;
  if (fsLine) where.fsLine = fsLine;

  const jobs = await prisma.extractionJob.findMany({
    where,
    include: {
      files: { select: { id: true, originalName: true, status: true } },
      records: { select: { id: true, referenceId: true, sellerName: true, documentRef: true, documentDate: true, netTotal: true, taxTotal: true, grossTotal: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json({ jobs });
}
