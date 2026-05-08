// Shared-secret authentication for the orchestrator → Acumon HTTP path.
// The orchestrator (a separately hosted Node + Playwright service running
// on Azure Container Apps) carries a static secret in the
// `X-Orchestrator-Secret` header. We compare in constant time.
//
// Set ORCHESTRATOR_SECRET in Vercel env (and the same value in the
// orchestrator's container env). 32+ bytes of base64url is a sensible
// minimum.

import { createHash, timingSafeEqual } from 'node:crypto';

export function verifyOrchestratorSecret(req: Request): boolean {
  const expected = process.env.ORCHESTRATOR_SECRET || '';
  if (!expected) {
    console.warn('[orchestrator-auth] ORCHESTRATOR_SECRET not configured — refusing all calls');
    return false;
  }
  const provided = req.headers.get('x-orchestrator-secret') || '';
  if (!provided) return false;
  // Hash both sides so the comparison length is fixed regardless of
  // input length — defends against timing attacks that try to discover
  // the secret length.
  const a = createHash('sha256').update(expected).digest();
  const b = createHash('sha256').update(provided).digest();
  return timingSafeEqual(a, b);
}
