// ─── Resource Planning Types ─────────────────────────────────────────

export interface StaffMember {
  id: string;
  displayId: string;
  name: string;
  email: string;
  jobTitle: string | null;
  isActive: boolean;
  resourceSetting: StaffSetting | null;
}

export interface StaffSetting {
  id: string;
  resourceRole: ResourceRole; // Primary/display role
  concurrentJobLimit: number; // Legacy - limit for primary role
  isRI: boolean;
  weeklyCapacityHrs: number;
  overtimeHrs: number;
  // Per-role concurrent job limits (null = not eligible for that role)
  specialistJobLimit?: number | null;
  preparerJobLimit?: number | null;
  reviewerJobLimit?: number | null;
  riJobLimit?: number | null;
}

/** Get all active roles for a staff member */
export function getStaffRoles(setting: StaffSetting | null): { role: ResourceRole; limit: number }[] {
  if (!setting) return [];
  const roles: { role: ResourceRole; limit: number }[] = [];
  if (setting.specialistJobLimit != null && setting.specialistJobLimit > 0) {
    roles.push({ role: 'Specialist', limit: setting.specialistJobLimit });
  }
  if (setting.preparerJobLimit != null && setting.preparerJobLimit > 0) {
    roles.push({ role: 'Preparer', limit: setting.preparerJobLimit });
  }
  if (setting.reviewerJobLimit != null && setting.reviewerJobLimit > 0) {
    roles.push({ role: 'Reviewer', limit: setting.reviewerJobLimit });
  }
  // RI: explicit limit, OR isRI flag, OR primary role is RI — matches scheduler isEligible logic
  const riLimit = setting.riJobLimit ?? ((setting.isRI || setting.resourceRole === 'RI') ? 1 : null);
  if (riLimit != null && riLimit > 0) {
    roles.push({ role: 'RI', limit: riLimit });
  }
  // Fallback: if no per-role limits set, use legacy single role
  if (roles.length === 0) {
    roles.push({ role: setting.resourceRole, limit: setting.concurrentJobLimit });
  }
  return roles;
}

export interface ResourceJobView {
  id: string;
  clientId: string;
  clientName: string;
  auditType: string;
  serviceType: string | null;
  periodEnd: string; // ISO date
  targetCompletion: string; // ISO date
  budgetHoursSpecialist: number;
  budgetHoursRI: number;
  budgetHoursReviewer: number;
  budgetHoursPreparer: number;
  engagementId: string | null;
  schedulingStatus: SchedulingStatus;
  isScheduleLocked: boolean;
  complianceDeadline: string | null;
  customDeadline: string | null;
  jobProfileId: string | null;
  crmJobId: string | null;
  actualHoursSpecialist: number;
  actualHoursRI: number;
  actualHoursReviewer: number;
  actualHoursPreparer: number;
  previousJobId: string | null;
  timesheetHours: number;
}

export interface Allocation {
  id: string;
  engagementId: string;
  userId: string;
  userName: string;
  role: ResourceRole;
  startDate: string; // ISO date
  endDate: string; // ISO date
  hoursPerDay: number;
  totalHours: number | null;
  notes: string | null;
  clientName?: string;
  serviceType?: string | null;
  auditType?: string;
}

export interface StaffAbsence {
  id: string;
  userId: string;
  startDate: string;
  endDate: string;
  type: 'holiday' | 'bank_holiday' | 'sick';
  approved: boolean;
}

export interface StaffCapacity {
  userId: string;
  name: string;
  totalHrs: number;
  allocatedHrs: number;
  netHrs: number;
  jobCount: number;
}

export interface NewAllocationInput {
  engagementId: string;
  userId: string;
  role: ResourceRole;
  startDate: string;
  endDate: string;
  hoursPerDay?: number;
  totalHours?: number;
}

export interface ResourceJobProfile {
  id: string;
  firmId: string;
  name: string;
  budgetHoursSpecialist: number;
  budgetHoursRI: number;
  budgetHoursReviewer: number;
  budgetHoursPreparer: number;
  budgetHoursSpecialistDetail: Record<string, number>;
  isDefault: boolean;
}

export interface ResourceClientSettingView {
  id: string;
  clientId: string;
  clientName: string;
  resourceCategoryId: string | null;
  resourceCategoryName: string | null;
  serviceType: string | null;
  rollForwardTimeframe: string | null;
}

export interface ScheduleProposal {
  jobId: string;
  allocations: ProposedAllocation[];
  conflicts: string[];
}

export interface ProposedAllocation {
  userId: string;
  userName: string;
  role: ResourceRole;
  startDate: string;
  endDate: string;
  hoursPerDay: number;
  totalHours: number;
  availabilityScore: number; // 0-100
  familiarityScore: number; // 0-100
}

export interface DateRange {
  start: Date;
  end: Date;
}

export type ResourceRole = 'Specialist' | 'Preparer' | 'Reviewer' | 'RI';
export type SchedulingStatus = 'unscheduled' | 'pre_scheduled' | 'scheduled' | 'completed';
export type ViewAxis = 'client' | 'staff';
export type EditMode = 'edit' | 'create';
export type ViewMode = 'client-bookings' | 'staff-bookings' | 'client-availability' | 'staff-availability';

/** Ordered from top to bottom in grid display */
export const ROLE_ORDER: ResourceRole[] = ['Specialist', 'RI', 'Reviewer', 'Preparer'];

export const ROLE_COLORS: Record<ResourceRole, { bg: string; text: string; border: string }> = {
  Specialist: { bg: 'bg-teal-100', text: 'text-teal-800', border: 'border-teal-300' },
  RI: { bg: 'bg-amber-100', text: 'text-amber-800', border: 'border-amber-300' },
  Reviewer: { bg: 'bg-purple-100', text: 'text-purple-800', border: 'border-purple-300' },
  Preparer: { bg: 'bg-blue-100', text: 'text-blue-800', border: 'border-blue-300' },
};

export const ROLE_BAR_COLORS: Record<ResourceRole, string> = {
  Specialist: 'bg-teal-400',
  RI: 'bg-amber-400',
  Reviewer: 'bg-purple-400',
  Preparer: 'bg-blue-400',
};

export const DEFAULT_CONCURRENT_LIMITS: Record<ResourceRole, number> = {
  Specialist: 5,
  RI: 30,
  Reviewer: 18,
  Preparer: 3,
};

// ─── Optimizer Types ─────────────────────────────────────────────────────────

export type OptimizationScope = 'all' | 'unscheduled';

export interface AllocationChange {
  action: 'create' | 'delete';
  existingId?: string;
  jobId: string;
  clientName: string;
  auditType: string;
  userId: string;
  userName: string;
  role: ResourceRole;
  startDate: string;
  endDate: string;
  hoursPerDay: number;
}

export interface OptimizationViolation {
  constraintId: string;
  priority: number;
  jobId?: string;
  userId?: string;
  description: string;
}

export interface OptimizedJobSchedule {
  jobId: string;
  allocations: ProposedAllocation[];
}

export interface OptimizationResult {
  schedule: OptimizedJobSchedule[];
  violations: OptimizationViolation[];
  unschedulable: string[];
  reasoning: string;
  changes: AllocationChange[];
  promptTokens?: number;
  completionTokens?: number;
}
