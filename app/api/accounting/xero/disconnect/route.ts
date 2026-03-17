import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { decrypt, revokeConnection } from '@/lib/xero';
import { verifyClientAccess } from '@/lib/client-access';

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const { clientId } = await req.json();
  if (!clientId) {
    return NextResponse.json({ error: 'clientId required' }, { status: 400 });
  }

  const access = await verifyClientAccess(session.user as { id: string; firmId: string; isSuperAdmin?: boolean }, clientId);
  if (!access.allowed) {
    return NextResponse.json({ error: access.reason || 'Forbidden' }, { status: 403 });
  }

  const conn = await prisma.accountingConnection.findUnique({
    where: { clientId_system: { clientId, system: 'xero' } },
  });

  if (!conn) {
    return NextResponse.json({ error: 'No active Xero connection found' }, { status: 404 });
  }

  try {
    const accessToken = decrypt(conn.accessToken);
    if (conn.tenantId) {
      await revokeConnection(accessToken, conn.tenantId);
    }
  } catch {
    // Best-effort revocation; continue with deletion even if Xero API call fails
  }

  await prisma.accountingConnection.delete({ where: { id: conn.id } });

  return NextResponse.json({ ok: true, message: 'Xero connection disconnected' });
}
