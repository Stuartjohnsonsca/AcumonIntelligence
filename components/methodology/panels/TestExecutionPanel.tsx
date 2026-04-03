'use client';

import React, { useState, useEffect } from 'react';
import { X, Upload, FileText, CheckCircle2, XCircle, Clock, Loader2, ChevronRight, ChevronDown, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ItemErrorDetailPanel } from './ItemErrorDetailPanel';

// ─── Types ───
interface SampleItem {
  id: string;
  ref: string;
  description: string;
  amount: number;
  date?: string;
  reference?: string;
}

interface ClientEvidence {
  itemId: string; // matches SampleItem.id
  docRef?: string;
  fileName?: string;
  date?: string;
  seller?: string;
  purchaser?: string;
  net?: number;
  tax?: number;
  gross?: number;
  status: 'uploaded' | 'pending' | 'missing';
}

interface VerificationResult {
  itemId: string;
  amountMatch: 'pass' | 'fail' | 'pending';
  dateMatch: 'pass' | 'fail' | 'pending';
  periodCheck: 'pass' | 'fail' | 'pending';
  consistency: 'pass' | 'fail' | 'pending';
  overallResult: 'pass' | 'fail' | 'pending';
  notes?: string;
}

interface FlowStep {
  id: string;
  label: string;
  status: 'complete' | 'active' | 'pending' | 'failed';
}

interface Props {
  testId: string;
  testDescription: string;
  testType: string;
  engagementId: string;
  fsLine: string;
  sessionId?: string; // each test gets its own extraction session
  onClose: () => void;
}

// ─── Currency formatter ───
function fmt(n: number | undefined | null): string {
  if (n == null) return '—';
  const abs = Math.abs(n);
  const formatted = abs.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `(${formatted})` : formatted;
}

// ─── Result icon ───
function ResultIcon({ status }: { status: 'pass' | 'fail' | 'pending' }) {
  if (status === 'pass') return <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />;
  if (status === 'fail') return <XCircle className="h-3.5 w-3.5 text-red-500" />;
  return <Clock className="h-3.5 w-3.5 text-slate-300" />;
}

