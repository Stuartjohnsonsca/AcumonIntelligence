import { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

const LOCK_EXPIRY_MS = 30 * 60 * 1000; // 30 minutes inactivity

async function requireAdmin() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return null;
  if (!session.user.isResourceAdmin && !session.user.isSuperAdmin) return null;
  return session;
}

// POST /api/resource-planning/lock
// Body: { force?: true } — force=true allows an admin to take over a stale lock
export async function POST(request: NextRequest) {
  const session = await requireAdmin();
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const firmId = session.user.firmId;
  const userId = session.user.id;
  const userName = session.user.name ?? 'Unknown';

  const body = await request.json().catch(() => ({}));
  const force = body?.force === true;

  // Delete any expired lock
  await prisma.resourcePlanningLock.deleteMany({
    where: { firmId, lastActivity: { lt: new Date(Date.now() - LOCK_EXPIRY_MS) } },
  });

  // If force-taking, delete the existing lock regardless of owner
  if (force) {
    await prisma.resourcePlanningLock.deleteMany({ where: { firmId } });
  }

  const existing = await prisma.resourcePlanningLock.findUnique({ where: { firmId } });

  if (existing) {
    if (existing.userId === userId) {
      // Already the lock holder — refresh activity
      await prisma.resourcePlanningLock.update({
        where: { firmId },
        data: { lastActivity: new Date() },
      });
      return Response.json({ acquired: true });
    }
    return Response.json({ acquired: false, lockedBy: existing.userName, lockedAt: existing.lockedAt });
  }

  // Try to create the lock (unique constraint on firmId prevents races)
  try {
    await prisma.resourcePlanningLock.create({ data: { firmId, userId, userName } });
    return Response.json({ acquired: true });
  } catch {
    const lock = await prisma.resourcePlanningLock.findUnique({ where: { firmId } });
    return Response.json({ acquired: false, lockedBy: lock?.userName ?? 'Another admin', lockedAt: lock?.lockedAt });
  }
}

// PATCH /api/resource-planning/lock — heartbeat, keeps lock alive
export async function PATCH() {
  const session = await requireAdmin();
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  await prisma.resourcePlanningLock.updateMany({
    where: { firmId: session.user.firmId, userId: session.user.id },
    data: { lastActivity: new Date() },
  });
  return Response.json({ ok: true });
}

// DELETE /api/resource-planning/lock — release lock (only the holder can release)
export async function DELETE() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  await prisma.resourcePlanningLock.deleteMany({
    where: { firmId: session.user.firmId, userId: session.user.id },
  });
  return Response.json({ ok: true });
}
