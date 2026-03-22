'use client';

import { useState } from 'react';
import { Sparkles, Loader2, Check, X } from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ColumnMapping {
  transactionId: string;
  date: string;
  amount: string;
  description: string;
  preparer?: string;
  timestamp?: string;
  manualAutoFlag?: string;
  overrideFlag?: string;
  exceptionFlag?: string;
  vendorCustomer?: string;
  glCode?: string;
  sourceSystem?: string;
}

export interface AISuggestion {
  features: { name: string; column: string; type: 'numeric' | 'categorical' | 'flag'; weight: number }[];
  allocationRule: 'rule_a' | 'rule_b' | 'rule_c';
  allocationParams: {
    mediumPct?: number;
    lowPct?: number;
    totalN?: number;
    highN?: number;
    mediumN?: number;
    lowN?: number;
  };
  rationale: string;
}

interface Props {
  columnMapping: Partial<ColumnMapping>;
  fullPopulationData: Record<string, unknown>[];
  auditData: {
    performanceMateriality: number;
    tolerableMisstatement: number;
    dataType: string;
  };
  onAccept: (suggestion: AISuggestion) => void;
  disabled?: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function computePopulationSummary(data: Record<string, unknown>[], mapping: Partial<ColumnMapping>) {
  const amounts = data.map(row => parseFloat(String(row[mapping.amount || ''] || 0)) || 0);
  const sorted = [...amounts].sort((a, b) => a - b);
  const mean = amounts.length > 0 ? amounts.reduce((s, v) => s + v, 0) / amounts.length : 0;
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const stdDev = amounts.length > 1
    ? Math.sqrt(amounts.reduce((s, v) => s + (v - mean) ** 2, 0) / (amounts.length - 1))
    : 0;

  const uniqueCount = (col?: string) => {
    if (!col) return undefined;
    const vals = new Set(data.map(row => String(row[col] || '')).filter(Boolean));
    return vals.size > 0 ? vals.size : undefined;
  };

  return {
    recordCount: data.length,
    amountStats: {
      min: sorted[0] ?? 0,
      max: sorted[sorted.length - 1] ?? 0,
      mean,
      median,
      stdDev,
    },
    hasFlags: {
      override: !!mapping.overrideFlag,
      exception: !!mapping.exceptionFlag,
      manualAuto: !!mapping.manualAutoFlag,
    },
    uniquePreparers: uniqueCount(mapping.preparer),
    uniqueVendors: uniqueCount(mapping.vendorCustomer),
    uniqueGlCodes: uniqueCount(mapping.glCode),
  };
}

function getAvailableColumns(mapping: Partial<ColumnMapping>) {
  return Object.entries(mapping)
    .filter(([, v]) => !!v)
    .map(([key, mapped]) => ({ key, mapped: mapped as string }));
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function AISuggestStratification({
  columnMapping, fullPopulationData, auditData, onAccept, disabled,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [suggestion, setSuggestion] = useState<AISuggestion | null>(null);
  const [error, setError] = useState('');
  const [selectedFeatures, setSelectedFeatures] = useState<Set<number>>(new Set());

  const handleSuggest = async () => {
    setLoading(true);
    setError('');
    setSuggestion(null);
    try {
      const res = await fetch('/api/sampling/suggest-stratification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          availableColumns: getAvailableColumns(columnMapping),
          populationSummary: computePopulationSummary(fullPopulationData, columnMapping),
          auditContext: {
            dataType: auditData.dataType,
            performanceMateriality: auditData.performanceMateriality,
            tolerableMisstatement: auditData.tolerableMisstatement,
          },
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error || 'Failed to get suggestion');
      }

      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setSuggestion(data);
      // Auto-select all proposed features
      setSelectedFeatures(new Set(data.features.map((_: unknown, i: number) => i)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get AI suggestion');
    }
    setLoading(false);
  };

  const handleApply = () => {
    if (suggestion) {
      // Only include user-selected features
      const filteredSuggestion = {
        ...suggestion,
        features: suggestion.features.filter((_, i) => selectedFeatures.has(i)),
      };
      if (filteredSuggestion.features.length === 0) return;
      onAccept(filteredSuggestion);
      setSuggestion(null);
    }
  };

  const toggleFeature = (idx: number) => {
    setSelectedFeatures(prev => {
      const next = new Set(prev);
      next.has(idx) ? next.delete(idx) : next.add(idx);
      return next;
    });
  };

  const ruleLabel = (rule: string) => {
    switch (rule) {
      case 'rule_a': return 'Rule A: 100% High, % Medium/Low';
      case 'rule_b': return 'Rule B: Fixed total, proportional';
      case 'rule_c': return 'Rule C: Custom per stratum';
      default: return rule;
    }
  };

  const typeColor = (type: string) => {
    switch (type) {
      case 'numeric': return 'bg-blue-100 text-blue-700';
      case 'categorical': return 'bg-purple-100 text-purple-700';
      case 'flag': return 'bg-amber-100 text-amber-700';
      default: return 'bg-slate-100 text-slate-700';
    }
  };

  return (
    <div className="space-y-2">
      {/* D: AI-Proposed Stratification */}
      {!suggestion && (
        <div className="p-3 bg-purple-50 border border-purple-200 rounded-lg">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs font-semibold text-purple-800">(E) AI-Proposed Stratification</span>
              <p className="text-[10px] text-purple-600 mt-0.5">
                Analyse population to recommend features, allocation rule, and rationale.
              </p>
            </div>
            <button
              onClick={handleSuggest}
              disabled={disabled || loading || fullPopulationData.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-40 transition-colors"
            >
              {loading
                ? <><Loader2 className="h-3 w-3 animate-spin" /> Analysing...</>
                : <><Sparkles className="h-3 w-3" /> AI Suggest</>
              }
            </button>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="p-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
          {error}
        </div>
      )}

      {/* Suggestion card */}
      {suggestion && (
        <div className="p-3 bg-purple-50 border border-purple-200 rounded-lg space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-purple-800 flex items-center gap-1">
              <Sparkles className="h-3 w-3" /> AI Recommendation
            </span>
            <button onClick={() => setSuggestion(null)} className="p-0.5 text-purple-400 hover:text-purple-600">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Stratification Dimensions (selectable) */}
          <div>
            <div className="text-[10px] font-medium text-purple-600 mb-1.5">
              Proposed Stratification Dimensions ({selectedFeatures.size}/{suggestion.features.length} selected)
            </div>
            <div className="space-y-1">
              {suggestion.features.map((f, i) => (
                <label key={i} className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg cursor-pointer transition-colors ${
                  selectedFeatures.has(i)
                    ? 'bg-white border border-purple-300'
                    : 'bg-purple-25 border border-transparent opacity-50'
                }`}>
                  <input
                    type="checkbox"
                    checked={selectedFeatures.has(i)}
                    onChange={() => toggleFeature(i)}
                    className="rounded border-purple-300 text-purple-600"
                  />
                  <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${typeColor(f.type)}`}>
                    {f.type}
                  </span>
                  <span className="text-xs text-purple-800 font-medium">{f.name}</span>
                  <span className="text-[10px] text-purple-400 ml-auto">weight: {f.weight}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Allocation rule */}
          <div>
            <div className="text-[10px] font-medium text-purple-600 mb-0.5">Allocation</div>
            <div className="text-xs text-purple-800">{ruleLabel(suggestion.allocationRule)}</div>
            {suggestion.allocationRule === 'rule_a' && (
              <div className="text-[10px] text-purple-600 mt-0.5">
                Medium: {suggestion.allocationParams.mediumPct || 30}% · Low: {suggestion.allocationParams.lowPct || 10}%
              </div>
            )}
            {suggestion.allocationRule === 'rule_b' && (
              <div className="text-[10px] text-purple-600 mt-0.5">
                Total N: {suggestion.allocationParams.totalN || 50}
              </div>
            )}
            {suggestion.allocationRule === 'rule_c' && (
              <div className="text-[10px] text-purple-600 mt-0.5">
                High: {suggestion.allocationParams.highN || 0} · Medium: {suggestion.allocationParams.mediumN || 0} · Low: {suggestion.allocationParams.lowN || 0}
              </div>
            )}
          </div>

          {/* Rationale */}
          <div>
            <div className="text-[10px] font-medium text-purple-600 mb-0.5">Rationale</div>
            <p className="text-xs text-purple-800 leading-relaxed">{suggestion.rationale}</p>
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <button
              onClick={handleApply}
              disabled={selectedFeatures.size === 0}
              className="inline-flex items-center gap-1 px-3 py-1 text-xs font-medium rounded-md bg-purple-700 text-white hover:bg-purple-800 disabled:opacity-40 transition-colors"
            >
              <Check className="h-3 w-3" /> Apply {selectedFeatures.size} Dimension{selectedFeatures.size !== 1 ? 's' : ''}
            </button>
            <button
              onClick={() => setSuggestion(null)}
              className="px-3 py-1 text-xs font-medium rounded-md text-purple-600 hover:bg-purple-100 transition-colors"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
