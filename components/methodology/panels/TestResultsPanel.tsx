'use client';

import { useState, useEffect, useCallback } from 'react';
import { CheckCircle2, XCircle, Clock, FileText, ChevronDown, ChevronUp, AlertTriangle, AlertOctagon, Download, Upload } from 'lucide-react';
import { BankCheckResultPanel } from './BankCheckResultPanel';
import { AccrualsOutput } from './accruals/AccrualsOutput';
import { UnrecordedLiabilitiesOutput } from './unrecorded-liabilities/UnrecordedLiabilitiesOutput';
import { GrossMarginOutput } from './gross-margin/GrossMarginOutput';

/**
 * TestResultsPanel — displays test results in the selected output format.
 * Wraps the format-specific content with standard header, error assessment, and sign-off dots.
 *
 * Output formats:
 * - three_section_sampling / three_section_no_sampling → Data table + conclusion
 * - document_summary → Findings table with Key Terms and Missing Information (DocSummary pattern)
 * - spreadsheet → BespokeSpreadsheet with formula support and DB persistence
 */

interface Props {
  engagementId: string;
  executionId: string | null;
  testDescription: string;
  fsLine: string;
  accountCode?: string;
  outputFormat: string;
  conclusion: string; // green | orange | red | pending
  executionStatus: string;
  executionOutput?: any; // AI/flow output data
  conclusionRecord?: any; // Full AuditTestConclusion from DB
  userRole?: string;
  userName?: string;
  userId?: string;
  onClose?: () => void;
}

interface ConclusionData {
  id?: string;
  conclusion: string;
  status: string; // pending | concluded | reviewed | signed_off
  totalErrors: number;
  extrapolatedError: number;
  populationSize: number;
  sampleSize: number;
  auditorNotes: string;
  errors?: any[]; // Individual error items
  controlRelianceConcern?: boolean;
  extrapolationExceedsTM?: boolean;
  followUpActions?: string[];
  followUpData?: any;
  reviewedByName?: string;
  reviewedAt?: string;
  riSignedByName?: string;
  riSignedAt?: string;
  updatedAt?: string; // For stale detection
  executionId?: string;
}

const CONCLUSION_COLORS: Record<string, string> = {
  green: 'bg-green-500',
  orange: 'bg-orange-500',
  red: 'bg-red-500',
  pending: 'bg-slate-300',
  failed: 'bg-red-700',
};

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending Review',
  concluded: 'Concluded',
  reviewed: 'Reviewed',
  signed_off: 'Signed Off',
};

