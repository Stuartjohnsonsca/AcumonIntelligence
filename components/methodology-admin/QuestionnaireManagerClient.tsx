'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Plus, Trash2, Save, Loader2, X, ChevronDown, ChevronUp,
  GripVertical, Search, Copy, ClipboardList, Mic, Upload, GitBranch,
} from 'lucide-react';
import { BackButton } from './BackButton';

// ─── Types ───────────────────────────────────────────────────────
type AnswerType = 'preset' | 'free_text' | 'yes_no' | 'yes_no_na' | 'scale' | 'multi_choice';

interface AnswerOption {
  id: string;
  label: string;
}

// Conditional branching: "if answer is X, go to question Y (or end group)"
interface BranchRule {
  id: string;
  condition: string;   // answer value that triggers the rule (e.g. 'Yes', 'No', option label)
  action: 'skip_to' | 'end_group';  // skip to a specific question or end the group
  targetQuestionId?: string;         // target question id (for skip_to)
}

interface Question {
  id: string;
  text: string;
  answerType: AnswerType;
  options: AnswerOption[];  // For preset / multi_choice
  required: boolean;
  helpText: string;
  allowExplanation: boolean;  // Show free text explanation box after selection
  explanationLabel: string;   // Custom label for the explanation box
  allowVoiceResponse: boolean;  // Enable voice recording with speech-to-text
  allowFileUpload: boolean;     // Allow document/file upload as part of response
  fileUploadLabel: string;      // Custom label for file upload prompt
  acceptedFileTypes: string;    // e.g. '*' for any, or '.pdf,.docx' etc.
  branchRules: BranchRule[];    // Conditional branching rules
}

interface QuestionGroup {
  id: string;
  title: string;
  description: string;
  questions: Question[];
}

interface Questionnaire {
  id: string;
  name: string;
  description: string;
  auditType: string;
  groups: QuestionGroup[];
  createdAt: string | null;
  updatedAt: string | null;
}

interface Props {
  initialQuestionnaires: any[];
}

const ANSWER_TYPES: { value: AnswerType; label: string; description: string }[] = [
  { value: 'yes_no', label: 'Yes / No', description: 'Two-option response' },
  { value: 'yes_no_na', label: 'Yes / No / N/A', description: 'Three-option response' },
  { value: 'preset', label: 'Preset Answers', description: 'Choose from a defined list' },
  { value: 'multi_choice', label: 'Multi-Choice', description: 'Select multiple from a list' },
  { value: 'free_text', label: 'Free Text', description: 'Open text response' },
  { value: 'scale', label: 'Scale (1–5)', description: 'Numeric rating scale' },
];

const AUDIT_TYPES = [
  { value: 'ALL', label: 'All Types' },
  { value: 'SME', label: 'SME' },
  { value: 'PIE', label: 'PIE' },
  { value: 'SME_CONTROLS', label: 'SME Controls' },
  { value: 'PIE_CONTROLS', label: 'PIE Controls' },
];

let idCounter = 0;
function uid() { return `q_${Date.now()}_${++idCounter}`; }

function newOption(): AnswerOption { return { id: uid(), label: '' }; }
function newQuestion(): Question {
  return { id: uid(), text: '', answerType: 'yes_no', options: [], required: true, helpText: '', allowExplanation: false, explanationLabel: 'Please explain', allowVoiceResponse: false, allowFileUpload: false, fileUploadLabel: 'Upload supporting document', acceptedFileTypes: '*', branchRules: [] };
}
function newGroup(): QuestionGroup {
  return { id: uid(), title: '', description: '', questions: [newQuestion()] };
}

// Helper: get possible answer values for branching conditions
function getAnswerValues(q: Question): string[] {
  switch (q.answerType) {
    case 'yes_no': return ['Yes', 'No'];
    case 'yes_no_na': return ['Yes', 'No', 'N/A'];
    case 'preset':
    case 'multi_choice':
      return q.options.map(o => o.label).filter(Boolean);
    case 'scale': return ['1', '2', '3', '4', '5'];
    case 'free_text': return ['Any response', 'No response'];
    default: return [];
  }
}

// Helper: question label for target dropdown
function questionLabel(q: Question, gi: number, qi: number): string {
  const text = q.text || 'Untitled';
  return `${gi + 1}.${qi + 1} — ${text.length > 40 ? text.slice(0, 40) + '…' : text}`;
}

