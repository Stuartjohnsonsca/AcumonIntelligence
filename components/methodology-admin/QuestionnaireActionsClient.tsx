'use client';

import { useState, useMemo } from 'react';
import { Save, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface QuestionGroup {
  id: string;
  title: string;
  questions: { id: string; text: string }[];
}

interface Questionnaire {
  id: string;
  name: string;
  groups: QuestionGroup[];
}

interface Props {
  questionnaires: Questionnaire[];
  auditTypes: { key: string; label: string }[];
  /** Firm-wide audit categories (PIE / Listed / Charity / …) from
   *  Firm Wide Assumptions. Drives the second column filter. Empty
   *  array → only the "All categories" universal slot is editable. */
  auditCategoryOptions: string[];
  actionTriggers: string[];
  /** Either the legacy shape `{questionId: {auditType: trigger}}` or the
   *  new composite shape `{questionId: {`${auditType}|${category}`: trigger}}`.
   *  Legacy reads are transparently treated as the "All categories" slot. */
  initialMappings: Record<string, Record<string, string>>;
}

/** Sentinel for the "applies to every category" mapping slot. Keeps the
 *  storage key shape stable (`auditType|category`) so the migration
 *  from the legacy single-key shape doesn't require special-casing. */
const ALL_CATEGORIES = '';

/** Compose the storage key for a (auditType, auditCategory) cell. */
function cellKey(auditType: string, category: string): string {
  return `${auditType}|${category}`;
}

/** Detect whether an existing mappings object uses the legacy
 *  per-question-by-audit-type shape (no `|` in the inner keys). If so,
 *  migrate every entry into the "All categories" slot of the new
 *  shape so the editor doesn't silently drop pre-existing rules. */
function normaliseInitial(initial: Record<string, Record<string, string>>): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const [qid, inner] of Object.entries(initial || {})) {
    if (!inner || typeof inner !== 'object') continue;
    const nextInner: Record<string, string> = {};
    for (const [k, v] of Object.entries(inner)) {
      if (typeof v !== 'string' || !v) continue;
      if (k.includes('|')) {
        nextInner[k] = v;
      } else {
        // Legacy key — `<auditType>` becomes `<auditType>|` (all categories).
        nextInner[cellKey(k, ALL_CATEGORIES)] = v;
      }
    }
    if (Object.keys(nextInner).length > 0) out[qid] = nextInner;
  }
  return out;
}

