'use client';

import { useMemo } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { useResourcePlanningStore } from '@/lib/stores/resource-planning-store';
import type { ResourceJobView, Allocation, ResourceRole, StaffMember } from '@/lib/resource-planning/types';
import { ROLE_BAR_COLORS } from '@/lib/resource-planning/types';
import { getWeeksInRange, getDaysInRange, formatShortDate, isSameDay, allocationOverlaps } from '@/lib/resource-planning/date-utils';
import { AllocationBar } from './AllocationBar';

interface Props {
  jobs: ResourceJobView[];
  isResourceAdmin: boolean;
}

const ROLES: ResourceRole[] = ['RI', 'Reviewer', 'Preparer'];

export function AllocationGrid({ jobs, isResourceAdmin }: Props) {
  const allocations = useResourcePlanningStore((s) => s.allocations);
  const staff = useResourcePlanningStore((s) => s.staff);
  const visibleStart = useResourcePlanningStore((s) => s.visibleStart);
  const visibleEnd = useResourcePlanningStore((s) => s.visibleEnd);
  const focusedDays = useResourcePlanningStore((s) => s.focusedDays);
  const lockedFocusDays = useResourcePlanningStore((s) => s.lockedFocusDays);
  const isLocked = useResourcePlanningStore((s) => s.isLocked);
  const viewMode = useResourcePlanningStore((s) => s.viewMode);
  const leftPanelFilter = useResourcePlanningStore((s) => s.leftPanelFilter);

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

  if (isStaffAxis) {
    // Staff as rows
    const filteredStaff = leftPanelFilter.length > 0
      ? staff.filter((s) => leftPanelFilter.includes(s.id))
      : staff;

    const displayStaff = isAvailability
      ? filteredStaff.filter((s) => {
          const userAllocs = allocations.filter((a) => allocationOverlaps(a.startDate, a.endDate, startDate, endDate) && a.userId === s.id);
          return userAllocs.length === 0; // Available = no allocations in range
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

  // Client as rows (default)
  const filteredJobs = leftPanelFilter.length > 0
    ? jobs.filter((j) => leftPanelFilter.includes(j.clientId))
    : jobs;

  const displayJobs = isAvailability
    ? filteredJobs.filter((j) => {
        const jobAllocs = allocations.filter(
          (a) => a.engagementId === j.engagementId && allocationOverlaps(a.startDate, a.endDate, startDate, endDate),
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

function StaffRow({
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

  const totalDays = useMemo(() => Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)), [startDate, endDate]);

  return (
    <div className="border-b border-slate-100">
      <div className="flex">
        <div className="w-[280px] flex-shrink-0 border-r bg-white sticky left-0 z-10 px-2 py-1">
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
                      <DropCell key={day.toISOString()} id={`cell-staff-${member.id}-${day.toISOString().split('T')[0]}`} isToday={isSameDay(day, new Date())} expanded />
                    ))}
                  </div>
                );
              }
              return <DropCell key={week.toISOString()} id={`cell-staff-${member.id}-${week.toISOString().split('T')[0]}`} isToday={false} expanded={false} />;
            })}
            {staffAllocs.map((alloc) => (
              <AllocationBar key={alloc.id} allocation={alloc} startDate={startDate} endDate={endDate} totalDays={totalDays} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function JobRow({
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
        <div className="w-[280px] flex-shrink-0 border-r bg-white sticky left-0 z-10 px-2 py-1">
          <div className="text-xs font-semibold text-slate-800 truncate">{job.clientName}</div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[9px] px-1 py-0 bg-slate-100 rounded text-slate-600">{job.auditType}</span>
            <span className="text-[9px] text-slate-400">PE: {formatShortDate(new Date(job.periodEnd))}</span>
            <span className="text-[9px] text-slate-400">TC: {formatShortDate(new Date(job.targetCompletion))}</span>
          </div>
          <div className="flex gap-1.5 mt-0.5">
            <BudgetBadge label="RI" hours={job.budgetHoursRI} />
            <BudgetBadge label="Rev" hours={job.budgetHoursReviewer} />
            <BudgetBadge label="Prep" hours={job.budgetHoursPreparer} />
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
}

function RoleLane({
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
  const totalDays = useMemo(() => Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)), [startDate, endDate]);

  return (
    <div className="relative h-[16px] border-b border-slate-50 flex group" title={role}>
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
                  id={`cell-${job.engagementId}-${role}-${day.toISOString().split('T')[0]}`}
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
            id={`cell-${job.engagementId}-${role}-${week.toISOString().split('T')[0]}`}
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
}

function DropCell({ id, isToday, expanded }: { id: string; isToday: boolean; expanded: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={`flex-1 border-r border-slate-50
        ${isToday ? 'bg-blue-50/30' : ''}
        ${isOver ? 'bg-blue-100/50' : ''}
        ${expanded ? 'border-slate-200' : ''}`}
    />
  );
}

function BudgetBadge({ label, hours }: { label: string; hours: number }) {
  if (hours === 0) return null;
  return (
    <span className="text-[8px] text-slate-400">
      <span className="font-medium">{label}</span>:{hours}h
    </span>
  );
}
