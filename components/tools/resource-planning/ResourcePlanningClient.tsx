'use client';

import { useEffect, useState } from 'react';
import { DndContext, pointerWithin, DragOverlay, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core';
import { useResourcePlanningStore } from '@/lib/stores/resource-planning-store';
import type { StaffMember, ResourceJobView, Allocation, StaffAbsence, ResourceRole } from '@/lib/resource-planning/types';
import { ROLE_COLORS } from '@/lib/resource-planning/types';
import { ResourceToolbar } from './ResourceToolbar';
import { StaffPanel } from './StaffPanel';
import { TimelinePanel } from './TimelinePanel';

interface Props {
  staff: StaffMember[];
  jobs: ResourceJobView[];
  allocations: Allocation[];
  isResourceAdmin: boolean;
  userId: string;
  unscheduledCount?: number;
  completedUnscheduledCount?: number;
}

// Dummy absences for demo
const DUMMY_ABSENCES: StaffAbsence[] = [
  { id: 'abs-1', userId: '', startDate: '2026-04-06', endDate: '2026-04-10', type: 'holiday', approved: true },
  { id: 'abs-2', userId: '', startDate: '2026-04-13', endDate: '2026-04-14', type: 'sick', approved: true },
  { id: 'abs-3', userId: '', startDate: '2026-05-04', endDate: '2026-05-04', type: 'bank_holiday', approved: true },
  { id: 'abs-4', userId: '', startDate: '2026-05-25', endDate: '2026-05-25', type: 'bank_holiday', approved: true },
];

export function ResourcePlanningClient({ staff, jobs, allocations, isResourceAdmin, userId, unscheduledCount = 0, completedUnscheduledCount = 0 }: Props) {
  const init = useResourcePlanningStore((s) => s.init);
  const isInitialized = useResourcePlanningStore((s) => s.isInitialized);
  const addAllocation = useResourcePlanningStore((s) => s.addAllocation);
  const updateAllocation = useResourcePlanningStore((s) => s.updateAllocation);
  const storeStaff = useResourcePlanningStore((s) => s.staff);
  const storeAllocations = useResourcePlanningStore((s) => s.allocations);
  const editMode = useResourcePlanningStore((s) => s.editMode);

  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [dragType, setDragType] = useState<'staff' | 'allocation' | null>(null);

  useEffect(() => {
    if (!isInitialized) {
      // Assign dummy absences to first few staff
      const absences = staff.length >= 3
        ? [
            { ...DUMMY_ABSENCES[0], userId: staff[4]?.id ?? staff[0].id },
            { ...DUMMY_ABSENCES[1], userId: staff[5]?.id ?? staff[1].id },
            { ...DUMMY_ABSENCES[2], userId: '' }, // bank holiday applies to all
            { ...DUMMY_ABSENCES[3], userId: '' },
          ]
        : [];
      init({
        staff,
        jobs,
        allocations,
        absences,
        unscheduledJobCount: unscheduledCount,
        completedJobCount: completedUnscheduledCount,
        currentUserId: userId,
        isResourceAdmin,
      });
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
    if (!overId.startsWith('cell|')) return;

    // Cell IDs use | delimiter: cell|{engId}|{role}|{date} or cell|staff|{userId}|{date}
    const parts = overId.split('|');
    const activeId = String(active.id);

    if (activeId.startsWith('staff-')) {
      // Staff drop → always create new allocation
      const staffId = activeId.replace('staff-', '');
      const member = storeStaff.find((s) => s.id === staffId);
      if (!member) return;

      let engagementId: string;
      let role: ResourceRole;
      let dateStr: string;

      if (parts[1] === 'staff') {
        return; // Can't assign to staff row directly
      } else {
        // parts[1] might be engagementId or jobId (fallback when no engagement)
        const targetId = parts[1];
        // Check if it's a job ID (not an engagement ID) — find the job to get/create engagement
        const job = jobs.find(j => j.id === targetId || j.engagementId === targetId);
        engagementId = job?.engagementId || targetId;
        role = parts[2] as ResourceRole;
        dateStr = parts[3];
      }

      const startDate = new Date(dateStr);
      const endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + 13);

      const newAlloc: Allocation = {
        id: `temp-${Date.now()}`,
        engagementId,
        userId: staffId,
        userName: member.name,
        role,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        hoursPerDay: 7.5,
        totalHours: null,
        notes: null,
      };

      addAllocation(newAlloc);

      try {
        const res = await fetch('/api/resource-planning/allocations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ engagementId, userId: staffId, role, startDate: startDate.toISOString(), endDate: endDate.toISOString(), hoursPerDay: 7.5 }),
        });
        if (res.ok) {
          const data = await res.json();
          updateAllocation(newAlloc.id, { id: data.allocation.id });
        }
      } catch {}
    } else if (activeId.startsWith('alloc-')) {
      const allocId = activeId.replace('alloc-', '');

      if (editMode === 'create') {
        // In create mode, alloc drag also creates a new allocation (copy)
        const existing = storeAllocations.find((a) => a.id === allocId);
        if (!existing) return;

        let engagementId: string;
        let role: ResourceRole;
        let dateStr: string;

        if (parts[1] === 'staff') return;
        engagementId = parts[1];
        role = parts[2] as ResourceRole;
        dateStr = parts[3];

        const startDate = new Date(dateStr);
        const oldDuration = new Date(existing.endDate).getTime() - new Date(existing.startDate).getTime();
        const endDate = new Date(startDate.getTime() + oldDuration);

        const newAlloc: Allocation = {
          id: `temp-${Date.now()}`,
          engagementId,
          userId: existing.userId,
          userName: existing.userName,
          role,
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
          hoursPerDay: existing.hoursPerDay,
          totalHours: null,
          notes: null,
        };

        addAllocation(newAlloc);
        try {
          const res = await fetch('/api/resource-planning/allocations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ engagementId, userId: existing.userId, role, startDate: startDate.toISOString(), endDate: endDate.toISOString(), hoursPerDay: existing.hoursPerDay }),
          });
          if (res.ok) {
            const data = await res.json();
            updateAllocation(newAlloc.id, { id: data.allocation.id });
          }
        } catch {}
      } else {
        // Edit mode - move existing allocation
        let engagementId: string;
        let role: ResourceRole;
        let dateStr: string;

        if (parts[1] === 'staff') return;
        engagementId = parts[1];
        role = parts[2] as ResourceRole;
        dateStr = parts[3];

        const startDate = new Date(dateStr);
        const existingAlloc = storeAllocations.find((a) => a.id === allocId);
        if (!existingAlloc) return;

        const durationMs = new Date(existingAlloc.endDate).getTime() - new Date(existingAlloc.startDate).getTime();
        const newEnd = new Date(startDate.getTime() + durationMs);

        updateAllocation(allocId, { engagementId, role, startDate: startDate.toISOString(), endDate: newEnd.toISOString() });

        try {
          await fetch(`/api/resource-planning/allocations/${allocId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ engagementId, role, startDate: startDate.toISOString(), endDate: newEnd.toISOString() }),
          });
        } catch {}
      }
    }
  }

  if (!isInitialized) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-slate-500 text-sm">Loading resource planning...</div>
      </div>
    );
  }

  const draggedStaff = dragType === 'staff' ? storeStaff.find((s) => s.id === activeDragId) : null;
  const draggedAlloc = dragType === 'allocation' ? storeAllocations.find((a) => a.id === activeDragId) : null;

  const content = (
    <div className="flex flex-col h-[calc(100vh-64px)]">
      <ResourceToolbar />
      <div className="flex flex-1 overflow-hidden">
        <StaffPanel isResourceAdmin={isResourceAdmin} />
        <TimelinePanel isResourceAdmin={isResourceAdmin} />
      </div>
    </div>
  );

  // Non-admin users get read-only view without drag & drop
  if (!isResourceAdmin) {
    return content;
  }

  return (
    <DndContext collisionDetection={pointerWithin} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      {content}
      <DragOverlay>
        {draggedStaff && (
          <div className="px-2 py-1 bg-blue-100 border border-blue-300 rounded-full shadow-lg text-[10px] font-medium text-blue-800">
            {draggedStaff.name}
          </div>
        )}
        {draggedAlloc && (() => {
          const colors = ROLE_COLORS[draggedAlloc.role];
          return (
            <div className={`px-2 py-1 ${colors.bg} border ${colors.border} rounded-full shadow-lg text-[10px] font-medium ${colors.text}`}>
              {draggedAlloc.userName} ({draggedAlloc.role})
            </div>
          );
        })()}
      </DragOverlay>
    </DndContext>
  );
}
