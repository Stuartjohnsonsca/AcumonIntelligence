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
  ResourceRole,
  ResourceJobProfile,
} from '@/lib/resource-planning/types';
import { computeStaffCapacity } from '@/lib/resource-planning/capacity';
import { allocationOverlaps, getDefaultDateRange } from '@/lib/resource-planning/date-utils';

interface ResourcePlanningState {
  // Data
  staff: StaffMember[];
  jobs: ResourceJobView[];
  allocations: Allocation[];
  absences: StaffAbsence[];
  jobProfiles: ResourceJobProfile[];

  // View state
  visibleStart: string;
  visibleEnd: string;
  focusedDays: string[];
  lockedFocusDays: string[];
  isLocked: boolean;
  selectedStaffIds: string[];
  searchQuery: string;
  isInitialized: boolean;

  // View controls
  zoomLevel: number;
  focusWindowWeeks: number;
  viewMode: ViewMode;
  editMode: EditMode;
  selectedAllocationId: string | null;
  leftPanelFilter: string[];

  // Job status counts
  unscheduledJobCount: number;
  completedJobCount: number;

  setActiveDragUserId: (id: string | null) => void;

  // Dynamic role lanes: extra roles added per job beyond defaults
  dynamicRoleLanes: Record<string, ResourceRole[]>;

  // Current user context
  currentUserId: string | null;
  isResourceAdmin: boolean;

  // Active drag context (set during drag for lane validation)
  activeDragUserId: string | null;
}

interface ResourcePlanningActions {
  init: (data: {
    staff: StaffMember[];
    jobs: ResourceJobView[];
    allocations: Allocation[];
    absences?: StaffAbsence[];
    jobProfiles?: ResourceJobProfile[];
    unscheduledJobCount?: number;
    completedJobCount?: number;
    currentUserId?: string;
    isResourceAdmin?: boolean;
  }) => void;
  setVisibleRange: (start: Date, end: Date) => void;
  setFocusedDays: (days: Date[]) => void;
  toggleFocusLock: () => void;
  setSelectedStaff: (ids: string[]) => void;
  setSearchQuery: (q: string) => void;
  shiftDateRange: (days: number) => void;
  goToToday: () => void;

  // View controls
  setZoomLevel: (level: number) => void;
  setFocusWindowWeeks: (weeks: number) => void;
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

  // Job management
  updateJob: (jobId: string, changes: Partial<ResourceJobView>) => void;
  setUnscheduledCount: (n: number) => void;
  setCompletedCount: (n: number) => void;
  setJobProfiles: (profiles: ResourceJobProfile[]) => void;

  // Dynamic role lanes
  addRoleLane: (jobId: string, role: ResourceRole) => void;
  removeRoleLane: (jobId: string, role: ResourceRole, index: number) => void;

  // Computed
  getStaffCapacity: () => StaffCapacity[];
  getFocusedCapacity: () => StaffCapacity[];
  getSortedJobs: () => ResourceJobView[];
  getViewAxis: () => 'client' | 'staff';
  getIsAvailabilityMode: () => boolean;
  getJobRoles: (jobId: string) => ResourceRole[];
}

const defaultRange = getDefaultDateRange();

export const useResourcePlanningStore = create<ResourcePlanningState & ResourcePlanningActions>()(
  (set, get) => ({
    staff: [],
    jobs: [],
    allocations: [],
    absences: [],
    jobProfiles: [],
    visibleStart: defaultRange.start.toISOString(),
    visibleEnd: defaultRange.end.toISOString(),
    focusedDays: [],
    lockedFocusDays: [],
    isLocked: false,
    selectedStaffIds: [],
    searchQuery: '',
    isInitialized: false,
    zoomLevel: 1.0,
    focusWindowWeeks: 4,
    viewMode: 'client-bookings',
    editMode: 'edit',
    selectedAllocationId: null,
    leftPanelFilter: [],
    unscheduledJobCount: 0,
    completedJobCount: 0,
    dynamicRoleLanes: {},
    currentUserId: null,
    isResourceAdmin: false,
    activeDragUserId: null,

    init: (data) => {
      set({
        staff: data.staff,
        jobs: data.jobs,
        allocations: data.allocations,
        absences: data.absences ?? [],
        jobProfiles: data.jobProfiles ?? [],
        unscheduledJobCount: data.unscheduledJobCount ?? 0,
        completedJobCount: data.completedJobCount ?? 0,
        currentUserId: data.currentUserId ?? null,
        isResourceAdmin: data.isResourceAdmin ?? false,
        isInitialized: true,
      });
    },

    setVisibleRange: (start, end) => {
      set({ visibleStart: start.toISOString(), visibleEnd: end.toISOString() });
    },

    setFocusedDays: (days) => {
      const { isLocked } = get();
      if (isLocked) return;
      set({ focusedDays: days.map((d) => d.toISOString()) });
    },

    toggleFocusLock: () => {
      const { isLocked, focusedDays } = get();
      if (isLocked) {
        set({ isLocked: false, lockedFocusDays: [], focusedDays: [] });
      } else {
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
    setFocusWindowWeeks: (weeks) => set({ focusWindowWeeks: Math.max(1, Math.min(6, weeks)) }),
    setViewMode: (mode) => set({ viewMode: mode }),
    setEditMode: (mode) => set({ editMode: mode }),
    setSelectedAllocation: (id) => set({ selectedAllocationId: id }),
    setActiveDragUserId: (id) => set({ activeDragUserId: id }),
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

    updateJob: (jobId, changes) => {
      set((state) => ({
        jobs: state.jobs.map((j) => (j.id === jobId ? { ...j, ...changes } : j)),
      }));
    },

    setUnscheduledCount: (n) => set({ unscheduledJobCount: n }),
    setCompletedCount: (n) => set({ completedJobCount: n }),
    setJobProfiles: (profiles) => set({ jobProfiles: profiles }),

    addRoleLane: (jobId, role) => {
      set((state) => {
        const existing = state.dynamicRoleLanes[jobId] || [];
        return {
          dynamicRoleLanes: {
            ...state.dynamicRoleLanes,
            [jobId]: [...existing, role],
          },
        };
      });
    },

    removeRoleLane: (jobId, role, index) => {
      set((state) => {
        const existing = state.dynamicRoleLanes[jobId] || [];
        const updated = existing.filter((_, i) => i !== index);
        return {
          dynamicRoleLanes: {
            ...state.dynamicRoleLanes,
            [jobId]: updated,
          },
        };
      });
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

    getJobRoles: (jobId: string) => {
      const { dynamicRoleLanes } = get();
      const defaults: ResourceRole[] = ['Specialist', 'RI', 'Reviewer', 'Preparer'];
      const extras = dynamicRoleLanes[jobId] || [];
      // Merge: for each default role, if extra has more of the same, add them
      const result: ResourceRole[] = [];
      for (const role of defaults) {
        result.push(role);
        const extraOfThisRole = extras.filter((r) => r === role);
        for (const e of extraOfThisRole) result.push(e);
      }
      return result;
    },
  }),
);
