'use client';

import { useMemo, useState } from 'react';
import { Search, ZoomIn, ZoomOut, CalendarDays, Circle, RotateCw, Users } from 'lucide-react';
import Link from 'next/link';
import { useResourcePlanningStore } from '@/lib/stores/resource-planning-store';
import { UnscheduledJobsDialog } from './UnscheduledJobsDialog';
import { RollForwardDialog } from './RollForwardDialog';

export function ResourceToolbar() {
  const staff = useResourcePlanningStore((s) => s.staff);
  const allocations = useResourcePlanningStore((s) => s.allocations);
  const getFocusedCapacity = useResourcePlanningStore((s) => s.getFocusedCapacity);
  const selectedStaffIds = useResourcePlanningStore((s) => s.selectedStaffIds);
  const setSelectedStaff = useResourcePlanningStore((s) => s.setSelectedStaff);
  const searchQuery = useResourcePlanningStore((s) => s.searchQuery);
  const setSearchQuery = useResourcePlanningStore((s) => s.setSearchQuery);
  const zoomLevel = useResourcePlanningStore((s) => s.zoomLevel);
  const setZoomLevel = useResourcePlanningStore((s) => s.setZoomLevel);
  const focusWindowWeeks = useResourcePlanningStore((s) => s.focusWindowWeeks);
  const setFocusWindowWeeks = useResourcePlanningStore((s) => s.setFocusWindowWeeks);
  const focusedDays = useResourcePlanningStore((s) => s.focusedDays);
  const lockedFocusDays = useResourcePlanningStore((s) => s.lockedFocusDays);
  const isLocked = useResourcePlanningStore((s) => s.isLocked);
  const goToToday = useResourcePlanningStore((s) => s.goToToday);
  const unscheduledJobCount = useResourcePlanningStore((s) => s.unscheduledJobCount);
  const completedJobCount = useResourcePlanningStore((s) => s.completedJobCount);
  const isResourceAdmin = useResourcePlanningStore((s) => s.isResourceAdmin);

  const [searchOpen, setSearchOpen] = useState(false);
  const [showUnscheduled, setShowUnscheduled] = useState(false);
  const [showRollForward, setShowRollForward] = useState(false);

  const capacity = useMemo(
    () => getFocusedCapacity(),
    [getFocusedCapacity, staff, allocations, focusedDays, lockedFocusDays, isLocked],
  );

  const positive = useMemo(() => {
    const items = capacity.filter((c) => c.netHrs > 0);
    items.sort((a, b) => b.netHrs - a.netHrs);
    return reorderEdgesToCentre(items);
  }, [capacity]);

  const negative = useMemo(() => {
    const items = capacity.filter((c) => c.netHrs < 0);
    items.sort((a, b) => a.netHrs - b.netHrs);
    return reorderEdgesToCentre(items);
  }, [capacity]);

  const maxPositive = positive.length > 0 ? Math.max(...positive.map((c) => c.netHrs)) : 1;
  const maxNegative = negative.length > 0 ? Math.max(...negative.map((c) => Math.abs(c.netHrs))) : 1;

  const filteredStaff = staff.filter((s) => s.name.toLowerCase().includes(searchQuery.toLowerCase()));

  function toggleStaffSelection(id: string) {
    if (selectedStaffIds.includes(id)) {
      setSelectedStaff(selectedStaffIds.filter((sid) => sid !== id));
    } else {
      setSelectedStaff([...selectedStaffIds, id]);
    }
  }

  return (
    <>
      <div className="sticky top-16 z-30 bg-white border-b shadow-sm px-2 py-1">
        <div className="flex items-center gap-2">
          {/* Today button */}
          <button
            onClick={goToToday}
            className="flex flex-col items-center gap-0 flex-shrink-0 px-1 py-0.5 rounded hover:bg-blue-50 text-blue-600"
            title="Go to today"
          >
            <Circle className="h-3 w-3 fill-blue-600" />
            <span className="text-[7px] font-medium leading-none">Today</span>
          </button>

          {/* Red dot: Unscheduled jobs */}
          {isResourceAdmin && unscheduledJobCount > 0 && (
            <button
              onClick={() => setShowUnscheduled(true)}
              className="relative flex-shrink-0 p-1 rounded hover:bg-red-50"
              title={`${unscheduledJobCount} unscheduled jobs`}
            >
              <CalendarDays className="h-3.5 w-3.5 text-slate-500" />
              <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 bg-red-500 text-white text-[8px] font-bold rounded-full flex items-center justify-center">
                {unscheduledJobCount}
              </span>
            </button>
          )}

          {/* Red dot: Completed jobs for roll-forward */}
          {isResourceAdmin && completedJobCount > 0 && (
            <button
              onClick={() => setShowRollForward(true)}
              className="relative flex-shrink-0 p-1 rounded hover:bg-red-50"
              title={`${completedJobCount} completed jobs to roll forward`}
            >
              <RotateCw className="h-3.5 w-3.5 text-slate-500" />
              <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 bg-red-500 text-white text-[8px] font-bold rounded-full flex items-center justify-center">
                {completedJobCount}
              </span>
            </button>
          )}

          {/* Link to Staff Setup admin */}
          {isResourceAdmin && (
            <Link href="/my-account/resource-management"
              className="flex-shrink-0 px-2 py-1 rounded hover:bg-indigo-50 z-10 relative cursor-pointer inline-flex items-center gap-1 text-[10px] text-indigo-600 font-medium border border-indigo-200 bg-indigo-50/50"
              title="Manage resource staff in admin">
              <Users className="h-3.5 w-3.5" />
              Staff Admin
            </Link>
          )}

          {/* Left: Positive capacity badges */}
          <div className="flex items-center gap-0.5 flex-1 flex-wrap overflow-hidden min-w-0">
            {positive.map((c) => {
              const opacity = 0.4 + 0.6 * (c.netHrs / maxPositive);
              return (
                <span
                  key={c.userId}
                  className="inline-flex items-center gap-0.5 px-1.5 py-0 rounded-full text-[9px] font-medium bg-green-50 text-green-700 border border-green-200 whitespace-nowrap"
                  style={{ opacity }}
                >
                  {c.name.split(' ')[0]}
                  <span className="font-bold">+{c.netHrs}h</span>
                </span>
              );
            })}
            {positive.length === 0 && <span className="text-[9px] text-slate-400">No spare capacity</span>}
          </div>

          {/* Centre: Focus window slider + Zoom slider */}
          <div className="flex items-center gap-2 flex-shrink-0 px-2">
            <div className="flex items-center gap-1" title={`Click date bar to expand ${focusWindowWeeks} week${focusWindowWeeks > 1 ? 's' : ''} of daily detail`}>
              <span className="text-[8px] text-slate-400">Days</span>
              <input
                type="range"
                min={1}
                max={6}
                step={1}
                value={focusWindowWeeks}
                onChange={(e) => setFocusWindowWeeks(parseInt(e.target.value))}
                className="w-24 h-1 accent-indigo-500"
              />
              <span className="text-[8px] text-slate-500 w-6">{focusWindowWeeks * 5}d</span>
            </div>
            <div className="w-px h-3 bg-slate-200" />
            <div className="flex items-center gap-1">
              <ZoomOut className="h-3 w-3 text-slate-400" />
              <input
                type="range"
                min={75}
                max={125}
                step={5}
                value={zoomLevel * 100}
                onChange={(e) => setZoomLevel(parseInt(e.target.value) / 100)}
                className="w-24 h-1 accent-blue-500"
                title={`Zoom: ${Math.round(zoomLevel * 100)}%`}
              />
              <ZoomIn className="h-3 w-3 text-slate-400" />
            </div>
          </div>

          {/* Right: Negative capacity badges */}
          <div className="flex items-center gap-0.5 flex-1 flex-wrap overflow-hidden min-w-0 justify-end">
            {negative.map((c) => {
              const opacity = 0.4 + 0.6 * (Math.abs(c.netHrs) / maxNegative);
              return (
                <span
                  key={c.userId}
                  className="inline-flex items-center gap-0.5 px-1.5 py-0 rounded-full text-[9px] font-medium bg-red-50 text-red-700 border border-red-200 whitespace-nowrap"
                  style={{ opacity }}
                >
                  {c.name.split(' ')[0]}
                  <span className="font-bold">{c.netHrs}h</span>
                </span>
              );
            })}
            {negative.length === 0 && <span className="text-[9px] text-slate-400">No overallocation</span>}
          </div>

          {/* Search */}
          <div className="relative flex-shrink-0">
            <button onClick={() => setSearchOpen(!searchOpen)} className="p-1 rounded hover:bg-slate-100 text-slate-500">
              <Search className="h-3.5 w-3.5" />
            </button>
            {searchOpen && (
              <div className="absolute top-full right-0 mt-1 w-56 bg-white border rounded-lg shadow-lg z-40 p-2">
                <input
                  type="text"
                  placeholder="Search staff..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full px-2 py-1 text-xs border rounded mb-1"
                  autoFocus
                />
                <div className="max-h-40 overflow-y-auto">
                  {filteredStaff.map((s) => (
                    <label key={s.id} className="flex items-center gap-2 px-2 py-0.5 hover:bg-slate-50 rounded cursor-pointer text-xs">
                      <input
                        type="checkbox"
                        checked={selectedStaffIds.includes(s.id)}
                        onChange={() => toggleStaffSelection(s.id)}
                        className="rounded"
                      />
                      <span>{s.name}</span>
                    </label>
                  ))}
                </div>
                {selectedStaffIds.length > 0 && (
                  <button onClick={() => setSelectedStaff([])} className="mt-1 text-[10px] text-blue-600 hover:underline">
                    Clear
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Dialogs */}
      {showUnscheduled && <UnscheduledJobsDialog onClose={() => setShowUnscheduled(false)} />}
      {showRollForward && <RollForwardDialog onClose={() => setShowRollForward(false)} />}
    </>
  );
}

/** Reorder array so highest values are at edges, lowest in centre */
function reorderEdgesToCentre<T extends { netHrs: number }>(sorted: T[]): T[] {
  if (sorted.length <= 2) return sorted;
  const leftItems: T[] = [];
  const rightItems: T[] = [];
  let left = true;
  for (let i = 0; i < sorted.length; i++) {
    if (left) leftItems.push(sorted[i]);
    else rightItems.unshift(sorted[i]);
    left = !left;
  }
  return [...leftItems, ...rightItems];
}
