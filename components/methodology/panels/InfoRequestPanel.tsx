'use client';

import { useState, useEffect } from 'react';
import type { InfoRequestData } from '@/hooks/useEngagement';
import type { InfoRequestType } from '@/types/methodology';
import { useAutoSave } from '@/hooks/useAutoSave';
import { DEFAULT_INFO_REQUEST_STANDARD, DEFAULT_INFO_REQUEST_PRELIMINARY } from '@/types/methodology';

interface Props {
  engagementId: string;
  initialRequests: InfoRequestData[];
  infoRequestType: InfoRequestType;
  hardCloseDate: string | null;
  periodEndDate: string | null;
  onTypeChange: (type: InfoRequestType) => void;
  onHardCloseDateChange: (date: string | null) => void;
}

export function InfoRequestPanel({
  engagementId,
  initialRequests,
  infoRequestType,
  hardCloseDate,
  periodEndDate,
  onTypeChange,
  onHardCloseDateChange,
}: Props) {
  const [requests, setRequests] = useState<InfoRequestData[]>(initialRequests);
  const [newItem, setNewItem] = useState('');

  useEffect(() => { setRequests(initialRequests); }, [initialRequests]);

  const { saving, lastSaved } = useAutoSave(
    `/api/engagements/${engagementId}/info-requests`,
    { requests },
    { enabled: requests !== initialRequests }
  );

  function toggleIncluded(index: number) {
    setRequests(prev => prev.map((r, i) => i === index ? { ...r, isIncluded: !r.isIncluded } : r));
  }

  function removeItem(index: number) {
    setRequests(prev => prev.filter((_, i) => i !== index));
  }

  function addItem() {
    if (!newItem.trim()) return;
    setRequests(prev => [...prev, {
      id: '',
      description: newItem.trim(),
      isIncluded: true,
      sortOrder: prev.length,
    }]);
    setNewItem('');
  }

  function updateDescription(index: number, value: string) {
    setRequests(prev => prev.map((r, i) => i === index ? { ...r, description: value } : r));
  }

  // Replace placeholder text in descriptions
  function getDisplayText(description: string): string {
    if (description.includes('[Hard Close Date]') && hardCloseDate) {
      return description.replace('[Hard Close Date]', new Date(hardCloseDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }));
    }
    if (description.includes('[Client Period End]') && periodEndDate) {
      return description.replace('[Client Period End]', new Date(periodEndDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }));
    }
    return description;
  }

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-slate-800">Initial Information Request</h3>
        <div className="flex items-center gap-2">
          {saving && <span className="text-xs text-blue-500 animate-pulse">Saving...</span>}
          {lastSaved && !saving && <span className="text-xs text-green-500">Saved</span>}
        </div>
      </div>

      {/* Toggle */}
      <div className="flex items-center gap-3 mb-3">
        <label className="flex items-center gap-1.5 text-xs cursor-pointer">
          <input
            type="radio"
            checked={infoRequestType === 'standard'}
            onChange={() => onTypeChange('standard')}
            className="w-3 h-3"
          />
          <span className={infoRequestType === 'standard' ? 'text-blue-600 font-medium' : 'text-slate-500'}>Standard</span>
        </label>
        <label className="flex items-center gap-1.5 text-xs cursor-pointer">
          <input
            type="radio"
            checked={infoRequestType === 'preliminary'}
            onChange={() => onTypeChange('preliminary')}
            className="w-3 h-3"
          />
          <span className={infoRequestType === 'preliminary' ? 'text-blue-600 font-medium' : 'text-slate-500'}>Preliminary Hard Close</span>
        </label>

        {infoRequestType === 'preliminary' && (
          <div className="flex items-center gap-1.5 ml-4">
            <label className="text-xs text-slate-500">Hard Close Date:</label>
            <input
              type="date"
              value={hardCloseDate?.split('T')[0] || ''}
              onChange={e => onHardCloseDateChange(e.target.value || null)}
              className="border border-slate-200 rounded px-2 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-300"
            />
          </div>
        )}
      </div>

      {/* Item List */}
      <div className="space-y-1 max-h-[250px] overflow-auto mb-2">
        {requests.map((req, i) => (
          <div key={req.id || `new-${i}`} className="flex items-center gap-2 py-0.5 group">
            <input
              type="checkbox"
              checked={req.isIncluded}
              onChange={() => toggleIncluded(i)}
              className="w-3 h-3 rounded"
            />
            <input
              type="text"
              value={req.description}
              onChange={e => updateDescription(i, e.target.value)}
              className={`flex-1 text-xs border-0 bg-transparent focus:outline-none focus:ring-1 focus:ring-blue-300 rounded px-1 py-0.5 ${
                !req.isIncluded ? 'text-slate-300 line-through' : 'text-slate-700'
              }`}
            />
            <span className="text-[10px] text-slate-300 hidden group-hover:inline">
              {getDisplayText(req.description) !== req.description ? getDisplayText(req.description) : ''}
            </span>
            <button
              onClick={() => removeItem(i)}
              className="text-red-400 hover:text-red-600 text-xs opacity-0 group-hover:opacity-100"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      {/* Add New Item */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={newItem}
          onChange={e => setNewItem(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addItem()}
          placeholder="Add new item..."
          className="flex-1 border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-300"
        />
        <button
          onClick={addItem}
          disabled={!newItem.trim()}
          className="text-xs px-2 py-1 bg-blue-50 text-blue-600 rounded hover:bg-blue-100 disabled:opacity-50"
        >
          Add
        </button>
      </div>
    </div>
  );
}
