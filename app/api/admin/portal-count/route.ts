import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified || !session.user.isSuperAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const url = new URL(req.url);
  const clientName = url.searchParams.get('client') || 'Johnsons';

  const client = await prisma.client.findFirst({
    where: { clientName: { contains: clientName } },
  });
  if (!client) return NextResponse.json({ error: 'Client not found' });

  const requests = await prisma.portalRequest.findMany({
    where: { clientId: client.id },
    select: { id: true, status: true, question: true, requestedByName: true, requestedAt: true },
    orderBy: { requestedAt: 'desc' },
    take: 20,
  });

  const counts = {
    total: await prisma.portalRequest.count({ where: { clientId: client.id } }),
    outstanding: await prisma.portalRequest.count({ where: { clientId: client.id, status: 'outstanding' } }),
    responded: await prisma.portalRequest.count({ where: { clientId: client.id, status: 'responded' } }),
    committed: await prisma.portalRequest.count({ where: { clientId: client.id, status: 'committed' } }),
  };

  return NextResponse.json({
    clientId: client.id,
    clientName: client.clientName,
    counts,
    recentRequests: requests.map(r => ({
      id: r.id,
      status: r.status,
      preview: r.question?.substring(0, 100),
      by: r.requestedByName,
      at: r.requestedAt,
    })),
  });
}
