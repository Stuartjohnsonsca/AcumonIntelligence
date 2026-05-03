'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Plus, X, Save, Loader2, GripVertical, ChevronDown, ChevronRight, Trash2, ArrowDown, EyeOff, Eye, GitBranch, GitMerge } from 'lucide-react';
import { ActionCatalog, getActionIcon, type ActionDefinitionItem } from './ActionCatalog';
import { ActionInputPanel } from './ActionInputPanel';
import { getCategoryStyle } from '@/lib/action-registry';
import type { InputFieldDef, OutputFieldDef } from '@/lib/action-registry';
import {
  TEST_PIPELINE_STAGES, TEST_PIPELINE_STAGE_THEME, STAGE_CATEGORIES,
  readStepStage, withStepStage, type TestPipelineStage,
  readHiddenStages, type PipelineEditorConfig,
} from '@/lib/test-pipeline-stages';

// Branch rules drive what runs after a step. `continue` is the default
// (no rule stored = continue). `goto` jumps to a specific step (or -1 = end).
// `skip` skips the next N steps. `conditional` evaluates a list of when→target
// rules with an optional default fall-through. Keep this shape in sync with
// the runtime evaluator in lib/flow-engine.ts.
type BranchMode = 'continue' | 'goto' | 'skip' | 'conditional';
interface BranchRules {
  mode: BranchMode;
  target?: number;
  rules?: { when: string; target: number }[];
  default?: number;
}

interface PipelineStep {
  id: string;
  actionDefinitionId: string;
  actionDefinition: ActionDefinitionItem;
  stepOrder: number;
  inputBindings: Record<string, any>;
  branchRules: BranchRules | null;
  isExpanded: boolean;
  flowPanelOpen: boolean;
}

interface Props {
  testId: string;
  testDescription: string;
  initialSteps?: { id: string; actionDefinitionId: string; stepOrder: number; inputBindings: Record<string, any>; actionDefinition: ActionDefinitionItem; branchRules?: BranchRules | null }[];
  onSave: (
    steps: { actionDefinitionId: string; stepOrder: number; inputBindings: Record<string, any>; branchRules: BranchRules | null }[],
    editorConfig: PipelineEditorConfig,
  ) => Promise<void>;
  onClose: () => void;
}

let counter = 0;
function uid() { return `step_${Date.now()}_${++counter}`; }

