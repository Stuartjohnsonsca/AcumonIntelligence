import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

function canManageClients(session: { user: { isSuperAdmin?: boolean; isFirmAdmin?: boolean; isPortfolioOwner?: boolean } }) {
  return session.user.isSuperAdmin || session.user.isFirmAdmin || session.user.isPortfolioOwner;
}

async function verifyClientFirm(user: { firmId: string; isSuperAdmin?: boolean }, clientId: string) {
  if (user.isSuperAdmin) return true;
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { firmId: true } });
  return client?.firmId === user.firmId;
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (!canManageClients(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  if (!(await verifyClientFirm(session.user as { firmId: string; isSuperAdmin?: boolean }, id))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json();

  const allowed = ['clientName', 'software', 'contactFirstName', 'contactSurname', 'contactEmail', 'isActive', 'readOnly', 'portfolioManagerId', 'isListed'];
  const data: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in body) data[key] = body[key];
  }

  const client = await prisma.client.update({ where: { id }, data });
  return NextResponse.json(client);
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (!canManageClients(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  if (!(await verifyClientFirm(session.user as { firmId: string; isSuperAdmin?: boolean }, id))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  await prisma.client.update({ where: { id }, data: { isActive: false } });
  return NextResponse.json({ ok: true });
}
