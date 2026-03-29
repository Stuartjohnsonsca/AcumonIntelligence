import { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import type { OptimizationViolation } from '@/lib/resource-planning/types';

/**
 * GET /api/resource-planning/validate
 *
 * Validates the current committed schedule against the same constraint set
 * the optimizer uses.  Returns an array of OptimizationViolation objects.
 *
 * Checks performed:
 *   1. No RI allocated on a job that has any allocations
 *   2. More than one RI on the same job
 *   3. RI also acting as Preparer on the same job
 *   4. RI also acting as Reviewer on the same job
 *   5. Reviewer also acting as Preparer on the same job
 *   6. Allocated hours vs profile-resolved budget hours (per role)
 *   7. Latest allocation end date past the job deadline
 *   8. Staff weekly hours exceeding capacity + overtime
 */
export async function GET(_request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.twoFactorVerified) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const firmId = session.user.firmId;

    const [jobsRaw, allocsRaw, staffRaw, profilesRaw, clientSettingsRaw, engagements] = await Promise.all([
      prisma.resourceJob.findMany({
        where: { firmId },
        include: { client: { select: { clientName: true } } },
      }),
      prisma.resourceAllocation.findMany({
        where: { firmId },
        include: { user: { select: { name: true } } },
      }),
      prisma.user.findMany({
        where: { firmId, isActive: true, resourceStaffSetting: { isNot: null } },
        include: { resourceStaffSetting: true },
      }),
      prisma.resourceJobProfile.findMany({ where: { firmId } }),
      prisma.resourceClientSetting
        .findMany({ where: { firmId }, select: { clientId: true, serviceType: true } })
        .catch(() => [] as { clientId: string; serviceType: string | null }[]),
      prisma.auditEngagement.findMany({
        where: { firmId },
        select: { id: true, clientId: true, auditType: true },
      }),
    ]);

    // ── Build lookup maps ────────────────────────────────────────────────────

    // "clientId:auditType" → AuditEngagement.id
    const engagementMap = new Map<string, string>();
    for (const e of engagements) {
      engagementMap.set(`${e.clientId}:${e.auditType}`, e.id);
    }

    // engagementId (either AuditEngagement.id or ResourceJob.id) → ResourceJob
    const engagementToJob = new Map<string, typeof jobsRaw[0]>();
    for (const j of jobsRaw) {
      const auditEngId = engagementMap.get(`${j.clientId}:${j.auditType}`);
      if (auditEngId) engagementToJob.set(auditEngId, j);
      engagementToJob.set(j.id, j); // always index by resource-job id as fallback
    }

    const profileById = new Map(profilesRaw.map((p) => [p.id, p]));
    const profileByName = new Map(profilesRaw.map((p) => [p.name.toLowerCase(), p]));
    const serviceTypeByClient = new Map(
      (clientSettingsRaw as { clientId: string; serviceType: string | null }[])
        .filter((cs) => cs.serviceType)
        .map((cs) => [cs.clientId, cs.serviceType as string]),
    );

    function resolveJobBudget(j: typeof jobsRaw[0]) {
      let profile = j.jobProfileId ? (profileById.get(j.jobProfileId) ?? null) : null;
      if (!profile) {
        const st = serviceTypeByClient.get(j.clientId);
        profile = st ? (profileByName.get(st.toLowerCase()) ?? null) : null;
      }
      return {
        Specialist: j.budgetHoursSpecialist > 0 ? j.budgetHoursSpecialist : (profile?.budgetHoursSpecialist ?? 0),
        RI:         j.budgetHoursRI         > 0 ? j.budgetHoursRI         : (profile?.budgetHoursRI         ?? 0),
        Reviewer:   j.budgetHoursReviewer   > 0 ? j.budgetHoursReviewer   : (profile?.budgetHoursReviewer   ?? 0),
        Preparer:   j.budgetHoursPreparer   > 0 ? j.budgetHoursPreparer   : (profile?.budgetHoursPreparer   ?? 0),
      };
    }

    const staffMap = new Map(staffRaw.map((s) => [s.id, s]));
    const violations: OptimizationViolation[] = [];
    let seq = 1;

    function addV(constraintId: string, jobId: string | undefined, userId: string | undefined, description: string) {
      violations.push({ constraintId, priority: seq++, jobId, userId, description });
    }

    // ── Group allocations by engagement ─────────────────────────────────────

    type AllocRow = typeof allocsRaw[0];
    const byEngId = new Map<string, AllocRow[]>();
    for (const a of allocsRaw) {
      const key = a.engagementId ?? '';
      if (!byEngId.has(key)) byEngId.set(key, []);
      byEngId.get(key)!.push(a);
    }

    // ── Per-job checks ───────────────────────────────────────────────────────

    for (const [engId, allocs] of byEngId) {
      if (!engId) continue;

      const job = engagementToJob.get(engId);
      const jobId = job?.id ?? engId;
      const label = job ? `${(job as any).client?.clientName ?? job.clientId} (${job.auditType})` : engId;

      // Group by role
      const byRole = new Map<string, AllocRow[]>();
      for (const a of allocs) {
        if (!byRole.has(a.role)) byRole.set(a.role, []);
        byRole.get(a.role)!.push(a);
      }

      const riAllocs = byRole.get('RI') ?? [];

      // 1 & 2 — RI count
      if (riAllocs.length === 0) {
        addV('no-ri', jobId, undefined, `${label}: no RI allocated`);
      } else if (riAllocs.length > 1) {
        addV('multi-ri', jobId, undefined, `${label}: ${riAllocs.length} RI allocations (must be exactly 1)`);
      }

      const riUserIds = new Set(riAllocs.map((a) => a.userId));

      // 3 — RI also Preparer
      for (const a of (byRole.get('Preparer') ?? [])) {
        if (riUserIds.has(a.userId)) {
          addV('ri-no-preparer', jobId, a.userId,
            `${label}: ${staffMap.get(a.userId)?.name ?? a.userId} is both RI and Preparer`);
        }
      }

      // 4 — RI also Reviewer
      for (const a of (byRole.get('Reviewer') ?? [])) {
        if (riUserIds.has(a.userId)) {
          addV('ri-no-reviewer', jobId, a.userId,
            `${label}: ${staffMap.get(a.userId)?.name ?? a.userId} is both RI and Reviewer`);
        }
      }

      // 5 — Reviewer also Preparer
      const reviewerIds = new Set((byRole.get('Reviewer') ?? []).map((a) => a.userId));
      for (const a of (byRole.get('Preparer') ?? [])) {
        if (reviewerIds.has(a.userId)) {
          addV('reviewer-no-preparer', jobId, a.userId,
            `${label}: ${staffMap.get(a.userId)?.name ?? a.userId} is both Reviewer and Preparer`);
        }
      }

      // team-continuity — detect team changes from previous year
      if (job?.previousJobId) {
        // Find what staff were on the PREVIOUS job (by previousJobId)
        const prevJob = jobsRaw.find((j) => j.id === job!.previousJobId);
        if (prevJob) {
          const prevEngId = engagementMap.get(`${prevJob.clientId}:${prevJob.auditType}`) ?? prevJob.id;
          const prevAllocs = byEngId.get(prevEngId) ?? [];
          const prevByRole = new Map<string, string[]>();
          for (const pa of prevAllocs) {
            const arr = prevByRole.get(pa.role) ?? [];
            if (!arr.includes(pa.userId)) arr.push(pa.userId);
            prevByRole.set(pa.role, arr);
          }

          // Compare with current year allocs
          for (const [role, roleAllocs] of byRole) {
            const prevUsers = prevByRole.get(role) ?? [];
            if (prevUsers.length === 0) continue;

            for (const a of roleAllocs) {
              if (prevUsers.includes(a.userId)) continue;

              // Only flag if the previous person is still active and eligible
              const prevStillEligible = prevUsers.some((prevId) => {
                const ps = staffMap.get(prevId);
                return ps?.isActive === true;
              });
              if (!prevStillEligible) continue;

              const currentName = staffMap.get(a.userId)?.name ?? a.userId;
              const prevNames = prevUsers.map((uid) => staffMap.get(uid)?.name ?? uid).join(', ');
              addV(
                'team-continuity',
                jobId,
                a.userId,
                `${label} — ${role}: ${currentName} replaces ${prevNames} from last year`,
              );
              break; // one violation per role
            }
          }
        }
      }

      if (job) {
        const budget = resolveJobBudget(job);

        // 6 — Budget vs allocated hours (per role)
        for (const [role, roleAllocs] of byRole) {
          const allocTotal = roleAllocs.reduce((sum, a) => sum + (a.totalHours ?? 0), 0);
          const budgetHrs = (budget as Record<string, number>)[role] ?? 0;
          if (budgetHrs > 0 && Math.abs(allocTotal - budgetHrs) > 1) {
            const over = allocTotal > budgetHrs;
            addV(
              over ? 'over-budget' : 'under-budget',
              jobId,
              undefined,
              `${label} — ${role}: ${allocTotal.toFixed(1)}h allocated vs ${budgetHrs}h budget` +
              ` (${over ? 'over' : 'short'} by ${Math.abs(allocTotal - budgetHrs).toFixed(1)}h)`,
            );
          }
        }

        // 7 — Schedule ends after deadline
        const deadlineStr = (job as any).customDeadline ?? job.targetCompletion;
        if (deadlineStr) {
          const deadline = new Date(deadlineStr);
          const latestEnd = allocs.reduce((latest, a) => {
            const d = new Date(a.endDate);
            return d > latest ? d : latest;
          }, new Date(0));
          if (latestEnd > deadline) {
            addV(
              'custom-completion-date',
              jobId,
              undefined,
              `${label}: schedule ends ${latestEnd.toLocaleDateString('en-GB')} ` +
              `but deadline is ${deadline.toLocaleDateString('en-GB')}`,
            );
          }
        }
      }
    }

    // ── Staff overallocation check (per week) ────────────────────────────────

    // Accumulate daily hours per staff per day, then sum per week
    const staffDailyHours = new Map<string, Map<string, number>>(); // userId → dateKey → hours

    for (const a of allocsRaw) {
      if (!staffDailyHours.has(a.userId)) staffDailyHours.set(a.userId, new Map());
      const dayMap = staffDailyHours.get(a.userId)!;
      const cursor = new Date(a.startDate);
      const end = new Date(a.endDate);
      while (cursor <= end) {
        const dow = cursor.getDay();
        if (dow !== 0 && dow !== 6) { // skip weekends
          const key = cursor.toISOString().split('T')[0];
          dayMap.set(key, (dayMap.get(key) ?? 0) + a.hoursPerDay);
        }
        cursor.setDate(cursor.getDate() + 1);
      }
    }

    for (const [userId, dayMap] of staffDailyHours) {
      const s = staffMap.get(userId);
      if (!s?.resourceStaffSetting) continue;
      const weeklyCapacity = (s.resourceStaffSetting.weeklyCapacityHrs ?? 37.5) +
                             (s.resourceStaffSetting.overtimeHrs ?? 0);
      const dailyCap = weeklyCapacity / 5; // simple daily proxy

      // Group days into weeks
      const weekTotals = new Map<string, number>();
      for (const [dateKey, hrs] of dayMap) {
        const d = new Date(dateKey);
        const dow = d.getDay();
        const mon = new Date(d);
        mon.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));
        const weekKey = mon.toISOString().split('T')[0];
        weekTotals.set(weekKey, (weekTotals.get(weekKey) ?? 0) + hrs);
      }

      for (const [weekKey, totalHrs] of weekTotals) {
        if (totalHrs > weeklyCapacity + 0.1) {
          addV(
            'no-overtime',
            undefined,
            userId,
            `${s.name}: w/c ${weekKey} — ${totalHrs.toFixed(1)}h allocated vs ${weeklyCapacity}h weekly capacity`,
          );
        }
      }
    }

    return Response.json({ violations, checkedAt: new Date().toISOString() });
  } catch (err: any) {
    console.error('[validate] Error:', err);
    return Response.json({ error: err?.message ?? 'Validation failed' }, { status: 500 });
  }
}
