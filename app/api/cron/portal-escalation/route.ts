import { NextResponse } from 'next/server';
import { escalatePendingRequests } from '@/lib/portal-request-routing';

/**
 * Cron endpoint for Portal Principal request escalation.
 *
 * Hit periodically by the scheduler (Vercel cron / external cron
 * service). Sweeps outstanding portal requests whose column-N SLA has
 * elapsed and advances them to the next level. After all three columns,
 * requests land with the Portal Principal.
 *
 * Auth: accepts either
 *   - ?secret=X matching CRON_SECRET env var, OR
 *   - Authorization: Bearer <CRON_SECRET> header (the Vercel convention)
 *
 * Returns a summary JSON with inspected/escalated counts + per-request
 * log entries so an ops dashboard can show "what happened last sweep".
 */
function isAuthorised(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // Fail-closed when no secret is configured.

  const url = new URL(req.url);
  if (url.searchParams.get('secret') === secret) return true;

  const auth = req.headers.get('authorization') || '';
  if (auth === `Bearer ${secret}`) return true;

  return false;
}

export async function GET(req: Request) {
  if (!isAuthorised(req)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const url = new URL(req.url);
  const firmId = url.searchParams.get('firmId') || undefined;

  try {
    const result = await escalatePendingRequests({ firmId });
    return NextResponse.json({ ok: true, ...result, ranAt: new Date().toISOString() });
  } catch (err: any) {
    console.error('[cron/portal-escalation] failed:', err?.message || err);
    return NextResponse.json({ error: err?.message || 'Sweep failed' }, { status: 500 });
  }
}

// Also expose POST so the Vercel cron contract is covered regardless of method.
export const POST = GET;
