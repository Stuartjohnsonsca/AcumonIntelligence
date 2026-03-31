'use client';

import { useState } from 'react';
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
  actionTriggers: string[];
  initialMappings: Record<string, Record<string, string>>; // questionId -> auditType -> trigger
}

export function QuestionnaireActionsClient({ questionnaires, auditTypes, actionTriggers, initialMappings }: Props) {
  const [selectedQId, setSelectedQId] = useState(questionnaires[0]?.id || '');
  const [mappings, setMappings] = useState<Record<string, Record<string, string>>>(initialMappings);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const selectedQ = questionnaires.find(q => q.id === selectedQId);

  function getMapping(questionId: string, auditType: string): string {
    return mappings[questionId]?.[auditType] || '';
  }

  function setMapping(questionId: string, auditType: string, trigger: string) {
    setMappings(prev => ({
      ...prev,
      [questionId]: { ...(prev[questionId] || {}), [auditType]: trigger },
    }));
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

  // Flatten all questions from selected questionnaire
  const allQuestions: { groupTitle: string; groupIdx: number; questionId: string; questionText: string; questionIdx: number }[] = [];
  if (selectedQ) {
    selectedQ.groups.forEach((group, gi) => {
      group.questions.forEach((q, qi) => {
        allQuestions.push({
          groupTitle: group.title || `Group ${gi + 1}`,
          groupIdx: gi,
          questionId: q.id,
          questionText: q.text || `Question ${qi + 1}`,
          questionIdx: qi,
        });
      });
    });
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Questionnaire Actions</h1>
          <p className="text-sm text-slate-500 mt-1">
            Map action triggers to questionnaire questions for each audit type
          </p>
        </div>
        <Button onClick={handleSave} size="sm" disabled={saving}>
          {saving ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}
          {saved ? 'Saved' : 'Save Mappings'}
        </Button>
      </div>

      {/* Questionnaire selector */}
      <div className="mb-4">
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
                    {auditTypes.map(at => (
                      <td key={at.key} className="p-1 border-r border-slate-100 text-center">
                        <select
                          value={getMapping(q.questionId, at.key)}
                          onChange={(e) => setMapping(q.questionId, at.key, e.target.value)}
                          className={`w-full px-1 py-1 text-[10px] border rounded bg-white ${
                            getMapping(q.questionId, at.key) ? 'border-teal-300 text-teal-700' : 'border-slate-200 text-slate-400'
                          }`}
                        >
                          <option value="">— None —</option>
                          {actionTriggers.map(t => (
                            <option key={t} value={t}>{t}</option>
                          ))}
                        </select>
                      </td>
                    ))}
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
