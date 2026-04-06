'use client';

import { useState, useEffect, useRef } from 'react';
import { CheckCircle2, Loader2, Download, ChevronDown, ChevronRight, AlertTriangle, Settings2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import * as XLSX from 'xlsx';

interface Props {
  engagementId: string;    // AuditEngagement ID
  clientId: string;
  periodId: string;
  fsLine: string;
  testDescription: string;
  populationData: any[];   // From flow context (client upload parsed)
  materialityData: { performanceMateriality: number; clearlyTrivial: number; tolerableMisstatement: number };
  initialSelectedIndices?: number[];  // Persisted selection from prior run
  priorSelectedIndices?: number[];   // Original sample (green) — used when expanding sample
  expandedMode?: boolean;            // If true, prior selections locked green, new selections blue
  onComplete: (results: { runId: string; selectedIndices: number[]; sampleSize: number; coverage: number }) => void;
}

const METHODS = [
  { key: 'random', label: 'Random', desc: 'Simple random (SRSWOR)' },
  { key: 'systematic', label: 'Systematic', desc: 'Fixed interval selection' },
  { key: 'mus', label: 'MUS', desc: 'Monetary Unit Sampling' },
  { key: 'composite', label: 'Composite', desc: 'High-value + residual' },
  { key: 'judgemental', label: 'Judgemental', desc: 'Manual with rationale' },
  { key: 'stratified', label: 'AI Stratified', desc: 'K-means + Z-score' },
];

const ERROR_METRICS = [
  { value: 'net_signed', label: 'Net Signed' },
  { value: 'overstatement_only', label: 'Overstatement Only' },
  { value: 'absolute_error', label: 'Absolute' },
];

function fmt(n: number | null | undefined): string {
  if (n == null) return '—';
  return `£${Math.abs(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function InlineSamplingPanel({ engagementId, clientId, periodId, fsLine, testDescription, populationData: initialPopulationData, materialityData, initialSelectedIndices, priorSelectedIndices, expandedMode, onComplete }: Props) {
  const priorSet = new Set(priorSelectedIndices || []);
  // Local population data — can be loaded from props OR from local file upload
  const [localPopulationData, setLocalPopulationData] = useState<any[]>(initialPopulationData || []);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sync from props when they change
  useEffect(() => {
    if (initialPopulationData && initialPopulationData.length > 0) setLocalPopulationData(initialPopulationData);
  }, [initialPopulationData?.length]);

  // Sampling engagement
  const [samplingEngId, setSamplingEngId] = useState<string | null>(null);
  const [creatingEng, setCreatingEng] = useState(false);

  // Config
  const [method, setMethod] = useState('MUS');
  const [sampleSizeMode, setSampleSizeMode] = useState<'fixed' | 'calculator'>('calculator');
  const [fixedSampleSize, setFixedSampleSize] = useState(25);
  const [confidence, setConfidence] = useState(0.95);
  const [errorMetric, setErrorMetric] = useState('net_signed');
  const [expectedErrorRate, setExpectedErrorRate] = useState(0); // 0-100%

  // Column mapping + aggregation
  const [showMapping, setShowMapping] = useState(false);
  const [idColumn, setIdColumn] = useState('');
  const [amountColumn, setAmountColumn] = useState('');
  const [aggregateColumn, setAggregateColumn] = useState<string>(''); // empty = no aggregation

  // Results
  const [running, setRunning] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set(initialSelectedIndices || []));
  const [sampleTotal, setSampleTotal] = useState<number | null>(null);
  const [coverage, setCoverage] = useState<number | null>(null);
  const [rationale, setRationale] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Population display
  const [showPopulation, setShowPopulation] = useState(true);

  // File upload handler — parse CSV/XLSX client-side
  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const buffer = await file.arrayBuffer();
      if (file.name.endsWith('.csv')) {
        const text = new TextDecoder().decode(buffer);
        const lines = text.split(/\r?\n/).filter(l => l.trim());
        if (lines.length < 2) return;
        const headers = lines[0].split(',').map(h => h.replace(/^"|"$/g, '').trim());
        const rows = lines.slice(1).map(line => {
          const vals = line.split(',').map(v => v.replace(/^"|"$/g, '').trim());
          const row: Record<string, any> = {};
          headers.forEach((h, i) => {
            const num = parseFloat(vals[i]?.replace(/[,£$€]/g, '') || '');
            row[h] = !isNaN(num) && vals[i]?.trim() !== '' ? num : vals[i] || '';
          });
          return row;
        });
        setLocalPopulationData(rows);
      } else {
        const wb = XLSX.read(buffer, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        if (ws) {
          const rows = XLSX.utils.sheet_to_json(ws, { defval: '' }) as Record<string, any>[];
          setLocalPopulationData(rows);
        }
      }
    } catch (err) {
      setError('Failed to parse file: ' + (err as Error).message);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  // Aggregate if a column is selected
  const populationData = (() => {
    if (!aggregateColumn || !localPopulationData.length) return localPopulationData;
    const groups = new Map<string, Record<string, any>[]>();
    for (const row of localPopulationData) {
      const key = String(row[aggregateColumn] || '');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(row);
    }
    // If aggregation produces same count as raw data, skip (already at that level)
    if (groups.size === localPopulationData.length) return localPopulationData;

    const cols = Object.keys(localPopulationData[0]);
    const amtCols = cols.filter(c => /amount|total|gross|net|tax|lineamount|unitamount|subtotal|invoiceamountdue|taxamount|taxtotal/i.test(c));
    const qtyCols = cols.filter(c => /quantity|qty/i.test(c));

    return Array.from(groups.entries()).map(([, rows]) => {
      const agg: Record<string, any> = { ...rows[0] };
      for (const c of amtCols) agg[c] = rows.reduce((s, r) => s + (parseFloat(String(r[c] || 0)) || 0), 0);
      for (const c of qtyCols) agg[c] = rows.reduce((s, r) => s + (parseFloat(String(r[c] || 0)) || 0), 0);
      agg._lineItemCount = rows.length;
      return agg;
    });
  })();

  // Auto-detect columns
  const columns = populationData.length > 0 ? Object.keys(populationData[0]) : [];
  useEffect(() => {
    if (columns.length === 0) return;
    // Auto-detect amount column (prefer debit for bank statements, then amount/gross/total)
    if (!amountColumn) {
      const amtCol = columns.find(c => /^debit$/i.test(c))
        || columns.find(c => /^debitFC$/i.test(c))
        || columns.find(c => /amount|gross|net|value|total/i.test(c))
        || columns.find(c => /balance/i.test(c));
      if (amtCol) setAmountColumn(amtCol);
    }
    // Auto-detect ID column (prefer description for bank, then reference/number)
    if (!idColumn) {
      const idCol = columns.find(c => /description|narrative/i.test(c))
        || columns.find(c => /id|ref|reference|number|invoice|transaction/i.test(c));
      if (idCol) setIdColumn(idCol);
      else if (columns[0]) setIdColumn(columns[0]);
    }
  }, [columns.join(',')]);

  const populationCount = populationData.length;
  const populationTotal = populationData.reduce((s, row) => {
    let val = amountColumn ? parseFloat(String(row[amountColumn] || 0)) : 0;
    // For bank data: if amount is 0 and we have debit/credit fields, use whichever is non-zero
    if ((isNaN(val) || val === 0) && (row.debit || row.debitFC || row.credit || row.creditFC)) {
      val = Math.abs(parseFloat(String(row.debit || row.debitFC || 0))) || Math.abs(parseFloat(String(row.credit || row.creditFC || 0)));
    }
    return s + (isNaN(val) ? 0 : Math.abs(val));
  }, 0);

  // Create sampling engagement if needed
  async function ensureSamplingEngagement(): Promise<string> {
    if (samplingEngId) return samplingEngId;
    setCreatingEng(true);
    try {
      const res = await fetch('/api/sampling/engagement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId,
          periodId,
          auditArea: fsLine,
          testingType: 'test_of_details',
          auditData: {
            performanceMateriality: materialityData.performanceMateriality,
            clearlyTrivial: materialityData.clearlyTrivial,
            tolerableMisstatement: materialityData.tolerableMisstatement,
            functionalCurrency: 'GBP',
            dataType: fsLine,
            testType: 'one_tail',
          },
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to create sampling engagement');
      }
      const data = await res.json();
      const id = data.engagement?.id || data.id;
      setSamplingEngId(id);
      return id;
    } finally {
      setCreatingEng(false);
    }
  }

  async function handleRun() {
    if (populationCount === 0) { setError('No population data available'); return; }
    if (!amountColumn) { setError('Please select the Amount column'); setShowMapping(true); return; }

    setRunning(true); setError(null);
    // Clear previous results
    setSelectedIndices(new Set()); setSampleTotal(null); setCoverage(null); setRationale(null); setRunId(null);

    try {
      // Force new engagement each run for fresh seed
      setSamplingEngId(null);
      const engId = await ensureSamplingEngagement();

      const res = await fetch('/api/sampling/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          engagementId: engId,
          populationData,
          columnMapping: {
            transactionId: idColumn || columns[0] || 'id',
            amount: amountColumn,
          },
          method: method === 'stratified' ? 'random' : method,
          stratification: method === 'stratified' ? 'stratified' : 'simple',
          sampleSizeStrategy: sampleSizeMode,
          fixedSampleSize: sampleSizeMode === 'fixed' ? fixedSampleSize : undefined,
          confidence,
          tolerableMisstatement: materialityData.tolerableMisstatement,
          errorMetric,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setRunId(data.runId);
        setSelectedIndices(new Set(data.selectedIndices || []));
        setSampleTotal(data.sampleTotal);
        setCoverage(data.coverage);
        setRationale(data.planningRationale);
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

  function handleConfirm() {
    if (!runId) return;
    onComplete({ runId, selectedIndices: Array.from(selectedIndices), sampleSize: selectedIndices.size, coverage: coverage || 0 });
  }

  function exportCSV() {
    if (selectedIndices.size === 0) return;
    const headers = columns.join(',');
    const rows = populationData.filter((_, i) => selectedIndices.has(i)).map(row => columns.map(col => `"${String(row[col] || '')}"`).join(','));
    const csv = [headers, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `sample_${fsLine}.csv`; a.click(); URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-3">
      {/* Config row: method + size + materiality */}
      <div className="grid grid-cols-12 gap-3">
        {/* Method */}
        <div className="col-span-3">
          <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Method</label>
          <div className="space-y-0.5">
            {METHODS.map(m => (
              <button key={m.key} onClick={() => setMethod(m.key)}
                className={`w-full text-left px-2 py-1 rounded text-[11px] transition-colors ${method === m.key ? 'bg-blue-50 border border-blue-200 text-blue-800 font-medium' : 'border border-slate-100 hover:bg-slate-50 text-slate-600'}`}>
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {/* Statistical Sampling Parameters */}
        <div className="col-span-3 space-y-2">
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Sample Size Determination</label>
            <div className="flex gap-0.5 mb-1.5 bg-slate-100 rounded p-0.5">
              <button onClick={() => setSampleSizeMode('calculator')} className={`flex-1 px-1.5 py-0.5 text-[9px] font-medium rounded ${sampleSizeMode === 'calculator' ? 'bg-white shadow-sm' : 'text-slate-500'}`}>Statistical</button>
              <button onClick={() => setSampleSizeMode('fixed')} className={`flex-1 px-1.5 py-0.5 text-[9px] font-medium rounded ${sampleSizeMode === 'fixed' ? 'bg-white shadow-sm' : 'text-slate-500'}`}>Manual</button>
            </div>
            {sampleSizeMode === 'fixed' && (
              <input type="number" min={1} max={populationCount || 999} value={fixedSampleSize} onChange={e => setFixedSampleSize(parseInt(e.target.value) || 1)}
                className="w-full border rounded px-2 py-1 text-sm" />
            )}
            {sampleSizeMode === 'calculator' && (
              <div className="text-[9px] text-teal-600 bg-teal-50 rounded px-2 py-1">
                Size determined by: Confidence × Tolerable Misstatement ÷ Population Value
              </div>
            )}
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase block mb-0.5">Confidence Level</label>
            <select value={confidence} onChange={e => setConfidence(parseFloat(e.target.value))} className="w-full border rounded px-1.5 py-1 text-xs bg-white">
              <option value={0.80}>80% (Low)</option>
              <option value={0.90}>90% (Moderate)</option>
              <option value={0.95}>95% (High — Default)</option>
              <option value={0.99}>99% (Very High)</option>
            </select>
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase block mb-0.5">Expected Error Rate (%)</label>
            <input type="number" min={0} max={100} step={0.5} value={expectedErrorRate}
              onChange={e => setExpectedErrorRate(parseFloat(e.target.value) || 0)}
              className="w-full border rounded px-1.5 py-1 text-xs" placeholder="0 = no errors expected" />
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase block mb-0.5">Tolerable Misstatement</label>
            <div className="border rounded px-1.5 py-1 text-xs bg-slate-50 font-mono">
              {materialityData.tolerableMisstatement ? `£${Number(materialityData.tolerableMisstatement).toLocaleString('en-GB', { minimumFractionDigits: 2 })}` : 'Not set'}
            </div>
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase block mb-0.5">Error Metric</label>
            <select value={errorMetric} onChange={e => setErrorMetric(e.target.value)} className="w-full border rounded px-1.5 py-1 text-xs bg-white">
              {ERROR_METRICS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
        </div>

        {/* Column mapping */}
        <div className="col-span-3 space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-[10px] font-bold text-slate-500 uppercase">Column Mapping</label>
            <button onClick={() => setShowMapping(!showMapping)} className="text-[9px] text-blue-600 hover:text-blue-800">
              <Settings2 className="h-3 w-3 inline" /> {showMapping ? 'Hide' : 'Show'}
            </button>
          </div>
          {(showMapping || !amountColumn) && columns.length > 0 && (
            <div className="space-y-1.5">
              <div>
                <label className="text-[9px] text-slate-400">ID / Reference Column</label>
                <select value={idColumn} onChange={e => setIdColumn(e.target.value)} className="w-full border rounded px-1.5 py-1 text-xs bg-white">
                  {columns.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[9px] text-slate-400">Amount Column</label>
                <select value={amountColumn} onChange={e => setAmountColumn(e.target.value)} className="w-full border rounded px-1.5 py-1 text-xs bg-white">
                  <option value="">Select...</option>
                  {columns.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[9px] text-slate-400">Aggregate By (optional)</label>
                <select value={aggregateColumn} onChange={e => setAggregateColumn(e.target.value)} className="w-full border rounded px-1.5 py-1 text-xs bg-white">
                  <option value="">No aggregation</option>
                  {columns.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                {aggregateColumn && localPopulationData.length !== populationData.length && (
                  <span className="text-[8px] text-teal-600">{localPopulationData.length} rows → {populationData.length} groups</span>
                )}
              </div>
            </div>
          )}
          {!showMapping && amountColumn && (
            <div className="text-[10px] text-slate-500">
              ID: <span className="font-mono text-slate-700">{idColumn || '(auto)'}</span><br/>
              Amount: <span className="font-mono text-slate-700">{amountColumn}</span>
            </div>
          )}
        </div>

        {/* Stats */}
        <div className="col-span-3 space-y-1.5">
          <div className="bg-slate-50 rounded p-2">
            <span className="text-[9px] text-slate-400 uppercase block">Population</span>
            <span className="text-sm font-bold text-slate-800">{populationCount.toLocaleString()} items</span>
            <span className="text-[10px] text-slate-500 block">{fmt(populationTotal)}</span>
          </div>
          {selectedIndices.size > 0 && (
            <div className="bg-green-50 rounded p-2 border border-green-200">
              <span className="text-[9px] text-green-600 uppercase block">Selected</span>
              <span className="text-sm font-bold text-green-800">{selectedIndices.size} items</span>
              <span className="text-[10px] text-green-600 block">{fmt(sampleTotal)} ({coverage?.toFixed(1)}%)</span>
            </div>
          )}
          <div className="text-[9px] space-y-0.5">
            <div className="flex justify-between"><span className="text-slate-400">PM</span><span className="font-mono text-slate-600">{fmt(materialityData.performanceMateriality)}</span></div>
            <div className="flex justify-between"><span className="text-slate-400">CT</span><span className="font-mono text-slate-600">{fmt(materialityData.clearlyTrivial)}</span></div>
            <div className="flex justify-between"><span className="text-slate-400">TM</span><span className="font-mono text-slate-600">{fmt(materialityData.tolerableMisstatement)}</span></div>
          </div>
        </div>
      </div>

      {/* Aggregation option — always visible before sampling */}
      {localPopulationData.length > 0 && columns.length > 0 && (
        <div className="flex items-center gap-3 px-3 py-2 bg-slate-50 rounded-lg border border-slate-200">
          <label className="text-xs font-medium text-slate-600 shrink-0">Aggregate by:</label>
          <select value={aggregateColumn} onChange={e => setAggregateColumn(e.target.value)} className="border rounded px-2 py-1 text-xs bg-white min-w-[150px]">
            <option value="">No aggregation (line items)</option>
            {columns.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          {aggregateColumn && localPopulationData.length !== populationData.length && (
            <span className="text-xs text-teal-600 font-medium">{localPopulationData.length} line items → {populationData.length} {aggregateColumn}s</span>
          )}
          {!aggregateColumn && (
            <span className="text-[10px] text-slate-400">Optional — group line items by invoice/document number before sampling</span>
          )}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-2 flex-wrap">
        <Button onClick={handleRun} disabled={running || creatingEng || populationCount === 0} className="bg-green-600 hover:bg-green-700">
          {running || creatingEng ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />}
          {running ? 'Running...' : creatingEng ? 'Creating...' : selectedIndices.size > 0 ? 'Re-run Sample' : 'Run Sample'}
        </Button>
        {selectedIndices.size > 0 && (
          <>
            <Button onClick={handleConfirm} className="bg-blue-600 hover:bg-blue-700">
              Confirm Sample — Continue Flow
            </Button>
            <button onClick={exportCSV} className="text-[10px] text-slate-500 hover:text-slate-700 flex items-center gap-1">
              <Download className="h-3 w-3" /> Export CSV
            </button>
          </>
        )}
        <label className="inline-flex items-center gap-1 text-[10px] text-slate-500 hover:text-slate-700 cursor-pointer">
          <Upload className="h-3 w-3" /> {populationCount > 0 ? 'Replace Data' : 'Upload Data'}
          <input type="file" accept=".csv,.xlsx,.xls" onChange={handleFileUpload} className="hidden" />
        </label>
        {error && <span className="text-xs text-red-500 flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> {error}</span>}
      </div>

      {/* Rationale */}
      {rationale && (
        <div className="bg-blue-50 border border-blue-200 rounded px-3 py-2 text-xs text-blue-700">
          <strong>Rationale:</strong> {rationale}
        </div>
      )}

      {/* Population table */}
      {populationCount > 0 && (
        <div>
          <button onClick={() => setShowPopulation(!showPopulation)} className="flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-800 mb-1">
            {showPopulation ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            Population Data ({populationCount} items{selectedIndices.size > 0 ? `, ${selectedIndices.size} selected` : ''})
          </button>
          {showPopulation && (
            <div className="border rounded-lg overflow-auto max-h-[350px]">
              <table className="w-full text-xs border-collapse">
                <thead className="sticky top-0 z-10 bg-slate-100">
                  <tr>
                    <th className="px-2 py-1.5 text-left font-semibold text-slate-600 w-8">#</th>
                    {selectedIndices.size > 0 && <th className="px-2 py-1.5 text-center font-semibold text-slate-600 w-8">Sel</th>}
                    {columns.slice(0, 8).map(col => (
                      <th key={col} className={`px-2 py-1.5 text-left font-semibold truncate max-w-[120px] ${col === amountColumn ? 'text-blue-600' : col === idColumn ? 'text-green-600' : 'text-slate-600'}`}>
                        {col}
                        {col === amountColumn && <span className="text-[7px] ml-0.5 text-blue-400">(amt)</span>}
                        {col === idColumn && <span className="text-[7px] ml-0.5 text-green-400">(id)</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {populationData.map((row, i) => {
                    const isSelected = selectedIndices.has(i);
                    const isPrior = expandedMode && priorSet.has(i);
                    const isNewExpanded = expandedMode && isSelected && !isPrior;
                    return (
                      <tr key={i} className={isPrior ? 'bg-green-50' : isNewExpanded ? 'bg-blue-50' : isSelected ? 'bg-green-50' : i % 2 ? 'bg-slate-50/30' : ''}>
                        <td className="px-2 py-1 text-slate-400 font-mono">{i + 1}</td>
                        {(selectedIndices.size > 0 || priorSet.size > 0) && (
                          <td className="px-2 py-1 text-center">
                            {isPrior && <span className="inline-block w-3 h-3 rounded-full bg-green-500" title="Original sample" />}
                            {isNewExpanded && <span className="inline-block w-3 h-3 rounded-full bg-blue-500" title="Expanded sample" />}
                            {isSelected && !expandedMode && <span className="inline-block w-3 h-3 rounded-full bg-green-500" />}
                          </td>
                        )}
                        {columns.slice(0, 8).map(col => (
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

      {/* No data / upload */}
      {populationCount === 0 && (
        <div className="border-2 border-dashed border-amber-300 rounded-lg p-6 bg-amber-50/30 text-center">
          <Upload className="h-8 w-8 text-amber-400 mx-auto mb-2" />
          <p className="text-sm text-amber-700 font-medium mb-1">Load Population Data</p>
          <p className="text-xs text-amber-600 mb-3">Upload the client's data file (CSV or XLSX) to populate the sampling calculator.</p>
          <label className="inline-flex items-center gap-2 px-4 py-2 bg-amber-600 text-white text-sm font-medium rounded-lg hover:bg-amber-700 cursor-pointer transition-colors">
            <Upload className="h-4 w-4" /> Upload CSV / XLSX
            <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls" onChange={handleFileUpload} className="hidden" />
          </label>
        </div>
      )}

      {/* Hidden file input for re-upload when data exists */}
      <input ref={populationCount > 0 ? undefined : fileInputRef} type="file" accept=".csv,.xlsx,.xls" onChange={handleFileUpload} className="hidden" />
    </div>
  );
}
