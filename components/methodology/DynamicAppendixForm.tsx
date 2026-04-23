'use client';

import { useState, useEffect, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { AlertTriangle, AlertOctagon } from 'lucide-react';
import { FormField } from './FormField';
import { PlaceholderBadge } from './PlaceholderBadge';
import { useAutoSave } from '@/hooks/useAutoSave';
import { useFirmVariables } from '@/hooks/useFirmVariables';
import { useSignOff } from './SignOffHeader';
import { evaluateFormula, buildFormulaValues, slugifyQuestionText } from '@/lib/formula-engine';
import { evaluateRulesForSchedule, type ValidationRule, type RuleEvaluation } from '@/lib/validation-rules';
import type { TemplateQuestion } from '@/types/methodology';

/**
 * Endpoint → `questionnaires.<key>` mapping for the merge-field path shown
 * on the PlaceholderBadge. Unlisted endpoints fall back to a sensible
 * camelCase derivative of the endpoint itself (still a valid path, just
 * not the canonical one documented in template-merge-fields.ts).
 */
const ENDPOINT_TO_QUESTIONNAIRE_KEY: Record<string, string> = {
  'ethics': 'ethics',
  'continuance': 'continuance',
  'permanent-file': 'permanentFile',
  'materiality': 'materiality',
  'new-client': 'newClientTakeOn',
  'subsequent-events': 'subsequentEvents',
  'fees': 'fees',
  'prior-period': 'priorPeriod',
};
function endpointToQuestionnaireKey(endpoint: string): string {
  if (ENDPOINT_TO_QUESTIONNAIRE_KEY[endpoint]) return ENDPOINT_TO_QUESTIONNAIRE_KEY[endpoint];
  // Fallback: kebab-case → camelCase, stripping non-alphanumerics.
  return endpoint.replace(/[-_]+([a-z0-9])/g, (_, c) => c.toUpperCase()).replace(/[^a-zA-Z0-9]/g, '');
}

type FormValues = Record<string, string | number | boolean | null>;

interface Props {
  engagementId: string;
  endpoint: string;
  questions: TemplateQuestion[];
  initialData: FormValues;
  crossRefData?: Record<string, FormValues>;
  /**
   * Extra read-only variables made available to formula expressions but never
   * saved back to the engagement. Use for firm-wide assumptions like firm_fees.
   */
  externalValues?: FormValues;
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
  externalValues,
  showActionTriggers = false,
  actionTriggerOptions = [],
  priorYearData,
}: Props) {
  const { data: session } = useSession();
  const isAdminViewer = Boolean((session?.user as any)?.isSuperAdmin || (session?.user as any)?.isMethodologyAdmin);
  const questionnaireKey = endpointToQuestionnaireKey(endpoint);

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

  // ── Validation rules ─────────────────────────────────────────────
  // Firm-wide rules set up by the Methodology Admin (Methodology
  // Admin → Validation Rules). Each rule has a formula-engine
  // expression; when it evaluates truthy against the current answers,
  // a banner appears at the top of this schedule.
  //
  // Loaded once on mount. Re-evaluated on every change via the
  // `values` dep. Scheduled key matches the form's `endpoint` prop
  // (e.g. 'ethics', 'materiality', 'fees') — the admin picks the
  // same key when setting up the rule, so they wire up 1:1.
  const [rules, setRules] = useState<ValidationRule[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/methodology-admin/validation-rules');
        if (!res.ok) return;
        const data = await res.json().catch(() => ({}));
        if (!cancelled && Array.isArray(data.rules)) setRules(data.rules as ValidationRule[]);
      } catch { /* silent — no rules = no banners */ }
    })();
    return () => { cancelled = true; };
  }, []);

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

  // Firm-wide hard-coded numeric variables (fetched once, cached at module level).
  // These are merged into the formula evaluation context as read-only values —
  // never saved back to the engagement. They're defined in
  // Methodology Admin → Firm-Wide Assumptions → Firm Variables.
  const { map: firmVariablesMap } = useFirmVariables();

  // Compute formula values. External variables (firm-wide + any explicit prop)
  // are merged into a read-only view passed to the formula engine so bare
  // identifiers resolve. Then buildFormulaValues adds slug aliases of every
  // question text so admins can write `audit_fee` even when the actual
  // question id is a GUID. The slug aliases are never saved.
  const computedValues = useMemo(() => {
    const merged: FormValues = { ...firmVariablesMap, ...(externalValues || {}), ...values };
    const withAliases = buildFormulaValues(questions, merged);
    const computed: FormValues = {};
    for (const q of questions) {
      // Formula-typed questions: always evaluate via the template's formulaExpression.
      if (q.inputType === 'formula' && q.formulaExpression) {
        computed[q.id] = evaluateFormula(q.formulaExpression, withAliases, crossRefData);
        continue;
      }
      // Ad-hoc formulas: if the saved answer is a string starting with '='
      // treat it as a formula too — the auditor sees the computed result and
      // the '=' expression stays hidden (only revealed when editing).
      const raw = values[q.id];
      if (typeof raw === 'string' && raw.trim().startsWith('=')) {
        const expr = raw.trim().slice(1);
        computed[q.id] = evaluateFormula(expr, withAliases, crossRefData);
      }
    }
    return computed;
  }, [questions, values, externalValues, firmVariablesMap, crossRefData]);

  function handleChange(questionId: string, value: string | number | boolean | null) {
    setValues(prev => ({ ...prev, [questionId]: value }));
    trackFieldEdit(questionId);
  }

  /** Evaluate a `conditionalOn` rule against the current answers
   *  collection. Supports the full operator set; defaults to 'eq'
   *  when no operator is set (back-compat with old schemas). */
  function isVisible(q: TemplateQuestion): boolean {
    if (!q.conditionalOn) return true;
    const { questionId, value, operator = 'eq' } = q.conditionalOn;
    const depValue = values[questionId];
    const depStr = depValue == null ? '' : String(depValue);
    const expected = String(value ?? '');
    // Numeric operators coerce both sides via Number() — NaN short-
    // circuits to false so a missing/unparseable answer hides the
    // dependent question instead of showing it unexpectedly.
    const asNum = (v: string) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : NaN;
    };
    switch (operator) {
      case 'eq':          return depStr === expected;
      case 'ne':          return depStr !== expected;
      case 'contains':    return depStr.toLowerCase().includes(expected.toLowerCase());
      case 'notContains': return !depStr.toLowerCase().includes(expected.toLowerCase());
      case 'isEmpty':     return depStr.trim().length === 0;
      case 'isNotEmpty':  return depStr.trim().length > 0;
      case 'gt':  { const a = asNum(depStr), b = asNum(expected); return Number.isFinite(a) && Number.isFinite(b) && a >  b; }
      case 'gte': { const a = asNum(depStr), b = asNum(expected); return Number.isFinite(a) && Number.isFinite(b) && a >= b; }
      case 'lt':  { const a = asNum(depStr), b = asNum(expected); return Number.isFinite(a) && Number.isFinite(b) && a <  b; }
      case 'lte': { const a = asNum(depStr), b = asNum(expected); return Number.isFinite(a) && Number.isFinite(b) && a <= b; }
      default:            return depStr === expected;
    }
  }

  // Compute violated rules for THIS schedule against current answers.
  // Runs on every render — cheap, since evaluation is pure string
  // parsing + arithmetic over a small map. Rules keyed to other
  // schedules are filtered out inside evaluateRulesForSchedule.
  const ruleEvaluations: RuleEvaluation[] = evaluateRulesForSchedule(
    rules,
    endpoint,
    questions,
    values,
    externalValues || undefined,
  );
  const violations = ruleEvaluations.filter(r => r.violated);

  return (
    <div className="space-y-4">
      {/* Validation-rule banners — stack in order, red errors first,
          then amber warnings. Each banner shows the rule label as
          the heading and the admin-written message as the body. */}
      {violations.length > 0 && (
        <div className="space-y-2">
          {violations
            .slice()
            .sort((a, b) => (a.rule.severity === 'error' ? -1 : 1) - (b.rule.severity === 'error' ? -1 : 1))
            .map(v => (
              <div
                key={v.rule.id}
                className={`flex items-start gap-2 p-3 rounded-lg border-2 ${
                  v.rule.severity === 'error'
                    ? 'bg-red-50 border-red-300'
                    : 'bg-amber-50 border-amber-300'
                }`}
                role="alert"
              >
                {v.rule.severity === 'error'
                  ? <AlertOctagon className="h-4 w-4 text-red-600 flex-shrink-0 mt-0.5" />
                  : <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0 mt-0.5" />}
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-semibold ${v.rule.severity === 'error' ? 'text-red-800' : 'text-amber-800'}`}>
                    {v.rule.label || 'Validation issue'}
                  </p>
                  {v.rule.message && (
                    <p className={`text-xs mt-0.5 whitespace-pre-wrap leading-relaxed ${v.rule.severity === 'error' ? 'text-red-700' : 'text-amber-700'}`}>
                      {v.rule.message}
                    </p>
                  )}
                </div>
              </div>
            ))}
        </div>
      )}

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
                // Sub-header rows: full-width grouping label, no inputs.
                // Rendered here inside the same bordered container so
                // they sit in the visual flow of questions as a
                // section divider.
                if (q.inputType === 'subheader') {
                  return (
                    <div key={q.id} className={`px-3 py-2 bg-slate-100/70 ${idx > 0 ? 'border-t border-slate-200' : ''}`}>
                      <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-700">
                        {q.questionText}
                      </h4>
                    </div>
                  );
                }
                const outline = getFieldOutline(q.id);
                // Admin-only placeholder path — what the template editor
                // would use to reference this answer. Priority:
                //   1. The question's explicit `.key` from the schema
                //      (seeded templates set snake_case keys like
                //      `entity_address` that may NOT match a slug of the
                //      question text like `entity_address_block`).
                //   2. slugifyQuestionText(questionText) — works for
                //      admin-created questions without an explicit key.
                //   3. The raw UUID id as a last resort.
                // lib/template-context.ts keys the questionnaires branch
                // by the same `.key` field, so option 1 is the canonical
                // placeholder path — matching it here keeps the chip
                // honest.
                const qKey = (q as any).key as string | undefined;
                const questionSlug = (qKey && qKey.trim()) || slugifyQuestionText(q.questionText) || q.id;
                const placeholderPath = `questionnaires.${questionnaireKey}.${questionSlug}`;
                return (
                  <div key={q.id} className={`group flex gap-0 ${idx > 0 ? 'border-t border-slate-100' : ''}`}>
                    <div className="bg-slate-50 px-3 py-2 w-[35%] flex-shrink-0 flex items-start">
                      <label htmlFor={q.id} className="text-xs text-slate-700 leading-snug flex-1">
                        {q.questionText}
                        {q.isRequired && <span className="text-red-400 ml-0.5">*</span>}
                      </label>
                      {isAdminViewer && (
                        <PlaceholderBadge
                          path={placeholderPath}
                          title={`Merge-field placeholder (admins only) — click to copy\n{{${placeholderPath}}}`}
                        />
                      )}
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
                          value={(values[`py_${q.id}`] as string | number | undefined) ?? ''}
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
                        // Treat as formula when the question is configured
                        // that way OR the saved answer starts with '=' —
                        // both paths hide the raw formula and display the
                        // computed result.
                        isFormula={q.inputType === 'formula' || (typeof values[q.id] === 'string' && (values[q.id] as string).trim().startsWith('='))}
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

      {/* Specialist-review panel now lives in the sticky header (next
          to the sign-off dots) via EngagementTabs → SignOffHeader's
          `headerActions` slot. Moved 2026-04-22 so auditors can see
          and trigger reviews without scrolling to the bottom. */}
    </div>
  );
}

function formatSectionLabel(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
