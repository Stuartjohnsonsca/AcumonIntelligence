'use client';

import React, { useState, useEffect, useRef } from 'react';
import { X, Upload, FileText, CheckCircle2, XCircle, Clock, Loader2, ChevronRight, ChevronDown, ExternalLink, Play, RotateCcw, AlertTriangle, Ban, Calculator } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ItemErrorDetailPanel } from './ItemErrorDetailPanel';
import { InlineSamplingPanel } from './InlineSamplingPanel';
import { AuditVerificationPanel } from './AuditVerificationPanel';
import { ErrorInvestigationPanel } from './ErrorInvestigationPanel';
import { PropertyVerificationSection } from './PropertyVerificationSection';
import { PlanCustomiserModal } from './PlanCustomiserModal';

// ─── Types ───
interface SampleItem { id: string; ref: string; description: string; amount: number; date?: string; reference?: string; }
interface ClientEvidence { itemId: string; docRef?: string; fileName?: string; date?: string; seller?: string; purchaser?: string; net?: number; tax?: number; gross?: number; status: 'uploaded' | 'pending' | 'missing'; }
interface VerificationResult { itemId: string; amountMatch: string; dateMatch: string; periodCheck: string; consistency: string; overallResult: string; notes?: string; }
interface FlowStep { id: string; label: string; status: string; output?: any; errorMessage?: string; duration?: number; }
interface Props {
  testId: string; testDescription: string; testType: string; engagementId: string; fsLine: string;
  fsLineId?: string | null;
  clientId?: string; periodId?: string;
  tbRow?: { accountCode: string; description: string; currentYear: number | null; priorYear: number | null; fsNote: string | null };
  sessionId?: string; flowData?: any; executionDef?: any;
  assertions?: string[];  // Test assertions — drives verification columns
  conclusionRecord?: any; // Full AuditTestConclusion — used to check RI approval
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

export function TestExecutionPanel({ testId, testDescription, testType, engagementId, fsLine, fsLineId, clientId, periodId, tbRow, flowData, executionDef, assertions, conclusionRecord, onClose, onConclusionChange }: Props) {
  // RI Approved = Read-Only
  const riApproved = !!conclusionRecord?.riSignedByName;
  const riApprovedBy = conclusionRecord?.riSignedByName;
  const riApprovedAt = conclusionRecord?.riSignedAt ? new Date(conclusionRecord.riSignedAt).toLocaleDateString('en-GB') : '';

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
  // Action-pipeline: current action + step state for per-action UI branches.
  const [currentAction, setCurrentAction] = useState<{ code: string; name: string; handlerName: string | null } | null>(null);
  const [currentStepState, setCurrentStepState] = useState<Record<string, any> | null>(null);
  // Plan Customiser modal state — opened from the header button with the
  // current FS Line pre-populated. Allocated tests are fetched on open.
  const [planCustomiserOpen, setPlanCustomiserOpen] = useState(false);
  const [planCustomiserAllocated, setPlanCustomiserAllocated] = useState<Array<{
    id: string;
    name: string;
    description: string | null;
    testTypeCode: string;
    assertions: string[] | null;
    framework: string;
  }>>([]);
  const [diagnostics, setDiagnostics] = useState<string[]>([]);
  const [expandedStepId, setExpandedStepId] = useState<string | null>(null);
  const [samplingResults, setSamplingResults] = useState<{ runId: string; selectedIndices: number[]; sampleSize: number; coverage: number } | null>(null);
  const [samplingCompleted, setSamplingCompleted] = useState(false);
  const [samplingCalcOpen, setSamplingCalcOpen] = useState(true);
  const [starting, setStarting] = useState(false);
  const [completing, setCompleting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const continueRef = useRef(false);

  // Row selection for Large & Unusual review (click = select this + above, ctrl+click = deselect)
  const [investigateRows, setInvestigateRows] = useState<Set<number>>(new Set());
  const [selectionJustification, setSelectionJustification] = useState('');

  // Section collapse state
  const [progressOpen, setProgressOpen] = useState(false);
  const [samplingOpen, setSamplingOpen] = useState(true);
  const [findingsOpen, setFindingsOpen] = useState(false);
  const [verificationRowStates, setVerificationRowStates] = useState<Record<number, any>>({});
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
  const isReviewFlaggedPause = pausedStep?.output?.triggerType === 'review_flagged';
  // Also detect review_flagged tests even when not paused (after refresh/resume) — if any step has scored data with _score field
  const isReviewFlaggedTest = isReviewFlaggedPause || flowSteps.some(s => s.output?.dataTable?.[0]?.hasOwnProperty('_score')) || flowSteps.some(s => s.label?.includes('Review') && s.label?.includes('Flagged'));
  const isSamplingPause = !isReviewFlaggedTest && (pausedStep?.output?.triggerType === 'sampling' || pausedStep?.label?.toLowerCase().includes('sampl'));
  const isPortalPause = !!pausedStep?.output?.portalRequestId;
  const pauseItemId = pausedStep?.output?.outstandingItemId || pausedStep?.output?.portalRequestId;

  // Auto-collapse progress when sampling/portal is active
  useEffect(() => {
    if (isSamplingPause || isPortalPause || isReviewFlaggedPause) {
      setProgressOpen(false);
      setSamplingOpen(true);
    }
  }, [isSamplingPause, isPortalPause]);

  // Report conclusion to parent
  useEffect(() => { onConclusionChange?.(conclusion); }, [conclusion]);

  // Populate sampleItems and evidence from flow step outputs
  useEffect(() => {
    // Don't skip if already populated — re-populate when flow steps change (e.g. evidence arrives)
    // if (sampleItems.length > 0) return;

    // FIRST: check if actual sampleItems were passed (from review_flagged or similar)
    // These are the real items the user selected — no index mapping needed
    let actualSampleItems: any[] = [];
    for (const step of flowSteps) {
      if (step.output?.sampleItems?.length > 0) actualSampleItems = step.output.sampleItems;
    }

    // Find population data and selected indices from any step (fallback)
    let populationData: any[] = [];
    let selectedIndices: number[] = [];

    for (const step of flowSteps) {
      if (!step.output) continue;
      if (step.output.populationData?.length > 0 && populationData.length === 0) populationData = step.output.populationData;
      if (step.output.dataTable?.length > 0 && populationData.length === 0) populationData = step.output.dataTable;
      if (step.output.selectedIndices?.length > 0) selectedIndices = step.output.selectedIndices;
    }

    // Also check samplingResults from local state (includes sampleItems from "Investigate" click)
    if ((samplingResults?.selectedIndices?.length ?? 0) > 0 && selectedIndices.length === 0) {
      selectedIndices = samplingResults!.selectedIndices!;
    }
    if ((samplingResults as any)?.sampleItems?.length > 0 && actualSampleItems.length === 0) {
      actualSampleItems = (samplingResults as any).sampleItems;
    }

    // Use actual sampleItems if available, otherwise fall back to index mapping
    // Never fall through to entire population — that shows garbage before real data arrives
    const items = actualSampleItems.length > 0
      ? actualSampleItems
      : (selectedIndices.length > 0 && populationData.length > 0)
        ? selectedIndices.map(idx => populationData[idx]).filter(Boolean)
        : [];

    if (items.length > 0) {
      setSampleItems(items.map((item: any, i: number) => {
        // Resolve amount: try amount/total first, then debit/credit for bank statements
        const amount = Number(item.amount || item.Amount || item.total || item.Total || item.lineAmount || item.LineAmount || 0)
          || Number(item.debit || item.debitFC || 0)
          || Number(item.credit || item.creditFC || 0)
          || Number(item.gross || item.Gross || 0);
        return {
          id: item.invoiceNumber || item.InvoiceNumber || item.reference || item.Reference || item.accountNumber || String(i + 1),
          ref: item.invoiceNumber || item.InvoiceNumber || item.reference || item.Reference || item.accountNumber || String(i + 1),
          description: item.description || item.Description || item.contact || item.Contact || item.ContactName || item.narrative || '',
          amount,
          date: item.date || item.Date || '',
          reference: item.reference || item.Reference || item.invoiceNumber || item.InvoiceNumber || item.accountNumber || '',
        };
      }));
    }

    // Extract evidence from forEach loop results AND individual fetch steps
    const newEvidence: typeof evidence = [];

    // 1. Check forEach loop completion results (accumulated per iteration)
    const loopDoneStep = flowSteps.find(s => s.output?.loopCompleted && s.output?.results?.length > 0);
    if (loopDoneStep?.output?.results) {
      for (let ri = 0; ri < loopDoneStep.output.results.length; ri++) {
        const r = loopDoneStep.output.results[ri];
        if (!r) continue;
        const inv = r.invoice;
        const itemRef = r.reference || (sampleItems[ri]?.id) || String(ri + 1);
        const sampleItem = sampleItems[ri];

        // Parse Xero date format: /Date(1687305600000+0000)/ → readable date
        const rawDate = inv?.Date || inv?.DueDate || '';
        let parsedDate = rawDate;
        if (typeof rawDate === 'string' && rawDate.includes('/Date(')) {
          const ms = parseInt(rawDate.replace(/\/Date\((\d+)[+-]\d+\)\//, '$1'));
          if (!isNaN(ms)) parsedDate = new Date(ms).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
        }

        // Use the match assessment from the flow engine (actual comparison)
        const evidenceGross = Number(inv?.Total || 0);
        const sampleGross = Number(sampleItem?.amount || 0);
        const amountMatches = r.amountMatches;
        let matchStatus: 'matched' | 'partial' | 'missing' | 'pending' = 'pending';
        if (r.evidenceRetrieved && inv) {
          matchStatus = amountMatches ? 'matched' : 'partial'; // partial = found but amounts differ
        } else if (r.portalRequestCreated) {
          matchStatus = 'pending';
        } else if (!r.found) {
          matchStatus = 'missing';
        }

        // Build preview URL if we have a storage path
        const previewUrl = r.storagePath ? `/api/documents/preview?path=${encodeURIComponent(r.storagePath)}` : undefined;

        newEvidence.push({
          itemId: itemRef,
          sampleIndex: ri, // Map to sampleItems by position
          docRef: inv?.InvoiceNumber || inv?.Reference || r.reference || r.documentName || '',
          fileName: r.fileName || r.documentName || '',
          date: parsedDate,
          seller: inv?.Contact?.Name || '',
          net: Number(inv?.SubTotal || 0),
          tax: Number(inv?.TotalTax || 0),
          gross: evidenceGross,
          status: matchStatus,
          previewUrl,
          storagePath: r.storagePath,
          documentId: r.documentId,
          matchAssessment: r.matchAssessment,
          description: (inv?.LineItems || []).map((li: any) => li.Description || '').filter(Boolean).join('; ') || r.documentName || '',
        } as any);
      }
    }

    // 2. Also check individual fetch steps (for single-iteration or current iteration)
    const evidenceSteps = flowSteps.filter(s => s.output?.evidenceSource || s.output?.invoice);
    if (newEvidence.length === 0 && evidenceSteps.length > 0) {
      for (let si = 0; si < evidenceSteps.length; si++) {
        const step = evidenceSteps[si];
        const inv = step.output?.invoice;
        newEvidence.push({
          itemId: step.output?.reference || String(si + 1),
          docRef: inv?.InvoiceNumber || inv?.Reference || step.output?.reference || '',
          fileName: step.output?.fileName || inv?.InvoiceNumber || '',
          date: inv?.Date || inv?.DueDate || '',
          seller: inv?.Contact?.Name || '',
          net: Number(inv?.SubTotal || 0),
          tax: Number(inv?.TotalTax || 0),
          gross: Number(inv?.Total || 0),
          status: step.output?.found ? 'uploaded' as const : 'pending' as const,
        });
      }
    }

    if (newEvidence.length > 0) {
      setEvidence(newEvidence);
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
          const steps = existing.nodeRuns?.map((r: any) => ({ id: r.nodeId, label: r.label || r.nodeType, status: r.status, output: r.output, errorMessage: r.errorMessage, duration: r.duration })) || [];

          // Load full execution context to get forEach loop body results
          // (loop body node runs are skipped to reduce DB writes, but context has everything)
          try {
            const detailRes = await fetch(`/api/engagements/${engagementId}/test-execution/${existing.id}`);
            if (detailRes.ok) {
              const detail = await detailRes.json();
              const ctx = detail.execution?.context || (detail.flowSnapshot ? null : null);
              // Capture action-pipeline state for per-action UI branches
              if (detail.execution?.currentAction) setCurrentAction(detail.execution.currentAction);
              if (detail.execution?.pipelineState && detail.execution.currentStepIndex != null) {
                setCurrentStepState(detail.execution.pipelineState[detail.execution.currentStepIndex] || null);
              }
              // Inject loop results and evidence data from context into flowSteps
              if (ctx?.nodes) {
                for (const [nodeId, nodeOutput] of Object.entries(ctx.nodes)) {
                  const out = nodeOutput as any;
                  if (!out) continue;
                  // Add forEach body results as a virtual flow step if not already present
                  if (out.evidenceSource || out.found !== undefined || out.documentId) {
                    if (!steps.find((s: any) => s.id === nodeId && s.output?.evidenceSource)) {
                      steps.push({ id: nodeId, label: 'Evidence', status: 'completed', output: out });
                    }
                  }
                  // Add loop completion with results
                  if (out.loopCompleted && out.results?.length > 0) {
                    const existingStep = steps.find((s: any) => s.id === nodeId);
                    if (existingStep) existingStep.output = out;
                  }
                  // Restore user's row selections from review step
                  if (out.selectedIndices && out.triggerType === 'review_flagged') {
                    setInvestigateRows(new Set(out.selectedIndices));
                  }
                }
              }
            }
          } catch {}

          setFlowSteps(steps);
          if (existing.errorMessage) setExecutionError(existing.errorMessage);
          if (existing.status === 'running' || existing.status === 'paused') startPolling(existing.id);
        }
      }
    } catch {} finally { setLoading(false); }
  }

  async function handleStartExecution() {
    // Full reset — re-run clears ALL previous data
    setStarting(true); setExecutionError(null); setDiagnostics([]); setFlowSteps([]);
    setSampleItems([]); setEvidence([]); setResults([]); setInvestigateRows(new Set());
    setSamplingResults(null); setSamplingCompleted(false);
    setItemDetails({}); setPopulationSize(0);
    setFindingsOpen(false); setVerificationOpen(true); setSamplingOpen(true);
    setExpandedStepId(null); setPauseReason(null);
    setExecutionId(null); setExecutionStatus('not_started');
    try {
      const res = await fetch(`/api/engagements/${engagementId}/test-execution`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fsLine, fsLineId, testDescription, testTypeCode: testType, flowData, tbRow }),
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
        // Inject evidence data from execution context into flow steps
        const steps = data.flowSteps || [];
        const ctx = data.execution?.context;
        if (ctx?.nodes) {
          for (const [nodeId, nodeOutput] of Object.entries(ctx.nodes)) {
            const out = nodeOutput as any;
            if (!out) continue;
            if (out.evidenceSource || out.found !== undefined || out.documentId) {
              if (!steps.find((s: any) => s.id === nodeId && s.output?.evidenceSource)) {
                steps.push({ id: nodeId, label: 'Evidence', status: 'completed', output: out });
              }
            }
            if (out.loopCompleted && out.results?.length > 0) {
              const existingStep = steps.find((s: any) => s.id === nodeId);
              if (existingStep) existingStep.output = out;
            }
          }
        }
        setFlowSteps(steps);
        // Action-pipeline: capture current action + step state for per-action UI
        if (data.execution?.currentAction !== undefined) setCurrentAction(data.execution.currentAction);
        if (data.execution?.pipelineState && data.execution.currentStepIndex != null) {
          setCurrentStepState(data.execution.pipelineState[data.execution.currentStepIndex] || null);
        }
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
    <div>
      {riApproved && (
        <div className="bg-green-50 border border-green-200 rounded-t-lg px-4 py-2 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-green-600" />
          <span className="text-xs font-medium text-green-800">Approved by {riApprovedBy}{riApprovedAt ? ` on ${riApprovedAt}` : ''} — Read Only</span>
        </div>
      )}
    <div className={`border rounded-lg bg-white overflow-hidden shadow-sm ${riApproved ? 'pointer-events-none opacity-70' : ''}`}>
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
          }`}>{executionStatus === 'completed' ? 'Complete' : executionStatus === 'paused' ? `Paused${pauseReason ? ` — ${pauseReason === 'portal_response' ? 'Awaiting client evidence' : pauseReason === 'sampling' ? 'Awaiting sample selection' : pauseReason === 'review_flagged' ? 'Awaiting review' : pauseReason === 'review' ? 'Awaiting review' : pauseReason.replace(/_/g, ' ')}` : ''}` : executionStatus === 'running' ? 'Running' : executionStatus === 'failed' ? 'Failed' : 'Not Started'}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {(executionStatus === 'running' || executionStatus === 'paused') && (
            <button onClick={handleCancel} className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded border border-red-200 text-red-600 hover:bg-red-50"><Ban className="h-3 w-3" /> Stop</button>
          )}
          {executionId && executionStatus !== 'not_started' && (
            <button onClick={handleReset} className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded border border-slate-200 text-slate-600 hover:bg-slate-100"><RotateCcw className="h-3 w-3" /> Reset</button>
          )}
          {/* Plan Customiser — trim or extend the auto-generated audit plan
              for this engagement. Allocated tests are fetched once when the
              modal opens, scoped to this test's FS Line. */}
          {fsLineId && (
            <button
              onClick={async () => {
                try {
                  const res = await fetch(`/api/engagements/${engagementId}/test-allocations`);
                  if (res.ok) {
                    const data = await res.json();
                    const allocated = (data.allocations || [])
                      .filter((a: any) => a.fsLineId === fsLineId && a.test)
                      .map((a: any) => ({
                        id: a.test.id,
                        name: a.test.name,
                        description: a.test.description,
                        testTypeCode: a.test.testTypeCode,
                        assertions: a.test.assertions,
                        framework: a.test.framework,
                      }));
                    setPlanCustomiserAllocated(allocated);
                  }
                } catch {}
                setPlanCustomiserOpen(true);
              }}
              className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded border border-indigo-300 text-indigo-700 bg-indigo-50 hover:bg-indigo-100"
              title="Plan Customiser — mark tests N/A or add engagement-specific custom tests for this FS Line"
            >
              Plan Customiser
            </button>
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

          {/* Action-specific: UK Property Asset Verification */}
          {currentAction?.code === 'verify_property_assets' && executionId && (
            <div className="p-4">
              <PropertyVerificationSection
                executionId={executionId}
                engagementId={engagementId}
                pipelineStepState={currentStepState}
                pauseReason={pauseReason}
                currentUserName={conclusionRecord?.reviewedByName || 'Current User'}
                onResumed={() => { /* poll loop will refresh state */ }}
              />
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
                        {step.output?.source && <span className={`text-[8px] px-1 py-0.5 rounded-full font-medium ${step.output.fallbackUsed ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>{step.output.source}{step.output.fallbackUsed ? ' (fallback)' : ''}</span>}
                        {step.output?.evidenceFound === false && <span className="text-[8px] px-1 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">No evidence</span>}
                        {step.status === 'paused' && <span className="text-[8px] px-1 py-0.5 rounded-full bg-orange-100 text-orange-600 font-medium">Paused{pauseReason ? `: ${pauseReason}` : ''}</span>}
                        {step.errorMessage && <span className="text-[8px] text-red-500 break-words max-w-[250px]">{step.errorMessage}</span>}
                        {step.duration && <span className="text-[8px] text-slate-400">{(step.duration / 1000).toFixed(1)}s</span>}
                        {hasOutput && <span className="text-[8px] text-slate-300">{isExpanded ? '▼' : '▶'}</span>}
                      </div>
                      {isExpanded && hasOutput && (
                        <div className="px-4 py-2 bg-slate-50 border-t border-slate-100 space-y-2">
                          {/* Summary — human-readable explanation */}
                          {step.output.summary && (
                            <div className="text-xs text-slate-700 bg-blue-50 rounded border border-blue-100 px-3 py-2">
                              {step.output.summary}
                            </div>
                          )}
                          {/* Decision log — step-by-step audit trail */}
                          {step.output.decisionLog && Array.isArray(step.output.decisionLog) && (
                            <div className="space-y-1">
                              {step.output.decisionLog.map((entry: any, di: number) => (
                                <div key={di} className="flex gap-2 text-[10px]">
                                  <span className="text-slate-400 shrink-0 w-4 text-right">{di + 1}.</span>
                                  <span className="text-slate-500 shrink-0 font-medium">{entry.step}:</span>
                                  <span className="text-slate-700">{entry.result}</span>
                                </div>
                              ))}
                            </div>
                          )}
                          {/* Source info */}
                          {step.output.source && (
                            <div className="flex gap-3 text-[10px]">
                              <span className="text-slate-400">Source:</span>
                              <span className="text-slate-700 font-medium">{step.output.source}{step.output.orgName ? ` (${step.output.orgName})` : ''}</span>
                              {step.output.fallbackUsed && <span className="text-[8px] px-1 py-0 bg-amber-100 text-amber-700 rounded">Fallback</span>}
                            </div>
                          )}
                          {step.output.dateRange && (
                            <div className="flex gap-3 text-[10px]">
                              <span className="text-slate-400">Date range:</span>
                              <span className="text-slate-700">{step.output.dateRange.from} to {step.output.dateRange.to}</span>
                            </div>
                          )}
                          {/* Raw JSON fallback — only for outputs without summary */}
                          {!step.output.summary && !step.output.decisionLog && (
                            <div className="text-[9px] font-mono text-slate-600 whitespace-pre-wrap max-h-[200px] overflow-auto bg-white rounded border border-slate-200 p-2">
                              {(() => {
                                const display = { ...step.output };
                                if (display.raw && typeof display.raw === 'string' && display.raw.length > 500) display.raw = display.raw.slice(0, 500) + '... [truncated]';
                                if (display.dataTable) display.dataTable = `[${display.dataTable.length} rows]`;
                                if (display.populationData) display.populationData = `[${display.populationData.length} rows]`;
                                return JSON.stringify(display, null, 2);
                              })()}
                            </div>
                          )}
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
                <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">{isReviewFlaggedTest ? 'Review Flagged Items' : 'Data & Sampling'}</span>
                {isReviewFlaggedTest && <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-700 font-medium">Review Required — Select items to investigate</span>}
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
                  // Use the LAST step with data (scored/ranked data comes after raw extract)
                  const popSteps = flowSteps.filter(s => s.output?.populationData?.length > 0 || s.output?.dataTable?.length > 0);
                  const popStep = popSteps[popSteps.length - 1];
                  const population = popStep?.output?.populationData || popStep?.output?.dataTable || [];
                  const selectedIdx = new Set(
                    samplingResults?.selectedIndices ||
                    flowSteps.find(s => s.output?.selectedIndices?.length > 0)?.output?.selectedIndices || []
                  );
                  if (population.length === 0) return null;
                  // Show all meaningful columns — exclude internal/metadata fields but keep _score
                  const SKIP_COLS = new Set(['sourceFile', 'tbAccountCode', 'functionalCurrency', 'page', 'fxRate', '_index', '_flagged', '_belowThreshold', '_error', '_reasons']);
                  const dataCols = Object.keys(population[0]).filter(k => !SKIP_COLS.has(k) && k !== '_score');
                  const hasScores = population[0]?.hasOwnProperty('_score');
                  // Put Score first if it exists, then data columns
                  const cols = hasScores ? ['_score', ...dataCols] : dataCols;
                  const flaggedCount = population.filter((r: any) => r._flagged).length;
                  const hasFlagAnnotations = flaggedCount > 0;
                  return (
                    <div className="border rounded-lg overflow-hidden">
                      <div className="px-3 py-2 bg-slate-50 border-b flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-bold text-slate-600 uppercase">Full Extracted Data ({population.length} records{selectedIdx.size > 0 ? ` — ${selectedIdx.size} selected` : ''})</span>
                          {hasFlagAnnotations && (
                            <span className="text-[9px] px-1.5 py-0.5 bg-orange-100 text-orange-700 rounded-full font-medium">{flaggedCount} flagged</span>
                          )}
                          {investigateRows.size > 0 && (
                            <span className="text-[9px] px-1.5 py-0.5 bg-red-100 text-red-700 rounded-full font-medium">{investigateRows.size} selected for investigation</span>
                          )}
                        </div>
                        <span className="text-[9px] text-slate-400">Source: {popStep?.label || 'Flow step'} | {cols.length} columns</span>
                      </div>
                      <div className="max-h-[500px] overflow-auto">
                        <table className="w-full text-[9px] border-collapse">
                          <thead className="sticky top-0 z-10">
                            <tr className="bg-slate-100 border-b">
                              <th className="px-1 py-1 text-center w-6 font-semibold text-slate-500">#</th>
                              {(selectedIdx.size > 0 || hasFlagAnnotations) && <th className="px-1 py-1 text-center w-6 font-semibold text-slate-500">{hasFlagAnnotations ? '!' : 'Sel'}</th>}
                              {cols.map(c => <th key={c} className={`px-1.5 py-1 text-left font-semibold whitespace-nowrap ${c === '_score' ? 'text-orange-700 bg-orange-50' : 'text-slate-600'}`}>{c === '_score' ? 'Score' : c}</th>)}
                            </tr>
                          </thead>
                          <tbody>
                            {population.map((row: any, i: number) => {
                              const isSampled = selectedIdx.has(i);
                              const isFlagged = !!row._flagged;
                              const isInvestigate = investigateRows.has(i);
                              // Colours: red = user selected for investigation, orange = system flagged, white = not flagged
                              return (
                                <tr key={i}
                                  onClick={(e) => {
                                    if (e.shiftKey) {
                                      // Shift+Click: deselect this row and all below it (red → white)
                                      setInvestigateRows(prev => {
                                        const n = new Set(prev);
                                        for (let r = i; r < population.length; r++) n.delete(r);
                                        return n;
                                      });
                                    } else if (e.ctrlKey || e.metaKey) {
                                      // Ctrl+Click: toggle just this row
                                      setInvestigateRows(prev => { const n = new Set(prev); if (n.has(i)) n.delete(i); else n.add(i); return n; });
                                    } else {
                                      // Click: select this row and all above it (red)
                                      setInvestigateRows(prev => {
                                        const n = new Set(prev);
                                        for (let r = 0; r <= i; r++) n.add(r);
                                        return n;
                                      });
                                    }
                                  }}
                                  className={`border-b border-slate-50 cursor-pointer ${
                                  isInvestigate ? 'bg-red-100' :
                                  isFlagged ? 'bg-orange-50/50' :
                                  isSampled ? 'bg-green-50 font-medium' : 'hover:bg-slate-50/50'
                                }`}>
                                  <td className="px-1 py-0.5 text-center text-slate-400">{i + 1}</td>
                                  {(selectedIdx.size > 0 || hasFlagAnnotations || investigateRows.size > 0) && (
                                    <td className="px-1 py-0.5 text-center">
                                      {isInvestigate && <span className="w-2 h-2 rounded-full bg-red-500 inline-block" title="Selected for investigation" />}
                                      {!isInvestigate && isFlagged && <span className="w-2 h-2 rounded-full bg-orange-400 inline-block" title="Flagged for review" />}
                                      {!isInvestigate && !isFlagged && isSampled && <span className="w-2 h-2 rounded-full bg-green-500 inline-block" title="Selected" />}
                                    </td>
                                  )}
                                  {cols.map(c => (
                                    <td key={c} className={`px-1.5 py-0.5 whitespace-nowrap max-w-[200px] truncate ${c === '_score' ? 'font-bold text-center' : 'text-slate-600'} ${c === '_score' && isFlagged ? 'text-orange-700 bg-orange-50' : c === '_score' ? 'text-slate-400' : ''}`} title={c === '_score' && Array.isArray(row._reasons) ? row._reasons.join(', ') : String(row[c] ?? '')}>
                                      {typeof row[c] === 'number' ? row[c].toLocaleString('en-GB', { maximumFractionDigits: 2 }) : String(row[c] ?? '')}
                                    </td>
                                  ))}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })()}

                {/* Sampling methodology details — hidden for review_flagged tests */}
                {samplingResults && !isReviewFlaggedTest && (
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

                {/* Sampling calculator — shown when population data exists, but NOT for review_flagged tests */}
                {!isReviewFlaggedTest && (isSamplingPause || samplingCompleted || flowSteps.some(s => s.output?.populationData?.length > 0 || s.output?.dataTable?.length > 0 || s.output?.triggerType === 'sampling')) && (
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

                {/* Review flagged pause — auditor reviews ranked results and confirms */}
                {isReviewFlaggedPause && (
                  <div className="border border-orange-200 rounded-lg p-3 bg-orange-50/30 space-y-2">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-orange-600" />
                      <span className="text-sm font-medium text-orange-700">Review the flagged items above</span>
                    </div>
                    <p className="text-xs text-slate-600">
                      The population is ranked by unusualness score. Orange rows are above the threshold and need your review.
                      Select the items you want to investigate (they will be sent for evidence gathering), then click continue.
                    </p>
                    {/* Selection justification — auditor explains why these items were chosen (and others excluded) */}
                    <div>
                      <label className="text-[10px] font-semibold text-slate-600 uppercase block mb-1">Selection Justification</label>
                      <textarea
                        value={selectionJustification}
                        onChange={e => setSelectionJustification(e.target.value)}
                        placeholder="Justify your selection — explain why these items were chosen for investigation and why excluded items were deemed acceptable..."
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs min-h-[80px] focus:outline-none focus:border-blue-400 resize-y"
                      />
                    </div>
                    <button
                      onClick={() => {
                        const popStepsForIdx = flowSteps.filter(s => s.output?.populationData?.length > 0 || s.output?.dataTable?.length > 0);
                        const popData = popStepsForIdx[popStepsForIdx.length - 1]?.output?.populationData || popStepsForIdx[popStepsForIdx.length - 1]?.output?.dataTable || [];
                        const selectedItems = Array.from(investigateRows).map(displayIdx => popData[displayIdx]).filter(Boolean);
                        handleSamplingDone({ runId: '', selectedIndices: Array.from(investigateRows), sampleSize: selectedItems.length, coverage: 0, sampleItems: selectedItems, selectionJustification } as any);
                      }}
                      disabled={completing || investigateRows.size === 0}
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50"
                    >
                      {completing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                      Investigate {investigateRows.size} Selected Items
                    </button>
                  </div>
                )}

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


                {/* Sample items + evidence grid (when we have data, and not mid-transition) */}
                {sampleItems.length > 0 && !completing ? (
                  <div className="border rounded-lg overflow-auto max-h-[400px]">
                    <table className="w-full text-xs border-collapse">
                      <thead className="sticky top-0 z-10">
                        <tr>
                          <th colSpan={4} className="bg-blue-600 text-white text-[10px] font-semibold px-3 py-1.5 text-left border-r-2 border-white">Sample Items</th>
                          <th colSpan={3} className="bg-green-600 text-white text-[10px] font-semibold px-3 py-1.5 text-left">Client Evidence</th>
                        </tr>
                        <tr className="bg-slate-100 border-b text-[10px] text-slate-600 font-semibold">
                          <th className="px-2 py-1 text-left border-r border-slate-200 w-8">#</th>
                          <th className="px-2 py-1 text-left border-r border-slate-200">Description</th>
                          <th className="px-2 py-1 text-right border-r border-slate-200 w-20">Amount</th>
                          <th className="px-2 py-1 text-left border-r-2 border-blue-200 w-16">Date</th>
                          <th className="px-2 py-1 text-left border-r border-slate-200 w-16">Doc</th>
                          <th className="px-2 py-1 text-right border-r border-slate-200 w-20">Gross</th>
                          <th className="px-2 py-1 text-center w-14">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sampleItems.map((item, i) => {
                          const ev = evidence.find(e => e.itemId === item.id || e.itemId === item.ref) || { status: 'pending' as const };
                          const res = results.find(r => r.itemId === item.id);
                          // Determine per-row evidence gathering status from loop results
                          const loopStep = flowSteps.find(s => s.output?.loopCompleted || s.output?.iterating);
                          const loopResults = loopStep?.output?.results || [];
                          const loopItemResult = loopResults[i];
                          const isLoopRunning = executionStatus === 'running' || executionStatus === 'paused';
                          const loopCurrentIndex = flowSteps.find(s => s.output?.iterating)?.output?.index;

                          // Row status: what's happening with this item's evidence?
                          let rowStatus = 'pending';
                          let rowStatusLabel = 'Pending';
                          let rowStatusClass = 'bg-slate-100 text-slate-500';
                          if (loopItemResult?.found) {
                            rowStatus = 'obtained';
                            rowStatusLabel = loopItemResult.evidenceSource === 'accounting_system' ? 'From Xero' : 'Uploaded';
                            rowStatusClass = 'bg-green-100 text-green-700';
                          } else if (loopItemResult?.portalRequestCreated) {
                            rowStatus = 'requested';
                            rowStatusLabel = 'Requested (Portal)';
                            rowStatusClass = 'bg-amber-100 text-amber-700';
                          } else if (ev.status === 'uploaded') {
                            rowStatus = 'obtained';
                            rowStatusLabel = 'Evidence obtained';
                            rowStatusClass = 'bg-green-100 text-green-700';
                          } else if (isLoopRunning && loopCurrentIndex === i) {
                            rowStatus = 'extracting';
                            rowStatusLabel = 'Extracting...';
                            rowStatusClass = 'bg-blue-100 text-blue-700 animate-pulse';
                          } else if (isLoopRunning && loopCurrentIndex !== undefined && i < loopCurrentIndex) {
                            rowStatus = 'done';
                            rowStatusLabel = 'Processed';
                            rowStatusClass = 'bg-green-100 text-green-700';
                          }

                          return (
                            <tr key={item.id} className={`border-b border-slate-100 hover:bg-blue-50/30 ${
                              rowStatus === 'extracting' ? 'bg-blue-50/30' :
                              rowStatus === 'obtained' ? 'bg-green-50/20' :
                              rowStatus === 'requested' ? 'bg-amber-50/20' :
                              i % 2 ? 'bg-slate-50/30' : ''
                            }`}>
                              <td className="px-2 py-1 text-slate-400 font-mono border-r border-slate-100">{item.ref || i + 1}</td>
                              <td className="px-2 py-1 text-slate-700 border-r border-slate-100 truncate max-w-[180px]">{item.description}</td>
                              <td className="px-2 py-1 text-right font-mono border-r border-slate-100">{fmt(item.amount)}</td>
                              <td className="px-2 py-1 text-slate-500 border-r-2 border-blue-100">{item.date || '—'}</td>
                              <td className="px-2 py-1 text-slate-600 font-mono border-r border-slate-100">{(ev as any).docRef || (loopItemResult?.reference || '—')}</td>
                              <td className="px-2 py-1 text-right font-mono border-r border-slate-100">{fmt((ev as any).gross || loopItemResult?.invoice?.Total)}</td>
                              <td className="px-2 py-1 text-center">
                                <span className={`text-[8px] px-1.5 py-0.5 rounded-full font-medium ${rowStatusClass}`} title={rowStatus === 'requested' ? 'Waiting for client to upload via portal' : ''}>{rowStatusLabel}</span>
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
                  href={`/tools/data-extraction?engagementId=${engagementId}&executionId=${executionId || ''}&fsLine=${encodeURIComponent(fsLine)}${clientId ? `&clientId=${clientId}` : ''}${periodId ? `&periodId=${periodId}` : ''}`}
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
                  evidenceDocs={evidence.map((ev, i) => {
                    const si = (ev as any).sampleIndex ?? sampleItems.findIndex(s => s.id === ev.itemId || s.ref === ev.itemId);
                    return {
                      sampleIndex: si >= 0 ? si : i,
                      itemId: ev.itemId,
                      fileName: ev.fileName || '',
                      docRef: ev.docRef || '',
                      date: ev.date || '',
                      seller: ev.seller || '',
                      description: (ev as any).description || '',
                      net: ev.net || 0,
                      tax: ev.tax || 0,
                      gross: ev.gross || 0,
                      status: ev.status === 'uploaded' ? 'matched' as const : ev.status === 'missing' ? 'missing' as const : ev.status || 'pending' as const,
                      previewUrl: (ev as any).previewUrl || undefined,
                      storagePath: (ev as any).storagePath || undefined,
                      documentId: (ev as any).documentId || undefined,
                      matchAssessment: (ev as any).matchAssessment || undefined,
                    };
                  })}
                  verificationResults={results.map(r => ({
                    sampleIndex: (r as any).sampleIndex ?? sampleItems.findIndex(s => s.id === r.itemId),
                    amountMatch: r.amountMatch as any,
                    dateMatch: r.dateMatch as any,
                    periodCheck: r.periodCheck as any,
                    sellerMatch: r.consistency as any,
                    overallResult: r.overallResult as any,
                  }))}
                  onRowStatesChange={setVerificationRowStates}
                />
              </div>
            )}
          </div>

          {/* SECTION 4: Findings & Conclusions */}
          {(() => {
            const evidenceObtained = (e: any) => e.status === 'uploaded' || e.status === 'matched' || e.status === 'partial';
            const hasEvidence = evidence.length > 0 && evidence.some(evidenceObtained);
            const loopStep = flowSteps.find(s => s.output?.loopCompleted && s.output?.results?.length > 0);
            const loopEvidenceCount = loopStep?.output?.results?.filter((r: any) => r?.found || r?.evidenceRetrieved)?.length || 0;
            const totalEvidenceCount = Math.max(evidence.filter(evidenceObtained).length, loopEvidenceCount);
            const allEvidenceObtained = sampleItems.length > 0 && totalEvidenceCount >= sampleItems.length;
            const canConclude = allEvidenceObtained || executionStatus === 'completed';
            // For review_flagged: conclusion requires all items actioned
            const actionedCount = sampleItems.filter((_, i) => verificationRowStates[i]?.action).length;
            const allActioned = sampleItems.length > 0 && actionedCount >= sampleItems.length;
            const globalSignOff = verificationRowStates[-1] || {};
            return (
          <div>
            <button onClick={() => setFindingsOpen(!findingsOpen)} className="w-full flex items-center justify-between px-4 py-2 bg-slate-50/50 hover:bg-slate-100 transition-colors">
              <div className="flex items-center gap-2">
                {findingsOpen ? <ChevronDown className="h-3.5 w-3.5 text-slate-400" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-400" />}
                <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">{isReviewFlaggedTest ? 'Conclusion Summary' : 'Findings & Conclusions'}</span>
                {isReviewFlaggedTest && sampleItems.length > 0 && (
                  <span className={`text-[8px] px-1.5 py-0.5 rounded-full font-medium ${allActioned ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                    {actionedCount}/{sampleItems.length} actioned
                  </span>
                )}
                {!isReviewFlaggedTest && !hasEvidence && sampleItems.length > 0 && <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">Awaiting evidence</span>}
                {!isReviewFlaggedTest && hasEvidence && !allEvidenceObtained && <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">{totalEvidenceCount}/{sampleItems.length} evidence</span>}
                {canConclude && conclusion !== 'pending' && <div className={`w-2.5 h-2.5 rounded-full ${dotColor}`} />}
              </div>
              {/* Reviewer + RI sign-off for review_flagged tests */}
              {isReviewFlaggedTest && (
                <div className="flex items-center gap-3" onClick={e => e.stopPropagation()}>
                  <button onClick={() => {
                    setVerificationRowStates(prev => {
                      const g = prev[-1] || {}; const upd = { ...prev, [-1]: { ...g, reviewerSignOff: g.reviewerSignOff ? null : { userName: 'Current User', timestamp: new Date().toISOString() } } };
                      return upd;
                    });
                  }} className="flex items-center gap-1" title={globalSignOff.reviewerSignOff ? `Reviewed by ${globalSignOff.reviewerSignOff.userName}` : 'Click to sign as Reviewer'}>
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${globalSignOff.reviewerSignOff ? 'bg-green-500 border-green-500' : 'border-green-400 hover:bg-green-50'}`}>
                      {globalSignOff.reviewerSignOff && <CheckCircle2 className="h-3 w-3 text-white" />}
                    </div>
                    <span className="text-[8px] font-bold text-slate-500">Reviewer</span>
                  </button>
                  <button onClick={() => {
                    setVerificationRowStates(prev => {
                      const g = prev[-1] || {}; const upd = { ...prev, [-1]: { ...g, riSignOff: g.riSignOff ? null : { userName: 'Current User', timestamp: new Date().toISOString() } } };
                      return upd;
                    });
                  }} className="flex items-center gap-1" title={globalSignOff.riSignOff ? `RI signed by ${globalSignOff.riSignOff.userName}` : 'Click to sign as RI'}>
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${globalSignOff.riSignOff ? 'bg-green-500 border-green-500' : 'border-green-400 hover:bg-green-50'}`}>
                      {globalSignOff.riSignOff && <CheckCircle2 className="h-3 w-3 text-white" />}
                    </div>
                    <span className="text-[8px] font-bold text-slate-500">RI</span>
                  </button>
                </div>
              )}
            </button>

            {/* Review Flagged summary table */}
            {findingsOpen && isReviewFlaggedTest && sampleItems.length > 0 && (
              <div className="overflow-auto">
                <table className="w-full text-[10px] border-collapse">
                  <thead>
                    <tr className="bg-slate-100 border-b">
                      <th className="px-2 py-1.5 text-left font-semibold text-slate-600 w-8">#</th>
                      <th className="px-2 py-1.5 text-left font-semibold text-slate-600">Item</th>
                      <th className="px-2 py-1.5 text-right font-semibold text-slate-600 w-20">Amount</th>
                      <th className="px-2 py-1.5 text-center font-semibold w-20 cursor-help" title="No issues found — item verified successfully"><span className="inline-flex items-center gap-0.5 text-green-600"><CheckCircle2 className="h-3 w-3" /> No Action</span></th>
                      <th className="px-2 py-1.5 text-center font-semibold w-20 cursor-help" title="Significant issue requiring Responsible Individual review and decision"><span className="inline-flex items-center gap-0.5 text-red-600"><AlertTriangle className="h-3 w-3" /> RI Matter</span></th>
                      <th className="px-2 py-1.5 text-center font-semibold w-20 cursor-help" title="Issue requiring follow-up — creates a review point for the engagement manager"><span className="inline-flex items-center gap-0.5 text-amber-600"><Clock className="h-3 w-3" /> Review Pt</span></th>
                      <th className="px-2 py-1.5 text-left font-semibold text-slate-600">Comment</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sampleItems.map((si, i) => {
                      const rs = verificationRowStates[i] || {};
                      return (
                        <tr key={i} className={`border-b border-slate-50 ${!rs.action ? 'bg-amber-50/30' : ''}`}>
                          <td className="px-2 py-1 text-slate-400">{i + 1}</td>
                          <td className="px-2 py-1 text-slate-700 truncate max-w-[200px]">{si.ref || si.description || `Item ${i + 1}`}</td>
                          <td className="px-2 py-1 text-right font-mono text-slate-700">£{fmt(si.amount)}</td>
                          {(['none', 'ri_matter', 'review_point'] as const).map(action => (
                            <td key={action} className="px-2 py-1 text-center">
                              <button onClick={() => {
                                setVerificationRowStates(prev => {
                                  const row = prev[i] || {};
                                  return { ...prev, [i]: { ...row, action } };
                                });
                              }} className={`w-5 h-5 rounded-full border-2 mx-auto flex items-center justify-center transition-colors ${
                                rs.action === action
                                  ? action === 'none' ? 'bg-green-500 border-green-500' : action === 'ri_matter' ? 'bg-red-500 border-red-500' : 'bg-amber-500 border-amber-500'
                                  : 'border-slate-300 hover:border-slate-400'
                              }`}>
                                {rs.action === action && <CheckCircle2 className="h-3 w-3 text-white" />}
                              </button>
                            </td>
                          ))}
                          <td className="px-2 py-1">
                            <input type="text" value={rs.actionComment || ''} onChange={e => {
                              const val = e.target.value;
                              setVerificationRowStates(prev => ({ ...prev, [i]: { ...prev[i], actionComment: val } }));
                            }} placeholder="Comment..." className="w-full text-[10px] border border-slate-200 rounded px-1.5 py-0.5 focus:outline-none focus:border-blue-400" />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {!allActioned && <div className="px-3 py-2 bg-amber-50 text-[10px] text-amber-700 font-medium">All items must be actioned to conclude this test</div>}
                {allActioned && (
                  <div className="px-3 py-2 bg-green-50 border-t flex items-center justify-between">
                    <span className="text-[10px] text-green-700 font-medium">All items actioned — ready to conclude</span>
                    <button
                      onClick={async () => {
                        // Determine conclusion: if any RI Matter → orange, if any Review Point → orange, else green
                        const hasRI = sampleItems.some((_, i) => verificationRowStates[i]?.action === 'ri_matter');
                        const hasRP = sampleItems.some((_, i) => verificationRowStates[i]?.action === 'review_point');
                        const color = hasRI ? 'orange' : hasRP ? 'orange' : 'green';
                        try {
                          await fetch(`/api/engagements/${engagementId}/test-conclusions`, {
                            method: 'POST', headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              executionId, fsLine, fsLineId, testDescription,
                              conclusion: color, status: 'concluded',
                              totalErrors: 0, extrapolatedError: 0,
                              populationSize: populationSize, sampleSize: sampleTotal,
                              followUpData: { rowStates: verificationRowStates },
                            }),
                          });
                          onConclusionChange?.(color);
                        } catch {}
                      }}
                      className="text-[10px] px-3 py-1 bg-green-600 text-white rounded hover:bg-green-700 font-medium"
                    >
                      Save Conclusion
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Standard findings for non-review_flagged tests */}
            {findingsOpen && !isReviewFlaggedTest && !canConclude && (
              <div className="p-4">
                <div className="text-center py-6 text-slate-400">
                  <AlertTriangle className="h-8 w-8 mx-auto mb-2 text-amber-400" />
                  <p className="text-sm font-medium text-amber-700">Cannot conclude — evidence not yet obtained for all items</p>
                  <p className="text-xs text-slate-500 mt-1">{totalEvidenceCount} of {sampleItems.length} items have evidence.</p>
                </div>
              </div>
            )}
            {findingsOpen && !isReviewFlaggedTest && canConclude && (
              <div className="p-4 space-y-3">
                {/* Summary KPIs */}
                <div className="grid grid-cols-6 gap-3 text-center">
                  <div className="bg-slate-50 rounded-lg p-2"><div className="text-[9px] text-slate-400 uppercase">Population</div><div className="text-sm font-bold text-slate-800">£{fmt(sampleValueTotal)}</div></div>
                  <div className="bg-slate-50 rounded-lg p-2"><div className="text-[9px] text-slate-400 uppercase">Sample</div><div className="text-sm font-bold text-slate-800">{sampleTotal}</div></div>
                  <div className="bg-slate-50 rounded-lg p-2"><div className="text-[9px] text-slate-400 uppercase">Errors</div><div className={`text-sm font-bold ${failCount > 0 ? 'text-red-600' : 'text-green-600'}`}>£{fmt(errorAmountTotal)}</div></div>
                  <div className="bg-slate-50 rounded-lg p-2"><div className="text-[9px] text-slate-400 uppercase">Error %</div><div className={`text-sm font-bold ${errorPct > 0 ? 'text-red-600' : 'text-green-600'}`}>{errorPct.toFixed(1)}%</div></div>
                  <div className="bg-slate-50 rounded-lg p-2"><div className="text-[9px] text-slate-400 uppercase">Extrapolated</div><div className={`text-sm font-bold ${extrapolatedError > clearlyTrivial ? 'text-red-600' : 'text-slate-800'}`}>£{fmt(extrapolatedError)}</div></div>
                  <div className="bg-slate-50 rounded-lg p-2"><div className="text-[9px] text-slate-400 uppercase">CT / PM</div><div className="text-[10px] font-mono text-slate-600">£{fmt(clearlyTrivial)}</div><div className="text-[10px] font-mono text-slate-600">£{fmt(tolerableMisstatement)}</div></div>
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
                    onConclusionChange={(c) => onConclusionChange?.(c === 'failed' ? 'red' : c)}
                  />
                )}

                {/* Investigate More Items — for review_flagged tests that completed */}
                {isReviewFlaggedTest && executionStatus === 'completed' && (
                  <div className="border border-blue-200 rounded-lg p-3 bg-blue-50/30 space-y-2 mt-2">
                    <div className="flex items-center gap-2">
                      <Play className="h-4 w-4 text-blue-600" />
                      <span className="text-sm font-medium text-blue-700">Investigate Additional Items</span>
                    </div>
                    <p className="text-xs text-slate-600">
                      Select additional items from the population table above (click rows to mark red), then click below.
                      Previously investigated items are preserved.
                    </p>
                    <button
                      onClick={async () => {
                        if (investigateRows.size === 0) return;
                        setCompleting(true);
                        try {
                          // Get new items from population
                          const popStepsForIdx = flowSteps.filter(s => s.output?.populationData?.length > 0 || s.output?.dataTable?.length > 0);
                          const popData = popStepsForIdx[popStepsForIdx.length - 1]?.output?.populationData || popStepsForIdx[popStepsForIdx.length - 1]?.output?.dataTable || [];
                          const newItems = Array.from(investigateRows).map(idx => popData[idx]).filter(Boolean);
                          // Start a NEW execution for just the additional items (keeps the old one intact)
                          const res = await fetch(`/api/engagements/${engagementId}/test-execution`, {
                            method: 'POST', headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              fsLine, testDescription, testTypeCode: testType, flowData, tbRow,
                              additionalItems: newItems, // Server should skip scoring and go straight to evidence fetch
                            }),
                          });
                          if (res.ok) {
                            const data = await res.json();
                            setExecutionId(data.executionId);
                            setExecutionStatus('running');
                            startPolling(data.executionId);
                            setProgressOpen(true);
                            setInvestigateRows(new Set());
                          }
                        } catch {} finally { setCompleting(false); }
                      }}
                      disabled={completing || investigateRows.size === 0}
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                    >
                      {completing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                      Investigate {investigateRows.size} More Items
                    </button>
                  </div>
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
            );
          })()}
        </div>
      )}
    </div>

    {/* Plan Customiser modal — mark tests N/A for this engagement, add custom tests */}
    {planCustomiserOpen && fsLineId && (
      <PlanCustomiserModal
        engagementId={engagementId}
        fsLineId={fsLineId}
        fsLineName={fsLine}
        allocatedTests={planCustomiserAllocated}
        onClose={() => setPlanCustomiserOpen(false)}
      />
    )}
    </div>
  );
}
