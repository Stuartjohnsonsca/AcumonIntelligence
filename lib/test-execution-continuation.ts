/**
 * Server-driven continuation for test executions.
 *
 * Each call to processNextNode / processPipelineStep runs for at most
 * ~55 seconds (under the Vercel function timeout) and then returns
 * with status='running' if there's more work to do. Previously the
 * client polled and pinged action='continue' when an execution looked
 * stale — that meant tests stalled forever if the user closed the
 * browser before the run finished. The user reported this and asked
 * for tests to run server-side end-to-end.
 *
 * This helper fires a fire-and-forget HTTP fetch to the engagement's
 * own test-execution endpoint with action='continue'. Each fetch is a
 * fresh Vercel function invocation with its own ~55s budget, so
 * chaining them lets a long execution drive itself to completion
 * without any client involvement.
 *
 * Auth: the receiver bypasses session auth when the request carries
 * `Authorization: Bearer ${CRON_SECRET}` — the same scheme used by
 * the cron endpoints. The continuation token is a server-only secret
 * never exposed to the browser.
 *
 * Safety:
 *   - Only fires when status === 'running' (so it can't resurrect a
 *     completed/failed/cancelled/paused execution).
 *   - The caller is expected to schedule via Next.js `after()` so the
 *     HTTP response goes back to the user before the chained call
 *     starts — no extra latency on the user-facing request.
 *   - Errors are swallowed because this is best-effort plumbing; if
 *     something goes wrong, the existing client-side stale detection
 *     (>30s without an update → ping continue) is still a safety net
 *     for users who happen to have the panel open.
 */

import { prisma } from '@/lib/db';

/**
 * Resolve the deployment's base URL for self-fetches. Prefers the
 * incoming request's host so we hit whichever environment we're
 * running in (preview, prod, local), with environment-variable
 * fallbacks in case the request object isn't available.
 */
function resolveBaseUrl(req?: Request): string | null {
  if (req) {
    try {
      const url = new URL(req.url);
      return `${url.protocol}//${url.host}`;
    } catch { /* fall through to env */ }
  }
  const fromEnv = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL;
  if (!fromEnv) return null;
  return fromEnv.startsWith('http') ? fromEnv : `https://${fromEnv}`;
}

/**
 * Fire-and-forget continuation. Re-checks the execution status from
 * the DB before firing so we don't waste a function invocation on an
 * already-terminal execution. Returns void (the caller must not await
 * or it will defeat the purpose of the chain).
 */
export async function scheduleSelfContinuation(
  engagementId: string,
  executionId: string,
  req?: Request,
): Promise<void> {
  // Status check up front — saves a function invocation on the common
  // case where processNextNode finished the execution within its
  // budget.
  let execution: { status: string } | null = null;
  try {
    execution = await prisma.testExecution.findUnique({
      where: { id: executionId },
      select: { status: true },
    });
  } catch (err) {
    console.error('[test-exec/continue] status check failed:', err);
    return;
  }
  if (!execution || execution.status !== 'running') return;

  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // Without the shared secret we can't authenticate the self-call.
    // Log loudly so the misconfiguration is visible — but don't throw,
    // because the rest of the test-execution flow shouldn't crash on
    // a missing env var.
    console.warn('[test-exec/continue] CRON_SECRET not set — self-continuation disabled. Tests will rely on client polling for now.');
    return;
  }
  const baseUrl = resolveBaseUrl(req);
  if (!baseUrl) {
    console.warn('[test-exec/continue] cannot resolve base URL — self-continuation disabled.');
    return;
  }

  const url = `${baseUrl}/api/engagements/${engagementId}/test-execution/${executionId}`;
  // Intentionally not awaited. fetch returns a Promise that we let
  // dangle so the caller's response can return immediately. The
  // .catch is just to silence Node's unhandled-rejection warnings —
  // if the fetch fails the execution is still safely persisted in
  // the DB and the client poller (or the next user trigger) will
  // pick it up.
  fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${secret}`,
      'X-Continuation-Source': 'self',
    },
    body: JSON.stringify({ action: 'continue' }),
  }).catch((err) => {
    console.error('[test-exec/continue] self-fetch failed:', err?.message || err);
  });
}

/**
 * True when the request carries the internal continuation token. The
 * continue endpoint uses this to bypass session auth — only callable
 * by code with access to CRON_SECRET (i.e. our own server).
 */
export function isInternalContinuationCall(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.get('authorization') || '';
  return auth === `Bearer ${secret}`;
}
