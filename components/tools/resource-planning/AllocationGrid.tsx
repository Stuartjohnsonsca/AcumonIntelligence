'use client';

import { useMemo } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { useResourcePlanningStore } from '@/lib/stores/resource-planning-store';
import type { ResourceJobView, Allocation, ResourceRole } from '@/lib/resource-planning/types';
import { ROLE_BAR_COLORS, ROLE_COLORS } from '@/lib/resource-planning/types';
import { getWeeksInRange, formatShortDate, isSameDay, allocationOverlaps } from '@/lib/resource-planning/date-utils';
import { AllocationBar } from './AllocationBar';

interface Props {
  jobs: ResourceJobView[];
  isResourceAdmin: boolean;
}

const ROLES: ResourceRole[] = ['RI', 'Reviewer', 'Preparer'];

export function AllocationGrid({ jobs, isResourceAdmin }: Props) {
  const allocations = useResourcePlanningStore((s) => s.allocations);
  const visibleStart = useResourcePlanningStore((s) => s.visibleStart);
  const visibleEnd = useResourcePlanningStore((s) => s.visibleEnd);
  const focusedDays = useResourcePlanningStore((s) => s.focusedDays);

  const startDate = useMemo(() => new Date(visibleStart), [visibleStart]);
  const endDate = useMemo(() => new Date(visibleEnd), [visibleEnd]);
  const weeks = useMemo(() => getWeeksInRange(startDate, endDate), [startDate, endDate]);

  const hoveredWeekIdx = useMemo(() => {
    if (focusedDays.length === 0) return null;
    const focusDate = new Date(focusedDays[0]);
    return weeks.findIndex((w) => {
      const weekEnd = new Date(w);
      weekEnd.setDate(weekEnd.getDate() + 6);
      return focusDate >= w && focusDate <= weekEnd;
    });
  }, [focusedDays, weeks]);

  return (
    <div className="min-w-0">
      {jobs.map((job) => (
        <JobRow
          key={job.id}
          job={job}
          allocations={allocations}
          weeks={weeks}
          hoveredWeekIdx={hoveredWeekIdx}
          startDate={startDate}
          endDate={endDate}
          isResourceAdmin={isResourceAdmin}
        />
      ))}
      {jobs.length === 0 && (
        <div className="flex items-center justify-center h-40 text-sm text-slate-400">
          No jobs found
        </div>
      )}
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
  isResourceAdmin,
}: {
  job: ResourceJobView;
  allocations: Allocation[];
  weeks: Date[];
  hoveredWeekIdx: number | null;
  startDate: Date;
  endDate: Date;
  isResourceAdmin: boolean;
}) {
  const jobAllocations = useMemo(
    () =>
      allocations.filter(
        (a) =>
          a.engagementId === job.engagementId &&
          allocationOverlaps(a.startDate, a.endDate, startDate, endDate),
      ),
    [allocations, job.engagementId, startDate, endDate],
  );

  return (
    <div className="border-b border-slate-100">
      <div className="flex">
        {/* Job info columns (fixed left) */}
        <div className="w-[280px] flex-shrink-0 border-r bg-white sticky left-0 z-10 px-2 py-1.5">
          <div className="text-xs font-semibold text-slate-800 truncate">{job.clientName}</div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[10px] px-1.5 py-0 bg-slate-100 rounded text-slate-600">
              {job.auditType}
            </span>
            <span className="text-[10px] text-slate-400">
              PE: {formatShortDate(new Date(job.periodEnd))}
            </span>
            <span className="text-[10px] text-slate-400">
              TC: {formatShortDate(new Date(job.targetCompletion))}
            </span>
          </div>
          <div className="flex gap-2 mt-0.5">
            <BudgetBadge label="RI" hours={job.budgetHoursRI} />
            <BudgetBadge label="Rev" hours={job.budgetHoursReviewer} />
            <BudgetBadge label="Prep" hours={job.budgetHoursPreparer} />
          </div>
        </div>

        {/* Grid area */}
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
  const totalDays = useMemo(() => {
    return Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
  }, [startDate, endDate]);

  const colors = ROLE_COLORS[role];

  return (
    <div className="relative h-6 border-b border-slate-50 flex">
      {/* Role label */}
      <div className={`absolute left-0 top-0 z-[5] text-[8px] font-medium px-1 ${colors.text} opacity-50`}>
        {role}
      </div>

      {/* Drop zone cells - one per week */}
      {weeks.map((week, idx) => {
        const isHovered = hoveredWeekIdx === idx;
        if (isHovered) {
          // Expanded day cells
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

      {/* Allocation bars overlaid */}
      {allocations.map((alloc) => (
        <AllocationBar
          key={alloc.id}
          allocation={alloc}
          startDate={startDate}
          endDate={endDate}
          totalDays={totalDays}
        />
      ))}
    </div>
  );
}

function DropCell({ id, isToday, expanded }: { id: string; isToday: boolean; expanded: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div
      ref={setNodeRef}
      className={`
        flex-1 border-r border-slate-50
        ${isToday ? 'bg-blue-50/30' : ''}
        ${isOver ? 'bg-blue-100/50' : ''}
        ${expanded ? 'border-slate-200' : ''}
      `}
    />
  );
}

function BudgetBadge({ label, hours }: { label: string; hours: number }) {
  if (hours === 0) return null;
  return (
    <span className="text-[9px] text-slate-400">
      <span className="font-medium">{label}</span>:{hours}h
    </span>
  );
}
