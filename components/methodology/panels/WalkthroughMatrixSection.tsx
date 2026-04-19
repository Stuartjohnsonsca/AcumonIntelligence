'use client';

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Grid3X3, Loader2, Plus, Trash2, Upload, X } from 'lucide-react';

// ─── Types (must match server at app/api/engagements/[id]/walkthrough-import/route.ts) ───
export interface PhaseCell { description: string; control: string; frequency: string; evidence: string; }
export interface MatrixStep {
  id: string;
  label: string;
  controlWeakness?: string;
  evidenceScreenshots?: string;
  phases: { initiation: PhaseCell; process: PhaseCell; recording: PhaseCell; reporting: PhaseCell };
}
export interface WalkthroughMatrix {
  header: {
    auditPeriod?: string;
    processTitle?: string;
    walkthroughDate?: string;
    attendees?: string;
    processOwner?: string;
    itSystems?: string;
    approvalLimits?: { amount: string; approver: string }[];
    note?: string;
  };
  conclusions: { designAndImplementation?: string; planToTestControls?: string; substantiveImpact?: string };
  steps: MatrixStep[];
  importedAt?: string;
  sourceFileName?: string;
}

const PHASE_KEYS: Array<keyof MatrixStep['phases']> = ['initiation', 'process', 'recording', 'reporting'];
const PHASE_LABELS: Record<string, string> = { initiation: 'Initiation', process: 'Process', recording: 'Recording', reporting: 'Reporting' };

function newCell(): PhaseCell { return { description: '', control: '', frequency: '', evidence: '' }; }
function newStep(label = 'New step'): MatrixStep {
  return {
    id: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? (crypto as Crypto).randomUUID() : Math.random().toString(36).slice(2, 10),
    label,
    phases: { initiation: newCell(), process: newCell(), recording: newCell(), reporting: newCell() },
  };
}

function emptyMatrix(): WalkthroughMatrix {
  return { header: {}, conclusions: {}, steps: [] };
}

interface Props {
  engagementId: string;
  processKey: string;
  processLabel: string;
  onImported?: (result: { matrix: WalkthroughMatrix; narrative: string; controls: { description: string; type: string; frequency: string; tested: boolean }[] }) => void;
}

export interface WalkthroughMatrixSectionHandle { openImport: () => void }