export function QuestionnaireActionsClient({
  questionnaires,
  auditTypes,
  auditCategoryOptions,
  actionTriggers,
  initialMappings,
}: Props) {
  const [selectedQId, setSelectedQId] = useState(questionnaires[0]?.id || '');
  const [mappings, setMappings] = useState<Record<string, Record<string, string>>>(
    () => normaliseInitial(initialMappings)
  );
  // Default to the "All categories" slot so admins migrating from the
  // old shape see their legacy rules immediately. Switching the
  // category dropdown swaps the cells in/out for that category's
  // overrides — empty cells fall back to the All-categories slot at
  // evaluation time (the runtime consumer is responsible for that
  // fallback; this UI just edits the slots).
  const [selectedCategory, setSelectedCategory] = useState<string>(ALL_CATEGORIES);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const selectedQ = questionnaires.find(q => q.id === selectedQId);

  function getMapping(questionId: string, auditType: string): string {
    return mappings[questionId]?.[cellKey(auditType, selectedCategory)] || '';
  }

  function setMapping(questionId: string, auditType: string, trigger: string) {
    setMappings(prev => {
      const next = { ...prev };
      const inner = { ...(next[questionId] || {}) };
      const k = cellKey(auditType, selectedCategory);
      if (trigger) inner[k] = trigger;
      else delete inner[k];
      next[questionId] = inner;
      return next;
    });
    setSaved(false);
  }

  async function handleSave() {
    setSaving(true);
    try {
      await fetch('/api/methodology-admin/templates', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateType: 'questionnaire_actions',
          auditType: 'ALL',
          items: mappings,
        }),
      });
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  const allQuestions = useMemo(() => {
    const out: { groupTitle: string; groupIdx: number; questionId: string; questionText: string; questionIdx: number }[] = [];
    if (!selectedQ) return out;
    selectedQ.groups.forEach((group, gi) => {
      group.questions.forEach((q, qi) => {
        out.push({
          groupTitle: group.title || `Group ${gi + 1}`,
          groupIdx: gi,
          questionId: q.id,
          questionText: q.text || `Question ${qi + 1}`,
          questionIdx: qi,
        });
      });
    });
    return out;
  }, [selectedQ]);

  // Count how many cells the OTHER categories have set, to nudge the
  // admin when a question has category overrides they're not currently
  // looking at. Cheap — total mappings are tiny.
  const otherCategoryCount = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const inner of Object.values(mappings)) {
      for (const k of Object.keys(inner || {})) {
        const cat = k.split('|', 2)[1] ?? '';
        if (cat !== selectedCategory) counts[cat] = (counts[cat] || 0) + 1;
      }
    }
    return counts;
  }, [mappings, selectedCategory]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Questionnaire Actions</h1>
          <p className="text-sm text-slate-500 mt-1">
            Map action triggers per question. Each cell is scoped by Audit Type AND Audit Category, so a
            question can fire different actions for, say, a Listed PIE versus a Charity SME.
          </p>
        </div>
        <Button onClick={handleSave} size="sm" disabled={saving}>
          {saving ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}
          {saved ? 'Saved' : 'Save Mappings'}
        </Button>
      </div>

      {/* Questionnaire + Audit Category selectors */}
      <div className="flex flex-wrap items-end gap-4 mb-4">
        <div>
          <label className="block text-sm font-medium text-slate-600 mb-1">Questionnaire</label>
          <select
            value={selectedQId}
            onChange={(e) => setSelectedQId(e.target.value)}
            className="border border-slate-300 rounded-md px-3 py-2 text-sm bg-white min-w-[300px] focus:outline-none focus:ring-2 focus:ring-teal-500"
          >
            {questionnaires.length === 0 && <option value="">No questionnaires available</option>}
            {questionnaires.map(q => (
              <option key={q.id} value={q.id}>{q.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-600 mb-1">Audit Category</label>
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="border border-slate-300 rounded-md px-3 py-2 text-sm bg-white min-w-[200px] focus:outline-none focus:ring-2 focus:ring-teal-500"
            title="Choose which audit category's overrides you're editing. Cells left blank fall back to the All-categories defaults at runtime."
          >
            <option value={ALL_CATEGORIES}>All categories (default)</option>
            {auditCategoryOptions.map(c => (
              <option key={c} value={c}>{c}{otherCategoryCount[c] ? ` · ${otherCategoryCount[c]} set` : ''}</option>
            ))}
          </select>
          {auditCategoryOptions.length === 0 && (
            <p className="text-[10px] text-slate-400 mt-1">
              No firm-wide categories defined — add them under Firm Wide Assumptions → Audit Categories.
            </p>
          )}
        </div>

        {/* Tell the admin when they're editing a category-specific
            overlay so empty cells don't look like "no rule". */}
        {selectedCategory !== ALL_CATEGORIES && (
          <div className="text-[11px] text-slate-500 max-w-md pb-1">
            You&rsquo;re editing the <strong>{selectedCategory}</strong> overlay. Empty cells inherit from the &ldquo;All categories&rdquo; defaults at runtime.
          </div>
        )}
      </div>

      {/* Grid: Questions (rows) x Audit Types (columns) */}
      {selectedQ && allQuestions.length > 0 && (
        <div className="border rounded-lg overflow-auto">
          <table className="w-full text-xs border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className="bg-slate-100">
                <th className="text-left font-semibold text-slate-700 p-2 min-w-[250px] border-b border-r border-slate-200">Question</th>
                {auditTypes.map(at => (
                  <th key={at.key} className="text-center font-semibold text-slate-700 p-2 min-w-[140px] border-b border-r border-slate-200">
                    {at.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {allQuestions.map((q, idx) => {
                const isFirstInGroup = idx === 0 || allQuestions[idx - 1].groupIdx !== q.groupIdx;
                return (
                  <tr key={q.questionId} className={`border-b border-slate-100 ${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/30'}`}>
                    <td className="p-2 border-r border-slate-100">
                      <div>
                        {isFirstInGroup && (
                          <div className="text-[9px] font-bold text-teal-600 uppercase tracking-wide mb-0.5">
                            {q.groupTitle}
                          </div>
                        )}
                        <span className="text-slate-700">
                          <span className="text-slate-400 font-mono mr-1">{q.groupIdx + 1}.{q.questionIdx + 1}</span>
                          {q.questionText.length > 80 ? q.questionText.slice(0, 80) + '...' : q.questionText}
                        </span>
                      </div>
                    </td>
                    {auditTypes.map(at => {
                      const current = getMapping(q.questionId, at.key);
                      // For category overlays, also peek at the
                      // default-slot value so the admin can see what
                      // they're overriding. Helps avoid "why is this
                      // empty?" confusion.
                      const fallback = selectedCategory !== ALL_CATEGORIES
                        ? mappings[q.questionId]?.[cellKey(at.key, ALL_CATEGORIES)] || ''
                        : '';
                      return (
                        <td key={at.key} className="p-1 border-r border-slate-100 text-center">
                          <select
                            value={current}
                            onChange={(e) => setMapping(q.questionId, at.key, e.target.value)}
                            className={`w-full px-1 py-1 text-[10px] border rounded bg-white ${
                              current ? 'border-teal-300 text-teal-700' : 'border-slate-200 text-slate-400'
                            }`}
                            title={fallback ? `Inherits "${fallback}" from All-categories unless overridden here` : undefined}
                          >
                            <option value="">{fallback ? `— inherit (${fallback}) —` : '— None —'}</option>
                            {actionTriggers.map(t => (
                              <option key={t} value={t}>{t}</option>
                            ))}
                          </select>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {selectedQ && allQuestions.length === 0 && (
        <div className="text-center py-12 border rounded-lg">
          <p className="text-sm text-slate-400">This questionnaire has no questions yet.</p>
        </div>
      )}

      {!selectedQ && (
        <div className="text-center py-12 border rounded-lg">
          <p className="text-sm text-slate-400">Select a questionnaire to configure action triggers.</p>
        </div>
      )}
    </div>
  );
}
