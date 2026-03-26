'use client';

import { useMemo, useRef } from 'react';
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

  const scrollRef = useRef<HTMLDivElement>(null);
  const sortedJobs = useMemo(() => getSortedJobs(), [jobs, allocations, focusedDays, lockedFocusDays, isLocked, getSortedJobs]);

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
