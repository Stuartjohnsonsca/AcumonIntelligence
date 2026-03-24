'use client';

import { useState, useEffect, useMemo } from 'react';
import { FormField } from './FormField';
import { useAutoSave } from '@/hooks/useAutoSave';
import { useSignOff } from './SignOffHeader';
import { evaluateFormula } from '@/lib/formula-engine';
import type { TemplateQuestion } from '@/types/methodology';

type FormValues = Record<string, string | number | boolean | null>;

interface Props {
  engagementId: string;
  endpoint: string;
  questions: TemplateQuestion[];
  initialData: FormValues;
  crossRefData?: Record<string, FormValues>;
}

export function DynamicAppendixForm({
  engagementId,
  endpoint,
  questions,
  initialData,
  crossRefData,
}: Props) {
  const [values, setValues] = useState<FormValues>(initialData);
  const { trackFieldEdit, getFieldOutline } = useSignOff();

  useEffect(() => { setValues(initialData); }, [initialData]);

  const saveEndpoint = `/api/engagements/${engagementId}/${endpoint}`;
  useAutoSave(saveEndpoint, { data: values }, {
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
    trackFieldEdit(questionId);
  }

  function isVisible(q: TemplateQuestion): boolean {
    if (!q.conditionalOn) return true;
    const depValue = values[q.conditionalOn.questionId];
    return String(depValue) === q.conditionalOn.value;
  }

  return (
    <div className="space-y-4">
      {sections.map(section => {
        const visibleQuestions = section.questions.filter(isVisible);
        if (visibleQuestions.length === 0) return null;

        return (
          <div key={section.label}>
            <div className="bg-blue-50 px-3 py-1.5 rounded-t-lg border border-blue-100">
              <h3 className="text-xs font-semibold text-blue-800">{formatSectionLabel(section.label)}</h3>
            </div>
            <div className="border border-t-0 border-slate-200 rounded-b-lg">
              {visibleQuestions.map((q, idx) => {
                const outline = getFieldOutline(q.id);
                return (
                  <div key={q.id} className={`flex gap-0 ${idx > 0 ? 'border-t border-slate-100' : ''}`}>
                    <div className="bg-slate-50 px-3 py-2 w-[45%] flex-shrink-0 flex items-start">
                      <label htmlFor={q.id} className="text-xs text-slate-700 leading-snug">
                        {q.questionText}
                        {q.isRequired && <span className="text-red-400 ml-0.5">*</span>}
                      </label>
                    </div>
                    <div className={`flex-1 px-2 py-1.5 ${outline}`}>
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
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function formatSectionLabel(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
