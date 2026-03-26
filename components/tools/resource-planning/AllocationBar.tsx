'use client';

import { useMemo, useRef } from 'react';
import { useDraggable } from '@dnd-kit/core';
import type { Allocation, ResourceRole } from '@/lib/resource-planning/types';
import { ROLE_BAR_COLORS } from '@/lib/resource-planning/types';
import { useResourcePlanningStore } from '@/lib/stores/resource-planning-store';

interface Props {
  allocation: Allocation;
  startDate: Date;
  endDate: Date;
  totalDays: number;
}

export function AllocationBar({ allocation, startDate, endDate, totalDays }: Props) {
  const selectedAllocationId = useResourcePlanningStore((s) => s.selectedAllocationId);
  const setSelectedAllocation = useResourcePlanningStore((s) => s.setSelectedAllocation);
  const pointerStartPos = useRef<{ x: number; y: number } | null>(null);

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `alloc-${allocation.id}`,
  });

  const style = useMemo(() => {
    const allocStart = new Date(allocation.startDate);
    const allocEnd = new Date(allocation.endDate);
    const visibleStart = Math.max(allocStart.getTime(), startDate.getTime());
    const visibleEnd = Math.min(allocEnd.getTime(), endDate.getTime());
    if (visibleStart > visibleEnd) return null;

    const startOffset = (visibleStart - startDate.getTime()) / (1000 * 60 * 60 * 24);
    const duration = (visibleEnd - visibleStart) / (1000 * 60 * 60 * 24);
    return {
      left: `${(startOffset / totalDays) * 100}%`,
      width: `${Math.max((duration / totalDays) * 100, 1)}%`,
    };
  }, [allocation.startDate, allocation.endDate, startDate, endDate, totalDays]);

  if (!style) return null;

  const barColor = ROLE_BAR_COLORS[allocation.role as ResourceRole] || 'bg-slate-400';
  const isSelected = selectedAllocationId === allocation.id;
  const initials = allocation.userName
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  // Use onMouseUp to detect clicks (not drags). dnd-kit uses onPointerDown for drag.
  // If the pointer hasn't moved much between down and up, treat it as a click (select).
  function handlePointerDown(e: React.PointerEvent) {
    pointerStartPos.current = { x: e.clientX, y: e.clientY };
  }

  function handlePointerUp(e: React.PointerEvent) {
    if (!pointerStartPos.current) return;
    const dx = Math.abs(e.clientX - pointerStartPos.current.x);
    const dy = Math.abs(e.clientY - pointerStartPos.current.y);
    // If pointer moved less than 5px, treat as click (select)
    if (dx < 5 && dy < 5) {
      setSelectedAllocation(isSelected ? null : allocation.id);
    }
    pointerStartPos.current = null;
  }

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onPointerDown={(e) => {
        handlePointerDown(e);
        // Let dnd-kit's listeners handle the event too (don't stop propagation)
        listeners?.onPointerDown?.(e as any);
      }}
      onPointerUp={handlePointerUp}
      className={`
        absolute top-0.5 h-[14px] rounded-full cursor-grab active:cursor-grabbing
        flex items-center px-1 overflow-hidden
        ${barColor} text-white
        ${isDragging ? 'opacity-50 z-30' : 'z-10'}
        ${isSelected ? 'ring-2 ring-blue-500 ring-offset-1' : ''}
        shadow-sm hover:shadow-md transition-shadow
      `}
      style={{ left: style.left, width: style.width, minWidth: '20px' }}
      title={`${allocation.userName} (${allocation.role}) - ${allocation.hoursPerDay}h/day`}
    >
      <span className="text-[8px] font-semibold truncate leading-none">{initials}</span>
    </div>
  );
}
