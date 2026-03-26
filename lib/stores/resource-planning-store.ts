'use client';

import { create } from 'zustand';
import type {
  StaffMember,
  ResourceJobView,
  Allocation,
  StaffCapacity,
  StaffAbsence,
  ViewMode,
  EditMode,
} from '@/lib/resource-planning/types';
import { computeStaffCapacity } from '@/lib/resource-planning/capacity';
import { allocationOverlaps, getDefaultDateRange, getWeekStart } from '@/lib/resource-planning/date-utils';

interface ResourcePlanningState {
  // Data
  staff: StaffMember[];
  jobs: ResourceJobView[];
  allocations: Allocation[];
  absences: StaffAbsence[];

  // View state
  visibleStart: string;
  visibleEnd: string;
  focusedDays: string[];
  lockedFocusDays: string[];
  isLocked: boolean;
  selectedStaffIds: string[];
  searchQuery: string;
  isInitialized: boolean;

  // New view controls
  zoomLevel: number;
  viewMode: ViewMode;
  editMode: EditMode;
  selectedAllocationId: string | null;
  leftPanelFilter: string[];
}

interface ResourcePlanningActions {
  init: (data: { staff: StaffMember[]; jobs: ResourceJobView[]; allocations: Allocation[]; absences?: StaffAbsence[] }) => void;
  setVisibleRange: (start: Date, end: Date) => void;
  setFocusedDays: (days: Date[]) => void;
  toggleFocusLock: () => void;
  setSelectedStaff: (ids: string[]) => void;
  setSearchQuery: (q: string) => void;
  shiftDateRange: (days: number) => void;
  goToToday: () => void;

  // View controls
  setZoomLevel: (level: number) => void;
  setViewMode: (mode: ViewMode) => void;
  setEditMode: (mode: EditMode) => void;
  setSelectedAllocation: (id: string | null) => void;
  setLeftPanelFilter: (ids: string[]) => void;

  // Allocation CRUD
  addAllocation: (alloc: Allocation) => void;
  updateAllocation: (id: string, changes: Partial<Allocation>) => void;
  removeAllocation: (id: string) => void;

  // Staff settings
  updateStaffSetting: (userId: string, changes: Partial<StaffMember['resourceSetting']>) => void;

  // Computed
  getStaffCapacity: () => StaffCapacity[];
  getFocusedCapacity: () => StaffCapacity[];
  getSortedJobs: () => ResourceJobView[];
  getViewAxis: () => 'client' | 'staff';
  getIsAvailabilityMode: () => boolean;
}

const defaultRange = getDefaultDateRange();

