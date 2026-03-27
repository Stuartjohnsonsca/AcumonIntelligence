'use client';

import { memo, useMemo } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { useShallow } from 'zustand/react/shallow';
import { useResourcePlanningStore } from '@/lib/stores/resource-planning-store';
import type { ResourceJobView, Allocation, ResourceRole, StaffMember } from '@/lib/resource-planning/types';
import { ROLE_ORDER, ROLE_BAR_COLORS } from '@/lib/resource-planning/types';
import { getWeeksInRange, getDaysInRange, formatShortDate, isSameDay, allocationOverlaps } from '@/lib/resource-planning/date-utils';
import { AllocationBar } from './AllocationBar';

interface Props {
  jobs: ResourceJobView[];
  isResourceAdmin: boolean;
}

const ROLES: ResourceRole[] = ROLE_ORDER;

const AUDIT_TYPE_LABELS: Record<string, string> = {
  SME: 'SME Audit',
  PIE: 'PIE Audit',
  GROUP: 'Group Audit',
  SME_CONTROLS: 'SME Controls',
  PIE_CONTROLS: 'PIE Controls',
};

export function AllocationGrid({ jobs, isResourceAdmin }: Props) {
  const { allocations, staff, visibleStart, visibleEnd, focusedDays, lockedFocusDays, isLocked, viewMode, leftPanelFilter } =
    useResourcePlanningStore(useShallow((s) => ({
      allocations: s.allocations,
      staff: s.staff,
      visibleStart: s.visibleStart,
      visibleEnd: s.visibleEnd,
      focusedDays: s.focusedDays,
      lockedFocusDays: s.lockedFocusDays,
      isLocked: s.isLocked,
      viewMode: s.viewMode,
      leftPanelFilter: s.leftPanelFilter,
    })));

  const startDate = useMemo(() => new Date(visibleStart), [visibleStart]);
  const endDate = useMemo(() => new Date(visibleEnd), [visibleEnd]);
  const weeks = useMemo(() => getWeeksInRange(startDate, endDate), [startDate, endDate]);

  const activeDays = isLocked ? lockedFocusDays : focusedDays;
  const hoveredWeekIdx = useMemo(() => {
    if (activeDays.length === 0) return null;
    const focusDate = new Date(activeDays[0]);
    return weeks.findIndex((w) => {
      const weekEnd = new Date(w);
      weekEnd.setDate(weekEnd.getDate() + 6);
      return focusDate >= w && focusDate <= weekEnd;
    });
  }, [activeDays, weeks]);

  const isStaffAxis = viewMode.startsWith('staff');
  const isAvailability = viewMode.endsWith('availability');

  // Memoize filtered lists to avoid recalculating on every render
  const displayStaff = useMemo(() => {
    if (!isStaffAxis) return [];
    const filtered = leftPanelFilter.length > 0
      ? staff.filter((s) => leftPanelFilter.includes(s.id))
      : staff;
    if (!isAvailability) return filtered;
    return filtered.filter((s) => {
      const userAllocs = allocations.filter((a) => allocationOverlaps(a.startDate, a.endDate, startDate, endDate) && a.userId === s.id);
      return userAllocs.length === 0;
    });
  }, [isStaffAxis, staff, leftPanelFilter, isAvailability, allocations, startDate, endDate]);

  const displayJobs = useMemo(() => {
    if (isStaffAxis) return [];
    const filtered = leftPanelFilter.length > 0
      ? jobs.filter((j) => leftPanelFilter.includes(j.clientId))
      : jobs;
    if (!isAvailability) return filtered;
    return filtered.filter((j) => {
      const jobAllocs = allocations.filter(
        (a) => a.engagementId === j.engagementId && allocationOverlaps(a.startDate, a.endDate, startDate, endDate),
      );
      return jobAllocs.length === 0;
    });
  }, [isStaffAxis, jobs, leftPanelFilter, isAvailability, allocations, startDate, endDate]);

  if (isStaffAxis) {
    return (
      <div className="min-w-0">
        {displayStaff.map((member) => (
          <StaffRow
            key={member.id}
            member={member}
            allocations={allocations}
            weeks={weeks}
            hoveredWeekIdx={hoveredWeekIdx}
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

  return (
    <div className="min-w-0">
      {displayJobs.map((job) => (
        <JobRow
          key={job.id}
          job={job}
          allocations={allocations}
          weeks={weeks}
          hoveredWeekIdx={hoveredWeekIdx}
          startDate={startDate}
          endDate={endDate}
        />
      ))}
      {displayJobs.length === 0 && (
        <div className="flex items-center justify-center h-40 text-sm text-slate-400">
          {isAvailability ? 'All clients have bookings' : 'No jobs found'}
        </div>
      )}
    </div>
  );
}

const StaffRow = memo(function StaffRow({
  member,
  allocations,
  weeks,
  hoveredWeekIdx,
  startDate,
  endDate,
}: {
  member: StaffMember;
  allocations: Allocation[];
  weeks: Date[];
  hoveredWeekIdx: number | null;
  startDate: Date;
  endDate: Date;
}) {
  const staffAllocs = useMemo(
    () => allocations.filter((a) => a.userId === member.id && allocationOverlaps(a.startDate, a.endDate, startDate, endDate)),
    [allocations, member.id, startDate, endDate],
  );

  const totalDays = useMemo(() => Math.max(Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)), 1), [startDate, endDate]);

  return (
    <div className="border-b border-slate-100">
      <div className="flex">
        <div className="w-[280px] flex-shrink-0 border-r bg-white sticky left-0 z-10 px-2 py-1 select-none pointer-events-none">
          <div className="text-xs font-semibold text-slate-800 truncate">{member.name}</div>
          <div className="text-[10px] text-slate-400">{member.resourceSetting?.resourceRole ?? 'Unassigned'}</div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="relative h-[16px] border-b border-slate-50 flex">
            {weeks.map((week, idx) => {
              const isHovered = hoveredWeekIdx === idx;
              if (isHovered) {
                const days: Date[] = [];
                for (let d = 0; d < 5; d++) {
                  const day = new Date(week);
                  day.setDate(day.getDate() + d);
                  if (day.getDay() !== 0 && day.getDay() !== 6) days.push(day);
                }
                return (
                  <div key={week.toISOString()} className="flex flex-[3]">
                    {days.map((day) => (
                      <DropCell key={day.toISOString()} id={`cell|staff|${member.id}|${day.toISOString().split('T')[0]}`} isToday={isSameDay(day, new Date())} expanded />
                    ))}
                  </div>
                );
              }
              return <DropCell key={week.toISOString()} id={`cell|staff|${member.id}|${week.toISOString().split('T')[0]}`} isToday={false} expanded={false} />;
            })}
            {staffAllocs.map((alloc) => (
              <AllocationBar key={alloc.id} allocation={alloc} startDate={startDate} endDate={endDate} totalDays={totalDays} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
});

const JobRow = memo(function JobRow({
  job,
  allocations,
  weeks,
  hoveredWeekIdx,
  startDate,
  endDate,
}: {
  job: ResourceJobView;
  allocations: Allocation[];
  weeks: Date[];
  hoveredWeekIdx: number | null;
  startDate: Date;
  endDate: Date;
}) {
  const jobAllocations = useMemo(
    () => allocations.filter((a) => a.engagementId === job.engagementId && allocationOverlaps(a.startDate, a.endDate, startDate, endDate)),
    [allocations, job.engagementId, startDate, endDate],
  );

  return (
    <div className="border-b border-slate-100">
      <div className="flex">
        <div className="w-[280px] flex-shrink-0 border-r bg-white sticky left-0 z-10 px-2 py-1 select-none">
          <div className="text-xs font-semibold text-slate-800 truncate">{job.clientName}</div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[9px] px-1 py-0 bg-indigo-50 rounded text-indigo-600 font-medium">{job.serviceType ?? AUDIT_TYPE_LABELS[job.auditType] ?? job.auditType}</span>
            <span className="text-[9px] text-slate-400">PE: {formatShortDate(new Date(job.periodEnd))}</span>
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            {job.customDeadline && (
              <span className="text-[9px] text-blue-500" title="Preferred completion">Pref: {formatShortDate(new Date(job.customDeadline))}</span>
            )}
            {job.complianceDeadline && (
              <span className="text-[9px] text-red-500" title="Statutory completion">Stat: {formatShortDate(new Date(job.complianceDeadline))}</span>
            )}
            {!job.customDeadline && !job.complianceDeadline && (
              <span className="text-[9px] text-slate-400">TC: {formatShortDate(new Date(job.targetCompletion))}</span>
            )}
          </div>
          <div className="flex items-center gap-1 mt-0.5">
            <BudgetCircle role="Specialist" hours={job.budgetHoursSpecialist} />
            <BudgetCircle role="RI" hours={job.budgetHoursRI} />
            <BudgetCircle role="Reviewer" hours={job.budgetHoursReviewer} />
            <BudgetCircle role="Preparer" hours={job.budgetHoursPreparer} />
          </div>
        </div>
        <div className="flex-1 min-w-0">
          {ROLES.map((role) => {
            const roleAllocs = jobAllocations.filter((a) => a.role === role);
            return (
              <RoleLane
                key={role}
                role={role}
                allocations={roleAllocs}
                job={job}
                weeks={weeks}
                hoveredWeekIdx={hoveredWeekIdx}
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
  hoveredWeekIdx,
  startDate,
  endDate,
}: {
  role: ResourceRole;
  allocations: Allocation[];
  job: ResourceJobView;
  weeks: Date[];
  hoveredWeekIdx: number | null;
  startDate: Date;
  endDate: Date;
}) {
  const totalDays = useMemo(() => Math.max(Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)), 1), [startDate, endDate]);

  return (
    <div className="relative h-[24px] border-b border-slate-100 flex group" title={role}>
      {/* Role label on hover */}
      <div className="absolute left-0 top-0 bottom-0 flex items-center z-20 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity">
        <span className="text-[7px] font-bold px-1 bg-white/80 text-slate-500 rounded-r">{role.slice(0, 4)}</span>
      </div>
      {weeks.map((week, idx) => {
        const isHovered = hoveredWeekIdx === idx;
        if (isHovered) {
          const days: Date[] = [];
          for (let d = 0; d < 5; d++) {
            const day = new Date(week);
            day.setDate(day.getDate() + d);
            if (day.getDay() !== 0 && day.getDay() !== 6) days.push(day);
          }
          return (
            <div key={week.toISOString()} className="flex flex-[3]">
              {days.map((day) => (
                <DropCell
                  key={day.toISOString()}
                  id={`cell|${job.engagementId || job.id}|${role}|${day.toISOString().split('T')[0]}`}
                  isToday={isSameDay(day, new Date())}
                  expanded
                />
              ))}
            </div>
          );
        }
        return (
          <DropCell
            key={week.toISOString()}
            id={`cell|${job.engagementId || job.id}|${role}|${week.toISOString().split('T')[0]}`}
            isToday={false}
            expanded={false}
          />
        );
      })}
      {allocations.map((alloc) => (
        <AllocationBar key={alloc.id} allocation={alloc} startDate={startDate} endDate={endDate} totalDays={totalDays} />
      ))}
    </div>
  );
});

const DropCell = memo(function DropCell({ id, isToday, expanded }: { id: string; isToday: boolean; expanded: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={`flex-1 min-h-[24px] min-w-[8px] transition-colors
        ${expanded ? 'border-r border-slate-200' : 'border-r border-slate-100/60'}
        ${isToday ? 'bg-blue-50/40' : 'bg-slate-50/20'}
        ${isOver ? 'bg-blue-300/40 outline outline-1 outline-blue-400 z-10' : 'hover:bg-blue-50/30'}`}
    />
  );
});

function BudgetCircle({ role, hours }: { role: ResourceRole; hours: number }) {
  if (hours === 0) return null;
  const color = ROLE_BAR_COLORS[role] || 'bg-slate-400';
  return (
    <span
      className={`inline-flex items-center justify-center w-4 h-4 rounded-full ${color} text-white text-[7px] font-bold`}
      title={`${role}: ${hours}h`}
    >
      {hours}
    </span>
  );
}
