import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

function canManageClients(session: { user: { isSuperAdmin?: boolean; isFirmAdmin?: boolean; isPortfolioOwner?: boolean } }) {
  return session.user.isSuperAdmin || session.user.isFirmAdmin || session.user.isPortfolioOwner;
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (!canManageClients(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();

  const allowed = ['clientName', 'software', 'contactName', 'contactEmail', 'isActive', 'portfolioManagerId'];
  const data: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in body) data[key] = body[key];
  }

  const client = await prisma.client.update({ where: { id }, data });
  return NextResponse.json(client);
}

// Soft delete — sets isActive to false
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (!canManageClients(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  await prisma.client.update({ where: { id }, data: { isActive: false } });
  return NextResponse.json({ ok: true });
}
