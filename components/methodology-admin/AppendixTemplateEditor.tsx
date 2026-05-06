'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Save, Loader2, Plus, X, ChevronDown, ChevronRight, GripVertical, Pencil, Trash2, ArrowUp, ArrowDown, Copy, Check, Sparkles, Lock, AlertTriangle } from 'lucide-react';
import { useFirmVariables } from '@/hooks/useFirmVariables';
import { slugifyQuestionText } from '@/lib/formula-engine';
import { DISPLAY_FORMAT_OPTIONS } from '@/lib/format-display';
import { PlaceholderBadge } from '@/components/methodology/PlaceholderBadge';
import type { TemplateQuestion, QuestionInputType, TemplateSectionMeta, SectionLayout } from '@/types/methodology';
import { SCHEDULE_ACTIONS } from '@/lib/schedule-actions';
import {
  protectedQuestionsForTemplate,
  type ProtectedQuestion,
} from '@/lib/vat-reconciliation';

/**
 * Convert a methodology template's `templateType` to the
 * `questionnaires.<key>` namespace used in document templates.
 * Mirrors the canonical mapping in lib/schedule-loader.ts so the
 * Schedule Designer's hover badges show the same path admins will
 * actually paste into a template.
 */
function ctxKeyForTemplateType(templateType: string): string {
  const canonical: Record<string, string> = {
    permanent_file_questions:    'permanentFile',
    ethics_questions:            'ethics',
    continuance_questions:       'continuance',
    materiality_questions:       'materiality',
    new_client_takeon_questions: 'newClientTakeOn',
    subsequent_events_questions: 'subsequentEvents',
  };
  if (canonical[templateType]) return canonical[templateType];
  const stem = templateType.replace(/_(questions|categories)$/, '');
  return stem.replace(/_([a-z0-9])/g, (_, ch) => ch.toUpperCase());
}

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

  // ── Tool-wired (protected) question registry ──────────────────────
  // Cross-checked against `templateType` so e.g. permanent_file_questions
  // only sees its own protected entries. Empty list when no tool wires
  // anything to this template.
  const protectedForTemplate = useMemo(
    () => protectedQuestionsForTemplate(templateType),
    [templateType]
  );

  /** All ProtectedQuestion entries that this question matches. A row
   *  can match multiple entries when several tools / columns reference
   *  the same slug. */
  function protectionsForQuestion(q: TemplateQuestion): ProtectedQuestion[] {
    if (protectedForTemplate.length === 0) return [];
    const slug = slugifyQuestionText(q.questionText);
    if (!slug) return [];
    return protectedForTemplate.filter(p => p.slug === slug);
  }

  /** Subset of protections that target a specific column on the row.
   *  Used by the per-cell input-type guard. `column` is 1-based to
   *  mirror how admins refer to cells. */
  function protectionsForColumn(q: TemplateQuestion, column: number): ProtectedQuestion[] {
    return protectionsForQuestion(q).filter(p => p.column === column);
  }

  // ── Warning modal state ────────────────────────────────────────────
  // Single shared modal for all "this would break a wired tool"
  // confirmations. Body text + entry list are tailored per call site,
  // but the chrome (red icon, Cancel / Continue anyway buttons) is
  // shared.
  type WarningPayload = {
    title: string;
    body: React.ReactNode;
    entries: ProtectedQuestion[];
    onConfirm: () => void;
    /** Optional handler for the Cancel button. When set, runs in
     *  addition to closing the modal — useful for the rename path
     *  where Cancel needs to restore the original text. */
    onCancel?: () => void;
  };
  const [warning, setWarning] = useState<WarningPayload | null>(null);
  // Tracks the questionText (and its slug) at the moment editing started
  // for whichever row is currently being edited in the expanded panel.
  // Used by the questionText onBlur to detect "you renamed a wired
  // question" so we only warn if the slug actually changed; the
  // captured text is also what we restore if the admin clicks Cancel
  // on the warning modal.
  const editStartSlugRef = useRef<Record<string, { text: string; slug: string }>>({});

  // Group questions by section. Re-built every render so it tracks
  // questions[] as it changes; cheap given typical schedule sizes.
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
    const q = questions.find(qq => qq.id === id);
    if (!q) return;
    const doRemove = () => {
      setQuestions(prev => prev.filter(qq => qq.id !== id));
      if (expandedId === id) setExpandedId(null);
      setSaved(false);
    };
    const protections = protectionsForQuestion(q);
    if (protections.length > 0) {
      setWarning({
        title: 'Delete a tool-wired question?',
        body: (
          <>
            <p>
              <strong>“{q.questionText || '(untitled)'}”</strong> is wired to one or more
              calculators in the platform. Deleting it will <strong>break</strong> the
              wiring — the affected tool(s) will fall back to a "not configured" state
              and stop producing useful results until the question is restored or a new
              one with the same slug is added.
            </p>
            <p className="mt-2">If you really need to remove this question, consider one of these alternatives instead:</p>
            <ul className="list-disc pl-5 mt-1 space-y-0.5 text-[11px]">
              <li>Set <em>Conditional on → Never show</em> to retire the row without changing the slug.</li>
              <li>Replace it with a renamed question that slugifies to <strong>the same identifier</strong>.</li>
            </ul>
          </>
        ),
        entries: protections,
        onConfirm: doRemove,
      });
      return;
    }
    if (!confirm('Delete this question?')) return;
    doRemove();
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
    const inSection = questions.filter(q => q.sectionKey === sectionKey);
    const count = inSection.length;
    const protectedInSection = inSection.flatMap(q => protectionsForQuestion(q));
    const doDelete = () => {
      setQuestions(prev => prev.filter(q => q.sectionKey !== sectionKey));
      setSaved(false);
    };
    if (protectedInSection.length > 0) {
      setWarning({
        title: 'Delete a section containing tool-wired questions?',
        body: (
          <>
            <p>
              Section <strong>“{sectionKey}”</strong> contains {protectedInSection.length}{' '}
              question{protectedInSection.length === 1 ? '' : 's'} wired to one or more calculators.
              Deleting the section will <strong>delete those questions too</strong> and break the
              wiring — affected tools will revert to a "not configured" state.
            </p>
            <p className="mt-2 text-[11px]">
              The full section delete will also remove {count - protectedInSection.length} other
              question{count - protectedInSection.length === 1 ? '' : 's'} not listed below.
            </p>
          </>
        ),
        entries: protectedInSection,
        onConfirm: doDelete,
      });
      return;
    }
    if (!confirm(`Delete section "${sectionKey}" and all ${count} question${count !== 1 ? 's' : ''}?`)) return;
    doDelete();
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
                {/* Section Layout dropdown — switching between 3/4/5-
                    col resizes the columnHeaders array to the new count
                    (preserving the admin's existing header text where it
                    still fits, padding the remainder with the layout's
                    defaults) and trims each question's per-row
                    q.columns array to match. Without this, bumping up
                    to 4-col then back to 3-col left the section still
                    rendering 4 columns because the headers array kept
                    its old length. */}
                <select
                  value={sectionMeta[sectionKey]?.layout || 'standard'}
                  onChange={e => {
                    const newLayout = e.target.value as SectionLayout;
                    const targetCount =
                      newLayout === 'table_3col' ? 3 :
                      newLayout === 'table_4col' ? 4 :
                      newLayout === 'table_5col' ? 5 : 0;
                    const existingHeaders = sectionMeta[sectionKey]?.columnHeaders || [];
                    const defaults = LAYOUT_DEFAULT_HEADERS[newLayout] || [];
                    // Resize: keep admin-edited header text up to
                    // targetCount, pad with defaults for any new slots.
                    const nextHeaders: string[] = [];
                    if (targetCount > 0) {
                      for (let i = 0; i < targetCount; i++) {
                        if (i < existingHeaders.length && existingHeaders[i]) nextHeaders.push(existingHeaders[i]);
                        else nextHeaders.push(defaults[i] || `Column ${i + 1}`);
                      }
                    }
                    updateSectionMeta(sectionKey, {
                      layout: newLayout,
                      columnHeaders: nextHeaders,
                      signOff: sectionMeta[sectionKey]?.signOff ?? true,
                    });
                    // Trim / extend each question's q.columns in this
                    // section so they match the new cell count
                    // (targetCount - 1, since column 0 is the label).
                    const cellCount = Math.max(0, targetCount - 1);
                    setQuestions(prev => prev.map(q => {
                      if (q.sectionKey !== sectionKey) return q;
                      if (!q.columns && cellCount === 0) return q;
                      const next = (q.columns || []).slice(0, cellCount);
                      return { ...q, columns: cellCount === 0 ? undefined : next };
                    }));
                    setSaved(false);
                  }}
                  onClick={e => e.stopPropagation()}
                  className="text-[10px] border border-slate-200 rounded px-1.5 py-0.5 bg-white text-slate-600 focus:outline-none focus:border-blue-400"
                  title="Section layout type. Switching between 3/4/5-col resizes the column headers and per-row cell config — your header text is preserved where it still fits."
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
                  // Question's merge-field key — preferred from
                  // q.key, falling back to the slugified question
                  // text so auto-generated questions also get a
                  // resolvable path. Sub-headers / bold rows have no
                  // saved value; we still show a path so admins know
                  // there's no merge field to paste.
                  const qSlug = (q as any).key || slugifyQuestionText(q.questionText) || q.id;
                  const ctxKey = ctxKeyForTemplateType(templateType);
                  const rowPath = `questionnaires.${ctxKey}.${qSlug}`;
                  // Section meta for column-header context — multi-
                  // column rows ALSO get per-column badges in the
                  // expanded edit form below. The row-level badge here
                  // is the standard Q+A path; for table sections it's
                  // still useful as the umbrella key (asList loops
                  // iterate every row).
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
                        {/* Copyable merge-field path — only for real
                            questions (sub-headers don't have a saved
                            value, no merge field to copy). One-click
                            copies `{{questionnaires.<X>.<key>}}` to
                            the clipboard so admins can paste the path
                            straight into a document template body
                            without leaving the Schedule Designer. */}
                        {!isSubheader && (
                          <PlaceholderBadge
                            path={rowPath}
                            title={`Merge-field placeholder — click to copy\n{{${rowPath}}}`}
                          />
                        )}
                        {/* Tool-wired badge — visible whenever any
                            calculator reads this question. Hover for the
                            list of tools; the actual block-on-delete /
                            block-on-rename logic lives in removeQuestion
                            + the questionText / inputType handlers. */}
                        {(() => {
                          const ps = protectionsForQuestion(q);
                          if (ps.length === 0) return null;
                          const tools = Array.from(new Set(ps.map(p => p.toolName))).join(', ');
                          return (
                            <span
                              title={`Wired to: ${tools}\nDeleting, renaming, or changing the response type of this question will break the wiring.`}
                              className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 border border-amber-300 whitespace-nowrap"
                            >
                              <Lock className="h-3 w-3" />
                              Wired
                            </span>
                          );
                        })()}
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
                          {/* Tool-wired warning banner — only shown when this
                              question is read by at least one calculator.
                              Lists the tools and what each reads so the
                              admin understands the cost of changing
                              questionText / inputType / deleting the row. */}
                          {(() => {
                            const ps = protectionsForQuestion(q);
                            if (ps.length === 0) return null;
                            return (
                              <div className="mb-3 px-3 py-2 bg-amber-50 border border-amber-300 rounded text-[11px] text-amber-900 flex items-start gap-2">
                                <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5 text-amber-600" />
                                <div className="space-y-1">
                                  <p>
                                    <strong>This question is wired to a calculator.</strong>{' '}
                                    Renaming it (which changes the slug),
                                    changing its response type, or deleting it
                                    will break the wiring. A confirmation pop-up
                                    will appear if you try one of those actions.
                                  </p>
                                  <ul className="list-disc pl-4 space-y-0.5">
                                    {ps.map((p, idx) => (
                                      <li key={idx}>
                                        <strong>{p.toolName}</strong>
                                        {p.column ? <> reads <code className="bg-amber-100 px-1 rounded">col{p.column}</code></> : <> reads the row value</>}
                                        {' — '}{p.description}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              </div>
                            );
                          })()}
                          <div className="grid grid-cols-2 gap-3">
                            <div className="col-span-2">
                              <label className="block text-xs text-slate-500 mb-1 font-medium">Question Text</label>
                              <textarea
                                value={q.questionText}
                                onFocus={() => {
                                  // Snapshot the text + slug at the moment
                                  // editing starts. The blur handler uses
                                  // this so we only warn if the slug
                                  // actually changed (typing then reverting
                                  // is a no-op), and so the warning's
                                  // Cancel button can restore the exact
                                  // original text.
                                  editStartSlugRef.current[q.id] = {
                                    text: q.questionText,
                                    slug: slugifyQuestionText(q.questionText),
                                  };
                                }}
                                onChange={e => updateQuestion(q.id, { questionText: e.target.value })}
                                onBlur={e => {
                                  const start = editStartSlugRef.current[q.id];
                                  delete editStartSlugRef.current[q.id];
                                  if (!start) return;
                                  const newSlug = slugifyQuestionText(e.target.value);
                                  if (start.slug === newSlug) return;
                                  const wasProtected = protectedForTemplate.filter(p => p.slug === start.slug);
                                  if (wasProtected.length === 0) return;
                                  setWarning({
                                    title: 'Rename a tool-wired question?',
                                    body: (
                                      <>
                                        <p>
                                          You renamed a question that calculators read by its
                                          slug (<code className="bg-slate-100 px-1 rounded">{start.slug}</code>).
                                          The new text slugifies to{' '}
                                          <code className="bg-slate-100 px-1 rounded">{newSlug || '(empty)'}</code>{' '}
                                          which the tool won't recognise.
                                        </p>
                                        <p className="mt-2">
                                          Click <strong>Cancel</strong> to revert the rename, or{' '}
                                          <strong>Continue anyway</strong> if you intend to re-wire
                                          the tool separately.
                                        </p>
                                      </>
                                    ),
                                    entries: wasProtected,
                                    // Continue: keep the rename — already applied via onChange.
                                    onConfirm: () => undefined,
                                    // Cancel handler restores the captured text.
                                    onCancel: () => updateQuestion(q.id, { questionText: start.text }),
                                  });
                                }}
                                className="w-full border border-slate-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 min-h-[60px] resize-y"
                                placeholder="Enter the question text..."
                              />
                            </div>
                            <div>
                              {/* Response Type is hidden for rows inside a
                                  table-layout section — each cell in that
                                  section has its own input type configured
                                  in the per-cell block below, so a row-
                                  level Response Type would be redundant
                                  and potentially misleading. */}
                              {(() => {
                                const parentMeta = sectionMeta[q.sectionKey];
                                const inTable = parentMeta?.layout && parentMeta.layout !== 'standard';
                                if (inTable) return (
                                  <div className="text-[10px] text-slate-400 italic pt-1">
                                    Response type is set per-cell below (this row sits in a table-layout section).
                                  </div>
                                );
                                return (
                                  <>
                                    <label className="block text-xs text-slate-500 mb-1 font-medium">Response Type</label>
                                    <select
                                      value={q.inputType}
                                      onChange={e => {
                                        const next = e.target.value as QuestionInputType;
                                        const protections = protectionsForQuestion(q).filter(p => p.column === undefined);
                                        const breaking = protections.filter(p =>
                                          p.allowedInputTypes && !p.allowedInputTypes.includes(next as any)
                                        );
                                        if (breaking.length > 0) {
                                          setWarning({
                                            title: 'Change response type on a tool-wired question?',
                                            body: (
                                              <>
                                                <p>
                                                  Switching the response type from{' '}
                                                  <strong>{INPUT_TYPE_OPTIONS.find(o => o.value === q.inputType)?.label || q.inputType}</strong>{' '}
                                                  to <strong>{INPUT_TYPE_OPTIONS.find(o => o.value === next)?.label || next}</strong>{' '}
                                                  is likely to <strong>break</strong> the tool reading this answer — it
                                                  expects a specific shape (Y/N, dropdown, etc.).
                                                </p>
                                              </>
                                            ),
                                            entries: breaking,
                                            onConfirm: () => updateQuestion(q.id, { inputType: next }),
                                          });
                                          return;
                                        }
                                        updateQuestion(q.id, { inputType: next });
                                      }}
                                      className="w-full border border-slate-200 rounded px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                                    >
                                      {INPUT_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                    </select>
                                  </>
                                );
                              })()}
                            </div>
                            <div>
                              {/* Section picker doubles as a "move to
                                  another section" shortcut. Hidden for
                                  table-layout rows too — the row already
                                  lives visually under its section heading
                                  and the admin edits the whole section's
                                  layout there. */}
                              {(() => {
                                const parentMeta = sectionMeta[q.sectionKey];
                                const inTable = parentMeta?.layout && parentMeta.layout !== 'standard';
                                if (inTable) return null;
                                return (
                                  <>
                                    <label className="block text-xs text-slate-500 mb-1 font-medium">Section</label>
                                    <select
                                      value={q.sectionKey}
                                      onChange={e => updateQuestion(q.id, { sectionKey: e.target.value })}
                                      className="w-full border border-slate-200 rounded px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                                    >
                                      {Array.from(sections.keys()).map(s => <option key={s} value={s}>{s}</option>)}
                                      {sectionOptions.filter(s => !sections.has(s)).map(s => <option key={s} value={s}>{s}</option>)}
                                    </select>
                                  </>
                                );
                              })()}
                            </div>

                            {/* Dropdown options editor — only shown when
                                row is NOT in a table layout (table cells
                                configure their own dropdown options
                                per-cell in the per-row column block). */}
                            {q.inputType === 'dropdown' && !(sectionMeta[q.sectionKey]?.layout && sectionMeta[q.sectionKey].layout !== 'standard') && (
                              <DropdownOptionsEditor
                                key={q.id + '-dropdown'}
                                options={q.dropdownOptions || []}
                                onChange={opts => updateQuestion(q.id, { dropdownOptions: opts })}
                              />
                            )}

                            {/* Formula expression — with "insert" helper chips for field IDs and common operators */}
                            {q.inputType === 'formula' && (
                              <div className="col-span-2 space-y-1.5">
                                <div className="flex items-center justify-between">
                                  <label className="block text-xs text-slate-500 font-medium">Formula Expression</label>
                                  <AiFieldSuggester
                                    templateType={templateType}
                                    siblingQuestions={questions}
                                    onInsert={(id) => {
                                      const current = q.formulaExpression || '';
                                      const ref = id.includes('.') ? `{${id}}` : id;
                                      const sep = current && !/[\s+\-*/(]$/.test(current) ? ' ' : '';
                                      updateQuestion(q.id, { formulaExpression: current + sep + ref });
                                    }}
                                  />
                                </div>
                                <input
                                  type="text"
                                  value={q.formulaExpression || ''}
                                  onChange={e => updateQuestion(q.id, { formulaExpression: e.target.value })}
                                  className="w-full border border-slate-200 rounded px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-400"
                                  placeholder='e.g. audit_fee + non_audit_fee  or  {engagement.hard_close}'
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

                            {/* Display format — applies to formula / number /
                                currency cells. Storage stays raw, only the
                                schedule's render layer formats. So a cell
                                that computes to 0.343 can show as "0.343%"
                                without breaking other formulas that read
                                the underlying number. */}
                            {(q.inputType === 'formula' || q.inputType === 'number' || q.inputType === 'currency') && (
                              <div className="col-span-2 space-y-1">
                                <label className="block text-xs text-slate-500 font-medium">Display Format</label>
                                <select
                                  value={(q as any).displayFormat || ''}
                                  onChange={e => updateQuestion(q.id, ({ displayFormat: e.target.value || undefined } as any))}
                                  className="w-full border border-slate-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                                >
                                  {DISPLAY_FORMAT_OPTIONS.map(opt => (
                                    <option key={opt.value || 'raw'} value={opt.value}>
                                      {opt.label} — e.g. {opt.example}
                                    </option>
                                  ))}
                                </select>
                                <p className="text-[10px] text-slate-500">
                                  Only changes how the cell DISPLAYS the value —
                                  storage and references to this field from
                                  other formulas / templates stay raw. Tick
                                  <em> Percent</em> when the formula already
                                  multiplies by 100; the engine doesn&rsquo;t
                                  multiply again.
                                </p>
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
                            <div className="col-span-2 flex items-center gap-4 pt-1 border-t border-slate-100 flex-wrap">
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
                              {/* AI Polish toggle — only meaningful for prose
                                  fields. When the row's input type is text /
                                  textarea (free-text), checking this box adds
                                  a "Polish with AI" button next to the answer
                                  cell on the engagement-side schedule. The
                                  auditor types in shorthand, hits the button,
                                  and the engine rewrites the value into
                                  formal client-facing audit language. The
                                  auditor can edit the polished result before
                                  saving. Hidden for non-prose input types
                                  (numeric / date / Y-N / dropdown / formula)
                                  where polishing makes no sense. */}
                              {(q.inputType === 'text' || q.inputType === 'textarea') && (
                                <label
                                  className="flex items-center gap-1.5 text-xs text-fuchsia-700"
                                  title="When checked, an AI Polish button appears next to this question's answer cell on the engagement schedule. Click → the auditor's text is rewritten in formal UK audit language, ready to paste into a client document. The auditor can still edit afterwards."
                                >
                                  <input type="checkbox" checked={(q as any).aiPolishEnabled || false} onChange={e => updateQuestion(q.id, ({ aiPolishEnabled: e.target.checked || undefined } as any))} className="w-3.5 h-3.5 rounded accent-fuchsia-600" />
                                  AI Polish button
                                </label>
                              )}

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
                                type CellCondOp = NonNullable<NonNullable<TemplateQuestion['columns']>[number]['conditionalOn']>['operator'];
                                function updateRowCol(ci: number, patch: Partial<{ inputType: QuestionInputType; dropdownOptions: string[]; placeholder: string; formulaExpression: string; conditionalOn: { columnIndex: number; operator?: CellCondOp; value?: string } | undefined }>) {
                                  const current = (q.columns || []).slice();
                                  // Backfill placeholder columns with the ROW's current
                                  // inputType — NOT a hard-coded 'textarea'. The old
                                  // behaviour meant changing a later cell (say Col 3)
                                  // silently overwrote earlier unconfigured cells
                                  // (Col 1, Col 2) with 'textarea' as a visible side
                                  // effect. Mirroring q.inputType keeps them looking
                                  // exactly as they did before the admin touched
                                  // anything.
                                  while (current.length <= ci) current.push({ inputType: q.inputType } as any);
                                  current[ci] = { ...current[ci], ...patch };
                                  updateQuestion(q.id, { columns: current });
                                }
                                return (
                                  <div className="col-span-2 w-full pt-2 mt-1 border-t border-slate-100">
                                    <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-1">Per-cell configuration for this row</div>
                                    <div className="space-y-2">
                                      {Array.from({ length: cellCount }).map((_, ci) => {
                                        const cfg = q.columns?.[ci];
                                        const header = headers[ci + 1] || `Column ${ci + 2}`;
                                        const cond = cfg?.conditionalOn;
                                        const condUnary = cond?.operator === 'isEmpty' || cond?.operator === 'isNotEmpty';
                                        // Look up the referenced column's
                                        // config so the value-input below
                                        // matches the referenced cell's
                                        // widget type (Y/N, dropdown, etc.).
                                        const refCfg = cond?.columnIndex ? q.columns?.[cond.columnIndex - 1] : undefined;
                                        const refInputType = refCfg?.inputType || q.inputType;
                                        const refOptions = refCfg?.dropdownOptions && refCfg.dropdownOptions.length > 0 ? refCfg.dropdownOptions : q.dropdownOptions;
                                        // Per-cell merge-field path. col0 is the
                                        // label column ({{question}}); cells start at
                                        // col1 in storage even though admins count
                                        // them as "Col 1" in the UI — keep the UI
                                        // label unchanged so it matches what they see
                                        // in the rendered schedule, but the badge
                                        // shows the actual storage path.
                                        const colN = ci + 1;
                                        const cellPath = `questionnaires.${ctxKey}.${qSlug}_col${colN}`;
                                        const headerSlug = header
                                          ? String(header).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
                                          : '';
                                        const cellTitle = headerSlug
                                          ? `Merge-field placeholder — click to copy\n{{${cellPath}}}\n\nInside an asList loop, the column header "${header}" is also addressable as {{${headerSlug}}}.`
                                          : `Merge-field placeholder — click to copy\n{{${cellPath}}}`;
                                        return (
                                          <div key={ci} className="bg-slate-50/60 border border-slate-100 rounded p-2 space-y-1 group">
                                            <div className="flex items-center gap-2 flex-wrap">
                                              <span className="text-[10px] text-slate-500 w-32 truncate" title={header}>
                                                <strong className="text-slate-700">Col {ci + 1}</strong> — {header}
                                              </span>
                                              {/* Hover badge for this specific cell —
                                                  click copies the col<N> path. Visible
                                                  always (admin-only view), so admins
                                                  authoring per-cell config can grab the
                                                  path right alongside the input-type
                                                  selector. */}
                                              <PlaceholderBadge path={cellPath} title={cellTitle} />
                                              <select
                                                value={cfg?.inputType || q.inputType}
                                                onChange={e => {
                                                  const next = e.target.value as QuestionInputType;
                                                  // Per-cell change is column-scoped — match
                                                  // protections targeting this specific 1-based column.
                                                  const colNum = ci + 1;
                                                  const breaking = protectionsForColumn(q, colNum).filter(p =>
                                                    p.allowedInputTypes && !p.allowedInputTypes.includes(next as any)
                                                  );
                                                  if (breaking.length > 0) {
                                                    setWarning({
                                                      title: `Change input type on Col ${colNum} of a tool-wired row?`,
                                                      body: (
                                                        <p>
                                                          Col {colNum} of <strong>“{q.questionText || '(untitled)'}”</strong>{' '}
                                                          is read by a calculator that expects a specific shape.
                                                          Switching to{' '}
                                                          <strong>{INPUT_TYPE_OPTIONS.find(o => o.value === next)?.label || next}</strong>{' '}
                                                          will <strong>break</strong> the wiring.
                                                        </p>
                                                      ),
                                                      entries: breaking,
                                                      onConfirm: () => updateRowCol(ci, { inputType: next }),
                                                    });
                                                    return;
                                                  }
                                                  updateRowCol(ci, { inputType: next });
                                                }}
                                                className="text-[10px] border border-slate-200 rounded px-2 py-1 bg-white focus:outline-none focus:border-blue-400"
                                                title="Input type for this cell only (this row's version of this column)"
                                              >
                                                {/* Formula IS available at cell level — lets a row
                                                     compute one column from the others (e.g. col 3
                                                     = col 1 × col 2). Sub-header / table_row /
                                                     yes_only remain excluded because they only make
                                                     sense at row level, not per-cell. */}
                                                {INPUT_TYPE_OPTIONS
                                                  .filter(o => o.value !== 'subheader' && o.value !== 'table_row' && o.value !== 'yes_only')
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
                                            {/* Per-cell formula editor — shown when this cell's
                                                inputType is 'formula'. Same syntax as the row-level
                                                formulaExpression; identifiers here can reference the
                                                row's other columns (e.g. `row_col1 * row_col2`), the
                                                question's slug, any other question in the schedule,
                                                or firm variables. Matches the row-level editor's
                                                quick-reference help so users aren't surprised. */}
                                            {cfg?.inputType === 'formula' && (
                                              <div className="bg-purple-50/80 border border-purple-200 rounded p-2 space-y-1">
                                                <div className="flex items-center justify-between">
                                                  <label className="block text-[10px] text-purple-700 font-medium">Formula for this cell</label>
                                                  <AiFieldSuggester
                                                    templateType={templateType}
                                                    siblingQuestions={questions}
                                                    compact
                                                    onInsert={(id) => {
                                                      const current = cfg?.formulaExpression || '';
                                                      const ref = id.includes('.') ? `{${id}}` : id;
                                                      const sep = current && !/[\s+\-*/(]$/.test(current) ? ' ' : '';
                                                      updateRowCol(ci, { formulaExpression: current + sep + ref });
                                                    }}
                                                  />
                                                </div>
                                                <input
                                                  type="text"
                                                  value={cfg?.formulaExpression || ''}
                                                  onChange={e => updateRowCol(ci, { formulaExpression: e.target.value })}
                                                  placeholder="e.g. col1 * col2,  {engagement.hard_close},  audit_fee * 1.2"
                                                  className="w-full text-[11px] font-mono border border-purple-200 rounded px-2 py-1 focus:outline-none focus:border-purple-400"
                                                />
                                                <p className="text-[10px] text-purple-600 leading-snug">
                                                  Reference other cells on THIS row as <code>col1</code>, <code>col2</code>, <code>col3</code> etc,
                                                  other questions by their slug, Opening-tab data as <code>{'{engagement.*}'}</code>,
                                                  or any firm variable by name.
                                                </p>
                                              </div>
                                            )}
                                            {/* Per-cell display format. Same vocabulary as the
                                                row-level format dropdown; lets one cell of a
                                                multi-column row render as percent while a
                                                neighbour shows currency. Only visible for the
                                                inputType families where formatting is meaningful. */}
                                            {(cfg?.inputType === 'formula' || cfg?.inputType === 'number' || cfg?.inputType === 'currency') && (
                                              <div className="space-y-1">
                                                <label className="block text-[10px] text-slate-500 font-medium">Cell display format</label>
                                                <select
                                                  value={(cfg as any)?.displayFormat || ''}
                                                  onChange={e => updateRowCol(ci, ({ displayFormat: e.target.value || undefined } as any))}
                                                  className="w-full text-[10px] border border-slate-200 rounded px-2 py-1 bg-white focus:outline-none focus:border-blue-400"
                                                >
                                                  {DISPLAY_FORMAT_OPTIONS.map(opt => (
                                                    <option key={opt.value || 'raw'} value={opt.value}>
                                                      {opt.label} — e.g. {opt.example}
                                                    </option>
                                                  ))}
                                                </select>
                                              </div>
                                            )}
                                            {/* Per-cell AI Polish toggle — same
                                                semantics as the row-level one but
                                                scoped to this single cell. So a
                                                4-column section can polish only
                                                the "Threats" description column
                                                while leaving the Y/N and
                                                "Safeguard" cells alone. Visible
                                                only for prose-style cells. */}
                                            {(cfg?.inputType === 'text' || cfg?.inputType === 'textarea') && (
                                              <label
                                                className="flex items-center gap-1.5 text-[10px] text-fuchsia-700"
                                                title="When checked, an AI Polish button appears next to this CELL on the engagement schedule. Click → the auditor's text is rewritten in formal UK audit language. The auditor can still edit afterwards."
                                              >
                                                <input
                                                  type="checkbox"
                                                  checked={(cfg as any)?.aiPolishEnabled || false}
                                                  onChange={e => updateRowCol(ci, ({ aiPolishEnabled: e.target.checked || undefined } as any))}
                                                  className="w-3 h-3 rounded accent-fuchsia-600"
                                                />
                                                AI Polish button on this cell
                                              </label>
                                            )}
                                            {/* Per-cell conditional —
                                                hide THIS cell when another
                                                cell in the SAME ROW doesn't
                                                match a condition (e.g. Col 2
                                                only when Col 1 is 'Y'). */}
                                            <div className="flex items-center gap-2 flex-wrap text-[10px] text-slate-600">
                                              <span className="text-[10px] text-slate-500 w-32 shrink-0">Show when:</span>
                                              <select
                                                value={cond?.operator === 'never' ? '__never__' : (cond?.columnIndex ? String(cond.columnIndex) : '')}
                                                onChange={e => {
                                                  const v = e.target.value;
                                                  if (!v) { updateRowCol(ci, { conditionalOn: undefined }); return; }
                                                  if (v === '__never__') {
                                                    // Permanent hide — no columnIndex / value needed.
                                                    // columnIndex is retained as a no-op number to
                                                    // satisfy the non-optional type; the runtime
                                                    // short-circuits on operator before using it.
                                                    updateRowCol(ci, { conditionalOn: { columnIndex: 1, operator: 'never', value: '' } });
                                                    return;
                                                  }
                                                  const nextColIndex = Number(v);
                                                  const base = cond || { columnIndex: nextColIndex, operator: 'eq', value: '' };
                                                  updateRowCol(ci, { conditionalOn: { columnIndex: nextColIndex, operator: base.operator === 'never' ? 'eq' : (base.operator || 'eq'), value: base.value || '' } });
                                                }}
                                                className="text-[10px] border border-slate-200 rounded px-2 py-1 bg-white"
                                              >
                                                <option value="">— always show —</option>
                                                <option value="__never__">— never show —</option>
                                                {Array.from({ length: cellCount }).map((_, j) => {
                                                  if (j === ci) return null; // can't reference itself
                                                  return <option key={j + 1} value={String(j + 1)}>Col {j + 1} — {headers[j + 1] || `Column ${j + 2}`}</option>;
                                                })}
                                              </select>
                                              {cond?.columnIndex && cond.operator !== 'never' && (
                                                <select
                                                  value={cond.operator || 'eq'}
                                                  onChange={e => {
                                                    const op = e.target.value as any;
                                                    const isUnary = op === 'isEmpty' || op === 'isNotEmpty';
                                                    updateRowCol(ci, { conditionalOn: { columnIndex: cond.columnIndex!, operator: op, value: isUnary ? '' : (cond.value || '') } });
                                                  }}
                                                  className="text-[10px] border border-slate-200 rounded px-1.5 py-1 bg-white"
                                                >
                                                  <option value="eq">equals</option>
                                                  <option value="ne">does not equal</option>
                                                  <option value="contains">contains</option>
                                                  <option value="notContains">does not contain</option>
                                                  <option value="gt">&gt;</option>
                                                  <option value="gte">&gt;=</option>
                                                  <option value="lt">&lt;</option>
                                                  <option value="lte">&lt;=</option>
                                                  <option value="isEmpty">is empty</option>
                                                  <option value="isNotEmpty">is not empty</option>
                                                </select>
                                              )}
                                              {cond?.columnIndex && cond.operator !== 'never' && !condUnary && (
                                                refInputType === 'yesno' || refInputType === 'yna' || refInputType === 'checkbox' ? (
                                                  <select
                                                    value={cond.value || ''}
                                                    onChange={e => updateRowCol(ci, { conditionalOn: { columnIndex: cond.columnIndex!, operator: cond.operator || 'eq', value: e.target.value } })}
                                                    className="text-[10px] border border-slate-200 rounded px-1.5 py-1 bg-white w-20"
                                                  >
                                                    <option value="">—</option>
                                                    <option value="Y">Y</option>
                                                    <option value="N">N</option>
                                                    <option value="N/A">N/A</option>
                                                  </select>
                                                ) : refInputType === 'dropdown' && Array.isArray(refOptions) && refOptions.length > 0 ? (
                                                  <select
                                                    value={cond.value || ''}
                                                    onChange={e => updateRowCol(ci, { conditionalOn: { columnIndex: cond.columnIndex!, operator: cond.operator || 'eq', value: e.target.value } })}
                                                    className="text-[10px] border border-slate-200 rounded px-1.5 py-1 bg-white"
                                                  >
                                                    <option value="">—</option>
                                                    {refOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                                                  </select>
                                                ) : (
                                                  <input
                                                    type="text"
                                                    value={cond.value || ''}
                                                    onChange={e => updateRowCol(ci, { conditionalOn: { columnIndex: cond.columnIndex!, operator: cond.operator || 'eq', value: e.target.value } })}
                                                    placeholder="value"
                                                    className="text-[10px] border border-slate-200 rounded px-2 py-1 bg-white w-28"
                                                  />
                                                )
                                              )}
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                    <p className="text-[10px] text-slate-500 italic mt-1">
                                      Leave alone to use the row&rsquo;s own input type ({INPUT_TYPE_OPTIONS.find(o => o.value === q.inputType)?.label || q.inputType}) for every cell. Use &quot;Show when&quot; to hide a cell based on another cell on the same row (e.g. Col 2 only when Col 1 = Y).
                                    </p>
                                  </div>
                                );
                              })()}
                              <div
                                className="col-span-2 w-full flex items-center gap-2 pt-2 mt-1 border-t border-slate-100"
                                title={
                                  'Cross-reference this question to another schedule, so its value is pulled live from there (read-only here). Format: <schedule>.<questionKey> — e.g.\n' +
                                  '  ethics.independence_confirmed\n' +
                                  '  continuance.engagement_letter_date\n' +
                                  '  permanentFile.entity_address\n' +
                                  '  materiality.benchmark\n' +
                                  'Letter aliases also work: appendix_a = permanentFile, appendix_b = ethics, appendix_c = continuance, appendix_e = materiality.'
                                }
                              >
                                <span className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold w-28 shrink-0">Cross-ref</span>
                                <input
                                  type="text"
                                  value={q.crossRef || ''}
                                  onChange={e => updateQuestion(q.id, { crossRef: e.target.value || undefined })}
                                  className="border border-slate-200 rounded px-2 py-1 text-xs w-80 font-mono"
                                  placeholder="e.g. permanentFile.entity_address"
                                />
                                <span className="text-[10px] text-slate-400 italic">
                                  Pulls value live from another schedule (read-only here).
                                </span>
                              </div>
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
                                const condColumnIndex = cond?.columnIndex;
                                const parent = questions.find(p => p.id === condParentId);
                                const siblings = questions.filter(p => p.id !== q.id);
                                const isUnary = condOperator === 'isEmpty' || condOperator === 'isNotEmpty';
                                // If the PARENT question sits in a table
                                // layout, let the admin target a specific
                                // COLUMN's value rather than the row-level
                                // one. Populated from the parent's section
                                // metadata.
                                const parentMeta = parent ? sectionMeta[parent.sectionKey] : undefined;
                                const parentTableHeaders = parentMeta?.layout && parentMeta.layout !== 'standard'
                                  ? (parentMeta.columnHeaders || LAYOUT_DEFAULT_HEADERS[parentMeta.layout] || [])
                                  : [];
                                const parentCellCount = Math.max(0, parentTableHeaders.length - 1);
                                // When the parent is column-aware we read
                                // its per-cell config to determine the
                                // value-input widget; otherwise the row-
                                // level inputType/dropdownOptions are used.
                                const parentColumnCfg = parent && typeof condColumnIndex === 'number' && condColumnIndex >= 1
                                  ? parent.columns?.[condColumnIndex - 1]
                                  : undefined;
                                const effectiveParentInputType = parentColumnCfg?.inputType || parent?.inputType;
                                const effectiveParentOptions = parentColumnCfg?.dropdownOptions && parentColumnCfg.dropdownOptions.length > 0
                                  ? parentColumnCfg.dropdownOptions
                                  : parent?.dropdownOptions;

                                function patchCond(patch: Partial<NonNullable<typeof q.conditionalOn>>) {
                                  const base = q.conditionalOn || { questionId: '', value: '' };
                                  updateQuestion(q.id, { conditionalOn: { ...base, ...patch } });
                                }

                                // Value-input adapts to parent's (possibly
                                // per-column) input type.
                                const valueInput = (() => {
                                  if (!parent || isUnary) return null;
                                  const current = cond?.value || '';
                                  const onValueChange = (v: string) => patchCond({ value: v });
                                  if (effectiveParentInputType === 'dropdown' && Array.isArray(effectiveParentOptions) && effectiveParentOptions.length > 0) {
                                    return (
                                      <select value={current} onChange={e => onValueChange(e.target.value)}
                                        className="border border-slate-200 rounded px-2 py-1 text-xs w-32">
                                        <option value="">— answer —</option>
                                        {effectiveParentOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                                      </select>
                                    );
                                  }
                                  if (effectiveParentInputType === 'yesno' || effectiveParentInputType === 'yes_only' || effectiveParentInputType === 'yna' || effectiveParentInputType === 'checkbox') {
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

                                const isNever = condOperator === 'never';
                                return (
                                  <label className="flex items-center gap-1.5 text-xs text-slate-500 flex-wrap">
                                    Conditional on:
                                    <select
                                      value={isNever ? '__never__' : condParentId}
                                      onChange={e => {
                                        const v = e.target.value;
                                        if (!v) { updateQuestion(q.id, { conditionalOn: undefined }); return; }
                                        if (v === '__never__') {
                                          // Permanent hide — questionId is required by the type
                                          // but unused at runtime when operator='never'. We keep
                                          // the prior parent id if there is one so toggling back
                                          // to "Always show" doesn't lose the user's earlier pick.
                                          updateQuestion(q.id, { conditionalOn: { questionId: condParentId || '__never__', value: '', operator: 'never' } });
                                          return;
                                        }
                                        // Switching from "never" back to a real parent — clear
                                        // the operator so it resets to the default 'eq'.
                                        if (isNever) updateQuestion(q.id, { conditionalOn: { questionId: v, value: '' } });
                                        else patchCond({ questionId: v });
                                      }}
                                      className="border border-slate-200 rounded px-2 py-1 text-xs max-w-[14rem]"
                                      title="Pick a sibling question — or choose 'Never show' to permanently hide this row"
                                    >
                                      <option value="">— Always show —</option>
                                      <option value="__never__">— Never show —</option>
                                      {siblings.map(p => (
                                        <option key={p.id} value={p.id}>
                                          {(p.questionText || '(untitled)').length > 50
                                            ? (p.questionText || '').slice(0, 50) + '…'
                                            : (p.questionText || '(untitled)')}
                                        </option>
                                      ))}
                                    </select>
                                    {!isNever && condParentId && parentCellCount > 0 && (
                                      <select
                                        value={condColumnIndex ? String(condColumnIndex) : ''}
                                        onChange={e => {
                                          const v = e.target.value;
                                          patchCond({ columnIndex: v ? Number(v) : undefined });
                                        }}
                                        className="border border-slate-200 rounded px-1.5 py-1 text-xs"
                                        title="When the parent is in a table section, pick which column's answer drives this condition. Leave as 'row-level answer' to read the main value."
                                      >
                                        <option value="">row-level answer</option>
                                        {Array.from({ length: parentCellCount }).map((_, i) => (
                                          <option key={i + 1} value={String(i + 1)}>
                                            Col {i + 1} — {parentTableHeaders[i + 1] || `Column ${i + 2}`}
                                          </option>
                                        ))}
                                      </select>
                                    )}
                                    {!isNever && condParentId && (
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
                                    {!isNever && valueInput}
                                    {isNever && (
                                      <span className="text-[11px] text-rose-600 italic">(this row is hidden from the rendered schedule)</span>
                                    )}
                                  </label>
                                );
                              })()}

                              {/* Schedule Action — fire a catalogued
                                  action (e.g. "Consult Tax Technical
                                  specialist") when the auditor's
                                  answer matches the trigger value.
                                  The action POSTs to the Specialists
                                  items endpoint, opening a chat
                                  with the configured specialist
                                  role and emailing them an external
                                  portal link. Picking "(none)" wipes
                                  the config back to undefined. */}
                              <div
                                className="col-span-2 w-full flex items-center gap-2 pt-2 mt-1 border-t border-slate-100 flex-wrap"
                                title={
                                  'Fire a Schedule Action when this question is answered with the trigger value. ' +
                                  'The action opens a chat in the engagement\'s Specialists tab with the action\'s role, ' +
                                  'and emails the specialist a magic-link to the External Specialist Portal.'
                                }
                              >
                                <span className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold w-28 shrink-0">Schedule Action</span>
                                <select
                                  value={q.scheduleAction?.key || ''}
                                  onChange={e => {
                                    const v = e.target.value;
                                    if (!v) {
                                      updateQuestion(q.id, { scheduleAction: undefined });
                                      return;
                                    }
                                    updateQuestion(q.id, {
                                      scheduleAction: {
                                        key: v,
                                        triggerValue: q.scheduleAction?.triggerValue || '',
                                      },
                                    });
                                  }}
                                  className="border border-slate-200 rounded px-2 py-1 text-xs"
                                >
                                  <option value="">(none — no action fires)</option>
                                  {SCHEDULE_ACTIONS.map(a => (
                                    <option key={a.key} value={a.key}>{a.label}</option>
                                  ))}
                                </select>
                                {q.scheduleAction?.key && (
                                  <>
                                    <span className="text-[10px] text-slate-500">when answer equals</span>
                                    <input
                                      type="text"
                                      value={q.scheduleAction.triggerValue}
                                      onChange={e => updateQuestion(q.id, {
                                        scheduleAction: {
                                          key: q.scheduleAction!.key,
                                          triggerValue: e.target.value,
                                        },
                                      })}
                                      className="border border-slate-200 rounded px-2 py-1 text-xs w-40"
                                      placeholder="e.g. Yes"
                                    />
                                    <span className="text-[10px] text-slate-400 italic flex-1 min-w-0 truncate">
                                      {SCHEDULE_ACTIONS.find(a => a.key === q.scheduleAction!.key)?.description}
                                    </span>
                                  </>
                                )}
                              </div>
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

      {/* Tool-wired protection warning modal — shared across all
          delete / rename / response-type-change paths above. The body
          and entry list are tailored per call site; the chrome stays
          consistent so admins recognise it. */}
      {warning && (
        <ProtectionWarningModal
          payload={warning}
          onClose={() => setWarning(null)}
        />
      )}
    </div>
  );
}

/** Modal shown before any delete / rename / response-type change that
 *  would break a wired calculator. Lists the affected tool entries
 *  with their description so the admin can make an informed call. */
function ProtectionWarningModal({
  payload,
  onClose,
}: {
  payload: {
    title: string;
    body: React.ReactNode;
    entries: ProtectedQuestion[];
    onConfirm: () => void;
    onCancel?: () => void;
  };
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/50 p-4">
      <div className="bg-white rounded-lg shadow-xl border border-slate-200 w-full max-w-lg">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200 bg-red-50">
          <AlertTriangle className="h-4 w-4 text-red-600" />
          <h3 className="text-sm font-semibold text-red-800">{payload.title}</h3>
        </div>
        <div className="p-4 space-y-3 text-xs text-slate-700">
          <div className="space-y-2">{payload.body}</div>
          <div className="border border-slate-200 rounded p-2 bg-slate-50 space-y-1.5">
            <div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">Wired tool dependencies</div>
            {payload.entries.map((p, idx) => (
              <div key={idx} className="flex items-start gap-2">
                <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 border border-amber-300 whitespace-nowrap mt-0.5">
                  <Lock className="h-3 w-3" />
                  {p.toolName}
                </span>
                <p className="text-[11px] leading-snug">
                  Reads <code className="bg-white border border-slate-200 px-1 rounded">{p.column ? `${p.slug}_col${p.column}` : p.slug}</code>
                  {p.allowedInputTypes && p.allowedInputTypes.length > 0 && (
                    <> — must be one of: {p.allowedInputTypes.join(', ')}</>
                  )}
                  {p.expectedValues && p.expectedValues.length > 0 && (
                    <> — expected answers include: {p.expectedValues.map(v => `"${v}"`).join(', ')}</>
                  )}
                  <br />
                  <span className="text-slate-500">{p.description}</span>
                </p>
              </div>
            ))}
          </div>
        </div>
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-slate-200 bg-slate-50">
          <button
            onClick={() => { payload.onCancel?.(); onClose(); }}
            className="px-3 py-1.5 text-xs font-medium border border-slate-300 rounded hover:bg-slate-100"
          >
            Cancel
          </button>
          <button
            onClick={() => { payload.onConfirm(); onClose(); }}
            className="px-3 py-1.5 text-xs font-medium bg-red-600 text-white rounded hover:bg-red-700"
          >
            Continue anyway
          </button>
        </div>
      </div>
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
/**
 * AI field-suggester popover for formula editors.
 *
 * The admin types a plain-English description of what they want
 * ("hard close date from the Opening tab", "audit fee from firm
 * variables") and the model returns a ranked list of valid
 * identifiers — grounded against the live catalogue of sibling
 * questions, appendix cross-refs, the synthetic `engagement` bucket,
 * and firm variables. Clicking a suggestion inserts it into the
 * formula expression via the parent's onInsert callback.
 *
 * Post-validation on the server ensures the returned ids exist or
 * match a known pattern (engagement.<slug>, team_<role>_name, etc),
 * so hallucinated fields never reach the user.
 *
 * Works without an AI key — the server silently falls back to a
 * keyword-overlap search on the catalogue.
 */
function AiFieldSuggester({
  templateType,
  siblingQuestions,
  onInsert,
  compact = false,
}: {
  templateType: string;
  siblingQuestions: TemplateQuestion[];
  onInsert: (id: string) => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [desc, setDesc] = useState('');
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<Array<{ id: string; label: string; reasoning?: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  async function ask() {
    if (!desc.trim()) return;
    setLoading(true); setError(null);
    try {
      const r = await fetch('/api/methodology-admin/ai-formula-field', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: desc,
          templateType,
          siblingQuestions: siblingQuestions.map(q => ({ id: q.id, questionText: q.questionText, inputType: q.inputType })),
        }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || `Failed (${r.status})`);
      const data = await r.json();
      setSuggestions(Array.isArray(data?.suggestions) ? data.suggestions : []);
    } catch (err: any) {
      setError(err?.message || 'Suggestion failed');
      setSuggestions([]);
    } finally {
      setLoading(false);
    }
  }

  const btnSize = compact ? 'text-[9px] px-1.5 py-0.5' : 'text-[10px] px-2 py-1';

  return (
    <div ref={wrapperRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className={`inline-flex items-center gap-1 ${btnSize} rounded-md bg-purple-100 text-purple-700 border border-purple-300 hover:bg-purple-200`}
        title="Ask AI which field to use"
      >
        <Sparkles className="w-3 h-3" />Ask AI
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-[380px] max-w-[90vw] bg-white border border-slate-200 rounded-md shadow-lg p-3 space-y-2">
          <p className="text-[11px] text-slate-500">
            Describe the field you need. The AI only suggests real identifiers — the Opening tab via{' '}
            <code className="bg-slate-100 px-1 rounded text-[10px]">engagement.*</code>, other schedules via{' '}
            <code className="bg-slate-100 px-1 rounded text-[10px]">ethics.*</code> etc, sibling questions by slug, or firm variables by name.
          </p>
          <textarea
            autoFocus
            value={desc}
            onChange={e => setDesc(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); } }}
            rows={2}
            placeholder="e.g. hard close date from the Opening tab"
            className="w-full text-xs border border-slate-300 rounded px-2 py-1.5 focus:outline-none focus:border-purple-400"
          />
          <div className="flex items-center justify-end gap-1">
            <button
              type="button"
              onClick={() => { setOpen(false); setDesc(''); setSuggestions([]); setError(null); }}
              className="text-xs text-slate-600 hover:text-slate-900 px-2 py-1"
            >Cancel</button>
            <button
              type="button"
              onClick={ask}
              disabled={loading || !desc.trim()}
              className="text-xs bg-purple-600 text-white rounded px-3 py-1 hover:bg-purple-700 disabled:opacity-50 inline-flex items-center gap-1"
            >
              {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
              {loading ? 'Thinking…' : 'Ask'}
            </button>
          </div>
          {error && (
            <p className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">{error}</p>
          )}
          {suggestions.length > 0 && (
            <div className="border-t border-slate-100 pt-2 space-y-1 max-h-64 overflow-y-auto">
              <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wide">Suggestions</p>
              {suggestions.map(s => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => { onInsert(s.id); setOpen(false); setDesc(''); setSuggestions([]); }}
                  className="w-full text-left border border-slate-200 rounded p-2 hover:bg-purple-50 hover:border-purple-300"
                >
                  <div className="text-xs font-mono text-purple-900 break-all">{s.id}</div>
                  <div className="text-[11px] text-slate-600 mt-0.5">{s.label}</div>
                  {s.reasoning && <div className="text-[10px] text-slate-400 mt-0.5 italic">{s.reasoning}</div>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

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
