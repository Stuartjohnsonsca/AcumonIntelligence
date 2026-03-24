'use client';

import { useState, useEffect, useMemo } from 'react';
import { FormField } from './FormField';
import { useAutoSave } from '@/hooks/useAutoSave';
import { evaluateFormula } from '@/lib/formula-engine';
import type { TemplateQuestion } from '@/types/methodology';

type FormValues = Record<string, string | number | boolean | null>;

interface Props {
  engagementId: string;
  endpoint: string; // API endpoint for saving
  questions: TemplateQuestion[];
  initialData: FormValues;
  crossRefData?: Record<string, FormValues>; // Data from other appendices
  title?: string;
}

export function DynamicAppendixForm({
  engagementId,
  endpoint,
  questions,
  initialData,
  crossRefData,
  title,
}: Props) {
  const [values, setValues] = useState<FormValues>(initialData);

  useEffect(() => { setValues(initialData); }, [initialData]);

  const saveEndpoint = `/api/engagements/${engagementId}/${endpoint}`;
  const { saving, lastSaved, error } = useAutoSave(saveEndpoint, { data: values }, {
    enabled: JSON.stringify(values) !== JSON.stringify(initialData),
  });

  // Group questions by section
  const sections = useMemo(() => {
    const map = new Map<string, { label: string; questions: TemplateQuestion[] }>();
    for (const q of questions) {
      if (!map.has(q.sectionKey)) {
        map.set(q.sectionKey, { label: q.sectionKey, questions: [] });
      }
      map.get(q.sectionKey)!.questions.push(q);
    }
    // Sort questions within each section
    for (const section of map.values()) {
      section.questions.sort((a, b) => a.sortOrder - b.sortOrder);
    }
    return Array.from(map.values());
  }, [questions]);

  // Compute formula values
  const computedValues = useMemo(() => {
    const computed: FormValues = {};
    for (const q of questions) {
      if (q.inputType === 'formula' && q.formulaExpression) {
        computed[q.id] = evaluateFormula(q.formulaExpression, values, crossRefData);
      }
    }
    return computed;
  }, [questions, values, crossRefData]);

  function handleChange(questionId: string, value: string | number | boolean | null) {
    setValues(prev => ({ ...prev, [questionId]: value }));
  }

  // Check if a question should be visible (conditional rendering)
  function isVisible(q: TemplateQuestion): boolean {
    if (!q.conditionalOn) return true;
    const depValue = values[q.conditionalOn.questionId];
    return String(depValue) === q.conditionalOn.value;
  }

  return (
    <div>
      {/* Header with save status */}
      <div className="flex items-center justify-between mb-4">
        {title && <h2 className="text-base font-semibold text-slate-800">{title}</h2>}
        <div className="flex items-center gap-2 text-xs">
          {saving && <span className="text-blue-500 animate-pulse">Saving...</span>}
          {lastSaved && !saving && <span className="text-green-500">Saved {lastSaved.toLocaleTimeString()}</span>}
          {error && <span className="text-red-500">{error}</span>}
        </div>
      </div>

      {/* Sections */}
      <div className="space-y-6">
        {sections.map(section => {
          const visibleQuestions = section.questions.filter(isVisible);
          if (visibleQuestions.length === 0) return null;

          return (
            <div key={section.label} className="border border-slate-200 rounded-lg overflow-hidden">
              {/* Section header */}
              <div className="bg-slate-50 px-4 py-2 border-b border-slate-200">
                <h3 className="text-sm font-semibold text-slate-700">{formatSectionLabel(section.label)}</h3>
              </div>

              {/* Questions */}
              <div className="divide-y divide-slate-100">
                {visibleQuestions.map(q => (
                  <div key={q.id} className="px-4 py-3 flex gap-4 items-start hover:bg-slate-50/50">
                    <div className="flex-1 min-w-0">
                      <label htmlFor={q.id} className="block text-sm text-slate-700 mb-1">
                        {q.questionText}
                        {q.isRequired && <span className="text-red-400 ml-0.5">*</span>}
                      </label>
                    </div>
                    <div className="w-1/2 flex-shrink-0">
                      <FormField
                        questionId={q.id}
                        inputType={q.inputType}
                        value={values[q.id] ?? null}
                        onChange={v => handleChange(q.id, v)}
                        dropdownOptions={q.dropdownOptions}
                        computedValue={computedValues[q.id]}
                        isFormula={q.inputType === 'formula'}
                        validationMin={q.validationMin}
                        validationMax={q.validationMax}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function formatSectionLabel(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
