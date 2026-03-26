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
  const getSortedJobs = useResourcePlanningStore((s) => s.getSortedJobs);

  const sortedJobs = useMemo(() => getSortedJobs(), [jobs, allocations, focusedDays, getSortedJobs]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <DateBar />
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        <AllocationGrid jobs={sortedJobs} isResourceAdmin={isResourceAdmin} />
      </div>
    </div>
  );
}
