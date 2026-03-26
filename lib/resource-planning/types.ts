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
  resourceRole: 'Preparer' | 'Reviewer' | 'RI';
  concurrentJobLimit: number;
  isRI: boolean;
  weeklyCapacityHrs: number;
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
