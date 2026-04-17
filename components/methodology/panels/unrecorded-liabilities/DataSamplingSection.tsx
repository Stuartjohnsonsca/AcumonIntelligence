'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

/**
 * Renders the post-YE payments population (step 1 output) and the
 * selected sample (step 3 output) with its three-layer breakdown.
 */

interface Props {
  pipelineState: Record<number | string, any> | null | undefined;
}

function DataTable({ rows, emptyMsg }: { rows: any[]; emptyMsg: string }) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return <div className="text-[11px] text-slate-400 italic py-2">{emptyMsg}</div>;
  }
  const keys = Object.keys(rows[0]).slice(0, 8);
  return (
    <div className="overflow-x-auto border rounded">
      <table className="w-full text-[11px]">
        <thead className="bg-slate-100 text-slate-600">
          <tr>{keys.map(k => <th key={k} className="text-left px-2 py-1 font-medium">{k}</th>)}</tr>
        </thead>
        <tbody>
          {rows.slice(0, 50).map((r, i) => (
            <tr key={i} className="border-t border-slate-100">
              {keys.map(k => {
                const v = r[k];
                const display = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
                return <td key={k} className="px-2 py-1 text-slate-700 truncate max-w-[18ch]">{display}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 50 && <div className="text-[10px] text-slate-400 px-2 py-1">… {rows.length - 50} more rows</div>}
    </div>
  );
}

export function DataSamplingSection({ pipelineState }: Props) {
  const [openPop, setOpenPop] = useState(false);
  const [openSample, setOpenSample] = useState(true);

  const state = pipelineState || {};
  const bankExtract = state[1] || state['1'] || {};
  const sample = state[3] || state['3'] || {};

  const population: any[] = Array.isArray(bankExtract.data_table) ? bankExtract.data_table : [];
  const items: any[] = Array.isArray(sample.sample_items) ? sample.sample_items : [];

  return (
    <div className="border rounded-lg">
      <div className="bg-purple-50 px-3 py-2 border-b flex items-center justify-between">
        <h4 className="text-[10px] font-bold text-purple-700 uppercase tracking-wider">Data &amp; Sampling</h4>
        <div className="flex items-center gap-3 text-[10px] text-slate-600">
          {bankExtract.population_size != null && <span>Population: <strong>{bankExtract.population_size}</strong></span>}
          {bankExtract.total_value != null && <span>Total: <strong>{Number(bankExtract.total_value).toLocaleString()}</strong></span>}
          {sample.sample_size != null && <span>Sample: <strong>{sample.sample_size}</strong></span>}
        </div>
      </div>
      <div className="p-3 space-y-2">
        {(sample.above_threshold_count != null || sample.ai_selected_count != null || sample.residual_selected_count != null) && (
          <div className="flex items-center gap-3 text-[10px] text-slate-600 mb-1">
            <span className="px-1.5 py-0.5 rounded bg-red-50 text-red-700 border border-red-200">Above threshold: {sample.above_threshold_count ?? 0}</span>
            <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">AI risk: {sample.ai_selected_count ?? 0}</span>
            <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">Residual: {sample.residual_selected_count ?? 0}</span>
          </div>
        )}

        <button onClick={() => setOpenPop(v => !v)} className="w-full flex items-center gap-1.5 text-[11px] font-medium text-slate-700 hover:text-slate-900">
          {openPop ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          Post-YE payments ({population.length})
        </button>
        {openPop && <DataTable rows={population} emptyMsg="No post-YE payments extracted yet." />}

        <button onClick={() => setOpenSample(v => !v)} className="w-full flex items-center gap-1.5 text-[11px] font-medium text-slate-700 hover:text-slate-900">
          {openSample ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          Selected sample ({items.length})
        </button>
        {openSample && <DataTable rows={items} emptyMsg="No sample selected yet." />}
      </div>
    </div>
  );
}
