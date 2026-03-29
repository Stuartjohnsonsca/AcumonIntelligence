import { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ clientId: string }> },
) {
  const session = await auth();
  if (!session?.user?.firmId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { clientId } = await params;

  const setting = await prisma.resourceClientSetting.findUnique({
    where: { clientId },
    include: {
      client: { select: { clientName: true } },
      resourceCategory: { select: { name: true } },
    },
  });

  if (!setting) {
    return Response.json({ error: 'Client setting not found' }, { status: 404 });
  }

  return Response.json({
    clientSetting: {
      id: setting.id,
      clientId: setting.clientId,
      clientName: setting.client.clientName,
      resourceCategoryId: setting.resourceCategoryId,
      resourceCategoryName: setting.resourceCategory?.name ?? null,
      serviceType: setting.serviceType,
      rollForwardTimeframe: setting.rollForwardTimeframe,
    },
  });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ clientId: string }> },
) {
  const session = await auth();
  if (!session?.user?.firmId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!session.user.isResourceAdmin && !session.user.isSuperAdmin) {
    return Response.json({ error: 'Forbidden: Resource Admin required' }, { status: 403 });
  }

  const { clientId } = await params;
  const body = await request.json();
  const { resourceCategoryId } = body;

  // Only resourceCategoryId is updatable; serviceType and rollForwardTimeframe are read-only from CRM
  const setting = await prisma.resourceClientSetting.update({
    where: { clientId },
    data: {
      ...(resourceCategoryId !== undefined && { resourceCategoryId }),
    },
    include: {
      client: { select: { clientName: true } },
      resourceCategory: { select: { name: true } },
    },
  });

  return Response.json({
    clientSetting: {
      id: setting.id,
      clientId: setting.clientId,
      clientName: setting.client.clientName,
      resourceCategoryId: setting.resourceCategoryId,
      resourceCategoryName: setting.resourceCategory?.name ?? null,
      serviceType: setting.serviceType,
      rollForwardTimeframe: setting.rollForwardTimeframe,
    },
  });
}
