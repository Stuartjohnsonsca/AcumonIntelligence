import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

/**
 * POST /api/admin/migrate-category
 * One-time migration: update test category "Other" → "Normal"
 */
export async function POST() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified || !session.user.isSuperAdmin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await prisma.methodologyTest.updateMany({
    where: { category: 'Other' },
    data: { category: 'Normal' },
  });

  return NextResponse.json({ updated: result.count, message: `Updated ${result.count} tests from "Other" to "Normal"` });
}
