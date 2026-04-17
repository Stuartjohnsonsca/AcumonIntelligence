'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

/**
 * Renders the GM calculations table (per period) and the variance table
 * (per comparison). For pipelines that deal in aggregate numbers rather
 * than samples, the "Data & Sampling" section is the main place to
 * review the actual audit evidence, so we expose it expanded by default.
 */

interface Props {
  pipelineState: Record<number | string, any> | null | undefined;
}

function PeriodsTable({ rows }: { rows: any[] }) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return <div className="text-[11px] text-slate-400 italic py-2">No period data yet.</div>;
  }
  return (
    <div className="overflow-x-auto border rounded">
      <table className="w-full text-[11px]">
        <thead className="bg-slate-100 text-slate-600">
          <tr>
            <th className="text-left px-2 py-1 font-medium">Period</th>
            <th className="text-right px-2 py-1 font-medium">Revenue</th>
            <th className="text-right px-2 py-1 font-medium">Cost of Sales</th>
            <th className="text-right px-2 py-1 font-medium">Gross Profit</th>
            <th className="text-right px-2 py-1 font-medium">GM %</th>
            <th className="text-left px-2 py-1 font-medium">Source</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-slate-100">
              <td className="px-2 py-1 text-slate-700">{r.period_label || r.period || '—'}</td>
              <td className="px-2 py-1 text-right text-slate-700">{Number(r.revenue || 0).toLocaleString()}</td>
              <td className="px-2 py-1 text-right text-slate-700">{Number(r.cost_of_sales || 0).toLocaleString()}</td>
              <td className="px-2 py-1 text-right text-slate-700">{Number(r.gross_profit || 0).toLocaleString()}</td>
              <td className="px-2 py-1 text-right text-slate-700">{r.gm_pct != null ? `${r.gm_pct}%` : '—'}</td>
              <td className="px-2 py-1 text-slate-500 text-[10px]">{r.source || ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function VarianceTable({ rows }: { rows: any[] }) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return <div className="text-[11px] text-slate-400 italic py-2">No variances yet.</div>;
  }
  return (
    <div className="overflow-x-auto border rounded">
      <table className="w-full text-[11px]">
        <thead className="bg-slate-100 text-slate-600">
          <tr>
            <th className="text-left px-2 py-1 font-medium">Comparison</th>
            <th className="text-right px-2 py-1 font-medium">Expected GM%</th>
            <th className="text-right px-2 py-1 font-medium">Actual GM%</th>
            <th className="text-right px-2 py-1 font-medium">Variance (pp)</th>
            <th className="text-right px-2 py-1 font-medium">£ Impact</th>
            <th className="text-center px-2 py-1 font-medium">Flag</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-slate-100">
              <td className="px-2 py-1 text-slate-700">{r.comparison_label}</td>
              <td className="px-2 py-1 text-right text-slate-700">{r.expected_gm_pct != null ? `${r.expected_gm_pct}%` : '—'}</td>
              <td className="px-2 py-1 text-right text-slate-700">{r.actual_gm_pct != null ? `${r.actual_gm_pct}%` : '—'}</td>
              <td className={`px-2 py-1 text-right ${r.flagged ? 'font-bold text-amber-700' : 'text-slate-700'}`}>{r.variance_pct != null ? `${r.variance_pct}pp` : '—'}</td>
              <td className={`px-2 py-1 text-right ${r.flagged ? 'font-bold text-amber-700' : 'text-slate-700'}`}>{Number(r.variance_amount || 0).toLocaleString()}</td>
              <td className="px-2 py-1 text-center">
                {r.flagged ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-semibold" title={r.flag_reason}>Amber</span> : <span className="text-[10px] text-slate-400">—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DataCalculationsSection({ pipelineState }: Props) {
  const [openPeriods, setOpenPeriods] = useState(true);
  const [openVariances, setOpenVariances] = useState(true);

  const state = pipelineState || {};
  const data = state[0] || state['0'] || {};
  const analysis = state[1] || state['1'] || {};

  const periods: any[] = Array.isArray(analysis.calculations) ? analysis.calculations : (Array.isArray(data.data_table) ? data.data_table : []);
  const variances: any[] = Array.isArray(analysis.variances) ? analysis.variances : [];

  return (
    <div className="border rounded-lg">
      <div className="bg-teal-50 px-3 py-2 border-b flex items-center justify-between">
        <h4 className="text-[10px] font-bold text-teal-700 uppercase tracking-wider">Data &amp; Calculations</h4>
        <div className="flex items-center gap-3 text-[10px] text-slate-600">
          {analysis.actual_gm_pct != null && <span>Actual: <strong>{analysis.actual_gm_pct}%</strong></span>}
          {analysis.expected_gm_pct != null && <span>Expected: <strong>{analysis.expected_gm_pct}%</strong></span>}
          {analysis.flagged_count != null && <span>Flagged: <strong className={analysis.flagged_count > 0 ? 'text-amber-700' : 'text-green-700'}>{analysis.flagged_count}</strong></span>}
          {analysis.performance_materiality != null && analysis.performance_materiality > 0 && (
            <span>PM: <strong>{Number(analysis.performance_materiality).toLocaleString()}</strong></span>
          )}
          {data.tb_reconciled === 'fail' && <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-700 font-semibold">TB mismatch</span>}
        </div>
      </div>
      <div className="p-3 space-y-2">
        <button onClick={() => setOpenPeriods(v => !v)} className="w-full flex items-center gap-1.5 text-[11px] font-medium text-slate-700 hover:text-slate-900">
          {openPeriods ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          P&amp;L by Period ({periods.length})
        </button>
        {openPeriods && <PeriodsTable rows={periods} />}

        <button onClick={() => setOpenVariances(v => !v)} className="w-full flex items-center gap-1.5 text-[11px] font-medium text-slate-700 hover:text-slate-900">
          {openVariances ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          Variance Table ({variances.length})
        </button>
        {openVariances && <VarianceTable rows={variances} />}

        {data.management_commentary && (
          <div className="border rounded bg-slate-50 p-2 text-[11px] text-slate-700">
            <div className="text-[10px] font-bold text-slate-500 uppercase mb-1">Management Commentary</div>
            <div className="whitespace-pre-wrap">{data.management_commentary}</div>
          </div>
        )}
      </div>
    </div>
  );
}
