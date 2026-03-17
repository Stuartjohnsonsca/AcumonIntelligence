import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const clientId = searchParams.get('clientId');
  if (!clientId) {
    return NextResponse.json({ error: 'clientId required' }, { status: 400 });
  }

  const conn = await prisma.accountingConnection.findUnique({
    where: { clientId_system: { clientId, system: 'xero' } },
    select: {
      orgName: true,
      connectedBy: true,
      connectedAt: true,
      expiresAt: true,
    },
  });

  if (!conn || new Date() > conn.expiresAt) {
    return NextResponse.json({ connected: false });
  }

  return NextResponse.json({
    connected: true,
    orgName: conn.orgName,
    connectedBy: conn.connectedBy,
    connectedAt: conn.connectedAt,
    expiresAt: conn.expiresAt,
  });
}
