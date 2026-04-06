'use client';

import { useState } from 'react';
import { FileText, Eye, CheckCircle2, XCircle, AlertTriangle, ExternalLink } from 'lucide-react';

/**
 * BankCheckResultPanel — displays BS Check to TB results in a simple format:
 * - Bank metadata (bank name, sort code, account number, account holder)
 * - 3-figure comparison: Extracted | Trial Balance | Difference
 * - Document preview link
 * - Differences feed into error routines
 */

interface Comparison {
  accountCode: string;
  accountName: string;
  bankAccountNumber: string | null;
  bankBalance: number | null;
  tbBalance: number;
  difference: number | null;
  transactionCount: number;
  status: string;
}

interface BankMeta {
  bankName: string;
  sortCode: string;
  accountNumber: string;
  accountHolder: string;
  statementDate: string;
  fileName: string;
  closingBalance: number;
  openingBalance: number;
  currency: string;
}

interface DocumentRef {
  id: string;
  name: string;
  storagePath?: string;
}

interface Props {
  comparisons: Comparison[];
  bankMetadata?: BankMeta[];
  documentRefs?: DocumentRef[];
  summary?: string;
  result?: string;
  clearlyTrivial?: number;
  engagementId?: string;
  onViewDocument?: (docId: string) => void;
}

function fmt(v: number | null | undefined): string {
  if (v == null) return '—';
  const abs = Math.abs(v);
  const s = '£' + abs.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return v < 0 ? `(${s})` : s;
}

