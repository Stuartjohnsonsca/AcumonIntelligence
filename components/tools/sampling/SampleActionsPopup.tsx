'use client';

import { useState } from 'react';
import { X, Download, Printer, Copy, Upload, Loader2, CheckCircle2 } from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

const EVIDENCE_TYPES = [
  { key: 'invoiceRequired', label: 'Invoice' },
  { key: 'paymentRequired', label: 'Payment / Receipt Evidence' },
  { key: 'supplierConfirmation', label: 'Supplier Confirmations' },
  { key: 'debtorConfirmation', label: 'Debtor Confirmations' },
  { key: 'contractRequired', label: 'Contract Request' },
  { key: 'intercompanyRequired', label: 'Intercompany' },
  { key: 'directorMatters', label: 'Director Matters' },
] as const;

interface Props {
  open: boolean;
  onClose: () => void;
  selectedIndices: Set<number>;
  fullPopulationData: Record<string, unknown>[];
  uploadedColumns: string[];
  columnMapping: Record<string, string | undefined>;
  currency: string;
  clientId: string;
  clientName: string;
  periodId: string;
  runId: string;
  // Client team for upload assignment
  clientContactEmail?: string | null;
  clientContactName?: string | null;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function SampleActionsPopup({
  open, onClose, selectedIndices, fullPopulationData, uploadedColumns,
  columnMapping, currency, clientId, clientName, periodId, runId,
  clientContactEmail, clientContactName,
}: Props) {
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [evidenceTypes, setEvidenceTypes] = useState<Record<string, boolean>>({});
  const [assignees, setAssignees] = useState<string[]>([]);
  const [customEmail, setCustomEmail] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);

  if (!open) return null;

  // Get sample rows
  const sampleRows = [...selectedIndices].sort((a, b) => a - b).map(i => fullPopulationData[i]).filter(Boolean);
  const amountCol = columnMapping.amount || 'Amount';

  // ─── Save as spreadsheet ──────────────────────────────────────────────
  const handleSave = async () => {
    try {
      const { utils, writeFile } = await import('xlsx');
      const ws = utils.json_to_sheet(sampleRows);
      const wb = utils.book_new();
      utils.book_append_sheet(wb, ws, 'Sample');
      writeFile(wb, `Sample_${clientName.replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().toISOString().split('T')[0]}.xlsx`);
    } catch (err) {
      console.error('Save failed:', err);
    }
  };

