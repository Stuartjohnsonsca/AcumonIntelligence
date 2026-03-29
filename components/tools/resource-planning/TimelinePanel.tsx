'use client';

import { useMemo, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useResourcePlanningStore } from '@/lib/stores/resource-planning-store';
import { DateBar } from './DateBar';
import { AllocationGrid } from './AllocationGrid';

interface Props {
  isResourceAdmin: boolean;
}

export function TimelinePanel({ isResourceAdmin }: Props) {
  const { jobs, allocations, lockedFocusDays, isLocked, clientSearchQuery } =
    useResourcePlanningStore(useShallow((s) => ({
      jobs: s.jobs,
      allocations: s.allocations,
      lockedFocusDays: s.lockedFocusDays,
      isLocked: s.isLocked,
      clientSearchQuery: s.clientSearchQuery,
    })));
  const getSortedJobs = useResourcePlanningStore((s) => s.getSortedJobs);

  const scrollRef = useRef<HTMLDivElement>(null);

  // Sort only responds to lock changes (not hover), then apply client search
  const sortedJobs = useMemo(() => {
    const sorted = getSortedJobs();
    if (!clientSearchQuery.trim()) return sorted;
    const q = clientSearchQuery.toLowerCase();
    return sorted.filter((j) => j.clientName.toLowerCase().includes(q));
  }, [jobs, allocations, lockedFocusDays, isLocked, clientSearchQuery]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <DateBar />
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto overflow-x-hidden resource-scroll"
      >
        <AllocationGrid jobs={sortedJobs} isResourceAdmin={isResourceAdmin} />
      </div>
    </div>
  );
}
