'use client';

import { useState, useMemo, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Save, Loader2, Plus, X, Zap, Copy, Trash2 } from 'lucide-react';
import {
  DEFAULT_AGREED_DATES,
  DEFAULT_INFO_REQUEST_STANDARD,
  DEFAULT_INFO_REQUEST_PRELIMINARY,
  PERMANENT_FILE_SECTIONS,
} from '@/types/methodology';
import type { TemplateQuestion } from '@/types/methodology';
import { AppendixTemplateEditor } from './AppendixTemplateEditor';
import { useAuditTypes } from '@/hooks/useAuditTypes';

interface Template {
  id: string;
  firmId: string;
  templateType: string;
  auditType: string;
  items: unknown;
}

interface MasterSchedule {
  key: string;
  label: string;
  defaultStage?: string;
  stage?: string;
}

interface Props {
  firmId: string;
  initialTemplates: Template[];
  /**
   * The firm's master schedule list (from MethodologyRiskTable / 'master_schedules').
   * Any schedule here that isn't a built-in tool (Trial Balance, Portal, etc.) and
   * isn't in the hardcoded HARDCODED_APPENDIX list below is shown dynamically so
   * users can add questions to it.
   */
  masterSchedules?: MasterSchedule[];
}

/**
 * Master-schedule keys that have a dedicated React component (no questions form).
 * These are excluded from the "Appendix Templates" tab list because they don't
 * have configurable questions — the engagement renders them as built-in tools.
 */
const BUILT_IN_TOOL_SCHEDULE_KEYS = new Set([
  // Engagement tabs
  'opening',
  'prior_period',
  'trial_balance',
  'par',
  'walkthroughs',
  'rmm',
  'documents',
  'communication',
  'outstanding',
  'portal',
  // Completion sub-tabs that are panels (no questions)
  'fs_review',
  'adj_tb',
  'test_summary_results',
  'error_schedule',
  'eqr_review',
  'significant_risk_completion',
]);

// Simple list templates (string arrays)
const LIST_TEMPLATE_TYPES = [
  { key: 'agreed_dates', label: 'Agreed Dates', defaults: DEFAULT_AGREED_DATES },
  { key: 'information_request_standard', label: 'Info Request (Standard)', defaults: DEFAULT_INFO_REQUEST_STANDARD },
  { key: 'information_request_preliminary', label: 'Info Request (Preliminary)', defaults: DEFAULT_INFO_REQUEST_PRELIMINARY },
  { key: 'permanent_file', label: 'Permanent File Sections', defaults: PERMANENT_FILE_SECTIONS.map((s) => s.label) },
];

