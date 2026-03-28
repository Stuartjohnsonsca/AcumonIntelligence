'use client';

import { useMemo, useState, useTransition } from 'react';
import { Search, ZoomIn, ZoomOut, CalendarDays, RotateCw, RefreshCw, Sparkles } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useResourcePlanningStore } from '@/lib/stores/resource-planning-store';
import { UnscheduledJobsDialog } from './UnscheduledJobsDialog';
import { RollForwardDialog } from './RollForwardDialog';
import { ResourceOptimizerDialog } from './ResourceOptimizerDialog';

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
  const isResourceAdmin = useResourcePlanningStore((s) => s.isResourceAdmin);

  const unscheduledJobCount = useResourcePlanningStore((s) => s.unscheduledJobCount);
  const completedJobCount = useResourcePlanningStore((s) => s.completedJobCount);

  const focusedDays = useResourcePlanningStore((s) => s.focusedDays);
  const lockedFocusDays = useResourcePlanningStore((s) => s.lockedFocusDays);
  const isLocked = useResourcePlanningStore((s) => s.isLocked);

  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [searchOpen, setSearchOpen] = useState(false);
  const [showUnscheduled, setShowUnscheduled] = useState(false);
  const [showRollForward, setShowRollForward] = useState(false);
  const [showOptimizer, setShowOptimizer] = useState(false);

  function handleRefresh() {
    startTransition(() => { router.refresh(); });
  }

  const capacities = useMemo(() => getFocusedCapacity(), [getFocusedCapacity, allocations, staff, focusedDays, lockedFocusDays, isLocked]);

  // Top 10 available (positive) and top 10 overallocated (negative)
  const positive = useMemo(() =>
    capacities.filter((c) => c.netHrs > 0).sort((a, b) => b.netHrs - a.netHrs).slice(0, 10),
    [capacities]);
  const negative = useMemo(() =>
    capacities.filter((c) => c.netHrs < 0).sort((a, b) => a.netHrs - b.netHrs).slice(0, 10),
    [capacities]);
  const maxPositive = positive[0]?.netHrs || 1;
  const maxNegative = Math.abs(negative[0]?.netHrs || 1);

  const filteredStaff = useMemo(() => {
    if (!searchQuery) return staff;
    return staff.filter((s) => s.name.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [staff, searchQuery]);

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

          {/* Available staff (top 10) */}
          <div className="flex items-center gap-0.5 flex-1 flex-wrap overflow-hidden min-w-0">
            <span className="text-[8px] text-green-600 font-medium flex-shrink-0 mr-0.5">Available:</span>
            {positive.map((c) => {
              const opacity = 0.4 + 0.6 * (c.netHrs / maxPositive);
              return (
                <span key={c.userId}
                  className="inline-flex items-center gap-0.5 px-1.5 py-0 rounded-full text-[9px] font-medium bg-green-50 text-green-700 border border-green-200 whitespace-nowrap"
                  style={{ opacity }}
                  onClick={() => toggleStaffSelection(c.userId)}
                  title={`${c.name}: ${c.netHrs}h available`}
                >
                  {c.name.split(' ')[0]}
                  <span className="font-bold">+{c.netHrs}h</span>
                </span>
              );
            })}
            {positive.length === 0 && <span className="text-[9px] text-slate-400">None</span>}
            {capacities.filter(c => c.netHrs > 0).length > 10 && (
              <span className="text-[8px] text-green-500">+{capacities.filter(c => c.netHrs > 0).length - 10} more</span>
            )}
          </div>

          {/* Centre: Focus window slider + Zoom slider */}
          <div className="flex items-center gap-2 flex-shrink-0 px-2">
            <div className="flex items-center gap-1" title={`Click date bar to expand ${focusWindowWeeks} week${focusWindowWeeks > 1 ? 's' : ''} of daily detail`}>
              <span className="text-[8px] text-slate-400">Days</span>
              <input type="range" min={1} max={8} step={1} value={focusWindowWeeks}
                onChange={(e) => setFocusWindowWeeks(parseInt(e.target.value))}
                className="w-24 h-1 accent-indigo-500"
                title={`Focus window: ${focusWindowWeeks} weeks`} />
            </div>
            <div className="flex items-center gap-1">
              <ZoomOut className="h-3 w-3 text-slate-400" />
              <input type="range" min={75} max={125} step={5}
                value={zoomLevel * 100}
                onChange={(e) => setZoomLevel(parseInt(e.target.value) / 100)}
                className="w-24 h-1 accent-blue-500"
                title={`Zoom: ${Math.round(zoomLevel * 100)}%`} />
              <ZoomIn className="h-3 w-3 text-slate-400" />
            </div>
          </div>

          {/* Overallocated staff (top 10) */}
          <div className="flex items-center gap-0.5 flex-1 flex-wrap overflow-hidden min-w-0 justify-end">
            <span className="text-[8px] text-red-600 font-medium flex-shrink-0 mr-0.5">Over:</span>
            {negative.map((c) => {
              const opacity = 0.4 + 0.6 * (Math.abs(c.netHrs) / maxNegative);
              return (
                <span key={c.userId}
                  className="inline-flex items-center gap-0.5 px-1.5 py-0 rounded-full text-[9px] font-medium bg-red-50 text-red-700 border border-red-200 whitespace-nowrap"
                  style={{ opacity }}
                  onClick={() => toggleStaffSelection(c.userId)}
                  title={`${c.name}: ${c.netHrs}h overallocated`}
                >
                  {c.name.split(' ')[0]}
                  <span className="font-bold">{c.netHrs}h</span>
                </span>
              );
            })}
            {negative.length === 0 && <span className="text-[9px] text-slate-400">None</span>}
            {capacities.filter(c => c.netHrs < 0).length > 10 && (
              <span className="text-[8px] text-red-500">+{capacities.filter(c => c.netHrs < 0).length - 10} more</span>
            )}
          </div>

          {/* Refresh data from server */}
          <button
            onClick={handleRefresh}
            disabled={isPending}
            className="flex-shrink-0 p-1 rounded hover:bg-slate-100 text-slate-500 disabled:opacity-50"
            title="Refresh schedule data"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isPending ? 'animate-spin' : ''}`} />
          </button>

          {/* AI Optimiser — admin only */}
          {isResourceAdmin && (
            <button
              onClick={() => setShowOptimizer(true)}
              className="flex-shrink-0 flex items-center gap-1 px-2 py-1 rounded bg-violet-50 hover:bg-violet-100 text-violet-700 text-[11px] font-medium transition-colors border border-violet-200"
              title="AI Resource Optimiser"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Optimise
            </button>
          )}

          {/* Search */}
          <div className="relative flex-shrink-0">
            <button onClick={() => setSearchOpen(!searchOpen)} className="p-1 rounded hover:bg-slate-100 text-slate-500">
              <Search className="h-3.5 w-3.5" />
            </button>
            {searchOpen && (
              <div className="absolute top-full right-0 mt-1 w-56 bg-white border rounded-lg shadow-lg z-40 p-2">
                <input type="text" placeholder="Search staff..."
                  value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full px-2 py-1 text-xs border rounded mb-1" autoFocus />
                <div className="max-h-40 overflow-y-auto">
                  {filteredStaff.map((s) => (
                    <label key={s.id} className="flex items-center gap-2 px-2 py-0.5 hover:bg-slate-50 rounded cursor-pointer text-xs">
                      <input type="checkbox" checked={selectedStaffIds.includes(s.id)}
                        onChange={() => toggleStaffSelection(s.id)} className="rounded" />
                      <span>{s.name}</span>
                    </label>
                  ))}
                </div>
                {selectedStaffIds.length > 0 && (
                  <button onClick={() => { setSelectedStaff([]); setSearchOpen(false); }}
                    className="w-full mt-1 text-[10px] text-blue-600 hover:text-blue-800">Clear selection</button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {showUnscheduled && <UnscheduledJobsDialog onClose={() => setShowUnscheduled(false)} />}
      {showRollForward && <RollForwardDialog onClose={() => setShowRollForward(false)} />}
      {showOptimizer && <ResourceOptimizerDialog onClose={() => setShowOptimizer(false)} />}
    </>
  );
}
