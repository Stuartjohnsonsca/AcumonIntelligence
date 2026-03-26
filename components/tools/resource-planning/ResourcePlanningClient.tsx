'use client';

import { useEffect } from 'react';
import { DndContext, closestCenter, DragOverlay, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core';
import { useState } from 'react';
import { useResourcePlanningStore } from '@/lib/stores/resource-planning-store';
import type { StaffMember, ResourceJobView, Allocation } from '@/lib/resource-planning/types';
import { ResourceToolbar } from './ResourceToolbar';
import { StaffPanel } from './StaffPanel';
import { TimelinePanel } from './TimelinePanel';

interface Props {
  staff: StaffMember[];
  jobs: ResourceJobView[];
  allocations: Allocation[];
  isResourceAdmin: boolean;
  userId: string;
}

export function ResourcePlanningClient({ staff, jobs, allocations, isResourceAdmin, userId }: Props) {
  const init = useResourcePlanningStore((s) => s.init);
  const isInitialized = useResourcePlanningStore((s) => s.isInitialized);
  const addAllocation = useResourcePlanningStore((s) => s.addAllocation);
  const updateAllocation = useResourcePlanningStore((s) => s.updateAllocation);
  const storeJobs = useResourcePlanningStore((s) => s.jobs);
  const storeStaff = useResourcePlanningStore((s) => s.staff);
  const storeAllocations = useResourcePlanningStore((s) => s.allocations);

  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [dragType, setDragType] = useState<'staff' | 'allocation' | null>(null);

  useEffect(() => {
    if (!isInitialized) {
      init({ staff, jobs, allocations });
    }
  }, [init, isInitialized, staff, jobs, allocations]);

  function handleDragStart(event: DragStartEvent) {
    const id = String(event.active.id);
    if (id.startsWith('staff-')) {
      setActiveDragId(id.replace('staff-', ''));
      setDragType('staff');
    } else if (id.startsWith('alloc-')) {
      setActiveDragId(id.replace('alloc-', ''));
      setDragType('allocation');
    }
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveDragId(null);
    setDragType(null);

    if (!over) return;

    const overId = String(over.id);
    // Drop target format: "cell-{engagementId}-{role}-{dateISO}"
    if (!overId.startsWith('cell-')) return;

    const parts = overId.split('-');
    // cell-{engId}-{role}-{date}
    const engagementId = parts[1];
    const role = parts[2] as 'Preparer' | 'Reviewer' | 'RI';
    const dateStr = parts.slice(3).join('-');

    const activeId = String(active.id);

    if (activeId.startsWith('staff-')) {
      // Create new allocation
      const staffId = activeId.replace('staff-', '');
      const member = storeStaff.find((s) => s.id === staffId);
      if (!member) return;

      const startDate = new Date(dateStr);
      const endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + 13); // 2-week default

      const newAlloc: Allocation = {
        id: `temp-${Date.now()}`,
        engagementId,
        userId: staffId,
        userName: member.name,
        role,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        hoursPerDay: 7.5,
        notes: null,
      };

      // Optimistic add
      addAllocation(newAlloc);

      // API call
      try {
        const res = await fetch('/api/resource-planning/allocations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            engagementId,
            userId: staffId,
            role,
            startDate: startDate.toISOString(),
            endDate: endDate.toISOString(),
            hoursPerDay: 7.5,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          // Replace temp with real
          updateAllocation(newAlloc.id, { id: data.allocation.id });
        }
      } catch {
        // Revert on failure handled by re-fetch
      }
    } else if (activeId.startsWith('alloc-')) {
      // Move existing allocation
      const allocId = activeId.replace('alloc-', '');
      const startDate = new Date(dateStr);
      const existingAlloc = storeAllocations.find((a) => a.id === allocId);
      if (!existingAlloc) return;

      // Calculate duration to preserve
      const oldStart = new Date(existingAlloc.startDate);
      const oldEnd = new Date(existingAlloc.endDate);
      const durationMs = oldEnd.getTime() - oldStart.getTime();
      const newEnd = new Date(startDate.getTime() + durationMs);

      // Optimistic update
      updateAllocation(allocId, {
        engagementId,
        role,
        startDate: startDate.toISOString(),
        endDate: newEnd.toISOString(),
      });

      // API call
      try {
        await fetch(`/api/resource-planning/allocations/${allocId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            engagementId,
            role,
            startDate: startDate.toISOString(),
            endDate: newEnd.toISOString(),
          }),
        });
      } catch {
        // Revert on failure
      }
    }
  }

  if (!isInitialized) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-slate-500">Loading resource planning...</div>
      </div>
    );
  }

  const draggedStaff = dragType === 'staff' ? storeStaff.find((s) => s.id === activeDragId) : null;
  const draggedAlloc = dragType === 'allocation' ? storeAllocations.find((a) => a.id === activeDragId) : null;

  return (
    <DndContext collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="flex flex-col h-[calc(100vh-64px)]">
        <ResourceToolbar />
        <div className="flex flex-1 overflow-hidden">
          <StaffPanel isResourceAdmin={isResourceAdmin} />
          <TimelinePanel isResourceAdmin={isResourceAdmin} />
        </div>
      </div>
      <DragOverlay>
        {draggedStaff && (
          <div className="px-3 py-2 bg-blue-100 border border-blue-300 rounded-md shadow-lg text-sm font-medium text-blue-800">
            {draggedStaff.name}
          </div>
        )}
        {draggedAlloc && (
          <div className="px-3 py-1 bg-purple-100 border border-purple-300 rounded-md shadow-lg text-xs font-medium text-purple-800">
            {draggedAlloc.userName} ({draggedAlloc.role})
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
