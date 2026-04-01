'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { EngagementTabs } from '@/components/methodology/EngagementTabs';
import { AUDIT_TYPE_LABELS } from '@/types/methodology';
import type { AuditType } from '@/types/methodology';
import type { EngagementData } from '@/hooks/useEngagement';

interface ClientOption {
  id: string;
  clientName: string;
}

interface PeriodOption {
  id: string;
  startDate: string;
  endDate: string;
}

interface Props {
  auditType: AuditType;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function AuditEngagementPage({ auditType }: Props) {
  const { data: session } = useSession();

  // Client selection
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [clientsLoading, setClientsLoading] = useState(true);
  const [clientId, setClientId] = useState('');
  const [clientName, setClientName] = useState('');

  // Period selection
  const [periods, setPeriods] = useState<PeriodOption[]>([]);
  const [periodsLoading, setPeriodsLoading] = useState(false);
  const [selectedPeriodId, setSelectedPeriodId] = useState('');
  const [showAddPeriod, setShowAddPeriod] = useState(false);
  const [newStartDate, setNewStartDate] = useState('');
  const [newEndDate, setNewEndDate] = useState('');
  const [creatingPeriod, setCreatingPeriod] = useState(false);

  // Engagement
  const [engagement, setEngagement] = useState<EngagementData | null>(null);
  const [periodLabel, setPeriodLabel] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const isEngagementPhase = !!engagement;

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

  // Load periods when client changes
  const loadPeriods = useCallback(async (cId: string) => {
    setPeriodsLoading(true);
    try {
      const res = await fetch(`/api/clients/${cId}/periods`);
      if (res.ok) {
        const data = await res.json();
        setPeriods(data.periods || data || []);
      }
    } catch (err) {
      console.error('Failed to load periods:', err);
    } finally {
      setPeriodsLoading(false);
    }
  }, []);

  function handleClientChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const id = e.target.value;
    setClientId(id);
    setClientName(clients.find(c => c.id === id)?.clientName || '');
    setSelectedPeriodId('');
    setPeriods([]);
    setEngagement(null);
    setPeriodLabel('');
    setError('');
    setShowAddPeriod(false);
    if (id) loadPeriods(id);
  }

  function handlePeriodChange(e: React.ChangeEvent<HTMLSelectElement>) {
    setSelectedPeriodId(e.target.value);
  }

  async function handleAddPeriod() {
    if (!newStartDate || !newEndDate) return;
    setCreatingPeriod(true);
    setError('');
    try {
      const res = await fetch(`/api/clients/${clientId}/periods`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startDate: newStartDate, endDate: newEndDate }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to create period');
      }
      const data = await res.json();
      const newPeriod = data.period || data;
      setNewStartDate('');
      setNewEndDate('');
      setShowAddPeriod(false);
      await loadPeriods(clientId);
      if (newPeriod?.id) setSelectedPeriodId(newPeriod.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create period');
    } finally {
      setCreatingPeriod(false);
    }
  }

  function handleBackToSetup() {
    setEngagement(null);
    setPeriodLabel('');
    setError('');
  }

  // "Open Audit File" — creates engagement if needed, sets active
  async function handleOpenAuditFile() {
    if (!selectedPeriodId) return;
    const period = periods.find(p => p.id === selectedPeriodId);
    const pLabel = period ? `${formatDate(period.startDate)} \u2013 ${formatDate(period.endDate)}` : '';

    setLoading(true);
    setError('');
    setPeriodLabel(pLabel);
    try {
      // 1. Check if engagement exists
      const checkRes = await fetch(`/api/engagements?clientId=${clientId}&periodId=${selectedPeriodId}&auditType=${auditType}`);
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
          body: JSON.stringify({ clientId, periodId: selectedPeriodId, auditType }),
        });
        if (!createRes.ok) {
          const body = await createRes.json().catch(() => ({}));
          throw new Error(body.error || 'Failed to create engagement');
        }
        const createData = await createRes.json();
        eng = createData.engagement;
      }

      if (!eng) throw new Error('Failed to load engagement');

      // 3. Keep as pre_start — user clicks "Start Audit" on Opening tab to activate

      // 4. Final reload to get complete data
      const finalRes = await fetch(`/api/engagements?clientId=${clientId}&periodId=${selectedPeriodId}&auditType=${auditType}`);
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
                &larr; Back
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
              {clientId && periods.length > 0 && (
                <div className="flex items-center gap-2">
                  <label className="text-sm font-medium text-slate-600">Period:</label>
                  <select
                    value={selectedPeriodId}
                    onChange={handlePeriodChange}
                    className="border border-slate-300 rounded-md px-3 py-1.5 text-sm bg-white min-w-[200px] focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Select period...</option>
                    {periods.map(p => (
                      <option key={p.id} value={p.id}>
                        {formatDate(p.startDate)} &ndash; {formatDate(p.endDate)}
                      </option>
                    ))}
                  </select>
                </div>
              )}
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

        {/* Setup: Period selector + Open Audit File */}
        {clientId && !engagement && !loading && (
          <div className="max-w-xl mx-auto">
            <div className="bg-white rounded-lg border border-slate-200 p-5">
              {/* Period dropdown + Add */}
              <div className="flex items-end gap-3 mb-4">
                <div className="flex-1">
                  <label className="block text-sm font-medium text-slate-600 mb-1">Period</label>
                  <select
                    value={selectedPeriodId}
                    onChange={handlePeriodChange}
                    disabled={periodsLoading || periods.length === 0}
                    className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                  >
                    <option value="">
                      {periodsLoading ? 'Loading...' : periods.length === 0 ? 'No periods — add one' : 'Select period...'}
                    </option>
                    {periods.map(p => (
                      <option key={p.id} value={p.id}>
                        {formatDate(p.startDate)} &ndash; {formatDate(p.endDate)}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  onClick={() => setShowAddPeriod(!showAddPeriod)}
                  className="text-xs px-3 py-2 bg-slate-100 text-slate-600 rounded-md hover:bg-slate-200 font-medium"
                >
                  {showAddPeriod ? 'Cancel' : '+ Add'}
                </button>
              </div>

              {/* Add period form */}
              {showAddPeriod && (
                <div className="mb-4 p-3 bg-slate-50 rounded-lg border border-slate-200">
                  <div className="flex items-end gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Start Date</label>
                      <input
                        type="date"
                        value={newStartDate}
                        onChange={e => setNewStartDate(e.target.value)}
                        className="border border-slate-300 rounded-md px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">End Date</label>
                      <input
                        type="date"
                        value={newEndDate}
                        onChange={e => setNewEndDate(e.target.value)}
                        className="border border-slate-300 rounded-md px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <button
                      onClick={handleAddPeriod}
                      disabled={creatingPeriod || !newStartDate || !newEndDate}
                      className="px-4 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm font-medium disabled:opacity-50"
                    >
                      {creatingPeriod ? 'Creating...' : 'Create'}
                    </button>
                  </div>
                </div>
              )}

              {/* Open Audit File */}
              <button
                onClick={handleOpenAuditFile}
                disabled={!selectedPeriodId}
                className="w-full px-6 py-3 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-lg hover:from-blue-700 hover:to-blue-800 text-sm font-semibold shadow-md hover:shadow-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Open Audit File
              </button>

              {error && <p className="text-xs text-red-500 mt-3">{error}</p>}
            </div>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="text-center py-20">
            <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-3"></div>
            <p className="text-sm text-slate-500">Opening audit file...</p>
          </div>
        )}

        {/* Engagement Tabs */}
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
