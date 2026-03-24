import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function PUT(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!session.user.isSuperAdmin && !session.user.isMethodologyAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { confidenceLevel } = await req.json();
  const firmId = session.user.firmId;

  await prisma.firmSamplingConfig.upsert({
    where: { firmId },
    create: {
      firmId,
      confidenceLevel: confidenceLevel ?? 95,
      updatedBy: session.user.id,
    },
    update: {
      confidenceLevel: confidenceLevel ?? 95,
      updatedBy: session.user.id,
    },
  });

  return NextResponse.json({ success: true });
}
