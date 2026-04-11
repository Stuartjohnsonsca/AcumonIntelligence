'use client';

import { useState, useEffect } from 'react';
import { AlertTriangle, CheckCircle2, XCircle, Loader2, Send, FileSpreadsheet, RefreshCw, Edit3, AlertOctagon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { InlineSamplingPanel } from './InlineSamplingPanel';
import { BespokeSpreadsheet } from './BespokeSpreadsheet';

interface ErrorItem {
  itemIndex: number;
  reference: string;
  description: string;
  sampleAmount: number;
  evidenceAmount: number;
  difference: number;
  explanation: string;
  isFraud: boolean;
  isIsolated: boolean;
  isAnomaly: boolean;
}

interface Props {
  engagementId: string;
  executionId?: string;
  conclusionId?: string;
  fsLine: string;
  testDescription: string;
  accountCode?: string;
  sampleItems: { ref: string; description: string; amount: number }[];
  verificationResults: { itemIndex: number; overallResult: string; difference?: number; notes?: string }[];
  populationSize: number;
  sampleSize: number;
  populationData?: any[];           // For expand sample
  priorSelectedIndices?: number[];  // Original sample indices
  clientId?: string;
  periodId?: string;
  clearlyTrivial: number;
  performanceMateriality: number;
  tolerableMisstatement: number;
  onConclusionChange?: (conclusion: 'green' | 'orange' | 'red' | 'failed' | 'pending') => void;
  onClose?: () => void;
}

function fmt(n: number): string {
  const abs = Math.abs(n);
  const f = abs.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `(${f})` : f;
}

function ConclusionDot({ conclusion }: { conclusion: string }) {
  const colors: Record<string, string> = {
    green: 'bg-green-500', orange: 'bg-orange-500', red: 'bg-red-500', failed: 'bg-red-800', pending: 'bg-slate-300',
  };
  return <div className={`w-3 h-3 rounded-full ${colors[conclusion] || colors.pending}`} />;
}

export function ErrorInvestigationPanel({
  engagementId, executionId, conclusionId: initialConclusionId, fsLine, testDescription, accountCode,
  sampleItems, verificationResults, populationSize, sampleSize,
  populationData, priorSelectedIndices, clientId, periodId,
  clearlyTrivial, performanceMateriality, tolerableMisstatement,
  onConclusionChange, onClose,
}: Props) {
  const [conclusionId, setConclusionId] = useState(initialConclusionId || '');
  const [saving, setSaving] = useState(false);

  // Error items with investigation fields
  const [errorItems, setErrorItems] = useState<ErrorItem[]>(() => {
    return verificationResults
      .filter(r => r.overallResult === 'fail' || (r.difference && Math.abs(r.difference) > 0))
      .map(r => {
        const item = sampleItems[r.itemIndex] || { ref: '', description: '', amount: 0 };
        return {
          itemIndex: r.itemIndex,
          reference: item.ref,
          description: item.description,
          sampleAmount: item.amount,
          evidenceAmount: item.amount + (r.difference || 0),
          difference: r.difference || 0,
          explanation: '',
          isFraud: false,
          isIsolated: true,
          isAnomaly: false,
        };
      });
  });

  // Calculations
  const totalErrors = errorItems.reduce((s, e) => s + Math.abs(e.difference), 0);
  const errorRate = sampleSize > 0 ? totalErrors / sampleItems.reduce((s, i) => s + Math.abs(i.amount), 0) : 0;
  const extrapolatedError = populationSize > 0 && sampleSize > 0
    ? (totalErrors / sampleSize) * populationSize
    : totalErrors;

  const conclusion: 'green' | 'orange' | 'red' | 'pending' =
    errorItems.length === 0 ? 'green' :
    Math.abs(extrapolatedError) <= clearlyTrivial ? 'green' :
    Math.abs(extrapolatedError) <= performanceMateriality ? 'orange' : 'red';

  // Auditor analysis
  const [controlConcern, setControlConcern] = useState(false);
  const [exceedsTM, setExceedsTM] = useState(Math.abs(extrapolatedError) > tolerableMisstatement);
  const [auditorNotes, setAuditorNotes] = useState('');

  // Follow-up actions
  const [followUpActions, setFollowUpActions] = useState<Set<string>>(new Set());
  const [reviseApproachText, setReviseApproachText] = useState('');
  const [managementMessage, setManagementMessage] = useState('');

  useEffect(() => {
    setExceedsTM(Math.abs(extrapolatedError) > tolerableMisstatement);
  }, [extrapolatedError, tolerableMisstatement]);

  useEffect(() => {
    onConclusionChange?.(conclusion);
  }, [conclusion]);

  function toggleFollowUp(action: string) {
    setFollowUpActions(prev => {
      const next = new Set(prev);
      next.has(action) ? next.delete(action) : next.add(action);
      return next;
    });
  }

  function updateError(index: number, field: keyof ErrorItem, value: any) {
    setErrorItems(prev => prev.map((e, i) => i === index ? { ...e, [field]: value } : e));
  }

  async function saveConclusion() {
    setSaving(true);
    try {
      const payload = {
        ...(conclusionId ? { id: conclusionId } : {}),
        engagementId, executionId, fsLine, testDescription, accountCode,
        conclusion, status: 'concluded',
        totalErrors, extrapolatedError, populationSize, sampleSize,
        errors: errorItems,
        controlRelianceConcern: controlConcern,
        extrapolationExceedsTM: exceedsTM,
        auditorNotes,
        followUpActions: Array.from(followUpActions),
        followUpData: {
          reviseApproachText: followUpActions.has('revise_approach') ? reviseApproachText : undefined,
          managementMessage: followUpActions.has('request_management') ? managementMessage : undefined,
        },
      };

      const res = await fetch(`/api/engagements/${engagementId}/test-conclusions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const data = await res.json();
        setConclusionId(data.conclusion.id);

        // If "error_schedule" selected, commit errors
        if (followUpActions.has('error_schedule')) {
          await fetch(`/api/engagements/${engagementId}/error-schedule`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'commit_from_conclusion',
              conclusionId: data.conclusion.id,
              items: errorItems.filter(e => Math.abs(e.difference) > 0).map(e => ({
                description: `${e.reference}: ${e.description}`,
                errorAmount: e.difference,
                errorType: e.isAnomaly ? 'judgemental' : 'factual',
                explanation: e.explanation,
                isFraud: e.isFraud,
              })),
            }),
          });
        }

        // If "request_management" selected, create outstanding item for approval (Reviewer/RI must approve before sending)
        if (followUpActions.has('request_management') && managementMessage) {
          await fetch(`/api/engagements/${engagementId}/outstanding`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'portal_request',
              title: `Management Investigation: ${testDescription}`,
              description: managementMessage,
              source: 'conclusion',
              status: 'awaiting_team',
              priority: 'high',
              fsLine,
              testName: testDescription,
            }),
          });
        }
      }
    } finally { setSaving(false); }
  }

  const showFollowUps = conclusion === 'orange' || conclusion === 'red' || controlConcern || exceedsTM;

  return (
    <div className="space-y-4">
      {/* Section A: Error Summary */}
      <div className="border rounded-lg overflow-hidden">
        <div className="bg-red-50 px-3 py-2 border-b flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
            <span className="text-xs font-bold text-red-700 uppercase">Error Investigation</span>
            <span className="text-[9px] text-red-500">{errorItems.length} error{errorItems.length !== 1 ? 's' : ''} found</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[9px] text-slate-500">Total: £{fmt(totalErrors)}</span>
            <ConclusionDot conclusion={conclusion} />
          </div>
        </div>

        {errorItems.length === 0 ? (
          <div className="p-4 text-center text-xs text-green-600">
            <CheckCircle2 className="h-5 w-5 mx-auto mb-1 text-green-500" />
            No errors found in sample. All items verified successfully.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {errorItems.map((err, i) => (
              <div key={i} className="px-3 py-2 space-y-2">
                <div className="flex items-center gap-3 text-xs">
                  <span className="font-mono text-slate-500 w-12">{err.reference}</span>
                  <span className="flex-1 text-slate-700 truncate">{err.description}</span>
                  <span className="text-slate-500">Sample: £{fmt(err.sampleAmount)}</span>
                  <span className="text-slate-500">Evidence: £{fmt(err.evidenceAmount)}</span>
                  <span className={`font-bold ${err.difference < 0 ? 'text-red-600' : 'text-amber-600'}`}>Diff: £{fmt(err.difference)}</span>
                </div>
                <div className="grid grid-cols-12 gap-2">
                  <div className="col-span-6">
                    <label className="text-[9px] text-slate-500 block mb-0.5">Explanation (what, why, isolated or wider?)</label>
                    <textarea value={err.explanation} onChange={e => updateError(i, 'explanation', e.target.value)}
                      className="w-full border border-slate-200 rounded px-2 py-1 text-[10px] min-h-[40px]" rows={2}
                      placeholder="What is the error? Why did it occur? Is it isolated or indicative of a wider issue?" />
                  </div>
                  <div className="col-span-6 flex items-start gap-3 pt-4">
                    <label className="inline-flex items-center gap-1 text-[10px] cursor-pointer">
                      <input type="checkbox" checked={err.isFraud} onChange={e => updateError(i, 'isFraud', e.target.checked)}
                        className="w-3 h-3 rounded border-red-300 text-red-600" />
                      <span className="text-red-600 font-medium">Fraud concern</span>
                    </label>
                    <label className="inline-flex items-center gap-1 text-[10px] cursor-pointer">
                      <input type="checkbox" checked={err.isIsolated} onChange={e => updateError(i, 'isIsolated', e.target.checked)}
                        className="w-3 h-3 rounded border-slate-300 text-blue-600" />
                      <span className="text-slate-600">Isolated</span>
                    </label>
                    <label className="inline-flex items-center gap-1 text-[10px] cursor-pointer">
                      <input type="checkbox" checked={err.isAnomaly} onChange={e => updateError(i, 'isAnomaly', e.target.checked)}
                        className="w-3 h-3 rounded border-slate-300 text-amber-600" />
                      <span className="text-slate-600">Anomalous</span>
                    </label>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Section B: Population Assessment */}
      <div className="border rounded-lg p-3 space-y-3">
        <div className="text-xs font-bold text-slate-700 uppercase">Population Assessment</div>
        <div className="grid grid-cols-4 gap-3 text-xs">
          <div className="bg-slate-50 rounded p-2">
            <div className="text-[9px] text-slate-500">Population Size</div>
            <div className="font-bold text-slate-800">{populationSize.toLocaleString()}</div>
          </div>
          <div className="bg-slate-50 rounded p-2">
            <div className="text-[9px] text-slate-500">Sample Size</div>
            <div className="font-bold text-slate-800">{sampleSize}</div>
          </div>
          <div className="bg-slate-50 rounded p-2">
            <div className="text-[9px] text-slate-500">Error Rate</div>
            <div className="font-bold text-slate-800">{(errorRate * 100).toFixed(2)}%</div>
          </div>
          <div className={`rounded p-2 ${
            Math.abs(extrapolatedError) <= clearlyTrivial ? 'bg-green-50' :
            Math.abs(extrapolatedError) <= performanceMateriality ? 'bg-orange-50' : 'bg-red-50'
          }`}>
            <div className="text-[9px] text-slate-500">Extrapolated Error</div>
            <div className="font-bold">£{fmt(extrapolatedError)}</div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 text-[10px]">
          <div className="flex items-center justify-between bg-green-50 rounded px-2 py-1">
            <span className="text-green-700">Clearly Trivial</span>
            <span className="font-mono font-bold text-green-800">£{fmt(clearlyTrivial)}</span>
          </div>
          <div className="flex items-center justify-between bg-orange-50 rounded px-2 py-1">
            <span className="text-orange-700">Performance Materiality</span>
            <span className="font-mono font-bold text-orange-800">£{fmt(performanceMateriality)}</span>
          </div>
          <div className="flex items-center justify-between bg-red-50 rounded px-2 py-1">
            <span className="text-red-700">Tolerable Misstatement</span>
            <span className="font-mono font-bold text-red-800">£{fmt(tolerableMisstatement)}</span>
          </div>
        </div>

        <div className="space-y-2">
          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <input type="checkbox" checked={controlConcern} onChange={e => setControlConcern(e.target.checked)}
              className="w-3.5 h-3.5 rounded border-slate-300 text-amber-600" />
            <span className="text-slate-700">Control reliance concern — errors indicate control weakness</span>
          </label>
          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <input type="checkbox" checked={exceedsTM} onChange={e => setExceedsTM(e.target.checked)}
              className="w-3.5 h-3.5 rounded border-slate-300 text-red-600" />
            <span className="text-slate-700">Extrapolated error exceeds Tolerable Misstatement</span>
          </label>
        </div>

        <div>
          <label className="text-[9px] text-slate-500 block mb-0.5">Auditor Notes</label>
          <textarea value={auditorNotes} onChange={e => setAuditorNotes(e.target.value)}
            className="w-full border border-slate-200 rounded px-2 py-1.5 text-xs min-h-[40px]" rows={2}
            placeholder="Overall assessment of the test results..." />
        </div>
      </div>

      {/* Section C: Follow-up Actions */}
      {showFollowUps && (
        <div className="border border-amber-200 rounded-lg p-3 bg-amber-50/30 space-y-3">
          <div className="text-xs font-bold text-amber-700 uppercase">Follow-up Actions Required</div>
          <p className="text-[10px] text-amber-600">Select the actions needed to address the errors found. Multiple actions can be selected.</p>

          <div className="space-y-2">
            <label className="flex items-start gap-2 text-xs cursor-pointer p-2 rounded border border-transparent hover:border-amber-200 hover:bg-amber-50">
              <input type="checkbox" checked={followUpActions.has('expand_sample')} onChange={() => toggleFollowUp('expand_sample')}
                className="w-3.5 h-3.5 rounded border-slate-300 text-blue-600 mt-0.5" />
              <div>
                <span className="font-medium text-slate-800">Expand sample size</span>
                <p className="text-[10px] text-slate-500 mt-0.5">Re-open sampling calculator with increased risk factors. Previous selections remain highlighted in green, new in blue.</p>
              </div>
            </label>
            {followUpActions.has('expand_sample') && populationData && populationData.length > 0 && (
              <div className="ml-6 border border-blue-200 rounded-lg p-2 bg-blue-50/30">
                <InlineSamplingPanel
                  engagementId={engagementId}
                  clientId={clientId || ''}
                  periodId={periodId || ''}
                  fsLine={fsLine}
                  testDescription={testDescription}
                  populationData={populationData}
                  materialityData={{ performanceMateriality, clearlyTrivial, tolerableMisstatement }}
                  initialSelectedIndices={priorSelectedIndices}
                  priorSelectedIndices={priorSelectedIndices}
                  expandedMode={true}
                  onComplete={(results) => {
                    // Expanded sample complete — results include both original + new
                  }}
                />
              </div>
            )}

            <label className="flex items-start gap-2 text-xs cursor-pointer p-2 rounded border border-transparent hover:border-amber-200 hover:bg-amber-50">
              <input type="checkbox" checked={followUpActions.has('alternative_procedures')} onChange={() => toggleFollowUp('alternative_procedures')}
                className="w-3.5 h-3.5 rounded border-slate-300 text-blue-600 mt-0.5" />
              <div>
                <span className="font-medium text-slate-800">Perform alternative or additional substantive procedures</span>
                <p className="text-[10px] text-slate-500 mt-0.5">Open bespoke spreadsheet with rows, columns, formulas, and upload.</p>
              </div>
            </label>
            {followUpActions.has('alternative_procedures') && (
              <div className="ml-6">
                <BespokeSpreadsheet
                  title={`Additional Procedures — ${testDescription}`}
                  onSave={(data) => {
                    // Save spreadsheet data to follow-up data
                    setReviseApproachText(prev => prev + `\n\nAlternative procedures spreadsheet: ${data.rows.length} rows`);
                  }}
                />
              </div>
            )}

            <label className="flex items-start gap-2 text-xs cursor-pointer p-2 rounded border border-transparent hover:border-amber-200 hover:bg-amber-50">
              <input type="checkbox" checked={followUpActions.has('request_management')} onChange={() => toggleFollowUp('request_management')}
                className="w-3.5 h-3.5 rounded border-slate-300 text-blue-600 mt-0.5" />
              <div>
                <span className="font-medium text-slate-800">Request management to investigate and correct the population</span>
                <p className="text-[10px] text-slate-500 mt-0.5">Send message via Portal (requires Reviewer or RI approval).</p>
              </div>
            </label>
            {followUpActions.has('request_management') && (
              <div className="ml-6">
                <textarea value={managementMessage} onChange={e => setManagementMessage(e.target.value)}
                  className="w-full border border-amber-200 rounded px-2 py-1.5 text-xs min-h-[50px]" rows={3}
                  placeholder="Message to management explaining the errors found and requesting investigation..." />
              </div>
            )}

            <label className="flex items-start gap-2 text-xs cursor-pointer p-2 rounded border border-transparent hover:border-amber-200 hover:bg-amber-50">
              <input type="checkbox" checked={followUpActions.has('revise_approach')} onChange={() => toggleFollowUp('revise_approach')}
                className="w-3.5 h-3.5 rounded border-slate-300 text-blue-600 mt-0.5" />
              <div>
                <span className="font-medium text-slate-800">Revise the audit approach or risk assessment</span>
                <p className="text-[10px] text-slate-500 mt-0.5">Document what needs to change in the audit methodology.</p>
              </div>
            </label>
            {followUpActions.has('revise_approach') && (
              <div className="ml-6">
                <textarea value={reviseApproachText} onChange={e => setReviseApproachText(e.target.value)}
                  className="w-full border border-amber-200 rounded px-2 py-1.5 text-xs min-h-[50px]" rows={3}
                  placeholder="Explain what changes to the audit approach or risk assessment are needed..." />
              </div>
            )}

            <label className="flex items-start gap-2 text-xs cursor-pointer p-2 rounded border border-transparent hover:border-amber-200 hover:bg-amber-50">
              <input type="checkbox" checked={followUpActions.has('error_schedule')} onChange={() => toggleFollowUp('error_schedule')}
                className="w-3.5 h-3.5 rounded border-slate-300 text-red-600 mt-0.5" />
              <div>
                <span className="font-medium text-slate-800">Raise on Error Schedule</span>
                <p className="text-[10px] text-slate-500 mt-0.5">Commit errors to the engagement error schedule for final assessment.</p>
              </div>
            </label>
          </div>
        </div>
      )}

      {/* Save button */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ConclusionDot conclusion={conclusion} />
          <span className={`text-xs font-bold ${
            conclusion === 'green' ? 'text-green-700' : conclusion === 'orange' ? 'text-orange-700' : conclusion === 'red' ? 'text-red-700' : 'text-slate-500'
          }`}>
            {conclusion === 'green' ? 'No material errors' :
             conclusion === 'orange' ? 'Errors above CT, within PM' :
             conclusion === 'red' ? 'Errors exceed PM' : 'Pending'}
          </span>
        </div>
        <Button onClick={saveConclusion} disabled={saving} size="sm" className="bg-blue-600 hover:bg-blue-700">
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <CheckCircle2 className="h-3.5 w-3.5 mr-1" />}
          Save Conclusion
        </Button>
      </div>
    </div>
  );
}
