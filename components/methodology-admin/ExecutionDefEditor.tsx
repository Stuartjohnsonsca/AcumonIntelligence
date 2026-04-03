'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Plus, X, ChevronDown, ChevronRight, Info, Save, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

// ─── Types ───
interface InputDef {
  key: string;
  label: string;
  description: string;
}

interface Props {
  actionType: string;
  executionDef: any | null;
  onChange: (def: any) => void;
}

const EVIDENCE_TYPES = [
  'invoice', 'payment', 'contract', 'supplier_confirmation',
  'debtor_confirmation', 'intercompany', 'director_matters', 'bank_statement',
];

const TOOLS = [
  { value: 'sample_calculator', label: 'Sample Calculator' },
  { value: 'tb_reference', label: 'Trial Balance Reference' },
  { value: 'evidence_viewer', label: 'Evidence Viewer' },
  { value: 'workpaper_editor', label: 'Workpaper Editor' },
  { value: 'data_entry_form', label: 'Data Entry Form' },
];

// ─── Known input sources ───
const KNOWN_INPUTS: { group: string; items: { key: string; label: string; binding?: string }[] }[] = [
  {
    group: 'Auto-Linked (from previous node)',
    items: [
      { key: 'previous_output', label: 'Previous Node Output (auto)', binding: 'auto' },
      { key: 'portal_response_file', label: 'Client Portal Upload (auto from portal response)', binding: 'auto:portal_file' },
      { key: 'portal_response_text', label: 'Client Portal Text Response (auto)', binding: 'auto:portal_text' },
      { key: 'ai_previous_result', label: 'AI Result from Previous Step (auto)', binding: 'auto:ai_result' },
      { key: 'verified_data', label: 'Verified/Passed Data from Previous Step (auto)', binding: 'auto:pass_through' },
    ],
  },
  {
    group: 'From Specific Upstream Node',
    items: [
      { key: 'uploaded_file', label: 'Client Uploaded File' },
      { key: 'request_description', label: 'Request Message Sent to Client' },
      { key: 'client_response', label: 'Client Text Response' },
      { key: 'ai_result', label: 'AI Analysis Result' },
      { key: 'ai_pass_fail', label: 'AI Pass/Fail Decision' },
      { key: 'sample_selection', label: 'Selected Sample Items' },
      { key: 'team_output', label: 'Team Member Output/Notes' },
    ],
  },
  {
    group: 'Trial Balance',
    items: [
      { key: 'tb_balance', label: 'TB Current Year Balance' },
      { key: 'tb_prior_year', label: 'TB Prior Year Balance' },
      { key: 'tb_variance', label: 'TB Variance (CY vs PY)' },
      { key: 'tb_variance_pct', label: 'TB Variance %' },
      { key: 'tb_account_code', label: 'TB Account Code' },
      { key: 'tb_description', label: 'TB Account Description' },
      { key: 'tb_fs_note', label: 'TB FS Note' },
      { key: 'tb_fs_level', label: 'TB FS Level' },
      { key: 'tb_fs_statement', label: 'TB FS Statement' },
    ],
  },
  {
    group: 'Materiality',
    items: [
      { key: 'materiality', label: 'Overall Materiality' },
      { key: 'performance_materiality', label: 'Performance Materiality' },
      { key: 'clearly_trivial', label: 'Clearly Trivial Threshold' },
    ],
  },
  {
    group: 'Risk Assessment (RMM)',
    items: [
      { key: 'rmm_risk_level', label: 'Inherent Risk Level' },
      { key: 'rmm_assertions', label: 'Assertions for Line Item' },
      { key: 'rmm_final_assessment', label: 'Final Risk Assessment' },
      { key: 'rmm_control_risk', label: 'Control Risk Level' },
      { key: 'rmm_nature', label: 'Nature / Risk Identified' },
    ],
  },
  {
    group: 'PAR (Preliminary Analytical Review)',
    items: [
      { key: 'par_current_year', label: 'PAR Current Year Amount' },
      { key: 'par_prior_year', label: 'PAR Prior Year Amount' },
      { key: 'par_variance', label: 'PAR Absolute Variance' },
      { key: 'par_variance_pct', label: 'PAR Variance %' },
      { key: 'par_is_significant', label: 'PAR Significant Change (Y/N)' },
      { key: 'par_management_response', label: 'PAR Management Response' },
    ],
  },
  {
    group: 'Engagement Context',
    items: [
      { key: 'client_name', label: 'Client Name' },
      { key: 'period_start', label: 'Period Start Date' },
      { key: 'period_end', label: 'Period End Date' },
      { key: 'audit_type', label: 'Audit Type (SME/PIE)' },
      { key: 'hard_close_date', label: 'Hard Close Date' },
      { key: 'framework', label: 'Accounting Framework (IFRS/FRS102)' },
    ],
  },
  {
    group: 'Sampling',
    items: [
      { key: 'sample_size', label: 'Sample Size' },
      { key: 'sample_method', label: 'Sampling Method' },
      { key: 'sample_items', label: 'Sample Items (list)' },
      { key: 'population_total', label: 'Population Total' },
      { key: 'population_count', label: 'Population Record Count' },
    ],
  },
  {
    group: 'Evidence & Documents',
    items: [
      { key: 'evidence_file', label: 'Evidence File (uploaded)' },
      { key: 'evidence_type', label: 'Evidence Type' },
      { key: 'document_name', label: 'Document Name' },
      { key: 'document_file', label: 'Document File' },
    ],
  },
];

