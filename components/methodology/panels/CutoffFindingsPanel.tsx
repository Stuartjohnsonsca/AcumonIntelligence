'use client';

import { useState } from 'react';
import { AlertCircle, CheckCircle2 } from 'lucide-react';

interface RedItem {
  index: number;
  date: string;
  description: string;
  amount: number;
  pre_ye_flag: 'red' | 'green';
  accruals_flag: 'red' | 'green' | 'na';
  overall_flag: 'red' | 'orange' | 'green';
  pre_ye_reasoning: string;
  accruals_reasoning: string;
  errorAction?: 'error' | 'in_tb' | null;
  errorScheduleId?: string;
}

interface Props {
  redItems: RedItem[];
  engagementId: string;
  executionId: string;
  fsLine: string;
  onActionChange: (index: number, action: 'error' | 'in_tb') => void;
}

export function CutoffFindingsPanel({ redItems, engagementId, executionId, fsLine, onActionChange }: Props) {
  const [itemStates, setItemStates] = useState<Record<number, 'error' | 'in_tb' | null>>(
    Object.fromEntries(redItems.map(item => [item.index, item.errorAction || null]))
  );

  async function handleAction(item: RedItem, action: 'error' | 'in_tb') {
    const current = itemStates[item.index];
    // If already selected, do nothing (must pick the other to change)
    if (current === action) return;

    setItemStates(prev => ({ ...prev, [item.index]: action }));

    try {
      await fetch(`/api/engagements/${engagementId}/test-execution/${executionId}/cutoff-error`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemIndex: item.index, action, fsLine, item }),
      });
    } catch { /* persist failed — state already updated locally */ }

    onActionChange(item.index, action);
  }

  if (redItems.length === 0) {
    return (
      <div className="text-center py-8 text-slate-400 text-sm">
        <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-green-400" />
        No items flagged — all transactions passed cut-off and accruals checks.
      </div>
    );
  }

  const errorCount = Object.values(itemStates).filter(s => s === 'error').length;
  const inTbCount = Object.values(itemStates).filter(s => s === 'in_tb').length;
  const pendingCount = redItems.length - errorCount - inTbCount;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-800">Findings & Conclusions</h3>
        <div className="flex items-center gap-3 text-xs">
          <span className="text-red-600">{errorCount} Error{errorCount !== 1 ? 's' : ''}</span>
          <span className="text-green-600">{inTbCount} In TB</span>
          {pendingCount > 0 && <span className="text-amber-600">{pendingCount} pending</span>}
        </div>
      </div>

      <div className="border border-slate-200 rounded-lg overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="px-3 py-2 text-left font-medium text-slate-500">Date</th>
              <th className="px-3 py-2 text-left font-medium text-slate-500">Description</th>
              <th className="px-3 py-2 text-right font-medium text-slate-500">Amount</th>
              <th className="px-3 py-2 text-center font-medium text-slate-500">Error</th>
              <th className="px-3 py-2 text-center font-medium text-slate-500">In TB</th>
            </tr>
          </thead>
          <tbody>
            {redItems.map(item => {
              const state = itemStates[item.index];
              return (
                <tr key={item.index} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-3 py-2.5 text-slate-700 whitespace-nowrap">{item.date}</td>
                  <td className="px-3 py-2.5 text-slate-700">{item.description}</td>
                  <td className="px-3 py-2.5 text-right text-slate-700 font-mono whitespace-nowrap">
                    {typeof item.amount === 'number' ? item.amount.toLocaleString('en-GB', { minimumFractionDigits: 2 }) : item.amount}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <button
                      onClick={() => handleAction(item, 'error')}
                      className={`w-7 h-7 rounded-full flex items-center justify-center transition-all ${
                        state === 'error'
                          ? 'bg-red-500 text-white shadow-sm'
                          : state === 'in_tb'
                            ? 'bg-transparent border border-slate-200 text-slate-300'
                            : 'bg-red-100 text-red-500 hover:bg-red-200 border border-red-200'
                      }`}
                      title="Mark as Error — add to Error Schedule"
                    >
                      <AlertCircle className="h-3.5 w-3.5" />
                    </button>
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <button
                      onClick={() => handleAction(item, 'in_tb')}
                      className={`w-7 h-7 rounded-full flex items-center justify-center transition-all ${
                        state === 'in_tb'
                          ? 'bg-green-500 text-white shadow-sm'
                          : state === 'error'
                            ? 'bg-transparent border border-slate-200 text-slate-300'
                            : 'bg-green-100 text-green-500 hover:bg-green-200 border border-green-200'
                      }`}
                      title="Mark as In TB — already recorded in trial balance"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
