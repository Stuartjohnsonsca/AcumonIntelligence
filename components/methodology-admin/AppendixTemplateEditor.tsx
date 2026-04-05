'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Save, Loader2, Plus, X, ChevronDown, ChevronRight, GripVertical, Pencil, Trash2, ArrowUp, ArrowDown } from 'lucide-react';
import type { TemplateQuestion, QuestionInputType } from '@/types/methodology';

interface Props {
  firmId: string;
  templateType: string;
  auditType: string;
  initialQuestions: TemplateQuestion[];
  sectionOptions: string[];
  onSave: (questions: TemplateQuestion[]) => Promise<void>;
}

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

export function AppendixTemplateEditor({ firmId, templateType, auditType, initialQuestions, sectionOptions, onSave }: Props) {
  const [questions, setQuestions] = useState<TemplateQuestion[]>(initialQuestions);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
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

  function removeQuestion(id: string) {
    if (!confirm('Delete this question?')) return;
    setQuestions(prev => prev.filter(q => q.id !== id));
    if (expandedId === id) setExpandedId(null);
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

  async function handleSave() {
    setSaving(true);
    try {
      await onSave(questions);
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

      {Array.from(sections.entries()).map(([sectionKey, sectionQs]) => {
        const isCollapsed = collapsedSections.has(sectionKey);
        const sorted = [...sectionQs].sort((a, b) => a.sortOrder - b.sortOrder);
        const isEditingName = editingSectionName === sectionKey;

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
                <button onClick={() => renameSection(sectionKey)} title="Rename section"
                  className="p-1 text-slate-400 hover:text-blue-600 rounded hover:bg-blue-50">
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => deleteSection(sectionKey)} title="Delete section"
                  className="p-1 text-slate-400 hover:text-red-600 rounded hover:bg-red-50">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
                <button onClick={e => { e.stopPropagation(); addQuestion(sectionKey); }}
                  className="text-xs text-blue-600 hover:text-blue-700 font-medium px-2 py-1 rounded hover:bg-blue-50">
                  + Add Question
                </button>
              </div>
            </div>

            {/* Questions */}
            {!isCollapsed && (
              <div className="divide-y divide-slate-100">
                {sorted.map((q, i) => {
                  const isExpanded = expandedId === q.id;
                  return (
                    <div key={q.id} className="group hover:bg-slate-50/50">
                      {/* Question row */}
                      <div className="flex items-center gap-2 px-4 py-2">
                        <GripVertical className="h-3 w-3 text-slate-300 flex-shrink-0 cursor-grab" />
                        <span className="text-[10px] text-slate-400 w-5 flex-shrink-0">{i + 1}</span>
                        <button
                          onClick={() => setExpandedId(isExpanded ? null : q.id)}
                          className="flex-1 text-left text-sm text-slate-700 hover:text-blue-600 min-w-0"
                          title="Click to expand/collapse editing"
                        >
                          <span className="line-clamp-2">{q.questionText || <span className="italic text-slate-300">New question...</span>}</span>
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

                            {/* Formula expression */}
                            {q.inputType === 'formula' && (
                              <div className="col-span-2">
                                <label className="block text-xs text-slate-500 mb-1 font-medium">Formula Expression</label>
                                <input
                                  type="text"
                                  value={q.formulaExpression || ''}
                                  onChange={e => updateQuestion(q.id, { formulaExpression: e.target.value })}
                                  className="w-full border border-slate-200 rounded px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-400"
                                  placeholder='IF({field_id}="Y", "Result A", "Result B")'
                                />
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
                              <label className="flex items-center gap-1.5 text-xs text-slate-500">
                                Cross-ref:
                                <input type="text" value={q.crossRef || ''} onChange={e => updateQuestion(q.id, { crossRef: e.target.value || undefined })}
                                  className="border border-slate-200 rounded px-2 py-1 text-xs w-44" placeholder="appendix_b.field_id" />
                              </label>
                              <label className="flex items-center gap-1.5 text-xs text-slate-500">
                                Conditional on:
                                <input type="text" value={q.conditionalOn || ''} onChange={e => updateQuestion(q.id, { conditionalOn: e.target.value || undefined })}
                                  className="border border-slate-200 rounded px-2 py-1 text-xs w-44" placeholder="other_question_key=Y" />
                              </label>
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
