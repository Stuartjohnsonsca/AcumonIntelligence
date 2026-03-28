import { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { DEFAULT_CONSTRAINT_ORDER } from '@/lib/resource-planning/optimizer-constraints';

export async function GET() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const firmId = session.user.firmId;
  const settings = await prisma.resourceOptimizerSettings.findUnique({ where: { firmId } });

  const stored = settings?.constraintOrder;
  const constraintOrder =
    Array.isArray(stored) && (stored as string[]).length > 0
      ? (stored as string[])
      : DEFAULT_CONSTRAINT_ORDER;

  return Response.json({ constraintOrder });
}

export async function PUT(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!session.user.isResourceAdmin && !session.user.isSuperAdmin) {
    return Response.json({ error: 'Forbidden: Resource Admin required' }, { status: 403 });
  }

  const firmId = session.user.firmId;
  let body: { constraintOrder?: string[] } = {};
  try { body = await request.json(); } catch { /* default */ }

  const constraintOrder = body.constraintOrder ?? DEFAULT_CONSTRAINT_ORDER;

  await prisma.resourceOptimizerSettings.upsert({
    where: { firmId },
    create: { firmId, constraintOrder },
    update: { constraintOrder },
  });

  return Response.json({ constraintOrder });
}
