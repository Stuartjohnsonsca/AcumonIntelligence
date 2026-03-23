import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (!session.user.isSuperAdmin && !session.user.isFirmAdmin && !session.user.isPortfolioOwner) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const client = await prisma.client.findUnique({ where: { id }, select: { firmId: true } });
  if (!client) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!session.user.isSuperAdmin && client.firmId !== session.user.firmId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  await prisma.client.update({
    where: { id },
    data: { isActive: false },
  });

  return NextResponse.json({ ok: true });
}
