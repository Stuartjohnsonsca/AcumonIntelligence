'use client';

import { useMemo, useState, useRef, useCallback } from 'react';
import { useDraggable } from '@dnd-kit/core';
import type { Allocation, ResourceRole } from '@/lib/resource-planning/types';
import { ROLE_BAR_COLORS } from '@/lib/resource-planning/types';
import { countWorkingDays } from '@/lib/resource-planning/date-utils';
import { useResourcePlanningStore } from '@/lib/stores/resource-planning-store';

interface Props {
  allocation: Allocation;
  startDate: Date;
  endDate: Date;
  totalDays: number;
  isJobLocked?: boolean;
}

export function AllocationBar({ allocation, startDate, endDate, totalDays, isJobLocked = false }: Props) {
  const selectedAllocationId = useResourcePlanningStore((s) => s.selectedAllocationId);
  const setSelectedAllocation = useResourcePlanningStore((s) => s.setSelectedAllocation);
  const updateAllocation = useResourcePlanningStore((s) => s.updateAllocation);

  const [resizing, setResizing] = useState<'left' | 'right' | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const startXRef = useRef(0);
  const origStartRef = useRef('');
  const origEndRef = useRef('');

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `alloc-${allocation.id}`,
    disabled: resizing !== null || isJobLocked, // Disable drag while resizing or when job is locked
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

  // Snap a date to the nearest weekday (Mon-Fri)
  function snapToWeekday(date: Date): Date {
    const d = new Date(date);
    if (d.getDay() === 0) d.setDate(d.getDate() + 1); // Sun → Mon
    if (d.getDay() === 6) d.setDate(d.getDate() + 2); // Sat → Mon
    return d;
  }

  // Convert pixel delta to days delta based on container width
  function pxToDays(px: number): number {
    const container = barRef.current?.parentElement;
    if (!container) return 0;
    const containerWidth = container.clientWidth;
    const daysPerPx = totalDays / containerWidth;
    return Math.round(px * daysPerPx);
  }

  const handleResizeStart = useCallback((edge: 'left' | 'right', e: React.MouseEvent) => {
    if (isJobLocked) return; // No resizing on locked jobs
    e.stopPropagation();
    e.preventDefault();
    setResizing(edge);
    startXRef.current = e.clientX;
    origStartRef.current = allocation.startDate;
    origEndRef.current = allocation.endDate;

    function handleMouseMove(ev: MouseEvent) {
      const deltaPx = ev.clientX - startXRef.current;
      const deltaDays = pxToDays(deltaPx);
      if (deltaDays === 0) return;

      if (edge === 'left') {
        const newStart = new Date(origStartRef.current);
        newStart.setDate(newStart.getDate() + deltaDays);
        const snapped = snapToWeekday(newStart);
        // Don't let start go past end
        if (snapped < new Date(allocation.endDate)) {
          updateAllocation(allocation.id, { startDate: snapped.toISOString() });
        }
      } else {
        const newEnd = new Date(origEndRef.current);
        newEnd.setDate(newEnd.getDate() + deltaDays);
        const snapped = snapToWeekday(newEnd);
        // Don't let end go before start
        if (snapped > new Date(allocation.startDate)) {
          updateAllocation(allocation.id, { endDate: snapped.toISOString() });
        }
      }
    }

    function cleanup() {
      setResizing(null);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('pointercancel', cleanup);
      window.removeEventListener('blur', cleanup);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }

    function handleMouseUp() {
      // Persist to backend before cleanup
      const current = useResourcePlanningStore.getState().allocations.find(a => a.id === allocation.id);
      if (current && (current.startDate !== origStartRef.current || current.endDate !== origEndRef.current)) {
        fetch('/api/resource-planning/allocations', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: allocation.id,
            startDate: current.startDate,
            endDate: current.endDate,
          }),
        }).catch(() => {});
      }
      cleanup();
    }

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('pointercancel', cleanup);
    window.addEventListener('blur', cleanup);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [allocation, totalDays, updateAllocation]);

  if (!style) return null;

  const barColor = ROLE_BAR_COLORS[allocation.role] || 'bg-slate-400';
  const isSelected = selectedAllocationId === allocation.id;
  const initials = allocation.userName
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  const displayHours = allocation.totalHours != null
    ? allocation.totalHours
    : Math.round(allocation.hoursPerDay * countWorkingDays(new Date(allocation.startDate), new Date(allocation.endDate)) * 10) / 10;

  return (
    <div
      ref={(node) => { setNodeRef(node); (barRef as any).current = node; }}
      {...(resizing ? {} : listeners)}
      {...(resizing ? {} : attributes)}
      onClick={(e) => {
        e.stopPropagation();
        if (!isDragging && !resizing) {
          setSelectedAllocation(isSelected ? null : allocation.id);
        }
      }}
      className={`
        absolute top-0.5 h-[20px] rounded-md
        flex items-center overflow-hidden group
        ${barColor} text-white
        ${isDragging ? 'opacity-50 z-30' : 'z-10'}
        ${resizing ? 'z-30' : ''}
        ${isSelected ? 'ring-2 ring-blue-500 ring-offset-1' : ''}
        ${isJobLocked ? 'opacity-70 cursor-not-allowed' : resizing ? 'cursor-col-resize' : 'cursor-grab active:cursor-grabbing'}
        shadow-sm hover:shadow-md transition-shadow
      `}
      style={{ left: style.left, width: style.width, minWidth: '24px' }}
      title={`${allocation.userName} (${allocation.role}) - ${allocation.hoursPerDay}h/day - ${displayHours}h total\nDrag edges to resize, drag centre to move`}
    >
      {/* Left resize handle */}
      <div
        onMouseDown={(e) => handleResizeStart('left', e)}
        className="absolute left-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-white/30 rounded-l-md z-20 flex items-center justify-center"
        title="Drag to change start date"
      >
        <div className="w-0.5 h-3 bg-white/50 rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>

      {/* Content */}
      <span className="text-[8px] font-semibold truncate leading-none px-2.5 select-none">
        {initials} ({displayHours})
      </span>

      {/* Right resize handle */}
      <div
        onMouseDown={(e) => handleResizeStart('right', e)}
        className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-white/30 rounded-r-md z-20 flex items-center justify-center"
        title="Drag to change end date"
      >
        <div className="w-0.5 h-3 bg-white/50 rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
    </div>
  );
}
