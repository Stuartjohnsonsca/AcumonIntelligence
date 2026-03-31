import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

/**
 * POST /api/admin/clear-tb-amounts
 * One-time utility: clear currentYear and priorYear from all TB rows.
 * Super Admin only.
 */
export async function POST() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified || !session.user.isSuperAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const result = await prisma.auditTBRow.updateMany({
    data: { currentYear: null, priorYear: null },
  });

  return NextResponse.json({ cleared: result.count });
}