  // ─── Print ────────────────────────────────────────────────────────────
  const handlePrint = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const cols = uploadedColumns.slice(0, 10);
    const html = `
      <html><head><title>Sample - ${clientName}</title>
      <style>
        body { font-family: Arial, sans-serif; font-size: 11px; padding: 20px; }
        h2 { font-size: 16px; margin-bottom: 4px; }
        p { color: #666; font-size: 11px; margin-bottom: 12px; }
        table { border-collapse: collapse; width: 100%; }
        th { background: #f1f5f9; border: 1px solid #e2e8f0; padding: 4px 8px; text-align: left; font-size: 10px; }
        td { border: 1px solid #e2e8f0; padding: 4px 8px; font-size: 10px; }
      </style></head><body>
      <h2>Sample Selection — ${clientName}</h2>
      <p>${sampleRows.length} items selected · ${new Date().toLocaleDateString('en-GB')}</p>
      <table>
        <thead><tr>${cols.map(c => `<th>${c}</th>`).join('')}</tr></thead>
        <tbody>${sampleRows.map(row => `<tr>${cols.map(c => `<td>${String(row[c] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody>
      </table>
      </body></html>`;

    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.print();
  };

  // ─── Copy to clipboard ────────────────────────────────────────────────
  const handleCopy = async () => {
    const cols = uploadedColumns;
    const header = cols.join('\t');
    const rows = sampleRows.map(row => cols.map(c => String(row[c] ?? '')).join('\t'));
    const tsv = [header, ...rows].join('\n');

    try {
      await navigator.clipboard.writeText(tsv);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch {
      // Fallback
      const textarea = document.createElement('textarea');
      textarea.value = tsv;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    }
  };

  // ─── Upload to Client ─────────────────────────────────────────────────
  const handleUploadToClient = async () => {
    const selectedTypes = Object.entries(evidenceTypes).filter(([, v]) => v).map(([k]) => k);
    if (selectedTypes.length === 0) return;

    setUploading(true);
    try {
      const res = await fetch('/api/sampling/evidence-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          runId,
          clientId,
          periodId,
          items: sampleRows.map(row => ({
            transactionId: String(row[columnMapping.transactionId || ''] ?? ''),
            description: String(row[columnMapping.description || ''] ?? ''),
            amount: parseFloat(String(row[amountCol] || 0)) || 0,
            date: String(row[columnMapping.date || ''] ?? ''),
            reference: String(row[columnMapping.transactionId || ''] ?? ''),
            contact: String(row[columnMapping.vendorCustomer || ''] ?? ''),
          })),
          evidenceTypes: selectedTypes,
          assignedTo: assignees,
        }),
      });

      if (res.ok) {
        setUploadSuccess(true);
      } else {
        const err = await res.json().catch(() => null);
        console.error('Upload failed:', err?.error || 'Unknown error');
      }
    } catch (err) {
      console.error('Upload failed:', err);
    }
    setUploading(false);
  };

  const toggleEvidenceType = (key: string) => {
    setEvidenceTypes(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const addAssignee = () => {
    const email = customEmail.trim();
    if (email && !assignees.includes(email)) {
      setAssignees(prev => [...prev, email]);
      setCustomEmail('');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-lg mx-4 max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
          <h3 className="text-base font-semibold text-slate-900">Sample Actions</h3>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-5 py-4 overflow-y-auto flex-1 space-y-3">
          <p className="text-xs text-slate-500">{sampleRows.length} items selected for {clientName}</p>

          {!showUploadForm ? (
            <>
              {/* Action buttons */}
              <button onClick={handleSave} className="w-full flex items-center gap-3 px-4 py-3 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors text-left">
                <Download className="h-5 w-5 text-blue-600" />
                <div>
                  <div className="text-sm font-medium text-slate-800">Save</div>
                  <div className="text-[10px] text-slate-500">Download sample as Excel spreadsheet</div>
                </div>
              </button>

              <button onClick={handlePrint} className="w-full flex items-center gap-3 px-4 py-3 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors text-left">
                <Printer className="h-5 w-5 text-green-600" />
                <div>
                  <div className="text-sm font-medium text-slate-800">Print</div>
                  <div className="text-[10px] text-slate-500">Print the selected sample items</div>
                </div>
              </button>

              <button onClick={handleCopy} className="w-full flex items-center gap-3 px-4 py-3 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors text-left">
                {copySuccess
                  ? <CheckCircle2 className="h-5 w-5 text-green-600" />
                  : <Copy className="h-5 w-5 text-purple-600" />}
                <div>
                  <div className="text-sm font-medium text-slate-800">{copySuccess ? 'Copied!' : 'Copy'}</div>
                  <div className="text-[10px] text-slate-500">Copy sample rows to clipboard</div>
                </div>
              </button>

              <button onClick={() => setShowUploadForm(true)} className="w-full flex items-center gap-3 px-4 py-3 border border-blue-200 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors text-left">
                <Upload className="h-5 w-5 text-blue-600" />
                <div>
                  <div className="text-sm font-medium text-blue-800">Upload to Client</div>
                  <div className="text-[10px] text-blue-600">Send evidence requests to the client portal</div>
                </div>
              </button>
            </>
          ) : uploadSuccess ? (
            <div className="text-center py-6">
              <CheckCircle2 className="h-10 w-10 text-green-500 mx-auto mb-3" />
              <p className="text-sm font-medium text-green-700">Evidence requests sent</p>
              <p className="text-xs text-slate-500 mt-1">{sampleRows.length} items uploaded to the client portal</p>
              <button onClick={onClose} className="mt-4 px-4 py-1.5 text-sm font-medium bg-green-600 text-white rounded-lg hover:bg-green-700">
                Done
              </button>
            </div>
          ) : (
            <>
              {/* Upload to Client form */}
              <button onClick={() => setShowUploadForm(false)} className="text-xs text-blue-600 hover:text-blue-700">
                ← Back to actions
              </button>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-2">Evidence Required</label>
                <div className="space-y-1.5">
                  {EVIDENCE_TYPES.map(et => (
                    <label key={et.key} className={`flex items-center gap-2.5 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                      evidenceTypes[et.key] ? 'bg-blue-50 border border-blue-200' : 'border border-slate-100 hover:bg-slate-50'
                    }`}>
                      <input
                        type="checkbox"
                        checked={!!evidenceTypes[et.key]}
                        onChange={() => toggleEvidenceType(et.key)}
                        className="rounded border-slate-300 text-blue-600"
                      />
                      <span className="text-xs text-slate-700">{et.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-2">Assign To (Client Team)</label>
                {clientContactEmail && (
                  <label className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-100 cursor-pointer hover:bg-slate-50 mb-2">
                    <input
                      type="checkbox"
                      checked={assignees.includes(clientContactEmail)}
                      onChange={() => {
                        setAssignees(prev => prev.includes(clientContactEmail!)
                          ? prev.filter(e => e !== clientContactEmail)
                          : [...prev, clientContactEmail!]);
                      }}
                      className="rounded border-slate-300 text-blue-600"
                    />
                    <span className="text-xs text-slate-700">{clientContactName || clientContactEmail}</span>
                    <span className="text-[10px] text-slate-400 ml-auto">{clientContactEmail}</span>
                  </label>
                )}
                <div className="flex gap-2">
                  <input
                    type="email"
                    value={customEmail}
                    onChange={e => setCustomEmail(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addAssignee()}
                    placeholder="Add email..."
                    className="flex-1 px-2 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  <button onClick={addAssignee} disabled={!customEmail.trim()} className="px-3 py-1.5 text-xs font-medium bg-slate-100 rounded-lg hover:bg-slate-200 disabled:opacity-40">
                    Add
                  </button>
                </div>
                {assignees.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {assignees.map(email => (
                      <span key={email} className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-50 text-blue-700 text-[10px] rounded-full">
                        {email}
                        <button onClick={() => setAssignees(prev => prev.filter(e => e !== email))} className="text-blue-400 hover:text-blue-600">
                          <X className="h-2.5 w-2.5" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="pt-2">
                <button
                  onClick={handleUploadToClient}
                  disabled={uploading || Object.values(evidenceTypes).filter(Boolean).length === 0}
                  className="w-full px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 transition-colors"
                >
                  {uploading
                    ? <><Loader2 className="h-4 w-4 animate-spin inline mr-2" />Sending...</>
                    : `Send ${sampleRows.length} Evidence Requests`}
                </button>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        {!showUploadForm && !uploadSuccess && (
          <div className="px-5 py-3 border-t border-slate-100 flex justify-end shrink-0">
            <button onClick={onClose} className="px-4 py-1.5 text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors">
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
