'use client';

import { useState } from 'react';
import { CheckCircle2, XCircle, AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

// ─── Types ───
interface ItemDetail {
  itemId: string;
  bookValue: number;
  auditedValue: number | null;  // AI-extracted value
  aiExtractedValue: number | null;
  aiExtractedDate: string | null;
  aiSourceDocument: string | null;
  aiComparisonSteps: string[];
  aiConfidence: number | null;  // 0-1
  overrideAuditedValue: number | null;
  overrideReason: string;
  errorClassification: string | null;
  isClearlyTrivial: boolean | null;
  wpReference: string;
  auditorNotes: string;
  testResult: 'no_exception' | 'exception' | 'not_testable' | null;
}

interface Props {
  detail: ItemDetail;
  clearlyTrivialThreshold: number;
  onChange: (updated: Partial<ItemDetail>) => void;
}

const ERROR_CLASSIFICATIONS = [
  { value: 'factual', label: 'Factual Error', description: 'A misstatement about which there is no doubt — a clear, objective difference', color: 'text-red-700 bg-red-50 border-red-200' },
  { value: 'judgemental', label: 'Judgemental', description: 'Differences from management estimates the auditor considers unreasonable', color: 'text-amber-700 bg-amber-50 border-amber-200' },
  { value: 'projected', label: 'Projected', description: 'Best estimate of misstatements in populations, extrapolated from sample errors', color: 'text-orange-700 bg-orange-50 border-orange-200' },
  { value: 'timing', label: 'Timing Difference', description: 'Transaction recorded in wrong period — cut-off error', color: 'text-blue-700 bg-blue-50 border-blue-200' },
  { value: 'reclassification', label: 'Reclassification', description: 'Amounts classified in wrong account or line item — no net effect on profit', color: 'text-purple-700 bg-purple-50 border-purple-200' },
];

function fmt(n: number | null | undefined): string {
  if (n == null) return '—';
  const abs = Math.abs(n);
  const formatted = abs.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `(${formatted})` : formatted;
}

export function ItemErrorDetailPanel({ detail, clearlyTrivialThreshold, onChange }: Props) {
  const [isOverriding, setIsOverriding] = useState(detail.overrideAuditedValue != null);
  const [showAiSteps, setShowAiSteps] = useState(false);

  // Effective audited value — override takes precedence
  const effectiveAudited = isOverriding && detail.overrideAuditedValue != null
    ? detail.overrideAuditedValue
    : detail.auditedValue;

  const difference = effectiveAudited != null ? detail.bookValue - effectiveAudited : null;
  const absDifference = difference != null ? Math.abs(difference) : null;
  const belowCT = absDifference != null && absDifference <= clearlyTrivialThreshold;

  // Auto-suggest classification based on difference
  const suggestedClassification = detail.errorClassification || (
    absDifference === 0 || absDifference == null ? null :
    belowCT ? null : 'factual'
  );

  return (
    <div className="border rounded-lg bg-white overflow-hidden">
      <div className="grid grid-cols-2 divide-x divide-slate-200">
        {/* LEFT: AI Working */}
        <div className="p-3 space-y-3">
          <div className="text-[10px] font-bold text-blue-700 uppercase tracking-wider">AI Working</div>

          {/* Extraction source */}
          {detail.aiSourceDocument && (
            <div className="text-xs text-slate-600">
              Extracted from: <span className="font-medium text-slate-800">{detail.aiSourceDocument}</span>
              {detail.aiConfidence != null && (
                <span className={`ml-2 text-[9px] px-1.5 py-0.5 rounded-full font-medium ${
                  detail.aiConfidence >= 0.9 ? 'bg-green-100 text-green-700' :
                  detail.aiConfidence >= 0.7 ? 'bg-amber-100 text-amber-700' :
                  'bg-red-100 text-red-700'
                }`}>
                  {Math.round(detail.aiConfidence * 100)}% confidence
                </span>
              )}
            </div>
          )}

          {/* Comparison table */}
          <div className="border rounded overflow-hidden">
            <table className="w-full text-xs">
              <tbody>
                <tr className="border-b bg-slate-50">
                  <td className="px-3 py-1.5 text-slate-500 font-medium">Book Value</td>
                  <td className="px-3 py-1.5 text-right font-mono text-slate-800 font-semibold">£{fmt(detail.bookValue)}</td>
                </tr>
                <tr className="border-b">
                  <td className="px-3 py-1.5 text-slate-500 font-medium">AI Extracted Value</td>
                  <td className="px-3 py-1.5 text-right font-mono text-slate-800">£{fmt(detail.aiExtractedValue)}</td>
                </tr>
                {detail.aiExtractedDate && (
                  <tr className="border-b">
                    <td className="px-3 py-1.5 text-slate-500 font-medium">AI Extracted Date</td>
                    <td className="px-3 py-1.5 text-right text-slate-800">{detail.aiExtractedDate}</td>
                  </tr>
                )}
                <tr className={difference != null && difference !== 0 ? 'bg-red-50' : 'bg-green-50'}>
                  <td className="px-3 py-1.5 font-semibold text-slate-700">Difference</td>
                  <td className={`px-3 py-1.5 text-right font-mono font-bold ${
                    difference == null ? 'text-slate-400' :
                    difference === 0 ? 'text-green-600' : 'text-red-600'
                  }`}>
                    {difference == null ? '—' : difference === 0 ? 'Nil' : `£${fmt(difference)}`}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* AI comparison steps */}
          {detail.aiComparisonSteps.length > 0 && (
            <div>
              <button onClick={() => setShowAiSteps(!showAiSteps)} className="flex items-center gap-1 text-[10px] font-medium text-blue-600 hover:text-blue-800">
                {showAiSteps ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                AI Comparison Steps ({detail.aiComparisonSteps.length})
              </button>
              {showAiSteps && (
                <ol className="mt-1.5 space-y-1 text-[11px] text-slate-600 list-decimal list-inside pl-1">
                  {detail.aiComparisonSteps.map((step, i) => (
                    <li key={i}>{step}</li>
                  ))}
                </ol>
              )}
            </div>
          )}

          {/* CT check */}
          {absDifference != null && absDifference > 0 && (
            <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium ${
              belowCT ? 'bg-slate-100 text-slate-500' : 'bg-red-50 text-red-700'
            }`}>
              {belowCT ? (
                <><CheckCircle2 className="h-3.5 w-3.5 text-slate-400" /> Below Clearly Trivial (£{fmt(clearlyTrivialThreshold)})</>
              ) : (
                <><AlertTriangle className="h-3.5 w-3.5 text-red-500" /> Above Clearly Trivial (£{fmt(clearlyTrivialThreshold)})</>
              )}
            </div>
          )}
        </div>

        {/* RIGHT: Error Assessment */}
        <div className="p-3 space-y-3">
          <div className="text-[10px] font-bold text-amber-700 uppercase tracking-wider">Error Assessment</div>

          {/* Accept / Override toggle */}
          <div className="flex gap-2">
            <button
              onClick={() => { setIsOverriding(false); onChange({ overrideAuditedValue: null, overrideReason: '' }); }}
              className={`flex-1 text-xs py-1.5 rounded-md border font-medium transition-colors ${
                !isOverriding ? 'bg-green-100 border-green-300 text-green-700' : 'bg-white border-slate-200 text-slate-400 hover:bg-slate-50'
              }`}
            >
              Accept AI
            </button>
            <button
              onClick={() => setIsOverriding(true)}
              className={`flex-1 text-xs py-1.5 rounded-md border font-medium transition-colors ${
                isOverriding ? 'bg-amber-100 border-amber-300 text-amber-700' : 'bg-white border-slate-200 text-slate-400 hover:bg-slate-50'
              }`}
            >
              Override
            </button>
          </div>

          {/* Override fields */}
          {isOverriding && (
            <div className="space-y-2 p-2 bg-amber-50 rounded-lg border border-amber-200">
              <div>
                <label className="text-[10px] font-semibold text-slate-500 uppercase">Audited Value</label>
                <div className="flex items-center gap-1 mt-0.5">
                  <span className="text-xs text-slate-400">£</span>
                  <input
                    type="number"
                    step="0.01"
                    value={detail.overrideAuditedValue ?? ''}
                    onChange={e => onChange({ overrideAuditedValue: e.target.value ? parseFloat(e.target.value) : null })}
                    className="flex-1 text-sm border rounded px-2 py-1.5 font-mono"
                    placeholder="Enter audited value"
                  />
                </div>
              </div>
              <div>
                <label className="text-[10px] font-semibold text-slate-500 uppercase">Reason for Override</label>
                <input
                  value={detail.overrideReason || ''}
                  onChange={e => onChange({ overrideReason: e.target.value })}
                  className="w-full text-xs border rounded px-2 py-1.5 mt-0.5"
                  placeholder="Required — why are you overriding the AI value?"
                />
              </div>
            </div>
          )}

          {/* Error Classification */}
          {absDifference != null && absDifference > 0 && !belowCT && (
            <div>
              <label className="text-[10px] font-semibold text-slate-500 uppercase mb-1 block">Error Classification (ISA 450)</label>
              <div className="space-y-1">
                {ERROR_CLASSIFICATIONS.map(c => (
                  <label
                    key={c.value}
                    className={`flex items-start gap-2 px-2 py-1.5 rounded border cursor-pointer transition-colors ${
                      detail.errorClassification === c.value ? c.color + ' border-2' : 'bg-white border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <input
                      type="radio"
                      name={`classification-${detail.itemId}`}
                      checked={detail.errorClassification === c.value}
                      onChange={() => onChange({ errorClassification: c.value })}
                      className="mt-0.5"
                    />
                    <div>
                      <span className="text-xs font-medium">{c.label}</span>
                      {suggestedClassification === c.value && detail.errorClassification !== c.value && (
                        <span className="text-[8px] ml-1 text-purple-500">(AI suggested)</span>
                      )}
                      <p className="text-[10px] text-slate-400 leading-tight">{c.description}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Test Result */}
          <div>
            <label className="text-[10px] font-semibold text-slate-500 uppercase">Test Result</label>
            <select
              value={detail.testResult || ''}
              onChange={e => onChange({ testResult: e.target.value as any || null })}
              className="w-full text-xs border rounded px-2 py-1.5 mt-0.5 bg-white"
            >
              <option value="">Select...</option>
              <option value="no_exception">No Exception</option>
              <option value="exception">Exception</option>
              <option value="not_testable">Not Testable</option>
            </select>
          </div>

          {/* WP Reference + Notes */}
          <div>
            <label className="text-[10px] font-semibold text-slate-500 uppercase">WP Reference</label>
            <input
              value={detail.wpReference || ''}
              onChange={e => onChange({ wpReference: e.target.value })}
              className="w-full text-xs border rounded px-2 py-1.5 mt-0.5 font-mono"
              placeholder="e.g. WP-TD-001"
            />
          </div>
          <div>
            <label className="text-[10px] font-semibold text-slate-500 uppercase">Auditor Notes</label>
            <textarea
              value={detail.auditorNotes || ''}
              onChange={e => onChange({ auditorNotes: e.target.value })}
              className="w-full text-xs border rounded px-2 py-1.5 mt-0.5"
              rows={3}
              placeholder="Notes on this item's verification..."
            />
          </div>
        </div>
      </div>
    </div>
  );
}
