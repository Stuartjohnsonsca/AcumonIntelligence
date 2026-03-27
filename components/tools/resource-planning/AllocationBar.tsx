'use client';

import { memo, useMemo, useState, useRef, useCallback, useEffect } from 'react';
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
}

export const AllocationBar = memo(function AllocationBar({ allocation, startDate, endDate, totalDays }: Props) {
  const selectedAllocationId = useResourcePlanningStore((s) => s.selectedAllocationId);
  const setSelectedAllocation = useResourcePlanningStore((s) => s.setSelectedAllocation);
  const updateAllocation = useResourcePlanningStore((s) => s.updateAllocation);

  const [resizing, setResizing] = useState<'left' | 'right' | null>(null);
  // Local override dates used only during drag — avoids store thrash
  const [localStart, setLocalStart] = useState<string | null>(null);
  const [localEnd, setLocalEnd] = useState<string | null>(null);

  const barRef = useRef<HTMLDivElement>(null);
  const startXRef = useRef(0);
  const origStartRef = useRef('');
  const origEndRef = useRef('');

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `alloc-${allocation.id}`,
    disabled: resizing !== null,
  });

  // Use local overrides during drag, fall back to allocation props
  const effectiveStart = localStart ?? allocation.startDate;
  const effectiveEnd = localEnd ?? allocation.endDate;

  const style = useMemo(() => {
    const allocStart = new Date(effectiveStart);
    const allocEnd = new Date(effectiveEnd);
    const visibleStart = Math.max(allocStart.getTime(), startDate.getTime());
    const visibleEnd = Math.min(allocEnd.getTime(), endDate.getTime());
    if (visibleStart > visibleEnd || totalDays <= 0) return null;

    const startOffset = (visibleStart - startDate.getTime()) / (1000 * 60 * 60 * 24);
    const duration = (visibleEnd - visibleStart) / (1000 * 60 * 60 * 24);
    return {
      left: `${(startOffset / totalDays) * 100}%`,
      width: `${Math.max((duration / totalDays) * 100, 1)}%`,
    };
  }, [effectiveStart, effectiveEnd, startDate, endDate, totalDays]);

  // Snap a date to the nearest weekday (Mon-Fri)
  function snapToWeekday(date: Date): Date {
    const d = new Date(date);
    if (d.getDay() === 0) d.setDate(d.getDate() + 1);
    if (d.getDay() === 6) d.setDate(d.getDate() + 2);
    return d;
  }

  // Convert pixel delta to days delta based on container width
  function pxToDays(px: number): number {
    const container = barRef.current?.parentElement;
    if (!container) return 0;
    const containerWidth = container.clientWidth;
    if (containerWidth === 0) return 0;
    const daysPerPx = totalDays / containerWidth;
    return Math.round(px * daysPerPx);
  }

  const handleResizeStart = useCallback((edge: 'left' | 'right', e: React.MouseEvent) => {
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
        if (snapped < new Date(origEndRef.current)) {
          setLocalStart(snapped.toISOString());
        }
      } else {
        const newEnd = new Date(origEndRef.current);
        newEnd.setDate(newEnd.getDate() + deltaDays);
        const snapped = snapToWeekday(newEnd);
        if (snapped > new Date(origStartRef.current)) {
          setLocalEnd(snapped.toISOString());
        }
      }
    }

    function handleMouseUp() {
      setResizing(null);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      listenersRef.current = { move: null, up: null };
      document.body.style.cursor = '';
      document.body.style.userSelect = '';

      // Read from latest local state via refs
      const latestStart = localStartRef.current ?? origStartRef.current;
      const latestEnd = localEndRef.current ?? origEndRef.current;

      // Update store once
      const updates: Partial<Allocation> = {};
      if (latestStart !== origStartRef.current) updates.startDate = latestStart;
      if (latestEnd !== origEndRef.current) updates.endDate = latestEnd;

      if (Object.keys(updates).length > 0) {
        updateAllocation(allocation.id, updates);

        // Persist to backend
        fetch('/api/resource-planning/allocations', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: allocation.id,
            startDate: latestStart,
            endDate: latestEnd,
          }),
        }).catch(() => {});
      }

      // Clear local overrides
      setLocalStart(null);
      setLocalEnd(null);
    }

    listenersRef.current = { move: handleMouseMove, up: handleMouseUp };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [allocation, totalDays, updateAllocation]);

  // Track local state in refs so mouseUp can read latest values
  const localStartRef = useRef<string | null>(null);
  const localEndRef = useRef<string | null>(null);
  useEffect(() => { localStartRef.current = localStart; }, [localStart]);
  useEffect(() => { localEndRef.current = localEnd; }, [localEnd]);

  // Clean up any lingering listeners on unmount
  const listenersRef = useRef<{ move: ((ev: MouseEvent) => void) | null; up: (() => void) | null }>({ move: null, up: null });
  useEffect(() => {
    return () => {
      if (listenersRef.current.move) document.removeEventListener('mousemove', listenersRef.current.move);
      if (listenersRef.current.up) document.removeEventListener('mouseup', listenersRef.current.up);
      // Always reset body cursor/select on unmount in case drag was in progress
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, []);

  if (!style) return null;

  const barColor = ROLE_BAR_COLORS[allocation.role] || 'bg-slate-400';
  const isSelected = selectedAllocationId === allocation.id;
  const initials = (allocation.userName || '?')
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  const displayHours = allocation.totalHours != null
    ? allocation.totalHours
    : Math.round(allocation.hoursPerDay * countWorkingDays(new Date(effectiveStart), new Date(effectiveEnd)) * 10) / 10;

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
        shadow-sm hover:shadow-md transition-shadow
        ${resizing ? 'cursor-col-resize' : 'cursor-grab active:cursor-grabbing'}
      `}
      style={{ left: style.left, width: style.width, minWidth: '24px' }}
      title={`${allocation.userName || 'Unknown'} (${allocation.role}) - ${allocation.hoursPerDay}h/day - ${displayHours}h total\nDrag edges to resize, drag centre to move`}
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
});
