'use client';

import { useResourcePlanningStore } from '@/lib/stores/resource-planning-store';
import { DateBar } from './DateBar';
import { AllocationGrid } from './AllocationGrid';

interface Props {
  isResourceAdmin: boolean;
}

export function TimelinePanel({ isResourceAdmin }: Props) {
  const jobs = useResourcePlanningStore((s) => s.getSortedJobs());

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <DateBar />
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        <AllocationGrid jobs={jobs} isResourceAdmin={isResourceAdmin} />
      </div>
    </div>
  );
}
