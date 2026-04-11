import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { rebuildFamiliarityForFirm } from '@/lib/team-familiarity';

export async function POST() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!session.user.isMethodologyAdmin && !session.user.isSuperAdmin && !session.user.isFirmAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const firmId = session.user.firmId;
  const result = await rebuildFamiliarityForFirm(firmId);
  return NextResponse.json({ success: true, ...result });
}
