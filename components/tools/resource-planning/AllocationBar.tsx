'use client';

import { useMemo, useState, useRef, useCallback } from 'react';
import { useDraggable } from '@dnd-kit/core';
import type { Allocation } from '@/lib/resource-planning/types';
import { ROLE_BAR_COLORS } from '@/lib/resource-planning/types';
import { countWorkingDays, getWeeksInRange, formatShortDate, computeWeekFlexWeights } from '@/lib/resource-planning/date-utils';
import { useResourcePlanningStore } from '@/lib/stores/resource-planning-store';

interface Props {
  allocation: Allocation;
  startDate: Date;
  endDate: Date;
  totalDays: number;
  isJobLocked?: boolean;
  /** Override the auto-generated label inside the bar */
  barLabel?: string;
}

export function AllocationBar({ allocation, startDate, endDate, totalDays, isJobLocked = false, barLabel }: Props) {
  const selectedAllocationId = useResourcePlanningStore((s) => s.selectedAllocationId);
  const setSelectedAllocation = useResourcePlanningStore((s) => s.setSelectedAllocation);
  const updateAllocation = useResourcePlanningStore((s) => s.updateAllocation);
  const focusedDays = useResourcePlanningStore((s) => s.focusedDays);
  const lockedFocusDays = useResourcePlanningStore((s) => s.lockedFocusDays);
  const isLocked = useResourcePlanningStore((s) => s.isLocked);
  const focusWindowWeeks = useResourcePlanningStore((s) => s.focusWindowWeeks);
  const viewMode = useResourcePlanningStore((s) => s.viewMode);
  const storeJobs = useResourcePlanningStore((s) => s.jobs);

  // Look up the associated job from the store so the tooltip/label works
  // even when allocation.clientName is not populated (e.g. after page reload)
  const job = useMemo(
    () => storeJobs.find((j) => (j.engagementId ?? j.id) === allocation.engagementId),
    [storeJobs, allocation.engagementId],
  );
  const clientName = job?.clientName ?? allocation.clientName ?? '';
  const serviceType = job?.serviceType ?? allocation.serviceType ?? null;
  const auditType = job?.auditType ?? allocation.auditType ?? '';

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
    const clampedStart = new Date(Math.max(allocStart.getTime(), startDate.getTime()));
    const clampedEnd = new Date(Math.min(allocEnd.getTime(), endDate.getTime()));
    if (clampedStart.getTime() > clampedEnd.getTime()) return null;

    // ── Flex-aware positioning ─────────────────────────────────────────────
    // The DateBar uses CSS flex: the focused week gets `flex: expandFlex`
    // while every other week gets `flex: 1`. We replicate that here so
    // allocation bars grow/shrink in sync with the DateBar column widths.
    const weeks = getWeeksInRange(startDate, endDate);
    const activeDays = isLocked ? lockedFocusDays : focusedDays;

    // Find which week is currently expanded (same derivation as DateBar)
    let expandedWeekIdx: number | null = null;
    if (activeDays.length > 0) {
      const pivotDay = new Date(activeDays[0]);
      const idx = weeks.findIndex((w) => {
        const weekEnd = new Date(w);
        weekEnd.setDate(weekEnd.getDate() + 7);
        return pivotDay >= w && pivotDay < weekEnd;
      });
      if (idx !== -1) expandedWeekIdx = idx;
    }

    // Shared distance-decay flex weights — identical algorithm to DateBar
    const weekFlexes = computeWeekFlexWeights(weeks.length, expandedWeekIdx, focusWindowWeeks);
    const totalFlex = weekFlexes.reduce((s, f) => s + f, 0);
    const cumulativeFlex: number[] = [];
    let cum = 0;
    for (const f of weekFlexes) {
      cumulativeFlex.push(cum);
      cum += f;
    }

    // Map a Date to a flex-fraction in [0, 1] across the full weeks span.
    // For weeks INSIDE the focus window: use working-day slot position (÷5 per week)
    // because the DateBar renders Mon–Fri as 5 equal slots in those weeks.
    // For weeks OUTSIDE: use calendar-day proportion (÷7) — fine for compressed weeks.
    function dateToFlexFraction(date: Date): number {
      const ms = date.getTime();
      for (let i = 0; i < weeks.length; i++) {
        const wStart = weeks[i].getTime();
        const wEnd = wStart + 7 * 24 * 60 * 60 * 1000;
        if (ms >= wStart && ms < wEnd) {
          let posInWeek: number;
          const inFocusWindow = expandedWeekIdx !== null
            && i >= expandedWeekIdx
            && i < expandedWeekIdx + focusWindowWeeks;
          if (inFocusWindow) {
            // Working-day slot: Mon=0, Tue=1, Wed=2, Thu=3, Fri=4, Sat(excl-end)=5
            const dow = new Date(ms).getDay(); // 0=Sun … 6=Sat
            const slot = dow === 6 ? 5        // Saturday midnight = exclusive end of Friday
                       : dow === 0 ? 0        // Sunday (shouldn't happen) → treat as start
                       : dow - 1;             // Mon=0, Tue=1, Wed=2, Thu=3, Fri=4
            posInWeek = slot / 5;
          } else {
            posInWeek = (ms - wStart) / (7 * 24 * 60 * 60 * 1000);
          }
          return (cumulativeFlex[i] + posInWeek * weekFlexes[i]) / totalFlex;
        }
      }
      if (ms < weeks[0].getTime()) return 0;
      return 1;
    }

    const leftFrac = Math.max(0, dateToFlexFraction(clampedStart));
    // endDate is INCLUSIVE — add 1 day to get the right edge (end-of-day)
    const clampedEndExclusive = new Date(clampedEnd.getTime() + 24 * 60 * 60 * 1000);
    const rightFrac = Math.min(1, dateToFlexFraction(clampedEndExclusive));
    if (rightFrac <= leftFrac) return null;

    return {
      left: `${leftFrac * 100}%`,
      width: `${Math.max((rightFrac - leftFrac) * 100, 0.5)}%`,
    };
  }, [allocation.startDate, allocation.endDate, startDate, endDate, focusedDays, lockedFocusDays, isLocked, focusWindowWeeks]);

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
        fetch(`/api/resource-planning/allocations/${allocation.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
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

  // In staff-axis views the y-axis already tells you who → show the client abbreviation.
  // In client-axis views the y-axis already tells you the job → show staff initials.
  // Role View shows both role sections; show "Initials@ClientAbbrev".
  const isStaffAxis = viewMode.startsWith('staff');
  const isRoleView = viewMode === 'role-view';
  const clientAbbrev = (() => {
    if (!clientName) return '';
    const words = clientName.trim().split(/\s+/).filter(Boolean);
    if (words.length >= 2) return words.map((w) => w[0]).join('').toUpperCase().slice(0, 5);
    return clientName.slice(0, 5).toUpperCase();
  })();
  const autoLabel = isRoleView
    ? (clientAbbrev ? `${initials}@${clientAbbrev}` : initials)
    : isStaffAxis
    ? (clientAbbrev || initials)
    : initials;
  const displayLabel = barLabel ?? autoLabel;

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
      title={[
        clientName
          ? `📁 ${clientName}${auditType ? ` — ${auditType}` : ''}${serviceType ? ` (${serviceType})` : ''}`
          : null,
        `👤 ${allocation.userName}  |  🎯 ${allocation.role}`,
        `📅 ${formatShortDate(new Date(allocation.startDate))} → ${formatShortDate(new Date(allocation.endDate))}`,
        `⏱ ${allocation.hoursPerDay}h/day  |  ${displayHours}h total`,
        isJobLocked ? '🔒 Schedule locked' : 'Drag edges to resize · drag centre to move',
      ].filter(Boolean).join('\n')}
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
        {displayLabel} · {displayHours}h
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