// ─── Component ───────────────────────────────────────────────────
export function QuestionnaireManagerClient({ initialQuestionnaires }: Props) {
  const [questionnaires, setQuestionnaires] = useState<Questionnaire[]>(
    initialQuestionnaires.map((q: any) => ({
      id: q.id,
      name: q.name || '',
      description: q.description || '',
      auditType: q.auditType || 'ALL',
      groups: q.groups || [],
      createdAt: q.createdAt,
      updatedAt: q.updatedAt,
    }))
  );
  const [selected, setSelected] = useState<Questionnaire | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Edit state
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editAuditType, setEditAuditType] = useState('ALL');
  const [editGroups, setEditGroups] = useState<QuestionGroup[]>([]);

  const filtered = questionnaires.filter(q =>
    !searchQuery || q.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  function startCreate() {
    setIsCreating(true);
    setIsEditing(true);
    setSelected(null);
    setEditName('');
    setEditDescription('');
    setEditAuditType('ALL');
    setEditGroups([newGroup()]);
  }

  function startEdit(q: Questionnaire) {
    setSelected(q);
    setIsEditing(true);
    setIsCreating(false);
    setEditName(q.name);
    setEditDescription(q.description);
    setEditAuditType(q.auditType);
    setEditGroups(JSON.parse(JSON.stringify(q.groups))); // deep clone
  }

  function cancelEdit() {
    setIsEditing(false);
    setIsCreating(false);
  }

  // ─── Group operations ──────────────────────────────────────────
  function updateGroup(groupId: string, patch: Partial<QuestionGroup>) {
    setEditGroups(gs => gs.map(g => g.id === groupId ? { ...g, ...patch } : g));
  }

  function removeGroup(groupId: string) {
    setEditGroups(gs => gs.filter(g => g.id !== groupId));
  }

  function moveGroup(groupId: string, dir: -1 | 1) {
    setEditGroups(gs => {
      const idx = gs.findIndex(g => g.id === groupId);
      if (idx < 0 || idx + dir < 0 || idx + dir >= gs.length) return gs;
      const copy = [...gs];
      [copy[idx], copy[idx + dir]] = [copy[idx + dir], copy[idx]];
      return copy;
    });
  }

  // ─── Question operations ───────────────────────────────────────
  function updateQuestion(groupId: string, questionId: string, patch: Partial<Question>) {
    setEditGroups(gs => gs.map(g => g.id === groupId ? {
      ...g,
      questions: g.questions.map(q => q.id === questionId ? { ...q, ...patch } : q),
    } : g));
  }

  function addQuestion(groupId: string) {
    setEditGroups(gs => gs.map(g => g.id === groupId ? {
      ...g, questions: [...g.questions, newQuestion()],
    } : g));
  }

  function removeQuestion(groupId: string, questionId: string) {
    setEditGroups(gs => gs.map(g => g.id === groupId ? {
      ...g, questions: g.questions.filter(q => q.id !== questionId),
    } : g));
  }

  function moveQuestion(groupId: string, questionId: string, dir: -1 | 1) {
    setEditGroups(gs => gs.map(g => {
      if (g.id !== groupId) return g;
      const idx = g.questions.findIndex(q => q.id === questionId);
      if (idx < 0 || idx + dir < 0 || idx + dir >= g.questions.length) return g;
      const qs = [...g.questions];
      [qs[idx], qs[idx + dir]] = [qs[idx + dir], qs[idx]];
      return { ...g, questions: qs };
    }));
  }

  // Move question to a different group
  function moveQuestionToGroup(fromGroupId: string, questionId: string, toGroupId: string) {
    setEditGroups(gs => {
      const fromGroup = gs.find(g => g.id === fromGroupId);
      const question = fromGroup?.questions.find(q => q.id === questionId);
      if (!question) return gs;
      return gs.map(g => {
        if (g.id === fromGroupId) return { ...g, questions: g.questions.filter(q => q.id !== questionId) };
        if (g.id === toGroupId) return { ...g, questions: [...g.questions, question] };
        return g;
      });
    });
  }

  // ─── Branch rule operations ─────────────────────────────────────
  function addBranchRule(groupId: string, questionId: string) {
    const group = editGroups.find(g => g.id === groupId);
    const question = group?.questions.find(q => q.id === questionId);
    if (!question) return;
    const values = getAnswerValues(question);
    const usedConditions = (question.branchRules || []).map(r => r.condition);
    const firstUnused = values.find(v => !usedConditions.includes(v)) || values[0] || '';
    const newRule: BranchRule = { id: uid(), condition: firstUnused, action: 'end_group' };
    updateQuestion(groupId, questionId, {
      branchRules: [...(question.branchRules || []), newRule],
    });
  }

  function updateBranchRule(groupId: string, questionId: string, ruleId: string, patch: Partial<BranchRule>) {
    setEditGroups(gs => gs.map(g => g.id === groupId ? {
      ...g, questions: g.questions.map(q => q.id === questionId ? {
        ...q, branchRules: (q.branchRules || []).map(r => r.id === ruleId ? { ...r, ...patch } : r),
      } : q),
    } : g));
  }

  function removeBranchRule(groupId: string, questionId: string, ruleId: string) {
    setEditGroups(gs => gs.map(g => g.id === groupId ? {
      ...g, questions: g.questions.map(q => q.id === questionId ? {
        ...q, branchRules: (q.branchRules || []).filter(r => r.id !== ruleId),
      } : q),
    } : g));
  }

  // ─── Option operations ─────────────────────────────────────────
  function addOption(groupId: string, questionId: string) {
    updateQuestion(groupId, questionId, {
      options: [...(editGroups.find(g => g.id === groupId)?.questions.find(q => q.id === questionId)?.options || []), newOption()],
    });
  }

  function updateOption(groupId: string, questionId: string, optionId: string, label: string) {
    setEditGroups(gs => gs.map(g => g.id === groupId ? {
      ...g, questions: g.questions.map(q => q.id === questionId ? {
        ...q, options: q.options.map(o => o.id === optionId ? { ...o, label } : o),
      } : q),
    } : g));
  }

  function removeOption(groupId: string, questionId: string, optionId: string) {
    setEditGroups(gs => gs.map(g => g.id === groupId ? {
      ...g, questions: g.questions.map(q => q.id === questionId ? {
        ...q, options: q.options.filter(o => o.id !== optionId),
      } : q),
    } : g));
  }

  // ─── Save ──────────────────────────────────────────────────────
  async function handleSave() {
    if (!editName.trim()) return;
    setSaving(true);
    try {
      const payload = {
        templateType: 'questionnaire',
        auditType: editAuditType,
        items: { name: editName, description: editDescription, groups: editGroups },
      };

      if (isCreating) {
        const res = await fetch('/api/methodology-admin/templates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          const data = await res.json();
          const q: Questionnaire = {
            id: data.id,
            name: editName,
            description: editDescription,
            auditType: editAuditType,
            groups: editGroups,
            createdAt: data.createdAt,
            updatedAt: data.updatedAt,
          };
          setQuestionnaires([q, ...questionnaires]);
          setSelected(q);
          setIsCreating(false);
          setIsEditing(false);
        }
      } else if (selected) {
        const res = await fetch(`/api/methodology-admin/templates/${selected.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          const updated: Questionnaire = {
            ...selected,
            name: editName,
            description: editDescription,
            auditType: editAuditType,
            groups: editGroups,
            updatedAt: new Date().toISOString(),
          };
          setQuestionnaires(questionnaires.map(q => q.id === selected.id ? updated : q));
          setSelected(updated);
          setIsEditing(false);
        }
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this questionnaire? This cannot be undone.')) return;
    const res = await fetch(`/api/methodology-admin/templates/${id}`, { method: 'DELETE' });
    if (res.ok) {
      setQuestionnaires(questionnaires.filter(q => q.id !== id));
      if (selected?.id === id) { setSelected(null); setIsEditing(false); }
    }
  }

  function handleDuplicate(q: Questionnaire) {
    const copy: Questionnaire = {
      ...JSON.parse(JSON.stringify(q)),
      id: uid(),
      name: `${q.name} (Copy)`,
      createdAt: null,
      updatedAt: null,
    };
    // Save via create
    setEditName(copy.name);
    setEditDescription(copy.description);
    setEditAuditType(copy.auditType);
    setEditGroups(copy.groups);
    setIsCreating(true);
    setIsEditing(true);
    setSelected(null);
  }

  // ─── Question count helper ─────────────────────────────────────
  function totalQuestions(q: Questionnaire) {
    return q.groups.reduce((sum, g) => sum + g.questions.length, 0);
  }

  // ─── Render ────────────────────────────────────────────────────
  return (
    <div className="max-w-7xl mx-auto">
      <BackButton href="/methodology-admin/template-documents" label="Back to Templates" />
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Questionnaires</h1>
          <p className="text-sm text-slate-500 mt-1">
            Build custom questionnaires with grouped questions, preset and free text answers
          </p>
        </div>
        <Button onClick={startCreate} size="sm">
          <Plus className="h-4 w-4 mr-1" /> New Questionnaire
        </Button>
      </div>

      <div className="flex gap-6">
        {/* Left sidebar: list */}
        <div className="w-72 flex-shrink-0">
          <div className="mb-3">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                placeholder="Search questionnaires..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-7 pr-2 py-1.5 text-sm border rounded-md"
              />
            </div>
          </div>

          <div className="border rounded-lg divide-y max-h-[600px] overflow-y-auto">
            {filtered.length === 0 && (
              <div className="p-4 text-center text-sm text-slate-400">
                {questionnaires.length === 0 ? 'No questionnaires yet' : 'No matches'}
              </div>
            )}
            {filtered.map((q) => (
              <div
                key={q.id}
                onClick={() => { setSelected(q); setIsEditing(false); setIsCreating(false); }}
                className={`p-3 cursor-pointer hover:bg-slate-50 transition-colors group ${
                  selected?.id === q.id ? 'bg-amber-50 border-l-2 border-l-amber-500' : ''
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-slate-800 truncate">{q.name}</span>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={(e) => { e.stopPropagation(); handleDuplicate(q); }} title="Duplicate" className="p-0.5 hover:bg-slate-200 rounded">
                      <Copy className="h-3 w-3 text-slate-500" />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); handleDelete(q.id); }} title="Delete" className="p-0.5 hover:bg-red-100 rounded">
                      <Trash2 className="h-3 w-3 text-red-500" />
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 mt-1">
                  {q.auditType !== 'ALL' && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600">{q.auditType}</span>
                  )}
                  <span className="text-[10px] text-slate-400">{q.groups.length} groups &middot; {totalQuestions(q)} questions</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right: editor / viewer */}
        <div className="flex-1 min-w-0">
          {!isEditing && !selected && (
            <div className="border rounded-lg p-12 text-center text-slate-400">
              <ClipboardList className="h-12 w-12 mx-auto mb-3 text-slate-300" />
              <p className="text-sm">Select a questionnaire or create a new one</p>
            </div>
          )}

          {/* View mode */}
          {!isEditing && selected && (
            <div className="border rounded-lg">
              <div className="flex items-center justify-between p-4 border-b bg-slate-50 rounded-t-lg">
                <div>
                  <h2 className="font-semibold text-slate-900">{selected.name}</h2>
                  {selected.description && <p className="text-xs text-slate-500 mt-0.5">{selected.description}</p>}
                </div>
                <Button onClick={() => startEdit(selected)} size="sm" variant="outline">
                  Edit Questionnaire
                </Button>
              </div>
              <div className="p-4 space-y-4">
                <div className="flex gap-2">
                  <span className="text-xs px-2 py-1 rounded bg-blue-50 text-blue-600">{selected.auditType}</span>
                  <span className="text-xs px-2 py-1 rounded bg-amber-50 text-amber-600">
                    {selected.groups.length} groups &middot; {totalQuestions(selected)} questions
                  </span>
                </div>
                {selected.groups.map((group, gi) => (
                  <div key={group.id} className="border rounded-lg p-4 bg-white">
                    <h3 className="text-sm font-semibold text-slate-800 mb-1">
                      {gi + 1}. {group.title || 'Untitled Group'}
                    </h3>
                    {group.description && <p className="text-xs text-slate-500 mb-3">{group.description}</p>}
                    <div className="space-y-2">
                      {group.questions.map((q, qi) => (
                        <div key={q.id} className="flex gap-3 items-start py-2 border-b border-slate-100 last:border-0">
                          <span className="text-xs font-medium text-slate-400 mt-0.5 w-6 flex-shrink-0">{gi + 1}.{qi + 1}</span>
                          <div className="flex-1">
                            <p className="text-sm text-slate-700">{q.text || 'Untitled question'}</p>
                            <div className="flex items-center gap-2 mt-1">
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                                {ANSWER_TYPES.find(a => a.value === q.answerType)?.label || q.answerType}
                              </span>
                              {q.required && <span className="text-[10px] text-red-500">Required</span>}
                              {(q.answerType === 'preset' || q.answerType === 'multi_choice') && q.options.length > 0 && (
                                <span className="text-[10px] text-slate-400">
                                  {q.options.map(o => o.label).filter(Boolean).join(' / ')}
                                </span>
                              )}
                              {q.allowExplanation && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-600">+ Explanation</span>
                              )}
                              {q.allowVoiceResponse && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-50 text-rose-600 inline-flex items-center gap-0.5">
                                  <Mic className="h-2.5 w-2.5" /> Voice
                                </span>
                              )}
                              {q.allowFileUpload && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600 inline-flex items-center gap-0.5">
                                  <Upload className="h-2.5 w-2.5" /> Upload
                                </span>
                              )}
                            </div>
                            {q.helpText && <p className="text-[10px] text-slate-400 mt-0.5 italic">{q.helpText}</p>}
                            {/* Response add-ons preview */}
                            {(q.allowExplanation || q.allowVoiceResponse || q.allowFileUpload) && (
                              <div className="mt-1.5 ml-1 space-y-1">
                                {q.allowExplanation && (
                                  <div className="flex items-center gap-1 text-[10px] text-amber-600">
                                    <span className="px-1.5 py-0.5 bg-amber-50 rounded border border-amber-200 text-amber-500 italic">
                                      {q.explanationLabel || 'Please explain'}: _______________
                                    </span>
                                  </div>
                                )}
                                {q.allowVoiceResponse && (
                                  <div className="flex items-center gap-1.5 text-[10px] text-rose-500">
                                    <span className="px-1.5 py-0.5 bg-rose-50 rounded border border-rose-200 inline-flex items-center gap-1">
                                      <Mic className="h-2.5 w-2.5" /> Record voice response — transcribed &amp; summarised
                                    </span>
                                  </div>
                                )}
                                {q.allowFileUpload && (
                                  <div className="flex items-center gap-1.5 text-[10px] text-indigo-500">
                                    <span className="px-1.5 py-0.5 bg-indigo-50 rounded border border-indigo-200 inline-flex items-center gap-1">
                                      <Upload className="h-2.5 w-2.5" /> {q.fileUploadLabel || 'Upload supporting document'}
                                      {q.acceptedFileTypes && q.acceptedFileTypes !== '*' && (
                                        <span className="text-indigo-400 ml-1">({q.acceptedFileTypes})</span>
                                      )}
                                    </span>
                                  </div>
                                )}
                              </div>
                            )}
                            {/* Branching rules in view mode */}
                            {(q.branchRules || []).length > 0 && (
                              <div className="mt-1.5 ml-1">
                                {(q.branchRules || []).map((rule) => {
                                  const targetQ = rule.action === 'skip_to' && rule.targetQuestionId
                                    ? group.questions.find(gq => gq.id === rule.targetQuestionId) : null;
                                  const targetIdx = targetQ ? group.questions.indexOf(targetQ) : -1;
                                  return (
                                    <div key={rule.id} className="flex items-center gap-1 text-[10px] text-purple-500 py-0.5">
                                      <GitBranch className="h-2.5 w-2.5" />
                                      <span>
                                        If <strong>{rule.condition}</strong>
                                        {rule.action === 'end_group'
                                          ? ' → end group'
                                          : targetQ
                                            ? ` → skip to ${gi + 1}.${targetIdx + 1}`
                                            : ' → skip to (unset)'}
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Edit mode */}
          {isEditing && (
            <div className="border rounded-lg">
              <div className="flex items-center justify-between p-4 border-b bg-slate-50 rounded-t-lg">
                <h2 className="font-semibold text-slate-900">
                  {isCreating ? 'New Questionnaire' : `Edit: ${editName}`}
                </h2>
                <div className="flex items-center gap-2">
                  <Button onClick={cancelEdit} size="sm" variant="outline">Cancel</Button>
                  <Button onClick={handleSave} size="sm" disabled={saving || !editName.trim()}>
                    {saving ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}
                    Save
                  </Button>
                </div>
              </div>

              <div className="p-4 space-y-4">
                {/* Metadata */}
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Questionnaire Name *</label>
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      placeholder="e.g. Going Concern Assessment"
                      className="w-full px-2 py-1.5 text-sm border rounded-md"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Description</label>
                    <input
                      type="text"
                      value={editDescription}
                      onChange={(e) => setEditDescription(e.target.value)}
                      placeholder="Brief description"
                      className="w-full px-2 py-1.5 text-sm border rounded-md"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Audit Type</label>
                    <select
                      value={editAuditType}
                      onChange={(e) => setEditAuditType(e.target.value)}
                      className="w-full px-2 py-1.5 text-sm border rounded-md"
                    >
                      {AUDIT_TYPES.map((a) => (
                        <option key={a.value} value={a.value}>{a.label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Groups */}
                <div className="space-y-4">
                  {editGroups.map((group, gi) => (
                    <div key={group.id} className="border rounded-lg bg-white">
                      {/* Group header */}
                      <div className="flex items-center gap-2 p-3 bg-slate-50 rounded-t-lg border-b">
                        <GripVertical className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />
                        <span className="text-xs font-bold text-slate-500 w-6">{gi + 1}.</span>
                        <input
                          type="text"
                          value={group.title}
                          onChange={(e) => updateGroup(group.id, { title: e.target.value })}
                          placeholder="Group title (e.g. Financial Indicators)"
                          className="flex-1 px-2 py-1 text-sm border rounded-md font-medium"
                        />
                        <input
                          type="text"
                          value={group.description}
                          onChange={(e) => updateGroup(group.id, { description: e.target.value })}
                          placeholder="Description (optional)"
                          className="flex-1 px-2 py-1 text-xs border rounded-md text-slate-500"
                        />
                        <div className="flex items-center gap-0.5">
                          <button onClick={() => moveGroup(group.id, -1)} disabled={gi === 0} className="p-0.5 hover:bg-slate-200 rounded disabled:opacity-30">
                            <ChevronUp className="h-3.5 w-3.5 text-slate-500" />
                          </button>
                          <button onClick={() => moveGroup(group.id, 1)} disabled={gi === editGroups.length - 1} className="p-0.5 hover:bg-slate-200 rounded disabled:opacity-30">
                            <ChevronDown className="h-3.5 w-3.5 text-slate-500" />
                          </button>
                          <button onClick={() => removeGroup(group.id)} className="p-0.5 hover:bg-red-100 rounded ml-1" title="Remove group">
                            <Trash2 className="h-3.5 w-3.5 text-red-500" />
                          </button>
                        </div>
                      </div>

                      {/* Questions */}
                      <div className="p-3 space-y-3">
                        {group.questions.map((q, qi) => (
                          <div key={q.id} className="border rounded-md p-3 bg-slate-50/50">
                            <div className="flex items-start gap-2">
                              <span className="text-[10px] font-bold text-slate-400 mt-2 w-8 flex-shrink-0">{gi + 1}.{qi + 1}</span>
                              <div className="flex-1 space-y-2">
                                {/* Question text */}
                                <input
                                  type="text"
                                  value={q.text}
                                  onChange={(e) => updateQuestion(group.id, q.id, { text: e.target.value })}
                                  placeholder="Enter your question..."
                                  className="w-full px-2 py-1.5 text-sm border rounded-md"
                                />
                                {/* Answer type + settings row */}
                                <div className="flex items-center gap-2 flex-wrap">
                                  <select
                                    value={q.answerType}
                                    onChange={(e) => updateQuestion(group.id, q.id, {
                                      answerType: e.target.value as AnswerType,
                                      options: (e.target.value === 'preset' || e.target.value === 'multi_choice') && q.options.length === 0
                                        ? [newOption(), newOption()] : q.options,
                                    })}
                                    className="px-2 py-1 text-[11px] border rounded-md bg-white"
                                  >
                                    {ANSWER_TYPES.map(a => (
                                      <option key={a.value} value={a.value}>{a.label}</option>
                                    ))}
                                  </select>
                                  <label className="flex items-center gap-1 text-[11px] text-slate-600">
                                    <input
                                      type="checkbox"
                                      checked={q.required}
                                      onChange={(e) => updateQuestion(group.id, q.id, { required: e.target.checked })}
                                      className="rounded border-slate-300"
                                    />
                                    Required
                                  </label>
                                  <input
                                    type="text"
                                    value={q.helpText}
                                    onChange={(e) => updateQuestion(group.id, q.id, { helpText: e.target.value })}
                                    placeholder="Help text (optional)"
                                    className="flex-1 px-2 py-1 text-[11px] border rounded-md text-slate-500 min-w-[120px]"
                                  />
                                </div>
                                {/* Response options toggles */}
                                <div className="flex items-center gap-4 pl-1 flex-wrap">
                                  {/* Explanation box */}
                                  <label className="flex items-center gap-1.5 text-[11px] text-slate-600">
                                    <input
                                      type="checkbox"
                                      checked={q.allowExplanation ?? false}
                                      onChange={(e) => updateQuestion(group.id, q.id, { allowExplanation: e.target.checked })}
                                      className="rounded border-slate-300"
                                    />
                                    Add explanation box
                                  </label>
                                  {/* Voice response */}
                                  <label className="flex items-center gap-1.5 text-[11px] text-slate-600">
                                    <input
                                      type="checkbox"
                                      checked={q.allowVoiceResponse ?? false}
                                      onChange={(e) => updateQuestion(group.id, q.id, { allowVoiceResponse: e.target.checked })}
                                      className="rounded border-slate-300"
                                    />
                                    <Mic className="h-3 w-3 text-rose-500" />
                                    Voice response
                                  </label>
                                  {/* File upload */}
                                  <label className="flex items-center gap-1.5 text-[11px] text-slate-600">
                                    <input
                                      type="checkbox"
                                      checked={q.allowFileUpload ?? false}
                                      onChange={(e) => updateQuestion(group.id, q.id, { allowFileUpload: e.target.checked })}
                                      className="rounded border-slate-300"
                                    />
                                    <Upload className="h-3 w-3 text-indigo-500" />
                                    File upload
                                  </label>
                                </div>
                                {/* Expanded settings for toggled options */}
                                {(q.allowExplanation || q.allowVoiceResponse || q.allowFileUpload) && (
                                  <div className="pl-2 space-y-1.5 border-l-2 border-slate-200 ml-1">
                                    {q.allowExplanation && (
                                      <div className="flex items-center gap-2">
                                        <span className="text-[10px] text-slate-400 w-24">Explanation label:</span>
                                        <input
                                          type="text"
                                          value={q.explanationLabel ?? 'Please explain'}
                                          onChange={(e) => updateQuestion(group.id, q.id, { explanationLabel: e.target.value })}
                                          placeholder="Label for explanation box"
                                          className="px-2 py-0.5 text-[11px] border rounded-md text-slate-600 w-48"
                                        />
                                      </div>
                                    )}
                                    {q.allowVoiceResponse && (
                                      <div className="flex items-center gap-1 text-[10px] text-rose-500">
                                        <Mic className="h-3 w-3" />
                                        <span>Voice recording enabled — audio saved as file, transcribed to text, and summarised</span>
                                      </div>
                                    )}
                                    {q.allowFileUpload && (
                                      <div className="flex items-center gap-2">
                                        <span className="text-[10px] text-slate-400 w-24">Upload label:</span>
                                        <input
                                          type="text"
                                          value={q.fileUploadLabel ?? 'Upload supporting document'}
                                          onChange={(e) => updateQuestion(group.id, q.id, { fileUploadLabel: e.target.value })}
                                          placeholder="Upload prompt label"
                                          className="px-2 py-0.5 text-[11px] border rounded-md text-slate-600 w-48"
                                        />
                                        <span className="text-[10px] text-slate-400">Accepts:</span>
                                        <select
                                          value={q.acceptedFileTypes ?? '*'}
                                          onChange={(e) => updateQuestion(group.id, q.id, { acceptedFileTypes: e.target.value })}
                                          className="px-1.5 py-0.5 text-[10px] border rounded bg-white text-slate-600"
                                        >
                                          <option value="*">Any file</option>
                                          <option value=".pdf,.docx,.doc,.xlsx,.xls,.csv">Documents &amp; spreadsheets</option>
                                          <option value=".pdf,.docx,.doc">Documents only</option>
                                          <option value=".jpg,.jpeg,.png,.gif,.bmp,.svg">Images only</option>
                                          <option value=".pdf">PDF only</option>
                                        </select>
                                      </div>
                                    )}
                                  </div>
                                )}
                                {/* Preset / multi-choice options */}
                                {(q.answerType === 'preset' || q.answerType === 'multi_choice') && (
                                  <div className="pl-2 space-y-1">
                                    {q.options.map((opt, oi) => (
                                      <div key={opt.id} className="flex items-center gap-1.5">
                                        <span className="text-[10px] text-slate-400 w-4">{oi + 1}.</span>
                                        <input
                                          type="text"
                                          value={opt.label}
                                          onChange={(e) => updateOption(group.id, q.id, opt.id, e.target.value)}
                                          placeholder={`Option ${oi + 1}`}
                                          className="flex-1 px-2 py-0.5 text-[11px] border rounded"
                                        />
                                        <button onClick={() => removeOption(group.id, q.id, opt.id)} className="p-0.5 hover:bg-red-100 rounded">
                                          <X className="h-3 w-3 text-red-400" />
                                        </button>
                                      </div>
                                    ))}
                                    <button
                                      onClick={() => addOption(group.id, q.id)}
                                      className="text-[10px] text-teal-600 hover:text-teal-800 font-medium mt-1"
                                    >
                                      + Add option
                                    </button>
                                  </div>
                                )}
                                {/* Conditional branching */}
                                <div className="border-t border-dashed border-slate-200 pt-2 mt-1">
                                  <div className="flex items-center gap-1.5 mb-1.5">
                                    <GitBranch className="h-3 w-3 text-purple-500" />
                                    <span className="text-[10px] font-semibold text-purple-600">Conditional Branching</span>
                                    <button
                                      onClick={() => addBranchRule(group.id, q.id)}
                                      className="ml-auto text-[10px] text-purple-500 hover:text-purple-700 font-medium"
                                    >
                                      + Add rule
                                    </button>
                                  </div>
                                  {(q.branchRules || []).length === 0 && (
                                    <p className="text-[10px] text-slate-400 italic pl-4">No branching — continues to next question</p>
                                  )}
                                  {(q.branchRules || []).map((rule) => (
                                    <div key={rule.id} className="flex items-center gap-1.5 pl-4 py-0.5 text-[10px]">
                                      <span className="text-slate-500">If answer is</span>
                                      <select
                                        value={rule.condition}
                                        onChange={(e) => updateBranchRule(group.id, q.id, rule.id, { condition: e.target.value })}
                                        className="px-1.5 py-0.5 border rounded bg-white text-slate-700 text-[10px] max-w-[120px]"
                                      >
                                        {getAnswerValues(q).map(v => (
                                          <option key={v} value={v}>{v}</option>
                                        ))}
                                      </select>
                                      <span className="text-slate-500">then</span>
                                      <select
                                        value={rule.action}
                                        onChange={(e) => updateBranchRule(group.id, q.id, rule.id, {
                                          action: e.target.value as 'skip_to' | 'end_group',
                                          targetQuestionId: e.target.value === 'end_group' ? undefined : rule.targetQuestionId,
                                        })}
                                        className="px-1.5 py-0.5 border rounded bg-white text-slate-700 text-[10px]"
                                      >
                                        <option value="skip_to">Skip to question</option>
                                        <option value="end_group">End this group</option>
                                      </select>
                                      {rule.action === 'skip_to' && (
                                        <select
                                          value={rule.targetQuestionId || ''}
                                          onChange={(e) => updateBranchRule(group.id, q.id, rule.id, { targetQuestionId: e.target.value })}
                                          className="px-1.5 py-0.5 border rounded bg-white text-slate-700 text-[10px] max-w-[200px]"
                                        >
                                          <option value="">Select target...</option>
                                          {group.questions
                                            .filter((_tq, tqi) => tqi > qi)
                                            .map((tq, _tqi) => {
                                              const actualIdx = group.questions.findIndex(gq => gq.id === tq.id);
                                              return (
                                                <option key={tq.id} value={tq.id}>
                                                  {questionLabel(tq, gi, actualIdx)}
                                                </option>
                                              );
                                            })}
                                        </select>
                                      )}
                                      <button
                                        onClick={() => removeBranchRule(group.id, q.id, rule.id)}
                                        className="p-0.5 hover:bg-red-100 rounded ml-auto"
                                      >
                                        <X className="h-2.5 w-2.5 text-red-400" />
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              </div>
                              <div className="flex flex-col gap-1 flex-shrink-0 bg-slate-100 rounded-md p-1">
                                <button
                                  onClick={() => moveQuestion(group.id, q.id, -1)}
                                  disabled={qi === 0}
                                  className="p-1 hover:bg-blue-100 rounded disabled:opacity-20 transition-colors"
                                  title="Move up"
                                >
                                  <ChevronUp className="h-4 w-4 text-blue-600" />
                                </button>
                                <button
                                  onClick={() => moveQuestion(group.id, q.id, 1)}
                                  disabled={qi === group.questions.length - 1}
                                  className="p-1 hover:bg-blue-100 rounded disabled:opacity-20 transition-colors"
                                  title="Move down"
                                >
                                  <ChevronDown className="h-4 w-4 text-blue-600" />
                                </button>
                                {editGroups.length > 1 && (
                                  <select
                                    value=""
                                    onChange={(e) => {
                                      if (e.target.value) moveQuestionToGroup(group.id, q.id, e.target.value);
                                    }}
                                    className="w-6 h-5 text-[8px] border-0 bg-transparent text-slate-400 hover:text-slate-600 cursor-pointer p-0"
                                    title="Move to another group"
                                  >
                                    <option value="">↗</option>
                                    {editGroups.filter(g => g.id !== group.id).map((g, i) => (
                                      <option key={g.id} value={g.id}>
                                        → {g.title || `Group ${editGroups.indexOf(g) + 1}`}
                                      </option>
                                    ))}
                                  </select>
                                )}
                                <div className="border-t border-slate-300 my-0.5" />
                                <button
                                  onClick={() => removeQuestion(group.id, q.id)}
                                  className="p-1 hover:bg-red-100 rounded transition-colors"
                                  title="Delete question"
                                >
                                  <Trash2 className="h-4 w-4 text-red-400" />
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                        <button
                          onClick={() => addQuestion(group.id)}
                          className="w-full py-2 text-xs text-teal-600 hover:bg-teal-50 rounded-md border border-dashed border-teal-300 font-medium transition-colors"
                        >
                          + Add Question
                        </button>
                      </div>
                    </div>
                  ))}

                  <button
                    onClick={() => setEditGroups([...editGroups, newGroup()])}
                    className="w-full py-3 text-sm text-amber-600 hover:bg-amber-50 rounded-lg border-2 border-dashed border-amber-300 font-medium transition-colors"
                  >
                    + Add Question Group
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
