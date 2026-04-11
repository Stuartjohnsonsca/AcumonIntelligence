import { NextResponse } from 'next/server';
import { assertEngagementWriteAccess } from '@/lib/auth/engagement-auth';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

async function verifyEngagementAccess(engagementId: string, firmId: string | undefined, isSuperAdmin: boolean) {
  const engagement = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    select: { firmId: true },
  });
  if (!engagement) return null;
  if (engagement.firmId !== firmId && !isSuperAdmin) return null;
  return engagement;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ engagementId: string }> }
) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { engagementId } = await params;
  const access = await verifyEngagementAccess(engagementId, session.user.firmId, session.user.isSuperAdmin);
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const dates = await prisma.auditAgreedDate.findMany({
    where: { engagementId },
    orderBy: { sortOrder: 'asc' },
  });

  return NextResponse.json({ dates });
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ engagementId: string }> }
) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { engagementId } = await params;
  const access = await verifyEngagementAccess(engagementId, session.user.firmId, session.user.isSuperAdmin);
  const __eqrGuard = await assertEngagementWriteAccess(engagementId, session);
  if (__eqrGuard instanceof NextResponse) return __eqrGuard;
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json();
  const { dates } = body as { dates: { id?: string; description: string; targetDate?: string | null; revisedTarget?: string | null; progress?: string | null; sortOrder: number }[] };

  // Delete removed, upsert remaining
  const existingIds = dates.filter(d => d.id).map(d => d.id!);
  await prisma.auditAgreedDate.deleteMany({
    where: { engagementId, id: { notIn: existingIds } },
  });

  for (const date of dates) {
    if (date.id) {
      await prisma.auditAgreedDate.update({
        where: { id: date.id },
        data: {
          description: date.description,
          targetDate: date.targetDate ? new Date(date.targetDate) : null,
          revisedTarget: date.revisedTarget ? new Date(date.revisedTarget) : null,
          progress: date.progress,
          sortOrder: date.sortOrder,
        },
      });
    } else {
      await prisma.auditAgreedDate.create({
        data: {
          engagementId,
          description: date.description,
          targetDate: date.targetDate ? new Date(date.targetDate) : null,
          revisedTarget: date.revisedTarget ? new Date(date.revisedTarget) : null,
          progress: date.progress || 'Not Started',
          sortOrder: date.sortOrder,
        },
      });
    }
  }

  const updated = await prisma.auditAgreedDate.findMany({
    where: { engagementId },
    orderBy: { sortOrder: 'asc' },
  });

  return NextResponse.json({ dates: updated });
}
