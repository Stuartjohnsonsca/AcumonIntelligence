import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

/**
 * POST /api/admin/assign-client
 * Assign the current user to a client. Super Admin only.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified || !session.user.isSuperAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { clientName } = await req.json();

  const client = await prisma.client.findFirst({
    where: { clientName: { contains: clientName || '' } },
  });
  if (!client) return NextResponse.json({ error: `Client "${clientName}" not found` }, { status: 404 });

  // Check if already assigned
  const existing = await prisma.userClientAssignment.findUnique({
    where: { userId_clientId: { userId: session.user.id, clientId: client.id } },
  });
  if (existing) return NextResponse.json({ message: 'Already assigned', clientId: client.id, clientName: client.clientName });

  await prisma.userClientAssignment.create({
    data: { userId: session.user.id, clientId: client.id },
  });

  return NextResponse.json({ message: `Assigned to ${client.clientName}`, clientId: client.id });
}