export function TestResultsPanel({
  engagementId, executionId, testDescription, fsLine, accountCode,
  outputFormat, conclusion, executionStatus, executionOutput,
  conclusionRecord, userRole, userName, userId, onClose,
}: Props) {
  const [conclusionData, setConclusionData] = useState<ConclusionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [sectionsOpen, setSectionsOpen] = useState({ results: true, errors: true, signoff: true });
  const [fetchedOutput, setFetchedOutput] = useState<any>(null);
  // Full TestExecution record, populated only for pipeline-mode tests
  // (e.g. four_section_accruals) that need access to pipelineState /
  // currentStepIndex / pauseReason. Lazily fetched by the same effect
  // that builds fetchedOutput so we share the API call.
  const [executionRecord, setExecutionRecord] = useState<any>(null);

  // Resolve effective executionId — prop or from conclusion record
  const effectiveExecutionId = executionId || conclusionRecord?.executionId || null;

  // Load existing conclusion
  const loadConclusion = useCallback(async () => {
    try {
      const res = await fetch(`/api/engagements/${engagementId}/test-conclusions`);
      if (res.ok) {
        const data = await res.json();
        const match = (data.conclusions || []).find((c: any) =>
          c.testDescription === testDescription && c.fsLine === fsLine
        );
        if (match) {
          setConclusionData(match);
          setNotes(match.auditorNotes || '');
        }
      }
    } catch {} finally { setLoading(false); }
  }, [engagementId, testDescription, fsLine]);

  // Fetch execution output from DB when not provided via props
  useEffect(() => {
    if (executionOutput) {
      setFetchedOutput(executionOutput);
      return;
    }
    if (!effectiveExecutionId) return;

    (async () => {
      try {
        const res = await fetch(`/api/engagements/${engagementId}/test-execution/${effectiveExecutionId}`);
        if (!res.ok) return;
        const data = await res.json();
        // Build merged output from all node runs
        const nodeRuns = data.nodeRuns || [];
        const merged: any = {};
        for (const run of nodeRuns) {
          if (!run.output) continue;
          const out = typeof run.output === 'string' ? JSON.parse(run.output) : run.output;
          // Collect key data fields from all nodes
          if (out.dataTable?.length && !merged.dataTable) merged.dataTable = out.dataTable;
          if (out.allTransactions?.length && !merged.allTransactions) merged.allTransactions = out.allTransactions;
          if (out.populationData?.length && !merged.populationData) merged.populationData = out.populationData;
          if (out.analysis && !merged.analysis) merged.analysis = out.analysis;
          if (out.findings?.length && !merged.findings) merged.findings = out.findings;
          if (out.flaggedItems?.length && !merged.flaggedItems) merged.flaggedItems = out.flaggedItems;
          if (out.keyTerms?.length && !merged.keyTerms) merged.keyTerms = out.keyTerms;
          if (out.missingInformation?.length && !merged.missingInformation) merged.missingInformation = out.missingInformation;
          if (out.spreadsheetData && !merged.spreadsheetData) merged.spreadsheetData = out.spreadsheetData;
          if (out.summary && !merged.summary) merged.summary = out.summary;
          if (out.conclusion && !merged.conclusion) merged.conclusion = out.conclusion;
          if (out.result && !merged.result) merged.result = out.result;
          if (out.loopCompleted && out.results?.length) {
            merged.loopResults = out.results;
          }
        }
        // Also check the execution context for accumulated data
        const ctx = data.execution?.context || (data.flowSnapshot ? null : null);
        setFetchedOutput(Object.keys(merged).length > 0 ? merged : null);
        if (data.execution) setExecutionRecord(data.execution);
      } catch {}
    })();
  }, [effectiveExecutionId, executionOutput, engagementId]);

  useEffect(() => { loadConclusion(); }, [loadConclusion]);

  // Save auditor notes
  async function saveNotes() {
    if (!conclusionData?.id) return;
    setSaving(true);
    try {
      await fetch(`/api/engagements/${engagementId}/test-conclusions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: conclusionData.id, auditorNotes: notes }),
      });
    } catch {} finally { setSaving(false); }
  }

  // Save spreadsheet data to conclusion followUpData
  async function saveSpreadsheetData(spreadsheetData: { rows: string[][]; columns: string[] }) {
    if (!conclusionData?.id) return;
    try {
      await fetch(`/api/engagements/${engagementId}/test-conclusions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: conclusionData.id,
          followUpData: { ...(conclusionData.followUpData || {}), spreadsheetData },
        }),
      });
    } catch {}
  }

  // Sign-off actions
  async function handleSignOff(action: 'review' | 'ri_signoff' | 'unreview' | 'ri_unsignoff') {
    if (!conclusionData?.id) return;
    try {
      const res = await fetch(`/api/engagements/${engagementId}/test-conclusions`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: conclusionData.id, action }),
      });
      if (res.ok) await loadConclusion();
    } catch {}
  }

  const f = (v: number) => {
    const a = Math.abs(v);
    const s = '£' + a.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return v < 0 ? `(${s})` : s;
  };

  const toggleSection = (key: keyof typeof sectionsOpen) => setSectionsOpen(prev => ({ ...prev, [key]: !prev[key] }));

  // Stale detection: check if conclusion data changed after a sign-off
  function isSignOffStale(role: 'reviewer' | 'ri'): boolean {
    if (!conclusionData?.updatedAt) return false;
    const dataTime = new Date(conclusionData.updatedAt).getTime();
    if (role === 'reviewer' && conclusionData.reviewedAt) {
      return dataTime > new Date(conclusionData.reviewedAt).getTime();
    }
    if (role === 'ri' && conclusionData.riSignedAt) {
      return dataTime > new Date(conclusionData.riSignedAt).getTime();
    }
    return false;
  }

  // Effective output — fetched from DB or passed via props
  const effectiveOutput = fetchedOutput || executionOutput;

  if (loading) return <div className="p-4 text-center text-xs text-slate-400 animate-pulse">Loading results...</div>;

  return (
    <div className="border border-slate-200 rounded-lg bg-white shadow-sm">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-200 bg-slate-50/50">
        <div className={`w-3.5 h-3.5 rounded-full ${CONCLUSION_COLORS[conclusion] || CONCLUSION_COLORS.pending} shrink-0`} />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-slate-800 truncate">{testDescription}</div>
          <div className="text-[10px] text-slate-400">{fsLine}{accountCode ? ` — ${accountCode}` : ''}</div>
        </div>
        <span className={`text-[9px] font-medium px-2 py-0.5 rounded-full shrink-0 ${
          executionStatus === 'completed' ? 'bg-green-100 text-green-700' :
          executionStatus === 'failed' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-500'
        }`}>{executionStatus === 'completed' ? 'Complete' : executionStatus}</span>
        {onClose && <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg">×</button>}
      </div>

      {/* Results Section */}
      <div className="border-b border-slate-100">
        <button onClick={() => toggleSection('results')} className="w-full flex items-center justify-between px-4 py-2 hover:bg-slate-50">
          <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">Results</span>
          {sectionsOpen.results ? <ChevronUp className="h-3.5 w-3.5 text-slate-400" /> : <ChevronDown className="h-3.5 w-3.5 text-slate-400" />}
        </button>
        {sectionsOpen.results && (
          <div className="px-4 pb-4">
            {/* Bank Check to TB — detected by comparisons field in output */}
            {effectiveOutput?.comparisons && effectiveOutput?.bankAccountCount != null && (
              <BankCheckResultPanel
                comparisons={effectiveOutput.comparisons}
                bankMetadata={effectiveOutput.bankMetadata}
                documentRefs={effectiveOutput.documentRefs}
                summary={effectiveOutput.summary}
                result={effectiveOutput.result}
                clearlyTrivial={effectiveOutput.clearlyTrivialThreshold}
                engagementId={engagementId}
              />
            )}
            {outputFormat === 'document_summary' && effectiveOutput && !effectiveOutput.comparisons && (
              <DocumentSummaryOutput data={effectiveOutput} />
            )}
            {outputFormat === 'spreadsheet' && (
              <SpreadsheetOutput
                engagementId={engagementId}
                executionId={effectiveExecutionId}
                data={effectiveOutput}
                onSave={conclusionData?.id ? saveSpreadsheetData : undefined}
                savedData={conclusionData?.followUpData?.spreadsheetData}
              />
            )}
            {(outputFormat === 'three_section_sampling' || outputFormat === 'three_section_no_sampling' || !outputFormat) && effectiveOutput && !effectiveOutput.comparisons && (
              <ThreeSectionOutput data={effectiveOutput} />
            )}
            {outputFormat === 'four_section_accruals' && (
              <AccrualsOutput
                engagementId={engagementId}
                executionId={effectiveExecutionId}
                executionStatus={executionStatus}
                pipelineState={executionRecord?.pipelineState}
                currentStepIndex={executionRecord?.currentStepIndex}
                pauseReason={executionRecord?.pauseReason}
              />
            )}
            {outputFormat === 'four_section_unrecorded_liabilities' && (
              <UnrecordedLiabilitiesOutput
                engagementId={engagementId}
                executionId={effectiveExecutionId}
                executionStatus={executionStatus}
                pipelineState={executionRecord?.pipelineState}
                currentStepIndex={executionRecord?.currentStepIndex}
                pauseReason={executionRecord?.pauseReason}
              />
            )}
            {outputFormat === 'four_section_gross_margin' && (
              <GrossMarginOutput
                engagementId={engagementId}
                executionId={effectiveExecutionId}
                executionStatus={executionStatus}
                pipelineState={executionRecord?.pipelineState}
                currentStepIndex={executionRecord?.currentStepIndex}
                pauseReason={executionRecord?.pauseReason}
              />
            )}
            {!effectiveOutput && outputFormat !== 'four_section_accruals' && outputFormat !== 'four_section_unrecorded_liabilities' && outputFormat !== 'four_section_gross_margin' && (
              <div className="text-xs text-slate-400 text-center py-4">
                {effectiveExecutionId ? (
                  <span className="animate-pulse">Loading execution data...</span>
                ) : (
                  'No results data available.'
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Error Assessment Section */}
      <div className="border-b border-slate-100">
        <button onClick={() => toggleSection('errors')} className="w-full flex items-center justify-between px-4 py-2 hover:bg-slate-50">
          <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">Error Assessment</span>
          {sectionsOpen.errors ? <ChevronUp className="h-3.5 w-3.5 text-slate-400" /> : <ChevronDown className="h-3.5 w-3.5 text-slate-400" />}
        </button>
        {sectionsOpen.errors && (
          <div className="px-4 pb-4">
            {conclusionData && (
              <div className="space-y-3">
                <div className="grid grid-cols-4 gap-3 text-center">
                  <div className="bg-slate-50 rounded p-2">
                    <div className="text-lg font-bold text-slate-800">{conclusionData.totalErrors || 0}</div>
                    <div className="text-[9px] text-slate-400 uppercase">Errors</div>
                  </div>
                  <div className="bg-slate-50 rounded p-2">
                    <div className="text-lg font-bold text-slate-800">{f(conclusionData.extrapolatedError || 0)}</div>
                    <div className="text-[9px] text-slate-400 uppercase">Extrapolated</div>
                  </div>
                  <div className="bg-slate-50 rounded p-2">
                    <div className={`text-lg font-bold ${conclusion === 'green' ? 'text-green-600' : conclusion === 'orange' ? 'text-orange-600' : conclusion === 'red' ? 'text-red-600' : 'text-slate-400'}`}>
                      {conclusion === 'pending' ? '—' : conclusion.charAt(0).toUpperCase() + conclusion.slice(1)}
                    </div>
                    <div className="text-[9px] text-slate-400 uppercase">Conclusion</div>
                  </div>
                  <div className="bg-slate-50 rounded p-2">
                    <div className="text-lg font-bold text-slate-800">{STATUS_LABELS[conclusionData.status] || conclusionData.status}</div>
                    <div className="text-[9px] text-slate-400 uppercase">Status</div>
                  </div>
                </div>

                {/* Individual Error Items */}
                {Array.isArray(conclusionData.errors) && conclusionData.errors.length > 0 && (
                  <div className="border rounded-lg overflow-hidden">
                    <div className="bg-red-50 px-3 py-1.5 border-b flex items-center gap-2">
                      <AlertTriangle className="h-3 w-3 text-red-500" />
                      <span className="text-[10px] font-bold text-red-700 uppercase">Individual Errors</span>
                    </div>
                    <div className="divide-y divide-slate-100">
                      {conclusionData.errors.map((err: any, i: number) => (
                        <div key={i} className="px-3 py-2 space-y-1.5">
                          <div className="flex items-center gap-3 text-[10px]">
                            <span className="font-mono text-slate-500 w-10 shrink-0">{err.reference || `#${err.itemIndex ?? i + 1}`}</span>
                            <span className="flex-1 text-slate-700 truncate">{err.description || 'Error item'}</span>
                            <span className="text-slate-500">Sample: {f(err.sampleAmount || 0)}</span>
                            <span className="text-slate-500">Evidence: {f(err.evidenceAmount || 0)}</span>
                            <span className={`font-bold ${(err.difference || 0) < 0 ? 'text-red-600' : 'text-amber-600'}`}>
                              Diff: {f(err.difference || 0)}
                            </span>
                          </div>
                          {/* Classification flags */}
                          <div className="flex items-center gap-3 text-[9px]">
                            {/* Error type */}
                            <span className={`px-1.5 py-0.5 rounded font-medium ${
                              err.isAnomaly ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'
                            }`}>
                              {err.isAnomaly ? 'Judgemental' : 'Factual'}
                            </span>
                            {err.isFraud && (
                              <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-700 font-medium flex items-center gap-0.5">
                                <AlertOctagon className="h-2.5 w-2.5" /> Fraud concern
                              </span>
                            )}
                            {err.isIsolated && (
                              <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-medium">Isolated</span>
                            )}
                            {!err.isIsolated && (
                              <span className="px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 font-medium">Systemic</span>
                            )}
                          </div>
                          {/* Explanation */}
                          {err.explanation && (
                            <div className="text-[10px] text-slate-600 bg-slate-50 rounded px-2 py-1 italic">
                              {err.explanation}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Control / TM flags */}
                {(conclusionData.controlRelianceConcern || conclusionData.extrapolationExceedsTM) && (
                  <div className="flex gap-3 text-[10px]">
                    {conclusionData.controlRelianceConcern && (
                      <span className="px-2 py-1 rounded bg-amber-50 border border-amber-200 text-amber-700 font-medium">
                        Control reliance concern
                      </span>
                    )}
                    {conclusionData.extrapolationExceedsTM && (
                      <span className="px-2 py-1 rounded bg-red-50 border border-red-200 text-red-700 font-medium">
                        Exceeds Tolerable Misstatement
                      </span>
                    )}
                  </div>
                )}

                {/* Auditor Notes */}
                <div>
                  <label className="text-[10px] font-semibold text-slate-500 uppercase">Auditor Notes</label>
                  <textarea
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    onBlur={saveNotes}
                    placeholder="Record observations, rationale for conclusion..."
                    className="w-full mt-1 border border-slate-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-blue-300 min-h-[60px]"
                  />
                  {saving && <span className="text-[9px] text-blue-500 animate-pulse">Saving...</span>}
                </div>
              </div>
            )}
            {!conclusionData && (
              <div className="text-xs text-slate-400 text-center py-4">No conclusion recorded yet.</div>
            )}
          </div>
        )}
      </div>

      {/* Sign-Off Section */}
      <div>
        <button onClick={() => toggleSection('signoff')} className="w-full flex items-center justify-between px-4 py-2 hover:bg-slate-50">
          <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">Sign-Off</span>
          {sectionsOpen.signoff ? <ChevronUp className="h-3.5 w-3.5 text-slate-400" /> : <ChevronDown className="h-3.5 w-3.5 text-slate-400" />}
        </button>
        {sectionsOpen.signoff && conclusionData && (
          <div className="px-4 pb-4">
            <div className="flex items-center gap-8 justify-center py-2">
              {/* Preparer dot — auto-set when conclusion is saved */}
              <SignOffDot
                label="Preparer"
                signedBy={conclusionData.status !== 'pending' ? 'System' : undefined}
                signedAt={undefined}
                canSign={false}
                isStale={false}
                onToggle={() => {}}
              />
              {/* Reviewer dot */}
              <SignOffDot
                label="Reviewer"
                signedBy={conclusionData.reviewedByName}
                signedAt={conclusionData.reviewedAt}
                canSign={userRole === 'Manager' || userRole === 'RI'}
                isStale={isSignOffStale('reviewer')}
                onToggle={() => handleSignOff(conclusionData.reviewedByName ? 'unreview' : 'review')}
              />
              {/* RI dot */}
              <SignOffDot
                label="RI"
                signedBy={conclusionData.riSignedByName}
                signedAt={conclusionData.riSignedAt}
                canSign={userRole === 'RI'}
                isStale={isSignOffStale('ri')}
                onToggle={() => handleSignOff(conclusionData.riSignedByName ? 'ri_unsignoff' : 'ri_signoff')}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Sign-Off Dot with Stale Detection ───

function SignOffDot({ label, signedBy, signedAt, canSign, isStale, onToggle }: {
  label: string;
  signedBy?: string;
  signedAt?: string;
  canSign: boolean;
  isStale: boolean;
  onToggle: () => void;
}) {
  const isSigned = !!signedBy;
  const dateStr = signedAt ? new Date(signedAt).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '';

  return (
    <div className="flex flex-col items-center gap-1">
      <button
        onClick={canSign ? onToggle : undefined}
        disabled={!canSign}
        className={`w-6 h-6 rounded-full border-2 transition-colors ${
          isSigned && !isStale ? 'bg-green-500 border-green-500' :
          isSigned && isStale ? 'bg-white border-green-500 ring-2 ring-orange-400 ring-offset-1' :
          canSign ? 'border-green-400 hover:bg-green-50 cursor-pointer' :
          'border-slate-300 cursor-default'
        }`}
        title={
          isSigned && isStale ? `${signedBy} — ${dateStr} (STALE: data changed after sign-off)` :
          isSigned ? `${signedBy} — ${dateStr}` :
          canSign ? `Click to sign as ${label}` : `${label} sign-off`
        }
      >
        {isSigned && !isStale && <CheckCircle2 className="h-3.5 w-3.5 text-white mx-auto" />}
        {isSigned && isStale && <CheckCircle2 className="h-3.5 w-3.5 text-orange-400 mx-auto" />}
      </button>
      <div className="text-[8px] text-slate-500 text-center leading-tight">
        <div className="font-medium">{label}</div>
        {isSigned && <div className={isStale ? 'text-orange-500' : 'text-green-600'}>{signedBy}</div>}
        {isSigned && dateStr && <div className="text-slate-400">{dateStr}</div>}
        {isStale && <div className="text-orange-500 font-medium">Stale</div>}
      </div>
    </div>
  );
}

// ─── Output Format Components ───

function DocumentSummaryOutput({ data }: { data: any }) {
  const findings = data?.analysis?.flaggedItems || data?.flaggedItems || data?.findings || [];
  const summary = data?.analysis?.summary || data?.summary || '';
  const keyTerms = data?.analysis?.keyTerms || data?.keyTerms || [];
  const missingInfo = data?.analysis?.missingInformation || data?.missingInformation || [];

  if (findings.length === 0 && !summary && keyTerms.length === 0 && missingInfo.length === 0) {
    return <div className="text-xs text-slate-400 text-center py-2">No findings from this test.</div>;
  }

  return (
    <div className="space-y-3">
      {summary && (
        <div className="text-xs text-slate-700 bg-blue-50 rounded p-3 border border-blue-100">
          <div className="text-[10px] font-bold text-blue-600 uppercase mb-1">Summary</div>
          {summary}
        </div>
      )}

      {/* Key Terms — DocSummary pattern */}
      {keyTerms.length > 0 && (
        <div className="border rounded overflow-hidden">
          <div className="bg-indigo-50 px-3 py-1.5 border-b">
            <span className="text-[10px] font-bold text-indigo-700 uppercase">Key Commercial Terms</span>
          </div>
          <table className="w-full text-[10px]">
            <thead>
              <tr className="bg-slate-50 border-b">
                <th className="text-left px-2 py-1.5 font-semibold text-slate-600">Term</th>
                <th className="text-left px-2 py-1.5 font-semibold text-slate-600">Value</th>
                <th className="text-left px-2 py-1.5 font-semibold text-slate-600">Clause</th>
              </tr>
            </thead>
            <tbody>
              {keyTerms.map((kt: any, i: number) => (
                <tr key={i} className="border-b border-slate-50">
                  <td className="px-2 py-1 text-slate-700 font-medium">{kt.term}</td>
                  <td className="px-2 py-1 text-slate-600">{kt.value}</td>
                  <td className="px-2 py-1 text-slate-500 font-mono text-[9px]">{kt.clauseReference || kt.clause || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Findings */}
      {findings.length > 0 && (
        <div className="border rounded overflow-hidden">
          <div className="bg-amber-50 px-3 py-1.5 border-b">
            <span className="text-[10px] font-bold text-amber-700 uppercase">Findings</span>
          </div>
          <table className="w-full text-[10px]">
            <thead>
              <tr className="bg-slate-100 border-b">
                <th className="text-left px-2 py-1.5 font-semibold text-slate-600">Item</th>
                <th className="text-left px-2 py-1.5 font-semibold text-slate-600">Finding</th>
                <th className="text-right px-2 py-1.5 font-semibold text-slate-600">Amount</th>
                <th className="text-center px-2 py-1.5 font-semibold text-slate-600">Risk</th>
              </tr>
            </thead>
            <tbody>
              {findings.map((fi: any, i: number) => (
                <tr key={i} className={`border-b border-slate-50 ${fi.riskLevel === 'high' ? 'bg-red-50' : fi.riskLevel === 'medium' ? 'bg-amber-50' : ''}`}>
                  <td className="px-2 py-1 text-slate-700">{fi.description || fi.area || fi.accountNumber || `Item ${i + 1}`}</td>
                  <td className="px-2 py-1 text-slate-600">{fi.reason || fi.finding || fi.detail || ''}</td>
                  <td className="px-2 py-1 text-right font-mono text-slate-700">{fi.amount != null ? `£${Number(fi.amount).toLocaleString('en-GB', { minimumFractionDigits: 2 })}` : '—'}</td>
                  <td className="px-2 py-1 text-center">
                    {fi.riskLevel && <span className={`text-[8px] px-1 py-0.5 rounded font-medium ${fi.riskLevel === 'high' ? 'bg-red-100 text-red-700' : fi.riskLevel === 'medium' ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>{fi.riskLevel}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Missing Information — DocSummary pattern */}
      {missingInfo.length > 0 && (
        <div className="border rounded overflow-hidden">
          <div className="bg-orange-50 px-3 py-1.5 border-b">
            <span className="text-[10px] font-bold text-orange-700 uppercase">Missing Information</span>
          </div>
          <table className="w-full text-[10px]">
            <thead>
              <tr className="bg-slate-50 border-b">
                <th className="text-left px-2 py-1.5 font-semibold text-slate-600">Missing Item</th>
                <th className="text-left px-2 py-1.5 font-semibold text-slate-600">Why This Is Expected</th>
              </tr>
            </thead>
            <tbody>
              {missingInfo.map((mi: any, i: number) => (
                <tr key={i} className="border-b border-slate-50">
                  <td className="px-2 py-1 text-slate-700 font-medium">{mi.item}</td>
                  <td className="px-2 py-1 text-slate-600">{mi.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ThreeSectionOutput({ data }: { data: any }) {
  const items = data?.dataTable || data?.allTransactions || data?.populationData || [];
  const conclusion = data?.conclusion || data?.result || '';

  if (items.length === 0 && !conclusion) {
    return <div className="text-xs text-slate-400 text-center py-2">No data from this test.</div>;
  }

  return (
    <div className="space-y-3">
      {conclusion && typeof conclusion === 'string' && (
        <div className={`text-xs rounded p-3 border ${conclusion === 'satisfactory' ? 'bg-green-50 border-green-100 text-green-700' : 'bg-amber-50 border-amber-100 text-amber-700'}`}>
          <div className="text-[10px] font-bold uppercase mb-1">Conclusion</div>
          {conclusion}
        </div>
      )}
      {items.length > 0 && (() => {
        const SKIP = new Set(['sourceFile', 'tbAccountCode', 'functionalCurrency', 'page', 'fxRate', '_lineItemCount']);
        const allCols = Object.keys(items[0]).filter(k => !k.startsWith('_') && !SKIP.has(k));
        return (
        <div className="border rounded overflow-auto max-h-[500px]">
          <div className="px-2 py-1 bg-slate-50 border-b text-[9px] text-slate-400">
            Showing all {items.length} records | {allCols.length} columns
          </div>
          <table className="w-full text-[10px]">
            <thead className="sticky top-0 z-10">
              <tr className="bg-slate-100 border-b">
                {allCols.map(key => (
                  <th key={key} className="text-left px-2 py-1.5 font-semibold text-slate-600 whitespace-nowrap">{key}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((item: any, i: number) => (
                <tr key={i} className="border-b border-slate-50 hover:bg-slate-50/50">
                  {allCols.map((key: string, j: number) => {
                    const val = item[key];
                    return (
                      <td key={j} className="px-2 py-1 text-slate-600 whitespace-nowrap max-w-[200px] truncate" title={String(val ?? '')}>
                        {typeof val === 'number' ? val.toLocaleString('en-GB', { maximumFractionDigits: 2 }) : String(val ?? '')}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        );
      })()}
    </div>
  );
}

function SpreadsheetOutput({ engagementId, executionId, data, onSave, savedData }: {
  engagementId: string;
  executionId: string | null;
  data: any;
  onSave?: (data: { rows: string[][]; columns: string[] }) => void;
  savedData?: { rows: string[][]; columns: string[] };
}) {
  const [rows, setRows] = useState<string[][]>(() => {
    // Priority: saved data from DB > execution output > empty
    if (savedData?.rows) return savedData.rows;
    if (data?.spreadsheetData?.rows) return data.spreadsheetData.rows;
    const items = data?.dataTable || data?.allTransactions || [];
    if (items.length === 0) return Array.from({ length: 10 }, () => Array(5).fill(''));
    const cols = Object.keys(items[0]);
    return items.map((item: any) => cols.map(c => String(item[c] ?? '')));
  });

  const [columns, setColumns] = useState<string[]>(() => {
    if (savedData?.columns) return savedData.columns;
    if (data?.spreadsheetData?.columns) return data.spreadsheetData.columns;
    const items = data?.dataTable || data?.allTransactions || [];
    if (items.length > 0) return Object.keys(items[0]).slice(0, 10);
    return ['A', 'B', 'C', 'D', 'E'];
  });

  const [editCell, setEditCell] = useState<{ r: number; c: number } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');

  function evaluateFormula(formula: string): string {
    if (!formula.startsWith('=')) return formula;
    const expr = formula.substring(1);
    try {
      // SUM(A1:A10)
      const sumMatch = expr.match(/^SUM\(([A-Z])(\d+):([A-Z])(\d+)\)$/i);
      if (sumMatch) {
        const col = sumMatch[1].toUpperCase().charCodeAt(0) - 65;
        const r1 = parseInt(sumMatch[2]) - 1;
        const r2 = parseInt(sumMatch[4]) - 1;
        let total = 0;
        for (let r = r1; r <= r2 && r < rows.length; r++) {
          total += parseFloat(rows[r]?.[col] || '0') || 0;
        }
        return total.toString();
      }
      // SUMIF(range, criteria, sum_range)
      const sumifMatch = expr.match(/^SUMIF\(([A-Z])(\d+):([A-Z])(\d+)\s*,\s*"([^"]+)"\s*,\s*([A-Z])(\d+):([A-Z])(\d+)\)$/i);
      if (sumifMatch) {
        const critCol = sumifMatch[1].toUpperCase().charCodeAt(0) - 65;
        const cr1 = parseInt(sumifMatch[2]) - 1;
        const cr2 = parseInt(sumifMatch[4]) - 1;
        const criteria = sumifMatch[5];
        const sumCol = sumifMatch[6].toUpperCase().charCodeAt(0) - 65;
        let total = 0;
        for (let r = cr1; r <= cr2 && r < rows.length; r++) {
          if ((rows[r]?.[critCol] || '').toLowerCase().includes(criteria.toLowerCase())) {
            total += parseFloat(rows[r]?.[sumCol] || '0') || 0;
          }
        }
        return total.toString();
      }
      // IF(condition, true, false)
      const ifMatch = expr.match(/^IF\(([^,]+),\s*([^,]+),\s*([^)]+)\)$/i);
      if (ifMatch) {
        const cond = ifMatch[1].trim();
        const trueVal = ifMatch[2].trim();
        const falseVal = ifMatch[3].trim();
        const compMatch = cond.match(/^([A-Z])(\d+)\s*(>|<|>=|<=|=|!=)\s*(.+)$/i);
        if (compMatch) {
          const col = compMatch[1].toUpperCase().charCodeAt(0) - 65;
          const row = parseInt(compMatch[2]) - 1;
          const op = compMatch[3];
          const val = parseFloat(compMatch[4]) || 0;
          const cellVal = parseFloat(rows[row]?.[col] || '0') || 0;
          const result = op === '>' ? cellVal > val : op === '<' ? cellVal < val : op === '>=' ? cellVal >= val : op === '<=' ? cellVal <= val : op === '=' ? cellVal === val : cellVal !== val;
          return result ? trueVal : falseVal;
        }
      }
      // Cell reference arithmetic
      let resolved = expr.replace(/([A-Z])(\d+)/gi, (_, col, row) => {
        const c = col.toUpperCase().charCodeAt(0) - 65;
        const r = parseInt(row) - 1;
        return rows[r]?.[c] || '0';
      });
      return String(new Function(`return ${resolved}`)());
    } catch {
      return formula;
    }
  }

  function getCellDisplay(r: number, c: number): string {
    const val = rows[r]?.[c] || '';
    if (editCell?.r === r && editCell?.c === c) return val;
    return evaluateFormula(val);
  }

  function updateCell(r: number, c: number, val: string) {
    setRows(prev => {
      const next = prev.map(row => [...row]);
      if (!next[r]) next[r] = Array(columns.length).fill('');
      next[r][c] = val;
      return next;
    });
    setDirty(true);
    setSaveStatus('idle');
  }

  function addRow() { setRows(prev => [...prev, Array(columns.length).fill('')]); setDirty(true); }
  function addCol() {
    const nextLetter = String.fromCharCode(65 + columns.length);
    setColumns(prev => [...prev, nextLetter]);
    setRows(prev => prev.map(r => [...r, '']));
    setDirty(true);
  }

  async function handleSave() {
    if (!onSave) return;
    setSaveStatus('saving');
    onSave({ rows, columns });
    setDirty(false);
    setSaveStatus('saved');
    setTimeout(() => setSaveStatus('idle'), 2000);
  }

  // Auto-save on blur after changes (debounced)
  function handleCellBlur() {
    setEditCell(null);
    if (dirty && onSave) {
      const timeout = setTimeout(() => {
        onSave({ rows, columns });
        setDirty(false);
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 2000);
      }, 1000);
      return () => clearTimeout(timeout);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-1 items-center">
        <button onClick={addRow} className="text-[9px] px-2 py-0.5 bg-blue-50 text-blue-600 rounded hover:bg-blue-100">+ Row</button>
        <button onClick={addCol} className="text-[9px] px-2 py-0.5 bg-blue-50 text-blue-600 rounded hover:bg-blue-100">+ Column</button>
        {onSave && (
          <>
            <button onClick={handleSave} disabled={!dirty} className={`text-[9px] px-2 py-0.5 rounded ml-auto ${
              dirty ? 'bg-green-50 text-green-600 hover:bg-green-100' : 'bg-slate-50 text-slate-400'
            }`}>
              {saveStatus === 'saving' ? 'Saving...' : saveStatus === 'saved' ? 'Saved' : 'Save'}
            </button>
            {dirty && <span className="text-[8px] text-amber-500">Unsaved changes</span>}
          </>
        )}
      </div>
      <div className="border rounded overflow-auto max-h-[400px]">
        <table className="text-[10px] border-collapse">
          <thead className="sticky top-0">
            <tr className="bg-slate-100">
              <th className="border border-slate-200 px-2 py-1 w-8 text-slate-400">#</th>
              {columns.map((col, ci) => (
                <th key={ci} className="border border-slate-200 px-2 py-1 min-w-[80px] text-slate-600 font-semibold">{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri}>
                <td className="border border-slate-200 px-2 py-0.5 text-slate-400 text-center bg-slate-50">{ri + 1}</td>
                {columns.map((_, ci) => (
                  <td key={ci} className="border border-slate-200 p-0">
                    <input
                      type="text"
                      value={editCell?.r === ri && editCell?.c === ci ? (rows[ri]?.[ci] || '') : getCellDisplay(ri, ci)}
                      onChange={e => updateCell(ri, ci, e.target.value)}
                      onFocus={() => setEditCell({ r: ri, c: ci })}
                      onBlur={handleCellBlur}
                      className="w-full px-1.5 py-0.5 text-[10px] border-0 focus:outline-none focus:bg-blue-50"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
