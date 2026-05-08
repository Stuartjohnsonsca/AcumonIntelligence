import { prisma } from '@/lib/db';

const COOLDOWN_MIN = parseInt(process.env.ERROR_AUTO_FIX_COOLDOWN_MINUTES || '5', 10);
const DAILY_QUOTA = parseInt(process.env.ERROR_AUTO_FIX_DAILY_QUOTA || '10', 10);

export interface QuotaCheck {
  allowed: boolean;
  reason?: string;
}

/**
 * Quota & cooldown gate for the auto-detected branch of the orchestrator.
 * User-reported errors bypass this check (always allowed) since they're
 * intentional. Auto-detected errors are gated to prevent runaway loops where
 * a fix introduces a new error that triggers another fix.
 *
 * - cooldown: same URL recently auto-detected → skip
 * - daily quota: too many auto-detected fixes in 24h → skip
 */
export async function canAttemptAutoFix(opts: { url: string | null | undefined; source: 'user_reported' | 'auto_detected' }): Promise<QuotaCheck> {
  if (opts.source === 'user_reported') return { allowed: true };

  const now = Date.now();

  // Cooldown — same URL within last N minutes
  if (opts.url) {
    const cutoff = new Date(now - COOLDOWN_MIN * 60_000);
    const recent = await prisma.errorAutoFix.findFirst({
      where: {
        url: opts.url,
        source: 'auto_detected',
        createdAt: { gt: cutoff },
      },
      select: { id: true },
    });
    if (recent) {
      return { allowed: false, reason: `Cooldown: same URL auto-detected within last ${COOLDOWN_MIN} min (${recent.id})` };
    }
  }

  // Daily quota
  const dayCutoff = new Date(now - 24 * 60 * 60_000);
  const count = await prisma.errorAutoFix.count({
    where: { source: 'auto_detected', createdAt: { gt: dayCutoff } },
  });
  if (count >= DAILY_QUOTA) {
    return { allowed: false, reason: `Daily quota exceeded (${count}/${DAILY_QUOTA} auto-detected fixes in last 24h)` };
  }

  return { allowed: true };
}
