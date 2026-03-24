'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { ClientPeriodSelect } from '@/components/shared/ClientPeriodSelect';
import { AgreedDatesPanel } from '@/components/methodology/panels/AgreedDatesPanel';
import { ClientIntelligencePanel } from '@/components/methodology/panels/ClientIntelligencePanel';
import { ClientContactsPanel } from '@/components/methodology/panels/ClientContactsPanel';
import { TeamPanel } from '@/components/methodology/panels/TeamPanel';
import { InfoRequestPanel } from '@/components/methodology/panels/InfoRequestPanel';
import { EngagementTabs } from '@/components/methodology/EngagementTabs';
import { AUDIT_TYPE_LABELS } from '@/types/methodology';
import type { AuditType, InfoRequestType, EngagementStatus } from '@/types/methodology';
import type { EngagementData } from '@/hooks/useEngagement';

interface Props {
  auditType: AuditType;
}

export function AuditEngagementPage({ auditType }: Props) {
  const { data: session } = useSession();
  const [clientId, setClientId] = useState('');
  const [periodId, setPeriodId] = useState('');
  const [clientName, setClientName] = useState('');
  const [periodLabel, setPeriodLabel] = useState('');
  const [engagement, setEngagement] = useState<EngagementData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [startingAudit, setStartingAudit] = useState(false);

  const loadEngagement = useCallback(async (cId: string, pId: string) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/engagements?clientId=${cId}&periodId=${pId}&auditType=${auditType}`);
      if (res.ok) {
        const data = await res.json();
        setEngagement(data.engagement);
      }
    } catch (err) {
      console.error('Failed to load engagement:', err);
    } finally {
      setLoading(false);
    }
  }, [auditType]);

  function handleClientPeriodSelect(cId: string, pId: string, cName: string, pLabel: string) {
    setClientId(cId);
    setPeriodId(pId);
    setClientName(cName);
    setPeriodLabel(pLabel);
    loadEngagement(cId, pId);
  }

  async function createEngagement() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/engagements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, periodId, auditType }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to create engagement');
      }
      const data = await res.json();
      setEngagement(data.engagement);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create');
    } finally {
      setLoading(false);
    }
  }

  async function handleInfoTypeChange(type: InfoRequestType) {
    if (!engagement) return;
    try {
      const res = await fetch(`/api/engagements/${engagement.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ infoRequestType: type }),
      });
      if (res.ok) {
        const data = await res.json();
        setEngagement(data.engagement);
      }
    } catch (err) {
      console.error('Failed to update info type:', err);
    }
  }

  async function handleHardCloseDateChange(date: string | null) {
    if (!engagement) return;
    try {
      const res = await fetch(`/api/engagements/${engagement.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hardCloseDate: date }),
      });
      if (res.ok) {
        const data = await res.json();
        setEngagement(data.engagement);
      }
    } catch (err) {
      console.error('Failed to update hard close date:', err);
    }
  }

  async function startAudit() {
    if (!engagement) return;
    setStartingAudit(true);
    try {
      const res = await fetch(`/api/engagements/${engagement.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'active' }),
      });
      if (res.ok) {
        const data = await res.json();
        setEngagement(data.engagement);
      }
    } catch (err) {
      console.error('Failed to start audit:', err);
    } finally {
      setStartingAudit(false);
    }
  }

  const isActive = engagement?.status !== 'pre_start';
  const periodEndDate = engagement ? (engagement as EngagementData & { period?: { endDate: string } }).period?.endDate || null : null;

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-3">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-slate-800">{AUDIT_TYPE_LABELS[auditType]}</h1>
            {clientName && (
              <p className="text-sm text-slate-500">
                {clientName} · {periodLabel}
                {engagement && (
                  <span className={`ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${
                    engagement.status === 'pre_start' ? 'bg-yellow-100 text-yellow-700' :
                    engagement.status === 'active' ? 'bg-green-100 text-green-700' :
                    engagement.status === 'review' ? 'bg-blue-100 text-blue-700' :
                    engagement.status === 'complete' ? 'bg-slate-100 text-slate-700' :
                    'bg-gray-100 text-gray-500'
                  }`}>
                    {engagement.status.replace('_', ' ').toUpperCase()}
                  </span>
                )}
              </p>
            )}
          </div>

          <ClientPeriodSelect onSelect={handleClientPeriodSelect} />
        </div>
      </div>

      {/* Content */}
      <div className="p-6">
        {/* No selection */}
        {!clientId && (
          <div className="text-center py-20">
            <div className="text-4xl mb-3">📋</div>
            <h2 className="text-lg font-medium text-slate-600">Select a Client and Period to Begin</h2>
            <p className="text-sm text-slate-400 mt-1">Choose a client and period from the selectors above</p>
          </div>
        )}

        {/* Loading */}
        {clientId && loading && (
          <div className="text-center py-20">
            <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-3"></div>
            <p className="text-sm text-slate-500">Loading engagement...</p>
          </div>
        )}

        {/* No engagement - create */}
        {clientId && periodId && !loading && !engagement && (
          <div className="text-center py-20">
            <div className="text-4xl mb-3">🆕</div>
            <h2 className="text-lg font-medium text-slate-600">No {AUDIT_TYPE_LABELS[auditType]} engagement found</h2>
            <p className="text-sm text-slate-400 mt-1 mb-4">
              Create an engagement for {clientName} ({periodLabel})
            </p>
            {error && <p className="text-sm text-red-500 mb-3">{error}</p>}
            <button
              onClick={createEngagement}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
            >
              Create Engagement
            </button>
          </div>
        )}

        {/* Pre-start view */}
        {engagement && !isActive && (
          <div>
            {/* 3-column layout: Dates | Intelligence | Contacts+Team */}
            <div className="grid grid-cols-12 gap-4 mb-6">
              {/* Agreed Dates - far left */}
              <div className="col-span-3">
                <AgreedDatesPanel
                  engagementId={engagement.id}
                  initialDates={engagement.agreedDates}
                />
              </div>

              {/* Client Intelligence - expanded center */}
              <div className="col-span-5">
                <ClientIntelligencePanel
                  engagementId={engagement.id}
                  clientId={clientId}
                  teamMemberCount={engagement.teamMembers.length || 1}
                  currentUserId={session?.user?.id || ''}
                />
              </div>

              {/* Client Contacts + Team - stacked on right */}
              <div className="col-span-4 space-y-4">
                <ClientContactsPanel
                  engagementId={engagement.id}
                  initialContacts={engagement.contacts}
                />
                <TeamPanel
                  engagementId={engagement.id}
                  initialTeamMembers={engagement.teamMembers.map(m => ({
                    id: m.id,
                    userId: m.userId,
                    role: m.role,
                    userName: (m as TeamMemberWithUser).user?.name,
                    userEmail: (m as TeamMemberWithUser).user?.email,
                  }))}
                  initialSpecialists={engagement.specialists}
                />
              </div>
            </div>

            {/* Information Request */}
            <div className="mb-6">
              <InfoRequestPanel
                engagementId={engagement.id}
                initialRequests={engagement.informationRequests}
                infoRequestType={engagement.infoRequestType as InfoRequestType}
                hardCloseDate={engagement.hardCloseDate}
                periodEndDate={periodEndDate}
                onTypeChange={handleInfoTypeChange}
                onHardCloseDateChange={handleHardCloseDateChange}
              />
            </div>

            {/* Start Audit Button */}
            <div className="text-center">
              <button
                onClick={startAudit}
                disabled={startingAudit}
                className="px-12 py-4 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-xl hover:from-blue-700 hover:to-blue-800 text-lg font-semibold shadow-lg hover:shadow-xl transition-all disabled:opacity-50"
              >
                {startingAudit ? 'Starting Audit...' : 'Start Audit'}
              </button>
              <p className="text-xs text-slate-400 mt-2">
                This will notify the client, create the document repository, and open the audit file
              </p>
            </div>
          </div>
        )}

        {/* Active - Tabbed Interface */}
        {engagement && isActive && (
          <EngagementTabs
            engagement={engagement}
            auditType={auditType}
            clientName={clientName}
            periodEndDate={periodEndDate}
            currentUserId={session?.user?.id || ''}
          />
        )}
      </div>
    </div>
  );
}

// Helper type for team member with included user relation
interface TeamMemberWithUser {
  id: string;
  userId: string;
  role: string;
  user?: { id: string; name: string; email: string };
}
