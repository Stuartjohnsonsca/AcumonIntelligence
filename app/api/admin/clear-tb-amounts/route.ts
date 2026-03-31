import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

/**
 * GET & POST /api/admin/clear-tb-amounts
 * One-time utility: clear currentYear and priorYear from all TB rows.
 * Super Admin only. GET also works so it can be called from browser address bar.
 */
export async function GET() {
  return handleClear();
}

export async function POST() {
  return handleClear();
}

async function handleClear() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified || !session.user.isSuperAdmin) {
    return NextResponse.json({ error: 'Forbidden — Super Admin only' }, { status: 403 });
  }

  const result = await prisma.auditTBRow.updateMany({
    data: { currentYear: null, priorYear: null },
  });

  return NextResponse.json({ success: true, cleared: result.count });
}
