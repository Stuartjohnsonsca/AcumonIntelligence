'use client';

import { useState } from 'react';
import {
  Sparkles, X, Loader2, CheckCircle2, AlertTriangle, XCircle,
  ChevronDown, ChevronUp, Zap, ListTodo, Circle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import type { OptimizationResult, AllocationChange, OptimizationViolation } from '@/lib/resource-planning/types';
import { ROLE_COLORS } from '@/lib/resource-planning/types';
import type { SchedulerOptions } from '@/lib/resource-planning/scheduler';

interface Props {
  onClose: () => void;
}

type Phase = 'idle' | 'running' | 'results' | 'committing';

const MULTI_PASS_COUNT = 15;

// ─── Step tracking ────────────────────────────────────────────────────────────

interface StepState extends StepDef {
  status: 'pending' | 'running' | 'done' | 'error';
  jobsScheduled?: number;
  violations?: number;
  unschedulable?: number;
  deltaViolations?: number; // vs previous step, negative = improvement
  // multi-pass sub-progress
  passTotal?: number;
  passCurrent?: number;
  passBestViolations?: number;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function groupByJob(changes: AllocationChange[]): Record<string, AllocationChange[]> {
  const out: Record<string, AllocationChange[]> = {};
  for (const c of changes) {
    if (!out[c.jobId]) out[c.jobId] = [];
    out[c.jobId].push(c);
  }
  return out;
}

function AllocationRow({ c }: { c: AllocationChange }) {
  const colors = ROLE_COLORS[c.role];
  const isCreate = c.action === 'create';
  return (
    <div className={`flex items-center gap-2 px-2.5 py-1.5 rounded text-xs ${
      isCreate ? 'bg-green-50 border border-green-200 text-green-800' : 'bg-red-50 border border-red-200 text-red-700 line-through'
    }`}>
      <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${colors.bg} ${colors.text}`}>
        {c.role}
      </span>
      <span className="font-medium">{c.userName}</span>
      <span className="text-slate-400 ml-auto">
        {c.startDate} → {c.endDate}
      </span>
      <span className="text-slate-500">{c.hoursPerDay}h/d</span>
      <span className={`text-[10px] font-bold ${isCreate ? 'text-green-600' : 'text-red-500'}`}>
        {isCreate ? '+ NEW' : '− REMOVE'}
      </span>
    </div>
  );
}

function JobDiffCard({ jobId, changes, violations }: {
  jobId: string;
  changes: AllocationChange[];
  violations: OptimizationViolation[];
}) {
  const [open, setOpen] = useState(true);
  const sample = changes[0];
  const jobViolations = violations.filter((v) => v.jobId === jobId);
  const creates = changes.filter((c) => c.action === 'create').length;
  const deletes = changes.filter((c) => c.action === 'delete').length;

  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-3 py-2 bg-slate-50 hover:bg-slate-100 transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-700">
            {sample?.clientName} — {sample?.auditType}
          </span>
          {creates > 0 && (
            <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-medium">
              +{creates}
            </span>
          )}
          {deletes > 0 && (
            <span className="text-[10px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full font-medium">
              −{deletes}
            </span>
          )}
          {jobViolations.length > 0 && (
            <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-medium">
              ⚠ {jobViolations.length}
            </span>
          )}
        </div>
        {open ? <ChevronUp className="h-3.5 w-3.5 text-slate-400" /> : <ChevronDown className="h-3.5 w-3.5 text-slate-400" />}
      </button>

      {open && (
        <div className="px-3 py-2 space-y-1.5">
          {changes.map((c, i) => <AllocationRow key={i} c={c} />)}
          {jobViolations.map((v, i) => (
            <div key={i} className="flex items-start gap-1.5 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2.5 py-1.5">
              <AlertTriangle className="h-3 w-3 mt-0.5 flex-shrink-0" />
              <span><strong>P{v.priority}</strong> — {v.description}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Step progress row ────────────────────────────────────────────────────────

function StepRow({ step, index }: { step: StepState; index: number }) {
  const delta = step.deltaViolations;
  const improved = delta !== undefined && delta < 0;
  const worse = delta !== undefined && delta > 0;

  return (
    <div className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border text-xs transition-colors ${
      step.status === 'running' ? 'border-violet-200 bg-violet-50' :
      step.status === 'done'    ? 'border-green-200 bg-green-50' :
      step.status === 'error'   ? 'border-red-200 bg-red-50' :
                                  'border-slate-200 bg-white'
    }`}>
      {/* Icon */}
      <div className="flex-shrink-0 w-5 flex justify-center">
        {step.status === 'running' && <Loader2 className="h-4 w-4 text-violet-500 animate-spin" />}
        {step.status === 'done'    && <CheckCircle2 className="h-4 w-4 text-green-500" />}
        {step.status === 'error'   && <XCircle className="h-4 w-4 text-red-500" />}
        {step.status === 'pending' && <Circle className="h-4 w-4 text-slate-300" />}
      </div>

      {/* Label */}
      <span className={`font-medium flex-1 ${
        step.status === 'pending' ? 'text-slate-400' : 'text-slate-700'
      }`}>
        {step.label}
      </span>

      {/* Stats */}
      {step.status === 'done' && (
        <div className="flex items-center gap-3 text-[11px]">
          <span className="text-green-700 font-medium">{step.jobsScheduled} scheduled</span>
          <span className={`font-medium ${step.violations === 0 ? 'text-green-600' : 'text-amber-600'}`}>
            {step.violations} violation{step.violations !== 1 ? 's' : ''}
          </span>
          {step.unschedulable !== undefined && step.unschedulable > 0 && (
            <span className="text-red-500 font-medium">{step.unschedulable} unschedulable</span>
          )}
          {delta !== undefined && index > 0 && (
            <span className={`font-bold ${improved ? 'text-green-600' : worse ? 'text-red-500' : 'text-slate-400'}`}>
              {improved ? `▼ ${Math.abs(delta)} fewer violations` : worse ? `▲ ${delta} more` : '— no change'}
            </span>
          )}
        </div>
      )}
      {step.status === 'running' && (
        <span className="text-[11px] text-violet-500 italic">
          {step.passTotal
            ? `Pass ${step.passCurrent ?? 0}/${step.passTotal} — best: ${step.passBestViolations ?? '…'} violations`
            : 'Running…'}
        </span>
      )}
    </div>
  );
}

// ─── Technique checkbox definitions ──────────────────────────────────────────

interface TechniqueDef {
  key: keyof SchedulerOptions;
  label: string;
  description: string;
  defaultChecked: boolean;
}

const TECHNIQUES: TechniqueDef[] = [
  {
    key: 'constrainedFirst',
    label: 'Smart job ordering',
    description: 'Schedule hardest-to-fill jobs first. Reduces conflicts. (~0ms extra)',
    defaultChecked: true,
  },
  {
    key: 'lookAhead',
    label: 'Staff look-ahead',
    description: "Prefer staff who aren't needed urgently by other jobs. (+quality)",
    defaultChecked: false,
  },
  {
    key: 'localSearch',
    label: 'Improvement pass',
    description: 'Swap allocations between jobs to reduce violations. (+5–10s)',
    defaultChecked: false,
  },
  {
    key: 'multiPass',
    label: 'Multi-pass ×15',
    description: 'Run 15 variations, keep the best result. (+15–30s)',
    defaultChecked: false,
  },
];

// ─── Build sequential steps from selected techniques ─────────────────────────

interface StepDef {
  label: string;
  options: SchedulerOptions;
  isMultiPass?: boolean; // triggers 15 client-side calls instead of 1
}

function buildSteps(techniques: SchedulerOptions): StepDef[] {
  const base: SchedulerOptions = {
    constrainedFirst: false,
    lookAhead: false,
    localSearch: false,
    multiPass: false,
  };

  const steps: StepDef[] = [{ label: 'Baseline greedy', options: { ...base } }];

  const techOrder: (keyof SchedulerOptions)[] = ['constrainedFirst', 'lookAhead', 'localSearch', 'multiPass'];
  const techLabels: Record<keyof SchedulerOptions, string> = {
    constrainedFirst: '+ Smart job ordering',
    lookAhead: '+ Staff look-ahead',
    localSearch: '+ Improvement pass',
    multiPass: `+ Multi-pass ×${MULTI_PASS_COUNT}`,
  };

  let cumulative = { ...base };
  for (const tech of techOrder) {
    if (techniques[tech]) {
      cumulative = { ...cumulative, [tech]: true };
      steps.push({
        label: techLabels[tech],
        options: { ...cumulative },
        isMultiPass: tech === 'multiPass',
      });
    }
  }

  return steps;
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ResourceOptimizerDialog({ onClose }: Props) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [steps, setSteps] = useState<StepState[]>([]);
  const [result, setResult] = useState<OptimizationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const [, startTransition] = useTransition();

  // Technique checkboxes
  const [techniques, setTechniques] = useState<SchedulerOptions>({
    constrainedFirst: TECHNIQUES.find((t) => t.key === 'constrainedFirst')?.defaultChecked ?? true,
    lookAhead: TECHNIQUES.find((t) => t.key === 'lookAhead')?.defaultChecked ?? false,
    localSearch: TECHNIQUES.find((t) => t.key === 'localSearch')?.defaultChecked ?? false,
    multiPass: TECHNIQUES.find((t) => t.key === 'multiPass')?.defaultChecked ?? false,
  });

  function toggleTechnique(key: keyof SchedulerOptions) {
    setTechniques((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  async function runOptimize(scope: 'all' | 'unscheduled') {
    const stepDefs = buildSteps(techniques);

    // Initialise all steps as pending
    const initialSteps: StepState[] = stepDefs.map((s) => ({
      ...s,
      status: 'pending',
    }));
    setSteps(initialSteps);
    setPhase('running');
    setError(null);
    setResult(null);

    let lastResult: OptimizationResult | null = null;
    let previousViolations: number | null = null;

    for (let i = 0; i < stepDefs.length; i++) {
      // Mark current step as running
      setSteps((prev) =>
        prev.map((s, idx) => idx === i ? { ...s, status: 'running' } : s)
      );

      try {
        let stepResult: OptimizationResult | null = null;

        // ── Single API call (server runs all passes internally) ──────────────
        const res = await fetch('/api/resource-planning/optimize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scope, techniques: stepDefs[i].options }),
        });

        const data = await res.json();
        if (!res.ok) {
          setSteps((prev) => prev.map((s, idx) => idx === i ? { ...s, status: 'error' } : s));
          setError(data.error ?? 'Optimisation failed — please try again.');
          setPhase('idle');
          return;
        }
        stepResult = data;

        const violations = stepResult?.violations?.length ?? 0;
        const jobsScheduled = stepResult?.schedule?.length ?? 0;
        const unschedulable = stepResult?.unschedulable?.length ?? 0;
        const delta = previousViolations !== null ? violations - previousViolations : undefined;

        setSteps((prev) =>
          prev.map((s, idx) =>
            idx === i
              ? { ...s, status: 'done', jobsScheduled, violations, unschedulable, deltaViolations: delta }
              : s
          )
        );

        previousViolations = violations;
        lastResult = stepResult;
      } catch {
        setSteps((prev) =>
          prev.map((s, idx) => idx === i ? { ...s, status: 'error' } : s)
        );
        setError('Network error — please try again.');
        setPhase('idle');
        return;
      }
    }

    setResult(lastResult);
    setPhase('results');
  }

  async function handleCommit() {
    if (!result) return;
    setPhase('committing');
    try {
      const res = await fetch('/api/resource-planning/optimize/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ changes: result.changes }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Commit failed — please try again.');
        setPhase('results');
        return;
      }
      startTransition(() => { router.refresh(); });
      onClose();
    } catch {
      setError('Network error during commit — please try again.');
      setPhase('results');
    }
  }

  const grouped = result ? groupByJob(result.changes) : {};
  const jobIds = Object.keys(grouped);
  const creates = result?.changes.filter((c) => c.action === 'create').length ?? 0;
  const deletes = result?.changes.filter((c) => c.action === 'delete').length ?? 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-violet-600" />
            <h2 className="text-base font-semibold text-slate-800">Resource Optimiser</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100 transition-colors">
            <X className="h-4 w-4 text-slate-500" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">

          {/* ── Idle ── */}
          {phase === 'idle' && (
            <div className="space-y-4">
              <p className="text-sm text-slate-600">
                The optimiser will analyse your portfolio, apply the constraint priorities, and propose
                an optimised schedule. You can review all changes before committing.
              </p>

              {/* Technique checkboxes */}
              <div className="border border-slate-200 rounded-lg px-4 py-3 space-y-2.5 bg-slate-50">
                <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
                  Optimisation techniques
                </p>
                <p className="text-[11px] text-slate-400">
                  Select one or more — each selected technique runs as an additional step, building on the previous.
                </p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
                  {TECHNIQUES.map((t) => (
                    <label key={t.key} className="flex items-start gap-2 cursor-pointer group">
                      <input
                        type="checkbox"
                        checked={techniques[t.key]}
                        onChange={() => toggleTechnique(t.key)}
                        className="mt-0.5 h-3.5 w-3.5 rounded border-slate-300 text-violet-600 focus:ring-violet-500 cursor-pointer flex-shrink-0"
                      />
                      <span className="space-y-0.5">
                        <span className="block text-xs font-medium text-slate-700 group-hover:text-slate-900 leading-tight">
                          {t.label}
                        </span>
                        <span className="block text-[11px] text-slate-400 leading-snug">
                          {t.description}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Scope buttons */}
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => runOptimize('all')}
                  className="flex flex-col items-start gap-1 border-2 border-violet-200 rounded-lg p-4 hover:border-violet-400 hover:bg-violet-50 transition-colors text-left"
                >
                  <div className="flex items-center gap-2">
                    <Zap className="h-4 w-4 text-violet-600" />
                    <span className="text-sm font-semibold text-slate-800">Optimise All</span>
                  </div>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    Re-schedules all non-locked jobs. Existing allocations may be replaced.
                  </p>
                </button>
                <button
                  onClick={() => runOptimize('unscheduled')}
                  className="flex flex-col items-start gap-1 border-2 border-blue-200 rounded-lg p-4 hover:border-blue-400 hover:bg-blue-50 transition-colors text-left"
                >
                  <div className="flex items-center gap-2">
                    <ListTodo className="h-4 w-4 text-blue-600" />
                    <span className="text-sm font-semibold text-slate-800">Optimise Unscheduled</span>
                  </div>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    Only schedules jobs marked as unscheduled. Leaves existing schedules untouched.
                  </p>
                </button>
              </div>
              <p className="text-[11px] text-slate-400 text-center">
                Constraint priorities can be configured in My Account → Resource Administration → Optimizer Settings.
              </p>
            </div>
          )}

          {/* ── Running — step progress ── */}
          {phase === 'running' && (
            <div className="space-y-3">
              <p className="text-sm font-medium text-slate-700">Running optimisation steps…</p>
              <div className="space-y-2">
                {steps.map((step, i) => (
                  <StepRow key={i} step={step} index={i} />
                ))}
              </div>
              <p className="text-[11px] text-slate-400 text-center pt-1">
                Each step builds on the previous — the best result is used for the final schedule.
              </p>
            </div>
          )}

          {/* ── Results ── */}
          {phase === 'results' && result && (
            <div className="space-y-4">

              {/* Completed steps summary */}
              {steps.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Steps completed</p>
                  {steps.map((step, i) => (
                    <StepRow key={i} step={step} index={i} />
                  ))}
                </div>
              )}

              {/* Summary bar */}
              <div className="flex items-center gap-4 bg-slate-50 rounded-lg px-4 py-2.5 text-xs font-medium">
                <span className="flex items-center gap-1.5 text-green-700">
                  <CheckCircle2 className="h-4 w-4" />
                  {creates} allocation{creates !== 1 ? 's' : ''} added
                </span>
                <span className="flex items-center gap-1.5 text-red-600">
                  <XCircle className="h-4 w-4" />
                  {deletes} removed
                </span>
                {result.violations.length > 0 && (
                  <span className="flex items-center gap-1.5 text-amber-600">
                    <AlertTriangle className="h-4 w-4" />
                    {result.violations.length} violation{result.violations.length !== 1 ? 's' : ''}
                  </span>
                )}
                {result.unschedulable.length > 0 && (
                  <span className="flex items-center gap-1.5 text-slate-500">
                    <XCircle className="h-4 w-4" />
                    {result.unschedulable.length} unschedulable
                  </span>
                )}
              </div>

              {/* AI Reasoning */}
              {result.reasoning && (
                <div className="text-[11px] text-slate-500 bg-violet-50 border border-violet-100 rounded px-3 py-2 leading-relaxed">
                  <strong className="text-violet-700">Summary:</strong> {result.reasoning}
                </div>
              )}

              {/* Job diff cards */}
              {jobIds.length === 0 ? (
                <div className="text-sm text-slate-500 text-center py-6">
                  No changes proposed — the schedule is already optimal.
                </div>
              ) : (
                <div className="space-y-2">
                  {jobIds.map((jobId) => (
                    <JobDiffCard
                      key={jobId}
                      jobId={jobId}
                      changes={grouped[jobId]}
                      violations={result.violations}
                    />
                  ))}
                </div>
              )}

              {/* Global violations */}
              {result.violations.filter((v) => !v.jobId).length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-slate-600">Other violations</p>
                  {result.violations.filter((v) => !v.jobId).map((v, i) => (
                    <div key={i} className="flex items-start gap-1.5 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2.5 py-1.5">
                      <AlertTriangle className="h-3 w-3 mt-0.5 flex-shrink-0" />
                      <span><strong>P{v.priority}</strong> — {v.description}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Committing ── */}
          {phase === 'committing' && (
            <div className="flex flex-col items-center justify-center py-12 gap-4">
              <Loader2 className="h-8 w-8 text-green-500 animate-spin" />
              <p className="text-sm font-medium text-slate-700">Saving schedule to database…</p>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        {phase === 'results' && (
          <div className="flex items-center justify-between px-5 py-3.5 border-t border-slate-200 bg-slate-50">
            <Button variant="ghost" size="sm" onClick={onClose} className="text-xs">
              Reject
            </Button>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="text-xs" onClick={() => setPhase('idle')}>
                Re-run
              </Button>
              <Button
                size="sm"
                className="text-xs bg-violet-600 hover:bg-violet-700"
                onClick={handleCommit}
                disabled={result?.changes.length === 0}
              >
                <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                Commit All Changes
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
