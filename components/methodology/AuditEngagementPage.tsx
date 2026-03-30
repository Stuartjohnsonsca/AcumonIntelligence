'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { ClientSetupTabs } from '@/components/methodology/setup/ClientSetupTabs';
import { EngagementTabs } from '@/components/methodology/EngagementTabs';
import { AUDIT_TYPE_LABELS } from '@/types/methodology';
import type { AuditType } from '@/types/methodology';
import type { EngagementData } from '@/hooks/useEngagement';
import type { SetupMember } from '@/components/methodology/setup/SetupTeamTab';

interface ClientOption {
  id: string;
  clientName: string;
}

interface Props {
  auditType: AuditType;
}

export function AuditEngagementPage({ auditType }: Props) {
  const { data: session } = useSession();

  // Client selection
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [clientsLoading, setClientsLoading] = useState(true);
  const [clientId, setClientId] = useState('');
  const [clientName, setClientName] = useState('');

  // Period selection (within setup phase)
  const [selectedPeriodId, setSelectedPeriodId] = useState('');
  const [selectedPeriodLabel, setSelectedPeriodLabel] = useState('');

  // Engagement (phase 2 - audit file open)
  const [engagement, setEngagement] = useState<EngagementData | null>(null);
  const [periodLabel, setPeriodLabel] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Setup team (held in setup phase, applied on engagement creation)
  const [setupTeam, setSetupTeam] = useState<SetupMember[]>([]);

  const isSetupPhase = !!clientId && !engagement;
  const isEngagementPhase = !!clientId && !!engagement;

  // Load clients on mount
  useEffect(() => {
    async function loadClients() {
      try {
        const res = await fetch('/api/clients');
        if (res.ok) {
          const data = await res.json();
          setClients(data.clients || data || []);
        }
      } catch (err) {
        console.error('Failed to load clients:', err);
      } finally {
        setClientsLoading(false);
      }
    }
    loadClients();
  }, []);

  function handleClientChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const id = e.target.value;
    setClientId(id);
    setClientName(clients.find(c => c.id === id)?.clientName || '');
    // Reset downstream
    setSelectedPeriodId('');
    setSelectedPeriodLabel('');
    setEngagement(null);
    setPeriodLabel('');
    setSetupTeam([]);
    setError('');
  }

  function handlePeriodSelect(pId: string, pLabel: string) {
    setSelectedPeriodId(pId);
    setSelectedPeriodLabel(pLabel);
  }

  function handleBackToSetup() {
    setEngagement(null);
    setPeriodLabel('');
    setError('');
  }

  // "Open Audit File" — creates engagement if needed, sets active, applies team
  async function handleOpenAuditFile(pId: string, pLabel: string) {
    setLoading(true);
    setError('');
    setPeriodLabel(pLabel);
    try {
      // 1. Check if engagement exists
      const checkRes = await fetch(`/api/engagements?clientId=${clientId}&periodId=${pId}&auditType=${auditType}`);
      let eng: EngagementData | null = null;
      if (checkRes.ok) {
        const checkData = await checkRes.json();
        eng = checkData.engagement || null;
      }

      // 2. Create if it doesn't exist
      if (!eng) {
        const createRes = await fetch('/api/engagements', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clientId, periodId: pId, auditType }),
        });
        if (!createRes.ok) {
          const body = await createRes.json().catch(() => ({}));
          throw new Error(body.error || 'Failed to create engagement');
        }
        const createData = await createRes.json();
        eng = createData.engagement;
      }

      if (!eng) throw new Error('Failed to load engagement');

      // 3. Apply setup team if configured
      if (setupTeam.length > 0) {
        const teamMembers = setupTeam
          .filter(m => m.role !== 'Specialist')
          .map(m => ({ userId: m.userId, role: m.role }));
        const specialists = setupTeam
          .filter(m => m.role === 'Specialist')
          .map(m => ({
            name: m.userName,
            email: m.userEmail,
            specialistType: m.specialistType || 'Specialist',
            firmName: '',
          }));
        try {
          await fetch(`/api/engagements/${eng.id}/team`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ teamMembers, specialists }),
          });
        } catch (err) {
          console.error('Failed to apply setup team:', err);
        }
      }

      // 4. Set to active if still pre_start
      if (eng.status === 'pre_start') {
        const activateRes = await fetch(`/api/engagements/${eng.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'active' }),
        });
        if (activateRes.ok) {
          const activateData = await activateRes.json();
          eng = activateData.engagement;
        }
      }

      // 5. Final reload to get complete data with team
      const finalRes = await fetch(`/api/engagements?clientId=${clientId}&periodId=${pId}&auditType=${auditType}`);
      if (finalRes.ok) {
        const finalData = await finalRes.json();
        eng = finalData.engagement || eng;
      }

      setEngagement(eng);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open audit file');
    } finally {
      setLoading(false);
    }
  }

  const engPeriod = (engagement as EngagementData & { period?: { startDate: string; endDate: string } })?.period;
  const periodEndDate = engPeriod?.endDate || null;
  const periodStartDate = engPeriod?.startDate || null;

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-3">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-slate-800">{AUDIT_TYPE_LABELS[auditType]}</h1>
            {clientName && (
              <p className="text-sm text-slate-500">
                {clientName}
                {periodLabel && <> &middot; {periodLabel}</>}
                {engagement && (
                  <span className={`ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${
                    engagement.status === 'active' ? 'bg-green-100 text-green-700' :
                    engagement.status === 'review' ? 'bg-blue-100 text-blue-700' :
                    engagement.status === 'complete' ? 'bg-slate-100 text-slate-700' :
                    'bg-yellow-100 text-yellow-700'
                  }`}>
                    {engagement.status.replace('_', ' ').toUpperCase()}
                  </span>
                )}
              </p>
            )}
          </div>

          <div className="flex items-center gap-3">
            {isEngagementPhase && (
              <button
                onClick={handleBackToSetup}
                className="text-xs px-3 py-1.5 bg-slate-100 text-slate-600 rounded-md hover:bg-slate-200 font-medium"
              >
                &larr; Back to Setup
              </button>
            )}

            {clientsLoading ? (
              <div className="animate-pulse text-sm text-slate-400">Loading clients...</div>
            ) : (
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-slate-600">Client:</label>
                <select
                  value={clientId}
                  onChange={handleClientChange}
                  className="border border-slate-300 rounded-md px-3 py-1.5 text-sm bg-white min-w-[220px] focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select client...</option>
                  {clients.map(c => (
                    <option key={c.id} value={c.id}>{c.clientName}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-6">
        {/* No selection */}
        {!clientId && (
          <div className="text-center py-20">
            <div className="text-4xl mb-3">📋</div>
            <h2 className="text-lg font-medium text-slate-600">Select a Client to Begin</h2>
            <p className="text-sm text-slate-400 mt-1">Choose a client from the selector above</p>
          </div>
        )}

        {/* Phase 1: Client Setup with Period/Team/Connection tabs */}
        {isSetupPhase && !loading && (
          <ClientSetupTabs
            clientId={clientId}
            clientName={clientName}
            auditType={auditType}
            setupTeam={setupTeam}
            onSetupTeamChange={setSetupTeam}
            onProceed={handleOpenAuditFile}
            selectedPeriodId={selectedPeriodId}
            selectedPeriodLabel={selectedPeriodLabel}
            onPeriodSelect={handlePeriodSelect}
            starting={loading}
          />
        )}

        {/* Loading */}
        {loading && (
          <div className="text-center py-20">
            <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-3"></div>
            <p className="text-sm text-slate-500">Opening audit file...</p>
          </div>
        )}

        {/* Error */}
        {error && !loading && (
          <div className="text-center py-8">
            <p className="text-sm text-red-500">{error}</p>
          </div>
        )}

        {/* Phase 2: Engagement Tabs (opens on "opening" tab) */}
        {isEngagementPhase && (
          <EngagementTabs
            engagement={engagement}
            auditType={auditType}
            clientName={clientName}
            periodEndDate={periodEndDate}
            periodStartDate={periodStartDate}
            currentUserId={session?.user?.id || ''}
          />
        )}
      </div>
    </div>
  );
}
