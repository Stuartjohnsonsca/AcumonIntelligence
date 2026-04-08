'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Plus, X, Save, Loader2, GripVertical, ChevronDown, ChevronRight, Trash2, ArrowDown } from 'lucide-react';
import { ActionCatalog, getActionIcon, type ActionDefinitionItem } from './ActionCatalog';
import { ActionInputPanel } from './ActionInputPanel';
import { getCategoryStyle } from '@/lib/action-registry';
import type { InputFieldDef, OutputFieldDef } from '@/lib/action-registry';

interface PipelineStep {
  id: string;
  actionDefinitionId: string;
  actionDefinition: ActionDefinitionItem;
  stepOrder: number;
  inputBindings: Record<string, any>;
  isExpanded: boolean;
}

interface Props {
  testId: string;
  testDescription: string;
  initialSteps?: { id: string; actionDefinitionId: string; stepOrder: number; inputBindings: Record<string, any>; actionDefinition: ActionDefinitionItem }[];
  onSave: (steps: { actionDefinitionId: string; stepOrder: number; inputBindings: Record<string, any> }[]) => Promise<void>;
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
      isExpanded: i === 0,
    }))
  );
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [insertAfterIndex, setInsertAfterIndex] = useState(-1); // -1 = append at end
  const [saving, setSaving] = useState(false);
  const [actions, setActions] = useState<ActionDefinitionItem[]>([]);
  const [loadingActions, setLoadingActions] = useState(true);

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
          const savedSteps = stepsData.test?.actionSteps || [];
          if (savedSteps.length > 0 && actionsList.length > 0) {
            setSteps(savedSteps.map((s: any, i: number) => {
              const actionDef = s.actionDefinition || actionsList.find((a: ActionDefinitionItem) => a.id === s.actionDefinitionId);
              return {
                id: s.id || uid(),
                actionDefinitionId: s.actionDefinitionId,
                actionDefinition: actionDef || { id: s.actionDefinitionId, code: '', name: 'Unknown Action', description: null, category: 'general', icon: null, color: null, isSystem: false, inputSchema: [], outputSchema: [] },
                stepOrder: i,
                inputBindings: s.inputBindings || {},
                isExpanded: i === 0,
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
    const newStep: PipelineStep = {
      id: uid(),
      actionDefinitionId: action.id,
      actionDefinition: action,
      stepOrder: 0,
      inputBindings: buildDefaultBindings(action.inputSchema),
      isExpanded: true,
    };

    setSteps(prev => {
      const idx = insertAfterIndex >= 0 ? insertAfterIndex + 1 : prev.length;
      const updated = [...prev];
      updated.splice(idx, 0, newStep);
      return updated.map((s, i) => ({ ...s, stepOrder: i }));
    });
    setCatalogOpen(false);
    setInsertAfterIndex(-1);
  }, [insertAfterIndex]);

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

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(steps.map(s => ({
        actionDefinitionId: s.actionDefinitionId,
        stepOrder: s.stepOrder,
        inputBindings: s.inputBindings,
      })));
    } finally {
      setSaving(false);
    }
  };

  const getPreviousOutputs = (stepIndex: number): OutputFieldDef[] => {
    if (stepIndex <= 0) return [];
    return steps[stepIndex - 1]?.actionDefinition?.outputSchema || [];
  };

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
              {steps.length === 0 && (
                <div className="text-center py-12">
                  <p className="text-slate-400 text-sm mb-4">No actions in this pipeline yet.</p>
                  <Button onClick={() => { setInsertAfterIndex(-1); setCatalogOpen(true); }} size="sm" variant="outline" className="text-xs">
                    <Plus className="h-3.5 w-3.5 mr-1" />Add First Action
                  </Button>
                </div>
              )}

              {steps.map((step, idx) => {
                const Icon = getActionIcon(step.actionDefinition.icon);
                const userInputs = step.actionDefinition.inputSchema.filter(f => f.source === 'user');
                const autoInputs = step.actionDefinition.inputSchema.filter(f => f.source === 'auto');
                const prevOutputs = getPreviousOutputs(idx);

                return (
                  <div key={step.id}>
                    {/* Step Card */}
                    <div className="border border-slate-200 rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-shadow">
                      {/* Step Header */}
                      <div
                        className="flex items-center gap-3 px-4 py-3 bg-white cursor-pointer"
                        onClick={() => toggleExpand(step.id)}
                      >
                        <div className="flex items-center gap-1 text-slate-300 cursor-grab">
                          <GripVertical className="h-4 w-4" />
                        </div>
                        <div className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center text-[10px] font-bold text-slate-500 shrink-0">
                          {idx + 1}
                        </div>
                        <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 bg-slate-100" style={{ color: step.actionDefinition.color || '#64748b' }}>
                          {Icon && <Icon className="h-3.5 w-3.5 text-current" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-slate-800">{step.actionDefinition.name}</span>
                            <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${getCategoryStyle(step.actionDefinition.category)}`}>
                              {step.actionDefinition.category}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          {step.isExpanded ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
                          <button
                            onClick={e => { e.stopPropagation(); handleRemoveStep(step.id); }}
                            className="p-1 hover:bg-red-50 rounded text-slate-300 hover:text-red-500 transition-colors"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Step Body (expanded) */}
                      {step.isExpanded && (
                        <div className="border-t px-4 py-3 bg-slate-50/50 space-y-4">
                          {/* User Inputs */}
                          {userInputs.length > 0 && (
                            <div>
                              <h5 className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Configuration</h5>
                              <div className="space-y-3">
                                {userInputs.map(field => (
                                  <ActionInputPanel
                                    key={field.code}
                                    field={field}
                                    value={step.inputBindings[field.code]}
                                    onChange={(code, val) => handleInputChange(step.id, code, val)}
                                    previousOutputs={prevOutputs}
                                    stepIndex={idx}
                                  />
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Auto-mapped Inputs */}
                          {autoInputs.length > 0 && (
                            <div>
                              <h5 className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Auto-Mapped Inputs</h5>
                              <div className="space-y-2">
                                {autoInputs.map(field => (
                                  <ActionInputPanel
                                    key={field.code}
                                    field={field}
                                    value={step.inputBindings[field.code] ?? field.autoMapFrom}
                                    onChange={(code, val) => handleInputChange(step.id, code, val)}
                                    previousOutputs={prevOutputs}
                                    stepIndex={idx}
                                  />
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Outputs Preview */}
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
                        </div>
                      )}
                    </div>

                    {/* Connector + Insert Button */}
                    <div className="flex flex-col items-center py-2">
                      <div className="w-px h-4 bg-slate-200" />
                      <button
                        onClick={() => { setInsertAfterIndex(idx); setCatalogOpen(true); }}
                        className="w-6 h-6 rounded-full border-2 border-dashed border-slate-200 flex items-center justify-center text-slate-300 hover:border-blue-300 hover:text-blue-400 hover:bg-blue-50 transition-colors"
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                      {idx < steps.length - 1 && <div className="w-px h-4 bg-slate-200" />}
                    </div>
                  </div>
                );
              })}

              {/* Add at End */}
              {steps.length > 0 && (
                <div className="text-center">
                  <Button onClick={() => { setInsertAfterIndex(-1); setCatalogOpen(true); }} size="sm" variant="outline" className="text-xs">
                    <Plus className="h-3.5 w-3.5 mr-1" />Add Action
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Action Catalog Modal */}
      {catalogOpen && (
        <ActionCatalog
          actions={actions}
          onSelect={handleAddAction}
          onClose={() => { setCatalogOpen(false); setInsertAfterIndex(-1); }}
        />
      )}
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
