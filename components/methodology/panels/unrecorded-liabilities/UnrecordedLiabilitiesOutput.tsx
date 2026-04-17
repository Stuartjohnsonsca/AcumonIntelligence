'use client';

import { useCallback, useEffect, useState } from 'react';
import { ProgressStepsSection } from './ProgressStepsSection';
import { DataSamplingSection } from './DataSamplingSection';
import { AuditVerificationSection, type SampleMarker } from '../accruals/AuditVerificationSection';
import { FindingsConclusionsSection } from '../accruals/FindingsConclusionsSection';

/**
 * Composite renderer for outputFormat === 'four_section_unrecorded_liabilities'.
 * Shares the Audit Verification and Findings & Conclusions components
 * with the Accruals pipeline — the marker schema and resolution flow
 * are identical; only the Progress Steps and Data & Sampling sections
 * differ (different step labels, different population columns).
 */

interface Props {
  engagementId: string;
  executionId: string | null;
  executionStatus: string;
  pipelineState: Record<number | string, any> | null | undefined;
  currentStepIndex: number | null | undefined;
  pauseReason: string | null | undefined;
}

export function UnrecordedLiabilitiesOutput({
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
    } catch {
      // Silent — the verification section will show its own empty state.
    } finally {
      setLoading(false);
    }
  }, [engagementId, executionId]);

  useEffect(() => { loadMarkers(); }, [loadMarkers]);

  const redMarkers = markers.filter(m => m.colour === 'red');

  return (
    <div className="space-y-3">
      <ProgressStepsSection
        executionStatus={executionStatus}
        currentStepIndex={currentStepIndex}
        pipelineState={pipelineState as Record<number, any>}
        pauseReason={pauseReason}
      />
      <DataSamplingSection pipelineState={pipelineState as Record<number, any>} />
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
