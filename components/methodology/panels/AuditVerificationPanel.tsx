'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { ChevronDown, ChevronRight, ChevronLeft, FileText, Eye, CheckCircle2, XCircle, Clock, AlertTriangle, X, Loader2, ExternalLink, Upload, Send, Flag } from 'lucide-react';
import { getVerificationChecks, type VerificationCheck as VCheck } from '@/types/methodology';

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

// Per-check user confirmation state
interface CheckConfirmation {
  status: 'pass' | 'fail';
  userName: string;
  timestamp: string;
}

// Per-row state
interface RowState {
  checks: Record<string, CheckConfirmation | null>; // key = check column key
  action: 'none' | 'ri_matter' | 'review_point' | null;
  actionComment: string;
  reviewerSignOff: { userName: string; timestamp: string } | null;
  riSignOff: { userName: string; timestamp: string } | null;
}

interface Props {
  engagementId?: string;
  executionId?: string;
  fsLine?: string;
  assertions?: string[];
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

export function AuditVerificationPanel({ engagementId, executionId, fsLine, assertions, sampleItems, evidenceDocs, verificationResults, onRowClick }: Props) {
  const verificationColumns = useMemo(() => getVerificationChecks(assertions || []), [assertions]);
  const [currentItemIndex, setCurrentItemIndex] = useState(0);
  const [previewDoc, setPreviewDoc] = useState<EvidenceDoc | null>(null);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [extractionJobId, setExtractionJobId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Per-row state (persisted to DB via auto-save)
  const [rowStates, setRowStates] = useState<Record<number, RowState>>({});
  const [actionModalRow, setActionModalRow] = useState<{ index: number; type: 'ri_matter' | 'review_point' } | null>(null);
  const [actionComment, setActionComment] = useState('');

  // Auto-create extraction session
  useEffect(() => {
    if (!engagementId) return;
    setSessionLoading(true);
    fetch(`/api/engagements/${engagementId}/extraction-session`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ testExecutionId: executionId, fsLine }),
    }).then(r => r.ok ? r.json() : null).then(data => { if (data?.job?.id) setExtractionJobId(data.job.id); }).catch(() => {}).finally(() => setSessionLoading(false));
  }, [engagementId, executionId]);

  // Load saved row states from DB
  useEffect(() => {
    if (!engagementId || !executionId) return;
    fetch(`/api/engagements/${engagementId}/test-conclusions?executionId=${executionId}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.conclusions?.[0]?.followUpData?.rowStates) {
          setRowStates(data.conclusions[0].followUpData.rowStates);
        }
      }).catch(() => {});
  }, [engagementId, executionId]);

  // Save row states to DB
  const saveRowStates = useCallback(async (states: Record<number, RowState>) => {
    if (!engagementId || !executionId) return;
    try {
      await fetch(`/api/engagements/${engagementId}/test-conclusions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ executionId, fsLine, testDescription: '', followUpData: { rowStates: states } }),
      });
    } catch {}
  }, [engagementId, executionId, fsLine]);

  function handleCheckClick(itemIndex: number, checkKey: string) {
    setRowStates(prev => {
      const row = prev[itemIndex] || { checks: {}, action: null, actionComment: '', reviewerSignOff: null, riSignOff: null };
      const current = row.checks[checkKey];
      const aiStatus = getAiCheckStatus(itemIndex, checkKey);

      let newStatus: 'pass' | 'fail';
      if (!current) {
        // First click: confirm AI assessment
        newStatus = aiStatus === 'fail' ? 'fail' : 'pass';
      } else {
        // Subsequent click: toggle
        newStatus = current.status === 'pass' ? 'fail' : 'pass';
      }

      const updated = {
        ...prev,
        [itemIndex]: {
          ...row,
          checks: { ...row.checks, [checkKey]: { status: newStatus, userName: 'Current User', timestamp: new Date().toISOString() } },
        },
      };
      saveRowStates(updated);
      return updated;
    });
  }

  function handleAction(itemIndex: number, actionType: 'none' | 'ri_matter' | 'review_point') {
    if (actionType === 'none') {
      setRowStates(prev => {
        const row = prev[itemIndex] || { checks: {}, action: null, actionComment: '', reviewerSignOff: null, riSignOff: null };
        const updated = { ...prev, [itemIndex]: { ...row, action: 'none' as const, actionComment: '' } };
        saveRowStates(updated);
        return updated;
      });
    } else {
      setActionModalRow({ index: itemIndex, type: actionType });
      setActionComment('');
    }
  }

  function submitAction() {
    if (!actionModalRow) return;
    const { index, type } = actionModalRow;
    setRowStates(prev => {
      const row = prev[index] || { checks: {}, action: null, actionComment: '', reviewerSignOff: null, riSignOff: null };
      const updated = { ...prev, [index]: { ...row, action: type, actionComment } };
      saveRowStates(updated);
      return updated;
    });
    // Create the RI Matter or Review Point with full context
    if (engagementId) {
      const sItem = sampleItems[index];
      const evDoc = evidenceDocs.find(d => d.sampleIndex === index);
      const assessment = (evDoc as any)?.matchAssessment;
      const panelType = type === 'ri_matter' ? 'ri_matter' : 'review_point';
      const itemDesc = [
        sItem?.reference ? 'Ref: ' + sItem.reference : '',
        sItem?.description ? sItem.description.slice(0, 60) : '',
        sItem?.gross ? '£' + fmt(sItem.gross) : '',
        sItem?.date || '',
      ].filter(Boolean).join(' | ');
      const evidenceDesc = evDoc ? [
        'Evidence: ' + (evDoc.docRef || 'N/A'),
        'Party: ' + (evDoc.seller || 'N/A'),
        '£' + fmt(evDoc.gross),
      ].filter(Boolean).join(' | ') : 'No evidence obtained';
      const assessmentDesc = assessment?.notes || '';

      // Build link back to this test screen
      const testLink = '/tools/methodology/sme-audit?tab=rmm&exec=' + (executionId || '') + '&item=' + index;

      fetch(`/api/engagements/${engagementId}/audit-points`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pointType: panelType,
          title: (type === 'ri_matter' ? 'RI Matter' : 'Review Point') + ': ' + (sItem?.reference || 'Item ' + (index + 1)),
          description: [
            'Transaction: ' + itemDesc,
            evidenceDesc,
            assessmentDesc ? 'Assessment: ' + assessmentDesc : '',
            '',
            'Auditor comment: ' + actionComment,
            '',
            'View in test: ' + testLink,
          ].filter(Boolean).join('\n'),
          fsLine,
          source: 'verification',
          executionId,
          testLink,
        }),
      }).catch(() => {});
    }
    setActionModalRow(null);
  }

  function getAiCheckStatus(itemIndex: number, checkKey: string): 'pass' | 'fail' | 'pending' {
    // First check verificationResults from the flow engine
    const check = verificationResults.find(r => r.sampleIndex === itemIndex);
    if (check && (check as any)[checkKey] && (check as any)[checkKey] !== 'pending') {
      return (check as any)[checkKey];
    }
    // Then check matchAssessment from evidence docs
    const evDoc = evidenceDocs.find(d => d.sampleIndex === itemIndex);
    if (evDoc && (evDoc as any).matchAssessment) {
      const assessment = (evDoc as any).matchAssessment;
      if (assessment[checkKey] && assessment[checkKey] !== 'pending') return assessment[checkKey];
    }

    // Try matching by itemId if sampleIndex didn't find it
    var evDocFallback = evDoc || evidenceDocs.find(d => {
      const si = sampleItems[itemIndex];
      return si && (d.itemId === si.id || d.itemId === si.reference || d.docRef === si.reference);
    }) || evidenceDocs[itemIndex]; // Last resort: match by position

    // If server assessment is pending but we have evidence, compute client-side
    if (!evDocFallback || evDocFallback.status === 'pending' || evDocFallback.status === 'missing') return 'pending';
    const sampleItem = sampleItems[itemIndex];
    if (!sampleItem) return 'pending';

    if (checkKey === 'match') {
      const amtDiff = Math.abs((evDocFallback.gross || 0) - (sampleItem.gross || 0));
      const amtMatches = amtDiff < 0.01 || ((sampleItem.gross || 0) > 0 && amtDiff / (sampleItem.gross || 1) < 0.01);
      const contactMatches = !sampleItem.customer || !evDocFallback.seller ||
        sampleItem.customer.toLowerCase().includes(evDocFallback.seller.toLowerCase()) ||
        evDocFallback.seller.toLowerCase().includes(sampleItem.customer.toLowerCase());
      return (amtMatches && contactMatches) ? 'pass' : 'fail';
    }

    if (checkKey === 'period') {
      if (!evDocFallback.date || evDocFallback.date === '—') return 'pending';
      // Check if description suggests costs that span multiple periods (prepayments/accruals risk)
      const desc = (((evDocFallback as any).description || '') + ' ' + (sampleItem.description || '')).toLowerCase();
      const multiPeriodKeywords = [
        'insurance', 'annual', 'yearly', 'per annum', 'p.a.',
        'rent', 'lease', 'quarterly', 'in advance', 'prepaid',
        'subscription', 'licence', 'license', 'membership',
        'retainer', 'service charge', 'maintenance contract',
        'support contract', '12 month', '12-month', 'twelve month',
        'deposit', 'warranty', 'guarantee',
      ];
      for (var ki = 0; ki < multiPeriodKeywords.length; ki++) {
        if (desc.includes(multiPeriodKeywords[ki])) return 'fail'; // Likely spans periods — needs accrual/prepayment check
      }
      return 'pass';
    }

    if (checkKey === 'disclosure') {
      // Scan for disclosure keywords in description/seller
      const text = ((evDocFallback as any).description || '' + (evDocFallback.seller || '')).toLowerCase();
      if (text.includes('director') || text.includes('related') || text.includes('loan') ||
          text.includes('legal') || text.includes('settlement') || text.includes('shareholder')) {
        return 'fail';
      }
      return 'pass';
    }

    if (checkKey === 'audit') {
      // Flag if amounts don't match or contact doesn't match
      const amtDiff = Math.abs((evDocFallback.gross || 0) - (sampleItem.gross || 0));
      const amtMatches = amtDiff < 0.01 || ((sampleItem.gross || 0) > 0 && amtDiff / (sampleItem.gross || 1) < 0.01);
      if (!amtMatches) return 'fail';
      const text = ((evDocFallback as any).description || '').toLowerCase();
      if (text.includes('credit note') || text.includes('reversal') || text.includes('voided') || text.includes('cash')) {
        return 'fail';
      }
      return 'pass';
    }

    return 'pending';
  }

  const item = sampleItems[currentItemIndex];
  const rawDoc = item ? evidenceDocs.find(d => d.sampleIndex === currentItemIndex) : null;
  // Ensure preview URL exists — generate from storagePath or documentId if missing
  const doc = rawDoc ? {
    ...rawDoc,
    previewUrl: rawDoc.previewUrl
      || ((rawDoc as any).storagePath ? '/api/documents/preview?path=' + encodeURIComponent((rawDoc as any).storagePath) : undefined)
      || ((rawDoc as any).documentId ? '/api/documents/preview?docId=' + (rawDoc as any).documentId : undefined),
  } : null;
  const check = item ? verificationResults.find(r => r.sampleIndex === currentItemIndex) : null;
  const rowState = rowStates[currentItemIndex] || { checks: {}, action: null, actionComment: '', reviewerSignOff: null, riSignOff: null };

  if (sampleItems.length === 0) {
    return <div className="p-8 text-center text-sm text-slate-400">No sample items to verify</div>;
  }

  return (
    <div className="space-y-3">
      {/* Item Navigator */}
      <div className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2">
        <button onClick={() => setCurrentItemIndex(Math.max(0, currentItemIndex - 1))} disabled={currentItemIndex === 0}
          className="p-1 rounded hover:bg-slate-200 disabled:opacity-30"><ChevronLeft className="h-4 w-4" /></button>
        <div className="flex items-center gap-2">
          {sampleItems.map((_, i) => (
            <button key={i} onClick={() => setCurrentItemIndex(i)}
              className={`w-6 h-6 rounded-full text-[9px] font-bold flex items-center justify-center transition-colors ${
                i === currentItemIndex ? 'bg-blue-600 text-white' :
                rowStates[i]?.action === 'none' ? 'bg-green-100 text-green-700 border border-green-300' :
                rowStates[i]?.action ? 'bg-amber-100 text-amber-700 border border-amber-300' :
                'bg-white text-slate-500 border border-slate-300 hover:border-blue-400'
              }`}>
              {i + 1}
            </button>
          ))}
        </div>
        <button onClick={() => setCurrentItemIndex(Math.min(sampleItems.length - 1, currentItemIndex + 1))} disabled={currentItemIndex >= sampleItems.length - 1}
          className="p-1 rounded hover:bg-slate-200 disabled:opacity-30"><ChevronRight className="h-4 w-4" /></button>
      </div>

      {item && (
        <div className="grid grid-cols-3 gap-3">
          {/* LEFT: Sample Item */}
          <div className="border rounded-lg overflow-hidden">
            <div className="bg-blue-600 text-white px-3 py-1.5 text-[10px] font-semibold">Sample Request</div>
            <div className="p-3 space-y-1.5 text-xs">
              <div><span className="text-slate-400">Ref:</span> <span className="font-mono text-slate-800">{item.reference}</span></div>
              <div><span className="text-slate-400">Description:</span> <span className="text-slate-700">{item.description || item.customer}</span></div>
              <div><span className="text-slate-400">Gross:</span> <span className="font-mono font-semibold">£{fmt(item.gross)}</span></div>
              <div><span className="text-slate-400">Net:</span> <span className="font-mono">£{fmt(item.net)}</span> <span className="text-slate-400 ml-2">Tax:</span> <span className="font-mono">£{fmt(item.tax)}</span></div>
              <div><span className="text-slate-400">Date:</span> <span className="text-slate-700">{item.date || '—'}</span></div>
            </div>
          </div>

          {/* MIDDLE: Evidence */}
          <div className="border rounded-lg overflow-hidden">
            <div className="bg-green-600 text-white px-3 py-1.5 text-[10px] font-semibold">Client Evidence</div>
            {doc ? (
              <div className="p-3 space-y-1.5 text-xs">
                <div><span className="text-slate-400">Doc Ref:</span> <span className="font-mono text-slate-800">{doc.docRef}</span></div>
                <div><span className="text-slate-400">Party:</span> <span className="text-slate-700">{doc.seller}</span></div>
                <div><span className="text-slate-400">Description:</span> <span className="text-slate-700 text-[10px]">{doc.fileName || '—'}</span></div>
                <div><span className="text-slate-400">Gross:</span> <span className="font-mono font-semibold">£{fmt(doc.gross)}</span></div>
                <div><span className="text-slate-400">Net:</span> <span className="font-mono">£{fmt(doc.net)}</span> <span className="text-slate-400 ml-2">Tax:</span> <span className="font-mono">£{fmt(doc.tax)}</span></div>
                <div><span className="text-slate-400">Date:</span> <span className="text-slate-700">{doc.date || '—'}</span></div>
                {doc.status === 'partial' && item && (
                  <div className="text-[9px] text-red-600 font-medium mt-1 bg-red-50 rounded px-2 py-1">
                    Amount difference: £{fmt(Math.abs(doc.gross - item.gross))} ({item.gross > 0 ? ((Math.abs(doc.gross - item.gross) / item.gross) * 100).toFixed(1) : '?'}%)
                  </div>
                )}
                {doc.previewUrl && <button onClick={() => setPreviewDoc(doc)} className="text-blue-600 hover:text-blue-800 flex items-center gap-1 text-[10px] mt-1"><Eye className="h-3 w-3" /> View Document</button>}
              </div>
            ) : (
              <div className="p-3 flex flex-col items-center justify-center text-slate-400 min-h-[120px]">
                <FileText className="h-6 w-6 mb-1" />
                <p className="text-[10px]">No evidence yet</p>
                <button onClick={() => fileInputRef.current?.click()} className="mt-2 text-[9px] text-blue-600 hover:text-blue-800">Upload</button>
                <input ref={fileInputRef} type="file" className="hidden" accept=".pdf,.jpg,.png,.doc,.docx" />
              </div>
            )}
          </div>

          {/* RIGHT: Document Preview — auto-loads when evidence has a preview URL */}
          <div className="border rounded-lg overflow-hidden">
            <div className="bg-slate-600 text-white px-3 py-1.5 text-[10px] font-semibold flex items-center justify-between">
              Document Preview
              {(doc?.previewUrl || previewDoc?.previewUrl) && (
                <a href={doc?.previewUrl || previewDoc?.previewUrl} target="_blank" rel="noopener noreferrer" className="text-[9px] text-slate-300 hover:text-white flex items-center gap-0.5">
                  <ExternalLink className="h-2.5 w-2.5" /> Open
                </a>
              )}
            </div>
            {(previewDoc?.previewUrl || doc?.previewUrl) ? (
              <iframe src={previewDoc?.previewUrl || doc?.previewUrl} className="w-full h-[250px] border-0" title="Document Preview" />
            ) : doc ? (
              <div className="p-3 flex flex-col items-center justify-center text-slate-400 min-h-[120px]">
                <FileText className="h-8 w-8 mb-1" />
                <p className="text-[10px] font-medium">{doc.fileName || doc.docRef}</p>
                <p className="text-[9px] mt-1">Document obtained but preview loading...</p>
                {doc.previewUrl === undefined && (
                  <p className="text-[8px] text-slate-300 mt-1">Re-run the test to generate preview URLs</p>
                )}
              </div>
            ) : (
              <div className="p-3 flex items-center justify-center text-slate-300 min-h-[120px]">
                <p className="text-[10px]">No evidence obtained yet</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Verification Checks */}
      {item && (
        <div className="border rounded-lg overflow-hidden">
          <div className="bg-amber-600 text-white px-3 py-1.5 text-[10px] font-semibold">Audit Verification</div>
          <div className="p-3">
            <div className="grid grid-cols-4 gap-3">
              {verificationColumns.map(col => {
                const aiStatus = getAiCheckStatus(currentItemIndex, col.key);
                const userConfirm = rowState.checks[col.key];
                const effectiveStatus = userConfirm?.status ?? (aiStatus !== 'pending' ? aiStatus : null);

                return (
                  <div key={col.key} className="text-center space-y-1.5">
                    <div className="text-[10px] font-bold text-slate-600 cursor-help" title={col.description}>{col.label}</div>
                    <button
                      onClick={() => handleCheckClick(currentItemIndex, col.key)}
                      className="w-8 h-8 rounded-full border-2 mx-auto flex items-center justify-center transition-all hover:scale-110"
                      style={{
                        borderColor: aiStatus === 'pending' && !userConfirm ? '#cbd5e1' : (effectiveStatus === 'pass' ? '#22c55e' : '#ef4444'),
                        backgroundColor: userConfirm ? (userConfirm.status === 'pass' ? '#22c55e' : '#ef4444') : 'transparent',
                      }}
                      title={
                        !userConfirm && aiStatus === 'pending' ? 'Not assessed — click to set'
                        : !userConfirm ? `AI: ${aiStatus === 'pass' ? 'Agrees' : 'Issue found'} — click to confirm`
                        : `${userConfirm.status === 'pass' ? 'Agrees' : 'Issue'} — ${userConfirm.userName} ${new Date(userConfirm.timestamp).toLocaleDateString('en-GB')} — click to toggle`
                      }
                    >
                      {userConfirm && (
                        userConfirm.status === 'pass'
                          ? <CheckCircle2 className="h-4 w-4 text-white" />
                          : <XCircle className="h-4 w-4 text-white" />
                      )}
                    </button>
                    {userConfirm && (
                      <div className="text-[8px] text-slate-400">
                        {userConfirm.userName}<br />{new Date(userConfirm.timestamp).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {/* Assessment notes from the system */}
            {(() => {
              const evDoc = evidenceDocs.find(d => d.sampleIndex === currentItemIndex);
              const notes = (evDoc as any)?.matchAssessment?.notes;
              if (!notes) return null;
              return (
                <div className="mt-2 text-[10px] text-slate-600 bg-slate-50 rounded px-3 py-2 border">
                  <span className="font-bold text-slate-500">System assessment: </span>
                  {notes.split('\n').map((line: string, li: number) => (
                    <span key={li} className={line.includes('MISMATCH') || line.includes('AUDIT') || line.includes('DISCLOSURE') ? 'text-red-600 font-medium' : ''}>
                      {line}{li < notes.split('\n').length - 1 ? ' | ' : ''}
                    </span>
                  ))}
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* Actions + Sign-off */}
      {item && (
        <div className="border rounded-lg overflow-hidden">
          <div className="px-3 py-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold text-slate-600 uppercase">Action:</span>
              <button onClick={() => handleAction(currentItemIndex, 'none')}
                className={`inline-flex items-center gap-1 px-2 py-1 text-[9px] rounded font-medium ${rowState.action === 'none' ? 'bg-green-100 text-green-700 border border-green-300' : 'bg-slate-50 text-slate-500 border border-slate-200 hover:bg-green-50'}`}>
                <CheckCircle2 className="h-3 w-3" /> No action needed
              </button>
              <button onClick={() => handleAction(currentItemIndex, 'ri_matter')}
                className={`inline-flex items-center gap-1 px-2 py-1 text-[9px] rounded font-medium ${rowState.action === 'ri_matter' ? 'bg-red-100 text-red-700 border border-red-300' : 'bg-slate-50 text-slate-500 border border-slate-200 hover:bg-red-50'}`}>
                <Flag className="h-3 w-3" /> RI Matter
              </button>
              <button onClick={() => handleAction(currentItemIndex, 'review_point')}
                className={`inline-flex items-center gap-1 px-2 py-1 text-[9px] rounded font-medium ${rowState.action === 'review_point' ? 'bg-amber-100 text-amber-700 border border-amber-300' : 'bg-slate-50 text-slate-500 border border-slate-200 hover:bg-amber-50'}`}>
                <Send className="h-3 w-3" /> Review Point
              </button>
            </div>
            {/* Reviewer + RI sign-off */}
            <div className="flex items-center gap-4">
              <button onClick={() => {
                setRowStates(prev => {
                  const row = prev[currentItemIndex] || { checks: {}, action: null, actionComment: '', reviewerSignOff: null, riSignOff: null };
                  const updated = { ...prev, [currentItemIndex]: { ...row, reviewerSignOff: row.reviewerSignOff ? null : { userName: 'Current User', timestamp: new Date().toISOString() } } };
                  saveRowStates(updated);
                  return updated;
                });
              }} className={`flex flex-col items-center gap-0.5 cursor-pointer ${rowState.reviewerSignOff ? '' : 'hover:opacity-100'}`}
                title={rowState.reviewerSignOff ? `Reviewed by ${rowState.reviewerSignOff.userName} — click to unsign` : 'Click to sign as Reviewer'}>
                <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${rowState.reviewerSignOff ? 'bg-green-500 border-green-500' : 'border-green-400 hover:bg-green-50'}`}>
                  {rowState.reviewerSignOff && <CheckCircle2 className="h-3.5 w-3.5 text-white" />}
                </div>
                <span className="text-[8px] font-bold text-slate-600">Reviewer</span>
                {rowState.reviewerSignOff && <span className="text-[7px] text-green-600">{rowState.reviewerSignOff.userName}</span>}
              </button>
              <button onClick={() => {
                setRowStates(prev => {
                  const row = prev[currentItemIndex] || { checks: {}, action: null, actionComment: '', reviewerSignOff: null, riSignOff: null };
                  const updated = { ...prev, [currentItemIndex]: { ...row, riSignOff: row.riSignOff ? null : { userName: 'Current User', timestamp: new Date().toISOString() } } };
                  saveRowStates(updated);
                  return updated;
                });
              }} className={`flex flex-col items-center gap-0.5 cursor-pointer ${rowState.riSignOff ? '' : 'hover:opacity-100'}`}
                title={rowState.riSignOff ? `RI signed by ${rowState.riSignOff.userName} — click to unsign` : 'Click to sign as RI'}>
                <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${rowState.riSignOff ? 'bg-green-500 border-green-500' : 'border-green-400 hover:bg-green-50'}`}>
                  {rowState.riSignOff && <CheckCircle2 className="h-3.5 w-3.5 text-white" />}
                </div>
                <span className="text-[8px] font-bold text-slate-600">RI</span>
                {rowState.riSignOff && <span className="text-[7px] text-green-600">{rowState.riSignOff.userName}</span>}
              </button>
            </div>
          </div>
          {rowState.actionComment && (
            <div className="px-3 pb-2 text-[10px] text-slate-600 bg-slate-50 border-t">
              <span className="text-slate-400">Comment:</span> {rowState.actionComment}
            </div>
          )}
        </div>
      )}

      {/* Action Modal — comment input for RI Matter / Review Point */}
      {actionModalRow && (
        <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center" onClick={() => setActionModalRow(null)}>
          <div className="bg-white rounded-lg shadow-xl p-4 w-96 space-y-3" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-slate-800">
              {actionModalRow.type === 'ri_matter' ? 'Send to RI Matters' : 'Create Review Point'}
            </h3>
            <p className="text-xs text-slate-500">
              Item: {sampleItems[actionModalRow.index]?.reference || sampleItems[actionModalRow.index]?.description?.slice(0, 40)}
            </p>
            <textarea
              value={actionComment}
              onChange={e => setActionComment(e.target.value)}
              placeholder="Enter your comment explaining the issue..."
              className="w-full border rounded px-3 py-2 text-xs min-h-[80px] focus:outline-none focus:border-blue-400"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setActionModalRow(null)} className="px-3 py-1.5 text-xs text-slate-500 hover:text-slate-700">Cancel</button>
              <button onClick={submitAction} disabled={!actionComment.trim()}
                className={`px-3 py-1.5 text-xs text-white rounded font-medium disabled:opacity-50 ${actionModalRow.type === 'ri_matter' ? 'bg-red-600 hover:bg-red-700' : 'bg-amber-600 hover:bg-amber-700'}`}>
                {actionModalRow.type === 'ri_matter' ? 'Send to RI' : 'Create Review Point'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
