'use client';

import { useMemo, memo, useState, useCallback } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { Lock, Unlock } from 'lucide-react';
import { useResourcePlanningStore } from '@/lib/stores/resource-planning-store';
import type { ResourceJobView, Allocation, ResourceRole, StaffMember } from '@/lib/resource-planning/types';
import { ROLE_ORDER, ROLE_BAR_COLORS, getStaffRoles } from '@/lib/resource-planning/types';
import { getWeeksInRange, formatShortDate, allocationOverlaps } from '@/lib/resource-planning/date-utils';
import { AllocationBar } from './AllocationBar';

interface Props {
  jobs: ResourceJobView[];
  isResourceAdmin: boolean;
}

const ROLES: ResourceRole[] = ROLE_ORDER;

export const AllocationGrid = memo(function AllocationGrid({ jobs, isResourceAdmin }: Props) {
  const allocations = useResourcePlanningStore((s) => s.allocations);
  const staff = useResourcePlanningStore((s) => s.staff);
  const visibleStart = useResourcePlanningStore((s) => s.visibleStart);
  const visibleEnd = useResourcePlanningStore((s) => s.visibleEnd);
  const viewMode = useResourcePlanningStore((s) => s.viewMode);
  const leftPanelFilter = useResourcePlanningStore((s) => s.leftPanelFilter);
  const currentUserId = useResourcePlanningStore((s) => s.currentUserId);

  const startDate = useMemo(() => new Date(visibleStart), [visibleStart]);
  const endDate = useMemo(() => new Date(visibleEnd), [visibleEnd]);
  const weeks = useMemo(() => getWeeksInRange(startDate, endDate), [startDate, endDate]);

  const isStaffAxis = viewMode.startsWith('staff');
  const isAvailability = viewMode.endsWith('availability');

  if (isStaffAxis) {
    const filteredStaff = leftPanelFilter.length > 0
      ? staff.filter((s) => leftPanelFilter.includes(s.id))
      : staff;

    const displayStaff = isAvailability
      ? filteredStaff.filter((s) => {
          const userAllocs = allocations.filter((a) => allocationOverlaps(a.startDate, a.endDate, startDate, endDate) && a.userId === s.id);
          return userAllocs.length === 0;
        })
      : filteredStaff;

    return (
      <div className="min-w-0">
        {displayStaff.map((member) => (
          <StaffRow
            key={member.id}
            member={member}
            allocations={allocations}
            weeks={weeks}
            startDate={startDate}
            endDate={endDate}
          />
        ))}
        {displayStaff.length === 0 && (
          <div className="flex items-center justify-center h-40 text-sm text-slate-400">
            {isAvailability ? 'All staff are allocated' : 'No staff found'}
          </div>
        )}
      </div>
    );
  }

  // Non-admins only see jobs they're allocated to
  const myEngagementIds = useMemo(() => {
    if (isResourceAdmin || !currentUserId) return null;
    return new Set(allocations.filter((a) => a.userId === currentUserId).map((a) => a.engagementId));
  }, [isResourceAdmin, currentUserId, allocations]);

  const filteredJobs = useMemo(() => {
    let result = leftPanelFilter.length > 0
      ? jobs.filter((j) => leftPanelFilter.includes(j.clientId))
      : jobs;
    if (myEngagementIds) {
      result = result.filter((j) => myEngagementIds.has(j.engagementId || j.id));
    }
    return result;
  }, [jobs, leftPanelFilter, myEngagementIds]);

  const displayJobs = isAvailability
    ? filteredJobs.filter((j) => {
        const jobAllocs = allocations.filter(
          (a) => a.engagementId === (j.engagementId || j.id) && allocationOverlaps(a.startDate, a.endDate, startDate, endDate),
        );
        return jobAllocs.length === 0;
      })
    : filteredJobs;

  return (
    <div className="min-w-0">
      {displayJobs.map((job) => (
        <JobRow
          key={job.id}
          job={job}
          allocations={allocations}
          weeks={weeks}
          startDate={startDate}
          endDate={endDate}
          isResourceAdmin={isResourceAdmin}
        />
      ))}
      {displayJobs.length === 0 && (
        <div className="flex items-center justify-center h-40 text-sm text-slate-400">
          {isAvailability ? 'All clients have bookings' : 'No jobs found'}
        </div>
      )}
    </div>
  );
});

