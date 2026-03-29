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
  const { jobs, allocations, lockedFocusDays, isLocked, zoomLevel, clientSearchQuery } =
    useResourcePlanningStore(useShallow((s) => ({
      jobs: s.jobs,
      allocations: s.allocations,
      lockedFocusDays: s.lockedFocusDays,
      isLocked: s.isLocked,
      zoomLevel: s.zoomLevel,
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

  // Zoom scales the entire timeline (DateBar + grid) together so dates stay aligned
  const zoomStyle = zoomLevel !== 1
    ? { transform: `scaleX(${zoomLevel})`, transformOrigin: 'left top', width: `${100 / zoomLevel}%` }
    : undefined;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Zoom wrapper around both DateBar and grid so they scale together */}
      <div style={zoomStyle}>
        <DateBar />
      </div>
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto overflow-x-hidden resource-scroll"
      >
        <div style={zoomStyle}>
          <AllocationGrid jobs={sortedJobs} isResourceAdmin={isResourceAdmin} />
        </div>
      </div>
    </div>
  );
}
