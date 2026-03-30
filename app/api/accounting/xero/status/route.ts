import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { verifyClientAccess } from '@/lib/client-access';

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

  const access = await verifyClientAccess(session.user as { id: string; firmId: string; isSuperAdmin?: boolean }, clientId);
  if (!access.allowed) {
    return NextResponse.json({ error: access.reason || 'Forbidden' }, { status: 403 });
  }

  const conn = await prisma.accountingConnection.findUnique({
    where: { clientId_system: { clientId, system: 'xero' } },
    select: {
      system: true,
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
    system: conn.system,
    orgName: conn.orgName,
    connectedBy: conn.connectedBy,
    connectedAt: conn.connectedAt,
    expiresAt: conn.expiresAt,
  });
}
