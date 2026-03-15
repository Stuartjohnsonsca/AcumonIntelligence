import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user?.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { effectiveDate, price1, price5, price10, price20 } = await req.json();

  const priceChange = await prisma.priceChange.create({
    data: {
      productId: params.id,
      effectiveDate: new Date(effectiveDate),
      price1: parseFloat(price1),
      price5: parseFloat(price5),
      price10: parseFloat(price10),
      price20: parseFloat(price20),
    },
  });

  return NextResponse.json({ id: priceChange.id });
}
