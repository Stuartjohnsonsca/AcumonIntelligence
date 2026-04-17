'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { ProgressStepsSection } from './ProgressStepsSection';
import { DataCalculationsSection } from './DataCalculationsSection';
import { AuditVerificationSection, type SampleMarker } from '../accruals/AuditVerificationSection';
import { FindingsConclusionsSection } from '../accruals/FindingsConclusionsSection';

/**
 * Composite renderer for outputFormat === 'four_section_gross_margin'.
 * Reuses AuditVerification + Findings from the accruals package — the
 * underlying marker schema is generic. The extra "additional procedures"
 * banner is surfaced above Findings when the AI step left any Red or
 * Orange markers, prompting the auditor to consider substantive ToD.
 */

interface Props {
  engagementId: string;
  executionId: string | null;
  executionStatus: string;
  pipelineState: Record<number | string, any> | null | undefined;
  currentStepIndex: number | null | undefined;
  pauseReason: string | null | undefined;
}

export function GrossMarginOutput({
  engagementId,
  executionId,
  executionStatus,
  pipelineState,
  currentStepIndex,
  pauseReason,
}: Props) {
  const [markers, setMarkers] = useState<SampleMarker[]>([]);
  const [loading, setLoading] = useState(false);

  const loadMarkers = useCallback(async () => {
    if (!executionId) { setMarkers([]); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/engagements/${engagementId}/test-execution/${executionId}/sample-markers`);
      if (res.ok) {
        const data = await res.json();
        setMarkers(Array.isArray(data.markers) ? data.markers : []);
      }
    } catch { /* silent */ } finally { setLoading(false); }
  }, [engagementId, executionId]);

  useEffect(() => { loadMarkers(); }, [loadMarkers]);

  const redMarkers = markers.filter(m => m.colour === 'red');

  // The AI step writes the "additional procedures required" banner text
  // into pipelineState[3]. Pull it out so the auditor sees it prominently.
  const assessStep = (pipelineState as Record<number | string, any> | null | undefined)?.[3]
    ?? (pipelineState as Record<number | string, any> | null | undefined)?.['3']
    ?? {};
  const procedurePrompt: string = assessStep.additional_procedures_prompt || '';

  return (
    <div className="space-y-3">
      <ProgressStepsSection
        executionStatus={executionStatus}
        currentStepIndex={currentStepIndex}
        pipelineState={pipelineState as Record<number, any>}
        pauseReason={pauseReason}
      />
      <DataCalculationsSection pipelineState={pipelineState as Record<number, any>} />
      {executionId ? (
        <AuditVerificationSection
          engagementId={engagementId}
          executionId={executionId}
          markers={markers}
          onMarkersChanged={loadMarkers}
        />
      ) : (
        <div className="border rounded-lg p-3 text-[11px] text-slate-400 italic">Start the test to begin verification.</div>
      )}
      {procedurePrompt && (
        <div className="border rounded-lg bg-amber-50 p-3 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="text-[11px] text-amber-800">
            <div className="font-semibold uppercase text-[10px] tracking-wider mb-1">Additional Procedures Prompt</div>
            <div className="whitespace-pre-wrap">{procedurePrompt}</div>
          </div>
        </div>
      )}
      {executionId && (
        <FindingsConclusionsSection
          engagementId={engagementId}
          executionId={executionId}
          redMarkers={redMarkers}
          onResolved={loadMarkers}
        />
      )}
      {loading && <div className="text-[10px] text-slate-400 italic">Refreshing markers…</div>}
    </div>
  );
}