const StaffRow = memo(function StaffRow({
  member,
  allocations,
  weeks,
  startDate,
  endDate,
}: {
  member: StaffMember;
  allocations: Allocation[];
  weeks: Date[];
  startDate: Date;
  endDate: Date;
}) {
  const staffAllocs = useMemo(
    () => allocations.filter((a) => a.userId === member.id && allocationOverlaps(a.startDate, a.endDate, startDate, endDate)),
    [allocations, member.id, startDate, endDate],
  );
  const totalDays = useMemo(() => Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)), [startDate, endDate]);

  return (
    <div className="border-b border-slate-100">
      <div className="flex">
        <div className="w-[280px] flex-shrink-0 border-r bg-white sticky left-0 z-10 px-2 py-1 select-none pointer-events-none cursor-default">
          <div className="text-xs font-semibold text-slate-800 truncate">{member.name}</div>
          <div className="text-[10px] text-slate-400">{member.resourceSetting?.resourceRole ?? 'Unassigned'}</div>
        </div>
        <div className="flex-1 min-w-0 relative h-[24px] border-b border-slate-50">
          {weeks.map((week) => (
            <div key={week.toISOString()} className="absolute top-0 bottom-0 border-r border-slate-100/60"
              style={{ left: `${((week.getTime() - startDate.getTime()) / (endDate.getTime() - startDate.getTime())) * 100}%`, width: `${(7 / totalDays) * 100}%` }}
            />
          ))}
          {staffAllocs.map((alloc) => (
            <AllocationBar key={alloc.id} allocation={alloc} startDate={startDate} endDate={endDate} totalDays={totalDays} />
          ))}
        </div>
      </div>
    </div>
  );
});