export function ActionPipelineEditor({ testId, testDescription, initialSteps, onSave, onClose }: Props) {
  const [steps, setSteps] = useState<PipelineStep[]>(() =>
    (initialSteps || []).map((s, i) => ({
      id: s.id || uid(),
      actionDefinitionId: s.actionDefinitionId,
      actionDefinition: s.actionDefinition,
      stepOrder: i,
      inputBindings: s.inputBindings || {},
      branchRules: s.branchRules ?? null,
      isExpanded: i === 0,
      flowPanelOpen: false,
    }))
  );
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [insertAfterIndex, setInsertAfterIndex] = useState(-1); // -1 = append at end
  // Stage the next-added step belongs to. Set when the user clicks
  // "Add action to <stage>" so the new step lands in the right
  // bucket; defaults to obtain_population when the user uses the
  // generic Add Action button at the bottom.
  const [pendingStage, setPendingStage] = useState<TestPipelineStage>('obtain_population');
  const [saving, setSaving] = useState(false);
  const [actions, setActions] = useState<ActionDefinitionItem[]>([]);
  const [loadingActions, setLoadingActions] = useState(true);

  // Per-test editor metadata. Currently holds hiddenStages so a test
  // can collapse stages it doesn't use. Persisted alongside steps on
  // save; the runtime ignores it.
  const [editorConfig, setEditorConfig] = useState<PipelineEditorConfig>({ hiddenStages: [] });
  // Toggle for the "show hidden stages" affordance at the bottom of
  // the editor — when on, hidden stages render greyed out so the user
  // can un-hide them.
  const [showHiddenStages, setShowHiddenStages] = useState(false);

  // Load action definitions AND saved steps for this test
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Fetch action definitions and saved steps in parallel
        const [actionsRes, stepsRes] = await Promise.all([
          fetch('/api/methodology-admin/action-definitions'),
          fetch(`/api/methodology-admin/tests?id=${testId}&includeSteps=true`),
        ]);
        if (cancelled) return;

        const actionsData = actionsRes.ok ? await actionsRes.json() : { actions: [] };
        const actionsList: ActionDefinitionItem[] = actionsData.actions || [];
        setActions(actionsList);

        if (stepsRes.ok) {
          const stepsData = await stepsRes.json();
          const test = stepsData.test;
          const savedSteps = test?.actionSteps || [];
          // Hydrate editorConfig from the test row so hidden-stage
          // selections survive across editor sessions.
          const hidden = readHiddenStages(test?.editorConfig);
          setEditorConfig({ hiddenStages: hidden });
          if (savedSteps.length > 0 && actionsList.length > 0) {
            setSteps(savedSteps.map((s: any, i: number) => {
              const actionDef = s.actionDefinition || actionsList.find((a: ActionDefinitionItem) => a.id === s.actionDefinitionId);
              return {
                id: s.id || uid(),
                actionDefinitionId: s.actionDefinitionId,
                actionDefinition: actionDef || { id: s.actionDefinitionId, code: '', name: 'Unknown Action', description: null, category: 'general', icon: null, color: null, isSystem: false, inputSchema: [], outputSchema: [] },
                stepOrder: i,
                inputBindings: s.inputBindings || {},
                branchRules: s.branchRules ?? null,
                isExpanded: i === 0,
                flowPanelOpen: false,
              };
            }));
          }
        }
      } catch (err) {
        console.error('Failed to load pipeline data:', err);
      } finally {
        if (!cancelled) setLoadingActions(false);
      }
    })();
    return () => { cancelled = true; };
  }, [testId]);

  const handleAddAction = useCallback((action: ActionDefinitionItem) => {
    // Stamp the step with its stage so the renderer groups it under
    // the right header. Stored on inputBindings.__stage to avoid a
    // schema migration — see lib/test-pipeline-stages.ts for the
    // wider rationale.
    const newStep: PipelineStep = {
      id: uid(),
      actionDefinitionId: action.id,
      actionDefinition: action,
      stepOrder: 0,
      inputBindings: withStepStage(buildDefaultBindings(action.inputSchema), pendingStage),
      branchRules: null,
      isExpanded: true,
      flowPanelOpen: false,
    };

    setSteps(prev => {
      // When inserting at a specific index (the +-button between two
      // existing steps) the user has chosen a precise position.
      // When the user clicked "Add action to <stage>" we drop the
      // new step at the end of that stage's group so the stages stay
      // contiguous in the saved order.
      let idx: number;
      if (insertAfterIndex >= 0) {
        idx = insertAfterIndex + 1;
      } else {
        // Find the last step currently in pendingStage, insert
        // immediately after it. If the stage is empty, insert before
        // the first step of the next stage; if there's no later
        // stage, append at the end.
        const stageOrder = TEST_PIPELINE_STAGES.findIndex(s => s.key === pendingStage);
        let lastInStage = -1;
        let firstAfterStage = prev.length;
        prev.forEach((s, i) => {
          const sStage = readStepStage(s.inputBindings);
          const sStageOrder = TEST_PIPELINE_STAGES.findIndex(x => x.key === sStage);
          if (sStageOrder === stageOrder) lastInStage = i;
          else if (sStageOrder > stageOrder && i < firstAfterStage) firstAfterStage = i;
        });
        idx = lastInStage >= 0 ? lastInStage + 1 : firstAfterStage;
      }
      const updated = [...prev];
      updated.splice(idx, 0, newStep);
      return updated.map((s, i) => ({ ...s, stepOrder: i }));
    });
    setCatalogOpen(false);
    setInsertAfterIndex(-1);
  }, [insertAfterIndex, pendingStage]);

  const handleRemoveStep = useCallback((stepId: string) => {
    setSteps(prev => prev.filter(s => s.id !== stepId).map((s, i) => ({ ...s, stepOrder: i })));
  }, []);

  const handleMoveStep = useCallback((stepId: string, direction: 'up' | 'down') => {
    setSteps(prev => {
      const idx = prev.findIndex(s => s.id === stepId);
      if (idx < 0) return prev;
      const newIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (newIdx < 0 || newIdx >= prev.length) return prev;
      const updated = [...prev];
      [updated[idx], updated[newIdx]] = [updated[newIdx], updated[idx]];
      return updated.map((s, i) => ({ ...s, stepOrder: i }));
    });
  }, []);

  const handleInputChange = useCallback((stepId: string, fieldCode: string, value: any) => {
    setSteps(prev => prev.map(s =>
      s.id === stepId ? { ...s, inputBindings: { ...s.inputBindings, [fieldCode]: value } } : s
    ));
  }, []);

  const toggleExpand = useCallback((stepId: string) => {
    setSteps(prev => prev.map(s =>
      s.id === stepId ? { ...s, isExpanded: !s.isExpanded } : s
    ));
  }, []);

  const toggleFlowPanel = useCallback((stepId: string) => {
    setSteps(prev => prev.map(s =>
      s.id === stepId ? { ...s, flowPanelOpen: !s.flowPanelOpen } : s
    ));
  }, []);

  const handleBranchRulesChange = useCallback((stepId: string, rules: BranchRules | null) => {
    setSteps(prev => prev.map(s => s.id === stepId ? { ...s, branchRules: rules } : s));
  }, []);

  // Sets goto-merge rules on every step whose stepOrder is in
  // `branchTargetIndices`. Used by the Branch & Merge helper inside
  // BranchRulesPanel — turning a one-step fork into a true
  // branch/merge structure means every branch's terminal step has
  // to point at the same downstream merge point. Doing this in one
  // click here is much friendlier than asking the operator to
  // re-open each branch step's Flow panel manually.
  const setBranchEndsMergeTarget = useCallback((branchTargetIndices: number[], mergeTarget: number) => {
    setSteps(prev => prev.map((s, i) => {
      if (!branchTargetIndices.includes(i)) return s;
      // Only overwrite when the branch step is currently linear or
      // already a goto — leave bespoke conditional rules alone so
      // we don't silently destroy operator work.
      const existing = s.branchRules;
      if (existing && existing.mode === 'conditional') return s;
      return { ...s, branchRules: { mode: 'goto', target: mergeTarget } };
    }));
  }, []);

  // Inbound-reference map: which other steps point to step N via
  // their branchRules. Used to render "merge point" pills and
  // "incoming branch" badges so the operator can see the graph
  // structure at a glance.
  const inboundRefs = useMemo(() => {
    const map = new Map<number, Array<{ from: number; kind: 'goto' | 'conditional'; when?: string }>>();
    const push = (target: number, ref: { from: number; kind: 'goto' | 'conditional'; when?: string }) => {
      if (target < 0 || target >= steps.length) return;
      if (!map.has(target)) map.set(target, []);
      map.get(target)!.push(ref);
    };
    for (let i = 0; i < steps.length; i++) {
      const r = steps[i].branchRules;
      if (!r) continue;
      if (r.mode === 'goto' && typeof r.target === 'number') push(r.target, { from: i, kind: 'goto' });
      if (r.mode === 'skip' && typeof r.target === 'number') push(i + 1 + Math.max(1, r.target), { from: i, kind: 'goto' });
      if (r.mode === 'conditional') {
        for (const rule of r.rules || []) {
          if (typeof rule.target === 'number') push(rule.target, { from: i, kind: 'conditional', when: rule.when });
        }
        if (typeof r.default === 'number') push(r.default, { from: i, kind: 'conditional', when: 'default' });
      }
    }
    return map;
  }, [steps]);

  const handleToggleStageHidden = useCallback((stage: TestPipelineStage) => {
    setEditorConfig(prev => {
      const current = prev.hiddenStages || [];
      const next = current.includes(stage)
        ? current.filter(s => s !== stage)
        : [...current, stage];
      return { ...prev, hiddenStages: next };
    });
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(
        steps.map(s => ({
          actionDefinitionId: s.actionDefinitionId,
          stepOrder: s.stepOrder,
          inputBindings: s.inputBindings,
          branchRules: s.branchRules,
        })),
        editorConfig,
      );
    } finally {
      setSaving(false);
    }
  };

  const getPreviousOutputs = (stepIndex: number): OutputFieldDef[] => {
    if (stepIndex <= 0) return [];
    return steps[stepIndex - 1]?.actionDefinition?.outputSchema || [];
  };

  // Per-step card render — pulled into a helper so the per-stage
  // grouping below can call it without re-deriving any of the
  // step-local data each time the loop fires.
  function renderStep(step: PipelineStep, idx: number) {
    const Icon = getActionIcon(step.actionDefinition.icon);
    const userInputs = step.actionDefinition.inputSchema.filter(f => f.source === 'user');
    const autoInputs = step.actionDefinition.inputSchema.filter(f => f.source === 'auto');
    const prevOutputs = getPreviousOutputs(idx);
    // Inbound references: which earlier steps point at this one
    // via their branchRules. When more than one references this
    // step, render a "merge point" pill so the operator can see
    // the convergence at a glance.
    const inbound = inboundRefs.get(idx) || [];
    const isMergePoint = inbound.length > 1;
    // Outbound branching: when this step's branchRules use
    // conditional or goto, render a "branches into N paths" pill
    // so the operator sees the divergence without expanding the
    // Flow panel.
    const branchOut = (() => {
      const r = step.branchRules;
      if (!r || r.mode === 'continue') return null;
      if (r.mode === 'goto') return { kind: 'goto' as const, count: 1 };
      if (r.mode === 'skip') return { kind: 'skip' as const, count: 1 };
      const conditionalTargets = (r.rules || []).length + (r.default !== undefined ? 1 : 0);
      return { kind: 'conditional' as const, count: conditionalTargets };
    })();
    return (
      <div key={step.id} className="mb-2">
        <div className="border border-slate-200 rounded-lg overflow-hidden shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center gap-3 px-3 py-2 bg-white cursor-pointer" onClick={() => toggleExpand(step.id)}>
            <div className="flex items-center gap-1 text-slate-300 cursor-grab"><GripVertical className="h-4 w-4" /></div>
            <div className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center text-[10px] font-bold text-slate-500 shrink-0">{idx + 1}</div>
            <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 bg-slate-100" style={{ color: step.actionDefinition.color || '#64748b' }}>
              {Icon && <Icon className="h-3.5 w-3.5 text-current" />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium text-slate-800">{step.actionDefinition.name}</span>
                <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${getCategoryStyle(step.actionDefinition.category)}`}>{step.actionDefinition.category}</span>
                {isMergePoint && (
                  <span
                    className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-full font-medium bg-violet-100 text-violet-700 border border-violet-200"
                    title={`Merge point — ${inbound.length} branches converge here:\n${inbound.map(r => `  • from step ${r.from + 1}${r.when ? ` (${r.when === 'default' ? 'default' : 'when ' + r.when})` : ''}`).join('\n')}`}
                  >
                    <GitMerge className="h-2.5 w-2.5" /> merges {inbound.length}
                  </span>
                )}
                {!isMergePoint && inbound.length === 1 && (
                  <span
                    className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-full font-medium bg-slate-100 text-slate-600 border border-slate-200"
                    title={`Reached from step ${inbound[0].from + 1}${inbound[0].when ? ` (${inbound[0].when === 'default' ? 'default' : 'when ' + inbound[0].when})` : ''}`}
                  >
                    ← from step {inbound[0].from + 1}
                  </span>
                )}
                {branchOut && (
                  <span
                    className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-full font-medium bg-amber-100 text-amber-700 border border-amber-200"
                    title={
                      branchOut.kind === 'conditional'
                        ? `Branches into ${branchOut.count} path(s) — open the Flow panel to edit`
                        : branchOut.kind === 'goto'
                        ? 'Jumps to a specific step — open the Flow panel to edit'
                        : 'Skips one or more steps — open the Flow panel to edit'
                    }
                  >
                    <GitBranch className="h-2.5 w-2.5" />
                    {branchOut.kind === 'conditional' ? `branches → ${branchOut.count}` :
                     branchOut.kind === 'goto'        ? 'jumps' :
                                                       'skips'}
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={e => { e.stopPropagation(); handleMoveStep(step.id, 'up'); }}
                className="p-1 hover:bg-slate-100 rounded text-slate-300 hover:text-slate-600"
                title="Move up"
              ><ArrowDown className="h-3.5 w-3.5 rotate-180" /></button>
              <button
                onClick={e => { e.stopPropagation(); handleMoveStep(step.id, 'down'); }}
                className="p-1 hover:bg-slate-100 rounded text-slate-300 hover:text-slate-600"
                title="Move down"
              ><ArrowDown className="h-3.5 w-3.5" /></button>
              {step.isExpanded ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
              <button onClick={e => { e.stopPropagation(); handleRemoveStep(step.id); }} className="p-1 hover:bg-red-50 rounded text-slate-300 hover:text-red-500 transition-colors"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          </div>
          {step.isExpanded && (
            <div className="border-t px-4 py-3 bg-slate-50/50 space-y-4">
              {userInputs.length > 0 && (
                <div>
                  <h5 className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Configuration</h5>
                  <div className="space-y-3">
                    {userInputs.map(field => (
                      <ActionInputPanel key={field.code} field={field} value={step.inputBindings[field.code]} onChange={(code, val) => handleInputChange(step.id, code, val)} previousOutputs={prevOutputs} stepIndex={idx} />
                    ))}
                  </div>
                </div>
              )}
              {autoInputs.length > 0 && (
                <div>
                  <h5 className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Auto-Mapped Inputs</h5>
                  <div className="space-y-2">
                    {autoInputs.map(field => (
                      <ActionInputPanel key={field.code} field={field} value={step.inputBindings[field.code] ?? field.autoMapFrom} onChange={(code, val) => handleInputChange(step.id, code, val)} previousOutputs={prevOutputs} stepIndex={idx} />
                    ))}
                  </div>
                </div>
              )}
              <div>
                <h5 className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Outputs</h5>
                <div className="flex flex-wrap gap-1.5">
                  {step.actionDefinition.outputSchema.map(out => (
                    <span key={out.code} className="inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-full bg-green-50 text-green-700 border border-green-100">
                      <span className="w-1 h-1 rounded-full bg-green-400" />
                      {out.label}
                      <span className="text-green-400">({out.type})</span>
                    </span>
                  ))}
                </div>
              </div>
              {/* Flow / branch rules — collapsed by default. Empty
                  rules = linear (next step in stepOrder). */}
              <div className="border-t pt-3">
                <button
                  type="button"
                  onClick={() => toggleFlowPanel(step.id)}
                  className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-500 hover:text-slate-700 uppercase tracking-wider"
                >
                  <GitBranch className="h-3 w-3" />
                  Flow
                  <span className="text-slate-400 normal-case font-normal lowercase">
                    {summariseBranchRules(step.branchRules, steps.length)}
                  </span>
                  {step.flowPanelOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                </button>
                {step.flowPanelOpen && (
                  <div className="mt-2">
                    <BranchRulesPanel
                      stepIndex={idx}
                      totalSteps={steps.length}
                      stepLabels={steps.map(s => s.actionDefinition.name)}
                      previousOutputs={step.actionDefinition.outputSchema}
                      value={step.branchRules}
                      onChange={(val) => handleBranchRulesChange(step.id, val)}
                      onSetMergeTargetOnBranchEnds={setBranchEndsMergeTarget}
                    />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-white">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b bg-slate-50 shrink-0">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Action Pipeline Editor</h2>
          <p className="text-xs text-slate-400 mt-0.5">{testDescription}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={handleSave} size="sm" disabled={saving} className="bg-blue-600 hover:bg-blue-700 text-xs">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Save className="h-3.5 w-3.5 mr-1" />}
            Save Pipeline
          </Button>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Pipeline */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-2xl mx-auto">
          {loadingActions ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-slate-300" />
            </div>
          ) : (
            <>
              {/* Group steps by stage for rendering — every audit
                  test moves through the same five stages, and the
                  admin chooses which actions plug into each one.
                  Hidden empty stages are filtered out of this loop
                  (showHiddenStages flips them back on so the user
                  can un-hide). */}
              {(() => {
                const hiddenSet = new Set(editorConfig.hiddenStages || []);
                const stagesWithSteps = TEST_PIPELINE_STAGES.map(stageDef => ({
                  stageDef,
                  entries: steps
                    .map((step, idx) => ({ step, idx }))
                    .filter(({ step }) => readStepStage(step.inputBindings) === stageDef.key),
                }));
                const visibleStages = stagesWithSteps.filter(({ stageDef, entries }) => {
                  if (entries.length > 0) return true;
                  if (!hiddenSet.has(stageDef.key)) return true;
                  return showHiddenStages;
                });
                return visibleStages.map(({ stageDef, entries }) => {
                  const theme = TEST_PIPELINE_STAGE_THEME[stageDef.key];
                  const isHidden = hiddenSet.has(stageDef.key);
                  const isEmpty = entries.length === 0;
                  return (
                    <div key={stageDef.key} className={`mb-6 ${isHidden ? 'opacity-60' : ''}`}>
                      {/* Stage header */}
                      <div className={`flex items-center justify-between px-3 py-2 rounded-t-lg ${theme.headerBg} border ${theme.border}`}>
                        <div className="flex items-center gap-2">
                          <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold ${theme.pillBg} ${theme.pillText}`}>{stageDef.order}</span>
                          <div>
                            <div className={`text-xs font-bold ${theme.headerText} flex items-center gap-1.5`}>
                              {stageDef.label}
                              {isHidden && <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-white/60 text-slate-500 border border-slate-200">Hidden</span>}
                            </div>
                            <div className={`text-[10px] ${theme.headerText} opacity-70`}>{stageDef.description}</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5">
                          {/* Hide / Show toggle. Only meaningful when
                              the stage is empty — once a step is in
                              the stage, the toggle is suppressed so a
                              hidden stage can't accidentally hide
                              configured work. */}
                          {isEmpty && (
                            <button
                              type="button"
                              onClick={() => handleToggleStageHidden(stageDef.key)}
                              className="inline-flex items-center gap-1 text-[10px] h-7 px-2 rounded border border-slate-200 bg-white/70 text-slate-500 hover:bg-white hover:text-slate-700"
                              title={isHidden ? 'Show this stage in the editor' : 'Hide this empty stage from the editor for this test'}
                            >
                              {isHidden ? <><Eye className="h-3 w-3" /> Show</> : <><EyeOff className="h-3 w-3" /> Hide</>}
                            </button>
                          )}
                          <Button
                            onClick={() => { setPendingStage(stageDef.key); setInsertAfterIndex(-1); setCatalogOpen(true); }}
                            size="sm" variant="outline" className="text-[10px] h-7"
                          >
                            <Plus className="h-3 w-3 mr-1" /> Add action
                          </Button>
                        </div>
                      </div>
                      <div className={`border-l border-r border-b ${theme.border} rounded-b-lg p-3 bg-white`}>
                        {entries.length === 0 ? (
                          <p className="text-[10px] text-slate-400 italic text-center py-2">
                            {isHidden
                              ? 'Hidden stage — no actions; the runtime will pass through this stage.'
                              : 'No actions configured for this stage.'}
                          </p>
                        ) : (
                          entries.map(({ step, idx }) => renderStep(step, idx))
                        )}
                      </div>
                    </div>
                  );
                });
              })()}

              {/* Empty-state panel — shown only when there isn't a
                  single step in any stage, so the user knows where
                  to start. */}
              {steps.length === 0 && (
                <div className="text-center py-2 text-[11px] text-slate-400">
                  Add actions to each stage above to build the pipeline.
                </div>
              )}

              {/* Show / hide affordance for any stages currently
                  hidden on this test. Lets the user reveal a hidden
                  stage if they realise they need it. */}
              {(editorConfig.hiddenStages || []).length > 0 && (
                <div className="mt-4 text-center">
                  <button
                    type="button"
                    onClick={() => setShowHiddenStages(v => !v)}
                    className="inline-flex items-center gap-1.5 text-[10px] text-slate-500 hover:text-slate-700"
                  >
                    {showHiddenStages ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                    {showHiddenStages ? 'Hiding hidden stages' : `Show ${(editorConfig.hiddenStages || []).length} hidden stage${(editorConfig.hiddenStages || []).length === 1 ? '' : 's'}`}
                  </button>
                </div>
              )}

            </>
          )}
        </div>
      </div>

      {/* Action Catalog Modal — filtered to actions whose category
          matches the stage being added to. STAGE_CATEGORIES is
          permissive (most stages allow 'general'), so unusual or
          ambiguous actions still surface where they could plausibly
          be useful. */}
      {catalogOpen && (() => {
        const allowed = new Set(STAGE_CATEGORIES[pendingStage] || []);
        const filteredActions = allowed.size > 0
          ? actions.filter(a => allowed.has((a.category || 'general').toLowerCase()))
          : actions;
        return (
          <ActionCatalog
            actions={filteredActions.length > 0 ? filteredActions : actions}
            onSelect={handleAddAction}
            onClose={() => { setCatalogOpen(false); setInsertAfterIndex(-1); }}
          />
        );
      })()}
    </div>
  );
}

