'use client';

import { useState, useEffect, useCallback } from 'react';
import { CheckCircle2, XCircle, Loader2, ChevronDown, ChevronUp, Calculator, AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  FORMULA_XAB_OPTIONS,
  FORMULA_Z_OPTIONS,
  DIFFERENCE_ASSESSMENT_OPTIONS,
  RMM_RECONSIDERATION_OPTIONS,
} from '@/lib/ar-calculation';

interface ARRecord {
  id: string;
  accountCode: string;
  description: string | null;
  recordedAmount: number;
  priorYearAmount: number;
  formulaX: string | null;
  formulaA: string | null;
  formulaB: string | null;
  formulaZ: string | null;
  xValue: number | null;
  aValue: number | null;
  bValue: number | null;
  zValue: number | null;
  xExplanation: string | null;
  zExplanation: string | null;
  expectedAmount: number | null;
  difference: number | null;
  toleranceMateriality: number | null;
  threshold: number | null;
  withinThreshold: boolean;
  justification: string | null;
  differenceAssessment: string | null;
  rmmErrors: string;
  rmmBias: string;
  rmmControlFailures: string;
  rmmFraudRisks: string;
  signOffs: any;
  status: string;
  mergedWithCode: string | null;
}

interface Props {
  engagementId: string;
  fsLine: string;
  accountCodes?: string[];
  onClose?: () => void;
}

function fmt(v: number): string {
  const abs = Math.abs(v);
  const s = abs.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return v < 0 ? `(${s})` : s;
}