// Structured appendix templates (TemplateQuestion arrays).
// This is the BUILT-IN list — newly-added schedules from the master list are
// merged in dynamically inside the component (see appendixTemplateTypes useMemo).
const HARDCODED_APPENDIX_TEMPLATE_TYPES = [
  { key: 'permanent_file_questions', label: 'Permanent', sectionDefaults: PERMANENT_FILE_SECTIONS.map(s => s.label) },
  { key: 'ethics_questions', label: 'Ethics', sectionDefaults: ['Non Audit Services', 'Threats', 'Relationships', 'Other Considerations', 'Fee Assessment', 'ORITP'] },
  { key: 'continuance_questions', label: 'Continuance', sectionDefaults: ['Entity Details', 'Ownership', 'Continuity', 'Management Info', 'Nature of Business', 'Fee Considerations', 'Resourcing', 'EQR', 'AML', 'MLRO', 'Final Conclusion'] },
  { key: 'materiality_questions', label: 'Materiality', sectionDefaults: ['Benchmark', 'Justification', 'Overall Materiality Assessment', 'Performance Materiality'] },
  { key: 'new_client_takeon_questions', label: 'New Client Take-on', sectionDefaults: ['Client Information', 'Services to be Provided', 'Client Introduction', 'Previous Auditors', 'Ownership Information', 'Management Information', 'Nature of Business', 'Latest Financial Information', 'Ethical & Independence', 'Audit Risk Assessment', 'Fee Considerations', 'Resourcing Considerations', 'EQR Considerations', 'AML - Nature of Client', 'AML - Nature of Assignment', 'AML - Organisation Environment', 'AML - Fraud, Theft & Error', 'AML - Laws & Regulations', 'Discussion with MLRO', 'Proposed Conclusion', 'Discussion with Management Board', 'Next Steps', 'Final Conclusion'] },
  { key: 'audit_summary_memo_questions', label: 'Audit Summary Memo', sectionDefaults: ['Engagement Overview', 'Scope & Objectives', 'Key Audit Areas', 'Significant Risks', 'Key Findings', 'Going Concern', 'Subsequent Events', 'Related Party Transactions', 'Materiality Assessment', 'Error Summary', 'Unadjusted Differences', 'Fraud Considerations', 'Laws & Regulations', 'Management Representations', 'Audit Opinion', 'Communication with TCWG'] },
  { key: 'update_procedures_questions', label: 'Update Procedures', sectionDefaults: ['Subsequent Events Review', 'Management Representations Update', 'Going Concern Update', 'Post Year-End Trading', 'Legal & Compliance Update', 'Related Parties Update', 'Commitments & Contingencies', 'Final Analytical Review'] },
  { key: 'completion_checklist_questions', label: 'Completion Checklist', sectionDefaults: ['Audit Summary Memo', 'Error Schedule', 'Subsequent Events', 'Going Concern', 'Management Representations', 'Communication with TCWG', 'Related Parties', 'Laws & Regulations', 'Fraud', 'Accounting Estimates', 'Fair Values', 'Opening Balances', 'Comparatives', 'Group Considerations', 'Final Analytical Review', 'Quality Control', 'Documentation', 'Engagement Sign-Off'] },
  { key: 'overall_review_fs_questions', label: 'Overall Review of FS', sectionDefaults: ['Presentation & Disclosure', 'Accounting Policies', 'True & Fair View', 'Consistency', 'Directors Report', 'Strategic Report', 'Notes Completeness', 'Comparative Information', 'Other Information'] },
  { key: 'subsequent_events_questions', label: 'Subsequent Events', sectionDefaults: ['Subsequent Events Review'] },
  { key: 'tax_technical_categories', label: 'Tax Technical', sectionDefaults: ['Value Added Tax', 'Corporation Tax', 'Employment Taxes', 'Capital Allowances', 'Chargeable Gains', 'Stamp Duty Land Tax', 'Stamp Duty Reserve Tax', 'Trade Losses Utilisation/Surrender'] },
];

const TEMPLATE_TYPES = LIST_TEMPLATE_TYPES;
// Fallback when the dynamic audit-types catalogue hasn't loaded yet
// (initial render before useAuditTypes() resolves).
//
// Note: 'ALL' is intentionally NOT included. Schedules now belong to a
// specific audit type — the legacy 'ALL' bucket has been migrated to
// 'SME' via scripts/sql/migrate-all-to-sme.sql. The Schedule Designer
// no longer offers 'ALL' as a tab; templates accidentally tagged 'ALL'
// will simply not surface in the UI.
const FALLBACK_AUDIT_TYPES = ['SME', 'PIE', 'SME_CONTROLS', 'PIE_CONTROLS', 'GROUP'];
const FALLBACK_AUDIT_TYPE_LABELS: Record<string, string> = {
  ALL: 'All Types',
  SME: 'Statutory Audit',
  PIE: 'PIE Audit',
  SME_CONTROLS: 'Statutory Controls Based Audit',
  PIE_CONTROLS: 'PIE Controls Based Audit',
  GROUP: 'Group Audit',
};

type ViewMode = 'lists' | 'appendix' | 'triggers';

const DEFAULT_ACTION_TRIGGERS = [
  'On Start',
  'On Upload',
  'On Push to Portal',
  'On Verification',
  'On Portal Response',
  'On Section Sign Off',
];

