import { NextResponse } from 'next/server';
import { assertEngagementWriteAccess } from '@/lib/auth/engagement-auth';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

async function verifyEngagementAccess(engagementId: string, firmId: string | undefined, isSuperAdmin: boolean) {
  const engagement = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    select: { firmId: true },
  });
  if (!engagement) return null;
  if (engagement.firmId !== firmId && !isSuperAdmin) return null;
  return engagement;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ engagementId: string }> }
) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { engagementId } = await params;
  const access = await verifyEngagementAccess(engagementId, session.user.firmId, session.user.isSuperAdmin);
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const contacts = await prisma.auditClientContact.findMany({
    where: { engagementId },
    orderBy: [{ isMainContact: 'desc' }, { name: 'asc' }],
  });

  return NextResponse.json({ contacts });
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ engagementId: string }> }
) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { engagementId } = await params;
  const access = await verifyEngagementAccess(engagementId, session.user.firmId, session.user.isSuperAdmin);
  const __eqrGuard = await assertEngagementWriteAccess(engagementId, session);
  if (__eqrGuard instanceof NextResponse) return __eqrGuard;
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json();
  const { contacts } = body as { contacts: { id?: string; name: string; email?: string; phone?: string; isMainContact: boolean; isInformedManagement?: boolean }[] };

  const existingIds = contacts.filter(c => c.id).map(c => c.id!);
  await prisma.auditClientContact.deleteMany({
    where: { engagementId, id: { notIn: existingIds } },
  });

  for (const contact of contacts) {
    const common = {
      name: contact.name,
      email: contact.email,
      phone: contact.phone,
      isMainContact: contact.isMainContact,
      isInformedManagement: contact.isInformedManagement ?? false,
    };
    if (contact.id) {
      await prisma.auditClientContact.update({
        where: { id: contact.id },
        data: common,
      });
    } else {
      await prisma.auditClientContact.create({
        data: { engagementId, ...common },
      });
    }
  }

  const updated = await prisma.auditClientContact.findMany({
    where: { engagementId },
    orderBy: [{ isMainContact: 'desc' }, { name: 'asc' }],
  });

  return NextResponse.json({ contacts: updated });
}
