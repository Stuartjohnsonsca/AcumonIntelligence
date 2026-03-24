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
    // Detect RI (Partner) changes — get current RIs before update
    const currentRIs = await prisma.auditTeamMember.findMany({
      where: { engagementId, role: 'RI' },
      select: { userId: true },
    });
    const currentRIIds = new Set(currentRIs.map(r => r.userId));

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

    // Check if RI (Partner) membership changed
    const newRIIds = new Set(teamMembers.filter(m => m.role === 'RI').map(m => m.userId));
    const partnerChanged = currentRIIds.size !== newRIIds.size ||
      [...currentRIIds].some(id => !newRIIds.has(id)) ||
      [...newRIIds].some(id => !currentRIIds.has(id));

    if (partnerChanged) {
      // Clear partner sign-offs from all appendix tabs
      // Sign-offs are stored in auditPermanentFile with sectionKey '__signoffs'
      const signOffSections = await prisma.auditPermanentFile.findMany({
        where: { engagementId, sectionKey: '__signoffs' },
      });
      for (const section of signOffSections) {
        const signOffs = (section.data || {}) as Record<string, unknown>;
        delete signOffs.partner;
        await prisma.auditPermanentFile.update({
          where: { id: section.id },
          data: { data: signOffs as object },
        });
      }

      // Also clear from ethics, continuance, materiality sign-offs (same pattern)
      for (const table of ['auditEthics', 'auditContinuance', 'auditMateriality'] as const) {
        try {
          const records = await (prisma as any)[table].findMany({
            where: { engagementId, sectionKey: '__signoffs' },
          });
          for (const rec of records) {
            const so = (rec.data || {}) as Record<string, unknown>;
            delete so.partner;
            await (prisma as any)[table].update({
              where: { id: rec.id },
              data: { data: so as object },
            });
          }
        } catch {
          // Table may not have sectionKey-based sign-offs yet, skip
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
