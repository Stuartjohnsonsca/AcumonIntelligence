import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getFamiliarityTable } from '@/lib/team-familiarity';

export async function GET() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!session.user.isMethodologyAdmin && !session.user.isSuperAdmin && !session.user.isFirmAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const firmId = session.user.firmId;
  const data = await getFamiliarityTable(firmId);
  return NextResponse.json(data);
}

export async function PUT(req: Request) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!session.user.isMethodologyAdmin && !session.user.isSuperAdmin && !session.user.isFirmAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const firmId = session.user.firmId;
  const body = await req.json();
  const { entryId, engagementStartDate, roleStartedDate, ceasedActingDate } = body;

  if (!entryId) return NextResponse.json({ error: 'entryId required' }, { status: 400 });

  // Verify the entry belongs to this firm before update
  const entry = await prisma.teamFamiliarityEntry.findUnique({ where: { id: entryId } });
  if (!entry || entry.firmId !== firmId) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const data: Record<string, any> = {};
  if (engagementStartDate !== undefined) data.engagementStartDate = engagementStartDate ? new Date(engagementStartDate) : null;
  if (roleStartedDate !== undefined) data.roleStartedDate = roleStartedDate ? new Date(roleStartedDate) : null;
  if (ceasedActingDate !== undefined) data.ceasedActingDate = ceasedActingDate ? new Date(ceasedActingDate) : null;

  const updated = await prisma.teamFamiliarityEntry.update({ where: { id: entryId }, data });
  return NextResponse.json({ entry: updated });
}