const PLACEHOLDERS = [
  { code: '{{input.<key>}}', desc: 'Value from an input defined above' },
  { code: '{{test.description}}', desc: 'Test description' },
  { code: '{{test.fsLine}}', desc: 'FS line (e.g. Revenue)' },
  { code: '{{test.assertion}}', desc: 'Assertion being tested' },
  { code: '{{engagement.clientName}}', desc: 'Client name' },
  { code: '{{engagement.periodEnd}}', desc: 'Period end date' },
  { code: '{{engagement.materiality}}', desc: 'Materiality figure' },
  { code: '{{engagement.performanceMateriality}}', desc: 'Performance materiality' },
  { code: '{{engagement.clearlyTrivial}}', desc: 'Clearly trivial threshold' },
  { code: '{{engagement.framework}}', desc: 'Accounting framework' },
  { code: '{{loop.currentItem}}', desc: 'Current item in a For-Each loop' },
  { code: '{{loop.index}}', desc: 'Current iteration index (0-based)' },
  { code: '{{tb.balance}}', desc: 'TB current year total for FS line' },
  { code: '{{tb.priorYear}}', desc: 'TB prior year total' },
  { code: '{{tb.variance}}', desc: 'TB variance (CY - PY)' },
  { code: '{{tb.variancePct}}', desc: 'TB variance %' },
  { code: '{{tb.accountCode}}', desc: 'TB account code' },
  { code: '{{tb.description}}', desc: 'TB account description' },
  { code: '{{tb.accountCount}}', desc: 'Number of TB accounts in FS line' },
  { code: '{{vars.<key>}}', desc: 'Flow variable — persists across nodes and sub-flows' },
  { code: '{{loop.position}}', desc: 'Current item number (1-based)' },
  { code: '{{loop.total}}', desc: 'Total items in loop' },
];

function getDefaultDef(actionType: string) {
  if (actionType === 'ai_action') return { promptTemplate: '', inputs: [], outputFormat: 'pass_fail', requiresReview: true, systemInstruction: '' };
  if (actionType === 'client_action') return { requestTemplate: { subject: '', message: '' }, expectedResponse: 'file_upload', evidenceTypes: [], deadline: { days: 5, escalateOnOverdue: false } };
  return { instructions: '', inputs: [], outputFormat: 'form_data', toolsRequired: [] };
}

