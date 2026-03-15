import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

// GET /api/clients/[id]/assignments — list users assigned to a client
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const assignments = await prisma.userClientAssignment.findMany({
    where: { clientId: id },
    include: { user: { select: { id: true, name: true, displayId: true, email: true } } },
  });

  return NextResponse.json(assignments.map((a) => a.user));
}

// POST /api/clients/[id]/assignments — assign a user to this client
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: clientId } = await params;
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (!session.user.isSuperAdmin && !session.user.isFirmAdmin && !session.user.isPortfolioOwner) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { userId } = await req.json();

  // Verify the client belongs to the user's firm (unless super admin)
  if (!session.user.isSuperAdmin) {
    const client = await prisma.client.findUnique({ where: { id: clientId } });
    if (!client || client.firmId !== session.user.firmId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    // Verify the user belongs to the same firm
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

// DELETE /api/clients/[id]/assignments — remove a user from this client
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: clientId } = await params;
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (!session.user.isSuperAdmin && !session.user.isFirmAdmin && !session.user.isPortfolioOwner) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { userId } = await req.json();

  await prisma.userClientAssignment.deleteMany({
    where: { userId, clientId },
  });

  return NextResponse.json({ ok: true });
}