// Build default input bindings from schema
function buildDefaultBindings(inputSchema: InputFieldDef[]): Record<string, any> {
  const bindings: Record<string, any> = {};
  for (const field of inputSchema) {
    if (field.autoMapFrom) {
      bindings[field.code] = field.autoMapFrom;
    } else if (field.defaultValue !== undefined) {
      bindings[field.code] = field.defaultValue;
    }
  }
  return bindings;
}

// One-line summary of branch rules shown next to the "Flow" header.
function summariseBranchRules(rules: BranchRules | null, total: number): string {
  if (!rules || rules.mode === 'continue') return '— continue to next step';
  if (rules.mode === 'goto') {
    if (rules.target === -1) return '— go to end';
    if (typeof rules.target === 'number') return `— go to step ${rules.target + 1}`;
    return '— go to (unset)';
  }
  if (rules.mode === 'skip') {
    const n = rules.target ?? 1;
    return `— skip ${n} step${n === 1 ? '' : 's'}`;
  }
  if (rules.mode === 'conditional') {
    const count = rules.rules?.length || 0;
    return `— ${count} condition${count === 1 ? '' : 's'}${rules.default !== undefined ? ' + default' : ''}`;
  }
  return '';
}

// Per-step Flow / branch rules editor. Renders inside an expanded step.
// Targets reference stepOrder values (0-indexed) — the picker shows
// every other step in the pipeline so the user can pick precisely.
// -1 is reserved for "end of pipeline" so a step can short-circuit.
function BranchRulesPanel(props: {
  stepIndex: number;
  totalSteps: number;
  stepLabels: string[];
  previousOutputs: OutputFieldDef[];
  value: BranchRules | null;
  onChange: (rules: BranchRules | null) => void;
  /**
   * Hands a list of branch-target step indices and a chosen merge
   * target up to the editor so it can stamp `goto: mergeTarget` on
   * each branch step in one go. Lets the operator close the loop on
   * a fork without having to open every branch step's Flow panel
   * individually.
   */
  onSetMergeTargetOnBranchEnds?: (branchTargetIndices: number[], mergeTarget: number) => void;
}) {
  const { stepIndex, totalSteps, stepLabels, previousOutputs, value, onChange, onSetMergeTargetOnBranchEnds } = props;
  const mode: BranchMode = value?.mode || 'continue';
  const [mergeTargetPick, setMergeTargetPick] = useState<number | ''>('');

  const setMode = (m: BranchMode) => {
    if (m === 'continue') return onChange(null);
    if (m === 'goto') return onChange({ mode: 'goto', target: Math.min(stepIndex + 1, totalSteps - 1) });
    if (m === 'skip') return onChange({ mode: 'skip', target: 1 });
    return onChange({ mode: 'conditional', rules: [], default: stepIndex + 1 });
  };

  // Step picker — used for goto / conditional / default targets. Lists
  // every step in the pipeline and an explicit "End of pipeline" option.
  // The current step is excluded so a step can't target itself.
  const renderTargetPicker = (target: number | undefined, onPick: (t: number) => void) => (
    <select
      value={target ?? ''}
      onChange={e => onPick(parseInt(e.target.value, 10))}
      className="text-[11px] border border-slate-200 rounded px-1.5 py-1 bg-white"
    >
      <option value="" disabled>Select target…</option>
      {stepLabels.map((label, i) => (
        i === stepIndex
          ? null
          : <option key={i} value={i}>Step {i + 1} — {label}</option>
      ))}
      <option value={-1}>End of pipeline</option>
    </select>
  );

  return (
    <div className="bg-slate-50 border border-slate-200 rounded p-2 space-y-2">
      {/* Mode tabs */}
      <div className="flex items-center gap-1">
        {(['continue', 'goto', 'skip', 'conditional'] as BranchMode[]).map(m => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`text-[10px] px-2 py-1 rounded ${
              mode === m
                ? 'bg-blue-600 text-white'
                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
            }`}
          >
            {m === 'continue' ? 'Always continue' :
             m === 'goto'     ? 'Jump to'         :
             m === 'skip'     ? 'Skip next'       :
                                'Conditional'}
          </button>
        ))}
      </div>

      {mode === 'continue' && (
        <p className="text-[10px] text-slate-500">After this step finishes, the pipeline runs the next step in order. This is the default.</p>
      )}

      {mode === 'goto' && (
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-slate-500">After this step, jump to:</span>
          {renderTargetPicker(value?.target, t => onChange({ mode: 'goto', target: t }))}
        </div>
      )}

      {mode === 'skip' && (
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-slate-500">Skip the next</span>
          <input
            type="number"
            min={1}
            value={value?.target ?? 1}
            onChange={e => onChange({ mode: 'skip', target: Math.max(1, parseInt(e.target.value || '1', 10)) })}
            className="w-16 text-[11px] border border-slate-200 rounded px-1.5 py-1 bg-white"
          />
          <span className="text-[10px] text-slate-500">step(s).</span>
        </div>
      )}

      {mode === 'conditional' && (
        <div className="space-y-2">
          <p className="text-[10px] text-slate-500">
            Each rule is evaluated in order. The first matching rule's target runs next; if no rule matches, the default target runs.
            Reference this step's outputs as <code className="px-1 bg-white border border-slate-200 rounded text-[10px]">{`$prev.<field>`}</code> or other steps as <code className="px-1 bg-white border border-slate-200 rounded text-[10px]">{`$step.N.<field>`}</code>.
          </p>
          {previousOutputs.length > 0 && (
            <div className="text-[10px] text-slate-500">
              Outputs of this step:{' '}
              {previousOutputs.map(o => (
                <code key={o.code} className="px-1 mr-1 bg-white border border-slate-200 rounded">{`$prev.${o.code}`}</code>
              ))}
            </div>
          )}
          <div className="space-y-1.5">
            {(value?.rules || []).map((rule, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-[10px] text-slate-400 w-8">If</span>
                <input
                  type="text"
                  value={rule.when}
                  placeholder='e.g. $prev.pass_fail == "fail"'
                  onChange={e => {
                    const updated = [...(value?.rules || [])];
                    updated[i] = { ...updated[i], when: e.target.value };
                    onChange({ ...value!, rules: updated });
                  }}
                  className="flex-1 text-[11px] border border-slate-200 rounded px-1.5 py-1 font-mono bg-white"
                />
                <span className="text-[10px] text-slate-400">→</span>
                {renderTargetPicker(rule.target, t => {
                  const updated = [...(value?.rules || [])];
                  updated[i] = { ...updated[i], target: t };
                  onChange({ ...value!, rules: updated });
                })}
                <button
                  type="button"
                  onClick={() => {
                    const updated = [...(value?.rules || [])].filter((_, j) => j !== i);
                    onChange({ ...value!, rules: updated });
                  }}
                  className="text-slate-300 hover:text-red-500"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => onChange({
                ...value!,
                mode: 'conditional',
                rules: [...(value?.rules || []), { when: '', target: stepIndex + 1 }],
              })}
              className="text-[10px] text-blue-600 hover:text-blue-700"
            >
              <Plus className="h-3 w-3 inline -mt-0.5 mr-0.5" />Add rule
            </button>
          </div>
          <div className="flex items-center gap-2 pt-1 border-t border-slate-200">
            <span className="text-[10px] text-slate-500">Otherwise (default):</span>
            {renderTargetPicker(value?.default, t => onChange({ ...value!, default: t }))}
          </div>
          {/* One-click merge helper. Lets the operator close the
              fork by stamping `goto: <mergeTarget>` on every branch
              target step at once — without it, they'd have to open
              every branch's Flow panel and configure the goto
              manually. The helper walks each conditional rule's
              target plus the default target. Branch steps that
              already have their own conditional rules are skipped
              by the editor-level handler so we don't trash bespoke
              wiring. */}
          {onSetMergeTargetOnBranchEnds && (() => {
            const branchTargets = Array.from(new Set([
              ...(value?.rules || []).map(r => r.target).filter((t): t is number => typeof t === 'number' && t >= 0),
              ...(typeof value?.default === 'number' && value.default >= 0 ? [value.default] : []),
            ]));
            if (branchTargets.length < 2) return null;
            return (
              <div className="flex items-center gap-2 pt-1 border-t border-slate-200">
                <GitMerge className="h-3 w-3 text-violet-500" />
                <span className="text-[10px] text-slate-600">
                  Merge {branchTargets.length} branches at:
                </span>
                <select
                  value={mergeTargetPick === '' ? '' : String(mergeTargetPick)}
                  onChange={e => setMergeTargetPick(e.target.value === '' ? '' : parseInt(e.target.value, 10))}
                  className="text-[11px] border border-slate-200 rounded px-1.5 py-1 bg-white"
                >
                  <option value="">Select merge step…</option>
                  {stepLabels.map((label, i) => {
                    if (i === stepIndex) return null;
                    if (branchTargets.includes(i)) return null;
                    return <option key={i} value={i}>Step {i + 1} — {label}</option>;
                  })}
                  <option value={-1}>End of pipeline</option>
                </select>
                <button
                  type="button"
                  disabled={mergeTargetPick === ''}
                  onClick={() => {
                    if (mergeTargetPick === '') return;
                    onSetMergeTargetOnBranchEnds(branchTargets, mergeTargetPick as number);
                    setMergeTargetPick('');
                  }}
                  className="text-[10px] px-2 py-1 rounded bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed"
                  title="Sets goto: <merge target> on each branch step. Branches that already have conditional rules are left alone."
                >
                  Apply merge
                </button>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
