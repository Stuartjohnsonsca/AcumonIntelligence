'use client';

import { useState, useEffect, useMemo } from 'react';
import { X, ShieldCheck, ShieldAlert, AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import type { OptimizationViolation } from '@/lib/resource-planning/types';
import { Button } from '@/components/ui/button';

interface Props {
  onClose: () => void;
}

// Human-readable labels for constraint IDs
const CONSTRAINT_LABELS: Record<string, { label: string; color: string }> = {
  'no-ri':                  { label: 'Missing RI',            color: 'bg-red-100 text-red-700'    },
  'multi-ri':               { label: 'Multiple RI',           color: 'bg-red-100 text-red-700'    },
  'ri-no-preparer':         { label: 'RI doing Prep work',    color: 'bg-amber-100 text-amber-700' },
  'ri-no-reviewer':         { label: 'RI doing Review work',  color: 'bg-amber-100 text-amber-700' },
  'reviewer-no-preparer':   { label: 'Rev doing Prep work',   color: 'bg-amber-100 text-amber-700' },
  'over-budget':            { label: 'Over budget',           color: 'bg-orange-100 text-orange-700' },
  'under-budget':           { label: 'Under-allocated',       color: 'bg-blue-100 text-blue-700'  },
  'custom-completion-date': { label: 'Past deadline',         color: 'bg-red-100 text-red-700'    },
  'no-overtime':            { label: 'Staff overloaded',      color: 'bg-purple-100 text-purple-700' },
};

function constraintLabel(id: string) {
  return CONSTRAINT_LABELS[id] ?? { label: id, color: 'bg-slate-100 text-slate-600' };
}

// Group violations by constraint type for a summary view
function groupByConstraint(violations: OptimizationViolation[]) {
  const groups = new Map<string, OptimizationViolation[]>();
  for (const v of violations) {
    const key = v.constraintId;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(v);
  }
  return groups;
}

export function ScheduleValidationDialog({ onClose }: Props) {
  const [loading, setLoading] = useState(true);
  const [violations, setViolations] = useState<OptimizationViolation[]>([]);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedConstraint, setExpandedConstraint] = useState<string | null>(null);

  async function runValidation() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/resource-planning/validate');
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Validation failed');
        return;
      }
      setViolations(data.violations ?? []);
      setCheckedAt(data.checkedAt ?? null);
    } catch {
      setError('Network error — please try again.');
    } finally {
      setLoading(false);
    }
  }

  // Run on mount
  useEffect(() => { runValidation(); }, []);

  const groups = useMemo(() => groupByConstraint(violations), [violations]);
  const isClean = !loading && !error && violations.length === 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl max-h-[85vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <div className="flex items-center gap-2">
            {loading ? (
              <Loader2 className="h-5 w-5 text-slate-400 animate-spin" />
            ) : isClean ? (
              <ShieldCheck className="h-5 w-5 text-green-500" />
            ) : (
              <ShieldAlert className="h-5 w-5 text-amber-500" />
            )}
            <h2 className="text-base font-semibold text-slate-800">Schedule Validation</h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={runValidation}
              disabled={loading}
              className="p-1 rounded hover:bg-slate-100 text-slate-400 disabled:opacity-40"
              title="Re-run validation"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button onClick={onClose} className="p-1 rounded hover:bg-slate-100">
              <X className="h-4 w-4 text-slate-400" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">

          {loading && (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <Loader2 className="h-7 w-7 text-blue-400 animate-spin" />
              <p className="text-sm text-slate-500">Checking schedule constraints…</p>
            </div>
          )}

          {error && !loading && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-4 py-3">
              {error}
            </div>
          )}

          {!loading && !error && isClean && (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <ShieldCheck className="h-10 w-10 text-green-400" />
              <p className="text-sm font-semibold text-green-700">No constraint violations found</p>
              <p className="text-xs text-slate-400">
                Your current schedule passes all role, budget and deadline checks.
              </p>
            </div>
          )}

          {!loading && !error && violations.length > 0 && (
            <>
              {/* Summary bar */}
              <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5 text-xs">
                <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0" />
                <span className="font-semibold text-amber-800">
                  {violations.length} violation{violations.length !== 1 ? 's' : ''} across {groups.size} check{groups.size !== 1 ? 's' : ''}
                </span>
                {checkedAt && (
                  <span className="ml-auto text-slate-400">
                    {new Date(checkedAt).toLocaleTimeString()}
                  </span>
                )}
              </div>

              {/* Grouped by constraint type */}
              <div className="space-y-2">
                {[...groups.entries()].map(([constraintId, viols]) => {
                  const { label, color } = constraintLabel(constraintId);
                  const isOpen = expandedConstraint === constraintId;
                  return (
                    <div key={constraintId} className="border border-slate-200 rounded-lg overflow-hidden">
                      <button
                        onClick={() => setExpandedConstraint(isOpen ? null : constraintId)}
                        className="w-full flex items-center gap-3 px-3 py-2.5 bg-slate-50 hover:bg-slate-100 transition-colors text-left"
                      >
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${color}`}>
                          {label}
                        </span>
                        <span className="text-xs text-slate-600 flex-1 font-medium">
                          {viols.length} issue{viols.length !== 1 ? 's' : ''}
                        </span>
                        <span className="text-[10px] text-slate-400">
                          {isOpen ? '▲ Hide' : '▼ Show'}
                        </span>
                      </button>

                      {isOpen && (
                        <div className="divide-y divide-slate-100">
                          {viols.map((v, i) => (
                            <div key={i} className="flex items-start gap-2 px-3 py-2">
                              <AlertTriangle className="h-3.5 w-3.5 text-amber-400 flex-shrink-0 mt-0.5" />
                              <p className="text-xs text-slate-700 leading-snug">{v.description}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-slate-200 bg-slate-50">
          {!loading && !error && violations.length > 0 && (
            <span className="text-[11px] text-slate-400">
              Click a row to expand its violations
            </span>
          )}
          <div className="ml-auto">
            <Button variant="outline" size="sm" className="text-xs" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>

      </div>
    </div>
  );
}
