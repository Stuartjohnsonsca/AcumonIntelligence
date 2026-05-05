'use client';

import { useState } from 'react';
import { Plus, Save, Trash2, Loader2, Check, ShieldAlert, ArrowUp, ArrowDown } from 'lucide-react';
import type { IndependenceQuestion } from '@/lib/independence';

interface Props { initialQuestions: IndependenceQuestion[]; }

function newQuestionId(): string { return 'indep_' + Math.random().toString(36).slice(2, 10); }

export function IndependenceQuestionsClient({ initialQuestions }: Props) {
  const [questions, setQuestions] = useState<IndependenceQuestion[]>(initialQuestions);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  function update(id: string, patch: Partial<IndependenceQuestion>) {
    setQuestions(prev => prev.map(q => q.id === id ? { ...q, ...patch } : q));
  }
  function addQuestion() {
    setQuestions(prev => [...prev, { id: newQuestionId(), text: '', answerType: 'boolean', requiresNotesOnYes: true, hardFail: false }]);
  }
  function removeQuestion(id: string) {
    if (!confirm('Delete this question? This cannot be undone.')) return;
    setQuestions(prev => prev.filter(q => q.id !== id));
  }
  function move(id: string, dir: -1 | 1) {
    setQuestions(prev => {
      const idx = prev.findIndex(q => q.id === id);
      if (idx === -1) return prev;
      const target = idx + dir;
      if (target < 0 || target >= prev.length) return prev;
      const next = prev.slice();
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  }

  async function saveAll() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/methodology-admin/independence-questions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questions }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || `Save failed (${res.status})`);
        return;
      }
      setSavedAt(new Date());
      setTimeout(() => setSavedAt(null), 2500);
    } catch (err: any) {
      setError(err?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <button onClick={addQuestion} className="inline-flex items-center gap-1 text-xs px-3 py-1.5 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded hover:bg-indigo-100 font-medium">
            <Plus className="h-3.5 w-3.5" /> Add question
          </button>
          <span className="text-xs text-slate-400">{questions.length} total · {questions.filter(q => q.hardFail).length} critical</span>
        </div>
        <div className="flex items-center gap-2">
          {savedAt && <span className="text-xs text-green-600 flex items-center gap-1"><Check className="h-3 w-3" /> Saved</span>}
          {error && <span className="text-xs text-red-600">{error}</span>}
          <button onClick={saveAll} disabled={saving} className="inline-flex items-center gap-1.5 text-xs px-4 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 font-medium">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Save all
          </button>
        </div>
      </div>

      {questions.length === 0 && (
        <div className="border border-dashed border-slate-200 rounded-lg p-8 text-center">
          <p className="text-sm text-slate-500 mb-2">No questions yet.</p>
          <p className="text-xs text-slate-400 mb-4">Click &ldquo;Add question&rdquo; to set up the first one.</p>
        </div>
      )}

      <div className="space-y-3">
        {questions.map((q, i) => (
          <div key={q.id} className={`border rounded-lg p-4 ${q.hardFail ? 'border-red-200 bg-red-50/30' : 'border-slate-200 bg-white'}`}>
            <div className="flex items-start gap-3 mb-2">
              <span className="text-xs font-semibold text-slate-400 w-6 mt-1.5">{i + 1}.</span>
              <div className="flex-1">
                <textarea
                  value={q.text}
                  onChange={e => update(q.id, { text: e.target.value })}
                  placeholder="Question text (shown to every team member)"
                  rows={2}
                  className="w-full text-sm border border-slate-200 rounded px-2 py-1.5"
                />
                <input
                  type="text"
                  value={q.helpText || ''}
                  onChange={e => update(q.id, { helpText: e.target.value })}
                  placeholder="Optional helper / guidance text"
                  className="w-full mt-2 text-xs text-slate-600 border border-slate-200 rounded px-2 py-1"
                />
                <div className="flex items-center gap-4 mt-3 text-[11px] text-slate-700">
                  <label className="flex items-center gap-1.5">
                    Answer type:
                    <select
                      value={q.answerType || 'boolean'}
                      onChange={e => update(q.id, { answerType: e.target.value === 'text' ? 'text' : 'boolean' })}
                      className="border border-slate-200 rounded px-1.5 py-0.5"
                    >
                      <option value="boolean">Yes / No</option>
                      <option value="text">Free text</option>
                    </select>
                  </label>
                  {q.answerType !== 'text' && (
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={Boolean(q.requiresNotesOnYes ?? q.requiresNotesOnNo)}
                        onChange={e => update(q.id, { requiresNotesOnYes: e.target.checked, requiresNotesOnNo: undefined })}
                      />
                      Require explanation when answered &ldquo;Yes&rdquo;
                    </label>
                  )}
                  {q.answerType !== 'text' && (
                    <label className="flex items-center gap-1.5 cursor-pointer" title="If checked, answering Yes auto-notifies RI + Ethics Partner and locks user out (a single Critical Yes is barring).">
                      <input
                        type="checkbox"
                        checked={Boolean(q.hardFail)}
                        onChange={e => update(q.id, { hardFail: e.target.checked })}
                      />
                      <span className="inline-flex items-center gap-1">
                        <ShieldAlert className="h-3 w-3 text-red-500" /> Critical — &ldquo;Yes&rdquo; blocks access
                      </span>
                    </label>
                  )}
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <button onClick={() => move(q.id, -1)} disabled={i === 0} className="p-1 text-slate-400 hover:text-slate-600 disabled:opacity-30" title="Move up">
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => move(q.id, 1)} disabled={i === questions.length - 1} className="p-1 text-slate-400 hover:text-slate-600 disabled:opacity-30" title="Move down">
                  <ArrowDown className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => removeQuestion(q.id)} className="p-1 text-slate-400 hover:text-red-600" title="Delete question">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
