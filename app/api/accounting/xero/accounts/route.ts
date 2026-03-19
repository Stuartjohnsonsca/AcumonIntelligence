import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { verifyClientAccess } from '@/lib/client-access';

// Ultra-fast: reads cached accounts from DB, no Xero API calls
// Cache is populated by fetch-background route during data fetches

export async function GET(req: Request) {
  const start = Date.now();
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

  try {
    // Read cached accounts from DB — no Xero API call needed
    const conn = await prisma.accountingConnection.findUnique({
      where: { clientId_system: { clientId, system: 'xero' } },
      select: { accountsCache: true, accountsCachedAt: true },
    });

    const accounts = (conn?.accountsCache as { Code: string; Name: string }[] | null) ?? [];
    const cachedAt = conn?.accountsCachedAt?.toISOString() ?? null;
    const elapsed = Date.now() - start;

    console.log(`[Accounts] Returned ${accounts.length} cached accounts in ${elapsed}ms (cached: ${cachedAt ?? 'never'})`);

    return NextResponse.json({
      accounts,
      cached: true,
      cachedAt,
      // If no cache exists, tell the client to fetch data first
      ...(accounts.length === 0 ? { hint: 'No cached accounts. Fetch data from Xero first.' } : {}),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[Accounts] DB error:', msg);
    return NextResponse.json({ accounts: [], error: msg });
  }
}
