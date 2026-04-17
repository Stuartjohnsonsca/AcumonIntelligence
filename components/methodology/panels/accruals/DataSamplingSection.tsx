'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

/**
 * Renders the accruals population (step 0 output) and the selected
 * sample (step 1 output). Read-only — sampling method selection is
 * handled by the existing select_sample pause UI elsewhere. This
 * section is for reviewing what the pipeline has done so far.
 */

interface Props {
  // pipelineState keys are string in JSON, but runtime access by number works.
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
  const listing = state[0] || state['0'] || {};
  const sampling = state[1] || state['1'] || {};

  const population: any[] = Array.isArray(listing.data_table) ? listing.data_table : [];
  const sample: any[] = Array.isArray(sampling.sample_items) ? sampling.sample_items : (Array.isArray(sampling.data_table) ? sampling.data_table : []);

  const listingTotal = listing.listing_total;
  const tbTotal = listing.tb_total;
  const variance = listing.variance;
  const reconciled = listing.tb_reconciled;

  return (
    <div className="border rounded-lg">
      <div className="bg-blue-50 px-3 py-2 border-b flex items-center justify-between">
        <h4 className="text-[10px] font-bold text-blue-700 uppercase tracking-wider">Data &amp; Sampling</h4>
        <div className="flex items-center gap-3 text-[10px] text-slate-600">
          {listingTotal != null && <span>Listing: <strong>{Number(listingTotal).toLocaleString()}</strong></span>}
          {tbTotal != null && <span>TB: <strong>{Number(tbTotal).toLocaleString()}</strong></span>}
          {variance != null && (
            <span>Variance: <strong className={reconciled === 'pass' ? 'text-green-700' : 'text-red-700'}>{Number(variance).toLocaleString()}</strong></span>
          )}
        </div>
      </div>
      <div className="p-3 space-y-2">
        <button onClick={() => setOpenPop(v => !v)} className="w-full flex items-center gap-1.5 text-[11px] font-medium text-slate-700 hover:text-slate-900">
          {openPop ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          Accruals population ({population.length})
        </button>
        {openPop && <DataTable rows={population} emptyMsg="No accruals listing received yet." />}

        <button onClick={() => setOpenSample(v => !v)} className="w-full flex items-center gap-1.5 text-[11px] font-medium text-slate-700 hover:text-slate-900">
          {openSample ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          Selected sample ({sample.length})
        </button>
        {openSample && <DataTable rows={sample} emptyMsg="No sample selected yet." />}
      </div>
    </div>
  );
}
