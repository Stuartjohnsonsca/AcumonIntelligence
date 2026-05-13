/**
 * Portal trusted-device helpers.
 *
 * The Portal Principal can set a per-engagement window
 * (AuditEngagement.portal2faTrustDays) during which a browser that's
 * already completed 2FA can re-authenticate with just username +
 * password. A different browser has no trust cookie and always falls
 * back to the email-code flow.
 *
 * Resolution rule for the trust window when the user is on multiple
 * engagements:
 *   - take the MIN of non-null portal_2fa_trust_days across every
 *     active engagement the user is involved in (Principal OR
 *     access-confirmed staff member).
 *   - null / 0 → always require 2FA (the safe default).
 * MIN guards against one lax engagement weakening another stricter
 * one — a 1-day setting always wins over a 30-day setting.
 */

import crypto from 'crypto';
import { prisma } from '@/lib/db';

export const PORTAL_DEVICE_COOKIE = 'portal_device_token';

/**
 * Look up the active trust window (in days) for a portal user. Returns
 * 0 when no engagement has a non-null trust-days setting — callers
 * treat 0 as "always require 2FA".
 */
export async function resolveTrustDays(userId: string): Promise<number> {
  const user = await prisma.clientPortalUser.findUnique({
    where: { id: userId },
    select: { id: true, clientId: true },
  });
  if (!user) return 0;

  // Principal engagements — anywhere the user is the named portal
  // principal, even if setup is incomplete (the setting still
  // applies to future logins).
  const principalEngagements = await prisma.auditEngagement.findMany({
    where: { portalPrincipalId: userId },
    select: { portal2faTrustDays: true },
  });

  // Staff engagements — anywhere they're an active, access-confirmed
  // staff member.
  const staffMemberships = await prisma.clientPortalStaffMember.findMany({
    where: { portalUserId: userId, isActive: true, accessConfirmed: true },
    select: { engagement: { select: { portal2faTrustDays: true } } },
  });

  const values: number[] = [];
  for (const e of principalEngagements) {
    if (typeof e.portal2faTrustDays === 'number' && e.portal2faTrustDays > 0) {
      values.push(e.portal2faTrustDays);
    }
  }
  for (const s of staffMemberships) {
    const v = s.engagement?.portal2faTrustDays;
    if (typeof v === 'number' && v > 0) values.push(v);
  }
  if (values.length === 0) return 0;
  return Math.min(...values);
}

/**
 * Look up an active trusted-device row for (userId, deviceToken).
 * Returns null when no match, the token is revoked, or it has
 * expired. On a successful match the lastUsedAt is bumped so an
 * admin "manage devices" view can sort by recency.
 */
export async function findActiveTrustedDevice(
  userId: string,
  deviceToken: string | null | undefined,
): Promise<{ id: string; expiresAt: Date } | null> {
  if (!deviceToken) return null;
  const device = await prisma.clientPortalTrustedDevice.findUnique({
    where: { deviceToken },
    select: { id: true, userId: true, expiresAt: true, revokedAt: true },
  });
  if (!device) return null;
  if (device.userId !== userId) return null;
  if (device.revokedAt) return null;
  if (device.expiresAt.getTime() < Date.now()) return null;
  await prisma.clientPortalTrustedDevice.update({
    where: { id: device.id },
    data: { lastUsedAt: new Date() },
  }).catch(() => {}); // tolerant — bump is best-effort
  return { id: device.id, expiresAt: device.expiresAt };
}

/**
 * Mint a new trusted device for the user. Returns the device token
 * (to be set as the portal_device_token cookie) and its expiry. When
 * the user's resolved trust window is 0 the function returns null —
 * we don't store anything, the next login must go through 2FA again.
 */
export async function mintTrustedDevice(args: {
  userId: string;
  userAgent?: string | null;
  ipAddress?: string | null;
}): Promise<{ token: string; expiresAt: Date } | null> {
  const days = await resolveTrustDays(args.userId);
  if (!days || days <= 0) return null;
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  const label = (args.userAgent || '').slice(0, 80) || null;
  await prisma.clientPortalTrustedDevice.create({
    data: {
      userId: args.userId,
      deviceToken: token,
      label,
      userAgent: args.userAgent || null,
      ipAddress: args.ipAddress || null,
      expiresAt,
    },
  });
  return { token, expiresAt };
}

/**
 * Best-effort revoke — used by "sign out everywhere". Doesn't throw
 * when the device wasn't found; the user-facing effect is the same.
 */
export async function revokeTrustedDevice(deviceToken: string | null | undefined): Promise<void> {
  if (!deviceToken) return;
  await prisma.clientPortalTrustedDevice.updateMany({
    where: { deviceToken, revokedAt: null },
    data: { revokedAt: new Date() },
  }).catch(() => {});
}
