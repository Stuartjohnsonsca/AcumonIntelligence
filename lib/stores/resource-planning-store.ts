'use client';

import { create } from 'zustand';
import type {
  StaffMember,
  ResourceJobView,
  Allocation,
  StaffCapacity,
} from '@/lib/resource-planning/types';
import { computeStaffCapacity } from '@/lib/resource-planning/capacity';
import { allocationOverlaps, getDefaultDateRange } from '@/lib/resource-planning/date-utils';

interface ResourcePlanningState {
  // Data
  staff: StaffMember[];
  jobs: ResourceJobView[];
  allocations: Allocation[];

  // View state
  visibleStart: string; // ISO date
  visibleEnd: string; // ISO date
  focusedDays: string[]; // ISO dates of expanded day columns
  selectedStaffIds: string[];
  searchQuery: string;
  isInitialized: boolean;
}

interface ResourcePlanningActions {
  init: (data: { staff: StaffMember[]; jobs: ResourceJobView[]; allocations: Allocation[] }) => void;
  setVisibleRange: (start: Date, end: Date) => void;
  setFocusedDays: (days: Date[]) => void;
  setSelectedStaff: (ids: string[]) => void;
  setSearchQuery: (q: string) => void;
  shiftDateRange: (days: number) => void;

  // Allocation CRUD (optimistic)
  addAllocation: (alloc: Allocation) => void;
  updateAllocation: (id: string, changes: Partial<Allocation>) => void;
  removeAllocation: (id: string) => void;

  // Staff settings
  updateStaffSetting: (userId: string, changes: Partial<StaffMember['resourceSetting']>) => void;

  // Computed
  getStaffCapacity: () => StaffCapacity[];
  getJobsForEngagement: (engagementId: string) => Allocation[];
  getSortedJobs: () => ResourceJobView[];
  getStaffAvailability: (userId: string) => boolean;
}

const defaultRange = getDefaultDateRange();

export const useResourcePlanningStore = create<ResourcePlanningState & ResourcePlanningActions>()(
  (set, get) => ({
    // Initial state
    staff: [],
    jobs: [],
    allocations: [],
    visibleStart: defaultRange.start.toISOString(),
    visibleEnd: defaultRange.end.toISOString(),
    focusedDays: [],
    selectedStaffIds: [],
    searchQuery: '',
    isInitialized: false,

    init: (data) => {
      set({
        staff: data.staff,
        jobs: data.jobs,
        allocations: data.allocations,
        isInitialized: true,
      });
    },

    setVisibleRange: (start, end) => {
      set({ visibleStart: start.toISOString(), visibleEnd: end.toISOString() });
    },

    setFocusedDays: (days) => {
      set({ focusedDays: days.map((d) => d.toISOString()) });
    },

    setSelectedStaff: (ids) => {
      set({ selectedStaffIds: ids });
    },

    setSearchQuery: (q) => {
      set({ searchQuery: q });
    },

    shiftDateRange: (days) => {
      const { visibleStart, visibleEnd } = get();
      const start = new Date(visibleStart);
      const end = new Date(visibleEnd);
      start.setDate(start.getDate() + days);
      end.setDate(end.getDate() + days);
      set({ visibleStart: start.toISOString(), visibleEnd: end.toISOString() });
    },

    addAllocation: (alloc) => {
      set((state) => ({ allocations: [...state.allocations, alloc] }));
    },

    updateAllocation: (id, changes) => {
      set((state) => ({
        allocations: state.allocations.map((a) =>
          a.id === id ? { ...a, ...changes } : a,
        ),
      }));
    },

    removeAllocation: (id) => {
      set((state) => ({
        allocations: state.allocations.filter((a) => a.id !== id),
      }));
    },

    updateStaffSetting: (userId, changes) => {
      set((state) => ({
        staff: state.staff.map((s) =>
          s.id === userId
            ? {
                ...s,
                resourceSetting: s.resourceSetting
                  ? { ...s.resourceSetting, ...changes }
                  : null,
              }
            : s,
        ),
      }));
    },

    getStaffCapacity: () => {
      const { staff, allocations, visibleStart, visibleEnd } = get();
      return computeStaffCapacity(
        staff,
        allocations,
        new Date(visibleStart),
        new Date(visibleEnd),
      );
    },

    getJobsForEngagement: (engagementId) => {
      return get().allocations.filter((a) => a.engagementId === engagementId);
    },

    getSortedJobs: () => {
      const { jobs, allocations, focusedDays } = get();
      if (focusedDays.length === 0) return jobs;

      const focusStart = new Date(focusedDays[0]);
      const focusEnd = new Date(focusedDays[focusedDays.length - 1]);

      return [...jobs].sort((a, b) => {
        const aAllocs = allocations.filter(
          (al) =>
            al.engagementId === a.engagementId &&
            allocationOverlaps(al.startDate, al.endDate, focusStart, focusEnd),
        );
        const bAllocs = allocations.filter(
          (al) =>
            al.engagementId === b.engagementId &&
            allocationOverlaps(al.startDate, al.endDate, focusStart, focusEnd),
        );

        // Jobs with allocations in focused range first
        if (aAllocs.length > 0 && bAllocs.length === 0) return -1;
        if (bAllocs.length > 0 && aAllocs.length === 0) return 1;

        // Then by proximity of target completion to focus
        const aDist = Math.abs(new Date(a.targetCompletion).getTime() - focusStart.getTime());
        const bDist = Math.abs(new Date(b.targetCompletion).getTime() - focusStart.getTime());
        return aDist - bDist;
      });
    },

    getStaffAvailability: (userId) => {
      const { staff, allocations, visibleStart, visibleEnd } = get();
      const member = staff.find((s) => s.id === userId);
      if (!member) return false;

      const capacity = computeStaffCapacity(
        [member],
        allocations,
        new Date(visibleStart),
        new Date(visibleEnd),
      );

      return capacity[0]?.netHrs > 0;
    },
  }),
);
