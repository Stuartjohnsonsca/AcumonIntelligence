'use client';

import { useState, useEffect } from 'react';

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
  onSelect: (clientId: string, periodId: string, clientName: string, periodLabel: string) => void;
  initialClientId?: string;
  initialPeriodId?: string;
  className?: string;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function ClientPeriodSelect({ onSelect, initialClientId, initialPeriodId, className }: Props) {
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [periods, setPeriods] = useState<PeriodOption[]>([]);
  const [selectedClient, setSelectedClient] = useState(initialClientId || '');
  const [selectedPeriod, setSelectedPeriod] = useState(initialPeriodId || '');
  const [loading, setLoading] = useState(true);

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
        setLoading(false);
      }
    }
    loadClients();
  }, []);

  // Load periods when client changes
  useEffect(() => {
    if (!selectedClient) {
      setPeriods([]);
      return;
    }
    async function loadPeriods() {
      try {
        const res = await fetch(`/api/clients/${selectedClient}/periods`);
        if (res.ok) {
          const data = await res.json();
          setPeriods(data.periods || data || []);
        }
      } catch (err) {
        console.error('Failed to load periods:', err);
      }
    }
    loadPeriods();
  }, [selectedClient]);

  function handleClientChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const clientId = e.target.value;
    setSelectedClient(clientId);
    setSelectedPeriod('');
  }

  function handlePeriodChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const periodId = e.target.value;
    setSelectedPeriod(periodId);
    if (selectedClient && periodId) {
      const client = clients.find(c => c.id === selectedClient);
      const period = periods.find(p => p.id === periodId);
      const periodLabel = period ? `${formatDate(period.startDate)} – ${formatDate(period.endDate)}` : '';
      onSelect(selectedClient, periodId, client?.clientName || '', periodLabel);
    }
  }

  if (loading) {
    return <div className="animate-pulse text-sm text-slate-400">Loading clients...</div>;
  }

  return (
    <div className={`flex items-center gap-4 ${className || ''}`}>
      <div className="flex items-center gap-2">
        <label className="text-sm font-medium text-slate-600">Client:</label>
        <select
          value={selectedClient}
          onChange={handleClientChange}
          className="border border-slate-300 rounded-md px-3 py-1.5 text-sm bg-white min-w-[220px] focus:outline-none focus:ring-2 focus:ring-blue-500"
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
          disabled={!selectedClient || periods.length === 0}
          className="border border-slate-300 rounded-md px-3 py-1.5 text-sm bg-white min-w-[300px] focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
        >
          <option value="">Select period...</option>
          {periods.map(p => (
            <option key={p.id} value={p.id}>
              {formatDate(p.startDate)} – {formatDate(p.endDate)}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
