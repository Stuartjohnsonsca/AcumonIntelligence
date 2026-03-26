'use client';

import { useCallback, useRef, useState, useMemo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useResourcePlanningStore } from '@/lib/stores/resource-planning-store';
import {
  getWeeksInRange,
  getDaysInRange,
  getWeekStart,
  formatShortDate,
  formatWeekLabel,
  isSameDay,
} from '@/lib/resource-planning/date-utils';

export function DateBar() {
  const visibleStart = useResourcePlanningStore((s) => s.visibleStart);
  const visibleEnd = useResourcePlanningStore((s) => s.visibleEnd);
  const focusedDays = useResourcePlanningStore((s) => s.focusedDays);
  const setFocusedDays = useResourcePlanningStore((s) => s.setFocusedDays);
  const shiftDateRange = useResourcePlanningStore((s) => s.shiftDateRange);

  const barRef = useRef<HTMLDivElement>(null);
  const [isPanning, setIsPanning] = useState(false);
  const panStartX = useRef(0);

  const startDate = useMemo(() => new Date(visibleStart), [visibleStart]);
  const endDate = useMemo(() => new Date(visibleEnd), [visibleEnd]);
  const weeks = useMemo(() => getWeeksInRange(startDate, endDate), [startDate, endDate]);

  const focusedSet = useMemo(
    () => new Set(focusedDays.map((d) => new Date(d).toDateString())),
    [focusedDays],
  );

  // When hovering over a week, expand it into days
  const [hoveredWeekIdx, setHoveredWeekIdx] = useState<number | null>(null);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (isPanning) return;
      const rect = barRef.current?.getBoundingClientRect();
      if (!rect) return;

      const x = e.clientX - rect.left;
      const weekWidth = rect.width / weeks.length;
      const idx = Math.floor(x / weekWidth);
      if (idx >= 0 && idx < weeks.length) {
        setHoveredWeekIdx(idx);
        // Set focused days for this week
        const weekStart = weeks[idx];
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 4); // Mon-Fri
        const days = getDaysInRange(weekStart, weekEnd).filter(
          (d) => d.getDay() !== 0 && d.getDay() !== 6,
        );
        setFocusedDays(days);
      }
    },
    [isPanning, weeks, setFocusedDays],
  );

  const handleMouseLeave = useCallback(() => {
    setHoveredWeekIdx(null);
    setFocusedDays([]);
  }, [setFocusedDays]);

  // Panning handlers
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      setIsPanning(true);
      panStartX.current = e.clientX;
      e.preventDefault();
    },
    [],
  );

  const handlePanMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isPanning) return;
      const delta = e.clientX - panStartX.current;
      if (Math.abs(delta) > 40) {
        const direction = delta > 0 ? -7 : 7;
        shiftDateRange(direction);
        panStartX.current = e.clientX;
      }
    },
    [isPanning, shiftDateRange],
  );

  const handleMouseUp = useCallback(() => {
    setIsPanning(false);
  }, []);

  return (
    <div className="sticky top-0 z-20 bg-white border-b select-none">
      <div className="flex items-center">
        {/* Nav buttons */}
        <button
          onClick={() => shiftDateRange(-7)}
          className="p-1 hover:bg-slate-100 rounded flex-shrink-0"
        >
          <ChevronLeft className="h-4 w-4 text-slate-500" />
        </button>

        {/* Date columns */}
        <div
          ref={barRef}
          className="flex-1 flex cursor-grab active:cursor-grabbing"
          onMouseMove={isPanning ? handlePanMove : handleMouseMove}
          onMouseLeave={handleMouseLeave}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
        >
          {weeks.map((week, idx) => {
            const isHovered = hoveredWeekIdx === idx;

            if (isHovered) {
              // Expand into day columns
              const weekEnd = new Date(week);
              weekEnd.setDate(weekEnd.getDate() + 4);
              const days = getDaysInRange(week, weekEnd).filter(
                (d) => d.getDay() !== 0 && d.getDay() !== 6,
              );

              return (
                <div key={week.toISOString()} className="flex flex-[3]">
                  {days.map((day) => (
                    <div
                      key={day.toISOString()}
                      className={`
                        flex-1 text-center py-1.5 text-[10px] font-medium border-r border-slate-100
                        ${isSameDay(day, new Date()) ? 'bg-blue-50 text-blue-700' : 'text-slate-600'}
                      `}
                    >
                      <div>{['Mon', 'Tue', 'Wed', 'Thu', 'Fri'][day.getDay() - 1]}</div>
                      <div className="text-[9px]">{formatShortDate(day)}</div>
                    </div>
                  ))}
                </div>
              );
            }

            return (
              <div
                key={week.toISOString()}
                className="flex-1 text-center py-1.5 text-[10px] font-medium text-slate-500 border-r border-slate-100 truncate"
              >
                {formatWeekLabel(week)}
              </div>
            );
          })}
        </div>

        <button
          onClick={() => shiftDateRange(7)}
          className="p-1 hover:bg-slate-100 rounded flex-shrink-0"
        >
          <ChevronRight className="h-4 w-4 text-slate-500" />
        </button>
      </div>
    </div>
  );
}