const JobRow = memo(function JobRow({
  job,
  allocations,
  weeks,
  startDate,
  endDate,
  isResourceAdmin,
}: {
  job: ResourceJobView;
  allocations: Allocation[];
  weeks: Date[];
  startDate: Date;
  endDate: Date;
  isResourceAdmin: boolean;
}) {
  const updateJob = useResourcePlanningStore((s) => s.updateJob);
  const [toggling, setToggling] = useState(false);

  const jobKey = job.engagementId || job.id;
  const jobAllocations = useMemo(
    () => allocations.filter((a) => a.engagementId === jobKey && allocationOverlaps(a.startDate, a.endDate, startDate, endDate)),
    [allocations, jobKey, startDate, endDate],
  );

  const handleToggleLock = useCallback(async () => {
    if (toggling) return;
    const newLocked = !job.isScheduleLocked;
    setToggling(true);
    // Optimistic update
    updateJob(job.id, { isScheduleLocked: newLocked });
    try {
      const res = await fetch(`/api/resource-planning/jobs/${job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isScheduleLocked: newLocked }),
      });
      if (!res.ok) {
        // Revert on failure
        updateJob(job.id, { isScheduleLocked: job.isScheduleLocked });
      }
    } catch {
      updateJob(job.id, { isScheduleLocked: job.isScheduleLocked });
    } finally {
      setToggling(false);
    }
  }, [job.id, job.isScheduleLocked, toggling, updateJob]);

  return (
    <div className="border-b border-slate-100">
      <div className="flex">
        <div className="w-[280px] flex-shrink-0 border-r bg-white sticky left-0 z-10 px-2 py-1 select-none cursor-default">
          <div className="flex items-center gap-1">
            <div className="text-xs font-semibold text-slate-800 truncate flex-1">{job.clientName}</div>
            {isResourceAdmin && (
              <button
                onClick={handleToggleLock}
                disabled={toggling}
                title={job.isScheduleLocked ? 'Unlock schedule' : 'Lock schedule'}
                className={`flex-shrink-0 p-0.5 rounded transition-colors disabled:opacity-40 ${
                  job.isScheduleLocked
                    ? 'text-amber-600 hover:text-amber-700 hover:bg-amber-50'
                    : 'text-slate-300 hover:text-slate-500 hover:bg-slate-100'
                }`}
              >
                {job.isScheduleLocked
                  ? <Lock className="h-3 w-3" />
                  : <Unlock className="h-3 w-3" />
                }
              </button>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[9px] px-1 py-0 bg-slate-100 rounded text-slate-600">{job.auditType}</span>
            <span className="text-[9px] text-slate-400">PE: {formatShortDate(new Date(job.periodEnd))}</span>
            <span className="text-[9px] text-slate-400">TC: {formatShortDate(new Date(job.targetCompletion))}</span>
          </div>
          <div className="flex gap-1.5 mt-0.5">
            <BudgetBadge label="Spec" hours={job.budgetHoursSpecialist} />
            <BudgetBadge label="RI" hours={job.budgetHoursRI} />
            <BudgetBadge label="Rev" hours={job.budgetHoursReviewer} />
            <BudgetBadge label="Prep" hours={job.budgetHoursPreparer} />
          </div>
        </div>
        <div className={`flex-1 min-w-0 ${job.isScheduleLocked ? 'bg-slate-50/60' : ''}`}>
          {ROLES.map((role) => {
            const roleAllocs = jobAllocations.filter((a) => a.role === role);
            return (
              <RoleLane
                key={role}
                role={role}
                allocations={roleAllocs}
                job={job}
                weeks={weeks}
                startDate={startDate}
                endDate={endDate}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
});

const RoleLane = memo(function RoleLane({
  role,
  allocations,
  job,
  weeks,
  startDate,
  endDate,
}: {
  role: ResourceRole;
  allocations: Allocation[];
  job: ResourceJobView;
  weeks: Date[];
  startDate: Date;
  endDate: Date;
}) {
  const totalDays = useMemo(() => Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)), [startDate, endDate]);

  const activeDragUserId = useResourcePlanningStore((s) => s.activeDragUserId);
  const staff = useResourcePlanningStore((s) => s.staff);

  const isDisabled = useMemo(() => {
    // Job schedule lock takes priority — no drops at all
    if (job.isScheduleLocked) return true;
    if (!activeDragUserId) return false;
    const member = staff.find((s) => s.id === activeDragUserId);
    if (!member) return false;
    // Check if staff member is eligible for this role
    const eligibleRoles = getStaffRoles(member.resourceSetting).map((r) => r.role);
    if (!eligibleRoles.includes(role)) return true;
    // RI is limited to 1 per job
    if (role === 'RI' && allocations.length > 0) return true;
    return false;
  }, [job.isScheduleLocked, activeDragUserId, staff, role, allocations]);

  const { setNodeRef, isOver } = useDroppable({ id: `lane|${job.engagementId || job.id}|${role}`, disabled: isDisabled });

  return (
    <div
      ref={setNodeRef}
      className={`relative h-[24px] border-b border-slate-100 group
        ${isOver ? 'bg-blue-100/60' : ''}
        ${isDisabled && activeDragUserId ? 'bg-red-50/40' : ''}`}
      title={role}
    >
      <div className="absolute left-0 top-0 bottom-0 flex items-center z-20 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity">
        <span className="text-[7px] font-bold px-1 bg-white/80 text-slate-500 rounded-r">{role.slice(0, 4)}</span>
      </div>
      {/* Week grid lines */}
      {weeks.map((week) => (
        <div key={week.toISOString()} className="absolute top-0 bottom-0 border-r border-slate-100/60"
          style={{ left: `${((week.getTime() - startDate.getTime()) / (endDate.getTime() - startDate.getTime())) * 100}%` }}
        />
      ))}
      {allocations.map((alloc) => (
        <AllocationBar
          key={alloc.id}
          allocation={alloc}
          startDate={startDate}
          endDate={endDate}
          totalDays={totalDays}
          isJobLocked={job.isScheduleLocked}
        />
      ))}
    </div>
  );
});

function BudgetBadge({ label, hours }: { label: string; hours: number }) {
  if (hours === 0) return null;
  return (
    <span className="text-[8px] text-slate-400">
      <span className="font-medium">{label}</span>:{hours}h
    </span>
  );
}
