import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function GET(req: Request) {
  try {
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
  } catch (err: unknown) {
    // Surface the real error in the response so diagnostics work without Vercel log access.
    // Safe because this endpoint is already auth-gated above.
    const message = err instanceof Error ? err.message : String(err);
    const code = (err as { code?: string })?.code;
    console.error('[/api/clients][GET] failed:', message, code);
    return NextResponse.json({ error: 'clients_fetch_failed', message, code }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (!session.user.isSuperAdmin && !session.user.isFirmAdmin && !session.user.isPortfolioOwner) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json();
  const targetFirmId = session.user.isSuperAdmin && body.firmId ? body.firmId : session.user.firmId;

  // Auto-assign the creator to every client they create so they
  // can immediately manage the client's contacts / portal access /
  // engagements without a separate "assign me to this client" step.
  // Skipped for super-admins acting cross-firm (where firmId is
  // overridden) since they don't need an assignment to access
  // anything anyway. Idempotent: if a row already exists we skip.
  async function ensureAssignment(userId: string, clientId: string) {
    try {
      await prisma.userClientAssignment.upsert({
        where: { userId_clientId: { userId, clientId } },
        update: {},
        create: { userId, clientId },
      });
    } catch (err) {
      console.error('[clients] auto-assign creator failed:', err);
    }
  }

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
    // Assign the creator to every newly imported client. Done after
    // the transaction so a single auto-assign hiccup can't roll back
    // the whole import.
    if (targetFirmId === session.user.firmId) {
      for (const c of created) await ensureAssignment(session.user.id, c.id);
    }
    return NextResponse.json({ created: created.length });
  }

  const { clientName, software, contactFirstName, contactSurname, contactEmail, address, portfolioManagerId, isListed } = body;
  if (!clientName) return NextResponse.json({ error: 'clientName is required' }, { status: 400 });

  const client = await prisma.client.create({
    data: {
      clientName,
      software: software || null,
      contactFirstName: contactFirstName || null,
      contactSurname: contactSurname || null,
      contactEmail: contactEmail || null,
      address: address || null,
      portfolioManagerId: portfolioManagerId || null,
      isListed: Boolean(isListed),
      firmId: targetFirmId,
    },
  });

  if (targetFirmId === session.user.firmId) {
    await ensureAssignment(session.user.id, client.id);
  }

  return NextResponse.json({ id: client.id });
}
