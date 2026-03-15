import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

// Returns user ID by email (used after credentials sign-in for 2FA step)
export async function POST(req: Request) {
  try {
    const { email } = await req.json();
    if (!email) return NextResponse.json({ userId: null });
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    return NextResponse.json({ userId: user?.id ?? null });
  } catch {
    return NextResponse.json({ userId: null });
  }
}
