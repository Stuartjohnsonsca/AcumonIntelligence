'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Save, Loader2, Plus, X, ChevronDown, ChevronRight, GripVertical, Pencil, Trash2, ArrowUp, ArrowDown, Copy, Check } from 'lucide-react';
import { useFirmVariables } from '@/hooks/useFirmVariables';
import { slugifyQuestionText } from '@/lib/formula-engine';
import type { TemplateQuestion, QuestionInputType, TemplateSectionMeta, SectionLayout } from '@/types/methodology';

interface Props {
  firmId: string;
  templateType: string;
  auditType: string;
  initialQuestions: TemplateQuestion[];
  sectionOptions: string[];
  initialSectionMeta?: Record<string, TemplateSectionMeta>;
  onSave: (questions: TemplateQuestion[], sectionMeta?: Record<string, TemplateSectionMeta>) => Promise<void>;
}

const LAYOUT_OPTIONS: { value: SectionLayout; label: string }[] = [
  { value: 'standard', label: 'Standard (Q&A)' },
  { value: 'table_3col', label: '3-Column Table' },
  { value: 'table_4col', label: '4-Column Table' },
  { value: 'table_5col', label: '5-Column Table' },
];

const LAYOUT_DEFAULT_HEADERS: Record<string, string[]> = {
  standard: [],
  table_4col: ['Item', 'Procedures Performed', 'Conclusion', 'WP Reference'],
  table_3col: ['Particulars', 'Audit Team Response', 'WP Reference'],
  table_5col: ['Particulars', 'Planning Amount', 'Final Amount', 'Comment', 'WP Reference'],
};

const INPUT_TYPE_OPTIONS: { value: QuestionInputType; label: string }[] = [
  { value: 'text', label: 'Free Text (single line)' },
  { value: 'textarea', label: 'Free Text (multi-line)' },
  { value: 'yesno', label: 'Y/N' },
  { value: 'yes_only', label: 'Y only' },
  { value: 'yna', label: 'Y/N/N/A' },
  { value: 'dropdown', label: 'Bespoke Dropdown' },
  { value: 'number', label: 'Number' },
  { value: 'currency', label: 'Currency' },
  { value: 'date', label: 'Date picker' },
  { value: 'formula', label: 'Formula (computed)' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'table_row', label: 'Table Row' },
  { value: 'subheader', label: 'Sub-header (group heading)' },
];

