'use client';

import { useState } from 'react';
import { Plus, X, ChevronDown, ChevronRight, Bot, Users, User, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';

// ─── Types ───
interface InputDef {
  key: string;
  label: string;
  description: string;
}

interface DataField {
  key: string;
  label: string;
  type: 'string' | 'number' | 'currency' | 'date' | 'boolean';
  required: boolean;
}

interface AIExecutionDef {
  promptTemplate: string;
  systemInstruction?: string;
  inputs: InputDef[];
  outputFormat: 'pass_fail' | 'extracted_data' | 'classification' | 'freeform' | 'numeric';
  outputFields?: { key: string; label: string; type: string }[];
  confidenceThreshold?: number;
  requiresReview?: boolean;
}

interface ClientExecutionDef {
  requestTemplate: { subject: string; message: string };
  evidenceTypes?: string[];
  expectedResponse: 'file_upload' | 'data_entry' | 'confirmation';
  acceptedFileTypes?: string[];
  deadline?: { days: number; reminderDays?: number[]; escalateOnOverdue?: boolean };
}

interface HumanExecutionDef {
  instructions: string;
  inputs: InputDef[];
  toolsRequired?: string[];
  dataEntryFields?: DataField[];
  outputFormat: 'form_data' | 'file' | 'approval' | 'sample_selection';
  requiredRole?: string;
}

type ExecutionDef = AIExecutionDef | ClientExecutionDef | HumanExecutionDef;

interface Props {
  actionType: string; // client_action | ai_action | human_action
  executionDef: any | null;
  onChange: (def: any) => void;
}

// ─── Evidence types for client actions ───
const EVIDENCE_TYPES = [
  'invoice', 'payment', 'contract', 'supplier_confirmation',
  'debtor_confirmation', 'intercompany', 'director_matters', 'bank_statement',
];

// ─── Tools for human actions ───
const TOOLS = [
  { value: 'sample_calculator', label: 'Sample Calculator' },
  { value: 'tb_reference', label: 'Trial Balance Reference' },
  { value: 'evidence_viewer', label: 'Evidence Viewer' },
  { value: 'workpaper_editor', label: 'Workpaper Editor' },
  { value: 'data_entry_form', label: 'Data Entry Form' },
];

// ─── Placeholders hint ───
const PLACEHOLDERS = [
  { code: '{{input.<key>}}', desc: 'Output from upstream node' },
  { code: '{{test.description}}', desc: 'Test description' },
  { code: '{{test.fsLine}}', desc: 'FS line (e.g. Revenue)' },
  { code: '{{test.assertion}}', desc: 'Assertion being tested' },
  { code: '{{engagement.clientName}}', desc: 'Client name' },
  { code: '{{engagement.periodEnd}}', desc: 'Period end date' },
  { code: '{{engagement.materiality}}', desc: 'Materiality figure' },
];

export function ExecutionDefEditor({ actionType, executionDef, onChange }: Props) {
  const [expanded, setExpanded] = useState(true);
  const [showPlaceholders, setShowPlaceholders] = useState(false);

  // Auto-initialise on mount if no def exists
  useState(() => {
    if (!executionDef) {
      if (actionType === 'ai_action') onChange({ promptTemplate: '', inputs: [], outputFormat: 'pass_fail', requiresReview: true });
      else if (actionType === 'client_action') onChange({ requestTemplate: { subject: '', message: '' }, expectedResponse: 'file_upload' });
      else onChange({ instructions: '', inputs: [], outputFormat: 'form_data' });
    }
  });

  // Initialise default def if none exists
  function ensureDef() {
    if (executionDef) return executionDef;
    if (actionType === 'ai_action') {
      const def = { promptTemplate: '', inputs: [], outputFormat: 'pass_fail', requiresReview: true };
      onChange(def);
      return def;
    }
    if (actionType === 'client_action') {
      const def = { requestTemplate: { subject: '', message: '' }, expectedResponse: 'file_upload' };
      onChange(def);
      return def;
    }
    const def = { instructions: '', inputs: [], outputFormat: 'form_data' };
    onChange(def);
    return def;
  }

  function update(patch: Record<string, any>) {
    onChange({ ...ensureDef(), ...patch });
  }

  const def = executionDef || {};

  return (
    <div className="border rounded-lg mt-3 overflow-hidden">
      {/* Header */}
      <button
        onClick={() => { setExpanded(!expanded); if (!expanded) ensureDef(); }}
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
        </div>
      </button>

      {expanded && (
        <div className="p-3 space-y-3 border-t">
          {/* ─── AI ACTION ─── */}
          {actionType === 'ai_action' && (
            <>
              {/* Inputs */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[10px] font-semibold text-slate-500 uppercase">Inputs (from upstream nodes)</label>
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
                      className="w-20 text-[11px] border rounded px-1.5 py-1 font-mono"
                    />
                    <input
                      value={inp.label}
                      onChange={e => {
                        const inputs = [...(def.inputs || [])];
                        inputs[i] = { ...inputs[i], label: e.target.value };
                        update({ inputs });
                      }}
                      placeholder="Label"
                      className="flex-1 text-[11px] border rounded px-1.5 py-1"
                    />
                    <button
                      onClick={() => update({ inputs: (def.inputs || []).filter((_: any, j: number) => j !== i) })}
                      className="text-red-400 hover:text-red-600 px-1"
                    ><X className="h-3 w-3" /></button>
                  </div>
                ))}
              </div>

              {/* System instruction */}
              <div>
                <label className="text-[10px] font-semibold text-slate-500 uppercase">System Instruction</label>
                <textarea
                  value={def.systemInstruction || ''}
                  onChange={e => update({ systemInstruction: e.target.value })}
                  placeholder="You are a UK statutory audit assistant..."
                  className="w-full text-[11px] border rounded px-2 py-1.5 mt-0.5"
                  rows={2}
                />
              </div>

              {/* Prompt template */}
              <div>
                <div className="flex items-center justify-between mb-0.5">
                  <label className="text-[10px] font-semibold text-slate-500 uppercase">Prompt Template</label>
                  <button onClick={() => setShowPlaceholders(!showPlaceholders)} className="text-[10px] text-blue-600 hover:text-blue-800 flex items-center gap-0.5">
                    <Info className="h-3 w-3" /> Placeholders
                  </button>
                </div>
                {showPlaceholders && (
                  <div className="bg-blue-50 border border-blue-200 rounded p-2 mb-1.5 text-[10px] space-y-0.5">
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
                  placeholder="Compare {{input.uploaded_file}} against {{input.request_description}}..."
                  className="w-full text-[11px] border rounded px-2 py-1.5 font-mono"
                  rows={6}
                />
              </div>

              {/* Output format */}
              <div>
                <label className="text-[10px] font-semibold text-slate-500 uppercase">Output Format</label>
                <select
                  value={def.outputFormat || 'pass_fail'}
                  onChange={e => update({ outputFormat: e.target.value })}
                  className="w-full text-[11px] border rounded px-2 py-1.5 mt-0.5 bg-white"
                >
                  <option value="pass_fail">Pass / Fail</option>
                  <option value="extracted_data">Extracted Data (fields)</option>
                  <option value="classification">Classification (categories)</option>
                  <option value="numeric">Numeric Value</option>
                  <option value="freeform">Freeform Text</option>
                </select>
              </div>

              {/* Confidence + Review */}
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="text-[10px] font-semibold text-slate-500 uppercase">Confidence Threshold</label>
                  <input
                    type="number"
                    min={0} max={1} step={0.05}
                    value={def.confidenceThreshold ?? 0.8}
                    onChange={e => update({ confidenceThreshold: parseFloat(e.target.value) })}
                    className="w-full text-[11px] border rounded px-2 py-1.5 mt-0.5"
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
                    <span className="text-[11px] text-slate-600">Requires Review</span>
                  </label>
                </div>
              </div>
            </>
          )}

          {/* ─── CLIENT ACTION ─── */}
          {actionType === 'client_action' && (
            <>
              {/* Request template */}
              <div>
                <label className="text-[10px] font-semibold text-slate-500 uppercase">Request Subject</label>
                <input
                  value={def.requestTemplate?.subject || ''}
                  onChange={e => update({ requestTemplate: { ...def.requestTemplate, subject: e.target.value } })}
                  placeholder="Debtor balance breakdown for {{test.fsLine}}"
                  className="w-full text-[11px] border rounded px-2 py-1.5 mt-0.5"
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-0.5">
                  <label className="text-[10px] font-semibold text-slate-500 uppercase">Request Message</label>
                  <button onClick={() => setShowPlaceholders(!showPlaceholders)} className="text-[10px] text-blue-600 hover:text-blue-800 flex items-center gap-0.5">
                    <Info className="h-3 w-3" /> Placeholders
                  </button>
                </div>
                {showPlaceholders && (
                  <div className="bg-blue-50 border border-blue-200 rounded p-2 mb-1.5 text-[10px] space-y-0.5">
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
                  placeholder="Please provide a breakdown of {{test.fsLine}} as at {{engagement.periodEnd}}..."
                  className="w-full text-[11px] border rounded px-2 py-1.5 font-mono"
                  rows={4}
                />
              </div>

              {/* Evidence types */}
              <div>
                <label className="text-[10px] font-semibold text-slate-500 uppercase">Required Evidence Types</label>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {EVIDENCE_TYPES.map(et => (
                    <label key={et} className="flex items-center gap-1 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={(def.evidenceTypes || []).includes(et)}
                        onChange={e => {
                          const current = def.evidenceTypes || [];
                          update({ evidenceTypes: e.target.checked ? [...current, et] : current.filter((t: string) => t !== et) });
                        }}
                        className="rounded text-blue-600 h-3 w-3"
                      />
                      <span className="text-[10px] text-slate-600 capitalize">{et.replace(/_/g, ' ')}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Expected response */}
              <div>
                <label className="text-[10px] font-semibold text-slate-500 uppercase">Expected Response</label>
                <select
                  value={def.expectedResponse || 'file_upload'}
                  onChange={e => update({ expectedResponse: e.target.value })}
                  className="w-full text-[11px] border rounded px-2 py-1.5 mt-0.5 bg-white"
                >
                  <option value="file_upload">File Upload</option>
                  <option value="data_entry">Data Entry</option>
                  <option value="confirmation">Written Confirmation</option>
                </select>
              </div>

              {/* Deadline */}
              <div>
                <label className="text-[10px] font-semibold text-slate-500 uppercase">Deadline (days from trigger)</label>
                <div className="flex items-center gap-2 mt-0.5">
                  <input
                    type="number"
                    min={1} max={90}
                    value={def.deadline?.days || 5}
                    onChange={e => update({ deadline: { ...def.deadline, days: parseInt(e.target.value) || 5 } })}
                    className="w-20 text-[11px] border rounded px-2 py-1.5"
                  />
                  <span className="text-[10px] text-slate-500">days</span>
                  <label className="flex items-center gap-1 ml-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={def.deadline?.escalateOnOverdue ?? false}
                      onChange={e => update({ deadline: { ...def.deadline, escalateOnOverdue: e.target.checked } })}
                      className="rounded text-red-600 h-3 w-3"
                    />
                    <span className="text-[10px] text-slate-600">Escalate if overdue</span>
                  </label>
                </div>
              </div>
            </>
          )}

          {/* ─── HUMAN ACTION ─── */}
          {actionType === 'human_action' && (
            <>
              {/* Instructions */}
              <div>
                <label className="text-[10px] font-semibold text-slate-500 uppercase">Instructions for Team Member</label>
                <textarea
                  value={def.instructions || ''}
                  onChange={e => update({ instructions: e.target.value })}
                  placeholder="Review the uploaded evidence and verify each item against the sample selection..."
                  className="w-full text-[11px] border rounded px-2 py-1.5 mt-0.5"
                  rows={4}
                />
              </div>

              {/* Inputs */}
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
                      className="w-20 text-[11px] border rounded px-1.5 py-1 font-mono"
                    />
                    <input
                      value={inp.label}
                      onChange={e => {
                        const inputs = [...(def.inputs || [])];
                        inputs[i] = { ...inputs[i], label: e.target.value };
                        update({ inputs });
                      }}
                      placeholder="Label"
                      className="flex-1 text-[11px] border rounded px-1.5 py-1"
                    />
                    <button
                      onClick={() => update({ inputs: (def.inputs || []).filter((_: any, j: number) => j !== i) })}
                      className="text-red-400 hover:text-red-600 px-1"
                    ><X className="h-3 w-3" /></button>
                  </div>
                ))}
              </div>

              {/* Tools required */}
              <div>
                <label className="text-[10px] font-semibold text-slate-500 uppercase">Tools Required</label>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {TOOLS.map(t => (
                    <label key={t.value} className="flex items-center gap-1 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={(def.toolsRequired || []).includes(t.value)}
                        onChange={e => {
                          const current = def.toolsRequired || [];
                          update({ toolsRequired: e.target.checked ? [...current, t.value] : current.filter((v: string) => v !== t.value) });
                        }}
                        className="rounded text-green-600 h-3 w-3"
                      />
                      <span className="text-[10px] text-slate-600">{t.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Output format */}
              <div>
                <label className="text-[10px] font-semibold text-slate-500 uppercase">Output Format</label>
                <select
                  value={def.outputFormat || 'form_data'}
                  onChange={e => update({ outputFormat: e.target.value })}
                  className="w-full text-[11px] border rounded px-2 py-1.5 mt-0.5 bg-white"
                >
                  <option value="form_data">Form Data</option>
                  <option value="file">File Output</option>
                  <option value="approval">Approval / Sign-off</option>
                  <option value="sample_selection">Sample Selection</option>
                </select>
              </div>

              {/* Required role */}
              <div>
                <label className="text-[10px] font-semibold text-slate-500 uppercase">Minimum Role Required</label>
                <select
                  value={def.requiredRole || ''}
                  onChange={e => update({ requiredRole: e.target.value || undefined })}
                  className="w-full text-[11px] border rounded px-2 py-1.5 mt-0.5 bg-white"
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
        </div>
      )}
    </div>
  );
}
