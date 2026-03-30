'use client';

import { useCallback, useRef, useState, useMemo } from 'react';
import { ChevronLeft, ChevronRight, Circle, Search } from 'lucide-react';
import { useResourcePlanningStore } from '@/lib/stores/resource-planning-store';
import {
  getWeeksInRange,
  formatShortDate,
  formatWeekLabel,
  isSameDay,
  computeWeekFlexWeights,
} from '@/lib/resource-planning/date-utils';

export function DateBar() {
  const visibleStart = useResourcePlanningStore((s) => s.visibleStart);
  const visibleEnd = useResourcePlanningStore((s) => s.visibleEnd);
  const focusedDays = useResourcePlanningStore((s) => s.focusedDays);
  const lockedFocusDays = useResourcePlanningStore((s) => s.lockedFocusDays);
  const isLocked = useResourcePlanningStore((s) => s.isLocked);
  const setFocusedDays = useResourcePlanningStore((s) => s.setFocusedDays);
  const toggleFocusLock = useResourcePlanningStore((s) => s.toggleFocusLock);
  const shiftDateRange = useResourcePlanningStore((s) => s.shiftDateRange);
  const goToToday = useResourcePlanningStore((s) => s.goToToday);

  const focusWindowWeeks = useResourcePlanningStore((s) => s.focusWindowWeeks);
  const zoomLevel = useResourcePlanningStore((s) => s.zoomLevel);
  const clientSearchQuery = useResourcePlanningStore((s) => s.clientSearchQuery);
  const setClientSearchQuery = useResourcePlanningStore((s) => s.setClientSearchQuery);

  const barRef = useRef<HTMLDivElement>(null);
  const [isPanning, setIsPanning] = useState(false);
  const panStartX = useRef(0);

  const startDate = useMemo(() => new Date(visibleStart), [visibleStart]);
  const endDate = useMemo(() => new Date(visibleEnd), [visibleEnd]);
  const weeks = useMemo(() => getWeeksInRange(startDate, endDate), [startDate, endDate]);

  const activeDays = isLocked ? lockedFocusDays : focusedDays;
  const [hoveredWeekIdx, setHoveredWeekIdx] = useState<number | null>(null);

  // Find locked week index for highlight
  const lockedWeekIdx = useMemo(() => {
    if (!isLocked || lockedFocusDays.length === 0) return null;
    const lockDate = new Date(lockedFocusDays[0]);
    return weeks.findIndex((w) => {
      const weekEnd = new Date(w);
      weekEnd.setDate(weekEnd.getDate() + 6);
      return lockDate >= w && lockDate <= weekEnd;
    });
  }, [isLocked, lockedFocusDays, weeks]);

  const expandedWeekIdx = isLocked ? lockedWeekIdx : hoveredWeekIdx;

  // Compute flex weights once — used both for rendering and for hit-testing
  const weekFlexes = useMemo(
    () => computeWeekFlexWeights(weeks.length, expandedWeekIdx, focusWindowWeeks),
    [weeks.length, expandedWeekIdx, focusWindowWeeks],
  );

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
        if (!isLocked) {
          const days = (() => {
            const wStart = weeks[idx];
            const result: Date[] = [];
            for (let d = 0; d < focusWindowWeeks * 7; d++) {
              const day = new Date(wStart);
              day.setDate(day.getDate() + d);
              if (day.getDay() !== 0 && day.getDay() !== 6) result.push(day);
            }
            return result;
          })();
          setFocusedDays(days);
        }
      }
    },
    [isPanning, weeks, setFocusedDays, isLocked, focusWindowWeeks],
  );

  const handleMouseLeave = useCallback(() => {
    setHoveredWeekIdx(null);
    if (!isLocked) setFocusedDays([]);
  }, [setFocusedDays, isLocked]);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (isPanning) return;
      const rect = barRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = e.clientX - rect.left;
      const weekWidth = rect.width / weeks.length;
      const idx = Math.floor(x / weekWidth);

      if (isLocked && lockedWeekIdx === idx) {
        // Click same week again → unlock
        toggleFocusLock();
      } else if (!isLocked && idx >= 0 && idx < weeks.length) {
        // Set focused days based on focus window slider, then lock
        const days = (() => {
          const wStart = weeks[idx];
          const result: Date[] = [];
          for (let d = 0; d < focusWindowWeeks * 7; d++) {
            const day = new Date(wStart);
            day.setDate(day.getDate() + d);
            if (day.getDay() !== 0 && day.getDay() !== 6) result.push(day);
          }
          return result;
        })();
        const store = useResourcePlanningStore.getState();
        store.setFocusedDays(days);
        setTimeout(() => useResourcePlanningStore.getState().toggleFocusLock(), 0);
      } else if (isLocked) {
        // Click different week → unlock and re-focus
        const store = useResourcePlanningStore.getState();
        store.toggleFocusLock(); // unlock
        if (idx >= 0 && idx < weeks.length) {
          const days = (() => {
            const wStart = weeks[idx];
            const result: Date[] = [];
            for (let d = 0; d < focusWindowWeeks * 7; d++) {
              const day = new Date(wStart);
              day.setDate(day.getDate() + d);
              if (day.getDay() !== 0 && day.getDay() !== 6) result.push(day);
            }
            return result;
          })();
          setTimeout(() => {
            const s = useResourcePlanningStore.getState();
            s.setFocusedDays(days);
            setTimeout(() => useResourcePlanningStore.getState().toggleFocusLock(), 0);
          }, 0);
        }
      }
    },
    [isPanning, weeks, isLocked, lockedWeekIdx, toggleFocusLock, focusWindowWeeks],
  );

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setIsPanning(true);
    panStartX.current = e.clientX;
    e.preventDefault();
  }, []);

  const handlePanMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isPanning) return;
      const delta = e.clientX - panStartX.current;
      if (Math.abs(delta) > 40) {
        shiftDateRange(delta > 0 ? -7 : 7);
        panStartX.current = e.clientX;
      }
    },
    [isPanning, shiftDateRange],
  );

  const handleMouseUp = useCallback(() => setIsPanning(false), []);

  return (
    <div className="sticky top-0 z-20 bg-white border-b select-none">
      <div className="flex items-center">
        {/* Job info spacer — Today button, nav arrows, and client search */}
        <div className="w-[280px] flex-shrink-0 flex flex-col justify-center gap-0.5 px-2 py-1 border-r">
          <div className="flex items-center">
            <button
              onClick={goToToday}
              className="flex items-center gap-1 px-2 py-0.5 rounded hover:bg-blue-50 text-blue-600 transition-colors"
              title="Go to today"
            >
              <Circle className="h-2.5 w-2.5 fill-blue-600" />
              <span className="text-[9px] font-semibold">Today</span>
            </button>
            <div className="flex items-center gap-0.5 ml-auto">
              <button onClick={() => shiftDateRange(-7)} className="p-0.5 hover:bg-slate-100 rounded">
                <ChevronLeft className="h-3.5 w-3.5 text-slate-500" />
              </button>
              <button onClick={() => shiftDateRange(7)} className="p-0.5 hover:bg-slate-100 rounded">
                <ChevronRight className="h-3.5 w-3.5 text-slate-500" />
              </button>
            </div>
          </div>
          {/* select-text overrides the parent select-none so the input is typeable */}
          <div className="relative select-text" onMouseDown={(e) => e.stopPropagation()}>
            <Search className="absolute left-1.5 top-1/2 -translate-y-1/2 h-2.5 w-2.5 text-slate-400 pointer-events-none" />
            <input
              type="text"
              placeholder="Search clients…"
              value={clientSearchQuery}
              onChange={(e) => setClientSearchQuery(e.target.value)}
              className="w-full pl-5 pr-1.5 py-1 text-[10px] border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 transition-colors cursor-text select-text"
              style={{ userSelect: 'text' }}
            />
          </div>
        </div>

        {/* Date columns - aligned with grid */}
        <div
          ref={barRef}
          className="flex-1 flex cursor-grab active:cursor-grabbing min-w-0 overflow-hidden"
          style={zoomLevel !== 1 ? { transform: `scaleX(${zoomLevel})`, transformOrigin: 'left top', width: `${100 / zoomLevel}%` } : undefined}
          onMouseMove={isPanning ? handlePanMove : handleMouseMove}
          onMouseLeave={handleMouseLeave}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onClick={handleClick}
        >
          {weeks.map((week, idx) => {
            const flexWeight = weekFlexes[idx];
            // A week is "in focus" if it falls inside the focus window
            const inFocusWindow = expandedWeekIdx !== null
              && idx >= expandedWeekIdx
              && idx < expandedWeekIdx + focusWindowWeeks;
            const isLockedWeek = isLocked && lockedWeekIdx !== null
              && idx >= lockedWeekIdx
              && idx < lockedWeekIdx + focusWindowWeeks;

            if (inFocusWindow) {
              // Show individual working-day columns for this week
              const days = (() => {
                const weekStart = weeks[idx];
                const days: Date[] = [];
                for (let d = 0; d < 7; d++) {
                  const day = new Date(weekStart);
                  day.setDate(day.getDate() + d);
                  if (day.getDay() !== 0 && day.getDay() !== 6) days.push(day);
                }
                return days;
              })();

              return (
                <div
                  key={week.toISOString()}
                  className={`flex overflow-hidden ${isLockedWeek ? 'bg-blue-50 border-b-2 border-blue-400' : ''}`}
                  style={{ flex: flexWeight }}
                >
                  {days.map((day) => (
                    <div
                      key={day.toISOString()}
                      className={`flex-1 text-center py-1 text-[9px] font-medium border-r border-slate-100
                        ${isSameDay(day, new Date()) ? 'bg-blue-100 text-blue-700 font-bold' : 'text-slate-600'}`}
                    >
                      <div>{['Mon', 'Tue', 'Wed', 'Thu', 'Fri'][day.getDay() - 1]}</div>
                      <div className="text-[8px]">{formatShortDate(day)}</div>
                    </div>
                  ))}
                </div>
              );
            }

            // Non-focus week: compressed label
            return (
              <div
                key={week.toISOString()}
                className={`text-center py-1 text-[9px] font-medium border-r border-slate-100 truncate overflow-hidden
                  ${isLockedWeek ? 'bg-blue-50 text-blue-700 border-b-2 border-blue-400' : 'text-slate-500'}`}
                style={{ flex: flexWeight }}
              >
                {flexWeight >= 0.6 ? formatWeekLabel(week) : ''}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
