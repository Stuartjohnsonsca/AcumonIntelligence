import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const requestedFirmId = searchParams.get('firmId');
  const firmId = session.user.isSuperAdmin && requestedFirmId ? requestedFirmId : session.user.firmId;
  const includeInactive = searchParams.get('includeInactive') === 'true';

  const clients = await prisma.client.findMany({
    where: {
      firmId,
      ...(includeInactive ? {} : { isActive: true }),
    },
    include: {
      _count: { select: { subscriptions: true, userAssignments: true } },
      userAssignments: { include: { user: { select: { id: true, name: true, displayId: true, email: true } } } },
      portfolioManager: { select: { id: true, name: true, email: true } },
      accountingConnections: {
        select: { system: true, orgName: true, connectedAt: true, expiresAt: true },
        where: { expiresAt: { gt: new Date() } },
      },
    },
    orderBy: { clientName: 'asc' },
  });

  return NextResponse.json(clients);
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (!session.user.isSuperAdmin && !session.user.isFirmAdmin && !session.user.isPortfolioOwner) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json();
  const targetFirmId = session.user.isSuperAdmin && body.firmId ? body.firmId : session.user.firmId;

  // Bulk CSV import: body.clients = array of client objects
  if (Array.isArray(body.clients)) {
    const created = await prisma.$transaction(
      body.clients.map((c: { clientName: string; software?: string; contactFirstName?: string; contactSurname?: string; contactEmail?: string }) =>
        prisma.client.create({
          data: {
            clientName: c.clientName,
            software: c.software || null,
            contactFirstName: c.contactFirstName || null,
            contactSurname: c.contactSurname || null,
            contactEmail: c.contactEmail || null,
            firmId: targetFirmId,
          },
        })
      )
    );
    return NextResponse.json({ created: created.length });
  }

  const { clientName, software, contactFirstName, contactSurname, contactEmail, portfolioManagerId, isListed } = body;
  if (!clientName) return NextResponse.json({ error: 'clientName is required' }, { status: 400 });

  const client = await prisma.client.create({
    data: {
      clientName,
      software: software || null,
      contactFirstName: contactFirstName || null,
      contactSurname: contactSurname || null,
      contactEmail: contactEmail || null,
      portfolioManagerId: portfolioManagerId || null,
      isListed: Boolean(isListed),
      firmId: targetFirmId,
    },
  });

  return NextResponse.json({ id: client.id });
}
