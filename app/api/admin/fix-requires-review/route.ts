import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

/**
 * POST /api/admin/fix-requires-review
 * Sets requiresReview=false on all existing AI action execution definitions.
 */
export async function POST() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified || !session.user.isSuperAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const testTypes = await prisma.methodologyTestType.findMany({
    where: { firmId: session.user.firmId, actionType: 'ai_action' },
  });

  let updated = 0;
  for (const tt of testTypes) {
    const execDef = tt.executionDef as any;
    if (execDef && execDef.requiresReview === true) {
      execDef.requiresReview = false;
      await prisma.methodologyTestType.update({
        where: { id: tt.id },
        data: { executionDef: execDef },
      });
      updated++;
    }
  }

  return NextResponse.json({ message: `Updated ${updated} AI action(s)`, updated });
}
