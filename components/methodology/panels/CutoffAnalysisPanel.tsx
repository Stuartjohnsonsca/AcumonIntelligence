'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, AlertTriangle, CheckCircle2 } from 'lucide-react';

interface AnalysisItem {
  index: number;
  date: string;
  description: string;
  amount: number;
  reference?: string;
  counterparty?: string;
  pre_ye_flag: 'red' | 'green';
  pre_ye_reasoning: string;
  accruals_flag: 'red' | 'green' | 'na';
  accruals_reasoning: string;
  // Cut-off verification additional fields
  spread_flag?: 'green' | 'orange' | 'na';
  spread_reasoning?: string;
  match_confidence?: 'high' | 'medium' | 'low' | 'no_match';
  match_reasoning?: string;
  apportion_pre_ye_amount?: number | null;
  apportion_post_ye_amount?: number | null;
  apportion_total_days?: number | null;
  apportion_pre_days?: number | null;
  apportion_post_days?: number | null;
  apportion_agrees_to_sample?: boolean | null;
  overall_flag: 'red' | 'orange' | 'green';
  flaggedBy: 'ai' | 'user';
  overrideTimestamp?: string;
  overrideUserName?: string;
}

interface Props {
  analysisResults: AnalysisItem[];
  periodEnd: string;
  engagementId: string;
  executionId: string;
  onOverride: (index: number, field: 'pre_ye_flag' | 'accruals_flag' | 'spread_flag', newFlag: 'red' | 'green' | 'orange') => void;
}

