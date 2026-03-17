import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { sendAccessRequestEmail } from '@/lib/email';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: clientId } = await params;
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    include: {
      portfolioManager: { select: { id: true, name: true, email: true } },
    },
  });

  if (!client) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  }

  if (!client.portfolioManager) {
    return NextResponse.json(
      { error: 'No Portfolio Manager assigned to this client. Please contact your Firm Administrator.' },
      { status: 400 },
    );
  }

  const existing = await prisma.accessRequest.findFirst({
    where: {
      userId: session.user.id,
      clientId,
      status: 'pending',
      expiresAt: { gt: new Date() },
    },
  });

  if (existing) {
    return NextResponse.json({ error: 'You already have a pending request for this client.' }, { status: 409 });
  }

  const token = randomUUID();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  await prisma.accessRequest.create({
    data: {
      userId: session.user.id,
      clientId,
      token,
      expiresAt,
    },
  });

  const baseUrl = process.env.NEXTAUTH_URL || 'https://www.acumonintelligence.com';
  const approveUrl = `${baseUrl}/api/clients/${clientId}/approve-access?token=${token}`;

  try {
    await sendAccessRequestEmail(
      client.portfolioManager.email,
      client.portfolioManager.name,
      session.user.name || session.user.email || 'A user',
      client.clientName,
      approveUrl,
    );
  } catch {
    return NextResponse.json({ error: 'Failed to send email. Please try again.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, message: 'Access request sent to the Portfolio Manager.' });
}
