'use client';

import { useState } from 'react';
import {
  Sparkles, X, Loader2, CheckCircle2, AlertTriangle, XCircle,
  ChevronDown, ChevronUp, Zap, ListTodo, Circle, ClipboardList,
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
    key: 'roleScarcity',
    label: 'Role scarcity (recommended)',
    description: 'RI → Specialist → Reviewer → Preparer allocated across all jobs by deadline before moving to next role. Ensures senior roles are distributed fairly.',
    defaultChecked: true,
  },
  {
    key: 'constrainedFirst',
    label: 'Smart job ordering',
    description: 'Schedule hardest-to-fill jobs first. Reduces conflicts. (~0ms extra)',
    defaultChecked: false,
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
  {
    key: 'combinatorial',
    label: 'Combinatorial (Simulated Annealing)',
    description: 'Escapes local optima via probabilistic exploration. Best for 40+ jobs with cascading conflicts. (~2–4s)',
    defaultChecked: false,
  },
];

// ─── Build sequential steps from selected techniques ─────────────────────────

interface StepDef {
  label: string;
  options: SchedulerOptions;
  isMultiPass?: boolean; // triggers 15 client-side calls instead of 1
}

function buildSteps(techniques: SchedulerOptions, includeBaseline: boolean): StepDef[] {
  const base: SchedulerOptions = {
    roleScarcity: false,
    constrainedFirst: false,
    lookAhead: false,
    localSearch: false,
    multiPass: false,
    combinatorial: false,
  };

  const steps: StepDef[] = includeBaseline ? [{ label: 'Baseline greedy', options: { ...base } }] : [];

  const techOrder: (keyof SchedulerOptions)[] = ['roleScarcity', 'constrainedFirst', 'lookAhead', 'localSearch', 'multiPass', 'combinatorial'];
  const techLabels: Record<keyof SchedulerOptions, string> = {
    roleScarcity: '+ Role scarcity',
    constrainedFirst: '+ Smart job ordering',
    lookAhead: '+ Staff look-ahead',
    localSearch: '+ Improvement pass',
    multiPass: `+ Multi-pass ×${MULTI_PASS_COUNT}`,
    combinatorial: '+ Simulated Annealing',
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
  const [diagnostics, setDiagnostics] = useState<any>(null);
  const [committedScope, setCommittedScope] = useState<'all' | 'unscheduled'>('unscheduled');
  const [error, setError] = useState<string | null>(null);
  const [showViolations, setShowViolations] = useState(false);
  const [acknowledgedViolations, setAcknowledgedViolations] = useState<Set<string>>(new Set());
  const router = useRouter();
  const [, startTransition] = useTransition();

  // Technique checkboxes
  const [includeBaseline, setIncludeBaseline] = useState(false);
  const [techniques, setTechniques] = useState<SchedulerOptions>({
    roleScarcity: TECHNIQUES.find((t) => t.key === 'roleScarcity')?.defaultChecked ?? true,
    constrainedFirst: TECHNIQUES.find((t) => t.key === 'constrainedFirst')?.defaultChecked ?? false,
    lookAhead: TECHNIQUES.find((t) => t.key === 'lookAhead')?.defaultChecked ?? false,
    localSearch: TECHNIQUES.find((t) => t.key === 'localSearch')?.defaultChecked ?? false,
    multiPass: TECHNIQUES.find((t) => t.key === 'multiPass')?.defaultChecked ?? false,
    combinatorial: TECHNIQUES.find((t) => t.key === 'combinatorial')?.defaultChecked ?? false,
  });

  const hasSteps = includeBaseline || Object.values(techniques).some(Boolean);

  function toggleTechnique(key: keyof SchedulerOptions) {
    setTechniques((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  async function runOptimize(scope: 'all' | 'unscheduled') {
    const stepDefs = buildSteps(techniques, includeBaseline);

    // Initialise all steps as pending
    const initialSteps: StepState[] = stepDefs.map((s) => ({
      ...s,
      status: 'pending',
    }));
    setSteps(initialSteps);
    setPhase('running');
    setError(null);
    setResult(null);
    setCommittedScope(scope); // remember which scope was used so commit can guard deletes

    let bestResult: OptimizationResult | null = null;
    let bestScore = Infinity; // lower violations = better; tie-break on more creates
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
        // Capture diagnostics from any pass (last one wins — all passes use same data)
        if (data.diagnostics) setDiagnostics(data.diagnostics);

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
        // Track best result: fewest violations wins; tie-break by most creates
        const creates = stepResult?.changes?.filter((c) => c.action === 'create').length ?? 0;
        const stepScore = violations * 10000 - creates; // lower is better
        if (stepResult && stepScore < bestScore) {
          bestScore = stepScore;
          bestResult = stepResult;
        }
      } catch {
        setSteps((prev) =>
          prev.map((s, idx) => idx === i ? { ...s, status: 'error' } : s)
        );
        setError('Network error — please try again.');
        setPhase('idle');
        return;
      }
    }

    setResult(bestResult);
    setAcknowledgedViolations(new Set());
    setPhase('results');
  }

  async function handleCommit() {
    if (!result) return;
    setPhase('committing');
    try {
      const res = await fetch('/api/resource-planning/optimize/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ changes: result.changes, scope: committedScope }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Commit failed — please try again.');
        setPhase('results');
        return;
      }
      onClose(); // Close dialog immediately before refresh to avoid race
      startTransition(() => { router.refresh(); });
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
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">

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
                  {/* Baseline greedy — opt-in, not automatic */}
                  <label className="flex items-start gap-2 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={includeBaseline}
                      onChange={() => setIncludeBaseline((v) => !v)}
                      className="mt-0.5 h-3.5 w-3.5 rounded border-slate-300 text-violet-600 focus:ring-violet-500 cursor-pointer flex-shrink-0"
                    />
                    <span className="space-y-0.5">
                      <span className="block text-xs font-medium text-slate-700 group-hover:text-slate-900 leading-tight">
                        Baseline greedy
                      </span>
                      <span className="block text-[11px] text-slate-400 leading-snug">
                        Plain greedy pass with no enhancements. Use as a comparison baseline.
                      </span>
                    </span>
                  </label>
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
              {!hasSteps && (
                <p className="text-[11px] text-amber-600 text-center font-medium">
                  Select at least one technique above to enable the optimiser.
                </p>
              )}
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => runOptimize('all')}
                  disabled={!hasSteps}
                  className="flex flex-col items-start gap-1 border-2 border-violet-200 rounded-lg p-4 hover:border-violet-400 hover:bg-violet-50 transition-colors text-left disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-violet-200 disabled:hover:bg-transparent"
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
                  disabled={!hasSteps}
                  className="flex flex-col items-start gap-1 border-2 border-blue-200 rounded-lg p-4 hover:border-blue-400 hover:bg-blue-50 transition-colors text-left disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-blue-200 disabled:hover:bg-transparent"
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

              {/* ── Scheduler diagnostics ── */}
              {diagnostics && (
                <details className="border border-slate-200 rounded-lg text-[11px]">
                  <summary className="px-3 py-2 cursor-pointer font-semibold text-slate-500 hover:text-slate-700 select-none">
                    Scheduler diagnostics
                  </summary>
                  <div className="px-3 pb-3 pt-1 space-y-2 text-slate-600">
                    <div>
                      <p className="font-semibold text-slate-500 mb-1">Jobs with budget hours</p>
                      <div className="grid grid-cols-4 gap-1">
                        {(['RI','Reviewer','Specialist','Preparer'] as const).map((role) => (
                          <div key={role} className={`rounded px-2 py-1 text-center ${(diagnostics.jobsWithBudget?.[role] ?? 0) === 0 ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
                            <div className="font-semibold">{diagnostics.jobsWithBudget?.[role] ?? 0}</div>
                            <div className="text-[10px]">{role}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="font-semibold text-slate-500 mb-1">Eligible staff per role</p>
                      <div className="grid grid-cols-4 gap-1">
                        {(['RI','Reviewer','Specialist','Preparer'] as const).map((role) => (
                          <div key={role} className={`rounded px-2 py-1 ${(diagnostics.eligibleStaff?.[role]?.length ?? 0) === 0 ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
                            <div className="font-semibold text-center">{diagnostics.eligibleStaff?.[role]?.length ?? 0}</div>
                            <div className="text-[10px] text-center mb-0.5">{role}</div>
                            {diagnostics.eligibleStaff?.[role]?.length > 0 && (
                              <div className="text-[10px] text-slate-500 leading-snug">{(diagnostics.eligibleStaff[role] as string[]).join(', ')}</div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                    {diagnostics.sampleJob && (
                      <div>
                        <p className="font-semibold text-slate-500 mb-1">Sample job budget ({diagnostics.sampleJob.client} / {diagnostics.sampleJob.type})</p>
                        <div className="grid grid-cols-4 gap-1">
                          {(['RI','Reviewer','Specialist','Preparer'] as const).map((role) => (
                            <div key={role} className={`rounded px-2 py-1 text-center ${(diagnostics.sampleJob[role] ?? 0) === 0 ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
                              <div className="font-semibold">{diagnostics.sampleJob[role] ?? 0}h</div>
                              <div className="text-[10px]">{role}</div>
                            </div>
                          ))}
                        </div>
                        <p className="text-[10px] text-slate-400 mt-1">Profile: {diagnostics.sampleJob.profileId ?? 'none'} | ServiceType: {diagnostics.sampleJob.serviceType ?? 'none'}</p>
                      </div>
                    )}
                    {diagnostics.profiles?.length > 0 && (
                      <div>
                        <p className="font-semibold text-slate-500 mb-1">Job profiles ({diagnostics.profiles.length})</p>
                        {(diagnostics.profiles as any[]).map((p: any, i: number) => (
                          <div key={i} className="text-[10px] text-slate-500">{p.name}: RI={p.RI}h Rev={p.Reviewer}h Spec={p.Specialist}h Prep={p.Preparer}h</div>
                        ))}
                      </div>
                    )}
                    {diagnostics.profiles?.length === 0 && (
                      <p className="text-red-600 font-semibold">⚠ No job profiles found — RI/Reviewer/Specialist hours cannot be resolved.</p>
                    )}
                    <p className="text-[10px] text-slate-400">Clients with service type: {diagnostics.clientsWithServiceType}/{diagnostics.totalClients}</p>
                  </div>
                </details>
              )}

              {/* View violations button — prominent amber button */}
              {result.violations.length > 0 && (
                <button
                  onClick={() => setShowViolations(true)}
                  className="w-full flex items-center gap-2 px-3 py-2.5 bg-amber-50 border border-amber-300 rounded-lg text-xs font-semibold text-amber-800 hover:bg-amber-100 transition-colors"
                >
                  <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0" />
                  <span>
                    Review {result.violations.length} Constraint Violation{result.violations.length !== 1 ? 's' : ''}
                  </span>
                  {acknowledgedViolations.size > 0 && (
                    <span className="text-green-600 font-medium ml-1">({acknowledgedViolations.size} acknowledged)</span>
                  )}
                  <ChevronDown className="h-3.5 w-3.5 ml-auto text-amber-400" />
                </button>
              )}

              {/* AI Reasoning */}
              {result.reasoning && (
                <div className="text-[11px] text-slate-500 bg-violet-50 border border-violet-100 rounded px-3 py-2 leading-relaxed">
                  <strong className="text-violet-700">Summary:</strong> {result.reasoning}
                </div>
              )}

              {/* Job diff cards */}
              {jobIds.length === 0 ? (
                <div className="space-y-2 py-4 text-center">
                  <p className="text-sm text-slate-500">No allocation changes proposed.</p>
                  {result.schedule.length > 0 && (
                    <p className="text-[11px] text-slate-400 max-w-sm mx-auto">
                      The optimiser ran but found no hours to schedule. Check that jobs have budget
                      hours set — either directly on each job in the Unscheduled Jobs panel, or via
                      a Job Profile matched to the client&apos;s Service Type.
                    </p>
                  )}
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
        {/* ── Violations popup ── */}
        {showViolations && result && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/30 rounded-xl">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col mx-4">
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                  <h3 className="text-sm font-semibold text-slate-800">
                    Constraint Violations ({result.violations.length})
                  </h3>
                </div>
                <button onClick={() => setShowViolations(false)} className="p-1 rounded hover:bg-slate-100">
                  <X className="h-4 w-4 text-slate-400" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
                {result.violations.map((v, i) => {
                  const key = `${v.constraintId}-${v.jobId ?? ''}-${v.userId ?? ''}-${i}`;
                  const acked = acknowledgedViolations.has(key);
                  return (
                    <div
                      key={key}
                      onClick={() => setAcknowledgedViolations((prev) => {
                        const next = new Set(prev);
                        if (acked) next.delete(key); else next.add(key);
                        return next;
                      })}
                      className={`flex items-start gap-2.5 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${
                        acked
                          ? 'bg-green-50 border-green-200 opacity-60'
                          : 'bg-amber-50 border-amber-200 hover:bg-amber-100'
                      }`}
                    >
                      <div className={`mt-0.5 flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center ${
                        acked ? 'bg-green-500 border-green-500' : 'border-amber-400 bg-white'
                      }`}>
                        {acked && <CheckCircle2 className="h-3 w-3 text-white" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[10px] font-bold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">
                            P{v.priority}
                          </span>
                          <span className="text-[10px] text-slate-500 font-mono">{v.constraintId}</span>
                          {acked && <span className="text-[10px] text-green-600 font-medium">✓ Acknowledged</span>}
                        </div>
                        <p className="text-xs text-slate-700 mt-0.5">{v.description}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="px-4 py-3 border-t border-slate-200 flex items-center justify-between">
                <span className="text-[11px] text-slate-400">
                  {acknowledgedViolations.size} of {result.violations.length} acknowledged
                </span>
                <Button size="sm" variant="outline" className="text-xs" onClick={() => setShowViolations(false)}>
                  Done
                </Button>
              </div>
            </div>
          </div>
        )}

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
