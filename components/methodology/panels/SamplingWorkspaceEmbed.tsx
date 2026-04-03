'use client';

import { useState, useEffect } from 'react';
import { ExternalLink, CheckCircle2, Loader2, Calculator, FileText, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props {
  engagementId: string;
  executionId: string;
  fsLine: string;
  testDescription: string;
  clientName: string;
  periodEnd: string;
  pauseRefId: string; // Outstanding item ID to mark complete
  onComplete: () => void;
}

interface SamplingStatus {
  engagementId?: string;
  status?: string;
  sampleSize?: number;
  populationSize?: number;
  populationTotal?: number;
  method?: string;
  decision?: string;
  coveragePct?: number;
}

function fmt(n: number | null | undefined): string {
  if (n == null) return '—';
  return Math.abs(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function SamplingWorkspaceEmbed({ engagementId, executionId, fsLine, testDescription, clientName, periodEnd, pauseRefId, onComplete }: Props) {
  const [samplingStatus, setSamplingStatus] = useState<SamplingStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Check if there's already a sampling engagement for this context
  useEffect(() => {
    checkSamplingStatus();
  }, [engagementId, fsLine]);

  async function checkSamplingStatus() {
    setLoading(true);
    try {
      // Look for sampling engagements linked to this audit area
      const res = await fetch(`/api/sampling/engagement?auditArea=${encodeURIComponent(fsLine)}`);
      if (res.ok) {
        const data = await res.json();
        const matching = (data.engagements || []).find((e: any) =>
          e.auditArea === fsLine || e.name?.includes(fsLine)
        );
        if (matching) {
          setSamplingStatus({
            engagementId: matching.id,
            status: matching.status,
            sampleSize: matching.runs?.[0]?.sampleSize,
            populationSize: matching.populations?.[0]?.recordCount,
            method: matching.runs?.[0]?.method,
            decision: matching.runs?.[0]?.resultSummary?.decision,
          });
        }
      }
    } catch {} finally {
      setLoading(false);
    }
  }

  async function handleMarkComplete() {
    setCompleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/engagements/${engagementId}/outstanding`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemId: pauseRefId,
          responseData: {
            completed: true,
            samplingEngagementId: samplingStatus?.engagementId,
            sampleSize: samplingStatus?.sampleSize,
            decision: samplingStatus?.decision,
          },
        }),
      });
      if (res.ok) {
        onComplete();
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to mark complete');
      }
    } catch (err: any) {
      setError(err.message || 'Failed');
    } finally {
      setCompleting(false);
    }
  }

  const samplingUrl = `/tools/sampling`;

  return (
    <div className="border rounded-lg bg-white overflow-hidden">
      {/* Header */}
      <div className="bg-teal-50 border-b border-teal-200 px-4 py-3">
        <div className="flex items-center gap-2">
          <Calculator className="h-5 w-5 text-teal-600" />
          <div>
            <h3 className="text-sm font-bold text-teal-800">Sampling Calculator</h3>
            <p className="text-[11px] text-teal-600">{fsLine} &middot; {clientName} &middot; Period ending {periodEnd}</p>
          </div>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Context info */}
        <div className="bg-slate-50 rounded-lg p-3">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Test Context</div>
          <p className="text-xs text-slate-700">{testDescription}</p>
          <div className="flex items-center gap-4 mt-2 text-[11px] text-slate-500">
            <span>FS Line: <strong className="text-slate-700">{fsLine}</strong></span>
            <span>Client: <strong className="text-slate-700">{clientName}</strong></span>
          </div>
        </div>

        {/* Sampling status */}
        {loading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-teal-500 mr-2" />
            <span className="text-xs text-slate-500">Checking sampling status...</span>
          </div>
        ) : samplingStatus?.status === 'complete' || samplingStatus?.status === 'locked' ? (
          <div className="border rounded-lg p-4 bg-green-50/50 space-y-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-500" />
              <span className="text-sm font-semibold text-green-700">Sampling Run Complete</span>
            </div>
            <div className="grid grid-cols-3 gap-3 text-xs">
              <div>
                <span className="text-slate-500 block">Sample Size</span>
                <span className="text-slate-800 font-semibold text-base">{samplingStatus.sampleSize || '—'}</span>
              </div>
              <div>
                <span className="text-slate-500 block">Population</span>
                <span className="text-slate-800 font-semibold text-base">{samplingStatus.populationSize || '—'} items</span>
              </div>
              <div>
                <span className="text-slate-500 block">Decision</span>
                <span className={`font-bold text-base ${samplingStatus.decision === 'PASS' ? 'text-green-600' : 'text-red-600'}`}>
                  {samplingStatus.decision || '—'}
                </span>
              </div>
            </div>
            {samplingStatus.method && (
              <div className="text-[11px] text-slate-500">Method: <span className="font-medium text-slate-700">{samplingStatus.method}</span></div>
            )}
          </div>
        ) : samplingStatus?.engagementId ? (
          <div className="border rounded-lg p-4 bg-blue-50/50 space-y-2">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-blue-500" />
              <span className="text-sm font-medium text-blue-700">Sampling engagement exists — {samplingStatus.status || 'in progress'}</span>
            </div>
            <p className="text-xs text-slate-500">Open the Sampling Calculator to review and run the sample.</p>
          </div>
        ) : (
          <div className="border rounded-lg p-4 bg-slate-50 space-y-2">
            <p className="text-xs text-slate-600">No sampling engagement found for this FS line. Open the Sampling Calculator to create one and run the sample.</p>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-3">
          <a
            href={samplingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 transition-colors"
          >
            <Calculator className="h-4 w-4" />
            Open Sampling Calculator
            <ExternalLink className="h-3 w-3 ml-1" />
          </a>

          {(samplingStatus?.status === 'complete' || samplingStatus?.status === 'locked') && (
            <Button
              onClick={handleMarkComplete}
              disabled={completing}
              className="bg-green-600 hover:bg-green-700"
            >
              {completing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
              Sampling Done — Continue Flow
            </Button>
          )}

          {!samplingStatus?.status && (
            <button
              onClick={handleMarkComplete}
              className="text-xs text-slate-500 hover:text-slate-700 underline"
            >
              Skip sampling (mark as done)
            </button>
          )}
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded px-3 py-2 text-xs text-red-700 flex items-start gap-2">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" /> {error}
          </div>
        )}

        <button onClick={checkSamplingStatus} className="text-[10px] text-slate-400 hover:text-slate-600">
          Refresh sampling status
        </button>
      </div>
    </div>
  );
}
