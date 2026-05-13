/**
 * Resolve the public URL of the deployed app — used to build the
 * deep-links embedded in outbound portal notifications (WhatsApp,
 * SMS, Telegram, Teams) and the email digest.
 *
 * Priority (first non-empty wins):
 *
 *   1. PORTAL_PUBLIC_URL                — explicit override. Set this
 *      only when the canonical portal URL differs from the Vercel
 *      production alias (e.g. vanity domain on a different project).
 *   2. requestHost (req.headers.host)   — when the caller is a route
 *      handler we have the actual host the request came in on. This
 *      handles preview deploys + custom domains correctly without any
 *      env config.
 *   3. VERCEL_PROJECT_PRODUCTION_URL    — auto-set by Vercel for every
 *      deployment to the production alias. Tracks the mapped custom
 *      domain when one's configured, otherwise the *.vercel.app URL.
 *      Updates automatically when the domain mapping changes; no
 *      redeploy needed.
 *   4. VERCEL_URL                       — auto-set by Vercel for every
 *      deployment (preview / staging URLs are *.vercel.app). Useful
 *      for non-production environments.
 *
 * Returns null when nothing resolves — the notification still sends
 * without a CTA link rather than embedding an obviously broken URL.
 */
export function resolvePortalPublicUrl(args: { requestHost?: string | null } = {}): string | null {
  // 1 — Explicit override.
  const explicit = (process.env.PORTAL_PUBLIC_URL || '').trim();
  if (explicit) return normaliseUrl(explicit);

  // 2 — Request-context host (best when available).
  if (args.requestHost) {
    const trimmed = args.requestHost.trim();
    // Local dev hosts get a http:// prefix; everything else assumes HTTPS.
    const proto = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(trimmed) ? 'http' : 'https';
    return `${proto}://${trimmed.replace(/\/+$/, '')}`;
  }

  // 3 — Vercel production alias (custom domain or *.vercel.app).
  const prod = (process.env.VERCEL_PROJECT_PRODUCTION_URL || '').trim();
  if (prod) return `https://${stripProtocol(prod).replace(/\/+$/, '')}`;

  // 4 — Per-deployment URL (preview + dev branches on Vercel).
  const vercelUrl = (process.env.VERCEL_URL || '').trim();
  if (vercelUrl) return `https://${stripProtocol(vercelUrl).replace(/\/+$/, '')}`;

  return null;
}

function normaliseUrl(raw: string): string {
  let url = raw.trim();
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  return url.replace(/\/+$/, '');
}

function stripProtocol(raw: string): string {
  return raw.replace(/^https?:\/\//i, '');
}
