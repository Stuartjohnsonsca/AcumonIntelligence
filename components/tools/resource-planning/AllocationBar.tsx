'use client';

import { useMemo } from 'react';
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

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={(e) => {
        e.stopPropagation();
        setSelectedAllocation(isSelected ? null : allocation.id);
      }}
      onPointerDown={(e) => e.stopPropagation()}
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
