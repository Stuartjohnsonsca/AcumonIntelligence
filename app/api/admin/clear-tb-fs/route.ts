import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function GET() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified || !session.user.isSuperAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const result = await prisma.auditTBRow.updateMany({
    data: { fsLevel: null, fsStatement: null },
  });

  return NextResponse.json({ success: true, cleared: result.count });
}