export const useResourcePlanningStore = create<ResourcePlanningState & ResourcePlanningActions>()(
  (set, get) => ({
    staff: [],
    jobs: [],
    allocations: [],
    absences: [],
    visibleStart: defaultRange.start.toISOString(),
    visibleEnd: defaultRange.end.toISOString(),
    focusedDays: [],
    lockedFocusDays: [],
    isLocked: false,
    selectedStaffIds: [],
    searchQuery: '',
    isInitialized: false,
    zoomLevel: 1.0,
    viewMode: 'client-bookings',
    editMode: 'edit',
    selectedAllocationId: null,
    leftPanelFilter: [],

    init: (data) => {
      set({
        staff: data.staff,
        jobs: data.jobs,
        allocations: data.allocations,
        absences: data.absences ?? [],
        isInitialized: true,
      });
    },

    setVisibleRange: (start, end) => {
      set({ visibleStart: start.toISOString(), visibleEnd: end.toISOString() });
    },

    setFocusedDays: (days) => {
      const { isLocked } = get();
      if (isLocked) return; // Don't update focused days when locked
      set({ focusedDays: days.map((d) => d.toISOString()) });
    },

    toggleFocusLock: () => {
      const { isLocked, focusedDays } = get();
      if (isLocked) {
        // Unlock
        set({ isLocked: false, lockedFocusDays: [], focusedDays: [] });
      } else {
        // Lock current focused days
        set({ isLocked: true, lockedFocusDays: [...focusedDays] });
      }
    },

    setSelectedStaff: (ids) => set({ selectedStaffIds: ids }),
    setSearchQuery: (q) => set({ searchQuery: q }),

    shiftDateRange: (days) => {
      const { visibleStart, visibleEnd } = get();
      const start = new Date(visibleStart);
      const end = new Date(visibleEnd);
      start.setDate(start.getDate() + days);
      end.setDate(end.getDate() + days);
      set({ visibleStart: start.toISOString(), visibleEnd: end.toISOString() });
    },

    goToToday: () => {
      const range = getDefaultDateRange();
      set({
        visibleStart: range.start.toISOString(),
        visibleEnd: range.end.toISOString(),
        isLocked: false,
        lockedFocusDays: [],
        focusedDays: [],
      });
    },

    setZoomLevel: (level) => set({ zoomLevel: Math.max(0.75, Math.min(1.25, level)) }),
    setViewMode: (mode) => set({ viewMode: mode }),
    setEditMode: (mode) => set({ editMode: mode }),
    setSelectedAllocation: (id) => set({ selectedAllocationId: id }),
    setLeftPanelFilter: (ids) => set({ leftPanelFilter: ids }),

    addAllocation: (alloc) => {
      set((state) => ({ allocations: [...state.allocations, alloc] }));
    },

    updateAllocation: (id, changes) => {
      set((state) => ({
        allocations: state.allocations.map((a) => (a.id === id ? { ...a, ...changes } : a)),
      }));
    },

    removeAllocation: (id) => {
      set((state) => ({
        allocations: state.allocations.filter((a) => a.id !== id),
        selectedAllocationId: state.selectedAllocationId === id ? null : state.selectedAllocationId,
      }));
    },

    updateStaffSetting: (userId, changes) => {
      set((state) => ({
        staff: state.staff.map((s) =>
          s.id === userId
            ? { ...s, resourceSetting: s.resourceSetting ? { ...s.resourceSetting, ...changes } : null }
            : s,
        ),
      }));
    },

    getStaffCapacity: () => {
      const { staff, allocations, visibleStart, visibleEnd } = get();
      return computeStaffCapacity(staff, allocations, new Date(visibleStart), new Date(visibleEnd));
    },

    getFocusedCapacity: () => {
      const { staff, allocations, focusedDays, lockedFocusDays, isLocked, visibleStart, visibleEnd } = get();
      const days = isLocked ? lockedFocusDays : focusedDays;
      if (days.length === 0) {
        return computeStaffCapacity(staff, allocations, new Date(visibleStart), new Date(visibleEnd));
      }
      const sorted = [...days].sort();
      return computeStaffCapacity(staff, allocations, new Date(sorted[0]), new Date(sorted[sorted.length - 1]));
    },

    getSortedJobs: () => {
      const { jobs, allocations, focusedDays, lockedFocusDays, isLocked } = get();
      const days = isLocked ? lockedFocusDays : focusedDays;
      if (days.length === 0) return jobs;

      const sorted = [...days].sort();
      const focusStart = new Date(sorted[0]);
      const focusEnd = new Date(sorted[sorted.length - 1]);

      return [...jobs].sort((a, b) => {
        const aAllocs = allocations.filter(
          (al) => al.engagementId === a.engagementId && allocationOverlaps(al.startDate, al.endDate, focusStart, focusEnd),
        );
        const bAllocs = allocations.filter(
          (al) => al.engagementId === b.engagementId && allocationOverlaps(al.startDate, al.endDate, focusStart, focusEnd),
        );

        if (aAllocs.length > 0 && bAllocs.length === 0) return -1;
        if (bAllocs.length > 0 && aAllocs.length === 0) return 1;

        const aDist = Math.abs(new Date(a.targetCompletion).getTime() - focusStart.getTime());
        const bDist = Math.abs(new Date(b.targetCompletion).getTime() - focusStart.getTime());
        return aDist - bDist;
      });
    },

    getViewAxis: () => {
      const { viewMode } = get();
      return viewMode.startsWith('staff') ? 'staff' : 'client';
    },

    getIsAvailabilityMode: () => {
      const { viewMode } = get();
      return viewMode.endsWith('availability');
    },
  }),
);
