'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, FileText, Eye, CheckCircle2, XCircle, Clock, AlertTriangle, X } from 'lucide-react';

interface SampleRow {
  index: number;
  reference: string;
  customer: string;
  description: string;
  date: string;
  net: number;
  tax: number;
  gross: number;
}

interface EvidenceDoc {
  sampleIndex: number;
  fileName: string;
  docRef: string;
  date: string;
  seller: string;
  net: number;
  tax: number;
  gross: number;
  status: 'matched' | 'partial' | 'missing' | 'pending';
  previewUrl?: string;
}

interface VerificationCheck {
  sampleIndex: number;
  amountMatch: 'pass' | 'fail' | 'pending';
  dateMatch: 'pass' | 'fail' | 'pending';
  periodCheck: 'pass' | 'fail' | 'pending';
  sellerMatch: 'pass' | 'fail' | 'pending';
  overallResult: 'pass' | 'fail' | 'pending';
  aiNotes?: string;
  difference?: number;
}

interface Props {
  sampleItems: SampleRow[];
  evidenceDocs: EvidenceDoc[];
  verificationResults: VerificationCheck[];
  onRowClick?: (index: number) => void;
}

function fmt(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return '—';
  const abs = Math.abs(n);
  const f = abs.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `(${f})` : f;
}

function CheckIcon({ status }: { status: string }) {
  if (status === 'pass') return <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />;
  if (status === 'fail') return <XCircle className="h-3.5 w-3.5 text-red-500" />;
  return <Clock className="h-3.5 w-3.5 text-slate-300" />;
}

