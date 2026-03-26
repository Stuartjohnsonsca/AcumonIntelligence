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
  resourceRole: 'Preparer' | 'Reviewer' | 'RI'; // Primary/display role
  concurrentJobLimit: number; // Legacy - limit for primary role
  isRI: boolean;
  weeklyCapacityHrs: number;
  overtimeHrs?: number;
  // Per-role concurrent job limits (null = not eligible for that role)
  preparerJobLimit?: number | null;
  reviewerJobLimit?: number | null;
  riJobLimit?: number | null;
}

/** Get all active roles for a staff member */
export function getStaffRoles(setting: StaffSetting | null): { role: ResourceRole; limit: number }[] {
  if (!setting) return [];
  const roles: { role: ResourceRole; limit: number }[] = [];
  if (setting.preparerJobLimit != null && setting.preparerJobLimit > 0) {
    roles.push({ role: 'Preparer', limit: setting.preparerJobLimit });
  }
  if (setting.reviewerJobLimit != null && setting.reviewerJobLimit > 0) {
    roles.push({ role: 'Reviewer', limit: setting.reviewerJobLimit });
  }
  if (setting.riJobLimit != null && setting.riJobLimit > 0) {
    roles.push({ role: 'RI', limit: setting.riJobLimit });
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
  periodEnd: string; // ISO date
  targetCompletion: string; // ISO date
  budgetHoursRI: number;
  budgetHoursReviewer: number;
  budgetHoursPreparer: number;
  engagementId: string | null;
}

export interface Allocation {
  id: string;
  engagementId: string;
  userId: string;
  userName: string;
  role: 'Preparer' | 'Reviewer' | 'RI';
  startDate: string; // ISO date
  endDate: string; // ISO date
  hoursPerDay: number;
  notes: string | null;
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
  role: 'Preparer' | 'Reviewer' | 'RI';
  startDate: string;
  endDate: string;
  hoursPerDay?: number;
}

export interface DateRange {
  start: Date;
  end: Date;
}

export type ResourceRole = 'Preparer' | 'Reviewer' | 'RI';
export type ViewAxis = 'client' | 'staff';
export type EditMode = 'edit' | 'create';
export type ViewMode = 'client-bookings' | 'staff-bookings' | 'client-availability' | 'staff-availability';

export const ROLE_COLORS: Record<ResourceRole, { bg: string; text: string; border: string }> = {
  RI: { bg: 'bg-amber-100', text: 'text-amber-800', border: 'border-amber-300' },
  Reviewer: { bg: 'bg-purple-100', text: 'text-purple-800', border: 'border-purple-300' },
  Preparer: { bg: 'bg-blue-100', text: 'text-blue-800', border: 'border-blue-300' },
};

export const ROLE_BAR_COLORS: Record<ResourceRole, string> = {
  RI: 'bg-amber-400',
  Reviewer: 'bg-purple-400',
  Preparer: 'bg-blue-400',
};
