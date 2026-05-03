'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { SamplingCalculatorClient } from '@/components/tools/SamplingCalculatorClient';

interface Props {
  engagementId: string;
  clientId: string;
  periodId: string;
  fsLine: string;
  testDescription: string;
  populationData: Record<string, unknown>[];
  materialityData: { performanceMateriality: number; clearlyTrivial: number; tolerableMisstatement: number };
  onComplete: (results: { runId: string; selectedIndices: number[]; sampleSize: number; coverage: number }) => void;
}

interface EmbeddedContext {
  user: { id: string; name: string; firmId: string; firmName: string };
  firmConfig: {
    confidenceLevel: number;
    confidenceFactorTable: Record<string, unknown>[] | null;
    riskMatrix: number[][] | null;
  } | null;
  period: { id: string; startDate: string; endDate: string } | null;
  client: { id: string; clientName: string; software: string | null; contactFirstName: string | null; contactSurname: string | null; contactEmail: string | null } | null;
}

/**
 * Mounts the full SamplingCalculatorClient inside the audit-test
 * execution panel so auditors get the same UI they see at
 * /tools/sampling — every method, AI features, defensibility, etc.
 *
 * Loads the props the standalone tool's server component would
 * normally compute (user, firmConfig, period, client) from
 * /api/sampling/embedded-context, then renders the calculator with
 * `embedded` so it skips the client/period/upload/map wizard and
 * opens straight on the 'method' step. The host's onComplete is
 * forwarded so the action pipeline can advance once a sample run is
 * recorded.
 */
export function EmbeddedSamplingCalculator(props: Props) {
  const { clientId, periodId, populationData, materialityData, fsLine, onComplete } = props;
  const [ctx, setCtx] = useState<EmbeddedContext | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/sampling/embedded-context?clientId=${clientId}&periodId=${periodId}`);
        if (!res.ok) throw new Error('Failed to load sampling context');
        const data: EmbeddedContext = await res.json();
        if (!cancelled) setCtx(data);
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Failed to load');
      }
    })();
    return () => { cancelled = true; };
  }, [clientId, periodId]);

  if (loadError) {
    return (
      <div className="text-xs text-red-600 p-3 bg-red-50 border border-red-200 rounded">
        {loadError}
      </div>
    );
  }

  if (!ctx || !ctx.client || !ctx.period) {
    return (
      <div className="flex items-center gap-2 text-xs text-slate-500 p-3 justify-center">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading sample calculator…
      </div>
    );
  }

  return (
    <SamplingCalculatorClient
      userId={ctx.user.id}
      userName={ctx.user.name}
      firmId={ctx.user.firmId}
      firmName={ctx.user.firmName}
      assignedClients={[]}
      isFirmAdmin={false}
      isPortfolioOwner={false}
      firmConfig={ctx.firmConfig}
      embedded
      embeddedClient={ctx.client}
      embeddedPeriod={ctx.period}
      embeddedAuditData={{
        performanceMateriality: materialityData.performanceMateriality,
        clearlyTrivial: materialityData.clearlyTrivial,
        tolerableMisstatement: materialityData.tolerableMisstatement,
        functionalCurrency: 'GBP',
        // Best-effort — fsLine doesn't always map 1:1 to the
        // standalone tool's data-type set, but the auditor can change
        // it inline. Default to "Revenue" if no match.
        dataType: dataTypeForFsLine(fsLine),
        testType: 'one_tail',
      }}
      embeddedPopulation={populationData}
      onComplete={onComplete}
    />
  );
}

function dataTypeForFsLine(fsLine: string): string {
  const f = (fsLine || '').toLowerCase();
  if (f.includes('revenue') || f.includes('sales')) return 'Revenue';
  if (f.includes('cost of sales') || f.includes('direct cost')) return 'Direct Costs';
  if (f.includes('overhead') || f.includes('admin')) return 'Overheads';
  if (f.includes('expenditure') || f.includes('expense') || f.includes('purchase')) return 'Expenditure';
  if (f.includes('debtor') || f.includes('receivable')) return 'Trade Debtors';
  if (f.includes('creditor') || f.includes('payable')) return 'Trade Creditors';
  if (f.includes('addition')) return 'Asset Additions';
  if (f.includes('asset')) return 'Assets';
  return 'Revenue';
}
