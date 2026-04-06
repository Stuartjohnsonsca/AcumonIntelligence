'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Plus, Trash2, Save, Loader2, GripVertical, ChevronUp, ChevronDown, Copy } from 'lucide-react';

interface TestAction {
  id: string;
  name: string;
  description: string;
  actionType: 'client' | 'ai' | 'human' | 'review';
  isReusable: boolean;
  isSystem?: boolean; // System-generated actions cannot be edited or deleted
}

interface Props {
  initialActions: TestAction[];
  isSuperAdmin?: boolean;
  systemActionDetails?: Record<string, any>;
}

const ACTION_TYPES = [
  { value: 'client', label: 'Client Action', color: 'bg-blue-100 text-blue-700' },
  { value: 'human', label: 'Human Action', color: 'bg-green-100 text-green-700' },
  { value: 'ai', label: 'AI Action', color: 'bg-purple-100 text-purple-700' },
  { value: 'review', label: 'Review/Conclude', color: 'bg-amber-100 text-amber-700' },
];

const PRESET_ACTIONS: Omit<TestAction, 'id'>[] = [
  { name: 'Request Data', description: 'Ask client for breakdown of data or supporting schedules', actionType: 'client', isReusable: true },
  { name: 'Select Sample', description: 'Select a representative sample from the population for testing', actionType: 'human', isReusable: true },
  { name: 'Request Evidence', description: 'Ask client for supporting evidence (contracts, invoices, etc.)', actionType: 'client', isReusable: true },
  { name: 'Inspect & Verify', description: 'Inspect documents and verify against the sample selection', actionType: 'human', isReusable: true },
  { name: 'AI Analysis', description: 'Use AI to analyse patterns, anomalies, or extract data', actionType: 'ai', isReusable: true },
  { name: 'Assess Error', description: 'Evaluate any errors or misstatements identified during testing', actionType: 'review', isReusable: true },
  { name: 'Conclude', description: 'Document the conclusion and whether the assertion is satisfied', actionType: 'review', isReusable: true },
  { name: 'Recalculate', description: 'Independently recalculate amounts to verify accuracy', actionType: 'human', isReusable: true },
  { name: 'Confirm Externally', description: 'Obtain independent confirmation from a third party', actionType: 'client', isReusable: true },
  { name: 'Analytical Review', description: 'Perform analytical procedures to identify unusual items', actionType: 'human', isReusable: true },
];

let counter = 0;
function uid() { return `ta_${Date.now()}_${++counter}`; }

