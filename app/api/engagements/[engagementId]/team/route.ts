import { NextResponse } from 'next/server';

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

  const [teamMembers, specialists] = await Promise.all([
    prisma.auditTeamMember.findMany({
      where: { engagementId },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { joinedAt: 'asc' },
    }),
    prisma.auditSpecialist.findMany({
      where: { engagementId },
      orderBy: { specialistType: 'asc' },
    }),
  ]);

  return NextResponse.json({ teamMembers, specialists });
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ engagementId: string }> }
) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { engagementId } = await params;
  const access = await verifyEngagementAccess(engagementId, session.user.firmId, session.user.isSuperAdmin);
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json();
  const { teamMembers, specialists } = body as {
    teamMembers?: { id?: string; userId: string; role: string }[];
    specialists?: { id?: string; name: string; email?: string; specialistType: string; firmName?: string }[];
  };

  // Update team members if provided
  if (teamMembers) {
    const memberIds = teamMembers.filter(m => m.id).map(m => m.id!);
    await prisma.auditTeamMember.deleteMany({
      where: { engagementId, id: { notIn: memberIds } },
    });

    for (const member of teamMembers) {
      if (member.id) {
        await prisma.auditTeamMember.update({
          where: { id: member.id },
          data: { role: member.role },
        });
      } else {
        // Check for unique constraint (engagementId, userId)
        const existing = await prisma.auditTeamMember.findUnique({
          where: { engagementId_userId: { engagementId, userId: member.userId } },
        });
        if (existing) {
          await prisma.auditTeamMember.update({
            where: { id: existing.id },
            data: { role: member.role },
          });
        } else {
          await prisma.auditTeamMember.create({
            data: { engagementId, userId: member.userId, role: member.role },
          });
        }
      }
    }
  }

  // Update specialists if provided
  if (specialists) {
    const specIds = specialists.filter(s => s.id).map(s => s.id!);
    await prisma.auditSpecialist.deleteMany({
      where: { engagementId, id: { notIn: specIds } },
    });

    for (const spec of specialists) {
      if (spec.id) {
        await prisma.auditSpecialist.update({
          where: { id: spec.id },
          data: { name: spec.name, email: spec.email, specialistType: spec.specialistType, firmName: spec.firmName },
        });
      } else {
        await prisma.auditSpecialist.create({
          data: { engagementId, name: spec.name, email: spec.email, specialistType: spec.specialistType, firmName: spec.firmName },
        });
      }
    }
  }

  const [updatedMembers, updatedSpecialists] = await Promise.all([
    prisma.auditTeamMember.findMany({
      where: { engagementId },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { joinedAt: 'asc' },
    }),
    prisma.auditSpecialist.findMany({
      where: { engagementId },
      orderBy: { specialistType: 'asc' },
    }),
  ]);

  return NextResponse.json({ teamMembers: updatedMembers, specialists: updatedSpecialists });
}