export function ExecutionDefEditor({ actionType, executionDef, onChange }: Props) {
  // Local state — edits happen here, only saved on explicit Save
  const [def, setDef] = useState<any>(() => executionDef || getDefaultDef(actionType));
  const [expanded, setExpanded] = useState(true);
  const [showPlaceholders, setShowPlaceholders] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showInputPicker, setShowInputPicker] = useState(false);
  const [inputPickerSearch, setInputPickerSearch] = useState('');
  const [showAssistant, setShowAssistant] = useState(false);
  const [assistantPrompt, setAssistantPrompt] = useState('');
  const [assistantLoading, setAssistantLoading] = useState(false);
  const [assistantResult, setAssistantResult] = useState<{ inputs: { key: string; label: string }[]; systemInstruction: string; promptTemplate: string } | null>(null);

  function addInputFromPicker(key: string, label: string, binding?: string) {
    const existing = def.inputs || [];
    if (existing.some((inp: InputDef) => inp.key === key)) return;
    const newInput: any = { key, label, description: '' };
    if (binding) newInput.binding = binding;
    setDef((prev: any) => ({ ...prev, inputs: [...existing, newInput] }));
    setDirty(true);
    setShowInputPicker(false);
    setInputPickerSearch('');
  }

  async function runAssistant() {
    if (!assistantPrompt.trim()) return;
    setAssistantLoading(true);
    setAssistantResult(null);
    try {
      const res = await fetch('/api/methodology-admin/test-action-assist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actionType,
          description: assistantPrompt,
          knownInputs: KNOWN_INPUTS.flatMap(g => g.items.map(i => `${i.key}: ${i.label}`)),
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setAssistantResult(data);
      }
    } finally {
      setAssistantLoading(false);
    }
  }

  function applyAssistantResult() {
    if (!assistantResult) return;
    const patch: any = {};
    if (assistantResult.inputs?.length > 0) {
      patch.inputs = assistantResult.inputs.map(i => ({ key: i.key, label: i.label, description: '' }));
    }
    if (assistantResult.systemInstruction) patch.systemInstruction = assistantResult.systemInstruction;
    if (assistantResult.promptTemplate) patch.promptTemplate = assistantResult.promptTemplate;
    // For client/human actions
    if (assistantResult.systemInstruction && actionType === 'human_action') patch.instructions = assistantResult.systemInstruction;
    setDef((prev: any) => ({ ...prev, ...patch }));
    setDirty(true);
    setShowAssistant(false);
    setAssistantResult(null);
    setAssistantPrompt('');
  }

  function update(patch: Record<string, any>) {
    setDef((prev: any) => ({ ...prev, ...patch }));
    setDirty(true);
  }

  async function handleSave() {
    setSaving(true);
    try {
      await onChange(def);
      setDirty(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="border rounded-lg mt-3 overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-2 bg-slate-50 hover:bg-slate-100 transition-colors"
      >
        <div className="flex items-center gap-2">
          {expanded ? <ChevronDown className="h-3.5 w-3.5 text-slate-500" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-500" />}
          <span className="text-xs font-semibold text-slate-700">Execution Definition</span>
          {executionDef ? (
            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">Configured</span>
          ) : (
            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-600 font-medium">Not set</span>
          )}
          {dirty && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-600 font-medium">Unsaved</span>}
        </div>
      </button>

      {expanded && (
        <div className="p-3 space-y-3 border-t">
          {/* ─── AI ASSISTANT POPUP ─── */}
          {showAssistant && (
            <div className="fixed inset-0 z-[80] bg-black/30 flex items-center justify-center">
              <div className="bg-white rounded-xl shadow-2xl w-[560px] max-h-[80vh] overflow-y-auto">
                <div className="flex items-center justify-between px-5 py-3 border-b bg-slate-50">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 bg-purple-100 rounded-lg flex items-center justify-center">
                      <span className="text-purple-700 text-xs font-bold">AI</span>
                    </div>
                    <span className="text-sm font-bold text-slate-800">Test Action Assistant</span>
                  </div>
                  <button onClick={() => { setShowAssistant(false); setAssistantResult(null); }} className="text-slate-400 hover:text-slate-600">
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="p-5 space-y-4">
                  <p className="text-sm text-slate-600">
                    Describe what this test action should do and I will suggest the inputs, system instruction, and prompt template.
                  </p>
                  <textarea
                    value={assistantPrompt}
                    onChange={e => setAssistantPrompt(e.target.value)}
                    placeholder="e.g. Take the file the client uploads and check if the list total agrees to the Trial Balance figure. Remember credit notes are negative. Add VAT separately."
                    className="w-full text-sm border rounded-lg px-3 py-2.5 leading-relaxed"
                    rows={4}
                    autoFocus
                  />
                  <Button onClick={runAssistant} disabled={assistantLoading || !assistantPrompt.trim()} className="w-full">
                    {assistantLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                    {assistantLoading ? 'Thinking...' : 'Suggest Configuration'}
                  </Button>

                  {assistantResult && (
                    <div className="border rounded-lg p-4 space-y-3 bg-purple-50/50">
                      <div className="text-xs font-semibold text-purple-700 uppercase">Suggested Configuration</div>

                      {assistantResult.inputs?.length > 0 && (
                        <div>
                          <div className="text-[10px] font-semibold text-slate-500 mb-1">INPUTS</div>
                          <div className="flex flex-wrap gap-1.5">
                            {assistantResult.inputs.map((inp, i) => (
                              <span key={i} className="text-xs bg-white border rounded px-2 py-1 font-mono text-slate-700">
                                {inp.key} <span className="text-slate-400">({inp.label})</span>
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {assistantResult.systemInstruction && (
                        <div>
                          <div className="text-[10px] font-semibold text-slate-500 mb-1">SYSTEM INSTRUCTION</div>
                          <div className="text-xs text-slate-700 bg-white border rounded p-2 whitespace-pre-wrap">{assistantResult.systemInstruction}</div>
                        </div>
                      )}

                      {assistantResult.promptTemplate && (
                        <div>
                          <div className="text-[10px] font-semibold text-slate-500 mb-1">PROMPT TEMPLATE</div>
                          <div className="text-xs text-slate-700 bg-white border rounded p-2 font-mono whitespace-pre-wrap">{assistantResult.promptTemplate}</div>
                        </div>
                      )}

                      <div className="flex gap-2 pt-2">
                        <Button onClick={applyAssistantResult} size="sm" className="flex-1 bg-purple-600 hover:bg-purple-700">
                          Apply Suggestions
                        </Button>
                        <Button onClick={() => setAssistantResult(null)} size="sm" variant="outline" className="flex-1">
                          Try Again
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ─── AI ACTION ─── */}
          {actionType === 'ai_action' && (
            <>
              {/* AI Assistant button */}
              <button
                onClick={() => setShowAssistant(true)}
                className="w-full flex items-center justify-center gap-2 py-2 rounded-lg border-2 border-dashed border-purple-300 bg-purple-50 text-purple-700 text-sm font-medium hover:bg-purple-100 hover:border-purple-400 transition-colors mb-1"
              >
                <span className="text-base">&#x2728;</span> AI Assistant — describe what this action should do
              </button>

              {/* Inputs */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[10px] font-semibold text-slate-500 uppercase">Inputs</label>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setShowInputPicker(!showInputPicker)} className="text-[10px] text-blue-600 hover:text-blue-800">
                      {showInputPicker ? 'Close Picker' : '+ Pick Input'}
                    </button>
                  </div>
                </div>
                {/* Existing inputs */}
                {(def.inputs || []).map((inp: any, i: number) => (
                  <div key={i} className="flex gap-1 mb-1.5 items-center">
                    <span className="text-xs font-mono bg-slate-100 border rounded px-2 py-1.5 text-slate-700 min-w-[100px]">{inp.key}</span>
                    <span className="text-xs text-slate-500 flex-1">{inp.label}</span>
                    {inp.binding?.startsWith('auto') && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-teal-100 text-teal-700 font-medium shrink-0">auto</span>
                    )}
                    <button
                      onClick={() => {
                        setDef((prev: any) => ({ ...prev, inputs: (prev.inputs || []).filter((_: any, j: number) => j !== i) }));
                        setDirty(true);
                      }}
                      className="text-red-400 hover:text-red-600 px-1"
                    ><X className="h-3.5 w-3.5" /></button>
                  </div>
                ))}
                {/* Input picker dropdown */}
                {showInputPicker && (
                  <div className="border rounded-lg mt-1 mb-2 bg-white shadow-lg max-h-[280px] overflow-y-auto">
                    <div className="sticky top-0 bg-white p-2 border-b">
                      <input
                        value={inputPickerSearch}
                        onChange={e => setInputPickerSearch(e.target.value)}
                        placeholder="Search inputs..."
                        className="w-full text-sm border rounded px-2 py-1.5"
                        autoFocus
                      />
                    </div>
                    {KNOWN_INPUTS.map(group => {
                      const filtered = group.items.filter(i =>
                        !inputPickerSearch || i.key.includes(inputPickerSearch.toLowerCase()) || i.label.toLowerCase().includes(inputPickerSearch.toLowerCase())
                      );
                      if (filtered.length === 0) return null;
                      const existingKeys = new Set((def.inputs || []).map((inp: InputDef) => inp.key));
                      return (
                        <div key={group.group}>
                          <div className="text-[9px] font-bold text-slate-400 uppercase px-3 py-1.5 bg-slate-50 sticky">{group.group}</div>
                          {filtered.map(item => (
                            <button
                              key={item.key}
                              onClick={() => addInputFromPicker(item.key, item.label, (item as any).binding)}
                              disabled={existingKeys.has(item.key)}
                              className={`w-full text-left px-3 py-1.5 text-xs hover:bg-blue-50 flex items-center justify-between ${existingKeys.has(item.key) ? 'opacity-40' : ''}`}
                            >
                              <div className="flex items-center gap-1.5">
                                <span className="font-mono text-slate-700">{item.key}</span>
                                {(item as any).binding?.startsWith('auto') && (
                                  <span className="text-[8px] px-1 py-0.5 rounded bg-teal-100 text-teal-600 font-medium">auto</span>
                                )}
                              </div>
                              <span className="text-slate-400 ml-2 text-right">{item.label}</span>
                            </button>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* System instruction */}
              <div>
                <label className="text-[10px] font-semibold text-slate-500 uppercase">System Instruction</label>
                <textarea
                  value={def.systemInstruction || ''}
                  onChange={e => update({ systemInstruction: e.target.value })}
                  placeholder="You are a UK statutory audit assistant..."
                  className="w-full text-sm border rounded px-3 py-2 mt-0.5 leading-relaxed"
                  rows={3}
                />
              </div>

              {/* Prompt template */}
              <div>
                <div className="flex items-center justify-between mb-0.5">
                  <label className="text-[10px] font-semibold text-slate-500 uppercase">Prompt Template</label>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setShowPlaceholders(!showPlaceholders)} className="text-[10px] text-blue-600 hover:text-blue-800 flex items-center gap-0.5">
                      <Info className="h-3 w-3" /> Placeholders
                    </button>
                  </div>
                </div>

                {/* AI Compose toggle */}
                <div className="flex items-center gap-2 mb-2 p-2 rounded-lg border bg-slate-50">
                  <label className="flex items-center gap-2 cursor-pointer flex-1">
                    <input
                      type="checkbox"
                      checked={def.aiCompose ?? false}
                      onChange={e => update({ aiCompose: e.target.checked })}
                      className="rounded text-purple-600"
                    />
                    <div>
                      <span className="text-xs font-medium text-slate-700">AI Compose</span>
                      <p className="text-[10px] text-slate-400 leading-tight">
                        {def.aiCompose
                          ? 'AI will interpret this prompt and compose a professional output using the context data'
                          : 'Prompt is used as-is with literal placeholder replacement'}
                      </p>
                    </div>
                  </label>
                </div>

                {showPlaceholders && (
                  <div className="bg-blue-50 border border-blue-200 rounded p-2 mb-1.5 text-[11px] space-y-0.5">
                    {PLACEHOLDERS.map(p => (
                      <div key={p.code} className="flex gap-2">
                        <code className="text-blue-700 font-mono shrink-0">{p.code}</code>
                        <span className="text-blue-600">{p.desc}</span>
                      </div>
                    ))}
                  </div>
                )}
                <textarea
                  value={def.promptTemplate || ''}
                  onChange={e => update({ promptTemplate: e.target.value })}
                  placeholder={def.aiCompose
                    ? "Compose a professional request to the client asking for the data needed to verify {{test.fsLine}}. Use the test description as context: {{input.test_description}}. The request should be clear, specific to the period {{engagement.periodEnd}}, and suitable for a UK statutory audit."
                    : "Compare {{input.uploaded_file}} against {{input.request_description}}..."
                  }
                  className={`w-full text-sm border rounded px-3 py-2 leading-relaxed ${def.aiCompose ? '' : 'font-mono'}`}
                  rows={8}
                />
                {def.aiCompose && (
                  <p className="text-[10px] text-purple-600 mt-1 flex items-center gap-1">
                    <span>&#x2728;</span> At runtime, AI will use this as an instruction to generate the actual output — not send it literally
                  </p>
                )}
              </div>

              {/* Output format */}
              <div>
                <label className="text-[10px] font-semibold text-slate-500 uppercase">Output Format</label>
                <select
                  value={def.outputFormat || 'pass_fail'}
                  onChange={e => update({ outputFormat: e.target.value })}
                  className="w-full text-sm border rounded px-2 py-1.5 mt-0.5 bg-white"
                >
                  <optgroup label="Data Outputs">
                    <option value="pass_fail">Pass / Fail</option>
                    <option value="pass_fail_forward">Pass / Fail + Forward Data (if pass, verified data available to next node)</option>
                    <option value="extracted_data">Extracted Data (fields)</option>
                    <option value="classification">Classification (categories)</option>
                    <option value="numeric">Numeric Value</option>
                    <option value="freeform">Freeform Text</option>
                    <option value="file_output">File Output (single)</option>
                    <option value="file_output_multiple">File Output (multiple files)</option>
                    <option value="data_table">Data Table / List</option>
                  </optgroup>
                  <optgroup label="System Triggers">
                    <option value="trigger_sampling">Create Sampling Engagement</option>
                    <option value="trigger_portal_request">Send Portal Request</option>
                    <option value="trigger_evidence_request">Create Evidence Request</option>
                    <option value="trigger_review_point">Raise Review Point</option>
                    <option value="trigger_representation">Add to Representation Letter</option>
                    <option value="trigger_data_extraction">Open Data Extraction Workspace</option>
                  </optgroup>
                </select>
              </div>

              {/* Trigger config sections */}
              {def.outputFormat === 'trigger_sampling' && (
                <div className="border rounded-lg p-3 bg-teal-50/50 space-y-3">
                  <div className="text-[10px] font-bold text-teal-700 uppercase">Create Sampling Engagement</div>
                  <div className="text-sm text-slate-700 space-y-1.5">
                    <div className="flex items-start gap-2">
                      <span className="text-teal-600 font-bold mt-0.5">1.</span>
                      <span>AI parses the input data and creates a Sampling Engagement</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-teal-600 font-bold mt-0.5">2.</span>
                      <span>Population data auto-populated from previous node output</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-teal-600 font-bold mt-0.5">3.</span>
                      <span>Materiality figures pulled from engagement automatically</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-teal-600 font-bold mt-0.5">4.</span>
                      <span>Flow <strong>pauses</strong> — user is notified to review and run the Sampling Calculator</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-teal-600 font-bold mt-0.5">5.</span>
                      <span>When user completes the run, sample results <strong>flow to the next node</strong></span>
                    </div>
                  </div>
                  <div className="bg-teal-100/50 rounded p-2 text-[10px] text-teal-700">
                    <strong>Output to next node:</strong> selected sample items, sample size, population total, coverage %
                  </div>
                </div>
              )}

              {def.outputFormat === 'trigger_portal_request' && (
                <div className="border rounded-lg p-3 bg-sky-50/50 space-y-2">
                  <div className="text-[10px] font-bold text-sky-700 uppercase">Send Portal Request</div>
                  <div className="text-sm text-slate-700 space-y-1.5">
                    <div className="flex items-start gap-2"><span className="text-sky-600 font-bold mt-0.5">1.</span><span>AI composes the request message using the prompt template and context</span></div>
                    <div className="flex items-start gap-2"><span className="text-sky-600 font-bold mt-0.5">2.</span><span>Portal request created and visible to client in their portal</span></div>
                    <div className="flex items-start gap-2"><span className="text-sky-600 font-bold mt-0.5">3.</span><span>Flow <strong>pauses</strong> until client responds</span></div>
                    <div className="flex items-start gap-2"><span className="text-sky-600 font-bold mt-0.5">4.</span><span>Client response (text + files) <strong>flows to next node</strong></span></div>
                  </div>
                  <div className="bg-sky-100/50 rounded p-2 text-[10px] text-sky-700">
                    <strong>Output to next node:</strong> client response text, uploaded file(s), response timestamp
                  </div>
                </div>
              )}

              {def.outputFormat === 'trigger_evidence_request' && (
                <div className="border rounded-lg p-3 bg-blue-50/50 space-y-2">
                  <div className="text-[10px] font-bold text-blue-700 uppercase">Create Evidence Request</div>
                  <div className="text-sm text-slate-700 space-y-1.5">
                    <div className="flex items-start gap-2"><span className="text-blue-600 font-bold mt-0.5">1.</span><span>Creates evidence request(s) for each sample item from previous node</span></div>
                    <div className="flex items-start gap-2"><span className="text-blue-600 font-bold mt-0.5">2.</span><span>Sent to client portal — client uploads supporting evidence</span></div>
                    <div className="flex items-start gap-2"><span className="text-blue-600 font-bold mt-0.5">3.</span><span>Flow <strong>pauses</strong> until all evidence is uploaded</span></div>
                    <div className="flex items-start gap-2"><span className="text-blue-600 font-bold mt-0.5">4.</span><span>Uploaded evidence <strong>flows to next node</strong> for verification</span></div>
                  </div>
                  <div className="bg-blue-100/50 rounded p-2 text-[10px] text-blue-700">
                    <strong>Output to next node:</strong> evidence files per item, upload status, any client notes
                  </div>
                </div>
              )}

              {def.outputFormat === 'trigger_review_point' && (
                <div className="border rounded-lg p-3 bg-amber-50/50 space-y-2">
                  <div className="text-[10px] font-bold text-amber-700 uppercase">Raise Review Point</div>
                  <div className="text-sm text-slate-700 space-y-1.5">
                    <div className="flex items-start gap-2"><span className="text-amber-600 font-bold mt-0.5">1.</span><span>Creates a review point with findings from this action</span></div>
                    <div className="flex items-start gap-2"><span className="text-amber-600 font-bold mt-0.5">2.</span><span>Assigned to the RI or Manager on the engagement</span></div>
                    <div className="flex items-start gap-2"><span className="text-amber-600 font-bold mt-0.5">3.</span><span>Flow <strong>pauses</strong> until the review point is resolved</span></div>
                    <div className="flex items-start gap-2"><span className="text-amber-600 font-bold mt-0.5">4.</span><span>Resolution decision <strong>flows to next node</strong></span></div>
                  </div>
                  <div className="bg-amber-100/50 rounded p-2 text-[10px] text-amber-700">
                    <strong>Output to next node:</strong> resolution decision, reviewer notes, any revised figures
                  </div>
                </div>
              )}

              {def.outputFormat === 'trigger_representation' && (
                <div className="border rounded-lg p-3 bg-purple-50/50 space-y-2">
                  <div className="text-[10px] font-bold text-purple-700 uppercase">Add to Representation Letter</div>
                  <div className="text-sm text-slate-700 space-y-1.5">
                    <div className="flex items-start gap-2"><span className="text-purple-600 font-bold mt-0.5">1.</span><span>AI composes a representation paragraph from the test findings</span></div>
                    <div className="flex items-start gap-2"><span className="text-purple-600 font-bold mt-0.5">2.</span><span>Added to the management representation letter for this engagement</span></div>
                    <div className="flex items-start gap-2"><span className="text-purple-600 font-bold mt-0.5">3.</span><span>Flow <strong>continues</strong> immediately (no pause)</span></div>
                  </div>
                  <div className="bg-purple-100/50 rounded p-2 text-[10px] text-purple-700">
                    <strong>Output to next node:</strong> confirmation that representation was added
                  </div>
                </div>
              )}

              {def.outputFormat === 'trigger_data_extraction' && (
                <div className="border rounded-lg p-3 bg-indigo-50/50 space-y-2">
                  <div className="text-[10px] font-bold text-indigo-700 uppercase">Data Extraction Workspace</div>
                  <div className="text-sm text-slate-700 space-y-1.5">
                    <div className="flex items-start gap-2"><span className="text-indigo-600 font-bold mt-0.5">1.</span><span>Opens the Financial Data Extraction workspace inside the Audit Plan test row</span></div>
                    <div className="flex items-start gap-2"><span className="text-indigo-600 font-bold mt-0.5">2.</span><span>Sample items from sampling run populate the left panel (blue)</span></div>
                    <div className="flex items-start gap-2"><span className="text-indigo-600 font-bold mt-0.5">3.</span><span>Client evidence documents populate the middle panel (green)</span></div>
                    <div className="flex items-start gap-2"><span className="text-indigo-600 font-bold mt-0.5">4.</span><span>AI verifies each item — results shown in right panel (amber)</span></div>
                    <div className="flex items-start gap-2"><span className="text-indigo-600 font-bold mt-0.5">5.</span><span>Each test creates its own extraction session tied to this client, period, and FS line</span></div>
                  </div>
                  <div className="bg-indigo-100/50 rounded p-2 text-[10px] text-indigo-700">
                    <strong>Output to next node:</strong> per-item verification results, error total, error %, conclusion (pass/fail)
                  </div>
                </div>
              )}

              {/* Confidence + Review */}
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="text-[10px] font-semibold text-slate-500 uppercase">Confidence Threshold</label>
                  <input
                    type="number"
                    min={0} max={1} step={0.05}
                    value={def.confidenceThreshold ?? 0.8}
                    onChange={e => update({ confidenceThreshold: parseFloat(e.target.value) })}
                    className="w-full text-sm border rounded px-2 py-1.5 mt-0.5"
                  />
                </div>
                <div className="flex items-end pb-1">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={def.requiresReview ?? true}
                      onChange={e => update({ requiresReview: e.target.checked })}
                      className="rounded text-blue-600"
                    />
                    <span className="text-sm text-slate-600">Requires Review</span>
                  </label>
                </div>
              </div>
            </>
          )}

          {/* ─── CLIENT ACTION ─── */}
          {actionType === 'client_action' && (
            <>
              <div>
                <label className="text-[10px] font-semibold text-slate-500 uppercase">Request Subject</label>
                <input
                  value={def.requestTemplate?.subject || ''}
                  onChange={e => update({ requestTemplate: { ...def.requestTemplate, subject: e.target.value } })}
                  placeholder="e.g. Supporting invoice for {{loop.currentItem.customer}}"
                  className="w-full text-sm border rounded px-3 py-2 mt-0.5"
                />
                <p className="text-[9px] text-slate-400 mt-0.5">The test name and FS line are automatically added as context. Use placeholders for item-specific details.</p>
              </div>
              <div>
                <div className="flex items-center justify-between mb-0.5">
                  <label className="text-[10px] font-semibold text-slate-500 uppercase">Request Message</label>
                  <button onClick={() => setShowPlaceholders(!showPlaceholders)} className="text-[10px] text-blue-600 hover:text-blue-800 flex items-center gap-0.5">
                    <Info className="h-3 w-3" /> Placeholders
                  </button>
                </div>

                {/* AI Compose toggle for client requests */}
                <div className="flex items-center gap-2 mb-2 p-2 rounded-lg border bg-slate-50">
                  <label className="flex items-center gap-2 cursor-pointer flex-1">
                    <input
                      type="checkbox"
                      checked={def.aiCompose ?? false}
                      onChange={e => update({ aiCompose: e.target.checked })}
                      className="rounded text-purple-600"
                    />
                    <div>
                      <span className="text-xs font-medium text-slate-700">AI Compose</span>
                      <p className="text-[10px] text-slate-400 leading-tight">
                        {def.aiCompose
                          ? 'AI will compose a professional client request from this instruction'
                          : 'Message is sent to client as-is with placeholder values inserted'}
                      </p>
                    </div>
                  </label>
                </div>

                {showPlaceholders && (
                  <div className="bg-blue-50 border border-blue-200 rounded p-2 mb-1.5 text-[11px] space-y-0.5">
                    {PLACEHOLDERS.map(p => (
                      <div key={p.code} className="flex gap-2">
                        <code className="text-blue-700 font-mono shrink-0">{p.code}</code>
                        <span className="text-blue-600">{p.desc}</span>
                      </div>
                    ))}
                  </div>
                )}
                <textarea
                  value={def.requestTemplate?.message || ''}
                  onChange={e => update({ requestTemplate: { ...def.requestTemplate, message: e.target.value } })}
                  placeholder={def.aiCompose
                    ? "Write a professional client request for the data needed to verify {{test.fsLine}}. The test requires: {{test.description}}. Request should be specific to period ending {{engagement.periodEnd}} and suitable for a UK statutory audit."
                    : "Please provide a breakdown of {{test.fsLine}} as at {{engagement.periodEnd}}..."
                  }
                  className={`w-full text-sm border rounded px-3 py-2 leading-relaxed ${def.aiCompose ? '' : 'font-mono'}`}
                  rows={5}
                />
                {def.aiCompose && (
                  <p className="text-[10px] text-purple-600 mt-1 flex items-center gap-1">
                    <span>&#x2728;</span> At runtime, AI will compose the actual client request from this instruction
                  </p>
                )}
              </div>

              <div>
                <label className="text-[10px] font-semibold text-slate-500 uppercase">Required Evidence Types</label>
                <div className="flex flex-wrap gap-2 mt-1">
                  {EVIDENCE_TYPES.map(et => (
                    <label key={et} className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={(def.evidenceTypes || []).includes(et)}
                        onChange={e => {
                          const current = def.evidenceTypes || [];
                          update({ evidenceTypes: e.target.checked ? [...current, et] : current.filter((t: string) => t !== et) });
                        }}
                        className="rounded text-blue-600"
                      />
                      <span className="text-xs text-slate-600 capitalize">{et.replace(/_/g, ' ')}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-[10px] font-semibold text-slate-500 uppercase">Expected Response</label>
                <select
                  value={def.expectedResponse || 'file_upload'}
                  onChange={e => update({ expectedResponse: e.target.value })}
                  className="w-full text-sm border rounded px-2 py-1.5 mt-0.5 bg-white"
                >
                  <option value="file_upload">File Upload</option>
                  <option value="data_entry">Data Entry</option>
                  <option value="confirmation">Written Confirmation</option>
                </select>
              </div>

              <div>
                <label className="text-[10px] font-semibold text-slate-500 uppercase">Deadline (days from trigger)</label>
                <div className="flex items-center gap-2 mt-0.5">
                  <input
                    type="number"
                    min={1} max={90}
                    value={def.deadline?.days || 5}
                    onChange={e => update({ deadline: { ...def.deadline, days: parseInt(e.target.value) || 5 } })}
                    className="w-20 text-sm border rounded px-2 py-1.5"
                  />
                  <span className="text-xs text-slate-500">days</span>
                  <label className="flex items-center gap-1.5 ml-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={def.deadline?.escalateOnOverdue ?? false}
                      onChange={e => update({ deadline: { ...def.deadline, escalateOnOverdue: e.target.checked } })}
                      className="rounded text-red-600"
                    />
                    <span className="text-xs text-slate-600">Escalate if overdue</span>
                  </label>
                </div>
              </div>
            </>
          )}

          {/* ─── HUMAN ACTION ─── */}
          {actionType === 'human_action' && (
            <>
              <div>
                <label className="text-[10px] font-semibold text-slate-500 uppercase">Instructions for Team Member</label>
                <textarea
                  value={def.instructions || ''}
                  onChange={e => update({ instructions: e.target.value })}
                  placeholder="Review the uploaded evidence and verify each item against the sample selection..."
                  className="w-full text-sm border rounded px-3 py-2 mt-0.5 leading-relaxed"
                  rows={5}
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[10px] font-semibold text-slate-500 uppercase">Inputs Required</label>
                  <button
                    onClick={() => update({ inputs: [...(def.inputs || []), { key: '', label: '', description: '' }] })}
                    className="text-[10px] text-blue-600 hover:text-blue-800"
                  >+ Add Input</button>
                </div>
                {(def.inputs || []).map((inp: InputDef, i: number) => (
                  <div key={i} className="flex gap-1 mb-1.5">
                    <input
                      value={inp.key}
                      onChange={e => {
                        const inputs = [...(def.inputs || [])];
                        inputs[i] = { ...inputs[i], key: e.target.value };
                        update({ inputs });
                      }}
                      placeholder="key"
                      className="w-24 text-sm border rounded px-2 py-1.5 font-mono"
                    />
                    <input
                      value={inp.label}
                      onChange={e => {
                        const inputs = [...(def.inputs || [])];
                        inputs[i] = { ...inputs[i], label: e.target.value };
                        update({ inputs });
                      }}
                      placeholder="Label"
                      className="flex-1 text-sm border rounded px-2 py-1.5"
                    />
                    <button
                      onClick={() => update({ inputs: (def.inputs || []).filter((_: any, j: number) => j !== i) })}
                      className="text-red-400 hover:text-red-600 px-1"
                    ><X className="h-3.5 w-3.5" /></button>
                  </div>
                ))}
              </div>

              <div>
                <label className="text-[10px] font-semibold text-slate-500 uppercase">Tools Required</label>
                <div className="flex flex-wrap gap-2 mt-1">
                  {TOOLS.map(t => (
                    <label key={t.value} className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={(def.toolsRequired || []).includes(t.value)}
                        onChange={e => {
                          const current = def.toolsRequired || [];
                          update({ toolsRequired: e.target.checked ? [...current, t.value] : current.filter((v: string) => v !== t.value) });
                        }}
                        className="rounded text-green-600"
                      />
                      <span className="text-xs text-slate-600">{t.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-[10px] font-semibold text-slate-500 uppercase">Output Format</label>
                <select
                  value={def.outputFormat || 'form_data'}
                  onChange={e => update({ outputFormat: e.target.value })}
                  className="w-full text-sm border rounded px-2 py-1.5 mt-0.5 bg-white"
                >
                  <optgroup label="Data Outputs">
                    <option value="form_data">Form Data</option>
                    <option value="file">File Output</option>
                    <option value="approval">Approval / Sign-off</option>
                    <option value="sample_selection">Sample Selection</option>
                  </optgroup>
                  <optgroup label="System Triggers">
                    <option value="trigger_sampling">Open Sampling Calculator</option>
                    <option value="trigger_review_point">Raise Review Point</option>
                  </optgroup>
                </select>
              </div>

              <div>
                <label className="text-[10px] font-semibold text-slate-500 uppercase">Minimum Role Required</label>
                <select
                  value={def.requiredRole || ''}
                  onChange={e => update({ requiredRole: e.target.value || undefined })}
                  className="w-full text-sm border rounded px-2 py-1.5 mt-0.5 bg-white"
                >
                  <option value="">Any team member</option>
                  <option value="Junior">Junior / Trainee</option>
                  <option value="Senior">Senior</option>
                  <option value="Manager">Manager</option>
                  <option value="RI">Responsible Individual</option>
                </select>
              </div>
            </>
          )}

          {/* Save button */}
          <div className="pt-2 border-t">
            <Button onClick={handleSave} size="sm" disabled={saving || !dirty} className="w-full">
              {saving ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
              {saving ? 'Saving...' : dirty ? 'Save Execution Definition' : 'Saved'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