export function TestActionsClient({ initialActions, isSuperAdmin, systemActionDetails = {} }: Props) {
  const [actions, setActions] = useState<TestAction[]>(
    initialActions.length > 0 ? initialActions : PRESET_ACTIONS.map(a => ({ ...a, id: uid() }))
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedSystemId, setExpandedSystemId] = useState<string | null>(null);
  const [systemDetails, setSystemDetails] = useState<Record<string, any>>({});

  function addAction() {
    setActions([...actions, { id: uid(), name: '', description: '', actionType: 'human', isReusable: true }]);
    setSaved(false);
  }

  function removeAction(id: string) {
    setActions(actions.filter(a => a.id !== id));
    setSaved(false);
  }

  function updateAction(id: string, field: keyof TestAction, value: any) {
    setActions(actions.map(a => a.id === id ? { ...a, [field]: value } : a));
    setSaved(false);
  }

  function moveAction(id: string, dir: -1 | 1) {
    const idx = actions.findIndex(a => a.id === id);
    if (idx < 0 || idx + dir < 0 || idx + dir >= actions.length) return;
    const copy = [...actions];
    [copy[idx], copy[idx + dir]] = [copy[idx + dir], copy[idx]];
    setActions(copy);
    setSaved(false);
  }

  function duplicateAction(id: string) {
    const source = actions.find(a => a.id === id);
    if (!source) return;
    const idx = actions.findIndex(a => a.id === id);
    const copy = { ...source, id: uid(), name: `${source.name} (Copy)` };
    const newActions = [...actions];
    newActions.splice(idx + 1, 0, copy);
    setActions(newActions);
    setSaved(false);
  }

  async function handleSave() {
    setSaving(true);
    try {
      await fetch('/api/methodology-admin/risk-tables', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tableType: 'test_actions', data: actions }),
      });
      setSaved(true);
    } finally { setSaving(false); }
  }

  function getColor(actionType: string) {
    return ACTION_TYPES.find(a => a.value === actionType)?.color || 'bg-slate-100 text-slate-600';
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Test Actions</h1>
          <p className="text-sm text-slate-500 mt-1">
            Define reusable test action steps. These can be assigned as steps within tests in the Test Bank.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={addAction} size="sm" variant="outline">
            <Plus className="h-4 w-4 mr-1" /> Add Action
          </Button>
          <Button onClick={handleSave} size="sm" disabled={saving}>
            {saving ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}
            {saved ? 'Saved' : 'Save'}
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        {actions.map((action, i) => {
          const isSystem = !!(action as any).isSystem;
          return (
          <div key={action.id} className={`border rounded-lg p-3 ${isSystem ? 'border-indigo-200 bg-indigo-50/20' : editingId === action.id ? 'border-blue-300 bg-blue-50/20' : 'border-slate-200'}`}>
            <div className="flex items-start gap-2">
              {/* Reorder */}
              <div className="flex flex-col gap-0.5 mt-1">
                {!isSystem && (
                  <>
                    <button onClick={() => moveAction(action.id, -1)} disabled={i === 0} className="p-0.5 hover:bg-slate-200 rounded disabled:opacity-20">
                      <ChevronUp className="h-3 w-3 text-slate-500" />
                    </button>
                    <GripVertical className="h-3 w-3 text-slate-300" />
                    <button onClick={() => moveAction(action.id, 1)} disabled={i === actions.length - 1} className="p-0.5 hover:bg-slate-200 rounded disabled:opacity-20">
                      <ChevronDown className="h-3 w-3 text-slate-500" />
                    </button>
                  </>
                )}
                {isSystem && <div className="w-3" />}
              </div>

              {/* Order number */}
              <span className="text-xs font-bold text-slate-400 mt-1.5 w-5">{i + 1}.</span>

              {/* Content */}
              <div className="flex-1 space-y-1.5">
                <div className="flex items-center gap-2">
                  {isSystem ? (
                    <div className="flex-1 flex items-center gap-2">
                      <span className="text-sm font-medium text-slate-800">{action.name}</span>
                      <span className="text-[8px] px-1.5 py-0.5 bg-indigo-100 text-indigo-700 rounded-full font-medium">System</span>
                    </div>
                  ) : (
                    <input
                      type="text"
                      value={action.name}
                      onChange={e => updateAction(action.id, 'name', e.target.value)}
                      onFocus={() => setEditingId(action.id)}
                      onBlur={() => setEditingId(null)}
                      placeholder="Action name (e.g. Select Sample)"
                      className="flex-1 text-sm font-medium border rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
                    />
                  )}
                  {isSystem ? (
                    <span className={`text-xs border rounded px-2 py-1 font-medium ${getColor(action.actionType)}`}>
                      {ACTION_TYPES.find(t => t.value === action.actionType)?.label || action.actionType}
                    </span>
                  ) : (
                    <select
                      value={action.actionType}
                      onChange={e => updateAction(action.id, 'actionType', e.target.value)}
                      className={`text-xs border rounded px-2 py-1 font-medium ${getColor(action.actionType)}`}
                    >
                      {ACTION_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  )}
                </div>
                {isSystem ? (
                  <p className="text-xs text-slate-500 px-0.5">{action.description}</p>
                ) : (
                  <input
                    type="text"
                    value={action.description}
                    onChange={e => updateAction(action.id, 'description', e.target.value)}
                    placeholder="Description of what this action involves..."
                    className="w-full text-xs border rounded px-2 py-1 text-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                )}

                {/* Expandable details for system actions */}
                {isSystem && (
                  <button onClick={() => setExpandedSystemId(expandedSystemId === action.id ? null : action.id)}
                    className="text-[10px] text-indigo-600 hover:text-indigo-800 font-medium mt-1">
                    {expandedSystemId === action.id ? '▼ Hide Details' : '▶ View Details'}
                  </button>
                )}
              </div>

              {/* Actions — not shown for system actions */}
              {!isSystem && (
                <div className="flex items-center gap-0.5 mt-1">
                  <button onClick={() => duplicateAction(action.id)} title="Duplicate" className="p-1 hover:bg-slate-100 rounded">
                    <Copy className="h-3 w-3 text-slate-400" />
                  </button>
                  <button onClick={() => removeAction(action.id)} title="Remove" className="p-1 hover:bg-red-50 rounded">
                    <Trash2 className="h-3 w-3 text-red-400" />
                  </button>
                </div>
              )}
            </div>

            {/* Expanded system action details */}
            {isSystem && expandedSystemId === action.id && (() => {
              // Map system action IDs to test type codes
              const codeMap: Record<string, string> = { sys_fetch_evidence: 'fetch_evidence_accounting', sys_large_unusual: 'large_unusual_items' };
              const details = systemActionDetails[codeMap[action.id] || ''];
              const execDef = details?.executionDef || {};
              return (
                <div className="mt-3 border-t border-indigo-200 pt-3 space-y-3">
                  {/* Execution Definition */}
                  {execDef.description && (
                    <div>
                      <div className="text-[9px] font-bold text-indigo-600 uppercase mb-1">How It Works</div>
                      <p className="text-xs text-slate-600 bg-white rounded border border-indigo-100 px-3 py-2">{execDef.description}</p>
                    </div>
                  )}

                  {/* Steps (for multi-step actions like Large & Unusual) */}
                  {execDef.steps && (
                    <div>
                      <div className="text-[9px] font-bold text-indigo-600 uppercase mb-1">Steps</div>
                      <div className="space-y-1.5">
                        {execDef.steps.map((step: any, si: number) => (
                          <div key={si} className="flex gap-2 bg-white rounded border border-indigo-100 px-3 py-2">
                            <span className="text-[10px] font-bold text-indigo-500 shrink-0 mt-0.5">{step.step || si + 1}.</span>
                            <div className="flex-1">
                              <div className="text-xs font-medium text-slate-700">{step.label}</div>
                              <div className="text-[10px] text-slate-500 mt-0.5">{step.description}</div>
                              {step.inputType && <span className="text-[8px] px-1 py-0 bg-purple-100 text-purple-600 rounded mt-1 inline-block">{step.inputType}</span>}
                              {step.type && <span className="text-[8px] px-1 py-0 bg-amber-100 text-amber-600 rounded mt-1 ml-1 inline-block">{step.type}: {step.waitFor}</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Inputs */}
                  {execDef.inputs && (
                    <div>
                      <div className="text-[9px] font-bold text-indigo-600 uppercase mb-1">Inputs</div>
                      <div className="grid grid-cols-2 gap-1">
                        {execDef.inputs.map((inp: any, ii: number) => (
                          <div key={ii} className="text-[10px] bg-white rounded border border-slate-200 px-2 py-1">
                            <span className="font-medium text-slate-700">{inp.label || inp.key}</span>
                            {inp.source && <span className="text-slate-400 ml-1">({inp.source})</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Flag Categories (for Large & Unusual) */}
                  {execDef.flagCategories && (
                    <div>
                      <div className="text-[9px] font-bold text-indigo-600 uppercase mb-1">Anomaly Detection Categories ({execDef.flagCategories.length})</div>
                      <div className="flex flex-wrap gap-1">
                        {execDef.flagCategories.map((cat: string, ci: number) => (
                          <span key={ci} className="text-[9px] px-1.5 py-0.5 bg-white border border-slate-200 rounded text-slate-600">{cat}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Portal Fallback Template */}
                  {execDef.portalFallbackTemplate && (
                    <div>
                      <div className="text-[9px] font-bold text-indigo-600 uppercase mb-1">Portal Fallback Template</div>
                      <div className="bg-white rounded border border-slate-200 px-3 py-2 text-[10px]">
                        <div><span className="text-slate-400">Subject:</span> <span className="text-slate-700">{execDef.portalFallbackTemplate.subject}</span></div>
                        <div className="mt-1"><span className="text-slate-400">Message:</span></div>
                        <pre className="text-slate-600 whitespace-pre-wrap mt-0.5">{execDef.portalFallbackTemplate.message}</pre>
                      </div>
                    </div>
                  )}

                  {/* Evidence Types */}
                  {execDef.evidenceTypes && (
                    <div>
                      <div className="text-[9px] font-bold text-indigo-600 uppercase mb-1">Accepted Evidence Types</div>
                      <div className="flex gap-1">
                        {execDef.evidenceTypes.map((et: string, ei: number) => (
                          <span key={ei} className="text-[9px] px-1.5 py-0.5 bg-green-50 border border-green-200 rounded text-green-700">{et}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Input Type / Output Format */}
                  <div className="flex gap-4 text-[10px]">
                    {execDef.inputType && <div><span className="text-slate-400">Input Type:</span> <span className="font-mono text-slate-700">{execDef.inputType}</span></div>}
                    {execDef.outputFormat && <div><span className="text-slate-400">Output Format:</span> <span className="font-mono text-slate-700">{execDef.outputFormat}</span></div>}
                  </div>
                </div>
              );
            })()}
          </div>
          );
        })}
      </div>

      {actions.length === 0 && (
        <div className="text-center py-12 border rounded-lg">
          <p className="text-sm text-slate-400">No test actions defined yet.</p>
          <button onClick={addAction} className="mt-2 text-xs text-blue-600 hover:text-blue-800">+ Add your first action</button>
        </div>
      )}
    </div>
  );
}
