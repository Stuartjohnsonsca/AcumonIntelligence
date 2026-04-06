'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Save, Loader2, Plus, X, Zap } from 'lucide-react';
import {
  DEFAULT_AGREED_DATES,
  DEFAULT_INFO_REQUEST_STANDARD,
  DEFAULT_INFO_REQUEST_PRELIMINARY,
  PERMANENT_FILE_SECTIONS,
} from '@/types/methodology';
import type { TemplateQuestion } from '@/types/methodology';
import { AppendixTemplateEditor } from './AppendixTemplateEditor';

interface Template {
  id: string;
  firmId: string;
  templateType: string;
  auditType: string;
  items: unknown;
}

interface Props {
  firmId: string;
  initialTemplates: Template[];
}

// Simple list templates (string arrays)
const LIST_TEMPLATE_TYPES = [
  { key: 'agreed_dates', label: 'Agreed Dates', defaults: DEFAULT_AGREED_DATES },
  { key: 'information_request_standard', label: 'Info Request (Standard)', defaults: DEFAULT_INFO_REQUEST_STANDARD },
  { key: 'information_request_preliminary', label: 'Info Request (Preliminary)', defaults: DEFAULT_INFO_REQUEST_PRELIMINARY },
  { key: 'permanent_file', label: 'Permanent File Sections', defaults: PERMANENT_FILE_SECTIONS.map((s) => s.label) },
];

// Structured appendix templates (TemplateQuestion arrays)
const APPENDIX_TEMPLATE_TYPES = [
  { key: 'permanent_file_questions', label: 'Permanent', sectionDefaults: PERMANENT_FILE_SECTIONS.map(s => s.label) },
  { key: 'ethics_questions', label: 'Ethics', sectionDefaults: ['Non Audit Services', 'Threats', 'Relationships', 'Other Considerations', 'Fee Assessment', 'ORITP'] },
  { key: 'continuance_questions', label: 'Continuance', sectionDefaults: ['Entity Details', 'Ownership', 'Continuity', 'Management Info', 'Nature of Business', 'Fee Considerations', 'Resourcing', 'EQR', 'AML', 'MLRO', 'Final Conclusion'] },
  { key: 'materiality_questions', label: 'Materiality', sectionDefaults: ['Benchmark', 'Justification', 'Overall Materiality Assessment', 'Performance Materiality'] },
  { key: 'new_client_takeon_questions', label: 'New Client Take-on', sectionDefaults: ['Client Information', 'Services to be Provided', 'Client Introduction', 'Previous Auditors', 'Ownership Information', 'Management Information', 'Nature of Business', 'Latest Financial Information', 'Ethical & Independence', 'Audit Risk Assessment', 'Fee Considerations', 'Resourcing Considerations', 'EQR Considerations', 'AML - Nature of Client', 'AML - Nature of Assignment', 'AML - Organisation Environment', 'AML - Fraud, Theft & Error', 'AML - Laws & Regulations', 'Discussion with MLRO', 'Proposed Conclusion', 'Discussion with Management Board', 'Next Steps', 'Final Conclusion'] },
  { key: 'audit_summary_memo_questions', label: 'Audit Summary Memo', sectionDefaults: ['Engagement Overview', 'Scope & Objectives', 'Key Audit Areas', 'Significant Risks', 'Key Findings', 'Going Concern', 'Subsequent Events', 'Related Party Transactions', 'Materiality Assessment', 'Error Summary', 'Unadjusted Differences', 'Fraud Considerations', 'Laws & Regulations', 'Management Representations', 'Audit Opinion', 'Communication with TCWG'] },
  { key: 'update_procedures_questions', label: 'Update Procedures', sectionDefaults: ['Subsequent Events Review', 'Management Representations Update', 'Going Concern Update', 'Post Year-End Trading', 'Legal & Compliance Update', 'Related Parties Update', 'Commitments & Contingencies', 'Final Analytical Review'] },
  { key: 'completion_checklist_questions', label: 'Completion Checklist', sectionDefaults: ['Audit Summary Memo', 'Error Schedule', 'Subsequent Events', 'Going Concern', 'Management Representations', 'Communication with TCWG', 'Related Parties', 'Laws & Regulations', 'Fraud', 'Accounting Estimates', 'Fair Values', 'Opening Balances', 'Comparatives', 'Group Considerations', 'Final Analytical Review', 'Quality Control', 'Documentation', 'Engagement Sign-Off'] },
  { key: 'overall_review_fs_questions', label: 'Overall Review of FS', sectionDefaults: ['Presentation & Disclosure', 'Accounting Policies', 'True & Fair View', 'Consistency', 'Directors Report', 'Strategic Report', 'Notes Completeness', 'Comparative Information', 'Other Information'] },
];

