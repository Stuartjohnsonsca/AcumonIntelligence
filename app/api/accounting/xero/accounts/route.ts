import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getAccounts } from '@/lib/xero';
import { verifyClientAccess } from '@/lib/client-access';

// Lightweight endpoint for accounts pre-load — short timeout, minimal retries
export const maxDuration = 15;

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
    // Only 2 retries — this is a pre-load, not critical path
    const accounts = await getAccounts(clientId, 2);
    return NextResponse.json({ accounts });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.warn('[Accounts pre-load] Failed:', msg);
    return NextResponse.json({ error: msg, accounts: [] }, { status: 200 });
    // Return 200 with empty accounts so client doesn't see it as an error
  }
}
