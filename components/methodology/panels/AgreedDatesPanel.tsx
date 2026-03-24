'use client';

import { useState, useEffect } from 'react';
import type { AgreedDateData } from '@/hooks/useEngagement';
import { useAutoSave } from '@/hooks/useAutoSave';

interface Props {
  engagementId: string;
  initialDates: AgreedDateData[];
}

const PROGRESS_OPTIONS = ['Not Started', 'In Progress', 'Complete', 'Overdue'] as const;

const PROGRESS_COLORS: Record<string, string> = {
  'Not Started': 'bg-gray-100 text-gray-600',
  'In Progress': 'bg-blue-100 text-blue-700',
  'Complete': 'bg-green-100 text-green-700',
  'Overdue': 'bg-red-100 text-red-700',
};

export function AgreedDatesPanel({ engagementId, initialDates }: Props) {
  const [dates, setDates] = useState<AgreedDateData[]>(initialDates);

  useEffect(() => { setDates(initialDates); }, [initialDates]);

  const { saving, lastSaved } = useAutoSave(
    `/api/engagements/${engagementId}/agreed-dates`,
    { dates },
    { enabled: dates !== initialDates }
  );

  function addRow() {
    setDates(prev => [...prev, {
      id: '',
      description: '',
      targetDate: null,
      revisedTarget: null,
      progress: 'Not Started',
      sortOrder: prev.length,
    }]);
  }

  function updateDate(index: number, field: keyof AgreedDateData, value: string | null) {
    setDates(prev => prev.map((d, i) => i === index ? { ...d, [field]: value } : d));
  }

  function removeRow(index: number) {
    setDates(prev => prev.filter((_, i) => i !== index));
  }

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-4 h-full">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-slate-800">Agreed Dates</h3>
        <div className="flex items-center gap-2">
          {saving && <span className="text-xs text-blue-500 animate-pulse">Saving...</span>}
          {lastSaved && !saving && <span className="text-xs text-green-500">Saved</span>}
          <button onClick={addRow} className="text-xs px-2 py-1 bg-blue-50 text-blue-600 rounded hover:bg-blue-100">
            + Add Row
          </button>
        </div>
      </div>

      <div className="overflow-auto max-h-[400px]">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-200">
              <th className="text-left py-1 px-1 text-slate-500 font-medium">Description</th>
              <th className="text-left py-1 px-1 text-slate-500 font-medium w-28">Target</th>
              <th className="text-left py-1 px-1 text-slate-500 font-medium w-28">Revised</th>
              <th className="text-left py-1 px-1 text-slate-500 font-medium w-24">Progress</th>
              <th className="w-6"></th>
            </tr>
          </thead>
          <tbody>
            {dates.map((date, i) => (
              <tr key={date.id || `new-${i}`} className="border-b border-slate-100 hover:bg-slate-50">
                <td className="py-1 px-1">
                  <input
                    type="text"
                    value={date.description}
                    onChange={e => updateDate(i, 'description', e.target.value)}
                    className="w-full border-0 bg-transparent text-xs focus:outline-none focus:ring-1 focus:ring-blue-300 rounded px-1 py-0.5"
                    placeholder="Description..."
                  />
                </td>
                <td className="py-1 px-1">
                  <input
                    type="date"
                    value={date.targetDate?.split('T')[0] || ''}
                    onChange={e => updateDate(i, 'targetDate', e.target.value || null)}
                    className="w-full border-0 bg-transparent text-xs focus:outline-none focus:ring-1 focus:ring-blue-300 rounded px-1 py-0.5"
                  />
                </td>
                <td className="py-1 px-1">
                  <input
                    type="date"
                    value={date.revisedTarget?.split('T')[0] || ''}
                    onChange={e => updateDate(i, 'revisedTarget', e.target.value || null)}
                    className="w-full border-0 bg-transparent text-xs focus:outline-none focus:ring-1 focus:ring-blue-300 rounded px-1 py-0.5"
                  />
                </td>
                <td className="py-1 px-1">
                  <select
                    value={date.progress || 'Not Started'}
                    onChange={e => updateDate(i, 'progress', e.target.value)}
                    className={`w-full border-0 text-xs rounded px-1 py-0.5 ${PROGRESS_COLORS[date.progress || 'Not Started']}`}
                  >
                    {PROGRESS_OPTIONS.map(opt => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                </td>
                <td className="py-1 px-1">
                  <button
                    onClick={() => removeRow(i)}
                    className="text-red-400 hover:text-red-600 text-xs"
                    title="Remove"
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
