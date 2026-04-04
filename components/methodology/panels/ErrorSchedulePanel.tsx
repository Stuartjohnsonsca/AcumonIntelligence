'use client';

import { useState, useEffect } from 'react';
import { Loader2, Download, AlertTriangle, CheckCircle2, XCircle, AlertOctagon } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ErrorEntry {
  id: string;
  fsLine: string;
  accountCode: string | null;
  description: string;
  errorAmount: number;
  errorType: string;
  explanation: string | null;
  isFraud: boolean;
  committedByName: string | null;
  committedAt: string | null;
}

interface Props {
  engagementId: string;
  materiality?: number;
  performanceMateriality?: number;
  clearlyTrivial?: number;
  onClose?: () => void;
}

function fmt(n: number): string {
  const abs = Math.abs(n);
  const f = abs.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `(${f})` : f;
}

export function ErrorSchedulePanel({ engagementId, materiality = 0, performanceMateriality = 0, clearlyTrivial = 0, onClose }: Props) {
  const [errors, setErrors] = useState<ErrorEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/engagements/${engagementId}/error-schedule`)
      .then(r => r.ok ? r.json() : { errors: [] })
      .then(d => setErrors(d.errors || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [engagementId]);

  const totalDr = errors.reduce((s, e) => s + (e.errorAmount > 0 ? e.errorAmount : 0), 0);
  const totalCr = errors.reduce((s, e) => s + (e.errorAmount < 0 ? Math.abs(e.errorAmount) : 0), 0);
  const netError = errors.reduce((s, e) => s + e.errorAmount, 0);
  const factualErrors = errors.filter(e => e.errorType === 'factual');
  const judgementalErrors = errors.filter(e => e.errorType === 'judgemental');
  const projectedErrors = errors.filter(e => e.errorType === 'projected');
  const fraudErrors = errors.filter(e => e.isFraud);

  const netConclusion = Math.abs(netError) <= clearlyTrivial ? 'green' : Math.abs(netError) <= performanceMateriality ? 'orange' : 'red';

  function downloadExcel() {
    const headers = ['FS Line', 'Account Code', 'Description', 'Error Amount', 'Dr/Cr', 'Type', 'Fraud', 'Explanation', 'Committed By', 'Date'];
    const csvRows = errors.map(e => [
      e.fsLine, e.accountCode || '', e.description, Math.abs(e.errorAmount).toFixed(2),
      e.errorAmount >= 0 ? 'Dr' : 'Cr', e.errorType, e.isFraud ? 'Yes' : 'No',
      e.explanation || '', e.committedByName || '',
      e.committedAt ? new Date(e.committedAt).toLocaleDateString('en-GB') : '',
    ].map(v => `"${v}"`).join(','));
    const csv = [headers.join(','), ...csvRows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'error_schedule.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  if (loading) return <div className="p-8 text-center"><Loader2 className="h-5 w-5 animate-spin text-blue-500 mx-auto" /></div>;

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-6 gap-3 text-xs">
        <div className="bg-slate-50 rounded-lg p-3 text-center">
          <div className="text-[9px] text-slate-400 uppercase">Total Errors</div>
          <div className="text-lg font-bold text-slate-800">{errors.length}</div>
        </div>
        <div className="bg-slate-50 rounded-lg p-3 text-center">
          <div className="text-[9px] text-slate-400 uppercase">Total Dr</div>
          <div className="text-sm font-bold text-slate-800">£{fmt(totalDr)}</div>
        </div>
        <div className="bg-slate-50 rounded-lg p-3 text-center">
          <div className="text-[9px] text-slate-400 uppercase">Total Cr</div>
          <div className="text-sm font-bold text-slate-800">£{fmt(totalCr)}</div>
        </div>
        <div className={`rounded-lg p-3 text-center ${netConclusion === 'green' ? 'bg-green-50' : netConclusion === 'orange' ? 'bg-orange-50' : 'bg-red-50'}`}>
          <div className="text-[9px] text-slate-400 uppercase">Net Error</div>
          <div className={`text-sm font-bold ${netConclusion === 'green' ? 'text-green-700' : netConclusion === 'orange' ? 'text-orange-700' : 'text-red-700'}`}>
            £{fmt(netError)}
          </div>
        </div>
        <div className="bg-slate-50 rounded-lg p-3 text-center">
          <div className="text-[9px] text-slate-400 uppercase">Materiality</div>
          <div className="text-sm font-bold text-slate-800">£{fmt(materiality)}</div>
        </div>
        <div className="bg-slate-50 rounded-lg p-3 text-center">
          <div className="text-[9px] text-slate-400 uppercase">PM</div>
          <div className="text-sm font-bold text-slate-800">£{fmt(performanceMateriality)}</div>
        </div>
      </div>

      {/* Type breakdown */}
      <div className="flex items-center gap-4 text-[10px]">
        <span className="text-slate-500">Factual: <span className="font-bold text-slate-700">{factualErrors.length}</span></span>
        <span className="text-slate-500">Judgemental: <span className="font-bold text-slate-700">{judgementalErrors.length}</span></span>
        <span className="text-slate-500">Projected: <span className="font-bold text-slate-700">{projectedErrors.length}</span></span>
        {fraudErrors.length > 0 && <span className="text-red-600 font-bold"><AlertOctagon className="h-3 w-3 inline mr-0.5" />Fraud: {fraudErrors.length}</span>}
        <div className="ml-auto">
          <Button onClick={downloadExcel} size="sm" variant="outline" className="h-7 text-[10px]">
            <Download className="h-3 w-3 mr-1" /> Export CSV
          </Button>
        </div>
      </div>

      {/* Error table */}
      {errors.length === 0 ? (
        <div className="text-center py-8 text-slate-400 text-sm">
          <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-green-300" />
          No errors on the schedule
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-100 border-b">
                <th className="text-left px-2 py-1.5 font-semibold text-slate-600">FS Line</th>
                <th className="text-left px-2 py-1.5 font-semibold text-slate-600 w-16">Code</th>
                <th className="text-left px-2 py-1.5 font-semibold text-slate-600">Description</th>
                <th className="text-right px-2 py-1.5 font-semibold text-slate-600 w-24">Amount</th>
                <th className="text-left px-2 py-1.5 font-semibold text-slate-600 w-20">Type</th>
                <th className="text-center px-2 py-1.5 font-semibold text-slate-600 w-12">Fraud</th>
                <th className="text-left px-2 py-1.5 font-semibold text-slate-600">Explanation</th>
                <th className="text-left px-2 py-1.5 font-semibold text-slate-600 w-24">By</th>
              </tr>
            </thead>
            <tbody>
              {errors.map((err, i) => (
                <tr key={err.id} className={`border-b border-slate-50 ${i % 2 ? 'bg-slate-50/20' : ''} ${err.isFraud ? 'bg-red-50/30' : ''}`}>
                  <td className="px-2 py-1.5 text-slate-700 font-medium">{err.fsLine}</td>
                  <td className="px-2 py-1.5 text-slate-500 font-mono">{err.accountCode || ''}</td>
                  <td className="px-2 py-1.5 text-slate-700 truncate max-w-[200px]">{err.description}</td>
                  <td className={`px-2 py-1.5 text-right font-mono font-medium ${err.errorAmount < 0 ? 'text-red-600 pl-4' : 'text-slate-800'}`}>
                    £{fmt(err.errorAmount)}
                  </td>
                  <td className="px-2 py-1.5">
                    <span className={`text-[9px] px-1 py-0.5 rounded font-medium ${
                      err.errorType === 'factual' ? 'bg-blue-100 text-blue-700' :
                      err.errorType === 'judgemental' ? 'bg-purple-100 text-purple-700' :
                      'bg-amber-100 text-amber-700'
                    }`}>{err.errorType}</span>
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    {err.isFraud && <AlertOctagon className="h-3.5 w-3.5 text-red-500 mx-auto" />}
                  </td>
                  <td className="px-2 py-1.5 text-slate-500 truncate max-w-[200px]" title={err.explanation || ''}>{err.explanation || ''}</td>
                  <td className="px-2 py-1.5 text-slate-400 text-[10px]">{err.committedByName || ''}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-slate-100 border-t-2">
                <td colSpan={3} className="px-2 py-2 font-bold text-slate-700">Total</td>
                <td className={`px-2 py-2 text-right font-mono font-bold ${netConclusion === 'red' ? 'text-red-700' : netConclusion === 'orange' ? 'text-orange-700' : 'text-green-700'}`}>
                  £{fmt(netError)}
                </td>
                <td colSpan={4}></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Materiality comparison */}
      {errors.length > 0 && (
        <div className={`px-4 py-3 rounded-lg text-center text-sm font-bold ${
          netConclusion === 'green' ? 'bg-green-100 text-green-700' :
          netConclusion === 'orange' ? 'bg-orange-100 text-orange-700' :
          'bg-red-100 text-red-700'
        }`}>
          {netConclusion === 'green' ? 'Net errors below Clearly Trivial — no further action required' :
           netConclusion === 'orange' ? 'Net errors above Clearly Trivial but below Performance Materiality — consider impact' :
           'Net errors exceed Performance Materiality — material misstatement identified'}
        </div>
      )}
    </div>
  );
}
