'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { FormField } from './FormField';
import { useAutoSave } from '@/hooks/useAutoSave';
import { evaluateFormula } from '@/lib/formula-engine';
import type { TemplateQuestion } from '@/types/methodology';

type FormValues = Record<string, string | number | boolean | null>;

interface SignOff {
  userId: string;
  userName: string;
  timestamp: string;
}

interface SignOffs {
  operator?: SignOff;
  reviewer?: SignOff;
  partner?: SignOff;
}

interface FieldMeta {
  lastEditedAt?: string;
  lastEditedBy?: string;
  lastEditedRole?: string;
}

interface TeamMember {
  userId: string;
  userName?: string;
  role: string; // Junior | Manager | RI
}

interface Props {
  engagementId: string;
  endpoint: string;
  questions: TemplateQuestion[];
  initialData: FormValues;
  crossRefData?: Record<string, FormValues>;
  title?: string;
  teamMembers?: TeamMember[];
}

// Map team roles to sign-off roles
const ROLE_MAP: Record<string, string> = { Junior: 'operator', Manager: 'reviewer', RI: 'partner' };

export function DynamicAppendixForm({
  engagementId,
  endpoint,
  questions,
  initialData,
  crossRefData,
  title,
  teamMembers = [],
}: Props) {
  const { data: session } = useSession();
  const [values, setValues] = useState<FormValues>(initialData);
  const [signOffs, setSignOffs] = useState<SignOffs>({});
  const [fieldMeta, setFieldMeta] = useState<Record<string, FieldMeta>>({});

  useEffect(() => { setValues(initialData); }, [initialData]);

  // Load sign-offs
  const loadSignOffs = useCallback(async () => {
    try {
      const res = await fetch(`/api/engagements/${engagementId}/${endpoint}?meta=signoffs`);
      if (res.ok) {
        const json = await res.json();
        if (json.signOffs) setSignOffs(json.signOffs);
        if (json.fieldMeta) setFieldMeta(json.fieldMeta);
      }
    } catch { /* ignore */ }
  }, [engagementId, endpoint]);

  useEffect(() => { loadSignOffs(); }, [loadSignOffs]);

  const saveEndpoint = `/api/engagements/${engagementId}/${endpoint}`;
  const { saving, lastSaved, error } = useAutoSave(saveEndpoint, { data: values, fieldMeta }, {
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
    // Track field edit metadata
    setFieldMeta(prev => ({
      ...prev,
      [questionId]: {
        lastEditedAt: new Date().toISOString(),
        lastEditedBy: session?.user?.id || '',
        lastEditedRole: 'operator',
      },
    }));
  }

  async function handleSignOff(role: 'operator' | 'reviewer' | 'partner') {
    try {
      const res = await fetch(`/api/engagements/${engagementId}/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'signoff', role }),
      });
      if (res.ok) {
        const json = await res.json();
        if (json.signOffs) setSignOffs(json.signOffs);
        // When reviewer signs off, clear orange outlines; when partner signs off, clear all
        if (role === 'reviewer' || role === 'partner') {
          await loadSignOffs();
        }
      }
    } catch (err) {
      console.error('Sign-off failed:', err);
    }
  }

  // Determine field outline colour based on edit time vs sign-off times
  function getFieldOutline(questionId: string): string {
    const meta = fieldMeta[questionId];
    if (!meta?.lastEditedAt) return '';

    const editTime = new Date(meta.lastEditedAt).getTime();
    const reviewerTime = signOffs.reviewer?.timestamp ? new Date(signOffs.reviewer.timestamp).getTime() : 0;
    const partnerTime = signOffs.partner?.timestamp ? new Date(signOffs.partner.timestamp).getTime() : 0;

    const changedSincePartner = partnerTime > 0 && editTime > partnerTime;
    const changedSinceReviewer = reviewerTime > 0 && editTime > reviewerTime;

    if (changedSincePartner && changedSinceReviewer) {
      // Both need attention: split border
      return 'ring-2 ring-red-400 ring-offset-1';
    }
    if (changedSincePartner) {
      return 'ring-2 ring-red-400 ring-offset-1';
    }
    if (changedSinceReviewer) {
      return 'ring-2 ring-orange-400 ring-offset-1';
    }
    return '';
  }

  // Check if sign-off dot should be hollow (changes made since their sign-off)
  function isSignOffStale(role: 'reviewer' | 'partner'): boolean {
    const signOff = signOffs[role];
    if (!signOff?.timestamp) return false;
    const signOffTime = new Date(signOff.timestamp).getTime();
    return Object.values(fieldMeta).some(meta => {
      if (!meta.lastEditedAt) return false;
      return new Date(meta.lastEditedAt).getTime() > signOffTime;
    });
  }

  function isVisible(q: TemplateQuestion): boolean {
    if (!q.conditionalOn) return true;
    const depValue = values[q.conditionalOn.questionId];
    return String(depValue) === q.conditionalOn.value;
  }

  const SIGN_OFF_ROLES = [
    { key: 'operator' as const, label: 'Operator' },
    { key: 'reviewer' as const, label: 'Reviewer' },
    { key: 'partner' as const, label: 'Partner' },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Sticky header */}
      <div className="sticky top-0 z-10 bg-white border-b border-slate-200 pb-3 mb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {title && <h2 className="text-base font-semibold text-slate-800">{title}</h2>}
            <div className="flex items-center gap-2 text-xs">
              {saving && <span className="text-blue-500 animate-pulse">Saving...</span>}
              {lastSaved && !saving && <span className="text-green-500">Saved {lastSaved.toLocaleTimeString()}</span>}
              {error && <span className="text-red-500">{error}</span>}
            </div>
          </div>

          {/* Sign-off dots */}
          <div className="flex items-center gap-5">
            {SIGN_OFF_ROLES.map(({ key, label }) => {
              const so = signOffs[key];
              const isStale = (key === 'reviewer' || key === 'partner') && isSignOffStale(key);
              const hasSigned = !!so?.timestamp;
              const showGreen = hasSigned && !isStale;
              // Only the user assigned to this role can sign off — no superadmin override
              const currentUserId = session?.user?.id;
              const canSign = currentUserId && teamMembers.some(m => ROLE_MAP[m.role] === key && m.userId === currentUserId);

              return (
                <div key={key} className="flex flex-col items-center gap-1">
                  <span className="text-[10px] text-slate-500 font-medium">{label}</span>
                  <button
                    onClick={() => canSign && handleSignOff(key)}
                    disabled={!canSign}
                    className={`w-5 h-5 rounded-full border-2 transition-all ${
                      showGreen
                        ? 'bg-green-500 border-green-500'
                        : isStale
                          ? 'bg-white border-green-500'
                          : canSign
                            ? 'bg-white border-slate-300 hover:border-blue-400 cursor-pointer'
                            : 'bg-white border-slate-200 cursor-not-allowed opacity-50'
                    }`}
                    title={
                      hasSigned ? `${so.userName} — ${new Date(so.timestamp).toLocaleString()}` :
                      canSign ? `Click to sign off as ${label}` :
                      `Only ${label}s can sign off here`
                    }
                  />
                  {hasSigned && (
                    <div className="text-center">
                      <p className="text-[9px] text-slate-600 leading-tight">{so.userName}</p>
                      <p className="text-[8px] text-slate-400">{new Date(so.timestamp).toLocaleDateString('en-GB')}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="space-y-4 overflow-auto">
        {sections.map(section => {
          const visibleQuestions = section.questions.filter(isVisible);
          if (visibleQuestions.length === 0) return null;

          return (
            <div key={section.label}>
              {/* Section header */}
              <div className="bg-blue-50 px-3 py-1.5 rounded-t-lg border border-blue-100">
                <h3 className="text-xs font-semibold text-blue-800">{formatSectionLabel(section.label)}</h3>
              </div>

              {/* Questions - compact card layout */}
              <div className="border border-t-0 border-slate-200 rounded-b-lg">
                {visibleQuestions.map((q, idx) => {
                  const outline = getFieldOutline(q.id);
                  return (
                    <div
                      key={q.id}
                      className={`flex gap-0 ${idx > 0 ? 'border-t border-slate-100' : ''}`}
                    >
                      {/* Question label - shaded left side */}
                      <div className="bg-slate-50 px-3 py-2 w-[45%] flex-shrink-0 flex items-start">
                        <label htmlFor={q.id} className="text-xs text-slate-700 leading-snug">
                          {q.questionText}
                          {q.isRequired && <span className="text-red-400 ml-0.5">*</span>}
                        </label>
                      </div>
                      {/* Answer - right side */}
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
    </div>
  );
}

function formatSectionLabel(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
