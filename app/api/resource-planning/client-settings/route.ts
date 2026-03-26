import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function GET() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const firmId = session.user.firmId;

  const settings = await prisma.resourceClientSetting.findMany({
    where: { firmId },
    include: {
      client: { select: { clientName: true } },
      resourceCategory: { select: { name: true } },
    },
    orderBy: { client: { clientName: 'asc' } },
  });

  const mapped = settings.map((s) => ({
    id: s.id,
    clientId: s.clientId,
    clientName: s.client.clientName,
    resourceCategoryId: s.resourceCategoryId,
    resourceCategoryName: s.resourceCategory?.name ?? null,
    serviceType: s.serviceType,
    rollForwardTimeframe: s.rollForwardTimeframe,
  }));

  return Response.json({ clientSettings: mapped });
}
