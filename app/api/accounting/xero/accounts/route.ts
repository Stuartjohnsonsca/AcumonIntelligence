import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getValidToken } from '@/lib/xero';
import { verifyClientAccess } from '@/lib/client-access';

// Ultra-lightweight: single Xero call, no retries, no backoff
// Must complete within Vercel's function timeout (10s hobby / 15s pro)

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

  try {
    // Step 1: Get valid token (DB lookup + refresh if expired, ~1-2s max)
    const { accessToken, tenantId } = await getValidToken(clientId);

    // Step 2: Single direct fetch — no retry wrapper, no backoff
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000); // 7s hard limit

    const res = await fetch('https://api.xero.com/api.xro/2.0/Accounts', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Xero-Tenant-Id': tenantId,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      console.warn(`[Accounts] Xero returned ${res.status}`);
      return NextResponse.json({ accounts: [] });
    }

    const data = await res.json();
    console.log(`[Accounts] Loaded ${data.Accounts?.length ?? 0} accounts`);
    return NextResponse.json({ accounts: data.Accounts ?? [] });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.warn('[Accounts] Failed:', msg);
    return NextResponse.json({ accounts: [] });
  }
}