export function TestExecutionPanel({ testId, testDescription, testType, engagementId, fsLine, sessionId, onClose }: Props) {
  const [loading, setLoading] = useState(true);
  const [sampleItems, setSampleItems] = useState<SampleItem[]>([]);
  const [evidence, setEvidence] = useState<ClientEvidence[]>([]);
  const [results, setResults] = useState<VerificationResult[]>([]);
  const [flowSteps, setFlowSteps] = useState<FlowStep[]>([]);
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState<'not_started' | 'in_progress' | 'awaiting_client' | 'verifying' | 'complete'>('not_started');
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [itemDetails, setItemDetails] = useState<Record<string, any>>({});
  const [clearlyTrivial, setClearlyTrivial] = useState(0);
  const [tolerableMisstatement, setTolerableMisstatement] = useState(0);
  const [populationSize, setPopulationSize] = useState(0);

  useEffect(() => {
    loadSession();
  }, [testId, engagementId]);

  async function loadSession() {
    setLoading(true);
    try {
      const res = await fetch(`/api/engagements/${engagementId}/test-execution/${testId}`);
      if (res.ok) {
        const data = await res.json();
        setSampleItems(data.sampleItems || []);
        setEvidence(data.evidence || []);
        setResults(data.results || []);
        setFlowSteps(data.flowSteps || []);
        setStatus(data.status || 'not_started');
      }
    } catch {
      // API may not exist yet — show empty state
    } finally {
      setLoading(false);
    }
  }

  // Merge evidence and results with sample items for display
  const rows = sampleItems.map(item => ({
    item,
    evidence: evidence.find(e => e.itemId === item.id) || { itemId: item.id, status: 'pending' as const },
    result: results.find(r => r.itemId === item.id) || { itemId: item.id, amountMatch: 'pending' as const, dateMatch: 'pending' as const, periodCheck: 'pending' as const, consistency: 'pending' as const, overallResult: 'pending' as const },
  }));

  // Summary calculations
  const sampleValueTotal = sampleItems.reduce((s, i) => s + (i.amount || 0), 0);
  const sampleTotal = sampleItems.length;
  const passCount = results.filter(r => r.overallResult === 'pass').length;
  const failCount = results.filter(r => r.overallResult === 'fail').length;
  const pendingCount = sampleTotal - passCount - failCount;

  // Error amounts from item details
  const errorAmountTotal = Object.values(itemDetails).reduce((sum: number, d: any) => {
    if (!d) return sum;
    const audited = d.overrideAuditedValue ?? d.auditedValue ?? d.bookValue;
    const diff = Math.abs((d.bookValue || 0) - (audited || 0));
    return sum + diff;
  }, 0);
  const errorPct = sampleValueTotal > 0 ? ((errorAmountTotal / sampleValueTotal) * 100).toFixed(1) : '0.0';
  const extrapolatedError = sampleValueTotal > 0 && populationSize > 0
    ? (errorAmountTotal / sampleValueTotal) * populationSize
    : 0;

  // Error breakdown by classification
  const classificationCounts = Object.values(itemDetails).reduce((acc: Record<string, number>, d: any) => {
    if (d?.errorClassification) acc[d.errorClassification] = (acc[d.errorClassification] || 0) + 1;
    return acc;
  }, {});
  const belowCTCount = Object.values(itemDetails).filter((d: any) => d?.isClearlyTrivial).length;
  const aboveCTCount = failCount - belowCTCount;

  if (loading) {
    return (
      <div className="border rounded-lg bg-white p-8 flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-blue-500 mr-2" />
        <span className="text-sm text-slate-500">Loading test execution...</span>
      </div>
    );
  }

  return (
    <div className="border rounded-lg bg-white overflow-hidden shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50 border-b">
        <div className="flex items-center gap-3 min-w-0">
          <FileText className="h-4 w-4 text-blue-600 shrink-0" />
          <div className="min-w-0">
            <div className="text-sm font-semibold text-slate-800 truncate">{testDescription}</div>
            <div className="text-[10px] text-slate-400">{fsLine} &middot; Session {sessionId || 'New'}</div>
          </div>
          <span className={`text-[9px] font-medium px-2 py-0.5 rounded-full shrink-0 ${
            status === 'complete' ? 'bg-green-100 text-green-700' :
            status === 'verifying' ? 'bg-purple-100 text-purple-700' :
            status === 'awaiting_client' ? 'bg-orange-100 text-orange-700' :
            status === 'in_progress' ? 'bg-blue-100 text-blue-700' :
            'bg-slate-100 text-slate-500'
          }`}>
            {status === 'complete' ? 'Complete' :
             status === 'verifying' ? 'AI Verifying' :
             status === 'awaiting_client' ? 'Awaiting Client' :
             status === 'in_progress' ? 'In Progress' :
             'Not Started'}
          </span>
        </div>
        <button onClick={onClose} className="p-1 hover:bg-slate-200 rounded">
          <X className="h-4 w-4 text-slate-400" />
        </button>
      </div>

      {/* Main content: 3/4 + 1/4 split */}
      <div className="flex" style={{ minHeight: 320 }}>
        {/* LEFT: Verification Grid (75%) */}
        <div className="flex-1 overflow-auto border-r">
          {sampleItems.length === 0 ? (
            <div className="flex items-center justify-center h-full p-8">
              <div className="text-center max-w-md">
                <FileText className="h-10 w-10 text-blue-200 mx-auto mb-3" />
                <p className="text-sm font-semibold text-slate-700 mb-2">Test Execution Workspace</p>
                <p className="text-xs text-slate-500 mb-4">This test needs a configured flow to run. When the execution engine triggers this test, the flow steps will execute automatically:</p>
                <div className="text-left bg-slate-50 rounded-lg p-3 space-y-1.5 text-xs text-slate-600 mb-4">
                  <div className="flex items-start gap-2"><span className="text-blue-500 font-bold">1.</span> AI sends a request to the client portal for supporting data</div>
                  <div className="flex items-start gap-2"><span className="text-blue-500 font-bold">2.</span> Client uploads evidence via the portal</div>
                  <div className="flex items-start gap-2"><span className="text-blue-500 font-bold">3.</span> AI verifies the uploaded data against the test criteria</div>
                  <div className="flex items-start gap-2"><span className="text-blue-500 font-bold">4.</span> Sampling calculator is populated (user reviews and runs)</div>
                  <div className="flex items-start gap-2"><span className="text-blue-500 font-bold">5.</span> Per-item evidence is requested, verified, and assessed</div>
                  <div className="flex items-start gap-2"><span className="text-blue-500 font-bold">6.</span> Results appear here in the verification grid</div>
                </div>
                <p className="text-[10px] text-slate-400">To configure the flow for this test, go to <strong>Test Bank &rarr; Test Actions</strong> and set up the execution definitions, then build the flow in the <strong>Flow Builder</strong>.</p>
              </div>
            </div>
          ) : (
            <table className="w-full text-xs border-collapse">
              <thead className="sticky top-0 z-10">
                <tr>
                  {/* Blue section: Sample Request */}
                  <th colSpan={4} className="bg-blue-600 text-white text-[10px] font-semibold px-3 py-1.5 text-left border-r-2 border-white">
                    Sample Request
                  </th>
                  {/* Green section: Client Evidence */}
                  <th colSpan={4} className="bg-green-600 text-white text-[10px] font-semibold px-3 py-1.5 text-left border-r-2 border-white">
                    Client Evidence
                  </th>
                  {/* Amber section: Audit Verification */}
                  <th colSpan={5} className="bg-amber-600 text-white text-[10px] font-semibold px-3 py-1.5 text-left">
                    Audit Verification
                  </th>
                </tr>
                <tr className="bg-slate-100 border-b">
                  {/* Blue sub-headers */}
                  <th className="text-left px-2 py-1.5 text-slate-600 font-semibold border-r border-slate-200 w-12">#</th>
                  <th className="text-left px-2 py-1.5 text-slate-600 font-semibold border-r border-slate-200">Description</th>
                  <th className="text-right px-2 py-1.5 text-slate-600 font-semibold border-r border-slate-200 w-24">Amount</th>
                  <th className="text-left px-2 py-1.5 text-slate-600 font-semibold border-r-2 border-blue-200 w-20">Date</th>
                  {/* Green sub-headers */}
                  <th className="text-left px-2 py-1.5 text-slate-600 font-semibold border-r border-slate-200 w-20">Doc Ref</th>
                  <th className="text-left px-2 py-1.5 text-slate-600 font-semibold border-r border-slate-200">Seller</th>
                  <th className="text-right px-2 py-1.5 text-slate-600 font-semibold border-r border-slate-200 w-24">Gross</th>
                  <th className="text-center px-2 py-1.5 text-slate-600 font-semibold border-r-2 border-green-200 w-16">Status</th>
                  {/* Amber sub-headers */}
                  <th className="text-center px-2 py-1.5 text-slate-600 font-semibold border-r border-slate-200 w-14">Amt</th>
                  <th className="text-center px-2 py-1.5 text-slate-600 font-semibold border-r border-slate-200 w-14">Date</th>
                  <th className="text-center px-2 py-1.5 text-slate-600 font-semibold border-r border-slate-200 w-14">Period</th>
                  <th className="text-center px-2 py-1.5 text-slate-600 font-semibold border-r border-slate-200 w-14">Consist.</th>
                  <th className="text-center px-2 py-1.5 text-slate-600 font-semibold w-14">Result</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => {
                  const isItemExpanded = expandedItemId === row.item.id;
                  return (
                    <React.Fragment key={row.item.id}>
                      <tr
                        onClick={() => setExpandedItemId(isItemExpanded ? null : row.item.id)}
                        className={`border-b border-slate-100 cursor-pointer transition-colors ${
                          isItemExpanded ? 'bg-blue-50 border-l-2 border-l-blue-500' :
                          i % 2 === 0 ? 'bg-white hover:bg-blue-50/30' : 'bg-slate-50/30 hover:bg-blue-50/30'
                        }`}
                      >
                        {/* Blue: Sample Request */}
                        <td className="px-2 py-1.5 text-slate-500 font-mono border-r border-slate-100">
                          <div className="flex items-center gap-1">
                            {isItemExpanded ? <ChevronDown className="h-3 w-3 text-blue-500" /> : <ChevronRight className="h-3 w-3 text-slate-300" />}
                            {row.item.ref || i + 1}
                          </div>
                        </td>
                        <td className="px-2 py-1.5 text-slate-700 border-r border-slate-100 max-w-[200px] truncate">{row.item.description}</td>
                        <td className="px-2 py-1.5 text-right font-mono text-slate-800 border-r border-slate-100">{fmt(row.item.amount)}</td>
                        <td className="px-2 py-1.5 text-slate-500 border-r-2 border-blue-100">{row.item.date || '—'}</td>
                        {/* Green: Client Evidence */}
                        <td className="px-2 py-1.5 text-slate-600 font-mono border-r border-slate-100">{row.evidence.docRef || '—'}</td>
                        <td className="px-2 py-1.5 text-slate-600 border-r border-slate-100 max-w-[120px] truncate">{row.evidence.seller || '—'}</td>
                        <td className="px-2 py-1.5 text-right font-mono text-slate-800 border-r border-slate-100">{fmt(row.evidence.gross)}</td>
                        <td className="px-2 py-1.5 text-center border-r-2 border-green-100">
                          {row.evidence.status === 'uploaded' && <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-green-100 text-green-700">Uploaded</span>}
                          {row.evidence.status === 'pending' && <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-600">Pending</span>}
                          {row.evidence.status === 'missing' && <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-red-100 text-red-600">Missing</span>}
                        </td>
                        {/* Amber: Audit Verification */}
                        <td className="px-2 py-1.5 text-center border-r border-slate-100"><ResultIcon status={row.result.amountMatch} /></td>
                        <td className="px-2 py-1.5 text-center border-r border-slate-100"><ResultIcon status={row.result.dateMatch} /></td>
                        <td className="px-2 py-1.5 text-center border-r border-slate-100"><ResultIcon status={row.result.periodCheck} /></td>
                        <td className="px-2 py-1.5 text-center border-r border-slate-100"><ResultIcon status={row.result.consistency} /></td>
                        <td className="px-2 py-1.5 text-center">
                          {row.result.overallResult === 'pass' && <span className="text-[9px] font-bold text-green-600 bg-green-50 px-1.5 py-0.5 rounded">PASS</span>}
                          {row.result.overallResult === 'fail' && <span className="text-[9px] font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded">FAIL</span>}
                          {row.result.overallResult === 'pending' && <span className="text-[9px] text-slate-400">—</span>}
                        </td>
                      </tr>
                      {/* Expandable detail panel */}
                      {isItemExpanded && (
                        <tr>
                          <td colSpan={13} className="p-2 bg-slate-50/50">
                            <ItemErrorDetailPanel
                              detail={itemDetails[row.item.id] || {
                                itemId: row.item.id,
                                bookValue: row.item.amount || 0,
                                auditedValue: row.evidence.gross ?? null,
                                aiExtractedValue: row.evidence.gross ?? null,
                                aiExtractedDate: null,
                                aiSourceDocument: row.evidence.fileName || row.evidence.docRef || null,
                                aiComparisonSteps: [],
                                aiConfidence: null,
                                overrideAuditedValue: null,
                                overrideReason: '',
                                errorClassification: null,
                                isClearlyTrivial: null,
                                wpReference: '',
                                auditorNotes: '',
                                testResult: null,
                              }}
                              clearlyTrivialThreshold={clearlyTrivial}
                              onChange={(updated) => {
                                setItemDetails(prev => ({
                                  ...prev,
                                  [row.item.id]: { ...prev[row.item.id], ...updated },
                                }));
                              }}
                            />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* RIGHT: Summary Panel (25%) */}
        <div className="w-64 shrink-0 p-3 overflow-y-auto bg-slate-50/50">
          {/* Tier 1: Simple Summary */}
          <div className="mb-4">
            <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-2">Audit Summary</div>
            <div className="space-y-1.5">
              <SummaryRow label="Population Value" value={`£${fmt(sampleValueTotal)}`} />
              <SummaryRow label="Sample Size" value={`${sampleTotal} items`} />
              <SummaryRow label="Verified" value={`${passCount} passed`} color="text-green-600" />
              <SummaryRow label="Exceptions" value={`${failCount} found`} color={failCount > 0 ? 'text-red-600' : 'text-slate-500'} />
              <SummaryRow label="Pending" value={`${pendingCount} remaining`} color="text-slate-400" />
              <div className="border-t border-slate-200 pt-1.5 mt-1.5">
                <SummaryRow label="Error Total" value={`£${fmt(errorAmountTotal)}`} color={errorAmountTotal > 0 ? 'text-red-600' : 'text-green-600'} />
                <SummaryRow label="Error %" value={`${errorPct}%`} color={Number(errorPct) > 0 ? 'text-red-600 font-bold' : 'text-green-600 font-bold'} />
                <SummaryRow label="Extrapolated" value={`£${fmt(extrapolatedError)}`} color={extrapolatedError > 0 ? 'text-red-600' : 'text-slate-500'} />
                <SummaryRow label="Clearly Trivial" value={`£${fmt(clearlyTrivial)}`} />
              </div>
            </div>
          </div>

          {/* Tier 2: Statistical Evaluation */}
          {sampleTotal > 0 && failCount + passCount > 0 && (
            <details className="mb-4">
              <summary className="text-[9px] font-bold text-slate-400 uppercase tracking-wider cursor-pointer hover:text-slate-600 mb-2">
                Statistical Evaluation
              </summary>
              <div className="space-y-1 text-[10px] bg-slate-100 rounded-lg p-2">
                <div className="flex justify-between"><span className="text-slate-500">Tolerable Misstatement</span><span className="font-mono text-slate-700">£{fmt(tolerableMisstatement)}</span></div>
                <div className="text-[9px] text-slate-400 italic">Full UCL calculation available when all items are assessed</div>
              </div>
            </details>
          )}

          {/* Tier 3: Error Breakdown */}
          {failCount > 0 && (
            <div className="mb-4">
              <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-2">Error Breakdown</div>
              <div className="space-y-1">
                {Object.entries(classificationCounts).map(([cls, count]) => (
                  <div key={cls} className="flex justify-between text-[10px]">
                    <span className="text-slate-600 capitalize">{cls}</span>
                    <span className="font-mono text-slate-700">{count as number}</span>
                  </div>
                ))}
                {belowCTCount > 0 && (
                  <div className="flex justify-between text-[10px] text-slate-400">
                    <span>Below CT (noted only)</span>
                    <span className="font-mono">{belowCTCount}</span>
                  </div>
                )}
                {aboveCTCount > 0 && (
                  <div className="flex justify-between text-[10px] text-red-600 font-medium">
                    <span>Above CT (material)</span>
                    <span className="font-mono">{aboveCTCount}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Conclusion */}
          {status === 'complete' && (
            <div className={`mb-4 px-3 py-2 rounded-lg text-center text-sm font-bold ${
              failCount === 0 ? 'bg-green-100 text-green-700' :
              extrapolatedError <= tolerableMisstatement ? 'bg-amber-100 text-amber-700' :
              'bg-red-100 text-red-700'
            }`}>
              {failCount === 0 ? 'SATISFACTORY' :
               extrapolatedError <= tolerableMisstatement ? 'ERRORS — WITHIN TM' :
               'ERRORS — EXCEEDS TM'}
            </div>
          )}

          {/* Document Upload */}
          <div className="mb-4">
            <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-2">Documents</div>
            <div className="border-2 border-dashed border-slate-300 rounded-lg p-4 text-center hover:border-blue-400 hover:bg-blue-50/30 transition-colors cursor-pointer">
              <Upload className="h-5 w-5 text-slate-300 mx-auto mb-1" />
              <p className="text-[10px] text-slate-400">Drop files or click to upload</p>
              <p className="text-[9px] text-slate-300">PDF, images, or ZIP</p>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="space-y-1.5">
            <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-2">Actions</div>
            <button className="w-full text-left text-xs px-2.5 py-1.5 rounded border border-slate-200 hover:bg-slate-100 flex items-center gap-2 text-slate-600">
              <ExternalLink className="h-3 w-3" /> Open in Data Extraction
            </button>
            <button className="w-full text-left text-xs px-2.5 py-1.5 rounded border border-slate-200 hover:bg-slate-100 flex items-center gap-2 text-slate-600">
              <FileText className="h-3 w-3" /> View Source Documents
            </button>
          </div>
        </div>
      </div>

      {/* Flow Progress Bar */}
      {flowSteps.length > 0 && (
        <div className="flex items-center gap-1.5 px-4 py-2 bg-slate-50 border-t text-[10px]">
          <span className="text-slate-400 font-medium shrink-0">Flow:</span>
          {flowSteps.map((step, i) => (
            <div key={step.id} className="flex items-center gap-1">
              {i > 0 && <ChevronRight className="h-3 w-3 text-slate-300" />}
              <span className={`px-1.5 py-0.5 rounded ${
                step.status === 'complete' ? 'bg-green-100 text-green-700' :
                step.status === 'active' ? 'bg-blue-100 text-blue-700 font-semibold' :
                step.status === 'failed' ? 'bg-red-100 text-red-700' :
                'bg-slate-100 text-slate-400'
              }`}>
                {step.label}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SummaryRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[10px] text-slate-500">{label}</span>
      <span className={`text-xs font-mono ${color || 'text-slate-800'}`}>{value}</span>
    </div>
  );
}