export function AuditVerificationPanel({ sampleItems, evidenceDocs, verificationResults, onRowClick }: Props) {
  const [selectedRow, setSelectedRow] = useState<number | null>(null);
  const [previewDoc, setPreviewDoc] = useState<EvidenceDoc | null>(null);

  const passCount = verificationResults.filter(r => r.overallResult === 'pass').length;
  const failCount = verificationResults.filter(r => r.overallResult === 'fail').length;
  const pendingCount = sampleItems.length - passCount - failCount;

  function handleRowClick(idx: number) {
    setSelectedRow(selectedRow === idx ? null : idx);
    onRowClick?.(idx);
    const doc = evidenceDocs.find(d => d.sampleIndex === idx);
    if (doc?.previewUrl) setPreviewDoc(doc);
  }

  return (
    <div className="flex border rounded-lg overflow-hidden bg-white" style={{ minHeight: 400 }}>
      {/* LEFT: Three-section spreadsheet (75%) */}
      <div className="flex-1 overflow-auto">
        {/* Summary bar */}
        <div className="flex items-center gap-4 px-3 py-2 bg-slate-50 border-b text-xs">
          <span className="text-slate-500">{sampleItems.length} items</span>
          <span className="text-green-600 font-medium">{passCount} passed</span>
          {failCount > 0 && <span className="text-red-600 font-medium">{failCount} failed</span>}
          {pendingCount > 0 && <span className="text-slate-400">{pendingCount} pending</span>}
        </div>

        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0 z-10">
            {/* Section headers */}
            <tr>
              <th colSpan={5} className="bg-blue-600 text-white text-[10px] font-semibold px-2 py-1 text-left border-r-2 border-white">
                Sample Request (from TB)
              </th>
              <th colSpan={4} className="bg-green-600 text-white text-[10px] font-semibold px-2 py-1 text-left border-r-2 border-white">
                Client Evidence (uploaded)
              </th>
              <th colSpan={5} className="bg-amber-600 text-white text-[10px] font-semibold px-2 py-1 text-left">
                Audit Verification
              </th>
            </tr>
            {/* Column sub-headers */}
            <tr className="bg-slate-100 border-b text-[10px] text-slate-600 font-semibold">
              {/* Blue */}
              <th className="px-2 py-1 text-left border-r border-slate-200 w-8">#</th>
              <th className="px-2 py-1 text-left border-r border-slate-200 w-16">Ref</th>
              <th className="px-2 py-1 text-left border-r border-slate-200">Customer</th>
              <th className="px-2 py-1 text-right border-r border-slate-200 w-20">Gross</th>
              <th className="px-2 py-1 text-left border-r-2 border-blue-200 w-16">Date</th>
              {/* Green */}
              <th className="px-2 py-1 text-left border-r border-slate-200 w-16">Doc</th>
              <th className="px-2 py-1 text-left border-r border-slate-200">Seller</th>
              <th className="px-2 py-1 text-right border-r border-slate-200 w-20">Gross</th>
              <th className="px-2 py-1 text-center border-r-2 border-green-200 w-14">Status</th>
              {/* Amber */}
              <th className="px-2 py-1 text-center border-r border-slate-200 w-10">Amt</th>
              <th className="px-2 py-1 text-center border-r border-slate-200 w-10">Date</th>
              <th className="px-2 py-1 text-center border-r border-slate-200 w-10">Period</th>
              <th className="px-2 py-1 text-center border-r border-slate-200 w-10">Seller</th>
              <th className="px-2 py-1 text-center w-14">Result</th>
            </tr>
          </thead>
          <tbody>
            {sampleItems.map((item, i) => {
              const doc = evidenceDocs.find(d => d.sampleIndex === i);
              const check = verificationResults.find(r => r.sampleIndex === i);
              const isSelected = selectedRow === i;
              return (
                <tr
                  key={i}
                  onClick={() => handleRowClick(i)}
                  className={`border-b border-slate-100 cursor-pointer transition-colors ${
                    isSelected ? 'bg-blue-50 border-l-2 border-l-blue-500' :
                    check?.overallResult === 'fail' ? 'bg-red-50/30 hover:bg-red-50/50' :
                    check?.overallResult === 'pass' ? 'hover:bg-green-50/30' :
                    'hover:bg-slate-50'
                  }`}
                >
                  {/* Blue: Sample */}
                  <td className="px-2 py-1.5 text-slate-400 font-mono border-r border-slate-100">{i + 1}</td>
                  <td className="px-2 py-1.5 text-slate-700 font-mono border-r border-slate-100">{item.reference}</td>
                  <td className="px-2 py-1.5 text-slate-700 border-r border-slate-100 truncate max-w-[150px]">{item.customer}</td>
                  <td className="px-2 py-1.5 text-right font-mono text-slate-800 border-r border-slate-100">{fmt(item.gross)}</td>
                  <td className="px-2 py-1.5 text-slate-500 border-r-2 border-blue-100">{item.date || '—'}</td>
                  {/* Green: Evidence */}
                  <td className="px-2 py-1.5 text-slate-600 font-mono border-r border-slate-100">{doc?.docRef || '—'}</td>
                  <td className="px-2 py-1.5 text-slate-600 border-r border-slate-100 truncate max-w-[120px]">{doc?.seller || '—'}</td>
                  <td className="px-2 py-1.5 text-right font-mono text-slate-800 border-r border-slate-100">{doc ? fmt(doc.gross) : '—'}</td>
                  <td className="px-2 py-1.5 text-center border-r-2 border-green-100">
                    {doc ? (
                      <span className={`text-[8px] px-1 py-0.5 rounded-full font-medium ${
                        doc.status === 'matched' ? 'bg-green-100 text-green-700' :
                        doc.status === 'partial' ? 'bg-amber-100 text-amber-700' :
                        doc.status === 'missing' ? 'bg-red-100 text-red-600' :
                        'bg-slate-100 text-slate-500'
                      }`}>{doc.status}</span>
                    ) : <span className="text-[8px] text-slate-300">—</span>}
                  </td>
                  {/* Amber: Verification */}
                  <td className="px-2 py-1.5 text-center border-r border-slate-100"><CheckIcon status={check?.amountMatch || 'pending'} /></td>
                  <td className="px-2 py-1.5 text-center border-r border-slate-100"><CheckIcon status={check?.dateMatch || 'pending'} /></td>
                  <td className="px-2 py-1.5 text-center border-r border-slate-100"><CheckIcon status={check?.periodCheck || 'pending'} /></td>
                  <td className="px-2 py-1.5 text-center border-r border-slate-100"><CheckIcon status={check?.sellerMatch || 'pending'} /></td>
                  <td className="px-2 py-1.5 text-center">
                    {check?.overallResult === 'pass' && <span className="text-[8px] font-bold text-green-600 bg-green-50 px-1.5 py-0.5 rounded">PASS</span>}
                    {check?.overallResult === 'fail' && <span className="text-[8px] font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded">FAIL</span>}
                    {(!check || check.overallResult === 'pending') && <span className="text-[8px] text-slate-300">—</span>}
                  </td>
                </tr>
              );
            })}
            {sampleItems.length === 0 && (
              <tr><td colSpan={14} className="px-4 py-8 text-center text-sm text-slate-400">No sample items to verify yet</td></tr>
            )}
          </tbody>
        </table>

        {/* Selected row detail — shows AI notes and difference */}
        {selectedRow !== null && (() => {
          const check = verificationResults.find(r => r.sampleIndex === selectedRow);
          const item = sampleItems[selectedRow];
          const doc = evidenceDocs.find(d => d.sampleIndex === selectedRow);
          if (!check && !doc) return null;
          return (
            <div className="border-t bg-slate-50 px-4 py-3">
              <div className="grid grid-cols-2 gap-4 text-xs">
                <div>
                  <div className="text-[10px] font-bold text-blue-600 uppercase mb-1">Sample Item</div>
                  <div className="space-y-0.5">
                    <div><span className="text-slate-400">Customer:</span> <span className="text-slate-700">{item?.customer}</span></div>
                    <div><span className="text-slate-400">Ref:</span> <span className="font-mono text-slate-700">{item?.reference}</span></div>
                    <div><span className="text-slate-400">Net:</span> <span className="font-mono">£{fmt(item?.net)}</span> <span className="text-slate-400">VAT:</span> <span className="font-mono">£{fmt(item?.tax)}</span> <span className="text-slate-400">Gross:</span> <span className="font-mono font-semibold">£{fmt(item?.gross)}</span></div>
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-bold text-green-600 uppercase mb-1">Evidence Document</div>
                  {doc ? (
                    <div className="space-y-0.5">
                      <div><span className="text-slate-400">File:</span> <span className="text-slate-700">{doc.fileName}</span></div>
                      <div><span className="text-slate-400">Seller:</span> <span className="text-slate-700">{doc.seller}</span></div>
                      <div><span className="text-slate-400">Net:</span> <span className="font-mono">£{fmt(doc.net)}</span> <span className="text-slate-400">VAT:</span> <span className="font-mono">£{fmt(doc.tax)}</span> <span className="text-slate-400">Gross:</span> <span className="font-mono font-semibold">£{fmt(doc.gross)}</span></div>
                      {check?.difference != null && check.difference !== 0 && (
                        <div className="mt-1 text-red-600 font-medium">Difference: £{fmt(check.difference)}</div>
                      )}
                    </div>
                  ) : (
                    <p className="text-slate-400 italic">No evidence uploaded</p>
                  )}
                  {check?.aiNotes && (
                    <div className="mt-2 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                      <div className="text-[9px] font-bold text-amber-600 uppercase">AI Notes</div>
                      <p className="text-[11px] text-amber-800">{check.aiNotes}</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })()}
      </div>

      {/* RIGHT: Document Preview Panel (25%) */}
      <div className="w-72 shrink-0 border-l bg-slate-50 flex flex-col">
        <div className="px-3 py-2 border-b bg-slate-100">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Document Preview</span>
        </div>
        {previewDoc ? (
          <div className="flex-1 flex flex-col">
            <div className="px-3 py-2 border-b">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-700 truncate">{previewDoc.fileName}</span>
                <button onClick={() => setPreviewDoc(null)} className="text-slate-400 hover:text-slate-600"><X className="h-3.5 w-3.5" /></button>
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5">
                {previewDoc.seller} &middot; £{fmt(previewDoc.gross)}
              </div>
            </div>
            {previewDoc.previewUrl ? (
              <iframe src={previewDoc.previewUrl} className="flex-1 w-full" title="Document preview" />
            ) : (
              <div className="flex-1 flex items-center justify-center text-slate-300">
                <div className="text-center">
                  <FileText className="h-12 w-12 mx-auto mb-2" />
                  <p className="text-xs">Preview not available</p>
                  <p className="text-[10px] mt-1">Document uploaded but no preview URL</p>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-slate-300 p-4">
            <div className="text-center">
              <Eye className="h-10 w-10 mx-auto mb-2" />
              <p className="text-xs font-medium">Click a row to preview</p>
              <p className="text-[10px] mt-1">Select a sample item to see its evidence document</p>
            </div>
          </div>
        )}

        {/* Quick stats */}
        <div className="px-3 py-2 border-t bg-slate-100 space-y-1">
          <div className="flex justify-between text-[10px]">
            <span className="text-slate-400">Evidence uploaded</span>
            <span className="font-medium text-slate-700">{evidenceDocs.filter(d => d.status !== 'missing' && d.status !== 'pending').length}/{sampleItems.length}</span>
          </div>
          <div className="flex justify-between text-[10px]">
            <span className="text-slate-400">Verified</span>
            <span className="font-medium text-green-600">{passCount}</span>
          </div>
          {failCount > 0 && (
            <div className="flex justify-between text-[10px]">
              <span className="text-slate-400">Exceptions</span>
              <span className="font-medium text-red-600">{failCount}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
