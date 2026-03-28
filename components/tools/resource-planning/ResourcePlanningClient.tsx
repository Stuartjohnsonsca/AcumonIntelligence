'use client';

import { useEffect, useState, useCallback } from 'react';
import { DndContext, pointerWithin, DragOverlay, PointerSensor, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core';
import { useResourcePlanningStore } from '@/lib/stores/resource-planning-store';
import type { StaffMember, ResourceJobView, Allocation, StaffAbsence, ResourceRole, ResourceJobProfile } from '@/lib/resource-planning/types';
import { ROLE_COLORS } from '@/lib/resource-planning/types';
import { ResourceToolbar } from './ResourceToolbar';
import { StaffPanel } from './StaffPanel';
import { TimelinePanel } from './TimelinePanel';

interface Props {
  staff: StaffMember[];
  jobs: ResourceJobView[];
  allocations: Allocation[];
  jobProfiles?: ResourceJobProfile[];
  isResourceAdmin: boolean;
  userId: string;
  unscheduledCount?: number;
  completedUnscheduledCount?: number;
}

type LockStatus = 'checking' | 'granted' | 'denied';

// Dummy absences for demo
const DUMMY_ABSENCES: StaffAbsence[] = [
  { id: 'abs-1', userId: '', startDate: '2026-04-06', endDate: '2026-04-10', type: 'holiday', approved: true },
  { id: 'abs-2', userId: '', startDate: '2026-04-13', endDate: '2026-04-14', type: 'sick', approved: true },
  { id: 'abs-3', userId: '', startDate: '2026-05-04', endDate: '2026-05-04', type: 'bank_holiday', approved: true },
  { id: 'abs-4', userId: '', startDate: '2026-05-25', endDate: '2026-05-25', type: 'bank_holiday', approved: true },
];

export function ResourcePlanningClient({ staff, jobs, allocations, jobProfiles = [], isResourceAdmin, userId, unscheduledCount = 0, completedUnscheduledCount = 0 }: Props) {
  const init = useResourcePlanningStore((s) => s.init);
  const isInitialized = useResourcePlanningStore((s) => s.isInitialized);
  const addAllocation = useResourcePlanningStore((s) => s.addAllocation);
  const updateAllocation = useResourcePlanningStore((s) => s.updateAllocation);
  const storeStaff = useResourcePlanningStore((s) => s.staff);
  const storeAllocations = useResourcePlanningStore((s) => s.allocations);
  const editMode = useResourcePlanningStore((s) => s.editMode);
  const setActiveDragUserId = useResourcePlanningStore((s) => s.setActiveDragUserId);

  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [dragType, setDragType] = useState<'staff' | 'allocation' | null>(null);

  // Lock state
  const [lockStatus, setLockStatus] = useState<LockStatus>(isResourceAdmin ? 'checking' : 'denied');
  const [lockHolderName, setLockHolderName] = useState<string | null>(null);

  // Require 8px movement before drag starts — prevents accidental drags on click
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  useEffect(() => {
    if (!isInitialized) {
      try {
        const absences = staff.length >= 3
          ? [
              { ...DUMMY_ABSENCES[0], userId: staff[4]?.id ?? staff[0]?.id ?? '' },
              { ...DUMMY_ABSENCES[1], userId: staff[5]?.id ?? staff[1]?.id ?? '' },
              { ...DUMMY_ABSENCES[2], userId: '' },
              { ...DUMMY_ABSENCES[3], userId: '' },
            ]
          : [];
        init({
          staff,
          jobs,
          allocations,
          absences,
          jobProfiles,
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

  // Acquire lock on mount (admins only)
  useEffect(() => {
    if (!isResourceAdmin) return;
    fetch('/api/resource-planning/lock', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
      .then((r) => r.json())
      .then((data) => {
        if (data.acquired) {
          setLockStatus('granted');
        } else {
          setLockStatus('denied');
          setLockHolderName(data.lockedBy ?? 'Another admin');
        }
      })
      .catch(() => setLockStatus('denied'));
  }, [isResourceAdmin]);

  // Heartbeat every 5 minutes to keep lock alive
  useEffect(() => {
    if (lockStatus !== 'granted') return;
    const id = setInterval(() => {
      fetch('/api/resource-planning/lock', { method: 'PATCH' }).catch(() => {});
    }, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [lockStatus]);

  // Release lock on unmount or page close
  useEffect(() => {
    if (lockStatus !== 'granted') return;
    const release = () => {
      fetch('/api/resource-planning/lock', { method: 'DELETE', keepalive: true }).catch(() => {});
    };
    window.addEventListener('beforeunload', release);
    return () => {
      window.removeEventListener('beforeunload', release);
      release();
    };
  }, [lockStatus]);

  const handleTakeControl = useCallback(async () => {
    const res = await fetch('/api/resource-planning/lock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force: true }),
    });
    const data = await res.json();
    if (data.acquired) {
      setLockStatus('granted');
      setLockHolderName(null);
    }
  }, []);

  const handleReleaseLock = useCallback(async () => {
    await fetch('/api/resource-planning/lock', { method: 'DELETE' });
    setLockStatus('denied');
    setLockHolderName(null);
  }, []);

  function handleDragStart(event: DragStartEvent) {
    const id = String(event.active.id);
    if (id.startsWith('staff-')) {
      const staffId = id.replace('staff-', '');
      setActiveDragId(staffId);
      setDragType('staff');
      setActiveDragUserId(staffId);
    } else if (id.startsWith('alloc-')) {
      const allocId = id.replace('alloc-', '');
      setActiveDragId(allocId);
      setDragType('allocation');
      const alloc = storeAllocations.find((a) => a.id === allocId);
      setActiveDragUserId(alloc?.userId ?? null);
    }
  }

  function dropDateFromEvent(event: DragEndEvent): Date {
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
      const dow = d.getDay();
      if (dow !== 1) d.setDate(d.getDate() + (dow === 0 ? 1 : 1 - dow));
      return d;
    }
    return new Date();
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveDragId(null);
    setDragType(null);
    setActiveDragUserId(null);

    if (!over) return;

    const overId = String(over.id);
    const activeId = String(active.id);

    const isLane = overId.startsWith('lane|');
    const isCell = overId.startsWith('cell|');
    if (!isLane && !isCell) return;

    const parts = overId.split('|');
    const targetId = parts[1];
    const role = parts[2] as ResourceRole;

    if (targetId === 'staff') return;

    const job = jobs.find(j => j.id === targetId || j.engagementId === targetId);
    const engagementId = job?.engagementId || targetId;

    // Reject drops on locked jobs
    if (job?.isScheduleLocked) return;

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
        } else {
          const err = await res.json().catch(() => ({}));
          console.error('[POST alloc] error:', res.status, err);
        }
      } catch (e) { console.error('[POST alloc] fetch error:', e); }

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

  const canEdit = isResourceAdmin && lockStatus === 'granted';

  const lockBanner = isResourceAdmin && (
    <div className={`flex items-center gap-2 px-3 py-1 text-[11px] border-b ${
      lockStatus === 'granted' ? 'bg-green-50 border-green-200 text-green-800' :
      lockStatus === 'checking' ? 'bg-slate-50 border-slate-200 text-slate-500' :
      'bg-amber-50 border-amber-200 text-amber-800'
    }`}>
      <span className={`w-1.5 h-1.5 rounded-full ${
        lockStatus === 'granted' ? 'bg-green-500' :
        lockStatus === 'checking' ? 'bg-slate-400 animate-pulse' :
        'bg-amber-500'
      }`} />
      {lockStatus === 'granted' && (
        <>
          <span>You have edit control</span>
          <button onClick={handleReleaseLock} className="ml-auto text-[10px] px-2 py-0.5 rounded bg-green-100 hover:bg-green-200 text-green-700 transition-colors">
            Release
          </button>
        </>
      )}
      {lockStatus === 'checking' && <span>Checking edit access…</span>}
      {lockStatus === 'denied' && (
        <>
          <span>{lockHolderName ? `Read-only — ${lockHolderName} is editing` : 'Read-only view'}</span>
          {lockHolderName && (
            <button onClick={handleTakeControl} className="ml-auto text-[10px] px-2 py-0.5 rounded bg-amber-100 hover:bg-amber-200 text-amber-700 transition-colors">
              Take Control
            </button>
          )}
        </>
      )}
    </div>
  );

  const draggedStaff = dragType === 'staff' ? storeStaff.find((s) => s.id === activeDragId) : null;
  const draggedAlloc = dragType === 'allocation' ? storeAllocations.find((a) => a.id === activeDragId) : null;

  const content = (
    <div className="flex flex-col h-[calc(100vh-64px)]">
      <ResourceToolbar />
      {lockBanner}
      <div className="flex flex-1 overflow-hidden">
        <StaffPanel isResourceAdmin={isResourceAdmin} />
        <TimelinePanel isResourceAdmin={isResourceAdmin} />
      </div>
    </div>
  );

  if (!canEdit) {
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
