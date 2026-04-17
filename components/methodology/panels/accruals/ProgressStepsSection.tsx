'use client';

import { Check, Circle, Loader2, AlertCircle } from 'lucide-react';

/**
 * Read-only checklist of the Year-End Accruals pipeline steps, rendered
 * at the top of the four-section output. The pipeline has a fixed shape
 * (see lib/accruals-test-seed.ts), so we hardcode the step labels here
 * and light them up based on execution status + pipelineState keys.
 */

interface Props {
  executionStatus: string;
  currentStepIndex: number | null | undefined;
  pipelineState: Record<number, any> | null | undefined;
  pauseReason: string | null | undefined;
}

const STEPS = [
  { index: 0, label: 'Request accruals listing', detail: 'Listing total reconciled to TB accrual accounts' },
  { index: 1, label: 'Select sample', detail: 'Sampling method + selected items' },
  { index: 2, label: 'Request supporting documents', detail: 'Post-YE invoices, statements, POs/GRNs as applicable' },
  { index: 3, label: 'Extract evidence', detail: 'Server-side AI extraction of supplier, amount, service period' },
  { index: 4, label: 'Verify sample', detail: 'Obligation period, subsequent support, time apportionment' },
  { index: 5, label: 'Team review', detail: 'Sign off findings and conclusions' },
];

export function ProgressStepsSection({ executionStatus, currentStepIndex, pipelineState, pauseReason }: Props) {
  const state = pipelineState || {};
  const curr = currentStepIndex ?? 0;

  function statusFor(i: number): 'done' | 'active' | 'paused' | 'pending' {
    if (executionStatus === 'completed') return 'done';
    if (i < curr) return 'done';
    if (i === curr) {
      if (executionStatus === 'paused') return 'paused';
      if (executionStatus === 'running') return 'active';
      if (state[i] && Object.keys(state[i]).length > 0) return 'done';
      return 'active';
    }
    return 'pending';
  }

  return (
    <div className="border rounded-lg bg-slate-50 p-3">
      <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Progress Steps</h4>
      <ol className="space-y-1.5">
        {STEPS.map(step => {
          const s = statusFor(step.index);
          return (
            <li key={step.index} className="flex items-start gap-2">
              <span className="flex-shrink-0 mt-0.5">
                {s === 'done' && <Check className="h-3.5 w-3.5 text-green-600" />}
                {s === 'active' && <Loader2 className="h-3.5 w-3.5 text-blue-600 animate-spin" />}
                {s === 'paused' && <AlertCircle className="h-3.5 w-3.5 text-amber-600" />}
                {s === 'pending' && <Circle className="h-3.5 w-3.5 text-slate-300" />}
              </span>
              <div className="flex-1 min-w-0">
                <div className={`text-xs font-medium ${s === 'pending' ? 'text-slate-400' : 'text-slate-700'}`}>
                  {step.label}
                  {s === 'paused' && pauseReason && (
                    <span className="ml-2 text-[10px] text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">
                      {pauseReason.replace(/_/g, ' ')}
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-slate-400">{step.detail}</div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
