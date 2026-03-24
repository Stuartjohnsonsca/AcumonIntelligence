import { NextResponse } from 'next/server';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

/**
 * Clear sign-offs for a given role across ALL engagement data.
 * When Partner changes → clear 'partner' sign-offs everywhere.
 * When Reviewer changes → clear 'reviewer' sign-offs everywhere.
 */
async function clearRoleSignOffs(engagementId: string, role: 'partner' | 'reviewer') {
  // 1. AuditPermanentFile — uses sectionKey '__signoffs'
  const pfSignOffs = await prisma.auditPermanentFile.findMany({
    where: { engagementId, sectionKey: '__signoffs' },
  });
  for (const section of pfSignOffs) {
    const data = (section.data || {}) as Record<string, unknown>;
    delete data[role];
    await prisma.auditPermanentFile.update({
      where: { id: section.id },
      data: { data: data as object },
    });
  }

  // 2. Single-record JSON tables (Ethics, Continuance, NewClientTakeOn, Materiality)
  // Sign-offs may be stored inside the JSON data field as data.__signoffs
  const jsonTables = [
    { model: 'auditEthics', unique: true },
    { model: 'auditContinuance', unique: true },
    { model: 'auditNewClientTakeOn', unique: true },
    { model: 'auditMateriality', unique: true },
  ];

  for (const { model } of jsonTables) {
    try {
      const record = await (prisma as any)[model].findUnique({
        where: { engagementId },
      });
      if (record?.data) {
        const data = record.data as Record<string, unknown>;
        // Sign-offs stored at data.__signoffs
        if (data.__signoffs && typeof data.__signoffs === 'object') {
          delete (data.__signoffs as Record<string, unknown>)[role];
          await (prisma as any)[model].update({
            where: { id: record.id },
            data: { data: data as object },
          });
        }
      }
    } catch {
      // Table record may not exist yet, skip
    }
  }

  // 3. Row-based tables (PAR, RMM, TB) — sign-offs may be in row-level JSON
  // These use per-row data, but sign-offs are typically at the tab level
  // stored in a special row or in the engagement metadata
  const rowTables = ['auditPARRow', 'auditRMMRow', 'auditTBRow'];
  for (const model of rowTables) {
    try {
      const rows = await (prisma as any)[model].findMany({
        where: { engagementId },
      });
      for (const row of rows) {
        if (row.data && typeof row.data === 'object') {
          const data = row.data as Record<string, unknown>;
          if (data.__signoffs && typeof data.__signoffs === 'object') {
            delete (data.__signoffs as Record<string, unknown>)[role];
            await (prisma as any)[model].update({
              where: { id: row.id },
              data: { data: data as object },
            });
          }
        }
      }
    } catch {
      // Skip if table doesn't exist or has different structure
    }
  }

  // 4. Documents table sign-offs
  try {
    const docs = await prisma.auditDocument.findMany({ where: { engagementId } });
    for (const doc of docs) {
      // Documents don't typically have sign-offs, but future-proof
    }
  } catch { /* skip */ }
}

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
      await clearRoleSignOffs(engagementId, 'partner');
    }

    // Also check if Manager (Reviewer) membership changed
    const currentManagers = await prisma.auditTeamMember.findMany({
      where: { engagementId, role: 'Manager' },
      select: { userId: true },
    });
    // Compare with what was submitted (after update)
    const newManagerIds = new Set(teamMembers.filter(m => m.role === 'Manager').map(m => m.userId));
    const oldManagerIds = new Set(currentManagers.map(m => m.userId));
    const reviewerChanged = oldManagerIds.size !== newManagerIds.size ||
      [...oldManagerIds].some(id => !newManagerIds.has(id)) ||
      [...newManagerIds].some(id => !oldManagerIds.has(id));

    if (reviewerChanged) {
      await clearRoleSignOffs(engagementId, 'reviewer');
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
