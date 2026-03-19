import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { decrypt } from '@/lib/xero';
import { verifyClientAccess } from '@/lib/client-access';

// Fast accounts endpoint:
// 1. Try DB cache first (instant)
// 2. If cache empty, try direct Xero call using stored token (no refresh)
// 3. Cache is refreshed by fetch-background on every data fetch

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
    const conn = await prisma.accountingConnection.findUnique({
      where: { clientId_system: { clientId, system: 'xero' } },
      select: {
        accountsCache: true,
        accountsCachedAt: true,
        accessToken: true,
        tenantId: true,
        tokenExpiresAt: true,
      },
    });

    if (!conn) {
      return NextResponse.json({ accounts: [], hint: 'No Xero connection found' });
    }

    // 1. Try cache first
    const cached = (conn.accountsCache as { Code: string; Name: string }[] | null) ?? [];
    if (cached.length > 0) {
      const elapsed = Date.now() - start;
      console.log(`[Accounts] Cache hit: ${cached.length} accounts in ${elapsed}ms`);
      return NextResponse.json({ accounts: cached, cached: true, cachedAt: conn.accountsCachedAt?.toISOString() });
    }

    // 2. Cache empty — try direct Xero call (only if token is still valid)
    const now = new Date();
    if (now >= conn.tokenExpiresAt) {
      console.log(`[Accounts] Cache empty + token expired — cannot fetch. User needs to do a data fetch first.`);
      return NextResponse.json({ accounts: [], hint: 'Token expired. Fetch data from Xero to populate accounts.' });
    }

    console.log(`[Accounts] Cache empty — trying direct Xero call...`);
    const accessToken = decrypt(conn.accessToken);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);

    try {
      const xeroStart = Date.now();
      const res = await fetch('https://api.xero.com/api.xro/2.0/Accounts', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Xero-Tenant-Id': conn.tenantId!,
          Accept: 'application/json',
        },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const xeroMs = Date.now() - xeroStart;

      if (!res.ok) {
        console.warn(`[Accounts] Xero returned ${res.status} in ${xeroMs}ms`);
        return NextResponse.json({ accounts: [], hint: `Xero returned ${res.status}` });
      }

      const data = await res.json();
      const accounts = data.Accounts ?? [];
      console.log(`[Accounts] Fetched ${accounts.length} accounts from Xero in ${xeroMs}ms — caching`);

      // Cache for next time
      await prisma.accountingConnection.update({
        where: { clientId_system: { clientId, system: 'xero' } },
        data: {
          accountsCache: accounts as unknown as never,
          accountsCachedAt: new Date(),
        },
      });

      return NextResponse.json({ accounts, cached: false });
    } catch (fetchErr) {
      clearTimeout(timeout);
      const msg = fetchErr instanceof Error ? fetchErr.message : 'Unknown';
      console.warn(`[Accounts] Direct Xero call failed: ${msg}`);
      return NextResponse.json({ accounts: [], hint: 'Xero call timed out. Fetch data first.' });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[Accounts] Error:', msg);
    return NextResponse.json({ accounts: [], error: msg });
  }
}
