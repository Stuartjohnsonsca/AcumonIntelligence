'use client';

import React, { useState, useEffect, useRef } from 'react';
import { X, Upload, FileText, CheckCircle2, XCircle, Clock, Loader2, ChevronRight, ChevronDown, ExternalLink, Play, RotateCcw, AlertTriangle, Ban, Calculator } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ItemErrorDetailPanel } from './ItemErrorDetailPanel';
import { InlineSamplingPanel } from './InlineSamplingPanel';
import { AuditVerificationPanel } from './AuditVerificationPanel';
import { ErrorInvestigationPanel } from './ErrorInvestigationPanel';

// ─── Types ───
interface SampleItem { id: string; ref: string; description: string; amount: number; date?: string; reference?: string; }
interface ClientEvidence { itemId: string; docRef?: string; fileName?: string; date?: string; seller?: string; purchaser?: string; net?: number; tax?: number; gross?: number; status: 'uploaded' | 'pending' | 'missing'; }
interface VerificationResult { itemId: string; amountMatch: string; dateMatch: string; periodCheck: string; consistency: string; overallResult: string; notes?: string; }
interface FlowStep { id: string; label: string; status: string; output?: any; errorMessage?: string; duration?: number; }
interface Props {
  testId: string; testDescription: string; testType: string; engagementId: string; fsLine: string;
  clientId?: string; periodId?: string;
  tbRow?: { accountCode: string; description: string; currentYear: number | null; priorYear: number | null; fsNote: string | null };
  sessionId?: string; flowData?: any; executionDef?: any;
  assertions?: string[];  // Test assertions — drives verification columns
  onClose: () => void;
  onConclusionChange?: (conclusion: 'green' | 'orange' | 'red' | 'pending') => void;
}

function fmt(n: number | undefined | null): string {
  if (n == null) return '—';
  const abs = Math.abs(n);
  const f = abs.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `(${f})` : f;
}

function ResultIcon({ status }: { status: string }) {
  if (status === 'pass') return <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />;
  if (status === 'fail') return <XCircle className="h-3.5 w-3.5 text-red-500" />;
  return <Clock className="h-3.5 w-3.5 text-slate-300" />;
}