export function CutoffAnalysisPanel({ analysisResults, periodEnd, engagementId, executionId, onOverride }: Props) {
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());

  function toggleExpand(index: number) {
    setExpandedRows(prev => {
      const next = new Set(prev);
      next.has(index) ? next.delete(index) : next.add(index);
      return next;
    });
  }

  function handleFlagClick(item: AnalysisItem, field: 'pre_ye_flag' | 'accruals_flag') {
    const current = item[field];
    if (current === 'na') return;
    const newFlag = current === 'red' ? 'green' : 'red';
    // Call API to persist override
    fetch(`/api/engagements/${engagementId}/test-execution/${executionId}/cutoff-override`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemIndex: item.index, field, newFlag }),
    }).catch(() => {});
    onOverride(item.index, field, newFlag);
  }

  function FlagDot({ flag, onClick, label }: { flag: 'red' | 'green' | 'orange' | 'na' | undefined; onClick?: () => void; label: string }) {
    if (flag === 'na' || flag === undefined) return <span className="text-[9px] text-slate-300">N/A</span>;
    const colors = flag === 'red' ? 'bg-red-500' : flag === 'orange' ? 'bg-orange-400' : 'bg-green-500';
    const ringColor = flag === 'red' ? 'group-hover:ring-red-300' : flag === 'orange' ? 'group-hover:ring-orange-300' : 'group-hover:ring-green-300';
    const title = flag === 'red' ? 'Flagged' : flag === 'orange' ? 'Spread — needs apportionment' : 'Passed';
    return (
      <button onClick={onClick} className="flex items-center gap-1 group" title={`${label}: ${title} — click to override`}>
        <div className={`w-4 h-4 rounded-full flex items-center justify-center transition-colors ${colors} group-hover:ring-2 group-hover:ring-offset-1 ${ringColor}`}>
          {flag === 'red' ? <AlertTriangle className="h-2.5 w-2.5 text-white" /> : flag === 'orange' ? <span className="text-[8px] text-white font-bold">~</span> : <CheckCircle2 className="h-2.5 w-2.5 text-white" />}
        </div>
      </button>
    );
  }

  const hasSpreadColumn = analysisResults.some(r => r.spread_flag !== undefined);
  const redCount = analysisResults.filter(r => r.overall_flag === 'red').length;
  const orangeCount = analysisResults.filter(r => r.overall_flag === 'orange').length;
  const greenCount = analysisResults.filter(r => r.overall_flag === 'green').length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-slate-800">AI Cut-Off & Accruals Analysis</h3>
          <span className="text-[10px] text-slate-400">Period end: {periodEnd}</span>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded-full bg-red-500" /> {redCount} flagged</span>
          {orangeCount > 0 && <span className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded-full bg-orange-400" /> {orangeCount} spread</span>}
          <span className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded-full bg-green-500" /> {greenCount} passed</span>
        </div>
      </div>

      <div className="border border-slate-200 rounded-lg overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="px-2 py-2 text-left font-medium text-slate-500 w-8" />
              <th className="px-2 py-2 text-left font-medium text-slate-500">Date</th>
              <th className="px-2 py-2 text-left font-medium text-slate-500">Description</th>
              <th className="px-2 py-2 text-right font-medium text-slate-500">Amount</th>
              <th className="px-2 py-2 text-center font-medium text-slate-500">Pre-YE</th>
              {hasSpreadColumn ? (
                <th className="px-2 py-2 text-center font-medium text-slate-500">Spread</th>
              ) : (
                <th className="px-2 py-2 text-center font-medium text-slate-500">Accruals</th>
              )}
              <th className="px-2 py-2 text-center font-medium text-slate-500">Overall</th>
              <th className="px-2 py-2 text-center font-medium text-slate-500">Source</th>
            </tr>
          </thead>
          <tbody>
            {analysisResults.map(item => (
              <>
                <tr
                  key={item.index}
                  className={`border-b border-slate-100 hover:bg-slate-50 cursor-pointer ${
                    item.overall_flag === 'red' ? 'bg-red-50/50' : ''
                  }`}
                  onClick={() => toggleExpand(item.index)}
                >
                  <td className="px-2 py-2 text-slate-400">
                    {expandedRows.has(item.index) ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  </td>
                  <td className="px-2 py-2 text-slate-700 whitespace-nowrap">{item.date}</td>
                  <td className="px-2 py-2 text-slate-700 max-w-[250px] truncate">{item.description}</td>
                  <td className="px-2 py-2 text-right text-slate-700 font-mono whitespace-nowrap">
                    {typeof item.amount === 'number' ? item.amount.toLocaleString('en-GB', { minimumFractionDigits: 2 }) : item.amount}
                  </td>
                  <td className="px-2 py-2 text-center" onClick={e => { e.stopPropagation(); handleFlagClick(item, 'pre_ye_flag'); }}>
                    <FlagDot flag={item.pre_ye_flag} label="Pre-Year-End" />
                  </td>
                  <td className="px-2 py-2 text-center" onClick={e => { e.stopPropagation(); handleFlagClick(item, hasSpreadColumn ? 'spread_flag' as any : 'accruals_flag'); }}>
                    <FlagDot flag={hasSpreadColumn ? (item.spread_flag || 'na') : item.accruals_flag} label={hasSpreadColumn ? 'Spread' : 'Accruals'} />
                  </td>
                  <td className="px-2 py-2 text-center">
                    <FlagDot flag={item.overall_flag} label="Overall" />
                  </td>
                  <td className="px-2 py-2 text-center">
                    <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${
                      item.flaggedBy === 'user' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'
                    }`}>
                      {item.flaggedBy === 'user' ? 'User' : 'AI'}
                    </span>
                  </td>
                </tr>
                {expandedRows.has(item.index) && (
                  <tr key={`${item.index}-detail`} className="bg-slate-50/70">
                    <td colSpan={8} className="px-4 py-3">
                      <div className="space-y-2 text-[11px]">
                        {item.match_confidence && (
                          <div>
                            <span className="font-medium text-slate-600">Document Match: </span>
                            <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${item.match_confidence === 'high' ? 'bg-green-100 text-green-700' : item.match_confidence === 'medium' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>{item.match_confidence}</span>
                            {item.match_reasoning && <span className="text-slate-500 ml-1">{item.match_reasoning}</span>}
                          </div>
                        )}
                        <div>
                          <span className="font-medium text-slate-600">Pre-Year-End Assessment: </span>
                          <span className="text-slate-500">{item.pre_ye_reasoning}</span>
                        </div>
                        {item.spread_flag && item.spread_flag !== 'na' && (
                          <div>
                            <span className="font-medium text-slate-600">Spread Assessment: </span>
                            <span className="text-slate-500">{item.spread_reasoning}</span>
                          </div>
                        )}
                        {item.accruals_flag !== 'na' && !hasSpreadColumn && (
                          <div>
                            <span className="font-medium text-slate-600">Accruals Assessment: </span>
                            <span className="text-slate-500">{item.accruals_reasoning}</span>
                          </div>
                        )}
                        {item.apportion_total_days != null && (
                          <div className="bg-orange-50 border border-orange-200 rounded p-2 mt-1">
                            <span className="font-medium text-orange-700 text-[10px]">Time Apportionment:</span>
                            <div className="grid grid-cols-3 gap-2 mt-1 text-[10px]">
                              <div><span className="text-slate-500">Total period:</span> <span className="font-mono">{item.apportion_total_days} days</span></div>
                              <div><span className="text-slate-500">Pre-YE:</span> <span className="font-mono">{item.apportion_pre_days} days</span></div>
                              <div><span className="text-slate-500">Post-YE:</span> <span className="font-mono">{item.apportion_post_days} days</span></div>
                              <div><span className="text-slate-500">Pre-YE amount:</span> <span className="font-mono">{item.apportion_pre_ye_amount?.toLocaleString('en-GB', { minimumFractionDigits: 2 }) || '—'}</span></div>
                              <div><span className="text-slate-500">Post-YE amount:</span> <span className="font-mono">{item.apportion_post_ye_amount?.toLocaleString('en-GB', { minimumFractionDigits: 2 }) || '—'}</span></div>
                              <div><span className="text-slate-500">Agrees to sample:</span> <span className={`font-medium ${item.apportion_agrees_to_sample ? 'text-green-600' : 'text-red-600'}`}>{item.apportion_agrees_to_sample ? 'Yes' : 'No'}</span></div>
                            </div>
                          </div>
                        )}
                        {item.flaggedBy === 'user' && item.overrideTimestamp && (
                          <div className="text-blue-600">
                            Overridden by {item.overrideUserName || 'User'} at {new Date(item.overrideTimestamp).toLocaleString()}
                          </div>
                        )}
                        {item.reference && <div><span className="font-medium text-slate-600">Reference: </span>{item.reference}</div>}
                        {item.counterparty && <div><span className="font-medium text-slate-600">Counterparty: </span>{item.counterparty}</div>}
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