export function AnalyticalReviewPanel({ engagementId, fsLine, accountCodes, onClose }: Props) {
  const [records, setRecords] = useState<ARRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [initializing, setInitializing] = useState(false);
  const [calculating, setCalculating] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [expandedRecord, setExpandedRecord] = useState<string | null>(null);

  const loadRecords = useCallback(async () => {
    try {
      const res = await fetch(`/api/engagements/${engagementId}/analytical-review?fsLine=${encodeURIComponent(fsLine)}`);
      if (res.ok) {
        const data = await res.json();
        setRecords(data.reviews || []);
      }
    } catch {} finally { setLoading(false); }
  }, [engagementId, fsLine]);

  useEffect(() => { loadRecords(); }, [loadRecords]);

  async function handleInitialize() {
    setInitializing(true);
    try {
      await fetch(`/api/engagements/${engagementId}/analytical-review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'initialize', fsLine, accountCodes }),
      });
      await loadRecords();
    } catch {} finally { setInitializing(false); }
  }

  async function handleCalculate(id: string) {
    setCalculating(id);
    try {
      const res = await fetch(`/api/engagements/${engagementId}/analytical-review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'calculate', id }),
      });
      if (res.ok) {
        const { review } = await res.json();
        setRecords(prev => prev.map(r => r.id === id ? review : r));
      }
    } catch {} finally { setCalculating(null); }
  }

  async function handleUpdate(id: string, field: string, value: any) {
    setRecords(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
    // Debounced save
    try {
      await fetch(`/api/engagements/${engagementId}/analytical-review`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, [field]: value }),
      });
    } catch {}
  }

  async function handleSignOff(id: string, role: string, action: 'signoff' | 'unsignoff') {
    try {
      const res = await fetch(`/api/engagements/${engagementId}/analytical-review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, id, role }),
      });
      if (res.ok) {
        const { review } = await res.json();
        setRecords(prev => prev.map(r => r.id === id ? review : r));
      }
    } catch {}
  }

  if (loading) return <div className="p-4 text-center text-xs text-slate-400 animate-pulse">Loading analytical review...</div>;

  return (
    <div className="border border-green-200 rounded-lg bg-white shadow-sm">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-green-200 bg-green-50/50">
        <Calculator className="h-4 w-4 text-green-600" />
        <div className="flex-1">
          <div className="text-sm font-semibold text-slate-800">Analytical Review Procedures</div>
          <div className="text-[10px] text-slate-400">{fsLine} — {records.length} account{records.length !== 1 ? 's' : ''}</div>
        </div>
        {records.length === 0 && (
          <Button onClick={handleInitialize} disabled={initializing} size="sm" className="bg-green-600 hover:bg-green-700 text-xs">
            {initializing ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
            Initialize AR Records
          </Button>
        )}
        {onClose && <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg">x</button>}
      </div>

      {/* Records */}
      {records.length === 0 && !loading && (
        <div className="p-6 text-center text-xs text-slate-400">
          No AR records yet. Click "Initialize AR Records" to create them from trial balance data for this FS line.
        </div>
      )}

      <div className="divide-y divide-slate-100">
        {records.map(rec => {
          const isExpanded = expandedRecord === rec.id;
          const isGreen = rec.withinThreshold && rec.expectedAmount != null;
          const isRed = !rec.withinThreshold && rec.expectedAmount != null;
          const isPending = rec.expectedAmount == null;

          return (
            <div key={rec.id} className={`${isRed ? 'bg-red-50/30' : isGreen ? 'bg-green-50/30' : ''}`}>
              {/* Summary row */}
              <button
                onClick={() => setExpandedRecord(isExpanded ? null : rec.id)}
                className="w-full flex items-center gap-3 px-4 py-2 hover:bg-slate-50/50 text-left"
              >
                <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                  isPending ? 'bg-slate-300' : isGreen ? 'bg-green-500' : 'bg-red-500'
                }`} />
                <span className="font-mono text-[10px] text-slate-500 w-16 shrink-0">{rec.accountCode}</span>
                <span className="text-xs text-slate-700 flex-1 truncate">{rec.description}</span>
                <span className="text-[10px] text-slate-500 w-24 text-right">{fmt(rec.recordedAmount)}</span>
                {rec.expectedAmount != null && (
                  <span className={`text-[10px] w-24 text-right font-medium ${isGreen ? 'text-green-600' : 'text-red-600'}`}>
                    Diff: {fmt(rec.difference || 0)}
                  </span>
                )}
                {isPending && <span className="text-[9px] text-slate-400">Not calculated</span>}
                {isExpanded ? <ChevronUp className="h-3 w-3 text-slate-400" /> : <ChevronDown className="h-3 w-3 text-slate-400" />}
              </button>

              {/* Expanded detail */}
              {isExpanded && (
                <div className="px-4 pb-4 space-y-4">
                  {/* Formula Builder */}
                  <div className="border rounded p-3 space-y-2 bg-white">
                    <div className="text-[10px] font-bold text-slate-600 uppercase">Expected = X + (A + B) / 2 x Z</div>
                    <div className="grid grid-cols-4 gap-2">
                      {/* X */}
                      <FormulaSelect label="X" value={rec.formulaX} options={[...FORMULA_XAB_OPTIONS]}
                        onChange={v => handleUpdate(rec.id, 'formulaX', v)}
                        numValue={rec.xValue} onNumChange={v => handleUpdate(rec.id, 'xValue', v)}
                        needsUserInput={rec.formulaX === 'Non-Financial Data' || rec.formulaX === 'Units Sold'}
                        explanation={rec.xExplanation} onExplanationChange={v => handleUpdate(rec.id, 'xExplanation', v)}
                      />
                      {/* A */}
                      <FormulaSelect label="A" value={rec.formulaA} options={[...FORMULA_XAB_OPTIONS]}
                        onChange={v => handleUpdate(rec.id, 'formulaA', v)}
                        numValue={rec.aValue} onNumChange={v => handleUpdate(rec.id, 'aValue', v)}
                        needsUserInput={rec.formulaA === 'Non-Financial Data' || rec.formulaA === 'Units Sold'}
                        explanation={null} onExplanationChange={() => {}}
                      />
                      {/* B */}
                      <FormulaSelect label="B" value={rec.formulaB} options={[...FORMULA_XAB_OPTIONS]}
                        onChange={v => handleUpdate(rec.id, 'formulaB', v)}
                        numValue={rec.bValue} onNumChange={v => handleUpdate(rec.id, 'bValue', v)}
                        needsUserInput={rec.formulaB === 'Non-Financial Data' || rec.formulaB === 'Units Sold'}
                        explanation={null} onExplanationChange={() => {}}
                      />
                      {/* Z */}
                      <FormulaSelect label="Z" value={rec.formulaZ} options={[...FORMULA_Z_OPTIONS]}
                        onChange={v => handleUpdate(rec.id, 'formulaZ', v)}
                        numValue={rec.zValue} onNumChange={v => handleUpdate(rec.id, 'zValue', v)}
                        needsUserInput={['Inflation', 'GDP', 'FX rate to USD', 'FX rate to Euro', 'Interest rate', 'User Entered'].includes(rec.formulaZ || '')}
                        explanation={rec.zExplanation} onExplanationChange={v => handleUpdate(rec.id, 'zExplanation', v)}
                      />
                    </div>
                    <Button onClick={() => handleCalculate(rec.id)} disabled={calculating === rec.id} size="sm" className="bg-blue-600 hover:bg-blue-700 text-xs mt-2">
                      {calculating === rec.id ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Calculator className="h-3 w-3 mr-1" />}
                      Calculate
                    </Button>
                  </div>

                  {/* Calculation Results */}
                  {rec.expectedAmount != null && (
                    <div className="border rounded p-3 space-y-2">
                      <div className="text-[10px] font-bold text-slate-600 uppercase">Calculation Results</div>
                      <div className="grid grid-cols-5 gap-2 text-center text-[10px]">
                        <div className="bg-slate-50 rounded p-2">
                          <div className="text-slate-400">Recorded</div>
                          <div className="font-bold text-slate-800">{fmt(rec.recordedAmount)}</div>
                        </div>
                        <div className="bg-blue-50 rounded p-2">
                          <div className="text-blue-500">Expected</div>
                          <div className="font-bold text-blue-800">{fmt(rec.expectedAmount)}</div>
                        </div>
                        <div className={`rounded p-2 ${isGreen ? 'bg-green-50' : 'bg-red-50'}`}>
                          <div className={isGreen ? 'text-green-500' : 'text-red-500'}>Difference</div>
                          <div className={`font-bold ${isGreen ? 'text-green-800' : 'text-red-800'}`}>{fmt(rec.difference || 0)}</div>
                        </div>
                        <div className="bg-slate-50 rounded p-2">
                          <div className="text-slate-400">Tol. Materiality</div>
                          <div className="font-bold text-slate-800">{fmt(rec.toleranceMateriality || 0)}</div>
                        </div>
                        <div className="bg-slate-50 rounded p-2">
                          <div className="text-slate-400">Threshold</div>
                          <div className="font-bold text-slate-800">{fmt(rec.threshold || 0)}</div>
                        </div>
                      </div>
                      <div className={`text-xs font-bold text-center py-1 rounded ${isGreen ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                        {isGreen ? 'Consistent — within threshold' : 'Exceeds threshold — investigation required'}
                      </div>
                    </div>
                  )}

                  {/* Justification */}
                  <div>
                    <label className="text-[10px] font-bold text-slate-600 uppercase block mb-1">Justification</label>
                    <textarea
                      value={rec.justification || ''}
                      onChange={e => handleUpdate(rec.id, 'justification', e.target.value)}
                      placeholder="Explain the basis for the expected result calculation and why it is appropriate..."
                      className="w-full border border-slate-200 rounded px-2 py-1.5 text-xs min-h-[60px] focus:outline-none focus:border-blue-300"
                    />
                  </div>

                  {/* Sign-offs */}
                  <div className="flex items-center gap-6 justify-center py-2">
                    {['preparer', 'reviewer', 'ri'].map(role => {
                      const so = rec.signOffs?.[role];
                      const isSigned = !!so;
                      return (
                        <div key={role} className="flex flex-col items-center gap-1">
                          <button
                            onClick={() => handleSignOff(rec.id, role, isSigned ? 'unsignoff' : 'signoff')}
                            className={`w-6 h-6 rounded-full border-2 transition-colors ${
                              isSigned ? 'bg-green-500 border-green-500' : 'border-green-400 hover:bg-green-50 cursor-pointer'
                            }`}
                            title={isSigned ? `${so.userName} — click to unsign` : `Click to sign as ${role}`}
                          >
                            {isSigned && <CheckCircle2 className="h-3.5 w-3.5 text-white mx-auto" />}
                          </button>
                          <span className="text-[8px] text-slate-500 font-medium capitalize">{role === 'ri' ? 'RI' : role.charAt(0).toUpperCase() + role.slice(1)}</span>
                          {isSigned && <span className="text-[7px] text-green-600">{so.userName}</span>}
                        </div>
                      );
                    })}
                  </div>

                  {/* Difference Assessment (shown when exceeds threshold) */}
                  {isRed && (
                    <div className="border border-red-200 rounded p-3 bg-red-50/30 space-y-2">
                      <div className="text-[10px] font-bold text-red-700 uppercase flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" /> Difference Assessment
                      </div>
                      <select
                        value={rec.differenceAssessment || ''}
                        onChange={e => handleUpdate(rec.id, 'differenceAssessment', e.target.value)}
                        className="w-full border border-slate-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-blue-300"
                      >
                        <option value="">Select assessment...</option>
                        {DIFFERENCE_ASSESSMENT_OPTIONS.map(opt => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* RMM Reconsideration */}
                  <div className="border rounded p-3 space-y-2">
                    <div className="text-[10px] font-bold text-slate-600 uppercase">RMM Reconsideration</div>
                    <p className="text-[10px] text-slate-400">Does this analytical review indicate the RMM needs to change?</p>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { field: 'rmmErrors', label: 'Errors?' },
                        { field: 'rmmBias', label: 'Bias?' },
                        { field: 'rmmControlFailures', label: 'Control failures?' },
                        { field: 'rmmFraudRisks', label: 'Fraud risks?' },
                      ].map(({ field, label }) => (
                        <div key={field} className="flex items-center gap-2">
                          <label className="text-[10px] text-slate-600 flex-1">{label}</label>
                          <select
                            value={(rec as any)[field] || 'No'}
                            onChange={e => handleUpdate(rec.id, field, e.target.value)}
                            className="border border-slate-200 rounded px-2 py-1 text-[10px] w-16 focus:outline-none focus:border-blue-300"
                          >
                            {RMM_RECONSIDERATION_OPTIONS.map(opt => (
                              <option key={opt} value={opt}>{opt}</option>
                            ))}
                          </select>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Formula Select Sub-component ───

function FormulaSelect({ label, value, options, onChange, numValue, onNumChange, needsUserInput, explanation, onExplanationChange }: {
  label: string;
  value: string | null;
  options: readonly string[];
  onChange: (v: string) => void;
  numValue: number | null;
  onNumChange: (v: number) => void;
  needsUserInput: boolean;
  explanation: string | null;
  onExplanationChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] font-bold text-slate-500">{label} =</label>
      <select
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        className="w-full border border-slate-200 rounded px-1.5 py-1 text-[10px] focus:outline-none focus:border-blue-300"
      >
        <option value="">Select...</option>
        {options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
      </select>
      {needsUserInput && (
        <>
          <input
            type="number"
            value={numValue ?? ''}
            onChange={e => onNumChange(parseFloat(e.target.value) || 0)}
            placeholder="Enter value"
            className="w-full border border-slate-200 rounded px-1.5 py-1 text-[10px] focus:outline-none focus:border-blue-300"
          />
          {explanation !== null && (
            <input
              type="text"
              value={explanation || ''}
              onChange={e => onExplanationChange(e.target.value)}
              placeholder="Explanation..."
              className="w-full border border-slate-200 rounded px-1.5 py-0.5 text-[9px] focus:outline-none focus:border-blue-300"
            />
          )}
        </>
      )}
      {!needsUserInput && numValue != null && (
        <div className="text-[9px] text-slate-400 font-mono">{fmt(numValue)}</div>
      )}
    </div>
  );
}
