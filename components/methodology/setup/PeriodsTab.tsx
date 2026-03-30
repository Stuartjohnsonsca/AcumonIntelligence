'use client';

import { useState, useEffect, useCallback } from 'react';

interface Period {
  id: string;
  startDate: string;
  endDate: string;
}

interface Props {
  clientId: string;
  selectedPeriodId: string;
  onSelect: (periodId: string, periodLabel: string) => void;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function PeriodsTab({ clientId, selectedPeriodId, onSelect }: Props) {
  const [periods, setPeriods] = useState<Period[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const loadPeriods = useCallback(async () => {
    try {
      const res = await fetch(`/api/clients/${clientId}/periods`);
      if (res.ok) {
        const data = await res.json();
        setPeriods(data.periods || data || []);
      }
    } catch (err) {
      console.error('Failed to load periods:', err);
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    setLoading(true);
    loadPeriods();
  }, [loadPeriods]);

  async function handleCreate() {
    if (!startDate || !endDate) return;
    setCreating(true);
    setError('');
    try {
      const res = await fetch(`/api/clients/${clientId}/periods`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startDate, endDate }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to create period');
      }
      setStartDate('');
      setEndDate('');
      setShowAdd(false);
      await loadPeriods();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create');
    } finally {
      setCreating(false);
    }
  }

  function handleSelect(period: Period) {
    const label = `${formatDate(period.startDate)} \u2013 ${formatDate(period.endDate)}`;
    onSelect(period.id, label);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div>
      {/* Period list */}
      <div className="bg-white rounded-lg border border-slate-200">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
          <h3 className="text-sm font-semibold text-slate-800">Periods</h3>
          <button
            onClick={() => setShowAdd(!showAdd)}
            className="text-xs px-3 py-1.5 bg-blue-50 text-blue-600 rounded-md hover:bg-blue-100 font-medium"
          >
            {showAdd ? 'Cancel' : '+ Add New Period'}
          </button>
        </div>

        {/* Add new period form */}
        {showAdd && (
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
            <div className="flex items-end gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Start Date</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={e => setStartDate(e.target.value)}
                  className="border border-slate-300 rounded-md px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">End Date</label>
                <input
                  type="date"
                  value={endDate}
                  onChange={e => setEndDate(e.target.value)}
                  className="border border-slate-300 rounded-md px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <button
                onClick={handleCreate}
                disabled={creating || !startDate || !endDate}
                className="px-4 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm font-medium disabled:opacity-50"
              >
                {creating ? 'Creating...' : 'Create'}
              </button>
            </div>
            {error && <p className="text-xs text-red-500 mt-2">{error}</p>}
          </div>
        )}

        {/* Periods table */}
        {periods.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-slate-400">
            No periods found. Add a new period to get started.
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="text-xs text-slate-500 border-b border-slate-100">
                <th className="text-left px-4 py-2 font-medium">Start Date</th>
                <th className="text-left px-4 py-2 font-medium">End Date</th>
                <th className="text-right px-4 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {periods.map(p => {
                const isSelected = p.id === selectedPeriodId;
                return (
                  <tr
                    key={p.id}
                    onClick={() => handleSelect(p)}
                    className={`border-b border-slate-50 cursor-pointer transition-colors ${
                      isSelected ? 'bg-blue-50 ring-1 ring-inset ring-blue-200' : 'hover:bg-slate-50'
                    }`}
                  >
                    <td className="px-4 py-2.5 text-sm text-slate-700">{formatDate(p.startDate)}</td>
                    <td className="px-4 py-2.5 text-sm text-slate-700">{formatDate(p.endDate)}</td>
                    <td className="px-4 py-2.5 text-right">
                      {isSelected && (
                        <span className="text-xs text-blue-600 font-medium">Selected</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
