import { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

/**
 * GET /api/resource-planning/diagnostics
 *
 * Temporary diagnostic endpoint — shows exactly why RI/Reviewer/Specialist
 * may not be getting scheduled.  Open in browser or Network tab.
 */
export async function GET(_req: NextRequest) {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const firmId = session.user.firmId;

  const [staffRaw, jobsRaw, profilesRaw, clientSettingsRaw] = await Promise.all([
    prisma.user.findMany({
      where: { firmId, isActive: true, resourceStaffSetting: { isNot: null } },
      include: { resourceStaffSetting: true },
    }),
    prisma.resourceJob.findMany({
      where: { firmId },
      include: { client: { select: { clientName: true } } },
      take: 5, // sample only
    }),
    prisma.resourceJobProfile.findMany({ where: { firmId } }),
    prisma.resourceClientSetting.findMany({ where: { firmId }, select: { clientId: true, serviceType: true } }),
  ]);

  // Build same lookup maps as optimize route
  const profileById  = new Map(profilesRaw.map((p) => [p.id, p]));
  const profileByName = new Map(profilesRaw.map((p) => [p.name.toLowerCase(), p]));
  const serviceTypeByClient = new Map(clientSettingsRaw.map((cs) => [cs.clientId, cs.serviceType]));

  // Staff eligibility summary
  const staffSummary = staffRaw.map((u) => {
    const rs = u.resourceStaffSetting!;
    return {
      name: u.name,
      resourceRole: rs.resourceRole,
      isRI: rs.isRI,
      concurrentJobLimit: rs.concurrentJobLimit,
      preparerJobLimit: rs.preparerJobLimit,
      reviewerJobLimit: rs.reviewerJobLimit,
      riJobLimit: rs.riJobLimit,
      specialistJobLimit: rs.specialistJobLimit,
      // Derived eligibility (mirrors scheduler isEligible logic)
      eligibleFor: {
        RI:        (rs.isRI || rs.resourceRole === 'RI') && (rs.riJobLimit ?? 1) > 0,
        Reviewer:  rs.reviewerJobLimit != null ? rs.reviewerJobLimit > 0 : (rs.resourceRole === 'Reviewer' || rs.resourceRole === 'RI') && rs.concurrentJobLimit > 0,
        Preparer:  rs.preparerJobLimit != null ? rs.preparerJobLimit > 0 : (rs.resourceRole === 'Preparer' || rs.resourceRole === 'Reviewer') && rs.concurrentJobLimit > 0,
        Specialist: rs.specialistJobLimit != null ? rs.specialistJobLimit > 0 : rs.resourceRole === 'Specialist' && rs.concurrentJobLimit > 0,
      },
    };
  });

  // Sample job budget resolution
  const sampleJobs = jobsRaw.map((j) => {
    let profile = j.jobProfileId ? (profileById.get(j.jobProfileId) ?? null) : null;
    if (!profile) {
      const st = serviceTypeByClient.get(j.clientId);
      profile = st ? (profileByName.get(st.toLowerCase()) ?? null) : null;
    }
    const serviceType = serviceTypeByClient.get(j.clientId) ?? null;
    return {
      client: j.client.clientName,
      auditType: j.auditType,
      serviceType,
      jobProfileId: j.jobProfileId,
      profileResolved: profile ? profile.name : null,
      rawBudget: {
        RI:        j.budgetHoursRI,
        Reviewer:  j.budgetHoursReviewer,
        Specialist: j.budgetHoursSpecialist,
        Preparer:  j.budgetHoursPreparer,
      },
      resolvedBudget: {
        RI:        j.budgetHoursRI > 0 ? j.budgetHoursRI : (profile?.budgetHoursRI ?? 0),
        Reviewer:  j.budgetHoursReviewer > 0 ? j.budgetHoursReviewer : (profile?.budgetHoursReviewer ?? 0),
        Specialist: j.budgetHoursSpecialist > 0 ? j.budgetHoursSpecialist : (profile?.budgetHoursSpecialist ?? 0),
        Preparer:  j.budgetHoursPreparer > 0 ? j.budgetHoursPreparer : (profile?.budgetHoursPreparer ?? 0),
      },
    };
  });

  // Profile summary
  const profiles = profilesRaw.map((p) => ({
    name: p.name,
    RI:        p.budgetHoursRI,
    Reviewer:  p.budgetHoursReviewer,
    Specialist: p.budgetHoursSpecialist,
    Preparer:  p.budgetHoursPreparer,
  }));

  // Client service type coverage
  const clientsWithServiceType = clientSettingsRaw.filter((cs) => cs.serviceType).length;

  return Response.json({
    summary: {
      totalStaff: staffRaw.length,
      eligibleRI:        staffSummary.filter((s) => s.eligibleFor.RI).length,
      eligibleReviewer:  staffSummary.filter((s) => s.eligibleFor.Reviewer).length,
      eligiblePreparer:  staffSummary.filter((s) => s.eligibleFor.Preparer).length,
      eligibleSpecialist: staffSummary.filter((s) => s.eligibleFor.Specialist).length,
      profiles:          profilesRaw.length,
      clientsWithServiceType,
      totalClients:      clientSettingsRaw.length,
    },
    staff: staffSummary,
    profiles,
    sampleJobs,
    hint: 'If resolvedBudget.RI = 0 for all sample jobs, the profile is not being matched. Check that serviceType matches a profile name exactly (case-insensitive).',
  });
}
