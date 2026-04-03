'use client';

import { useState, useCallback } from 'react';
import { CheckCircle2, Loader2, Download, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props {
  engagementId: string;
  fsLine: string;
  testDescription: string;
  populationData: any[]; // from client evidence/portal response
  materialityData: { performanceMateriality: number; clearlyTrivial: number; tolerableMisstatement: number };
  onComplete: (results: { runId: string; selectedIndices: number[]; sampleSize: number; coverage: number }) => void;
}

const SIMPLE_METHODS = [
  { key: 'random', label: 'Random (SRSWOR)', desc: 'Simple random sampling without replacement' },
  { key: 'systematic', label: 'Systematic', desc: 'Fixed interval selection from ordered population' },
  { key: 'mus', label: 'Monetary Unit (MUS)', desc: 'Probability proportional to size' },
  { key: 'composite', label: 'Composite', desc: 'High-value items 100% + residual sample' },
  { key: 'judgemental', label: 'Judgemental', desc: 'Manual selection with documented rationale' },
];

const STRATIFIED_METHODS = [
  { key: 'stratified', label: 'AI Risk Stratification', desc: 'K-means clustering + Z-score outlier detection' },
];

const ERROR_METRICS = [
  { value: 'net_signed', label: 'Net Signed Error' },
  { value: 'overstatement_only', label: 'Overstatement Only' },
  { value: 'absolute_error', label: 'Absolute Error' },
];

const RISK_LEVELS = ['Low', 'Medium', 'High'];

function fmt(n: number | null | undefined, currency = 'GBP'): string {
  if (n == null) return '—';
  return `£${Math.abs(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function InlineSamplingPanel({ engagementId, fsLine, testDescription, populationData, materialityData, onComplete }: Props) {
  const [mode, setMode] = useState<'simple' | 'stratified'>('simple');
  const [method, setMethod] = useState('random');
  const [sampleSizeMode, setSampleSizeMode] = useState<'calculator' | 'fixed'>('fixed');
  const [fixedSampleSize, setFixedSampleSize] = useState(25);
  const [confidence, setConfidence] = useState(0.95);
  const [errorMetric, setErrorMetric] = useState('net_signed');
  const [inherentRisk, setInherentRisk] = useState('Medium');
  const [specificRisk, setSpecificRisk] = useState('Medium');
  const [running, setRunning] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  const [sampleTotal, setSampleTotal] = useState<number | null>(null);
  const [coverage, setCoverage] = useState<number | null>(null);
  const [rationale, setRationale] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showPopulation, setShowPopulation] = useState(false);

  const populationCount = populationData.length;
  const columns = populationCount > 0 ? Object.keys(populationData[0]).slice(0, 6) : [];
  const populationTotal = populationData.reduce((s, row) => {
    const amt = parseFloat(row.amount || row.Amount || row.gross || row.Gross || row.net || row.Net || 0);
    return s + (isNaN(amt) ? 0 : amt);
  }, 0);

  async function handleRun() {
    setRunning(true); setError(null);
    try {
      const res = await fetch('/api/sampling/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          engagementId,
          populationData,
          method: mode === 'stratified' ? 'stratified' : method,
          stratification: mode,
          sampleSizeStrategy: sampleSizeMode,
          fixedSampleSize: sampleSizeMode === 'fixed' ? fixedSampleSize : undefined,
          confidence,
          tolerableMisstatement: materialityData.tolerableMisstatement,
          errorMetric,
          ...(mode === 'stratified' ? { inherentRisk, specificRisk } : {}),
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setRunId(data.runId);
        setSelectedIndices(new Set(data.selectedIndices || []));
        setSampleTotal(data.sampleTotal);
        setCoverage(data.coverage);
        setRationale(data.planningRationale);
        setShowPopulation(true);
      } else {
        const data = await res.json();
        setError(data.error || 'Sampling run failed');
      }
    } catch (err: any) {
      setError(err.message || 'Failed');
    } finally {
      setRunning(false);
    }
  }

  function handleConfirmSample() {
    if (!runId) return;
    onComplete({
      runId,
      selectedIndices: Array.from(selectedIndices),
      sampleSize: selectedIndices.size,
      coverage: coverage || 0,
    });
  }

  return (
    <div className="space-y-3">
      {/* Top row: method + config */}
      <div className="grid grid-cols-12 gap-3">
        {/* Method selector */}
        <div className="col-span-4">
          {/* Mode A / B toggle */}
          <div className="flex gap-1 mb-2 bg-slate-100 rounded p-0.5">
            <button onClick={() => { setMode('simple'); setMethod('random'); }} className={`flex-1 px-2 py-1 text-[10px] font-medium rounded ${mode === 'simple' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>
              Mode A: Simple
            </button>
            <button onClick={() => { setMode('stratified'); setMethod('stratified'); }} className={`flex-1 px-2 py-1 text-[10px] font-medium rounded ${mode === 'stratified' ? 'bg-white text-purple-700 shadow-sm' : 'text-slate-500'}`}>
              Mode B: AI Stratified
            </button>
          </div>

          {mode === 'simple' && (
            <div className="space-y-1">
              {SIMPLE_METHODS.map(m => (
                <button key={m.key} onClick={() => setMethod(m.key)}
                  className={`w-full text-left px-2.5 py-1.5 rounded text-xs transition-colors ${method === m.key ? 'bg-blue-50 border border-blue-200 text-blue-800 font-medium' : 'border border-slate-100 hover:bg-slate-50 text-slate-600'}`}>
                  <span className="font-medium">{m.label}</span>
                  <span className="text-[9px] text-slate-400 block">{m.desc}</span>
                </button>
              ))}
            </div>
          )}

          {mode === 'stratified' && (
            <div className="space-y-2">
              <div className="bg-purple-50 border border-purple-200 rounded-lg p-2.5">
                <span className="text-[10px] font-bold text-purple-700 uppercase">AI Risk Stratification</span>
                <p className="text-[10px] text-purple-600 mt-0.5">K-means clustering with Z-score outlier detection. AI analyses the population and creates risk-based strata.</p>
              </div>
              <div>
                <label className="text-[10px] font-semibold text-slate-500">Inherent Risk</label>
                <select value={inherentRisk} onChange={e => setInherentRisk(e.target.value)} className="w-full border rounded px-2 py-1 text-xs bg-white mt-0.5">
                  {RISK_LEVELS.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-semibold text-slate-500">Specific Risk</label>
                <select value={specificRisk} onChange={e => setSpecificRisk(e.target.value)} className="w-full border rounded px-2 py-1 text-xs bg-white mt-0.5">
                  {RISK_LEVELS.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
            </div>
          )}
        </div>

        {/* Config + Stats */}
        <div className="col-span-4 space-y-3">
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">Sample Size</label>
            <div className="flex gap-1 mb-2 bg-slate-100 rounded p-0.5">
              <button onClick={() => setSampleSizeMode('fixed')} className={`flex-1 px-2 py-1 text-[10px] font-medium rounded ${sampleSizeMode === 'fixed' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>Fixed</button>
              <button onClick={() => setSampleSizeMode('calculator')} className={`flex-1 px-2 py-1 text-[10px] font-medium rounded ${sampleSizeMode === 'calculator' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>Calculate</button>
            </div>
            {sampleSizeMode === 'fixed' && (
              <input type="number" min={1} max={populationCount} value={fixedSampleSize} onChange={e => setFixedSampleSize(parseInt(e.target.value) || 1)}
                className="w-full border rounded px-2.5 py-1.5 text-sm" />
            )}
            {sampleSizeMode === 'calculator' && (
              <div className="text-[10px] text-slate-500 bg-slate-50 rounded p-2">
                Auto-calculated from risk assessment and materiality
              </div>
            )}
          </div>

          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">Confidence Level</label>
            <select value={confidence} onChange={e => setConfidence(parseFloat(e.target.value))} className="w-full border rounded px-2 py-1.5 text-sm bg-white">
              <option value={0.90}>90%</option>
              <option value={0.95}>95%</option>
              <option value={0.99}>99%</option>
            </select>
          </div>

          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">Error Metric</label>
            <select value={errorMetric} onChange={e => setErrorMetric(e.target.value)} className="w-full border rounded px-2 py-1.5 text-sm bg-white">
              {ERROR_METRICS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
        </div>

        {/* Summary stats */}
        <div className="col-span-4 space-y-2">
          <div className="bg-slate-50 rounded-lg p-2.5">
            <span className="text-[9px] text-slate-400 uppercase block">Population</span>
            <span className="text-base font-bold text-slate-800">{populationCount.toLocaleString()} items</span>
            <span className="text-xs text-slate-500 block">{fmt(populationTotal)}</span>
          </div>
          {selectedIndices.size > 0 && (
            <div className="bg-green-50 rounded-lg p-2.5 border border-green-200">
              <span className="text-[9px] text-green-600 uppercase block">Sample Selected</span>
              <span className="text-base font-bold text-green-800">{selectedIndices.size} items</span>
              <span className="text-xs text-green-600 block">{fmt(sampleTotal)} ({coverage?.toFixed(1)}% coverage)</span>
            </div>
          )}
          <div className="bg-slate-50 rounded-lg p-2.5 text-[10px]">
            <div className="flex justify-between"><span className="text-slate-400">PM</span><span className="font-mono text-slate-700">{fmt(materialityData.performanceMateriality)}</span></div>
            <div className="flex justify-between"><span className="text-slate-400">CT</span><span className="font-mono text-slate-700">{fmt(materialityData.clearlyTrivial)}</span></div>
            <div className="flex justify-between"><span className="text-slate-400">TM</span><span className="font-mono text-slate-700">{fmt(materialityData.tolerableMisstatement)}</span></div>
          </div>
        </div>
      </div>

      {/* Run button */}
      <div className="flex items-center gap-3">
        <Button onClick={handleRun} disabled={running || populationCount === 0} className="bg-green-600 hover:bg-green-700">
          {running ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
          {running ? 'Running...' : selectedIndices.size > 0 ? 'Re-run Sample' : 'Run Sample'}
        </Button>
        {selectedIndices.size > 0 && (
          <Button onClick={handleConfirmSample} className="bg-blue-600 hover:bg-blue-700">
            Confirm Sample — Continue Flow
          </Button>
        )}
        {error && <span className="text-xs text-red-500">{error}</span>}
      </div>

      {/* Rationale */}
      {rationale && (
        <div className="bg-blue-50 border border-blue-200 rounded px-3 py-2 text-xs text-blue-700">
          <strong>Rationale:</strong> {rationale}
        </div>
      )}

      {/* Population table with selected items highlighted */}
      {populationCount > 0 && (
        <div>
          <button onClick={() => setShowPopulation(!showPopulation)} className="flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-800 mb-1">
            {showPopulation ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            Population Data ({populationCount} items{selectedIndices.size > 0 ? `, ${selectedIndices.size} selected` : ''})
          </button>
          {showPopulation && (
            <div className="border rounded-lg overflow-auto max-h-[300px]">
              <table className="w-full text-xs border-collapse">
                <thead className="sticky top-0 z-10 bg-slate-100">
                  <tr>
                    <th className="px-2 py-1.5 text-left font-semibold text-slate-600 w-8">#</th>
                    {selectedIndices.size > 0 && <th className="px-2 py-1.5 text-center font-semibold text-slate-600 w-8">Sel</th>}
                    {columns.map(col => (
                      <th key={col} className="px-2 py-1.5 text-left font-semibold text-slate-600 truncate max-w-[120px]">{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {populationData.map((row, i) => {
                    const isSelected = selectedIndices.has(i);
                    return (
                      <tr key={i} className={isSelected ? 'bg-green-50' : i % 2 ? 'bg-slate-50/30' : ''}>
                        <td className="px-2 py-1 text-slate-400 font-mono">{i + 1}</td>
                        {selectedIndices.size > 0 && (
                          <td className="px-2 py-1 text-center">
                            {isSelected && <span className="inline-block w-3 h-3 rounded-full bg-green-500" />}
                          </td>
                        )}
                        {columns.map(col => (
                          <td key={col} className={`px-2 py-1 truncate max-w-[120px] ${isSelected ? 'text-green-800 font-medium' : 'text-slate-500'}`}>
                            {String(row[col] ?? '')}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Export buttons */}
      {runId && selectedIndices.size > 0 && (
        <div className="flex items-center gap-3 text-xs">
          <button onClick={() => {
            const headers = columns.join(',');
            const rows = populationData.filter((_, i) => selectedIndices.has(i)).map(row => columns.map(col => `"${String(row[col] || '')}"`).join(','));
            const csv = [headers, ...rows].join('\n');
            const blob = new Blob([csv], { type: 'text/csv' });
            const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `sample_${fsLine}.csv`; a.click(); URL.revokeObjectURL(url);
          }} className="text-slate-500 hover:text-slate-700 flex items-center gap-1"><Download className="h-3 w-3" /> Export CSV</button>
        </div>
      )}
    </div>
  );
}