function generateId(): string {
  return `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function inputTypeBadge(inputType: string) {
  const cls = inputType === 'formula' ? 'bg-purple-100 text-purple-600' :
    inputType === 'dropdown' ? 'bg-blue-100 text-blue-600' :
    inputType === 'yesno' || inputType === 'yna' || inputType === 'yes_only' ? 'bg-green-100 text-green-600' :
    inputType === 'number' || inputType === 'currency' ? 'bg-amber-100 text-amber-600' :
    inputType === 'date' ? 'bg-indigo-100 text-indigo-600' :
    inputType === 'subheader' ? 'bg-slate-200 text-slate-700 font-semibold' :
    'bg-slate-100 text-slate-500';
  return <span className={`text-[10px] px-1.5 py-0.5 rounded whitespace-nowrap ${cls}`}>
    {INPUT_TYPE_OPTIONS.find(o => o.value === inputType)?.label || inputType}
  </span>;
}

// Isolated component for dropdown options — prevents parent re-renders from resetting input
function DropdownOptionsEditor({ options, onChange }: { options: string[]; onChange: (opts: string[]) => void }) {
  const [text, setText] = useState(options.join(', '));
  return (
    <div className="col-span-2">
      <label className="block text-xs text-slate-500 mb-1 font-medium">Dropdown Options (comma-separated)</label>
      <input
        type="text"
        value={text}
        onChange={e => setText(e.target.value)}
        onBlur={() => onChange(text.split(',').map(s => s.trim()).filter(Boolean))}
        className="w-full border border-slate-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
        placeholder="Option 1, Option 2, Option 3"
      />
    </div>
  );
}

export function AppendixTemplateEditor({ firmId, templateType, auditType, initialQuestions, sectionOptions, initialSectionMeta, onSave }: Props) {
  const [questions, setQuestions] = useState<TemplateQuestion[]>(initialQuestions);
  const [sectionMeta, setSectionMeta] = useState<Record<string, TemplateSectionMeta>>(initialSectionMeta || {});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Firm-wide variables available as formula chips. Loaded once and cached.
  const { list: firmVariables } = useFirmVariables();

  // Sync questions when template type or audit type changes
  useEffect(() => {
    setQuestions(initialQuestions);
    setSectionMeta(initialSectionMeta || {});
    setExpandedId(null);
  }, [templateType, auditType]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Tracks which question id was just copied so we can flash a green
  // tick for ~1.5s on that row. Lets the admin see feedback without a
  // toast library.
  const [copiedId, setCopiedId] = useState<string | null>(null);

  /** Copy a formula-safe reference for a question to the clipboard.
   *
   *  The formula engine's identifier regex is [A-Za-z_][A-Za-z0-9_]*
   *  — dashes aren't allowed. So a UUID-style id (`a1b2-c3d4`) can't
   *  be referenced directly in a formula, whereas a slug derived from
   *  the question text (`audit_fee`) always can. This helper picks:
   *    • the slug, if the question has text that slugifies to a
   *      valid identifier
   *    • the raw id, only when it's already identifier-safe
   *      (seeded templates that use snake_case ids like
   *      `audit_fee` directly)
   *
   *  Both are registered in the formula engine's values map, so
   *  whichever we copy will resolve at evaluation time. */
  async function copyQuestionReference(questionId: string) {
    const q = questions.find(qq => qq.id === questionId);
    const slug = slugifyQuestionText(q?.questionText);
    const isIdentifierSafe = (s: string) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(s);
    // Prefer a non-empty slug; fall back to the id (even if it has
    // dashes — caller might want it for Conditional-on or a cross
    // reference, not a formula).
    const ref = slug && isIdentifierSafe(slug) ? slug : questionId;
    try {
      await navigator.clipboard.writeText(ref);
    } catch {
      window.prompt('Question reference (copy this):', ref);
      return;
    }
    setCopiedId(questionId);
    window.setTimeout(() => setCopiedId(prev => (prev === questionId ? null : prev)), 1500);
  }
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [editingSectionName, setEditingSectionName] = useState<string | null>(null);
  const [sectionNameDraft, setSectionNameDraft] = useState('');

  // Group by section
  const sections = new Map<string, TemplateQuestion[]>();
  for (const q of questions) {
    if (!sections.has(q.sectionKey)) sections.set(q.sectionKey, []);
    sections.get(q.sectionKey)!.push(q);
  }

  function updateQuestion(id: string, updates: Partial<TemplateQuestion>) {
    setQuestions(prev => prev.map(q => q.id === id ? { ...q, ...updates } : q));
    setSaved(false);
  }

  function addQuestion(sectionKey: string) {
    const sectionQs = questions.filter(q => q.sectionKey === sectionKey);
    const maxSort = sectionQs.length > 0 ? Math.max(...sectionQs.map(q => q.sortOrder)) : -1;
    const newQ: TemplateQuestion = {
      id: generateId(),
      sectionKey,
      questionText: '',
      inputType: 'textarea',
      sortOrder: maxSort + 1,
    };
    setQuestions(prev => [...prev, newQ]);
    setExpandedId(newQ.id);
    setSaved(false);
  }

  /** Insert a sub-header row at the bottom of a section. Sub-headers
   *  render as a full-width grouping label in both the designer and
   *  the rendered form — they hold no answer value and don't
   *  participate in validation or formulas. */
  function addSubheader(sectionKey: string) {
    const sectionQs = questions.filter(q => q.sectionKey === sectionKey);
    const maxSort = sectionQs.length > 0 ? Math.max(...sectionQs.map(q => q.sortOrder)) : -1;
    const newQ: TemplateQuestion = {
      id: generateId(),
      sectionKey,
      questionText: 'New sub-header',
      inputType: 'subheader',
      sortOrder: maxSort + 1,
    };
    setQuestions(prev => [...prev, newQ]);
    setExpandedId(newQ.id);
    setSaved(false);
  }

  function removeQuestion(id: string) {
    if (!confirm('Delete this question?')) return;
    setQuestions(prev => prev.filter(q => q.id !== id));
    if (expandedId === id) setExpandedId(null);
    setSaved(false);
  }

  /** Move an entire section (and all its questions) up or down.
   *  Section order isn't stored explicitly — it comes from the order
   *  of questions in the `questions` array (via grouping). To move a
   *  section, we re-serialise the array with that section swapped
   *  past its neighbour. Per-section question sortOrder is preserved. */
  function moveSection(sectionKey: string, direction: 'up' | 'down') {
    setQuestions(prev => {
      // Derive current section order from question array order.
      const sectionOrder: string[] = [];
      for (const q of prev) {
        if (!sectionOrder.includes(q.sectionKey)) sectionOrder.push(q.sectionKey);
      }
      const idx = sectionOrder.indexOf(sectionKey);
      if (idx === -1) return prev;
      if (direction === 'up' && idx === 0) return prev;
      if (direction === 'down' && idx === sectionOrder.length - 1) return prev;
      const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
      [sectionOrder[idx], sectionOrder[swapIdx]] = [sectionOrder[swapIdx], sectionOrder[idx]];
      // Group by section then re-flatten in the new order, preserving
      // each section's internal sortOrder.
      const grouped = new Map<string, TemplateQuestion[]>();
      for (const q of prev) {
        if (!grouped.has(q.sectionKey)) grouped.set(q.sectionKey, []);
        grouped.get(q.sectionKey)!.push(q);
      }
      for (const qs of grouped.values()) qs.sort((a, b) => a.sortOrder - b.sortOrder);
      const reordered: TemplateQuestion[] = [];
      for (const key of sectionOrder) {
        const qs = grouped.get(key);
        if (qs) reordered.push(...qs);
      }
      return reordered;
    });
    setSaved(false);
  }

  function moveQuestion(id: string, direction: 'up' | 'down') {
    setQuestions(prev => {
      const idx = prev.findIndex(q => q.id === id);
      if (idx === -1) return prev;
      const sectionKey = prev[idx].sectionKey;
      const sectionQs = prev.filter(q => q.sectionKey === sectionKey).sort((a, b) => a.sortOrder - b.sortOrder);
      const sectionIdx = sectionQs.findIndex(q => q.id === id);
      if (direction === 'up' && sectionIdx === 0) return prev;
      if (direction === 'down' && sectionIdx === sectionQs.length - 1) return prev;

      const swapIdx = direction === 'up' ? sectionIdx - 1 : sectionIdx + 1;
      const tempSort = sectionQs[sectionIdx].sortOrder;
      return prev.map(q => {
        if (q.id === sectionQs[sectionIdx].id) return { ...q, sortOrder: sectionQs[swapIdx].sortOrder };
        if (q.id === sectionQs[swapIdx].id) return { ...q, sortOrder: tempSort };
        return q;
      });
    });
    setSaved(false);
  }

  function addSection() {
    const name = prompt('Enter new section name:');
    if (!name?.trim()) return;
    addQuestion(name.trim());
  }

  function renameSection(oldName: string) {
    setEditingSectionName(oldName);
    setSectionNameDraft(oldName);
  }

  function commitSectionRename() {
    if (!editingSectionName || !sectionNameDraft.trim()) {
      setEditingSectionName(null);
      return;
    }
    const newName = sectionNameDraft.trim();
    if (newName !== editingSectionName) {
      setQuestions(prev => prev.map(q =>
        q.sectionKey === editingSectionName ? { ...q, sectionKey: newName } : q
      ));
      setSaved(false);
    }
    setEditingSectionName(null);
  }

  function deleteSection(sectionKey: string) {
    const count = questions.filter(q => q.sectionKey === sectionKey).length;
    if (!confirm(`Delete section "${sectionKey}" and all ${count} question${count !== 1 ? 's' : ''}?`)) return;
    setQuestions(prev => prev.filter(q => q.sectionKey !== sectionKey));
    setSaved(false);
  }

  function toggleSection(sectionKey: string) {
    setCollapsedSections(prev => {
      const next = new Set(prev);
      if (next.has(sectionKey)) next.delete(sectionKey);
      else next.add(sectionKey);
      return next;
    });
  }

  function updateSectionMeta(sectionKey: string, updates: Partial<TemplateSectionMeta>) {
    setSectionMeta(prev => {
      const existing = prev[sectionKey] || { key: sectionKey, label: sectionKey, layout: 'standard' as SectionLayout };
      return { ...prev, [sectionKey]: { ...existing, ...updates } };
    });
    setSaved(false);
  }

  async function handleSave() {
    setSaving(true);
    try {
      await onSave(questions, Object.keys(sectionMeta).length > 0 ? sectionMeta : undefined);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      console.error('Save failed:', err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-xs text-slate-500">
          {questions.length} question{questions.length !== 1 ? 's' : ''} across {sections.size} section{sections.size !== 1 ? 's' : ''}
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={addSection} size="sm" variant="outline">
            <Plus className="h-4 w-4 mr-1" /> Add Section
          </Button>
          <Button onClick={handleSave} disabled={saving} size="sm" className="bg-blue-600 hover:bg-blue-700">
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
            {saved ? 'Saved ✓' : 'Save All'}
          </Button>
        </div>
      </div>

      {Array.from(sections.entries()).map(([sectionKey, sectionQs], sectionIdx, allSections) => {
        const isCollapsed = collapsedSections.has(sectionKey);
        const sorted = [...sectionQs].sort((a, b) => a.sortOrder - b.sortOrder);
        const isEditingName = editingSectionName === sectionKey;
        const isFirstSection = sectionIdx === 0;
        const isLastSection = sectionIdx === allSections.length - 1;

        return (
          <div key={sectionKey} className="border border-slate-200 rounded-lg overflow-hidden w-full">
            {/* Section header */}
            <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50 border-b border-slate-200">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <button onClick={() => toggleSection(sectionKey)} className="flex-shrink-0">
                  {isCollapsed ? <ChevronRight className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
                </button>
                {isEditingName ? (
                  <input type="text" value={sectionNameDraft} autoFocus
                    onChange={e => setSectionNameDraft(e.target.value)}
                    onBlur={commitSectionRename}
                    onKeyDown={e => { if (e.key === 'Enter') commitSectionRename(); if (e.key === 'Escape') setEditingSectionName(null); }}
                    className="px-2 py-0.5 text-sm font-semibold border border-blue-400 rounded focus:outline-none w-64" />
                ) : (
                  <button onClick={() => toggleSection(sectionKey)} className="text-left min-w-0">
                    <h4 className="text-sm font-semibold text-slate-700 truncate">{sectionKey}</h4>
                  </button>
                )}
                <span className="text-xs text-slate-400 flex-shrink-0">({sorted.length})</span>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                {/* Section Layout dropdown */}
                <select
                  value={sectionMeta[sectionKey]?.layout || 'standard'}
                  onChange={e => {
                    const layout = e.target.value as SectionLayout;
                    updateSectionMeta(sectionKey, {
                      layout,
                      columnHeaders: sectionMeta[sectionKey]?.columnHeaders || LAYOUT_DEFAULT_HEADERS[layout] || [],
                      signOff: sectionMeta[sectionKey]?.signOff ?? true,
                    });
                  }}
                  onClick={e => e.stopPropagation()}
                  className="text-[10px] border border-slate-200 rounded px-1.5 py-0.5 bg-white text-slate-600 focus:outline-none focus:border-blue-400"
                  title="Section layout type"
                >
                  {LAYOUT_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                </select>
                {/* Sign-off toggle */}
                <label className="inline-flex items-center gap-1 text-[10px] text-slate-500 cursor-pointer" onClick={e => e.stopPropagation()}>
                  <input type="checkbox" checked={sectionMeta[sectionKey]?.signOff !== false}
                    onChange={e => updateSectionMeta(sectionKey, { signOff: e.target.checked })}
                    className="w-3 h-3 rounded" />
                  Sign-off
                </label>
                {/* Section reorder — move the whole section (and its
                    questions) up or down in the schedule. Disabled at
                    the edges. */}
                <button
                  onClick={() => moveSection(sectionKey, 'up')}
                  disabled={isFirstSection}
                  title="Move section up"
                  className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-20 disabled:cursor-not-allowed rounded hover:bg-slate-100"
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => moveSection(sectionKey, 'down')}
                  disabled={isLastSection}
                  title="Move section down"
                  className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-20 disabled:cursor-not-allowed rounded hover:bg-slate-100"
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => renameSection(sectionKey)} title="Rename section"
                  className="p-1 text-slate-400 hover:text-blue-600 rounded hover:bg-blue-50">
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => deleteSection(sectionKey)} title="Delete section"
                  className="p-1 text-slate-400 hover:text-red-600 rounded hover:bg-red-50">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
                <button onClick={e => { e.stopPropagation(); addSubheader(sectionKey); }}
                  title="Add a sub-header row that groups the questions or rows below it"
                  className="text-xs text-slate-600 hover:text-slate-800 font-medium px-2 py-1 rounded hover:bg-slate-100">
                  + Sub-header
                </button>
                <button onClick={e => { e.stopPropagation(); addQuestion(sectionKey); }}
                  className="text-xs text-blue-600 hover:text-blue-700 font-medium px-2 py-1 rounded hover:bg-blue-50">
                  + Add {sectionMeta[sectionKey]?.layout !== 'standard' ? 'Row' : 'Question'}
                </button>
              </div>
            </div>

            {/* Column headers editor — only the header TEXT lives here,
                since headers are shared by every row in the table. The
                per-cell input type + dropdown options live on each
                question/row (see the expanded row editor), because
                different rows commonly need different widgets in the
                same column (e.g. a currency row and a commentary row
                sitting in the same Planning Amount column). */}
            {!isCollapsed && sectionMeta[sectionKey]?.layout && sectionMeta[sectionKey].layout !== 'standard' && (
              <div className="px-4 py-2 bg-blue-50/30 border-b border-slate-200 flex items-center gap-2 flex-wrap">
                <span className="text-[10px] text-blue-600 font-medium shrink-0">Column headings:</span>
                {(sectionMeta[sectionKey]?.columnHeaders || LAYOUT_DEFAULT_HEADERS[sectionMeta[sectionKey]!.layout] || []).map((h, hi) => (
                  <input
                    key={hi}
                    value={h}
                    onChange={e => {
                      const headers = [...(sectionMeta[sectionKey]?.columnHeaders || LAYOUT_DEFAULT_HEADERS[sectionMeta[sectionKey]!.layout] || [])];
                      headers[hi] = e.target.value;
                      updateSectionMeta(sectionKey, { columnHeaders: headers });
                    }}
                    className="text-[10px] border border-blue-200 rounded px-2 py-1 bg-white flex-1 min-w-[80px] focus:outline-none focus:border-blue-400"
                    placeholder={hi === 0 ? 'Label column' : `Column ${hi + 1}`}
                  />
                ))}
                <p className="w-full text-[10px] text-blue-700 italic mt-1">
                  Per-row cell configuration (input type / dropdown options / placeholder) is set on each question below — different rows can have different widgets in the same column.
                </p>
              </div>
            )}

            {/* Questions */}
            {!isCollapsed && (
              <div className="divide-y divide-slate-100">
                {sorted.map((q, i) => {
                  const isExpanded = expandedId === q.id;
                  const isSubheader = q.inputType === 'subheader';
                  return (
                    <div key={q.id} className={`group ${isSubheader ? 'bg-slate-100/70 hover:bg-slate-200/60' : 'hover:bg-slate-50/50'}`}>
                      {/* Question / sub-header row */}
                      <div className="flex items-center gap-2 px-4 py-2">
                        <GripVertical className="h-3 w-3 text-slate-300 flex-shrink-0 cursor-grab" />
                        <span className="text-[10px] text-slate-400 w-5 flex-shrink-0">{i + 1}</span>
                        <button
                          onClick={() => setExpandedId(isExpanded ? null : q.id)}
                          className={`flex-1 text-left min-w-0 ${isSubheader ? 'text-sm font-semibold text-slate-800 uppercase tracking-wide' : 'text-sm text-slate-700 hover:text-blue-600'}`}
                          title="Click to expand/collapse editing"
                        >
                          <span className="line-clamp-2">{q.questionText || <span className="italic text-slate-300">{isSubheader ? 'Sub-header text…' : 'New question...'}</span>}</span>
                        </button>
                        {inputTypeBadge(q.inputType)}
                        {/* Action buttons - always visible */}
                        <div className="flex items-center gap-0.5 ml-1 flex-shrink-0">
                          <button onClick={() => moveQuestion(q.id, 'up')} disabled={i === 0}
                            className="p-0.5 text-slate-400 hover:text-slate-700 disabled:opacity-20 disabled:cursor-not-allowed" title="Move up">
                            <ArrowUp className="h-3.5 w-3.5" />
                          </button>
                          <button onClick={() => moveQuestion(q.id, 'down')} disabled={i === sorted.length - 1}
                            className="p-0.5 text-slate-400 hover:text-slate-700 disabled:opacity-20 disabled:cursor-not-allowed" title="Move down">
                            <ArrowDown className="h-3.5 w-3.5" />
                          </button>
                          <button onClick={() => setExpandedId(isExpanded ? null : q.id)}
                            className="p-0.5 text-slate-400 hover:text-blue-600" title="Edit question">
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          {/* Copy Question Reference — puts the question's id on the
                              clipboard. Used for wiring up cross-references in other
                              tools (Handlebars, flow-engine rules, external docs).
                              In-schedule conditionals no longer need this since the
                              Conditional-on picker is a dropdown, but the copy button
                              stays useful for everything else. */}
                          <button
                            onClick={() => copyQuestionReference(q.id)}
                            className={`p-0.5 ${copiedId === q.id ? 'text-green-600' : 'text-slate-400 hover:text-indigo-600'}`}
                            title={copiedId === q.id ? 'Copied!' : 'Copy Question Reference (id)'}
                          >
                            {copiedId === q.id ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                          </button>
                          <button onClick={() => removeQuestion(q.id)}
                            className="p-0.5 text-red-300 hover:text-red-600" title="Delete question">
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Expanded edit form */}
                      {isExpanded && (
                        <div className="px-4 pb-4 pt-2 bg-blue-50/30 border-t border-blue-100">
                          <div className="grid grid-cols-2 gap-3">
                            <div className="col-span-2">
                              <label className="block text-xs text-slate-500 mb-1 font-medium">Question Text</label>
                              <textarea
                                value={q.questionText}
                                onChange={e => updateQuestion(q.id, { questionText: e.target.value })}
                                className="w-full border border-slate-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 min-h-[60px] resize-y"
                                placeholder="Enter the question text..."
                              />
                            </div>
                            <div>
                              <label className="block text-xs text-slate-500 mb-1 font-medium">Response Type</label>
                              <select
                                value={q.inputType}
                                onChange={e => updateQuestion(q.id, { inputType: e.target.value as QuestionInputType })}
                                className="w-full border border-slate-200 rounded px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                              >
                                {INPUT_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                              </select>
                            </div>
                            <div>
                              <label className="block text-xs text-slate-500 mb-1 font-medium">Section</label>
                              <select
                                value={q.sectionKey}
                                onChange={e => updateQuestion(q.id, { sectionKey: e.target.value })}
                                className="w-full border border-slate-200 rounded px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                              >
                                {Array.from(sections.keys()).map(s => <option key={s} value={s}>{s}</option>)}
                                {sectionOptions.filter(s => !sections.has(s)).map(s => <option key={s} value={s}>{s}</option>)}
                              </select>
                            </div>

                            {/* Dropdown options editor */}
                            {q.inputType === 'dropdown' && (
                              <DropdownOptionsEditor
                                key={q.id + '-dropdown'}
                                options={q.dropdownOptions || []}
                                onChange={opts => updateQuestion(q.id, { dropdownOptions: opts })}
                              />
                            )}

                            {/* Formula expression — with "insert" helper chips for field IDs and common operators */}
                            {q.inputType === 'formula' && (
                              <div className="col-span-2 space-y-1.5">
                                <label className="block text-xs text-slate-500 font-medium">Formula Expression</label>
                                <input
                                  type="text"
                                  value={q.formulaExpression || ''}
                                  onChange={e => updateQuestion(q.id, { formulaExpression: e.target.value })}
                                  className="w-full border border-slate-200 rounded px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-400"
                                  placeholder='e.g. audit_fee + non_audit_fee'
                                />
                                <div className="space-y-1">
                                  <p className="text-[10px] text-slate-500">
                                    Click a chip to append it to the expression. Use bare identifiers (no braces)
                                    for simple references. Arithmetic: <code className="bg-slate-100 px-1 rounded">+ - * /</code>.
                                    Functions:{' '}
                                    <code className="bg-slate-100 px-1 rounded">IF(cond, a, b)</code>,{' '}
                                    <code className="bg-slate-100 px-1 rounded">ROUND(x, 2)</code>,{' '}
                                    <code className="bg-slate-100 px-1 rounded">SUM(a, b, …)</code>,{' '}
                                    <code className="bg-slate-100 px-1 rounded">AVG(…)</code>,{' '}
                                    <code className="bg-slate-100 px-1 rounded">MIN(…)</code> /{' '}
                                    <code className="bg-slate-100 px-1 rounded">MAX(…)</code>,{' '}
                                    <code className="bg-slate-100 px-1 rounded">ABS(x)</code>,{' '}
                                    <code className="bg-slate-100 px-1 rounded">COUNT(…)</code>,{' '}
                                    <code className="bg-slate-100 px-1 rounded">PERCENT(num, den)</code>.
                                  </p>
                                  {/* Available fields in this template. Chips display the
                                      question text; clicking inserts a slug derived from the
                                      text (e.g. "Audit Fee" → audit_fee). The runtime resolves
                                      the slug via buildFormulaValues so bare-identifier
                                      references work regardless of whether the underlying id
                                      is a GUID or a snake_case string. */}
                                  {/* Search + scrollable chip list — the previous
                                      version silently hid anything past the 60th
                                      question, which is easy to hit on a long
                                      schedule. A tiny search box filters by text
                                      or slug; the list scrolls when it overflows. */}
                                  <FormulaFieldChips
                                    currentQuestionId={q.id}
                                    questions={questions}
                                    onInsert={(slug) => {
                                      const current = q.formulaExpression || '';
                                      const sep = current && !/[\s+\-*/(]$/.test(current) ? ' ' : '';
                                      updateQuestion(q.id, { formulaExpression: current + sep + slug });
                                    }}
                                  />
                                  <div className="flex flex-wrap gap-1">
                                    {[].map(() => null)}
                                    {/* Firm-wide variables — loaded dynamically from
                                         Methodology Admin → Firm-Wide Assumptions → Firm Variables */}
                                    {firmVariables.map(fv => (
                                      <button
                                        key={fv.name}
                                        type="button"
                                        onClick={() => {
                                          const current = q.formulaExpression || '';
                                          const sep = current && !/[\s+\-*/(]$/.test(current) ? ' ' : '';
                                          updateQuestion(q.id, { formulaExpression: current + sep + fv.name });
                                        }}
                                        title={`${fv.label} (${fv.value.toLocaleString('en-GB')}) — edit in Firm-Wide Assumptions`}
                                        className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-300 hover:bg-emerald-100"
                                      >
                                        {fv.name}
                                      </button>
                                    ))}
                                    {firmVariables.length === 0 && (
                                      <span className="text-[9px] text-slate-400 italic px-1">
                                        No firm variables — add some in Methodology Admin → Firm-Wide Assumptions → Firm Variables
                                      </span>
                                    )}
                                  </div>
                                  {/* Operator chips */}
                                  <div className="flex flex-wrap gap-1">
                                    {['+', '-', '*', '/', '(', ')', 'IF(', 'ROUND(', 'SUM(', 'AVG(', 'MIN(', 'MAX(', 'ABS(', 'PERCENT(', 'COUNT('].map(op => (
                                      <button
                                        key={op}
                                        type="button"
                                        onClick={() => {
                                          const current = q.formulaExpression || '';
                                          const sep = current && !/[\s+\-*/(]$/.test(current) ? ' ' : '';
                                          updateQuestion(q.id, { formulaExpression: current + sep + op });
                                        }}
                                        className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-300 hover:bg-slate-200"
                                      >
                                        {op}
                                      </button>
                                    ))}
                                    <button
                                      type="button"
                                      onClick={() => updateQuestion(q.id, { formulaExpression: '' })}
                                      className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-red-50 text-red-600 border border-red-200 hover:bg-red-100"
                                    >
                                      clear
                                    </button>
                                  </div>
                                </div>
                              </div>
                            )}

                            {/* Number validation */}
                            {(q.inputType === 'number' || q.inputType === 'currency') && (
                              <div className="col-span-2 grid grid-cols-3 gap-2">
                                <div>
                                  <label className="block text-xs text-slate-500 mb-1">Min</label>
                                  <input type="number" value={q.validationMin ?? ''} onChange={e => updateQuestion(q.id, { validationMin: e.target.value ? Number(e.target.value) : undefined })}
                                    className="w-full border border-slate-200 rounded px-2 py-1.5 text-sm" />
                                </div>
                                <div>
                                  <label className="block text-xs text-slate-500 mb-1">Max</label>
                                  <input type="number" value={q.validationMax ?? ''} onChange={e => updateQuestion(q.id, { validationMax: e.target.value ? Number(e.target.value) : undefined })}
                                    className="w-full border border-slate-200 rounded px-2 py-1.5 text-sm" />
                                </div>
                                <div>
                                  <label className="block text-xs text-slate-500 mb-1">Decimals</label>
                                  <input type="number" value={q.validationDecimals ?? ''} onChange={e => updateQuestion(q.id, { validationDecimals: e.target.value ? Number(e.target.value) : undefined })}
                                    className="w-full border border-slate-200 rounded px-2 py-1.5 text-sm" min={0} max={10} />
                                </div>
                              </div>
                            )}

                            {/* Conditional display */}
                            <div className="col-span-2 flex items-center gap-4 pt-1 border-t border-slate-100">
                              <label className="flex items-center gap-1.5 text-xs text-slate-600">
                                <input type="checkbox" checked={q.isRequired || false} onChange={e => updateQuestion(q.id, { isRequired: e.target.checked })} className="w-3.5 h-3.5 rounded" />
                                Required
                              </label>
                              <label
                                className="flex items-center gap-1.5 text-xs text-slate-600"
                                title="In a multi-column table section (3/4/5 columns), this row shows the description spanning all columns — no answer cells. Useful for section anchors or headline items above detail rows."
                              >
                                <input type="checkbox" checked={q.isBold || false} onChange={e => updateQuestion(q.id, { isBold: e.target.checked })} className="w-3.5 h-3.5 rounded" />
                                Description row (span all columns)
                              </label>

                              {/* Per-row column config — visible only when
                                  the parent section has a table layout AND
                                  the row isn't a description-span row.
                                  Each row defines its OWN per-column input
                                  types, so e.g. a currency row and a
                                  commentary row can sit in the same table
                                  with different widgets per cell. */}
                              {(() => {
                                const parentMeta = sectionMeta[q.sectionKey];
                                const parentLayout = parentMeta?.layout;
                                if (!parentLayout || parentLayout === 'standard') return null;
                                if (q.isBold || q.inputType === 'subheader') return null;
                                const headers = parentMeta?.columnHeaders || LAYOUT_DEFAULT_HEADERS[parentLayout] || [];
                                // Cells = non-label columns (skip index 0).
                                const cellCount = Math.max(0, headers.length - 1);
                                if (cellCount === 0) return null;
                                function updateRowCol(ci: number, patch: Partial<{ inputType: QuestionInputType; dropdownOptions: string[]; placeholder: string }>) {
                                  const current = (q.columns || []).slice();
                                  while (current.length <= ci) current.push({ inputType: 'textarea' } as any);
                                  current[ci] = { ...current[ci], ...patch };
                                  updateQuestion(q.id, { columns: current });
                                }
                                return (
                                  <div className="col-span-2 w-full pt-2 mt-1 border-t border-slate-100">
                                    <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-1">Per-cell configuration for this row</div>
                                    <div className="space-y-1">
                                      {Array.from({ length: cellCount }).map((_, ci) => {
                                        const cfg = q.columns?.[ci];
                                        const header = headers[ci + 1] || `Column ${ci + 2}`;
                                        return (
                                          <div key={ci} className="flex items-center gap-2 flex-wrap">
                                            <span className="text-[10px] text-slate-500 w-32 truncate" title={header}>
                                              <strong className="text-slate-700">Col {ci + 1}</strong> — {header}
                                            </span>
                                            <select
                                              value={cfg?.inputType || q.inputType}
                                              onChange={e => updateRowCol(ci, { inputType: e.target.value as QuestionInputType })}
                                              className="text-[10px] border border-slate-200 rounded px-2 py-1 bg-white focus:outline-none focus:border-blue-400"
                                              title="Input type for this cell only (this row's version of this column)"
                                            >
                                              {INPUT_TYPE_OPTIONS
                                                .filter(o => o.value !== 'subheader' && o.value !== 'table_row' && o.value !== 'formula' && o.value !== 'yes_only')
                                                .map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                                            </select>
                                            {cfg?.inputType === 'dropdown' && (
                                              <input
                                                type="text"
                                                value={(cfg?.dropdownOptions || []).join(', ')}
                                                onChange={e => updateRowCol(ci, { dropdownOptions: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                                                placeholder="Option 1, Option 2, Option 3"
                                                className="text-[10px] border border-slate-200 rounded px-2 py-1 flex-1 min-w-[120px] focus:outline-none focus:border-blue-400"
                                              />
                                            )}
                                            <input
                                              type="text"
                                              value={cfg?.placeholder || ''}
                                              onChange={e => updateRowCol(ci, { placeholder: e.target.value })}
                                              placeholder="Placeholder (optional)"
                                              className="text-[10px] border border-slate-200 rounded px-2 py-1 flex-1 min-w-[80px] focus:outline-none focus:border-blue-400"
                                            />
                                          </div>
                                        );
                                      })}
                                    </div>
                                    <p className="text-[10px] text-slate-500 italic mt-1">
                                      Leave alone to use the row&rsquo;s own input type ({INPUT_TYPE_OPTIONS.find(o => o.value === q.inputType)?.label || q.inputType}) for every cell; set per-cell to mix widgets in the same row.
                                    </p>
                                  </div>
                                );
                              })()}
                              <label
                                className="flex items-center gap-1.5 text-xs text-slate-500"
                                title={
                                  'Cross-reference this question to another schedule, so its value is pulled live from there (read-only here). Format: <schedule>.<questionKey> — e.g.\n' +
                                  '  ethics.independence_confirmed\n' +
                                  '  continuance.engagement_letter_date\n' +
                                  '  permanentFile.entity_address\n' +
                                  '  materiality.benchmark\n' +
                                  'Letter aliases also work: appendix_a = permanentFile, appendix_b = ethics, appendix_c = continuance, appendix_e = materiality.'
                                }
                              >
                                Cross-ref:
                                <input type="text" value={q.crossRef || ''} onChange={e => updateQuestion(q.id, { crossRef: e.target.value || undefined })}
                                  className="border border-slate-200 rounded px-2 py-1 text-xs w-56 font-mono" placeholder="ethics.independence_confirmed" />
                              </label>
                              {/* Conditional on: only show this question when ANOTHER
                                  question on this schedule satisfies an operator-based
                                  check. Three dropdowns + an optional value:
                                    [parent question]  [operator]  [value]
                                  Operator controls how the parent's answer is compared.
                                  isEmpty / isNotEmpty are unary (no value needed). */}
                              {(() => {
                                const cond = q.conditionalOn;
                                const condParentId = cond?.questionId || '';
                                const condOperator = (cond?.operator || 'eq') as NonNullable<typeof cond>['operator'];
                                const parent = questions.find(p => p.id === condParentId);
                                const siblings = questions.filter(p => p.id !== q.id);
                                const isUnary = condOperator === 'isEmpty' || condOperator === 'isNotEmpty';

                                function patchCond(patch: Partial<NonNullable<typeof q.conditionalOn>>) {
                                  const base = q.conditionalOn || { questionId: '', value: '' };
                                  updateQuestion(q.id, { conditionalOn: { ...base, ...patch } });
                                }

                                // Value-input adapts to parent's input type.
                                const valueInput = (() => {
                                  if (!parent || isUnary) return null;
                                  const current = cond?.value || '';
                                  const onValueChange = (v: string) => patchCond({ value: v });
                                  if (parent.inputType === 'dropdown' && Array.isArray(parent.dropdownOptions) && parent.dropdownOptions.length > 0) {
                                    return (
                                      <select value={current} onChange={e => onValueChange(e.target.value)}
                                        className="border border-slate-200 rounded px-2 py-1 text-xs w-32">
                                        <option value="">— answer —</option>
                                        {parent.dropdownOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                                      </select>
                                    );
                                  }
                                  if (parent.inputType === 'yesno' || parent.inputType === 'yes_only' || parent.inputType === 'yna' || parent.inputType === 'checkbox') {
                                    return (
                                      <select value={current} onChange={e => onValueChange(e.target.value)}
                                        className="border border-slate-200 rounded px-2 py-1 text-xs w-24">
                                        <option value="">— answer —</option>
                                        <option value="Y">Y</option>
                                        <option value="N">N</option>
                                        <option value="Yes">Yes</option>
                                        <option value="No">No</option>
                                        <option value="N/A">N/A</option>
                                        <option value="true">true</option>
                                        <option value="false">false</option>
                                      </select>
                                    );
                                  }
                                  // Numeric operators → number input for parity.
                                  const isNumeric = condOperator === 'gt' || condOperator === 'gte' || condOperator === 'lt' || condOperator === 'lte';
                                  return (
                                    <input
                                      type={isNumeric ? 'number' : 'text'}
                                      value={current}
                                      onChange={e => onValueChange(e.target.value)}
                                      placeholder={isNumeric ? '0' : 'expected value'}
                                      className="border border-slate-200 rounded px-2 py-1 text-xs w-32"
                                    />
                                  );
                                })();

                                return (
                                  <label className="flex items-center gap-1.5 text-xs text-slate-500 flex-wrap">
                                    Conditional on:
                                    <select
                                      value={condParentId}
                                      onChange={e => {
                                        const newParentId = e.target.value;
                                        if (!newParentId) updateQuestion(q.id, { conditionalOn: undefined });
                                        else patchCond({ questionId: newParentId });
                                      }}
                                      className="border border-slate-200 rounded px-2 py-1 text-xs max-w-[14rem]"
                                      title="Pick a sibling question — this question only shows when the chosen operator + value match"
                                    >
                                      <option value="">— Always show —</option>
                                      {siblings.map(p => (
                                        <option key={p.id} value={p.id}>
                                          {(p.questionText || '(untitled)').length > 50
                                            ? (p.questionText || '').slice(0, 50) + '…'
                                            : (p.questionText || '(untitled)')}
                                        </option>
                                      ))}
                                    </select>
                                    {condParentId && (
                                      <select
                                        value={condOperator}
                                        onChange={e => {
                                          const op = e.target.value as NonNullable<typeof q.conditionalOn>['operator'];
                                          // Clear value when switching to a unary operator.
                                          if (op === 'isEmpty' || op === 'isNotEmpty') patchCond({ operator: op, value: '' });
                                          else patchCond({ operator: op });
                                        }}
                                        className="border border-slate-200 rounded px-1.5 py-1 text-xs"
                                      >
                                        <option value="eq">equals</option>
                                        <option value="ne">does not equal</option>
                                        <option value="contains">contains text</option>
                                        <option value="notContains">does not contain text</option>
                                        <option value="gt">greater than</option>
                                        <option value="gte">greater or equal to</option>
                                        <option value="lt">less than</option>
                                        <option value="lte">less or equal to</option>
                                        <option value="isEmpty">is empty</option>
                                        <option value="isNotEmpty">is not empty</option>
                                      </select>
                                    )}
                                    {valueInput}
                                  </label>
                                );
                              })()}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
                {sorted.length === 0 && (
                  <div className="px-4 py-6 text-center text-xs text-slate-400 italic">
                    No questions in this section. Click &quot;+ Add Question&quot; above.
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {sections.size === 0 && (
        <div className="text-center py-12 text-slate-400 text-sm">
          No sections yet. Click &quot;Add Section&quot; to get started.
        </div>
      )}
    </div>
  );
}

/** Searchable, un-capped chip palette for formula field references.
 *
 *  Previously the palette listed up to 60 questions directly in the
 *  formula editor — anything past that silently disappeared, which on
 *  long schedules meant you'd see the "Copy Question Reference" button
 *  on a question but couldn't find its chip here. This version:
 *    • Shows every question (except the current one)
 *    • Filters by a search box (matches text + slug)
 *    • Scrolls when the list overflows — no more cap
 *    • Same behaviour as before otherwise: clicking a chip appends its
 *      slug to the formula expression with a sensible separator
 */
function FormulaFieldChips({
  currentQuestionId,
  questions,
  onInsert,
}: {
  currentQuestionId: string;
  questions: TemplateQuestion[];
  onInsert: (slug: string) => void;
}) {
  const [query, setQuery] = useState('');
  // Pre-compute slug for every sibling question with collision-safe suffixes.
  const rows = (() => {
    const usedSlugs = new Set<string>();
    return questions
      .filter(other => other.id !== currentQuestionId && other.id && (other.questionText || other.id))
      .map(other => {
        const base = slugifyQuestionText(other.questionText) || other.id;
        let slug = base;
        let n = 2;
        while (usedSlugs.has(slug)) slug = `${base}_${n++}`;
        usedSlugs.add(slug);
        const label = other.questionText && other.questionText.trim().length > 0
          ? (other.questionText.length > 40 ? other.questionText.slice(0, 40) + '…' : other.questionText)
          : other.id;
        return { id: other.id, slug, label, fullText: other.questionText || other.id };
      });
  })();
  const q = query.trim().toLowerCase();
  const filtered = q
    ? rows.filter(r => r.slug.toLowerCase().includes(q) || r.fullText.toLowerCase().includes(q))
    : rows;

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={`Search ${rows.length} fields…`}
          className="flex-1 text-[10px] border border-slate-200 rounded px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
        />
        <span className="text-[9px] text-slate-400 font-medium">
          {q ? `${filtered.length}/${rows.length}` : `${rows.length}`}
        </span>
      </div>
      <div className="flex flex-wrap gap-1 max-h-40 overflow-y-auto pr-1 border border-slate-100 rounded p-1 bg-white">
        {filtered.length === 0 ? (
          <span className="text-[9px] text-slate-400 italic px-1 py-0.5">No fields match &ldquo;{query}&rdquo;</span>
        ) : (
          filtered.map(row => (
            <button
              key={row.id}
              type="button"
              onClick={() => onInsert(row.slug)}
              title={`${row.fullText}  →  inserts "${row.slug}"`}
              className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100"
            >
              <span>{row.label}</span>
              <span className="font-mono text-[9px] text-blue-500">{row.slug}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