export const WalkthroughMatrixSection = forwardRef<WalkthroughMatrixSectionHandle, Props>(function WalkthroughMatrixSection({ engagementId, processKey, processLabel, onImported }, ref) {
  const [matrix, setMatrix] = useState<WalkthroughMatrix | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(true);
  const [showImport, setShowImport] = useState(false);
  const [saving, setSaving] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useImperativeHandle(ref, () => ({ openImport: () => setShowImport(true) }), []);

  const sectionKey = `walkthrough_${processKey}_matrix`;

  // Load existing matrix
  useEffect(() => {
    fetch(`/api/engagements/${engagementId}/permanent-file?section=${sectionKey}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        const d = (data?.data && Object.keys(data.data).length > 0) ? data.data as WalkthroughMatrix : null;
        setMatrix(d);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [engagementId, sectionKey]);

  // Debounced save
  const scheduleSave = useCallback((next: WalkthroughMatrix) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaving(true);
      try {
        await fetch(`/api/engagements/${engagementId}/permanent-file`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sectionKey, data: next }),
        });
      } catch {} finally { setSaving(false); }
    }, 800);
  }, [engagementId, sectionKey]);

  function update(updater: (m: WalkthroughMatrix) => WalkthroughMatrix) {
    setMatrix(prev => {
      const base = prev || emptyMatrix();
      const next = updater(base);
      scheduleSave(next);
      return next;
    });
  }

  if (!loaded) {
    return (
      <div className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-[10px] text-slate-400 flex items-center gap-1">
        <Loader2 className="h-3 w-3 animate-spin" /> Loading walkthrough matrix…
      </div>
    );
  }

  const hasContent = matrix && (matrix.steps.length > 0 || matrix.header.processTitle || matrix.conclusions.designAndImplementation);

  return (
    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
      <button onClick={() => setOpen(v => !v)} className="w-full flex items-center gap-2 px-3 py-2 bg-slate-50 hover:bg-slate-100 transition-colors">
        {open ? <ChevronDown className="h-3.5 w-3.5 text-slate-400" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-400" />}
        <Grid3X3 className="h-3.5 w-3.5 text-indigo-500" />
        <span className="text-xs font-semibold text-slate-700">Walkthrough Matrix{matrix?.steps?.length ? ` (${matrix.steps.length} step${matrix.steps.length === 1 ? '' : 's'})` : ''}</span>
        {saving && <span className="text-[9px] text-slate-400 ml-1">saving…</span>}
      </button>

      {open && (
        <div className="p-3 space-y-3">
          {!hasContent && (
            <p className="text-[11px] text-slate-400 italic">
              No matrix yet. Use <b>Import from Excel</b> below to ingest a previously prepared walkthrough, or <b>+ Add step</b> to build one manually.
            </p>
          )}

          {/* Header metadata */}
          <div className="grid grid-cols-2 gap-2">
            <LabelledInput label="Audit period" value={matrix?.header.auditPeriod || ''} onChange={v => update(m => ({ ...m, header: { ...m.header, auditPeriod: v } }))} />
            <LabelledInput label="Process title" value={matrix?.header.processTitle || processLabel} onChange={v => update(m => ({ ...m, header: { ...m.header, processTitle: v } }))} />
            <LabelledInput label="Walkthrough date" type="date" value={(matrix?.header.walkthroughDate || '').slice(0, 10)} onChange={v => update(m => ({ ...m, header: { ...m.header, walkthroughDate: v } }))} />
            <LabelledInput label="Process owner" value={matrix?.header.processOwner || ''} onChange={v => update(m => ({ ...m, header: { ...m.header, processOwner: v } }))} />
            <LabelledArea label="Meeting attendees" value={matrix?.header.attendees || ''} onChange={v => update(m => ({ ...m, header: { ...m.header, attendees: v } }))} />
            <LabelledArea label="IT systems involved" value={matrix?.header.itSystems || ''} onChange={v => update(m => ({ ...m, header: { ...m.header, itSystems: v } }))} />
          </div>

          {/* Approval limits */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-semibold text-slate-600 uppercase tracking-wide">Invoice approval limits</span>
              <button
                onClick={() => update(m => ({ ...m, header: { ...m.header, approvalLimits: [...(m.header.approvalLimits || []), { amount: '', approver: '' }] } }))}
                className="text-[9px] px-1.5 py-0.5 bg-green-50 text-green-700 border border-green-200 rounded hover:bg-green-100 inline-flex items-center gap-0.5">
                <Plus className="h-2.5 w-2.5" /> Add limit
              </button>
            </div>
            {(matrix?.header.approvalLimits?.length || 0) > 0 ? (
              <table className="w-full text-xs border border-slate-200 rounded">
                <thead><tr className="bg-slate-50 text-[9px] uppercase text-slate-500"><th className="px-2 py-1 text-left">Invoice amount</th><th className="px-2 py-1 text-left">Approver</th><th className="w-8"></th></tr></thead>
                <tbody>
                  {(matrix?.header.approvalLimits || []).map((lim, i) => (
                    <tr key={i} className="border-t border-slate-100">
                      <td className="px-1 py-0.5"><input value={lim.amount} onChange={e => update(m => { const limits = [...(m.header.approvalLimits || [])]; limits[i] = { ...limits[i], amount: e.target.value }; return { ...m, header: { ...m.header, approvalLimits: limits } }; })} className="w-full border rounded px-1.5 py-0.5 text-xs" placeholder="e.g. Up to £10,000" /></td>
                      <td className="px-1 py-0.5"><input value={lim.approver} onChange={e => update(m => { const limits = [...(m.header.approvalLimits || [])]; limits[i] = { ...limits[i], approver: e.target.value }; return { ...m, header: { ...m.header, approvalLimits: limits } }; })} className="w-full border rounded px-1.5 py-0.5 text-xs" placeholder="Approver name" /></td>
                      <td className="px-1 py-0.5 text-center"><button onClick={() => update(m => ({ ...m, header: { ...m.header, approvalLimits: (m.header.approvalLimits || []).filter((_, j) => j !== i) } }))} className="text-red-400 hover:text-red-600"><Trash2 className="h-3 w-3" /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-[10px] text-slate-400 italic">None recorded.</p>
            )}
          </div>

          {/* Conclusions */}
          <div>
            <p className="text-[10px] font-semibold text-slate-600 uppercase tracking-wide mb-1">Conclusions</p>
            <div className="space-y-1.5">
              <LabelledArea label="Design & Implementation" value={matrix?.conclusions.designAndImplementation || ''} onChange={v => update(m => ({ ...m, conclusions: { ...m.conclusions, designAndImplementation: v } }))} />
              <LabelledArea label="Plan to test controls?" value={matrix?.conclusions.planToTestControls || ''} onChange={v => update(m => ({ ...m, conclusions: { ...m.conclusions, planToTestControls: v } }))} />
              <LabelledArea label="Impact on substantive procedures" value={matrix?.conclusions.substantiveImpact || ''} onChange={v => update(m => ({ ...m, conclusions: { ...m.conclusions, substantiveImpact: v } }))} />
            </div>
          </div>

          {/* Steps grid */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-semibold text-slate-600 uppercase tracking-wide">Process steps</span>
              <button
                onClick={() => update(m => ({ ...m, steps: [...m.steps, newStep()] }))}
                className="text-[10px] px-2 py-0.5 bg-green-50 text-green-700 border border-green-200 rounded hover:bg-green-100 inline-flex items-center gap-0.5">
                <Plus className="h-3 w-3" /> Add step
              </button>
            </div>
            <div className="space-y-2">
              {(matrix?.steps || []).map((step) => (
                <StepCard
                  key={step.id}
                  step={step}
                  onChange={next => update(m => ({ ...m, steps: m.steps.map(s => s.id === step.id ? next : s) }))}
                  onRemove={() => update(m => ({ ...m, steps: m.steps.filter(s => s.id !== step.id) }))}
                />
              ))}
            </div>
          </div>

          {matrix?.importedAt && (
            <p className="text-[9px] text-slate-400 italic">
              Imported {matrix.sourceFileName ? `from ${matrix.sourceFileName}` : ''} on {new Date(matrix.importedAt).toLocaleDateString('en-GB')}.
            </p>
          )}
        </div>
      )}

      {showImport && (
        <ImportModal
          engagementId={engagementId}
          processLabel={processLabel}
          onClose={() => setShowImport(false)}
          onConfirm={async (parsed) => {
            // Save matrix locally (with scheduled save)
            setMatrix(parsed.matrix);
            scheduleSave(parsed.matrix);
            // Bubble matrix + narrative + controls so the parent can persist and trigger flowchart gen
            onImported?.({ matrix: parsed.matrix, narrative: parsed.narrative, controls: parsed.controls });
            setShowImport(false);
          }}
        />
      )}
    </div>
  );
});

function LabelledInput({ label, value, onChange, type = 'text' }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <label className="block">
      <span className="text-[9px] font-semibold uppercase text-slate-500">{label}</span>
      <input type={type} value={value} onChange={e => onChange(e.target.value)}
        className="mt-0.5 w-full border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:border-indigo-400" />
    </label>
  );
}

function LabelledArea({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="text-[9px] font-semibold uppercase text-slate-500">{label}</span>
      <textarea value={value} onChange={e => onChange(e.target.value)}
        className="mt-0.5 w-full border border-slate-200 rounded px-2 py-1 text-xs min-h-[40px] resize-y focus:outline-none focus:border-indigo-400" />
    </label>
  );
}

function StepCard({ step, onChange, onRemove }: { step: MatrixStep; onChange: (s: MatrixStep) => void; onRemove: () => void }) {
  const [collapsed, setCollapsed] = useState(false);

  function setPhase<K extends keyof MatrixStep['phases']>(phase: K, field: keyof PhaseCell, value: string) {
    onChange({ ...step, phases: { ...step.phases, [phase]: { ...step.phases[phase], [field]: value } } });
  }

  return (
    <div className="border border-slate-200 rounded-lg bg-slate-50/50">
      <div className="flex items-center gap-2 px-2 py-1.5 border-b border-slate-200 bg-white rounded-t-lg">
        <button onClick={() => setCollapsed(v => !v)} className="text-slate-400 hover:text-slate-600">
          {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
        <input
          value={step.label}
          onChange={e => onChange({ ...step, label: e.target.value })}
          placeholder="Process step name (e.g. Customer invoicing)"
          className="flex-1 text-xs font-semibold bg-transparent border-0 focus:outline-none focus:ring-0 text-slate-700"
        />
        <button onClick={onRemove} className="text-red-400 hover:text-red-600" title="Remove step"><Trash2 className="h-3 w-3" /></button>
      </div>
      {!collapsed && (
        <div className="p-2">
          {/* Phase grid: 4 columns with 4 sub-rows */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs border border-slate-200 rounded-lg">
              <thead>
                <tr className="bg-slate-100 text-[9px] uppercase text-slate-500">
                  <th className="w-28 px-2 py-1 text-left">Row</th>
                  {PHASE_KEYS.map(p => <th key={p} className="px-2 py-1 text-left">{PHASE_LABELS[p]}</th>)}
                </tr>
              </thead>
              <tbody>
                {([
                  { field: 'description' as const, label: 'Description' },
                  { field: 'control' as const, label: 'Control & assertion' },
                  { field: 'frequency' as const, label: 'Frequency' },
                  { field: 'evidence' as const, label: 'Walkthrough evidence' },
                ]).map(({ field, label }) => (
                  <tr key={field} className="border-t border-slate-100 align-top">
                    <td className="px-2 py-1 text-[10px] font-semibold text-slate-500 bg-slate-50">{label}</td>
                    {PHASE_KEYS.map(p => (
                      <td key={p} className="px-1 py-1">
                        <textarea
                          value={step.phases[p][field]}
                          onChange={e => setPhase(p, field, e.target.value)}
                          className="w-full border border-slate-200 rounded px-1.5 py-1 text-xs min-h-[48px] resize-y focus:outline-none focus:border-indigo-400"
                          placeholder="—"
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Weakness + screenshots */}
          <div className="grid grid-cols-2 gap-2 mt-2">
            <LabelledArea label="Control weakness / ML point" value={step.controlWeakness || ''} onChange={v => onChange({ ...step, controlWeakness: v })} />
            <LabelledArea label="Evidence screenshot refs" value={step.evidenceScreenshots || ''} onChange={v => onChange({ ...step, evidenceScreenshots: v })} />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Import modal ───

interface ParseResult {
  matrix: WalkthroughMatrix;
  narrative: string;
  controls: { description: string; type: string; frequency: string; tested: boolean }[];
  sheets: string[];
  sheetUsed: string;
}

function ImportModal({ engagementId, processLabel, onClose, onConfirm }: {
  engagementId: string;
  processLabel: string;
  onClose: () => void;
  onConfirm: (parsed: { matrix: WalkthroughMatrix; narrative: string; controls: ParseResult['controls'] }) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ParseResult | null>(null);
  const [populateNarrative, setPopulateNarrative] = useState(true);
  const [populateControls, setPopulateControls] = useState(true);

  async function parse() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`/api/engagements/${engagementId}/walkthrough-import`, { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) { setError(data?.error || 'Import failed'); return; }
      setResult(data as ParseResult);
    } catch (err: any) {
      setError(err?.message || 'Import failed');
    } finally { setBusy(false); }
  }

  function confirm() {
    if (!result) return;
    onConfirm({
      matrix: result.matrix,
      narrative: populateNarrative ? result.narrative : '',
      controls: populateControls ? result.controls : [],
    });
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/30" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-[720px] max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-800">Import walkthrough — {processLabel}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-[11px] text-slate-500">
            Upload an existing walkthrough Excel file (e.g. the standard template with <i>Initiation / Process / Recording / Reporting</i> columns). The matrix, header fields, and conclusions will be extracted.
          </p>

          {!result && (
            <>
              <div className="flex items-center gap-2">
                <label className="text-[11px] px-3 py-2 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded hover:bg-indigo-100 cursor-pointer inline-flex items-center gap-1">
                  <Upload className="h-3.5 w-3.5" /> Choose Excel file
                  <input type="file" accept=".xlsx,.xlsm" className="hidden" onChange={e => setFile(e.target.files?.[0] || null)} />
                </label>
                {file && <span className="text-[11px] text-slate-600">{file.name}</span>}
              </div>
              <button
                onClick={parse}
                disabled={!file || busy}
                className="px-3 py-2 bg-indigo-600 text-white text-xs font-medium rounded hover:bg-indigo-700 disabled:opacity-50 inline-flex items-center gap-1">
                {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                {busy ? 'Parsing…' : 'Parse file'}
              </button>
              {error && <p className="text-[11px] text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1">{error}</p>}
            </>
          )}

          {result && (
            <div className="space-y-3">
              <div className="bg-green-50 border border-green-200 rounded px-2 py-1.5 text-[11px] text-green-800">
                Parsed sheet <b>{result.sheetUsed}</b>. Found {result.matrix.steps.length} process step{result.matrix.steps.length === 1 ? '' : 's'} and {result.controls.length} control{result.controls.length === 1 ? '' : 's'}.
              </div>

              <div className="border border-slate-200 rounded p-2 text-[11px] text-slate-600 max-h-48 overflow-y-auto">
                <p className="font-semibold text-slate-700 mb-1">Preview</p>
                {result.matrix.header.processTitle && <p><b>Process:</b> {result.matrix.header.processTitle}</p>}
                {result.matrix.header.processOwner && <p><b>Owner:</b> {result.matrix.header.processOwner}</p>}
                {result.matrix.header.itSystems && <p><b>Systems:</b> {result.matrix.header.itSystems}</p>}
                {result.matrix.header.walkthroughDate && <p><b>Date:</b> {result.matrix.header.walkthroughDate}</p>}
                <ul className="list-disc ml-4 mt-1">
                  {result.matrix.steps.map((s, i) => <li key={i}>{s.label}</li>)}
                </ul>
              </div>

              <label className="flex items-center gap-2 text-[11px] text-slate-700">
                <input type="checkbox" checked={populateNarrative} onChange={e => setPopulateNarrative(e.target.checked)} />
                Also populate <b>Narrative</b> with a readable summary from the matrix
              </label>
              <label className="flex items-center gap-2 text-[11px] text-slate-700">
                <input type="checkbox" checked={populateControls} onChange={e => setPopulateControls(e.target.checked)} />
                Also populate <b>Controls</b> from "Identified control &amp; related assertion" rows
              </label>

              <div className="flex items-center gap-2">
                <button onClick={confirm} className="px-3 py-2 bg-indigo-600 text-white text-xs font-medium rounded hover:bg-indigo-700">
                  Confirm import
                </button>
                <button onClick={() => { setResult(null); setFile(null); }} className="px-3 py-2 bg-slate-100 text-slate-600 border border-slate-200 text-xs rounded hover:bg-slate-200">
                  Choose a different file
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
