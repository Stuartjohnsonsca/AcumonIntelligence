import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import bcrypt from 'bcryptjs';

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const firmId = searchParams.get('firmId');

  // Firm admins can only see their own firm's users; super admins see all
  const where = session.user.isSuperAdmin
    ? (firmId ? { firmId } : {})
    : { firmId: session.user.firmId };

  const users = await prisma.user.findMany({
    where,
    select: {
      id: true, displayId: true, name: true, email: true,
      isFirmAdmin: true, isPortfolioOwner: true, isActive: true, expiryDate: true,
    },
    orderBy: { name: 'asc' },
  });

  return NextResponse.json(users);
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (!session.user.isSuperAdmin && !session.user.isFirmAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();
  const { name, email, displayId, password, firmId, isFirmAdmin, isPortfolioOwner } = body;

  if (!name || !email || !displayId || !password || password.length < 8) {
    return NextResponse.json({ error: 'Invalid data' }, { status: 400 });
  }

  const targetFirmId = session.user.isSuperAdmin ? firmId : session.user.firmId;
  const passwordHash = await bcrypt.hash(password, 12);

  const user = await prisma.user.create({
    data: {
      name, email, displayId, passwordHash, firmId: targetFirmId,
      isFirmAdmin: !!isFirmAdmin, isPortfolioOwner: !!isPortfolioOwner,
    },
  });

  return NextResponse.json({ id: user.id });
}
