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

  const staleBefore = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const staleTaskResult = await prisma.backgroundTask.deleteMany({
    where: {
      OR: [
        { status: { in: ['completed', 'error'] }, updatedAt: { lt: staleBefore } },
        { status: 'running', updatedAt: { lt: new Date(Date.now() - 2 * 60 * 60 * 1000) } },
      ],
    },
  });

  console.log(`[cron/cleanup] Purged ${expired.length} expired Xero connections, revoked ${revokedCount}. Cleaned ${staleTaskResult.count} background tasks.`);

  return NextResponse.json({
    purged: expired.length,
    revoked: revokedCount,
    backgroundTasksCleaned: staleTaskResult.count,
    timestamp: new Date().toISOString(),
  });
}
