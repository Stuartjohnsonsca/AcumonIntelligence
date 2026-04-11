import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { setFamiliarityLimits, getFamiliarityLimits } from '@/lib/team-familiarity';

export async function GET() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const limits = await getFamiliarityLimits(session.user.firmId);
  return NextResponse.json(limits);
}

export async function PUT(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!session.user.isMethodologyAdmin && !session.user.isSuperAdmin && !session.user.isFirmAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json();
  const { riFamiliarityLimitNonPIE, riFamiliarityLimitPIE } = body;

  if (typeof riFamiliarityLimitNonPIE !== 'number' || typeof riFamiliarityLimitPIE !== 'number') {
    return NextResponse.json({ error: 'Both limits must be numbers' }, { status: 400 });
  }
  if (riFamiliarityLimitNonPIE < 1 || riFamiliarityLimitPIE < 1) {
    return NextResponse.json({ error: 'Limits must be at least 1' }, { status: 400 });
  }

  await setFamiliarityLimits(session.user.firmId, { riFamiliarityLimitNonPIE, riFamiliarityLimitPIE });
  return NextResponse.json({ success: true });
}