export function SchedulesClient({ firmId, initialTemplates, masterSchedules }: Props) {
  // Audit-type catalogue from the firm's configured list. Falls back
  // to the historic hardcoded set during initial render. 'ALL' is no
  // longer a tab — every schedule now belongs to a specific audit
  // type (SME by default).
  const dynamicAuditTypes = useAuditTypes();
  const AUDIT_TYPES = useMemo(() => {
    const active = dynamicAuditTypes.filter(a => a.isActive);
    if (active.length === 0) return FALLBACK_AUDIT_TYPES;
    return active.map(a => a.code);
  }, [dynamicAuditTypes]);
  const AUDIT_TYPE_LABELS = useMemo(() => {
    const map: Record<string, string> = { ALL: 'All Types' };
    for (const a of dynamicAuditTypes) map[a.code] = a.label;
    // Layer fallback labels in case a code isn't in the catalogue
    // (defensive — an engagement using a code we've forgotten still
    // gets a sensible tab label).
    for (const [code, label] of Object.entries(FALLBACK_AUDIT_TYPE_LABELS)) {
      if (!(code in map)) map[code] = label;
    }
    return map;
  }, [dynamicAuditTypes]);
  // Dynamically build the appendix tab list:
  //   1. Start with the hardcoded entries (preserves existing labels and section defaults)
  //   2. Append any master-schedule entry that ISN'T already covered AND isn't a built-in tool
  //
  // Dedup is done on a NORMALISED key (suffix stripped) because the hardcoded list
  // and the master list have historically used inconsistent naming for the same
  // schedule — e.g. hardcoded `audit_summary_memo_questions` vs master
  // `audit_summary_memo`. Without normalisation, those two appear as duplicate tabs.
  const appendixTemplateTypes = useMemo(() => {
    const normalise = (k: string) => k.replace(/_(questions|categories)$/, '');
    const merged: Array<{ key: string; label: string; sectionDefaults: string[] }> = [
      ...HARDCODED_APPENDIX_TEMPLATE_TYPES,
    ];
    const seen = new Set(HARDCODED_APPENDIX_TEMPLATE_TYPES.map(t => normalise(t.key)));
    for (const ms of masterSchedules || []) {
      if (BUILT_IN_TOOL_SCHEDULE_KEYS.has(ms.key)) continue;
      const nk = normalise(ms.key);
      if (seen.has(nk)) continue;
      merged.push({
        key: ms.key,
        label: ms.label,
        sectionDefaults: ['General'],
      });
      seen.add(nk);
    }
    return merged;
  }, [masterSchedules]);

  const [templates, setTemplates] = useState<Record<string, string[]>>(() => {
    const map: Record<string, string[]> = {};
    for (const t of initialTemplates) {
      if (!t.templateType.endsWith('_questions')) {
        map[`${t.templateType}|${t.auditType}`] = t.items as string[];
      }
    }
    return map;
  });
  const [appendixTemplates, setAppendixTemplates] = useState<Record<string, TemplateQuestion[]>>(() => {
    const map: Record<string, TemplateQuestion[]> = {};
    for (const t of initialTemplates) {
      if (t.templateType.endsWith('_questions')) {
        // Handle both flat TemplateQuestion[] and structured { questions, sectionMeta } formats
        const items = t.items as any;
        map[`${t.templateType}|${t.auditType}`] = Array.isArray(items) ? items : (items?.questions || []);
      }
    }
    return map;
  });
  const [viewMode, setViewMode] = useState<ViewMode>('lists');
  const [activeTemplateType, setActiveTemplateType] = useState(TEMPLATE_TYPES[0].key);
  const [activeAppendixType, setActiveAppendixType] = useState(HARDCODED_APPENDIX_TEMPLATE_TYPES[0].key);
  // Default to Statutory Audit — historically schedules without a
  // specific audit type were tagged 'ALL'; those have been migrated to
  // 'SME' so SME is the natural starting tab.
  const [activeAuditType, setActiveAuditType] = useState('SME');

  // Self-heal if the dynamic catalogue resolves to a list that doesn't
  // include the current selection (e.g. an admin disables SME on a
  // bespoke firm). Pick the first available code so the editor never
  // shows blank tabs against a stale activeAuditType.
  useEffect(() => {
    if (AUDIT_TYPES.length > 0 && !AUDIT_TYPES.includes(activeAuditType)) {
      setActiveAuditType(AUDIT_TYPES[0]);
    }
  }, [AUDIT_TYPES, activeAuditType]);
  const [tabLabels, setTabLabels] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    HARDCODED_APPENDIX_TEMPLATE_TYPES.forEach(t => { m[t.key] = t.label; });
    // Also seed labels for any master-schedule entries that aren't hardcoded
    // (using the same normalisation rule as the appendixTemplateTypes dedup
    //  above so we don't seed a label for a key that's been suppressed as a dupe).
    const normalise = (k: string) => k.replace(/_(questions|categories)$/, '');
    const hardcodedNorms = new Set(HARDCODED_APPENDIX_TEMPLATE_TYPES.map(t => normalise(t.key)));
    for (const ms of masterSchedules || []) {
      if (BUILT_IN_TOOL_SCHEDULE_KEYS.has(ms.key)) continue;
      if (hardcodedNorms.has(normalise(ms.key))) continue;
      if (!m[ms.key]) m[ms.key] = ms.label;
    }
    return m;
  });
  const [editingLabel, setEditingLabel] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [newItem, setNewItem] = useState('');

  // Action Triggers
  const [actionTriggers, setActionTriggers] = useState<string[]>(() => {
    const triggerTemplate = initialTemplates.find(t => t.templateType === 'action_triggers');
    return (triggerTemplate?.items as string[]) || DEFAULT_ACTION_TRIGGERS;
  });
  const [newTrigger, setNewTrigger] = useState('');
  const [triggerSaving, setTriggerSaving] = useState(false);
  const [triggerSaved, setTriggerSaved] = useState(false);

  const key = `${activeTemplateType}|${activeAuditType}`;
  const currentItems = templates[key] || TEMPLATE_TYPES.find((t) => t.key === activeTemplateType)?.defaults || [];

  const setItems = (items: string[]) => {
    setTemplates((prev) => ({ ...prev, [key]: items }));
    setSaved(false);
  };

  const handleAdd = () => {
    if (newItem.trim()) {
      setItems([...currentItems, newItem.trim()]);
      setNewItem('');
    }
  };

  const handleRemove = (index: number) => {
    setItems(currentItems.filter((_, i) => i !== index));
  };

  const handleReorder = (from: number, to: number) => {
    const items = [...currentItems];
    const [moved] = items.splice(from, 1);
    items.splice(to, 0, moved);
    setItems(items);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await fetch('/api/methodology-admin/templates', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateType: activeTemplateType,
          auditType: activeAuditType,
          items: currentItems,
        }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      // handle error
    } finally {
      setSaving(false);
    }
  };

  async function handleAppendixSave(questions: TemplateQuestion[], sectionMeta?: Record<string, any>) {
    const appendixKey = `${activeAppendixType}|${activeAuditType}`;
    setAppendixTemplates(prev => ({ ...prev, [appendixKey]: questions }));
    // Use provided sectionMeta, or preserve existing if not provided
    const existingTemplate = initialTemplates.find(t => t.templateType === activeAppendixType && t.auditType === activeAuditType);
    const existingItems = existingTemplate?.items as any;
    const existingMeta = existingItems && !Array.isArray(existingItems) ? existingItems.sectionMeta : undefined;
    const finalMeta = sectionMeta || existingMeta;
    const items = finalMeta ? { questions, sectionMeta: finalMeta } : questions;
    await fetch('/api/methodology-admin/templates', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateType: activeAppendixType, auditType: activeAuditType, items }),
    });
  }

  async function handleTriggerSave() {
    setTriggerSaving(true);
    try {
      await fetch('/api/methodology-admin/templates', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateType: 'action_triggers', auditType: 'ALL', items: actionTriggers }),
      });
      setTriggerSaved(true);
      setTimeout(() => setTriggerSaved(false), 3000);
    } catch {}
    setTriggerSaving(false);
  }

  function handleAddTrigger() {
    if (newTrigger.trim() && !actionTriggers.includes(newTrigger.trim())) {
      setActionTriggers(prev => [...prev, newTrigger.trim()]);
      setNewTrigger('');
      setTriggerSaved(false);
    }
  }

  function handleRemoveTrigger(index: number) {
    setActionTriggers(prev => prev.filter((_, i) => i !== index));
    setTriggerSaved(false);
  }

  function handleReorderTrigger(from: number, to: number) {
    setActionTriggers(prev => {
      const items = [...prev];
      const [moved] = items.splice(from, 1);
      items.splice(to, 0, moved);
      return items;
    });
    setTriggerSaved(false);
  }

  const currentAppendixKey = `${activeAppendixType}|${activeAuditType}`;
  const currentAppendixQuestions = appendixTemplates[currentAppendixKey] || [];
  const currentAppendixType = appendixTemplateTypes.find(t => t.key === activeAppendixType);

  return (
    <div className="space-y-6">
      {/* View Mode Toggle */}
      <div className="flex items-center gap-2 bg-slate-100 rounded-lg p-1 w-fit">
        <button
          onClick={() => setViewMode('lists')}
          className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${viewMode === 'lists' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}
        >
          List Templates
        </button>
        <button
          onClick={() => setViewMode('appendix')}
          className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${viewMode === 'appendix' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}
        >
          Schedules
        </button>
        <button
          onClick={() => setViewMode('triggers')}
          className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${viewMode === 'triggers' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}
        >
          <Zap className="h-3.5 w-3.5 inline mr-1" />Action Triggers
        </button>
      </div>

      {viewMode === 'triggers' ? (
        <div className="border rounded-lg">
          <div className="px-4 py-3 bg-slate-50 rounded-t-lg flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-slate-700">Action Triggers</h3>
              <p className="text-xs text-slate-400 mt-0.5">Define triggers that can be assigned to schedule items. These appear as dropdowns in engagement tabs.</p>
            </div>
            <Button onClick={handleTriggerSave} disabled={triggerSaving} size="sm" className="bg-blue-600 hover:bg-blue-700">
              {triggerSaving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
              {triggerSaved ? 'Saved' : 'Save'}
            </Button>
          </div>
          <div className="p-4 space-y-1.5">
            {actionTriggers.map((trigger, i) => (
              <div key={i} className="flex items-center gap-3 group">
                <span className="text-xs text-slate-400 w-5 text-right font-mono">{i + 1}.</span>
                <div className="flex-1 flex items-center gap-2 bg-white border border-slate-200 rounded-md px-3 py-2">
                  <Zap className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" />
                  <span className="text-sm text-slate-700">{trigger}</span>
                </div>
                <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 transition-opacity w-16 justify-end">
                  {i > 0 && (
                    <button onClick={() => handleReorderTrigger(i, i - 1)} className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded">↑</button>
                  )}
                  {i < actionTriggers.length - 1 && (
                    <button onClick={() => handleReorderTrigger(i, i + 1)} className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded">↓</button>
                  )}
                  <button onClick={() => handleRemoveTrigger(i)} className="p-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}

            <div className="flex items-center gap-3 pt-3 border-t mt-3">
              <span className="w-5"></span>
              <input
                type="text"
                value={newTrigger}
                onChange={(e) => setNewTrigger(e.target.value)}
                placeholder="Add new trigger (e.g. On Review Complete)..."
                className="flex-1 border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                onKeyDown={(e) => e.key === 'Enter' && handleAddTrigger()}
              />
              <Button onClick={handleAddTrigger} size="sm" variant="outline" className="w-16">
                <Plus className="h-4 w-4 mr-1" /> Add
              </Button>
            </div>
          </div>
        </div>
      ) : viewMode === 'appendix' ? (
        <>
          {/* Appendix Type Tabs */}
          <div className="flex flex-wrap gap-2 border-b pb-2">
            {appendixTemplateTypes.map(tt => (
              <div key={tt.key} className="relative">
                {editingLabel === tt.key ? (
                  <input type="text" value={tabLabels[tt.key] || tt.label} autoFocus
                    onChange={e => setTabLabels(prev => ({ ...prev, [tt.key]: e.target.value }))}
                    onBlur={() => setEditingLabel(null)}
                    onKeyDown={e => { if (e.key === 'Enter') setEditingLabel(null); }}
                    className="px-4 py-2 text-sm font-medium rounded-t-md border border-blue-400 focus:outline-none w-32" />
                ) : (
                  <button onClick={() => setActiveAppendixType(tt.key)}
                    onDoubleClick={() => setEditingLabel(tt.key)}
                    className={`px-4 py-2 text-sm font-medium rounded-t-md transition-colors ${activeAppendixType === tt.key ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                    title="Double-click to rename">
                    {tabLabels[tt.key] || tt.label}
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* Audit Type Filter — only ONE is active at a time. The
              Copy / Delete actions in the toolbar below operate on the
              CURRENT (activeAppendixType, activeAuditType) cell. */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex space-x-2 flex-wrap">
              {AUDIT_TYPES.map(at => {
                // Mark tabs that have a saved template with a small
                // dot so the admin knows where work already exists
                // before they start clicking around.
                const exists = initialTemplates.some(t => t.templateType === activeAppendixType && t.auditType === at)
                  || appendixTemplates[`${activeAppendixType}|${at}`] !== undefined;
                return (
                  <button key={at} onClick={() => setActiveAuditType(at)}
                    className={`px-3 py-1.5 text-xs font-medium rounded transition-colors inline-flex items-center gap-1 ${activeAuditType === at ? 'bg-slate-700 text-white' : 'text-slate-600 bg-slate-100 hover:bg-slate-200'}`}>
                    {AUDIT_TYPE_LABELS[at] || at}
                    {exists && <span className={`inline-block w-1.5 h-1.5 rounded-full ${activeAuditType === at ? 'bg-emerald-300' : 'bg-emerald-500'}`} title="Schedule exists for this audit type" />}
                  </button>
                );
              })}
            </div>

            {/* Copy / Delete toolbar for the active schedule × type. */}
            <ScheduleAuditTypeActions
              auditTypes={AUDIT_TYPES}
              auditTypeLabels={AUDIT_TYPE_LABELS}
              activeAuditType={activeAuditType}
              copyDisabled={(currentAppendixQuestions || []).length === 0}
              onCopyTo={async (targetAuditType) => {
                if (targetAuditType === activeAuditType) return;

                // Only prompt for confirmation when the target already
                // has a saved schedule — the user explicitly asked for
                // copies to be NEW entries by default, with overwrite
                // confirmation reserved for the collision case.
                const targetKey = `${activeAppendixType}|${targetAuditType}`;
                const targetExistsInDb = initialTemplates.some(
                  t => t.templateType === activeAppendixType && t.auditType === targetAuditType,
                );
                const targetExistsInState = appendixTemplates[targetKey] !== undefined
                  && (appendixTemplates[targetKey] || []).length > 0;
                const wouldOverwrite = targetExistsInDb || targetExistsInState;

                if (wouldOverwrite) {
                  if (!confirm(
                    `A "${tabLabels[activeAppendixType] || activeAppendixType}" schedule already exists for `
                    + `${AUDIT_TYPE_LABELS[targetAuditType] || targetAuditType}.\n\n`
                    + `Overwrite it with the version from ${AUDIT_TYPE_LABELS[activeAuditType] || activeAuditType}?`,
                  )) return;
                }

                const existingTemplate = initialTemplates.find(t => t.templateType === activeAppendixType && t.auditType === activeAuditType);
                const existingItems = existingTemplate?.items as any;
                const existingMeta = existingItems && !Array.isArray(existingItems) ? existingItems.sectionMeta : undefined;
                const items = existingMeta ? { questions: currentAppendixQuestions, sectionMeta: existingMeta } : currentAppendixQuestions;
                const r = await fetch('/api/methodology-admin/templates', {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ templateType: activeAppendixType, auditType: targetAuditType, items }),
                });
                if (r.ok) {
                  // Update the local templates map so the source-of-truth
                  // for the editor switching to the target audit type
                  // matches what the server now has.
                  setAppendixTemplates(prev => ({ ...prev, [targetKey]: currentAppendixQuestions }));
                  alert(
                    wouldOverwrite
                      ? `Overwrote ${AUDIT_TYPE_LABELS[targetAuditType] || targetAuditType}.`
                      : `Copied to ${AUDIT_TYPE_LABELS[targetAuditType] || targetAuditType}.`,
                  );
                } else {
                  alert('Copy failed. Check the server logs.');
                }
              }}
              onDelete={async () => {
                if (!confirm(`Delete "${tabLabels[activeAppendixType] || activeAppendixType}" from ${AUDIT_TYPE_LABELS[activeAuditType] || activeAuditType}?\n\nThis only removes the copy under this audit type — copies under other audit types are unaffected.`)) return;
                const r = await fetch('/api/methodology-admin/templates', {
                  method: 'DELETE',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ templateType: activeAppendixType, auditType: activeAuditType }),
                });
                if (r.ok) {
                  // Drop from the local cache so the editor renders
                  // empty rather than the stale items.
                  setAppendixTemplates(prev => {
                    const c = { ...prev };
                    delete c[`${activeAppendixType}|${activeAuditType}`];
                    return c;
                  });
                  // Bounce to the first OTHER audit type that has a
                  // saved schedule for this tab — failing that, the
                  // first available audit type — so the admin lands on
                  // a meaningful editor rather than the now-empty tab.
                  const fallback = AUDIT_TYPES.find(at => at !== activeAuditType
                    && (initialTemplates.some(t => t.templateType === activeAppendixType && t.auditType === at)
                      || (appendixTemplates[`${activeAppendixType}|${at}`] || []).length > 0))
                    || AUDIT_TYPES.find(at => at !== activeAuditType)
                    || AUDIT_TYPES[0];
                  if (fallback) setActiveAuditType(fallback);
                } else {
                  alert('Delete failed. Check the server logs.');
                }
              }}
            />
          </div>

          {/* Appendix Template Editor */}
          <AppendixTemplateEditor
            firmId={firmId}
            templateType={activeAppendixType}
            auditType={activeAuditType}
            initialQuestions={currentAppendixQuestions}
            initialSectionMeta={(() => {
              const tpl = initialTemplates.find(t => t.templateType === activeAppendixType && t.auditType === activeAuditType);
              const items = tpl?.items as any;
              return items && !Array.isArray(items) ? items.sectionMeta : undefined;
            })()}
            sectionOptions={currentAppendixType?.sectionDefaults || []}
            onSave={handleAppendixSave}
          />
        </>
      ) : (
        <>
      {/* Template Type Tabs */}
      <div className="flex flex-wrap gap-2 border-b pb-2">
        {TEMPLATE_TYPES.map((tt) => (
          <button
            key={tt.key}
            onClick={() => setActiveTemplateType(tt.key)}
            className={`px-4 py-2 text-sm font-medium rounded-t-md transition-colors ${
              activeTemplateType === tt.key ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {tt.label}
          </button>
        ))}
      </div>

      {/* Audit Type Filter */}
      <div className="flex space-x-2">
        {AUDIT_TYPES.map((at) => (
          <button
            key={at}
            onClick={() => setActiveAuditType(at)}
            className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
              activeAuditType === at ? 'bg-slate-700 text-white' : 'text-slate-600 bg-slate-100 hover:bg-slate-200'
            }`}
          >
            {AUDIT_TYPE_LABELS[at] || at}
          </button>
        ))}
      </div>

      {/* Items List */}
      <div className="border rounded-lg">
        <div className="px-4 py-3 bg-slate-50 rounded-t-lg flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-700">
            {TEMPLATE_TYPES.find((t) => t.key === activeTemplateType)?.label} ({activeAuditType === 'ALL' ? 'All Types' : activeAuditType.replace('_', ' ')})
          </h3>
          <Button onClick={handleSave} disabled={saving} size="sm" className="bg-blue-600 hover:bg-blue-700" data-howto-id="amt.schedules.save">
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
            {saved ? 'Saved' : 'Save'}
          </Button>
        </div>
        <div className="p-4 space-y-2">
          {currentItems.map((item, i) => (
            <div key={i} className="flex items-center space-x-2 group">
              <span className="text-xs text-slate-400 w-6 text-right">{i + 1}.</span>
              <span className="flex-1 text-sm text-slate-700 bg-white border border-slate-200 rounded px-3 py-2">
                {typeof item === 'string' ? item : (item as any).label || JSON.stringify(item)}
              </span>
              <div className="opacity-0 group-hover:opacity-100 flex space-x-1 transition-opacity">
                {i > 0 && (
                  <button onClick={() => handleReorder(i, i - 1)} className="text-slate-400 hover:text-slate-600 text-xs px-1">
                    ↑
                  </button>
                )}
                {i < currentItems.length - 1 && (
                  <button onClick={() => handleReorder(i, i + 1)} className="text-slate-400 hover:text-slate-600 text-xs px-1">
                    ↓
                  </button>
                )}
                <button onClick={() => handleRemove(i)} className="text-red-400 hover:text-red-600">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}

          {/* Add new item */}
          <div className="flex items-center space-x-2 pt-2 border-t mt-3">
            <input
              type="text"
              value={newItem}
              onChange={(e) => setNewItem(e.target.value)}
              placeholder="Add new item..."
              className="flex-1 border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            />
            <Button onClick={handleAdd} size="sm" variant="outline" data-howto-id="amt.schedules.add-question">
              <Plus className="h-4 w-4 mr-1" /> Add
            </Button>
          </div>
        </div>
      </div>
        </>
      )}
    </div>
  );
}

/**
 * Per-schedule × audit-type Copy / Delete actions.
 *
 * Renders next to the audit-type tab strip so admins can:
 *   - Copy the active schedule's items into another audit type
 *     (creates a new entry by default; only confirms-overwrite when
 *     the target already has a saved schedule)
 *   - Delete the schedule's copy under the active audit type
 *
 * Legacy 'ALL' is filtered out from copy targets defensively — the
 * Schedule Designer no longer surfaces it as a tab post the
 * migrate-all-to-sme.sql migration, but if an older audit-types
 * catalogue still produces it we don't want it showing up as a
 * destination.
 */
function ScheduleAuditTypeActions({
  auditTypes,
  auditTypeLabels,
  activeAuditType,
  copyDisabled,
  onCopyTo,
  onDelete,
}: {
  auditTypes: string[];
  auditTypeLabels: Record<string, string>;
  activeAuditType: string;
  copyDisabled: boolean;
  onCopyTo: (target: string) => void;
  onDelete: () => void;
}) {
  const [copyOpen, setCopyOpen] = useState(false);
  const targets = auditTypes.filter(at => at !== activeAuditType && at !== 'ALL');

  return (
    <div className="ml-auto flex items-center gap-2">
      {/* Copy to... — popover menu. Disabled when the editor has
          no questions to copy (avoids creating an empty target row). */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setCopyOpen(v => !v)}
          disabled={copyDisabled || targets.length === 0}
          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-40"
          title={copyDisabled ? 'Nothing to copy yet — save some questions first.' : 'Copy this schedule to another audit type'}
        >
          <Copy className="w-3 h-3" />Copy to…
        </button>
        {copyOpen && (
          <div className="absolute right-0 mt-1 z-20 w-56 bg-white border border-slate-200 rounded-md shadow-lg py-1">
            {targets.length === 0 ? (
              <div className="px-3 py-2 text-xs text-slate-500 italic">No other audit types available.</div>
            ) : targets.map(t => (
              <button
                key={t}
                onClick={() => { setCopyOpen(false); onCopyTo(t); }}
                className="w-full text-left px-3 py-1.5 text-xs text-slate-700 hover:bg-blue-50 hover:text-blue-700"
              >
                {auditTypeLabels[t] || t}
              </button>
            ))}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={onDelete}
        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded border border-red-300 text-red-700 bg-white hover:bg-red-50"
        title="Delete this schedule from the current audit type only"
      >
        <Trash2 className="w-3 h-3" />Delete from this type
      </button>
    </div>
  );
}
