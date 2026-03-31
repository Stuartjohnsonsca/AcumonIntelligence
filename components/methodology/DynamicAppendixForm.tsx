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
  currencySymbol?: string;
  showActionTriggers?: boolean;
  actionTriggerOptions?: string[];
  priorYearData?: FormValues | null;
}

export function DynamicAppendixForm({
  engagementId,
  endpoint,
  questions,
  initialData,
  crossRefData,
  showActionTriggers = false,
  actionTriggerOptions = [],
  priorYearData,
}: Props) {
  const [values, setValues] = useState<FormValues>(initialData);
  const [triggerValues, setTriggerValues] = useState<Record<string, string>>(() => {
    // Load trigger selections from initialData (stored as trigger_<questionId>)
    const t: Record<string, string> = {};
    for (const [k, v] of Object.entries(initialData)) {
      if (k.startsWith('trigger_') && typeof v === 'string') {
        t[k.replace('trigger_', '')] = v;
      }
    }
    return t;
  });
  const { trackFieldEdit, getFieldOutline } = useSignOff();

  useEffect(() => { setValues(initialData); }, [initialData]);

  const saveEndpoint = `/api/engagements/${engagementId}/${endpoint}`;
  // Merge trigger values into save payload
  const saveData = useMemo(() => {
    const merged = { ...values };
    for (const [qId, trigger] of Object.entries(triggerValues)) {
      merged[`trigger_${qId}`] = trigger;
    }
    return merged;
  }, [values, triggerValues]);

  useAutoSave(saveEndpoint, { data: saveData }, {
    enabled: JSON.stringify(saveData) !== JSON.stringify(initialData),
  });

  function handleTriggerChange(questionId: string, trigger: string) {
    setTriggerValues(prev => ({ ...prev, [questionId]: trigger }));
  }

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
      {/* Column headers */}
      <div className="flex gap-0 text-[10px] font-semibold text-slate-500 uppercase tracking-wide">
        <div className="w-[35%] flex-shrink-0" />
        <div className="w-[15%] flex-shrink-0 text-right px-2">Prior Year</div>
        <div className="flex-1 px-2">Current Year</div>
        {showActionTriggers && actionTriggerOptions.length > 0 && <div className="w-36 flex-shrink-0 px-1.5">Trigger</div>}
      </div>
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
                    <div className="bg-slate-50 px-3 py-2 w-[35%] flex-shrink-0 flex items-start">
                      <label htmlFor={q.id} className="text-xs text-slate-700 leading-snug">
                        {q.questionText}
                        {q.isRequired && <span className="text-red-400 ml-0.5">*</span>}
                      </label>
                    </div>
                    {/* Prior year column — read-only if data exists, editable if not */}
                    <div className="w-[15%] flex-shrink-0 bg-slate-100 px-2 py-1.5 flex items-center border-l border-slate-200">
                      {priorYearData && priorYearData[q.id] != null ? (
                        <span className="text-xs text-slate-500 font-mono w-full text-right">
                          {typeof priorYearData[q.id] === 'number'
                            ? Number(priorYearData[q.id]).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                            : String(priorYearData[q.id])}
                        </span>
                      ) : (
                        <input
                          type={q.inputType === 'number' || q.inputType === 'currency' ? 'text' : 'text'}
                          inputMode={q.inputType === 'number' || q.inputType === 'currency' ? 'decimal' : 'text'}
                          value={values[`py_${q.id}`] ?? ''}
                          onChange={e => {
                            const v = q.inputType === 'number' || q.inputType === 'currency'
                              ? (e.target.value ? parseFloat(e.target.value.replace(/[^0-9.\-]/g, '')) || null : null)
                              : (e.target.value || null);
                            handleChange(`py_${q.id}`, v);
                          }}
                          placeholder="PY"
                          className="w-full text-xs text-right bg-transparent border-0 focus:outline-none focus:ring-1 focus:ring-blue-300 rounded px-1 py-0.5 text-slate-600 font-mono"
                        />
                      )}
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
                    {showActionTriggers && actionTriggerOptions.length > 0 && (
                      <div className="w-36 flex-shrink-0 px-1.5 py-1.5 border-l border-slate-100">
                        <select
                          value={triggerValues[q.id] || ''}
                          onChange={e => handleTriggerChange(q.id, e.target.value)}
                          className="w-full text-[10px] border border-slate-200 rounded px-1.5 py-1 bg-white text-slate-600 focus:outline-none focus:ring-1 focus:ring-blue-400"
                        >
                          <option value="">No trigger</option>
                          {actionTriggerOptions.map(t => (
                            <option key={t} value={t}>{t}</option>
                          ))}
                        </select>
                      </div>
                    )}
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