const TEMPLATE_TYPES = LIST_TEMPLATE_TYPES;
const AUDIT_TYPES = ['ALL', 'SME', 'PIE', 'SME_CONTROLS', 'PIE_CONTROLS'];

type ViewMode = 'lists' | 'appendix' | 'triggers';

const DEFAULT_ACTION_TRIGGERS = [
  'On Start',
  'On Upload',
  'On Push to Portal',
  'On Verification',
  'On Portal Response',
  'On Section Sign Off',
];

export function SchedulesClient({ firmId, initialTemplates }: Props) {
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
  const [activeAppendixType, setActiveAppendixType] = useState(APPENDIX_TEMPLATE_TYPES[0].key);
  const [activeAuditType, setActiveAuditType] = useState('ALL');
  const [tabLabels, setTabLabels] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    APPENDIX_TEMPLATE_TYPES.forEach(t => { m[t.key] = t.label; });
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

  async function handleAppendixSave(questions: TemplateQuestion[]) {
    const appendixKey = `${activeAppendixType}|${activeAuditType}`;
    setAppendixTemplates(prev => ({ ...prev, [appendixKey]: questions }));
    // Preserve sectionMeta for completion templates that use structured format
    const existingTemplate = initialTemplates.find(t => t.templateType === activeAppendixType && t.auditType === activeAuditType);
    const existingItems = existingTemplate?.items as any;
    const hasSectionMeta = existingItems && !Array.isArray(existingItems) && existingItems.sectionMeta;
    const items = hasSectionMeta ? { questions, sectionMeta: existingItems.sectionMeta } : questions;
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
  const currentAppendixType = APPENDIX_TEMPLATE_TYPES.find(t => t.key === activeAppendixType);

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
            {APPENDIX_TEMPLATE_TYPES.map(tt => (
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

          {/* Audit Type Filter */}
          <div className="flex space-x-2">
            {AUDIT_TYPES.map(at => (
              <button key={at} onClick={() => setActiveAuditType(at)}
                className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${activeAuditType === at ? 'bg-slate-700 text-white' : 'text-slate-600 bg-slate-100 hover:bg-slate-200'}`}>
                {at === 'ALL' ? 'All Types' : at.replace('_', ' ')}
              </button>
            ))}
          </div>

          {/* Appendix Template Editor */}
          <AppendixTemplateEditor
            firmId={firmId}
            templateType={activeAppendixType}
            auditType={activeAuditType}
            initialQuestions={currentAppendixQuestions}
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
            {at === 'ALL' ? 'All Types' : at.replace('_', ' ')}
          </button>
        ))}
      </div>

      {/* Items List */}
      <div className="border rounded-lg">
        <div className="px-4 py-3 bg-slate-50 rounded-t-lg flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-700">
            {TEMPLATE_TYPES.find((t) => t.key === activeTemplateType)?.label} ({activeAuditType === 'ALL' ? 'All Types' : activeAuditType.replace('_', ' ')})
          </h3>
          <Button onClick={handleSave} disabled={saving} size="sm" className="bg-blue-600 hover:bg-blue-700">
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
            <Button onClick={handleAdd} size="sm" variant="outline">
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
