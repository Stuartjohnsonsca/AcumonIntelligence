'use client';

import { useState, useCallback } from 'react';
import { useBankToTB } from './BankToTBContext';

interface Props {
  clients: {
    id: string;
    clientName: string;
    periods: { id: string; startDate: string; endDate: string }[];
  }[];
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function ClientPeriodSelector({ clients }: Props) {
  const { state, dispatch } = useBankToTB();
  const [selectedClient, setSelectedClient] = useState(state.clientId || '');
  const [selectedPeriod, setSelectedPeriod] = useState(state.periodId || '');
  const [loading, setLoading] = useState(false);

  const selectedClientData = clients.find(c => c.id === selectedClient);

  const loadSession = useCallback(async (clientId: string, periodId: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/bank-to-tb/session?clientId=${clientId}&periodId=${periodId}`);
      if (!res.ok) throw new Error('Failed to load session');
      const data = await res.json();
      const s = data.session;

      dispatch({
        type: 'SET_SESSION',
        payload: {
          sessionId: s.id,
          clientId: s.clientId,
          periodId: s.periodId,
          files: s.files || [],
          accounts: s.accounts || [],
          transactions: (s.transactions || []).map((t: Record<string, unknown>) => ({
            ...t,
            date: typeof t.date === 'string' ? t.date : new Date(t.date as string).toISOString(),
          })),
          trialBalance: s.trialBalance || [],
          journals: s.journals || [],
          combineMode: s.combineMode || null,
          openingPositionSource: s.openingPositionSource || null,
          hasMultipleAccounts: (s.accounts || []).length > 1,
          hasOutOfPeriodTxns: (s.transactions || []).some((t: { inPeriod: boolean }) => !t.inPeriod),
        },
      });
    } catch (err) {
      console.error('Failed to load session:', err);
    } finally {
      setLoading(false);
    }
  }, [dispatch]);

  function handleClientChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const clientId = e.target.value;
    setSelectedClient(clientId);
    setSelectedPeriod('');
    dispatch({ type: 'RESET' });
  }

  function handlePeriodChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const periodId = e.target.value;
    setSelectedPeriod(periodId);
    if (selectedClient && periodId) {
      loadSession(selectedClient, periodId);
    }
  }

  return (
    <div className="px-4 py-3 flex items-center gap-4">
      <div className="flex items-center gap-2">
        <label className="text-sm font-medium text-slate-600">Client:</label>
        <select
          value={selectedClient}
          onChange={handleClientChange}
          className="border border-slate-300 rounded-md px-3 py-1.5 text-sm bg-white min-w-[200px] focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">Select client...</option>
          {clients.map(c => (
            <option key={c.id} value={c.id}>{c.clientName}</option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-2">
        <label className="text-sm font-medium text-slate-600">Period:</label>
        <select
          value={selectedPeriod}
          onChange={handlePeriodChange}
          disabled={!selectedClient || !selectedClientData?.periods.length}
          className="border border-slate-300 rounded-md px-3 py-1.5 text-sm bg-white min-w-[280px] focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
        >
          <option value="">Select period...</option>
          {selectedClientData?.periods.map(p => (
            <option key={p.id} value={p.id}>
              {formatDate(p.startDate)} - {formatDate(p.endDate)}
            </option>
          ))}
        </select>
      </div>

      {loading && (
        <span className="text-sm text-blue-600 animate-pulse">Loading session...</span>
      )}
    </div>
  );
}
