import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  await prisma.firm.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const firm = await prisma.firm.findUnique({
    where: { id },
    include: {
      users: { select: { id: true, displayId: true, name: true, email: true, isFirmAdmin: true, isPortfolioOwner: true } },
      clients: { include: { _count: { select: { subscriptions: true } } } },
    },
  });

  return NextResponse.json(firm);
}
