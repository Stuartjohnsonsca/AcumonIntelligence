'use client';

import { createContext, useContext, useState, useCallback } from 'react';
import type { AuditType, EngagementStatus, TeamRole, SpecialistType, ProgressStatus, InfoRequestType } from '@/types/methodology';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface EngagementData {
  id: string;
  clientId: string;
  periodId: string;
  firmId: string;
  auditType: AuditType;
  status: EngagementStatus;
  infoRequestType: InfoRequestType;
  hardCloseDate: string | null;
  isGroupAudit: boolean;
  isNewClient?: boolean | null;
  /** True iff Client.isListed === true. Drives Listed-status schedule visibility. */
  clientIsListed?: boolean;
  /** True iff this engagement has a priorPeriodEngagementId set. Drives prior-period schedule visibility. */
  hasPriorPeriodEngagement?: boolean;
  startedAt: string | null;
  createdAt: string;
  teamMembers: TeamMemberData[];
  specialists: SpecialistData[];
  contacts: ContactData[];
  agreedDates: AgreedDateData[];
  informationRequests: InfoRequestData[];
}

export interface TeamMemberData {
  id: string;
  userId: string;
  role: TeamRole;
  userName?: string;
  userEmail?: string;
}

export interface SpecialistData {
  id: string;
  name: string;
  email?: string;
  specialistType: SpecialistType;
  firmName?: string;
}

export interface ContactData {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  /** Optional job title / role description for the contact */
  role?: string;
  isMainContact: boolean;
  portalAccess?: boolean;
}

export interface AgreedDateData {
  id: string;
  description: string;
  targetDate: string | null;
  revisedTarget: string | null;
  progress: ProgressStatus | null;
  sortOrder: number;
}

export interface InfoRequestData {
  id: string;
  description: string;
  isIncluded: boolean;
  sortOrder: number;
}

// ─── Context ─────────────────────────────────────────────────────────────────

interface EngagementContextValue {
  engagement: EngagementData | null;
  loading: boolean;
  error: string | null;
  setEngagement: (data: EngagementData) => void;
  refreshEngagement: () => Promise<void>;
}

export const EngagementContext = createContext<EngagementContextValue>({
  engagement: null,
  loading: false,
  error: null,
  setEngagement: () => {},
  refreshEngagement: async () => {},
});

export function useEngagement() {
  return useContext(EngagementContext);
}

// ─── Hook for loading engagement ─────────────────────────────────────────────

export function useEngagementLoader(engagementId: string | null) {
  const [engagement, setEngagement] = useState<EngagementData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshEngagement = useCallback(async () => {
    if (!engagementId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/engagements/${engagementId}`);
      if (!res.ok) throw new Error('Failed to load engagement');
      const data = await res.json();
      setEngagement(data.engagement);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [engagementId]);

  return { engagement, loading, error, setEngagement, refreshEngagement };
}
