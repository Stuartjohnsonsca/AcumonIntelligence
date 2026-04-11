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

// Pipeline Action Catalog types — mirrors the SYSTEM_ACTIONS shape from
// lib/action-seed.ts. Rendered read-only as a defensible catalogue of
// every code-shipped action-pipeline action available to Methodology Admin
// when building tests in the Action Pipeline Editor.
interface PipelineActionInputField {
  code: string;
  label: string;
  type: string;
  required?: boolean;
  source?: string;
  autoMapFrom?: string;
  defaultValue?: any;
  description?: string;
  group?: string;
  options?: { value: string; label: string }[];
}
interface PipelineActionOutputField {
  code: string;
  label: string;
  type: string;
  description?: string;
}
export interface PipelineActionCatalogEntry {
  code: string;
  name: string;
  description: string;
  category: string;
  handlerName: string | null;
  icon: string | null;
  color: string | null;
  inputSchema: PipelineActionInputField[];
  outputSchema: PipelineActionOutputField[];
}

interface Props {
  initialActions: TestAction[];
  isSuperAdmin?: boolean;
  systemActionDetails?: Record<string, any>;
  pipelineActionsCatalog?: PipelineActionCatalogEntry[];
  /**
   * Feature flag. When false, the legacy System Test Actions + User Test
   * Actions sections (Option A — flow-chart driven) are hidden from the
   * UI. The new Pipeline Actions Catalog (Option C) remains visible.
   * Driven by the ENABLE_LEGACY_TEST_ACTIONS env var on the server side.
   */
  showLegacyTestActions?: boolean;
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

export function TestActionsClient({ initialActions, isSuperAdmin, systemActionDetails = {}, pipelineActionsCatalog = [], showLegacyTestActions = false }: Props) {
  const [actions, setActions] = useState<TestAction[]>(
    initialActions.length > 0 ? initialActions : PRESET_ACTIONS.map(a => ({ ...a, id: uid() }))
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedSystemId, setExpandedSystemId] = useState<string | null>(null);
  const [systemDetails, setSystemDetails] = useState<Record<string, any>>({});
  // Expanded pipeline-action catalog entry (separate from legacy system
  // test action expansion so both lists can stay open independently).
  const [expandedPipelineCode, setExpandedPipelineCode] = useState<string | null>(null);

  function addAction() {
    setActions([...actions, { id: uid(), name: '', description: '', actionType: 'human', isReusable: true }]);
    setSaved(false);
  }

  function removeAction(id: string) {
    const action = actions.find(a => a.id === id);
    if ((action as any)?.isSystem) return; // Cannot remove system actions
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
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Test Actions</h1>
        <p className="text-sm text-slate-500 mt-1">
          Catalogue of every reusable action the system can execute inside an audit test. Use the Action Pipeline Editor in Test Bank to chain these into a specific test.
        </p>
      </div>

      {/*
        Pipeline Actions Catalog (Option C) — authoritative list of every
        code-shipped action-pipeline action, generated from SYSTEM_ACTIONS
        in lib/action-seed.ts. Read-only. Expandable detail for each entry
        shows handler name, every input field with its source binding and
        default, and every output field. This is the defensible record
        of "what the system can do" for regulator review.
      */}
      {pipelineActionsCatalog.length > 0 && (
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-lg font-bold text-emerald-900">Pipeline Actions Catalog</h2>
            <span className="text-[9px] px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-full font-medium">{pipelineActionsCatalog.length} actions</span>
          </div>
          <p className="text-xs text-slate-500 mb-3">
            Every action the Action Pipeline system can run. Each entry lists its configurable inputs, auto-mapped context inputs, and outputs so you can see exactly what happens and how to wire it into a test. Click an entry to expand.
          </p>
          <div className="space-y-1.5">
            {pipelineActionsCatalog.map(entry => {
              const isOpen = expandedPipelineCode === entry.code;
              const userInputs = entry.inputSchema.filter(f => f.source !== 'auto');
              const autoInputs = entry.inputSchema.filter(f => f.source === 'auto');
              const categoryColour =
                entry.category === 'evidence' ? 'bg-blue-100 text-blue-700 border-blue-200' :
                entry.category === 'sampling' ? 'bg-amber-100 text-amber-700 border-amber-200' :
                entry.category === 'analysis' ? 'bg-purple-100 text-purple-700 border-purple-200' :
                entry.category === 'verification' ? 'bg-emerald-100 text-emerald-700 border-emerald-200' :
                entry.category === 'reporting' ? 'bg-slate-100 text-slate-700 border-slate-200' :
                'bg-slate-100 text-slate-700 border-slate-200';
              return (
                <div key={entry.code} className="border border-emerald-200 rounded bg-white">
                  <button
                    type="button"
                    onClick={() => setExpandedPipelineCode(isOpen ? null : entry.code)}
                    className="w-full text-left px-3 py-2 flex items-start gap-3 hover:bg-emerald-50/40"
                  >
                    <span className="text-[10px] text-emerald-600 mt-0.5 font-mono select-none">
                      {isOpen ? '▼' : '▶'}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-slate-800">{entry.name}</span>
                        <span className={`text-[9px] px-1.5 py-0.5 rounded border uppercase tracking-wide font-semibold ${categoryColour}`}>{entry.category}</span>
                        <code className="text-[10px] text-slate-400 font-mono">{entry.code}</code>
                        {!entry.handlerName && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-red-100 text-red-700 border border-red-200 font-semibold uppercase">No handler</span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{entry.description}</p>
                    </div>
                  </button>

                  {isOpen && (
                    <div className="border-t border-emerald-100 px-3 py-3 bg-emerald-50/30 space-y-3">
                      {/* Handler */}
                      <div>
                        <div className="text-[9px] font-bold text-emerald-700 uppercase mb-1">Handler</div>
                        <code className="text-xs bg-white border border-emerald-100 rounded px-2 py-1 text-slate-700 font-mono">{entry.handlerName || '— not wired —'}</code>
                      </div>

                      {/* Full description */}
                      <div>
                        <div className="text-[9px] font-bold text-emerald-700 uppercase mb-1">What it does</div>
                        <p className="text-xs text-slate-700 bg-white border border-emerald-100 rounded px-3 py-2 leading-relaxed whitespace-pre-wrap">{entry.description}</p>
                      </div>

                      {/* User inputs */}
                      {userInputs.length > 0 && (
                        <div>
                          <div className="text-[9px] font-bold text-emerald-700 uppercase mb-1">User-configurable inputs ({userInputs.length})</div>
                          <div className="space-y-1">
                            {userInputs.map(f => (
                              <div key={f.code} className="bg-white border border-emerald-100 rounded px-2 py-1.5">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-xs font-semibold text-slate-800">{f.label}</span>
                                  <code className="text-[10px] text-slate-400 font-mono">{f.code}</code>
                                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200 font-semibold uppercase">{f.type}</span>
                                  {f.required && <span className="text-[9px] px-1.5 py-0.5 rounded bg-red-100 text-red-700 font-semibold uppercase">Required</span>}
                                  {f.group && <span className="text-[9px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600 border border-indigo-100">{f.group}</span>}
                                </div>
                                {f.description && <p className="text-[10px] text-slate-500 mt-0.5">{f.description}</p>}
                                {f.defaultValue !== undefined && (
                                  <p className="text-[10px] text-slate-400 mt-0.5">
                                    Default: <code className="font-mono text-slate-600">{typeof f.defaultValue === 'string' ? f.defaultValue : JSON.stringify(f.defaultValue)}</code>
                                  </p>
                                )}
                                {f.options && f.options.length > 0 && (
                                  <div className="mt-1 flex flex-wrap gap-1">
                                    {f.options.map(o => (
                                      <span key={o.value} className="text-[9px] px-1 py-0.5 bg-slate-50 border border-slate-200 rounded text-slate-600">
                                        {o.label}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Auto-mapped inputs */}
                      {autoInputs.length > 0 && (
                        <div>
                          <div className="text-[9px] font-bold text-emerald-700 uppercase mb-1">Auto-mapped context ({autoInputs.length})</div>
                          <div className="space-y-1">
                            {autoInputs.map(f => (
                              <div key={f.code} className="bg-white border border-emerald-100 rounded px-2 py-1 flex items-center gap-2 flex-wrap">
                                <span className="text-xs text-slate-700">{f.label}</span>
                                <code className="text-[10px] text-slate-400 font-mono">{f.code}</code>
                                {f.autoMapFrom && (
                                  <code className="text-[10px] bg-indigo-50 border border-indigo-100 rounded px-1 py-0.5 text-indigo-700 font-mono">← {f.autoMapFrom}</code>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Outputs */}
                      {entry.outputSchema.length > 0 && (
                        <div>
                          <div className="text-[9px] font-bold text-emerald-700 uppercase mb-1">Outputs ({entry.outputSchema.length})</div>
                          <div className="space-y-1">
                            {entry.outputSchema.map(f => (
                              <div key={f.code} className="bg-white border border-emerald-100 rounded px-2 py-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-xs font-semibold text-slate-800">{f.label}</span>
                                  <code className="text-[10px] text-slate-400 font-mono">{f.code}</code>
                                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200 font-semibold uppercase">{f.type}</span>
                                </div>
                                {f.description && <p className="text-[10px] text-slate-500 mt-0.5">{f.description}</p>}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/*
        Legacy sections (Option A) — flow-chart-era System Test Actions and
        User Test Actions. Hidden unless ENABLE_LEGACY_TEST_ACTIONS is set
        on the server. Kept in place so existing flow-chart tests still
        load their action library, but no longer surfaced to regular
        Methodology Admin by default.
      */}
      {showLegacyTestActions && (
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-lg font-bold text-slate-700">Legacy Test Actions</h2>
            <p className="text-xs text-slate-500 mt-1">
              Flow-chart-era action library (Option A). Still used by existing flow-chart tests. Hide by unsetting ENABLE_LEGACY_TEST_ACTIONS.
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
      )}

      {/* System Test Actions (legacy) */}
      {showLegacyTestActions && actions.some(a => (a as any).isSystem) && (
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-lg font-bold text-indigo-900">System Test Actions</h2>
            <span className="text-[9px] px-2 py-0.5 bg-indigo-100 text-indigo-600 rounded-full font-medium">Built-in</span>
          </div>
          <p className="text-xs text-slate-500 mb-3">These actions are embedded in the system and cannot be modified. Click "View Details" to see how each one works.</p>
          <div className="space-y-2">
            {actions.filter(a => (a as any).isSystem).map((action, i) => {
              const isSystem = true;
              return <SystemActionCard key={action.id} action={action} index={i} expandedSystemId={expandedSystemId} setExpandedSystemId={setExpandedSystemId} systemActionDetails={systemActionDetails} getColor={getColor} />;
            })}
          </div>
        </div>
      )}

      {/* User Test Actions (legacy) */}
      {showLegacyTestActions && (
      <div className="mb-3">
        <h2 className="text-lg font-bold text-slate-900">User Test Actions</h2>
        <p className="text-xs text-slate-500 mt-1">Custom actions you can edit, reorder, and assign to tests.</p>
      </div>
      )}
      {showLegacyTestActions && (
      <div className="space-y-2">
        {actions.filter(a => !(a as any).isSystem).map((action, i) => {
          const isSystem = false;
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

                  {/* Actual Test Flow Steps (from the test definition) */}
                  {details?.flowSteps?.length > 0 && (
                    <div>
                      <div className="text-[9px] font-bold text-indigo-600 uppercase mb-1">
                        Test Flow: {details.testName || 'N/A'}
                      </div>
                      {details.testDescription && <p className="text-[10px] text-slate-500 mb-2">{details.testDescription}</p>}
                      <div className="space-y-1.5">
                        {details.flowSteps.map((step: any, si: number) => (
                          <div key={si} className="bg-white rounded border border-indigo-100 px-3 py-2 space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-bold text-indigo-500 shrink-0">{si + 1}.</span>
                              <span className="text-xs font-medium text-slate-700">{step.label}</span>
                              {step.type === 'wait' && <span className="text-[8px] px-1 py-0 bg-orange-100 text-orange-600 rounded">Pauses — waits for: {step.waitFor}</span>}
                              {step.type === 'forEach' && <span className="text-[8px] px-1 py-0 bg-blue-100 text-blue-600 rounded">Loop over: {step.collection}</span>}
                              {step.inputType && <span className="text-[8px] px-1 py-0 bg-purple-100 text-purple-600 rounded">{step.inputType}</span>}
                              {step.assignee && <span className="text-[8px] px-1 py-0 bg-slate-100 text-slate-600 rounded">{step.assignee}</span>}
                            </div>
                            {/* What this step does */}
                            <div className="text-[10px] text-slate-500 pl-5">
                              {step.inputType === 'accounting_extract_or_bank' && '→ Tries to extract transactions from connected accounting system (Xero). If no connection, falls back to previously extracted bank statement data.'}
                              {step.inputType === 'accounting_extract' && '→ Extracts transactions from the connected accounting system (Xero) for the audit period.'}
                              {step.inputType === 'accounting_extract_cutoff' && '→ Extracts transactions from Xero for the 4-week cut-off window (±14 days from period end).'}
                              {step.inputType === 'analyse_large_unusual' && '→ Programmatic analysis: flags items above PM, round numbers, weekend transactions, related party keywords, reversals, foreign transfers, and 11 more categories. Full dataset shown with flags highlighted.'}
                              {step.inputType === 'analyse_cut_off' && '→ Filters transactions in the cut-off window, flags items above CT, determines if recorded in correct period.'}
                              {step.inputType === 'compare_bank_to_tb' && '→ Extracts closing balances from bank data, compares to TB figures, calculates differences.'}
                              {step.inputType === 'fetch_evidence_or_portal' && '→ Tries to retrieve invoice from Xero by reference number. If not found or not connected, creates a portal request asking the client to upload evidence.'}
                              {step.inputType === 'require_prior_evidence' && '→ Checks if required evidence (e.g. bank data) has already been extracted and stored.'}
                              {step.waitFor === 'sampling' && '→ Shows the full population to the auditor. Auditor reviews flagged items and selects which to investigate. This is judgemental selection, not statistical sampling.'}
                            </div>
                            {/* Portal template details */}
                            {step.portalTemplate && (
                              <div className="pl-5 mt-1 border-l-2 border-indigo-200">
                                <div className="text-[9px] text-indigo-500 font-medium">Portal message to client:</div>
                                <div className="text-[9px] text-slate-600 mt-0.5">
                                  <span className="text-slate-400">Subject:</span> {step.portalTemplate.subject}
                                </div>
                                <pre className="text-[9px] text-slate-500 whitespace-pre-wrap mt-0.5">{step.portalTemplate.message}</pre>
                              </div>
                            )}
                            {/* AI instruction */}
                            {step.systemInstruction && (
                              <div className="pl-5 mt-1 border-l-2 border-purple-200">
                                <div className="text-[9px] text-purple-500 font-medium">AI instruction:</div>
                                <p className="text-[9px] text-slate-500 mt-0.5">{step.systemInstruction}</p>
                              </div>
                            )}
                            {/* Evidence types */}
                            {step.evidenceTypes && (
                              <div className="pl-5 flex gap-1 mt-1">
                                <span className="text-[8px] text-slate-400">Accepts:</span>
                                {step.evidenceTypes.map((et: string, ei: number) => (
                                  <span key={ei} className="text-[8px] px-1 py-0 bg-green-50 border border-green-200 rounded text-green-700">{et}</span>
                                ))}
                              </div>
                            )}
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
      )}

      {showLegacyTestActions && actions.filter(a => !(a as any).isSystem).length === 0 && (
        <div className="text-center py-12 border rounded-lg">
          <p className="text-sm text-slate-400">No user test actions defined yet.</p>
          <button onClick={addAction} className="mt-2 text-xs text-blue-600 hover:text-blue-800">+ Add your first action</button>
        </div>
      )}
    </div>
  );
}

// ─── System Action Card (read-only with expandable details) ───

function SystemActionCard({ action, index, expandedSystemId, setExpandedSystemId, systemActionDetails, getColor }: {
  action: any; index: number; expandedSystemId: string | null; setExpandedSystemId: (id: string | null) => void;
  systemActionDetails: Record<string, any>; getColor: (t: string) => string;
}) {
  const ACTION_TYPES_MAP: Record<string, string> = { client: 'Client Action', human: 'Human Action', ai: 'AI Action', review: 'Review/Conclude' };
  const codeMap: Record<string, string> = { sys_fetch_evidence: 'fetch_evidence_accounting', sys_large_unusual: 'large_unusual_items' };
  const details = systemActionDetails[codeMap[action.id] || ''];
  const execDef = details?.executionDef || {};
  const isExpanded = expandedSystemId === action.id;

  return (
    <div className="border border-indigo-200 rounded-lg bg-indigo-50/20 overflow-hidden">
      <div className="px-4 py-3">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-bold text-slate-400">{index + 1}.</span>
          <span className="text-sm font-semibold text-slate-800">{action.name}</span>
          <span className="text-[8px] px-1.5 py-0.5 bg-indigo-100 text-indigo-700 rounded-full font-medium">System</span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${getColor(action.actionType)}`}>
            {ACTION_TYPES_MAP[action.actionType] || action.actionType}
          </span>
        </div>
        <p className="text-xs text-slate-500">{action.description}</p>
        <button onClick={() => setExpandedSystemId(isExpanded ? null : action.id)}
          className="text-[10px] text-indigo-600 hover:text-indigo-800 font-medium mt-2">
          {isExpanded ? '▼ Hide Details' : '▶ View Details'}
        </button>
      </div>

      {isExpanded && (
        <div className="border-t border-indigo-200 px-4 py-3 space-y-3 bg-white/50">
          {/* How it works */}
          {execDef.description && (
            <div>
              <div className="text-[9px] font-bold text-indigo-600 uppercase mb-1">How It Works</div>
              <p className="text-xs text-slate-600 bg-white rounded border border-indigo-100 px-3 py-2">{execDef.description}</p>
            </div>
          )}

          {/* Actual flow steps from the test */}
          {details?.flowSteps?.length > 0 && (
            <div>
              <div className="text-[9px] font-bold text-indigo-600 uppercase mb-1">
                Test Flow: {details.testName || 'N/A'}
              </div>
              {details.testDescription && <p className="text-[10px] text-slate-500 mb-2">{details.testDescription}</p>}
              <div className="space-y-1.5">
                {details.flowSteps.map((step: any, si: number) => (
                  <div key={si} className="bg-white rounded border border-indigo-100 px-3 py-2 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold text-indigo-500 shrink-0">{si + 1}.</span>
                      <span className="text-xs font-medium text-slate-700">{step.label}</span>
                      {step.type === 'wait' && <span className="text-[8px] px-1 py-0 bg-orange-100 text-orange-600 rounded">Pauses — waits for: {step.waitFor}</span>}
                      {step.type === 'forEach' && <span className="text-[8px] px-1 py-0 bg-blue-100 text-blue-600 rounded">Loop over: {step.collection}</span>}
                      {step.inputType && <span className="text-[8px] px-1 py-0 bg-purple-100 text-purple-600 rounded">{step.inputType}</span>}
                      {step.assignee && <span className="text-[8px] px-1 py-0 bg-slate-100 text-slate-600 rounded">{step.assignee}</span>}
                    </div>
                    <div className="text-[10px] text-slate-500 pl-5">
                      {step.inputType === 'accounting_extract_or_bank' && '→ Tries to extract transactions from connected accounting system (Xero). If no connection, falls back to previously extracted bank statement data.'}
                      {step.inputType === 'accounting_extract' && '→ Extracts transactions from the connected accounting system (Xero) for the audit period.'}
                      {step.inputType === 'accounting_extract_cutoff' && '→ Extracts transactions from Xero for the 4-week cut-off window (±14 days from period end).'}
                      {step.inputType === 'analyse_large_unusual' && '→ Programmatic analysis: flags items above PM, round numbers, weekend transactions, related party keywords, reversals, foreign transfers, and 11 more categories. Full dataset shown with flags highlighted.'}
                      {step.inputType === 'fetch_evidence_or_portal' && '→ Tries to retrieve invoice from Xero by reference number. If not found or not connected, creates a portal request asking the client to upload evidence.'}
                      {step.inputType === 'require_prior_evidence' && '→ Checks if required evidence (e.g. bank data) has already been extracted and stored.'}
                      {step.waitFor === 'sampling' && '→ Shows the full population to the auditor. Auditor reviews flagged items and selects which to investigate. This is judgemental selection, not statistical sampling.'}
                      {!step.inputType && !step.waitFor && step.assignee === 'ai' && '→ AI reviews the evidence and assesses each item.'}
                    </div>
                    {step.portalTemplate && (
                      <div className="pl-5 mt-1 border-l-2 border-indigo-200">
                        <div className="text-[9px] text-indigo-500 font-medium">Portal message to client:</div>
                        <div className="text-[9px] text-slate-600 mt-0.5"><span className="text-slate-400">Subject:</span> {step.portalTemplate.subject}</div>
                        <pre className="text-[9px] text-slate-500 whitespace-pre-wrap mt-0.5">{step.portalTemplate.message}</pre>
                      </div>
                    )}
                    {step.systemInstruction && (
                      <div className="pl-5 mt-1 border-l-2 border-purple-200">
                        <div className="text-[9px] text-purple-500 font-medium">AI instruction:</div>
                        <p className="text-[9px] text-slate-500 mt-0.5">{step.systemInstruction}</p>
                      </div>
                    )}
                    {step.evidenceTypes && (
                      <div className="pl-5 flex gap-1 mt-1">
                        <span className="text-[8px] text-slate-400">Accepts:</span>
                        {step.evidenceTypes.map((et: string, ei: number) => (
                          <span key={ei} className="text-[8px] px-1 py-0 bg-green-50 border border-green-200 rounded text-green-700">{et}</span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Flag categories */}
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
        </div>
      )}
    </div>
  );
}
