'use client';

import { useEffect, useState } from 'react';
import { DndContext, pointerWithin, DragOverlay, PointerSensor, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core';
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

  // Require 8px movement before drag starts — prevents accidental drags on click
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  useEffect(() => {
    if (!isInitialized) {
      try {
        // Assign dummy absences to first few staff
        const absences = staff.length >= 3
          ? [
              { ...DUMMY_ABSENCES[0], userId: staff[4]?.id ?? staff[0]?.id ?? '' },
              { ...DUMMY_ABSENCES[1], userId: staff[5]?.id ?? staff[1]?.id ?? '' },
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
      } catch (e) {
        console.error('Resource planning init failed:', e);
      }
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

  function dropDateFromEvent(event: DragEndEvent): Date {
    // Calculate drop date from pointer position within the lane rect
    const { over, activatorEvent, delta } = event;
    const { visibleStart, visibleEnd } = useResourcePlanningStore.getState();
    const startMs = new Date(visibleStart).getTime();
    const endMs = new Date(visibleEnd).getTime();

    if (over?.rect && activatorEvent) {
      const laneRect = over.rect;
      const pointerX = (activatorEvent as PointerEvent).clientX + (delta?.x ?? 0);
      const relX = Math.max(0, Math.min(laneRect.width, pointerX - laneRect.left));
      const pct = relX / laneRect.width;
      const dropMs = startMs + pct * (endMs - startMs);
      const d = new Date(dropMs);
      // Snap to Monday
      const dow = d.getDay();
      if (dow !== 1) d.setDate(d.getDate() + (dow === 0 ? 1 : 1 - dow));
      return d;
    }
    // Fallback: today
    return new Date();
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveDragId(null);
    setDragType(null);

    console.log('[DragEnd] over:', over?.id ?? 'NULL', 'active:', String(active.id));
    if (!over) return;

    const overId = String(over.id);
    const activeId = String(active.id);

    // Support both new lane|... format and legacy cell|... format
    const isLane = overId.startsWith('lane|');
    const isCell = overId.startsWith('cell|');
    if (!isLane && !isCell) return;

    const parts = overId.split('|');
    const targetId = parts[1];
    const role = parts[2] as ResourceRole;

    if (targetId === 'staff') return;

    const job = jobs.find(j => j.id === targetId || j.engagementId === targetId);
    const engagementId = job?.engagementId || targetId;
    console.log('[DragEnd] targetId:', targetId, 'role:', role, 'engagementId:', engagementId, 'jobFound:', !!job);

    const startDate = isLane ? dropDateFromEvent(event) : new Date(parts[3]);

    if (activeId.startsWith('staff-')) {
      const staffId = activeId.replace('staff-', '');
      const member = storeStaff.find((s) => s.id === staffId);
      if (!member) return;

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

      console.log('[DragEnd] addAllocation:', newAlloc);
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
      const existing = storeAllocations.find((a) => a.id === allocId);
      if (!existing) return;

      if (editMode === 'create') {
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
        const durationMs = new Date(existing.endDate).getTime() - new Date(existing.startDate).getTime();
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
    <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      {content}
      <DragOverlay>
        {draggedStaff && (
          <div className="px-3 py-1.5 bg-blue-600 text-white rounded-lg shadow-xl text-xs font-semibold flex items-center gap-1.5 cursor-grabbing">
            <span className="w-2 h-2 bg-white rounded-full animate-pulse" />
            {draggedStaff.name}
            <span className="text-blue-200 text-[9px]">— drop on timeline</span>
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
