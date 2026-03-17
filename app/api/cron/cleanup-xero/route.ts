import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { decrypt, revokeConnection } from '@/lib/xero';

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization');
  const expectedToken = process.env.CRON_SECRET;

  if (!expectedToken || authHeader !== `Bearer ${expectedToken}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const expired = await prisma.accountingConnection.findMany({
    where: { expiresAt: { lt: new Date() } },
  });

  if (expired.length === 0) {
    return NextResponse.json({ purged: 0, message: 'No expired connections' });
  }

  let revokedCount = 0;

  for (const conn of expired) {
    try {
      const accessToken = decrypt(conn.accessToken);
      if (conn.tenantId) {
        await revokeConnection(accessToken, conn.tenantId);
        revokedCount++;
      }
    } catch {
      // Best-effort revocation; token may already be invalid
    }

    await prisma.accountingConnection.delete({ where: { id: conn.id } });
  }

  console.log(`[cron/cleanup-xero] Purged ${expired.length} expired connections, revoked ${revokedCount} from Xero`);

  return NextResponse.json({
    purged: expired.length,
    revoked: revokedCount,
    timestamp: new Date().toISOString(),
  });
}