export function TestExecutionPanel({ testId, testDescription, testType, engagementId, fsLine, clientId, periodId, tbRow, flowData, executionDef, assertions, onClose, onConclusionChange }: Props) {
  // Data state
  const [sampleItems, setSampleItems] = useState<SampleItem[]>([]);
  const [evidence, setEvidence] = useState<ClientEvidence[]>([]);
  const [results, setResults] = useState<VerificationResult[]>([]);
  const [flowSteps, setFlowSteps] = useState<FlowStep[]>([]);
  const [itemDetails, setItemDetails] = useState<Record<string, any>>({});
  const [clearlyTrivial, setClearlyTrivial] = useState(0);
  const [tolerableMisstatement, setTolerableMisstatement] = useState(0);
  const [populationSize, setPopulationSize] = useState(0);

  // Execution state
  const [loading, setLoading] = useState(true);
  const [executionId, setExecutionId] = useState<string | null>(null);
  const [executionStatus, setExecutionStatus] = useState<string>('not_started');
  const [executionError, setExecutionError] = useState<string | null>(null);
  const [pauseReason, setPauseReason] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<string[]>([]);
  const [expandedStepId, setExpandedStepId] = useState<string | null>(null);
  const [samplingResults, setSamplingResults] = useState<{ runId: string; selectedIndices: number[]; sampleSize: number; coverage: number } | null>(null);
  const [samplingCompleted, setSamplingCompleted] = useState(false);
  const [samplingCalcOpen, setSamplingCalcOpen] = useState(true);
  const [starting, setStarting] = useState(false);
  const [completing, setCompleting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const continueRef = useRef(false);

  // Section collapse state
  const [progressOpen, setProgressOpen] = useState(false);
  const [samplingOpen, setSamplingOpen] = useState(true);
  const [findingsOpen, setFindingsOpen] = useState(false);
  const [verificationOpen, setVerificationOpen] = useState(true);

  // ─── Computed values (MUST be before any useEffect that references them) ───
  const sampleTotal = sampleItems.length;
  const passCount = results.filter(r => r.overallResult === 'pass').length;
  const failCount = results.filter(r => r.overallResult === 'fail').length;
  const pendingCount = sampleTotal - passCount - failCount;
  const errorAmountTotal = Object.values(itemDetails).reduce((sum: number, d: any) => {
    if (!d) return sum;
    const audited = d.overrideAuditedValue ?? d.auditedValue ?? d.bookValue;
    return sum + Math.abs((d.bookValue || 0) - (audited || 0));
  }, 0);
  const sampleValueTotal = sampleItems.reduce((s, i) => s + (i.amount || 0), 0);
  const errorPct = sampleValueTotal > 0 ? (errorAmountTotal / sampleValueTotal) * 100 : 0;
  const extrapolatedError = sampleValueTotal > 0 && populationSize > 0 ? (errorAmountTotal / sampleValueTotal) * populationSize : 0;

  // Conclusion: green/orange/red
  const conclusion: 'green' | 'orange' | 'red' | 'pending' =
    executionStatus !== 'completed' ? 'pending' :
    failCount === 0 || extrapolatedError <= clearlyTrivial ? 'green' :
    extrapolatedError <= tolerableMisstatement ? 'orange' : 'red';

  // Paused step detection
  const pausedStep = flowSteps.find(s => s.status === 'paused');
  const isSamplingPause = pausedStep?.output?.triggerType === 'sampling' || pausedStep?.label?.toLowerCase().includes('sampl');
  const isPortalPause = !!pausedStep?.output?.portalRequestId;
  const pauseItemId = pausedStep?.output?.outstandingItemId || pausedStep?.output?.portalRequestId;

  // Auto-collapse progress when sampling/portal is active
  useEffect(() => {
    if (isSamplingPause || isPortalPause) {
      setProgressOpen(false);
      setSamplingOpen(true);
    }
  }, [isSamplingPause, isPortalPause]);

  // Report conclusion to parent
  useEffect(() => { onConclusionChange?.(conclusion); }, [conclusion]);

  // Populate sampleItems from flow step outputs (after sampling completes or forEach starts)
  useEffect(() => {
    if (sampleItems.length > 0) return; // Already populated

    // Find population data and selected indices from any step
    let populationData: any[] = [];
    let selectedIndices: number[] = [];

    for (const step of flowSteps) {
      if (!step.output) continue;
      if (step.output.populationData?.length > 0 && populationData.length === 0) populationData = step.output.populationData;
      if (step.output.dataTable?.length > 0 && populationData.length === 0) populationData = step.output.dataTable;
      if (step.output.selectedIndices?.length > 0) selectedIndices = step.output.selectedIndices;
    }

    // Also check samplingResults from local state
    if (samplingResults?.selectedIndices?.length > 0 && selectedIndices.length === 0) {
      selectedIndices = samplingResults.selectedIndices;
    }

    if (populationData.length > 0 && (selectedIndices.length > 0 || samplingCompleted)) {
      const items = selectedIndices.length > 0
        ? selectedIndices.map(idx => populationData[idx]).filter(Boolean)
        : populationData;

      setSampleItems(items.map((item: any, i: number) => ({
        id: item.invoiceNumber || item.InvoiceNumber || item.reference || item.Reference || String(i + 1),
        ref: item.invoiceNumber || item.InvoiceNumber || item.reference || item.Reference || String(i + 1),
        description: item.contact || item.Contact || item.description || item.Description || item.ContactName || '',
        amount: Number(item.amount || item.Amount || item.total || item.Total || item.lineAmount || item.LineAmount || 0),
        date: item.date || item.Date || '',
        reference: item.reference || item.Reference || item.invoiceNumber || item.InvoiceNumber || '',
      })));
    }
  }, [flowSteps, samplingCompleted, samplingResults]);

  // ─── Lifecycle ───
  useEffect(() => {
    loadExistingExecution();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [testId, engagementId]);

  async function loadExistingExecution() {
    setLoading(true);
    try {
      const res = await fetch(`/api/engagements/${engagementId}/test-execution?fsLine=${encodeURIComponent(fsLine)}`);
      if (res.ok) {
        const data = await res.json();
        // Find the most recent execution for this test — prefer running/paused, then completed, then failed
        const allExecs = (data.executions || [])
          .filter((e: any) => e.testDescription === testDescription && e.status !== 'cancelled')
          .sort((a: any, b: any) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
        const existing = allExecs.find((e: any) => e.status === 'running' || e.status === 'paused') || allExecs[0];
        if (existing) {
          setExecutionId(existing.id);
          setExecutionStatus(existing.status);
          setFlowSteps(existing.nodeRuns?.map((r: any) => ({ id: r.nodeId, label: r.label || r.nodeType, status: r.status, output: r.output, errorMessage: r.errorMessage, duration: r.duration })) || []);
          if (existing.errorMessage) setExecutionError(existing.errorMessage);
          if (existing.status === 'running' || existing.status === 'paused') startPolling(existing.id);
        }
      }
    } catch {} finally { setLoading(false); }
  }

  async function handleStartExecution() {
    setStarting(true); setExecutionError(null); setDiagnostics([]); setFlowSteps([]);
    try {
      const res = await fetch(`/api/engagements/${engagementId}/test-execution`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fsLine, testDescription, testTypeCode: testType, flowData, tbRow }),
      });
      if (res.ok) {
        const data = await res.json();
        setExecutionId(data.executionId); setExecutionStatus('running'); startPolling(data.executionId);
        setProgressOpen(true);
      } else {
        const data = await res.json();
        setExecutionError(data.error || 'Failed to start');
        if (data.diagnostics) setDiagnostics(data.diagnostics);
      }
    } catch (err: any) { setExecutionError(err.message || 'Failed'); } finally { setStarting(false); }
  }

  function startPolling(execId: string) {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/engagements/${engagementId}/test-execution/${execId}`);
        if (!res.ok) return;
        const data = await res.json();
        setExecutionStatus(data.execution.status);
        setFlowSteps(data.flowSteps || []);
        if (data.execution.errorMessage) setExecutionError(data.execution.errorMessage);
        if (data.execution.pauseReason) setPauseReason(data.execution.pauseReason);
        if (['completed', 'failed', 'cancelled'].includes(data.execution.status)) {
          if (pollRef.current) clearInterval(pollRef.current);
          setFindingsOpen(true);
        }
        // Auto-continue: if execution is still 'running' but updatedAt is stale (>30s ago),
        // the engine may have timed out mid-processing. Trigger ONE continuation.
        if (data.execution.status === 'running') {
          const updated = new Date(data.execution.updatedAt).getTime();
          const staleSecs = (Date.now() - updated) / 1000;
          // Only auto-continue if stale for >30s AND we haven't sent one recently
          if (staleSecs > 30 && !continueRef.current) {
            continueRef.current = true;
            fetch(`/api/engagements/${engagementId}/test-execution/${execId}`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'continue' }),
            }).catch(() => {}).finally(() => { setTimeout(() => { continueRef.current = false; }, 30000); });
          }
        }
      } catch {}
    }, 3000);
  }

  async function handleCancel() {
    if (!executionId) return;
    await fetch(`/api/engagements/${engagementId}/test-execution/${executionId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'cancel' }) });
    setExecutionStatus('cancelled'); if (pollRef.current) clearInterval(pollRef.current);
  }

  async function handleReset() {
    if (!confirm('Cancel and start fresh? Progress will be lost.')) return;
    if (executionId) await fetch(`/api/engagements/${engagementId}/test-execution/${executionId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'cancel' }) });
    if (pollRef.current) clearInterval(pollRef.current);
    setExecutionId(null); setExecutionStatus('not_started'); setExecutionError(null); setDiagnostics([]);
    setFlowSteps([]); setSampleItems([]); setEvidence([]); setResults([]);
  }

  async function handleRetry() {
    if (!executionId) return;
    setExecutionError(null);
    const res = await fetch(`/api/engagements/${engagementId}/test-execution/${executionId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'retry' }) });
    if (res.ok) { setExecutionStatus('running'); startPolling(executionId); }
  }

  async function handleSamplingDone(results?: { runId: string; selectedIndices: number[]; sampleSize: number; coverage: number }) {
    setCompleting(true);
    if (results) setSamplingResults(results);
    setSamplingCompleted(true);
    setSamplingCalcOpen(false);
    try {
      const responseData = { completed: true, samplingDone: true, ...(results || {}) };
      if (pauseItemId) {
        await fetch(`/api/engagements/${engagementId}/outstanding`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itemId: pauseItemId, responseData }) });
      } else if (executionId) {
        await fetch(`/api/engagements/${engagementId}/test-execution/${executionId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'resume', responseData }) });
      }
      setExecutionStatus('running'); if (executionId) startPolling(executionId);
    } catch {} finally { setCompleting(false); }
  }

  if (loading) return <div className="border rounded-lg bg-white p-6 flex items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-blue-500 mr-2" /><span className="text-sm text-slate-500">Loading...</span></div>;

  // ─── Conclusion dot colour ───
  const dotColor = conclusion === 'green' ? 'bg-green-500' : conclusion === 'orange' ? 'bg-orange-500' : conclusion === 'red' ? 'bg-red-500' : 'bg-slate-300';

  return (
    <div className="border rounded-lg bg-white overflow-hidden shadow-sm">
      {/* ─── HEADER ─── */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50 border-b">
        <div className="flex items-center gap-3 min-w-0">
          <div className={`w-3 h-3 rounded-full ${dotColor} shrink-0`} title={`Conclusion: ${conclusion}`} />
          <div className="min-w-0">
            <div className="text-sm font-semibold text-slate-800 truncate">{testDescription}</div>
            <div className="text-[10px] text-slate-400">{fsLine}{tbRow?.accountCode ? ` — ${tbRow.accountCode}: ${tbRow.description || ''}` : ''}</div>
          </div>
          <span className={`text-[9px] font-medium px-2 py-0.5 rounded-full shrink-0 ${
            executionStatus === 'completed' ? 'bg-green-100 text-green-700' :
            executionStatus === 'paused' ? 'bg-orange-100 text-orange-700' :
            executionStatus === 'running' ? 'bg-blue-100 text-blue-700' :
            executionStatus === 'failed' ? 'bg-red-100 text-red-700' :
            'bg-slate-100 text-slate-500'
          }`}>{executionStatus === 'completed' ? 'Complete' : executionStatus === 'paused' ? `Paused${pauseReason ? ` (${pauseReason})` : ''}` : executionStatus === 'running' ? 'Running' : executionStatus === 'failed' ? 'Failed' : 'Not Started'}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {(executionStatus === 'running' || executionStatus === 'paused') && (
            <button onClick={handleCancel} className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded border border-red-200 text-red-600 hover:bg-red-50"><Ban className="h-3 w-3" /> Stop</button>
          )}
          {executionId && executionStatus !== 'not_started' && (
            <button onClick={handleReset} className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded border border-slate-200 text-slate-600 hover:bg-slate-100"><RotateCcw className="h-3 w-3" /> Reset</button>
          )}
          <button onClick={onClose} className="p-1 hover:bg-slate-200 rounded"><X className="h-4 w-4 text-slate-400" /></button>
        </div>
      </div>

      {/* ─── NOT STARTED STATE ─── */}
      {executionStatus === 'not_started' && (
        <div className="p-4">
          {!flowData && !executionDef ? (
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-xs">
              <p className="font-semibold text-amber-700 mb-1">No flow configured</p>
              <p className="text-amber-600">Build a flow in Test Bank → click industry dot → Flow icon on this test.</p>
            </div>
          ) : (
            <div className="text-center py-4">
              <Button onClick={handleStartExecution} disabled={starting} className="bg-blue-600 hover:bg-blue-700">
                {starting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
                {starting ? 'Starting...' : 'Start Test Execution'}
              </Button>
            </div>
          )}
          {executionError && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 mt-3 text-xs">
              <div className="flex items-start gap-2 text-red-700 font-medium"><AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />{executionError}</div>
              {diagnostics.length > 0 && <ul className="text-red-600 ml-5 mt-1 space-y-0.5 list-disc">{diagnostics.map((d, i) => <li key={i}>{d}</li>)}</ul>}
            </div>
          )}
        </div>
      )}

      {/* ─── ACTIVE EXECUTION (running/paused/completed/failed) ─── */}
      {executionStatus !== 'not_started' && (
        <div className="divide-y divide-slate-200">

          {/* Error banner for failed executions */}
          {executionStatus === 'failed' && executionError && (
            <div className="bg-red-50 border-b border-red-200 px-4 py-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-semibold text-red-700">Execution Failed</p>
                  <p className="text-xs text-red-600 mt-0.5">{executionError}</p>
                </div>
              </div>
            </div>
          )}

          {/* SECTION 1: Progress Steps (collapsible) */}
          <div>
            <button onClick={() => setProgressOpen(!progressOpen)} className="w-full flex items-center justify-between px-4 py-2 bg-slate-50/50 hover:bg-slate-100 transition-colors">
              <div className="flex items-center gap-2">
                {progressOpen ? <ChevronDown className="h-3.5 w-3.5 text-slate-400" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-400" />}
                <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">Progress Steps</span>
                {executionStatus === 'running' && <Loader2 className="h-3 w-3 animate-spin text-blue-500" />}
              </div>
              <span className="text-[9px] text-slate-400">{flowSteps.filter(s => s.status === 'completed').length}/{flowSteps.length} steps</span>
            </button>
            {progressOpen && (
              <div className="divide-y divide-slate-50 max-h-[350px] overflow-y-auto">
                {flowSteps.map((step) => {
                  const isExpanded = expandedStepId === step.id;
                  const hasOutput = step.output && Object.keys(step.output).length > 0;
                  return (
                    <div key={step.id}>
                      <div
                        className={`flex items-center gap-2.5 px-4 py-1.5 text-xs cursor-pointer ${
                          step.status === 'failed' ? 'bg-red-50' : step.status === 'running' ? 'bg-blue-50' : step.status === 'paused' ? 'bg-orange-50' : step.status === 'completed' ? 'bg-green-50/20' : ''
                        }`}
                        onClick={() => setExpandedStepId(isExpanded ? null : step.id)}
                      >
                        <div className="w-4 h-4 flex items-center justify-center shrink-0">
                          {step.status === 'completed' && <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />}
                          {step.status === 'running' && <Loader2 className="h-3.5 w-3.5 text-blue-500 animate-spin" />}
                          {step.status === 'paused' && <Clock className="h-3.5 w-3.5 text-orange-500" />}
                          {step.status === 'failed' && <XCircle className="h-3.5 w-3.5 text-red-500" />}
                          {(step.status === 'pending' || step.status === 'skipped') && <div className="w-2.5 h-2.5 rounded-full border-2 border-slate-300" />}
                        </div>
                        <span className={`flex-1 ${step.status === 'completed' ? 'text-green-700' : step.status === 'failed' ? 'text-red-700' : step.status === 'running' ? 'text-blue-700' : 'text-slate-500'}`}>{step.label}</span>
                        {step.output?.result && <span className={`text-[8px] px-1 py-0.5 rounded-full font-medium ${step.output.result === 'pass' ? 'bg-green-100 text-green-700' : step.output.result === 'fail' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-500'}`}>{step.output.result}</span>}
                        {step.output?.decision && <span className="text-[8px] px-1 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">{step.output.decision}</span>}
                        {step.output?.populationData?.length > 0 && <span className="text-[8px] px-1 py-0.5 rounded-full bg-teal-100 text-teal-700 font-medium">{step.output.populationData.length} rows</span>}
                        {step.output?.dataTable?.length > 0 && !step.output?.populationData && <span className="text-[8px] px-1 py-0.5 rounded-full bg-teal-100 text-teal-700 font-medium">{step.output.dataTable.length} rows</span>}
                        {/* Extraction progress detail */}
                        {step.output?.progress && <span className="text-[8px] px-1 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium">{step.output.progress}</span>}
                        {step.output?.transactionCount > 0 && !step.output?.dataTable && <span className="text-[8px] px-1 py-0.5 rounded-full bg-purple-100 text-purple-700 font-medium">{step.output.transactionCount} txns</span>}
                        {/* Evidence info */}
                        {step.output?.uploadCount > 0 && <span className="text-[8px] px-1 py-0.5 rounded-full bg-indigo-100 text-indigo-700 font-medium">{step.output.uploadCount} files</span>}
                        {step.output?.evidenceFound === false && <span className="text-[8px] px-1 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">No evidence</span>}
                        {step.status === 'paused' && <span className="text-[8px] px-1 py-0.5 rounded-full bg-orange-100 text-orange-600 font-medium">Paused{pauseReason ? `: ${pauseReason}` : ''}</span>}
                        {step.errorMessage && <span className="text-[8px] text-red-500 break-words max-w-[250px]">{step.errorMessage}</span>}
                        {step.duration && <span className="text-[8px] text-slate-400">{(step.duration / 1000).toFixed(1)}s</span>}
                        {hasOutput && <span className="text-[8px] text-slate-300">{isExpanded ? '▼' : '▶'}</span>}
                      </div>
                      {isExpanded && hasOutput && (
                        <div className="px-4 py-2 bg-slate-50 border-t border-slate-100">
                          <div className="text-[9px] font-mono text-slate-600 whitespace-pre-wrap max-h-[200px] overflow-auto bg-white rounded border border-slate-200 p-2">
                            {(() => {
                              const display = { ...step.output };
                              // Truncate raw AI text for readability
                              if (display.raw && typeof display.raw === 'string' && display.raw.length > 500) {
                                display.raw = display.raw.slice(0, 500) + '... [truncated]';
                              }
                              return JSON.stringify(display, null, 2);
                            })()}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* SECTION 2: Sampling & Evidence (collapsible — MAIN WORKSPACE) */}
          <div>
            <button onClick={() => setSamplingOpen(!samplingOpen)} className="w-full flex items-center justify-between px-4 py-2 bg-slate-50/50 hover:bg-slate-100 transition-colors">
              <div className="flex items-center gap-2">
                {samplingOpen ? <ChevronDown className="h-3.5 w-3.5 text-slate-400" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-400" />}
                <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">Data & Sampling</span>
                {isSamplingPause && <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-teal-100 text-teal-700 font-medium">Action Required</span>}
              </div>
              {(() => {
                const popStep = flowSteps.find(s => s.output?.populationData?.length > 0 || s.output?.dataTable?.length > 0);
                const popCount = popStep?.output?.populationData?.length || popStep?.output?.dataTable?.length || 0;
                return popCount > 0 ? <span className="text-[9px] text-slate-400">{popCount} records loaded{sampleTotal > 0 ? `, ${sampleTotal} sampled` : ''}</span> : sampleTotal > 0 ? <span className="text-[9px] text-slate-400">{sampleTotal} items</span> : null;
              })()}
            </button>
            {samplingOpen && (
              <div className="p-4 space-y-3">
                {/* Population data table — always show when we have data (even for non-sampling tests) */}
                {(() => {
                  const popStep = flowSteps.find(s => s.output?.populationData?.length > 0 || s.output?.dataTable?.length > 0);
                  const population = popStep?.output?.populationData || popStep?.output?.dataTable || [];
                  const selectedIdx = new Set(
                    samplingResults?.selectedIndices ||
                    flowSteps.find(s => s.output?.selectedIndices?.length > 0)?.output?.selectedIndices || []
                  );
                  if (population.length === 0) return null;
                  const cols = Object.keys(population[0]).filter(k => !k.startsWith('_')).slice(0, 8);
                  return (
                    <div className="border rounded-lg overflow-hidden">
                      <div className="px-3 py-2 bg-slate-50 border-b flex items-center justify-between">
                        <span className="text-[10px] font-bold text-slate-600 uppercase">Population Data ({population.length} records{selectedIdx.size > 0 ? ` — ${selectedIdx.size} sampled` : ''})</span>
                        <span className="text-[9px] text-slate-400">Source: {popStep?.label || 'Flow step'}</span>
                      </div>
                      <div className="max-h-[300px] overflow-auto">
                        <table className="w-full text-[9px] border-collapse">
                          <thead className="sticky top-0">
                            <tr className="bg-slate-100 border-b">
                              <th className="px-1 py-1 text-center w-6 font-semibold text-slate-500">#</th>
                              {selectedIdx.size > 0 && <th className="px-1 py-1 text-center w-6 font-semibold text-slate-500">Sel</th>}
                              {cols.map(c => <th key={c} className="px-1.5 py-1 text-left font-semibold text-slate-600 whitespace-nowrap">{c}</th>)}
                            </tr>
                          </thead>
                          <tbody>
                            {population.slice(0, 200).map((row: any, i: number) => {
                              const isSampled = selectedIdx.has(i);
                              return (
                                <tr key={i} className={`border-b border-slate-50 ${isSampled ? 'bg-green-50 font-medium' : 'hover:bg-slate-50/50'}`}>
                                  <td className="px-1 py-0.5 text-center text-slate-400">{i + 1}</td>
                                  {selectedIdx.size > 0 && (
                                    <td className="px-1 py-0.5 text-center">{isSampled ? <span className="w-2 h-2 rounded-full bg-green-500 inline-block" /> : ''}</td>
                                  )}
                                  {cols.map(c => (
                                    <td key={c} className="px-1.5 py-0.5 text-slate-600 whitespace-nowrap max-w-[150px] truncate">
                                      {typeof row[c] === 'number' ? row[c].toLocaleString('en-GB', { maximumFractionDigits: 2 }) : String(row[c] ?? '')}
                                    </td>
                                  ))}
                                </tr>
                              );
                            })}
                            {population.length > 200 && <tr><td colSpan={cols.length + 2} className="text-center py-1 text-slate-400 text-[8px]">...and {population.length - 200} more rows</td></tr>}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })()}

                {/* Sampling methodology details (when sampling was performed) */}
                {samplingResults && (
                  <div className="border border-teal-200 rounded-lg p-3 bg-teal-50/30 space-y-2">
                    <div className="text-[10px] font-bold text-teal-700 uppercase">Sampling Methodology</div>
                    <div className="grid grid-cols-4 gap-2 text-[10px]">
                      {(samplingResults as any).method && <div><span className="text-slate-400">Method:</span> <span className="text-slate-700 font-medium">{(samplingResults as any).method}</span></div>}
                      {samplingResults.sampleSize && <div><span className="text-slate-400">Sample Size:</span> <span className="text-slate-700 font-medium">{samplingResults.sampleSize}</span></div>}
                      {samplingResults.coverage && <div><span className="text-slate-400">Coverage:</span> <span className="text-slate-700 font-medium">{(samplingResults.coverage * 100).toFixed(1)}%</span></div>}
                      {(samplingResults as any).confidence && <div><span className="text-slate-400">Confidence:</span> <span className="text-slate-700 font-medium">{(samplingResults as any).confidence}%</span></div>}
                    </div>
                    {(samplingResults as any).planningRationale && (
                      <div className="text-[10px] text-teal-800 bg-teal-50 rounded px-2 py-1.5 border border-teal-200">{(samplingResults as any).planningRationale}</div>
                    )}
                  </div>
                )}

                {/* Sampling calculator — shown during pause or when user wants to re-run */}
                {(isSamplingPause || samplingCompleted || flowSteps.some(s => s.output?.triggerType === 'sampling')) && (
                  <div className="border border-teal-200 rounded-lg overflow-hidden">
                    <button
                      onClick={() => setSamplingCalcOpen(!samplingCalcOpen)}
                      className="w-full flex items-center justify-between px-3 py-2 bg-teal-50/50 hover:bg-teal-100/50 transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        {samplingCalcOpen ? <ChevronDown className="h-3 w-3 text-teal-500" /> : <ChevronRight className="h-3 w-3 text-teal-500" />}
                        <span className="text-[10px] font-bold text-teal-700 uppercase">Sampling Calculator</span>
                        {samplingCompleted && <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">Completed</span>}
                        {samplingResults && <span className="text-[8px] text-teal-500">{samplingResults.sampleSize} items sampled</span>}
                      </div>
                    </button>
                    {samplingCalcOpen && (
                      <div className="p-3">
                        <InlineSamplingPanel
                          engagementId={engagementId}
                          clientId={clientId || ''}
                          periodId={periodId || ''}
                          fsLine={fsLine}
                          testDescription={testDescription}
                          populationData={
                            pausedStep?.output?.populationData ||
                            flowSteps.find(s => s.output?.populationData?.length > 0)?.output?.populationData ||
                            flowSteps.find(s => s.output?.dataTable?.length > 0)?.output?.dataTable ||
                            flowSteps.find(s => s.output?.data?.populationData?.length > 0)?.output?.data?.populationData ||
                            []
                          }
                          initialSelectedIndices={
                            samplingResults?.selectedIndices ||
                            flowSteps.find(s => s.output?.selectedIndices?.length > 0)?.output?.selectedIndices ||
                            flowSteps.find(s => s.output?.samplingDone && s.output?.selectedIndices)?.output?.selectedIndices
                          }
                          materialityData={{ performanceMateriality: tolerableMisstatement, clearlyTrivial, tolerableMisstatement }}
                          onComplete={(results) => {
                            handleSamplingDone(results);
                          }}
                        />
                      </div>
                    )}
                  </div>
                )}

                {/* AI Analysis output — show raw analysis from AI steps */}
                {(() => {
                  const aiSteps = flowSteps.filter(s => s.output?.raw && s.output?.model);
                  if (aiSteps.length === 0) return null;
                  return aiSteps.map((step, i) => (
                    <div key={i} className="border border-purple-200 rounded-lg overflow-hidden">
                      <div className="px-3 py-2 bg-purple-50 border-b">
                        <span className="text-[10px] font-bold text-purple-700 uppercase">{step.label || 'AI Analysis'}</span>
                        {step.output?.model && <span className="text-[9px] text-purple-400 ml-2">{step.output.model}</span>}
                      </div>
                      <div className="px-3 py-2 text-xs text-slate-700 whitespace-pre-wrap max-h-[300px] overflow-auto leading-relaxed">
                        {step.output.raw}
                      </div>
                    </div>
                  ));
                })()}

                {/* Portal pause */}
                {isPortalPause && (
                  <div className="border border-sky-200 rounded-lg p-3 bg-sky-50/30">
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-sky-600" />
                      <span className="text-sm font-medium text-sky-700">Waiting for Client Response</span>
                    </div>
                    <p className="text-xs text-slate-500 mt-1">A request was sent to the client portal. The flow resumes automatically when they respond.</p>
                  </div>
                )}


                {/* Sample items + evidence grid (when we have data) */}
                {sampleItems.length > 0 ? (
                  <div className="border rounded-lg overflow-auto max-h-[400px]">
                    <table className="w-full text-xs border-collapse">
                      <thead className="sticky top-0 z-10">
                        <tr>
                          <th colSpan={4} className="bg-blue-600 text-white text-[10px] font-semibold px-3 py-1.5 text-left border-r-2 border-white">Sample Items</th>
                          <th colSpan={3} className="bg-green-600 text-white text-[10px] font-semibold px-3 py-1.5 text-left border-r-2 border-white">Client Evidence</th>
                          <th colSpan={2} className="bg-amber-600 text-white text-[10px] font-semibold px-3 py-1.5 text-left">Verification</th>
                        </tr>
                        <tr className="bg-slate-100 border-b text-[10px] text-slate-600 font-semibold">
                          <th className="px-2 py-1 text-left border-r border-slate-200 w-8">#</th>
                          <th className="px-2 py-1 text-left border-r border-slate-200">Description</th>
                          <th className="px-2 py-1 text-right border-r border-slate-200 w-20">Amount</th>
                          <th className="px-2 py-1 text-left border-r-2 border-blue-200 w-16">Date</th>
                          <th className="px-2 py-1 text-left border-r border-slate-200 w-16">Doc</th>
                          <th className="px-2 py-1 text-right border-r border-slate-200 w-20">Gross</th>
                          <th className="px-2 py-1 text-center border-r-2 border-green-200 w-14">Status</th>
                          <th className="px-2 py-1 text-center border-r border-slate-200 w-10">Amt</th>
                          <th className="px-2 py-1 text-center w-12">Result</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sampleItems.map((item, i) => {
                          const ev = evidence.find(e => e.itemId === item.id) || { status: 'pending' as const };
                          const res = results.find(r => r.itemId === item.id);
                          return (
                            <tr key={item.id} className={`border-b border-slate-100 hover:bg-blue-50/30 ${i % 2 ? 'bg-slate-50/30' : ''}`}>
                              <td className="px-2 py-1 text-slate-400 font-mono border-r border-slate-100">{item.ref || i + 1}</td>
                              <td className="px-2 py-1 text-slate-700 border-r border-slate-100 truncate max-w-[180px]">{item.description}</td>
                              <td className="px-2 py-1 text-right font-mono border-r border-slate-100">{fmt(item.amount)}</td>
                              <td className="px-2 py-1 text-slate-500 border-r-2 border-blue-100">{item.date || '—'}</td>
                              <td className="px-2 py-1 text-slate-600 font-mono border-r border-slate-100">{(ev as any).docRef || '—'}</td>
                              <td className="px-2 py-1 text-right font-mono border-r border-slate-100">{fmt((ev as any).gross)}</td>
                              <td className="px-2 py-1 text-center border-r-2 border-green-100">
                                <span className={`text-[8px] px-1 py-0.5 rounded-full font-medium ${ev.status === 'uploaded' ? 'bg-green-100 text-green-700' : ev.status === 'missing' ? 'bg-red-100 text-red-600' : 'bg-orange-100 text-orange-600'}`}>{ev.status}</span>
                              </td>
                              <td className="px-2 py-1 text-center border-r border-slate-100"><ResultIcon status={res?.amountMatch || 'pending'} /></td>
                              <td className="px-2 py-1 text-center">
                                {res?.overallResult === 'pass' && <span className="text-[8px] font-bold text-green-600 bg-green-50 px-1 py-0.5 rounded">PASS</span>}
                                {res?.overallResult === 'fail' && <span className="text-[8px] font-bold text-red-600 bg-red-50 px-1 py-0.5 rounded">FAIL</span>}
                                {(!res || res.overallResult === 'pending') && <span className="text-[8px] text-slate-400">—</span>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : !isSamplingPause && !isPortalPause && executionStatus !== 'running' && (
                  <p className="text-xs text-slate-400 text-center py-3">Sample items will appear here after sampling is complete.</p>
                )}
              </div>
            )}
          </div>

          {/* SECTION 3: Audit Verification (collapsible — Data Extraction layout) */}
          <div>
            <button onClick={() => setVerificationOpen(!verificationOpen)} className="w-full flex items-center justify-between px-4 py-2 bg-slate-50/50 hover:bg-slate-100 transition-colors">
              <div className="flex items-center gap-2">
                {verificationOpen ? <ChevronDown className="h-3.5 w-3.5 text-slate-400" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-400" />}
                <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">Audit Verification</span>
                {sampleItems.length > 0 && <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium">{sampleItems.length} items</span>}
              </div>
              {sampleItems.length > 0 && (
                <a
                  href={`/tools/data-extraction?engagementId=${engagementId}&executionId=${executionId || ''}&fsLine=${encodeURIComponent(fsLine)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={e => e.stopPropagation()}
                  className="inline-flex items-center gap-1 text-[10px] font-medium px-2.5 py-1 rounded-md bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                >
                  <ExternalLink className="h-3 w-3" />
                  Open Financial Data Extractor
                </a>
              )}
            </button>
            {verificationOpen && (
              <div className="p-3">
                <AuditVerificationPanel
                  engagementId={engagementId}
                  executionId={executionId || undefined}
                  fsLine={fsLine}
                  assertions={assertions}
                  sampleItems={sampleItems.map((item, i) => ({
                    index: i,
                    reference: item.ref || String(i + 1),
                    customer: item.description || '',
                    description: item.description || '',
                    date: item.date || '',
                    net: item.amount || 0,
                    tax: 0,
                    gross: item.amount || 0,
                  }))}
                  evidenceDocs={evidence.map((ev, i) => ({
                    sampleIndex: sampleItems.findIndex(s => s.id === ev.itemId),
                    fileName: ev.fileName || '',
                    docRef: ev.docRef || '',
                    date: ev.date || '',
                    seller: ev.seller || '',
                    net: ev.net || 0,
                    tax: ev.tax || 0,
                    gross: ev.gross || 0,
                    status: ev.status === 'uploaded' ? 'matched' as const : ev.status === 'missing' ? 'missing' as const : 'pending' as const,
                  }))}
                  verificationResults={results.map(r => ({
                    sampleIndex: sampleItems.findIndex(s => s.id === r.itemId),
                    amountMatch: r.amountMatch as any,
                    dateMatch: r.dateMatch as any,
                    periodCheck: r.periodCheck as any,
                    sellerMatch: r.consistency as any,
                    overallResult: r.overallResult as any,
                  }))}
                />
              </div>
            )}
          </div>

          {/* SECTION 4: Findings & Conclusions (collapsible) */}
          <div>
            <button onClick={() => setFindingsOpen(!findingsOpen)} className="w-full flex items-center justify-between px-4 py-2 bg-slate-50/50 hover:bg-slate-100 transition-colors">
              <div className="flex items-center gap-2">
                {findingsOpen ? <ChevronDown className="h-3.5 w-3.5 text-slate-400" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-400" />}
                <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">Findings & Conclusions</span>
                {conclusion !== 'pending' && <div className={`w-2.5 h-2.5 rounded-full ${dotColor}`} />}
              </div>
              {failCount > 0 && <span className="text-[9px] text-red-500 font-medium">{failCount} exception{failCount !== 1 ? 's' : ''}</span>}
            </button>
            {findingsOpen && (
              <div className="p-4 space-y-3">
                {/* Summary KPIs */}
                <div className="grid grid-cols-6 gap-3 text-center">
                  <div className="bg-slate-50 rounded-lg p-2">
                    <div className="text-[9px] text-slate-400 uppercase">Population</div>
                    <div className="text-sm font-bold text-slate-800">£{fmt(sampleValueTotal)}</div>
                  </div>
                  <div className="bg-slate-50 rounded-lg p-2">
                    <div className="text-[9px] text-slate-400 uppercase">Sample</div>
                    <div className="text-sm font-bold text-slate-800">{sampleTotal}</div>
                  </div>
                  <div className="bg-slate-50 rounded-lg p-2">
                    <div className="text-[9px] text-slate-400 uppercase">Errors</div>
                    <div className={`text-sm font-bold ${failCount > 0 ? 'text-red-600' : 'text-green-600'}`}>£{fmt(errorAmountTotal)}</div>
                  </div>
                  <div className="bg-slate-50 rounded-lg p-2">
                    <div className="text-[9px] text-slate-400 uppercase">Error %</div>
                    <div className={`text-sm font-bold ${errorPct > 0 ? 'text-red-600' : 'text-green-600'}`}>{errorPct.toFixed(1)}%</div>
                  </div>
                  <div className="bg-slate-50 rounded-lg p-2">
                    <div className="text-[9px] text-slate-400 uppercase">Extrapolated</div>
                    <div className={`text-sm font-bold ${extrapolatedError > clearlyTrivial ? 'text-red-600' : 'text-slate-800'}`}>£{fmt(extrapolatedError)}</div>
                  </div>
                  <div className="bg-slate-50 rounded-lg p-2">
                    <div className="text-[9px] text-slate-400 uppercase">CT / PM</div>
                    <div className="text-[10px] font-mono text-slate-600">£{fmt(clearlyTrivial)}</div>
                    <div className="text-[10px] font-mono text-slate-600">£{fmt(tolerableMisstatement)}</div>
                  </div>
                </div>

                {/* Error Investigation & Conclusion */}
                {(executionStatus === 'completed' || executionStatus === 'failed') && (
                  <ErrorInvestigationPanel
                    engagementId={engagementId}
                    executionId={executionId || undefined}
                    fsLine={fsLine}
                    testDescription={testDescription}
                    accountCode={tbRow?.accountCode}
                    sampleItems={sampleItems.map(s => ({ ref: s.ref, description: s.description, amount: s.amount }))}
                    verificationResults={results.map((r, i) => ({
                      itemIndex: i,
                      overallResult: r.overallResult,
                      difference: r.overallResult === 'fail' ? (sampleItems[i]?.amount || 0) * 0.1 : 0,
                      notes: r.notes,
                    }))}
                    populationSize={populationSize}
                    sampleSize={sampleTotal}
                    populationData={
                      flowSteps.find(s => s.output?.populationData?.length > 0)?.output?.populationData ||
                      flowSteps.find(s => s.output?.dataTable?.length > 0)?.output?.dataTable || []
                    }
                    priorSelectedIndices={samplingResults?.selectedIndices || flowSteps.find(s => s.output?.selectedIndices)?.output?.selectedIndices}
                    clientId={clientId}
                    periodId={periodId}
                    clearlyTrivial={clearlyTrivial}
                    performanceMateriality={tolerableMisstatement}
                    tolerableMisstatement={tolerableMisstatement}
                    onConclusionChange={(c) => onConclusionChange?.(c)}
                  />
                )}

                {/* Retry for failed executions */}
                {executionStatus === 'failed' && (
                  <div className="mt-2">
                    <Button onClick={handleRetry} size="sm" variant="outline" className="text-red-600 border-red-200"><RotateCcw className="h-3.5 w-3.5 mr-1" /> Retry</Button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
