'use client';

import { useMemo } from 'react';
import { useResourcePlanningStore } from '@/lib/stores/resource-planning-store';
import { DateBar } from './DateBar';
import { AllocationGrid } from './AllocationGrid';

interface Props {
  isResourceAdmin: boolean;
}

export function TimelinePanel({ isResourceAdmin }: Props) {
  const jobs = useResourcePlanningStore((s) => s.jobs);
  const allocations = useResourcePlanningStore((s) => s.allocations);
  const focusedDays = useResourcePlanningStore((s) => s.focusedDays);
  const lockedFocusDays = useResourcePlanningStore((s) => s.lockedFocusDays);
  const isLocked = useResourcePlanningStore((s) => s.isLocked);
  const getSortedJobs = useResourcePlanningStore((s) => s.getSortedJobs);
  const zoomLevel = useResourcePlanningStore((s) => s.zoomLevel);

  const sortedJobs = useMemo(() => getSortedJobs(), [jobs, allocations, focusedDays, lockedFocusDays, isLocked, getSortedJobs]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <DateBar />
      <div
        className="flex-1 overflow-y-auto overflow-x-hidden"
        style={{
          transform: zoomLevel !== 1 ? `scale(${zoomLevel})` : undefined,
          transformOrigin: 'top left',
          width: zoomLevel !== 1 ? `${100 / zoomLevel}%` : undefined,
        }}
      >
        <AllocationGrid jobs={sortedJobs} isResourceAdmin={isResourceAdmin} />
      </div>
    </div>
  );
}
