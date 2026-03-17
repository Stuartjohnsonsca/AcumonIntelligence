import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

async function verifyClientFirm(user: { firmId: string; isSuperAdmin?: boolean }, clientId: string) {
  if (user.isSuperAdmin) return true;
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { firmId: true } });
  return client?.firmId === user.firmId;
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  if (!(await verifyClientFirm(session.user as { firmId: string; isSuperAdmin?: boolean }, id))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const assignments = await prisma.userClientAssignment.findMany({
    where: { clientId: id },
    include: { user: { select: { id: true, name: true, displayId: true, email: true } } },
  });

  return NextResponse.json(assignments.map((a) => a.user));
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: clientId } = await params;
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (!session.user.isSuperAdmin && !session.user.isFirmAdmin && !session.user.isPortfolioOwner) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { userId } = await req.json();

  if (!session.user.isSuperAdmin) {
    const client = await prisma.client.findUnique({ where: { id: clientId } });
    if (!client || client.firmId !== session.user.firmId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const targetUser = await prisma.user.findUnique({ where: { id: userId } });
    if (!targetUser || targetUser.firmId !== session.user.firmId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  await prisma.userClientAssignment.upsert({
    where: { userId_clientId: { userId, clientId } },
    create: { userId, clientId },
    update: {},
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: clientId } = await params;
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (!session.user.isSuperAdmin && !session.user.isFirmAdmin && !session.user.isPortfolioOwner) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (!(await verifyClientFirm(session.user as { firmId: string; isSuperAdmin?: boolean }, clientId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { userId } = await req.json();

  await prisma.userClientAssignment.deleteMany({
    where: { userId, clientId },
  });

  return NextResponse.json({ ok: true });
}
