import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function GET() {
  const session = await auth();
  if (!session?.user?.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const firms = await prisma.firm.findMany({
    include: { _count: { select: { users: true, clients: true } } },
    orderBy: { name: 'asc' },
  });

  return NextResponse.json(firms);
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { name } = await req.json();
  const firm = await prisma.firm.create({ data: { name } });
  return NextResponse.json({ id: firm.id });
}
