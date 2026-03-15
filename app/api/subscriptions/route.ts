import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const firmId = searchParams.get('firmId') || session.user.firmId;

  const subscriptions = await prisma.subscription.findMany({
    where: { client: { firmId } },
    include: {
      client: { select: { clientName: true } },
      product: { select: { name: true, category: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json(subscriptions);
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (!session.user.isSuperAdmin && !session.user.isFirmAdmin && !session.user.isPortfolioOwner) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { clientId, productId, quantity, startDate } = await req.json();

  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 });

  const start = new Date(startDate);
  const expiry = new Date(start);
  expiry.setDate(expiry.getDate() + product.expiryDays);

  const subscription = await prisma.subscription.create({
    data: {
      clientId, productId, quantity, startDate: start, expiryDate: expiry,
      purchasedById: session.user.id,
    },
  });

  return NextResponse.json({ id: subscription.id });
}