export function BankCheckResultPanel({ comparisons, bankMetadata, documentRefs, summary, result, clearlyTrivial, engagementId, onViewDocument }: Props) {
  const [previewDoc, setPreviewDoc] = useState<string | null>(null);

  const hasErrors = comparisons.some(c => c.status === 'material_difference');

  return (
    <div className="space-y-4">
      {/* Bank Statement Metadata */}
      {bankMetadata && bankMetadata.length > 0 && (
        <div className="border rounded-lg overflow-hidden">
          <div className="bg-blue-50 px-3 py-2 border-b border-blue-100">
            <span className="text-[10px] font-bold text-blue-700 uppercase">Bank Statement Details</span>
          </div>
          <div className="divide-y divide-slate-100">
            {bankMetadata.map((bank, i) => (
              <div key={i} className="px-3 py-2 grid grid-cols-4 gap-3 text-[10px]">
                <div>
                  <span className="text-slate-400 block">Bank</span>
                  <span className="text-slate-800 font-medium">{bank.bankName || '—'}</span>
                </div>
                <div>
                  <span className="text-slate-400 block">Sort Code</span>
                  <span className="text-slate-800 font-mono">{bank.sortCode || '—'}</span>
                </div>
                <div>
                  <span className="text-slate-400 block">Account Number</span>
                  <span className="text-slate-800 font-mono">{bank.accountNumber || '—'}</span>
                </div>
                <div>
                  <span className="text-slate-400 block">Account Holder</span>
                  <span className="text-slate-800 font-medium">{bank.accountHolder || '—'}</span>
                </div>
                {bank.statementDate && (
                  <div>
                    <span className="text-slate-400 block">Statement Date</span>
                    <span className="text-slate-800">{bank.statementDate}</span>
                  </div>
                )}
                {bank.closingBalance != null && (
                  <div>
                    <span className="text-slate-400 block">Closing Balance</span>
                    <span className="text-slate-800 font-mono font-medium">{fmt(bank.closingBalance)}</span>
                  </div>
                )}
                {bank.fileName && (
                  <div className="col-span-2">
                    <span className="text-slate-400 block">Source Document</span>
                    <button
                      onClick={() => {
                        const doc = documentRefs?.find(d => d.name?.includes(bank.fileName) || bank.fileName?.includes(d.name || ''));
                        if (doc) { onViewDocument?.(doc.id); setPreviewDoc(doc.id); }
                      }}
                      className="text-blue-600 hover:text-blue-800 flex items-center gap-1"
                    >
                      <Eye className="h-3 w-3" /> {bank.fileName}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Source Documents — clickable preview */}
      {documentRefs && documentRefs.length > 0 && (!bankMetadata || bankMetadata.length === 0) && (
        <div className="flex items-center gap-2 text-[10px]">
          <span className="text-slate-400">Source Documents:</span>
          {documentRefs.map((doc, i) => (
            <button key={i} onClick={() => { onViewDocument?.(doc.id); setPreviewDoc(doc.id); }}
              className="inline-flex items-center gap-1 px-2 py-1 bg-blue-50 text-blue-600 rounded hover:bg-blue-100">
              <Eye className="h-3 w-3" /> {doc.name}
            </button>
          ))}
        </div>
      )}

      {/* Main Comparison Table — 3 figures */}
      <div className="border rounded-lg overflow-hidden">
        <div className={`px-3 py-2 border-b ${hasErrors ? 'bg-red-50' : 'bg-green-50'}`}>
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase ${hasErrors ? 'text-red-700' : 'text-green-700'}">
              Bank to Trial Balance Comparison
            </span>
            <span className={`text-[9px] font-bold px-2 py-0.5 rounded ${
              result === 'pass' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
            }`}>
              {result === 'pass' ? 'PASS — All Matched' : 'DIFFERENCES FOUND'}
            </span>
          </div>
        </div>
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-100 border-b text-[10px] font-semibold text-slate-600">
              <th className="px-3 py-2 text-left">Account</th>
              <th className="px-3 py-2 text-right">Extracted (Bank)</th>
              <th className="px-3 py-2 text-right">Trial Balance</th>
              <th className="px-3 py-2 text-right">Difference</th>
              <th className="px-3 py-2 text-center">Status</th>
            </tr>
          </thead>
          <tbody>
            {comparisons.map((c, i) => {
              const hasDiff = c.status === 'material_difference';
              const immaterial = c.status === 'immaterial_difference';
              return (
                <tr key={i} className={`border-b border-slate-50 ${hasDiff ? 'bg-red-50' : immaterial ? 'bg-amber-50/30' : ''}`}>
                  <td className="px-3 py-2">
                    <div className="text-slate-700 font-medium">{c.accountName}</div>
                    {c.bankAccountNumber && <div className="text-[9px] text-slate-400 font-mono">Bank: {c.bankAccountNumber}</div>}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">{c.bankBalance != null ? fmt(c.bankBalance) : <span className="text-slate-400 italic text-[9px]">No data</span>}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(c.tbBalance)}</td>
                  <td className={`px-3 py-2 text-right font-mono font-bold ${hasDiff ? 'text-red-600' : immaterial ? 'text-amber-600' : 'text-green-600'}`}>
                    {c.difference != null ? fmt(c.difference) : '—'}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {c.status === 'matched' && <CheckCircle2 className="h-4 w-4 text-green-500 mx-auto" />}
                    {c.status === 'immaterial_difference' && <span className="text-[8px] px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded font-medium">Below CT</span>}
                    {c.status === 'material_difference' && <XCircle className="h-4 w-4 text-red-500 mx-auto" />}
                    {c.status === 'no_bank_data' && <span className="text-[8px] px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded">No bank data</span>}
                    {c.status === 'zero_balance' && <span className="text-[8px] text-slate-400">Zero</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Clearly trivial threshold */}
        {clearlyTrivial != null && clearlyTrivial > 0 && (
          <div className="px-3 py-1.5 bg-slate-50 border-t text-[9px] text-slate-400">
            Clearly Trivial threshold: {fmt(clearlyTrivial)}. Differences below this are marked "Below CT".
          </div>
        )}
      </div>

      {/* Summary */}
      {summary && (
        <div className={`text-xs rounded p-3 border ${result === 'pass' ? 'bg-green-50 border-green-100 text-green-700' : 'bg-red-50 border-red-100 text-red-700'}`}>
          {summary}
        </div>
      )}

      {/* Error items for error routines */}
      {hasErrors && (
        <div className="border border-red-200 rounded-lg p-3 bg-red-50/30">
          <div className="flex items-center gap-2 text-[10px] text-red-700 font-bold uppercase mb-2">
            <AlertTriangle className="h-3.5 w-3.5" /> Differences to Investigate
          </div>
          <div className="space-y-1">
            {comparisons.filter(c => c.status === 'material_difference').map((c, i) => (
              <div key={i} className="flex items-center justify-between text-xs bg-white rounded px-2 py-1.5 border border-red-100">
                <span className="text-slate-700">{c.accountName}</span>
                <span className="font-mono font-bold text-red-600">{fmt(c.difference)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
