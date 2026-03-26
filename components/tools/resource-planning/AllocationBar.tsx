'use client';

import { useMemo } from 'react';
import { useDraggable } from '@dnd-kit/core';
import type { Allocation, ResourceRole } from '@/lib/resource-planning/types';
import { ROLE_BAR_COLORS } from '@/lib/resource-planning/types';

interface Props {
  allocation: Allocation;
  startDate: Date;
  endDate: Date;
  totalDays: number;
}

export function AllocationBar({ allocation, startDate, endDate, totalDays }: Props) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `alloc-${allocation.id}`,
  });

  const style = useMemo(() => {
    const allocStart = new Date(allocation.startDate);
    const allocEnd = new Date(allocation.endDate);

    // Clamp to visible range
    const visibleStart = Math.max(allocStart.getTime(), startDate.getTime());
    const visibleEnd = Math.min(allocEnd.getTime(), endDate.getTime());

    if (visibleStart > visibleEnd) return null;

    const startOffset = (visibleStart - startDate.getTime()) / (1000 * 60 * 60 * 24);
    const duration = (visibleEnd - visibleStart) / (1000 * 60 * 60 * 24);

    const left = `${(startOffset / totalDays) * 100}%`;
    const width = `${Math.max((duration / totalDays) * 100, 1)}%`;

    return { left, width };
  }, [allocation.startDate, allocation.endDate, startDate, endDate, totalDays]);

  if (!style) return null;

  const barColor = ROLE_BAR_COLORS[allocation.role as ResourceRole] || 'bg-slate-400';

  // Get initials
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
      className={`
        absolute top-0.5 h-5 rounded-sm cursor-grab active:cursor-grabbing
        flex items-center px-1 overflow-hidden
        ${barColor} text-white
        ${isDragging ? 'opacity-50 z-30' : 'z-10'}
        shadow-sm hover:shadow-md transition-shadow
      `}
      style={{
        left: style.left,
        width: style.width,
        minWidth: '24px',
      }}
      title={`${allocation.userName} (${allocation.role}) - ${allocation.hoursPerDay}h/day`}
    >
      <span className="text-[9px] font-semibold truncate leading-none">
        {initials}
      </span>
    </div>
  );
}
