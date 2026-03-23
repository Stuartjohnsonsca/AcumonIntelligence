'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';

const CATEGORY_OPTIONS = [
  'Fixed Asset',
  'Investment',
  'Current Asset',
  'Current Liability',
  'Long-term Liability',
  'Equity',
  'Revenue',
  'Direct Costs',
  'Overheads',
  'Other Income',
  'Tax Charge',
  'Distribution',
];

interface Props {
  onSave: (account: { accountCode: string; accountName: string; categoryType: string }) => void;
  onCancel: () => void;
}

export function AddAccountCodePopup({ onSave, onCancel }: Props) {
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');

  function handleSave() {
    if (!description.trim() || !category) return;
    // Generate account code from description
    const code = description.trim().substring(0, 4).toUpperCase().replace(/\s+/g, '') + '-' + Date.now().toString(36).slice(-4).toUpperCase();
    onSave({
      accountCode: code,
      accountName: description.trim(),
      categoryType: category,
    });
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30">
      <div className="bg-white rounded-lg shadow-xl w-[400px] p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-slate-800">Add New Account Description</h3>
          <button onClick={onCancel} className="text-slate-400 hover:text-slate-600">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">Description</label>
            <input
              type="text"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Enter account description..."
              className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoFocus
            />
          </div>

          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">Category</label>
            <select
              value={category}
              onChange={e => setCategory(e.target.value)}
              className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Select category...</option>
              {CATEGORY_OPTIONS.map(opt => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <Button size="sm" variant="outline" onClick={onCancel}>Cancel</Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={!description.trim() || !category}
            className="bg-blue-600 hover:bg-blue-700"
          >
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
