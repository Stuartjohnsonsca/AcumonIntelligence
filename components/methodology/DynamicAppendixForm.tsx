'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { AlertTriangle, AlertOctagon } from 'lucide-react';
import { FormField } from './FormField';
import { PlaceholderBadge } from './PlaceholderBadge';
import { useAutoSave } from '@/hooks/useAutoSave';
import { useFirmVariables } from '@/hooks/useFirmVariables';
import { useSignOff } from './SignOffHeader';
import { evaluateFormula, buildFormulaValues, slugifyQuestionText } from '@/lib/formula-engine';
import { evaluateRulesForSchedule, type ValidationRule, type RuleEvaluation } from '@/lib/validation-rules';
import type { TemplateQuestion, TemplateSectionMeta, SectionLayout } from '@/types/methodology';
import { DEFAULT_COLUMN_HEADERS } from '@/types/methodology';
import { subscribeTemplateRefsChanged } from '@/lib/template-references-bus';
import { formatDisplayValue } from '@/lib/format-display';

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
  /**
   * Optional per-section metadata (layout + custom column headers).
   * When a section has `layout: 'table_3col' | 'table_4col' | 'table_5col'`
   * we render the questions in that section as a multi-column table
   * (one row per question, each non-label column becomes an editable
   * cell stored under `<questionId>_col<N>`). Standard (Q&A) layout is
   * the default when no entry is provided.
   */
  sectionMeta?: Record<string, TemplateSectionMeta>;
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
  sectionMeta,
}: Props) {
  const { data: session } = useSession();
  const isAdminViewer = Boolean((session?.user as any)?.isSuperAdmin || (session?.user as any)?.isMethodologyAdmin);
  const questionnaireKey = endpointToQuestionnaireKey(endpoint);

  const [values, setValues] = useState<FormValues>(initialData);
  // AI Polish — track which cell key is currently in flight so we can
  // show a spinner and disable the button while the request is open.
  // Keyed by cell key (`<questionId>` for standard rows, `<questionId>_col<N>`
  // for multi-column cells) since one row could have multiple polish-able
  // cells in flight simultaneously in principle.
  const [polishingKey, setPolishingKey] = useState<string | null>(null);
  const [polishError, setPolishError] = useState<string | null>(null);

  /**
   * Send the current cell value to the AI polish endpoint and
   * write the rewritten text back. The auditor can keep editing
   * afterwards — this is a one-shot rewrite, not a binding.
   */
  async function runAiPolish(cellKey: string, questionContext: string): Promise<void> {
    const current = values[cellKey];
    const text = typeof current === 'string' ? current : '';
    if (!text.trim()) {
      setPolishError('Type something first — there\'s nothing to polish.');
      return;
    }
    setPolishingKey(cellKey);
    setPolishError(null);
    try {
      const res = await fetch(`/api/engagements/${engagementId}/ai-polish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, questionContext }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPolishError(data?.error || 'AI polish failed');
        return;
      }
      const polished = String(data?.polished || '').trim();
      if (!polished) {
        setPolishError('AI returned no text — try rewording the original.');
        return;
      }
      // Write the polished text back. handleChange goes through the
      // normal change pipeline so it picks up auto-save / dirty state /
      // validation just like a manual edit.
      handleChange(cellKey, polished);
    } catch (err: any) {
      setPolishError(err?.message || 'AI polish failed');
    } finally {
      setPolishingKey(null);
    }
  }
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

  // ── Template-reference highlight ─────────────────────────────────
  // Every cell on this schedule whose placeholder path is referenced
  // by at least one document OR email template on the firm gets a
  // red outline at runtime. Purpose: make it obvious to the auditor
  // which answers end up in generated documents, so they know these
  // fields matter beyond the schedule itself. Fetched once on mount;
  // failing silently is fine — no highlights is a sensible default.
  const [referencedPaths, setReferencedPaths] = useState<Set<string>>(new Set());
  const [referencedByPath, setReferencedByPath] = useState<Record<string, Array<{ templateId: string; templateName: string; kind: string }>>>({});
  useEffect(() => {
    let cancelled = false;
    // Pulled out so the same fetch can run on mount AND on every
    // template-saved notification from the bus. State updates are
    // gated by `cancelled` so a slow fetch from a stale subscription
    // can't overwrite fresh state after the component unmounts.
    async function loadRefs() {
      try {
        const res = await fetch('/api/methodology-admin/template-references');
        if (!res.ok) return;
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (Array.isArray(data.paths)) setReferencedPaths(new Set(data.paths));
        if (data.byPath && typeof data.byPath === 'object') setReferencedByPath(data.byPath);
      } catch { /* silent — no highlights */ }
    }
    loadRefs();

    // Live refresh: any template create / update / delete /
    // duplicate / activate-toggle in another tab (or this tab) fires
    // an invalidation through the bus, which calls loadRefs() again.
    // Auditors with a schedule open see red outlines update the
    // moment an admin saves a template, no page reload needed.
    const unsubscribe = subscribeTemplateRefsChanged(() => {
      if (cancelled) return;
      loadRefs();
    });

    return () => { cancelled = true; unsubscribe(); };
  }, []);

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

  // ── Cross-schedule answers (for `crossRef` fields) ────────────────
  // Pulled once on mount so questions whose `crossRef` points to another
  // schedule (e.g. "ethics.independence_confirmed" or the letter alias
  // "appendix_b.independence_confirmed") display the live cross-ref value
  // here rather than the admin having to re-type it. Only needed when at
  // least one question has a non-empty crossRef — we skip the fetch
  // otherwise.
  const [crossSchedules, setCrossSchedules] = useState<{
    questionnaires: Record<string, Record<string, any>>;
    aliases: Record<string, string>;
  } | null>(null);
  // We fetch cross-schedule data whenever the schedule has EITHER
  // a cross-ref field OR a formula — because formulas can now reach
  // into the synthetic `engagement` bucket (period_end, hard_close,
  // team_<role>_name, etc.) or any other appendix via
  // `{appendix.field}` syntax.
  const hasCrossRefs = useMemo(() => questions.some(q => typeof (q as any).crossRef === 'string' && (q as any).crossRef.trim()), [questions]);
  const hasFormulas = useMemo(() => questions.some(q => {
    if (q.inputType === 'formula' && q.formulaExpression) return true;
    if (Array.isArray(q.columns)) {
      for (const c of q.columns) {
        if (c?.inputType === 'formula' && c.formulaExpression) return true;
      }
    }
    return false;
  }), [questions]);
  useEffect(() => {
    if ((!hasCrossRefs && !hasFormulas) || !engagementId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/engagements/${engagementId}/questionnaires`);
        if (!res.ok) return;
        const data = await res.json().catch(() => ({}));
        if (!cancelled && data?.questionnaires) setCrossSchedules({ questionnaires: data.questionnaires, aliases: data.aliases || {} });
      } catch { /* tolerant — crossRef fields will just render empty */ }
    })();
    return () => { cancelled = true; };
  }, [engagementId, hasCrossRefs, hasFormulas]);

  /** Resolve a `<appendix>.<field>` cross-ref against the loaded map.
   *  Returns null when the reference can't be resolved — the UI treats
   *  that as an empty value. */
  /**
   * True when the question's answer is referenced by at least one
   * document / email template. We check:
   *   - the canonical path (questionnaires.<schedule>.<key>)
   *   - the schedule-by-section variant (bySection.<section>.<key>)
   *   - any col<N> variants — for multi-column sections, any of the
   *     sub-column paths counts as a reference
   * Accepts either the question's .key or its slugified text as the
   * key part; the context builder exposes both aliases.
   */
  function isQuestionReferenced(q: TemplateQuestion): boolean {
    if (referencedPaths.size === 0) return false;
    const candidates = candidatePathsForQuestion(q);
    for (const p of candidates) {
      if (referencedPaths.has(p)) return true;
    }
    return false;
  }

  /** Same but for a specific column — used on multi-column table rows
   *  so only the cell that's actually referenced goes red, not the
   *  whole row. */
  function isColumnReferenced(q: TemplateQuestion, colN: number): boolean {
    if (referencedPaths.size === 0) return false;
    const candidates = candidatePathsForColumn(q, colN);
    for (const p of candidates) {
      if (referencedPaths.has(p)) return true;
    }
    return false;
  }

  /**
   * Every path that COULD identify this question's answer cell. Two
   * families:
   *   1. Fully-qualified `questionnaires.<X>.<key>` — when an admin
   *      drops a single placeholder pill into a template body.
   *   2. asList loop-context paths — when the template iterates the
   *      schedule with `{{#each questionnaires.<X>.asList}}` and uses
   *      `{{answer}}` (standard layouts) inside the body. Both
   *      section-specific and section-agnostic forms are checked so
   *      a Threats-only loop outlines only Threats rows, while a
   *      whole-schedule loop outlines every section.
   */
  function candidatePathsForQuestion(q: TemplateQuestion): string[] {
    const candidates: string[] = [];
    const qKey = (q as any).key as string | undefined;
    const keys: string[] = [];
    if (qKey && qKey.trim()) keys.push(qKey.trim());
    const slug = slugifyQuestionText(q.questionText);
    if (slug && !keys.includes(slug)) keys.push(slug);
    const sec = q.sectionKey ? String(q.sectionKey).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') : null;
    for (const k of keys) {
      candidates.push(`questionnaires.${questionnaireKey}.${k}`);
      if (sec) candidates.push(`questionnaires.${questionnaireKey}.bySection.${sec}.${k}`);
      // Multi-column variants — fully-qualified.
      for (let i = 1; i <= 10; i++) {
        candidates.push(`questionnaires.${questionnaireKey}.${k}_col${i}`);
      }
    }
    // Loop-context: {{answer}} body refs (standard-layout schedules).
    const sectionLiteral = q.sectionKey ? String(q.sectionKey) : '';
    candidates.push(`asList:${questionnaireKey}:${sectionLiteral}@answer`);
    candidates.push(`asList:${questionnaireKey}:@answer`);
    return candidates;
  }

  /**
   * Cell-level candidates. In addition to the fully-qualified col<N>
   * path, we also match the asList loop-context path emitted by the
   * template-references API:
   *   asList:<schedule>:<sectionLiteral>@col<N>
   *   asList:<schedule>:@col<N>
   * The API resolves slug body refs (e.g. {{threat_description}})
   * to col<N> via sectionMeta before adding them to the path set,
   * so the matcher only needs to compare col<N> here.
   */
  function candidatePathsForColumn(q: TemplateQuestion, colN: number): string[] {
    const candidates: string[] = [];
    const qKey = (q as any).key as string | undefined;
    const keys: string[] = [];
    if (qKey && qKey.trim()) keys.push(qKey.trim());
    const slug = slugifyQuestionText(q.questionText);
    if (slug && !keys.includes(slug)) keys.push(slug);
    for (const k of keys) {
      candidates.push(`questionnaires.${questionnaireKey}.${k}_col${colN}`);
    }
    const sectionLiteral = q.sectionKey ? String(q.sectionKey) : '';
    candidates.push(`asList:${questionnaireKey}:${sectionLiteral}@col${colN}`);
    candidates.push(`asList:${questionnaireKey}:@col${colN}`);
    return candidates;
  }

  /** Build a tooltip listing which templates reference a given path. */
  function referencedByTooltip(q: TemplateQuestion, colN?: number): string {
    const candidates = colN ? candidatePathsForColumn(q, colN) : candidatePathsForQuestion(q);
    // Dedup template hits — the same template can show up under
    // multiple candidate paths (e.g. both the fully-qualified path
    // AND the asList loop-context path), and admins want to see
    // each template only once.
    const seen = new Set<string>();
    const hits: string[] = [];
    for (const p of candidates) {
      const refs = referencedByPath[p];
      if (!refs) continue;
      for (const r of refs) {
        const dedupKey = `${r.kind}|${r.templateId}`;
        if (seen.has(dedupKey)) continue;
        seen.add(dedupKey);
        hits.push(`${r.kind}: ${r.templateName}`);
      }
    }
    if (hits.length === 0) return '';
    return `Referenced by:\n  • ${hits.join('\n  • ')}`;
  }

  function resolveCrossRef(ref: string | undefined | null): any {
    if (!ref || !crossSchedules) return null;
    const trimmed = ref.trim();
    const dotIdx = trimmed.indexOf('.');
    if (dotIdx <= 0 || dotIdx >= trimmed.length - 1) return null;
    const appendix = trimmed.slice(0, dotIdx).trim();
    const field = trimmed.slice(dotIdx + 1).trim();
    // Apply alphabetic alias (appendix_b → ethics etc.) when present.
    const scheduleKey = crossSchedules.aliases[appendix] || appendix;
    const bucket = crossSchedules.questionnaires[scheduleKey];
    if (!bucket) return null;
    // Try the enriched key first; fall back to UUID lookup via _byId for
    // questions that haven't been given an explicit `.key`.
    if (field in bucket) return bucket[field];
    const byId = (bucket as any)._byId;
    if (byId && field in byId) return byId[field];
    return null;
  }

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
    // We MUTATE `withAliases` as we go — each formula's result is
    // published back under every alias the next formula could use to
    // reference it (raw id, slug from question text, explicit q.key,
    // and `_col<N>` variants). Without this, chained formulas — e.g.
    // col2 = "refer_to_tax_specialist_col1" reading col1's formula
    // result — silently see undefined and never update.
    const withAliases = buildFormulaValues(questions, merged);
    // Merge cross-ref sources so formulas can reference either a
    // parent-component-supplied context (rare) OR the live data the
    // form fetched itself — the latter carries `engagement` (Opening
    // tab data) and every other completed appendix on this engagement.
    const effectiveCrossRef: Record<string, FormValues> = {
      ...(crossRefData || {}),
      ...(crossSchedules?.questionnaires || {}),
    };
    const computed: FormValues = {};

    // Helper: write a freshly-computed value back into `withAliases`
    // under every alias dependents might use. Mirrors the alias set
    // produced by buildFormulaValues so referencing by raw id, by
    // slug, by explicit key, or by `_col<N>` variant all resolve to
    // the same live value.
    function publish(qId: string, slug: string, explicitKey: string | undefined, colN: number | undefined, value: any) {
      const suffix = colN ? `_col${colN}` : '';
      withAliases[`${qId}${suffix}`] = value;
      if (slug) withAliases[`${slug}${suffix}`] = value;
      if (explicitKey) withAliases[`${explicitKey}${suffix}`] = value;
    }

    for (const q of questions) {
      const slug = slugifyQuestionText(q.questionText);
      const explicitKey = (q as any).key as string | undefined;
      // crossRef questions: value comes from another schedule. Wins over
      // formula/raw — if the admin pointed this cell at another appendix,
      // the cell IS that other answer. Rendered read-only below.
      const qCrossRef = (q as any).crossRef as string | undefined;
      if (qCrossRef && qCrossRef.trim()) {
        const resolved = resolveCrossRef(qCrossRef);
        const v = resolved === null || resolved === undefined ? '' : resolved;
        computed[q.id] = v;
        publish(q.id, slug, explicitKey, undefined, v);
        continue;
      }
      // Formula-typed questions: always evaluate via the template's formulaExpression.
      if (q.inputType === 'formula' && q.formulaExpression) {
        const v = evaluateFormula(q.formulaExpression, withAliases, effectiveCrossRef);
        computed[q.id] = v;
        publish(q.id, slug, explicitKey, undefined, v);
        continue;
      }
      // Ad-hoc formulas: if the saved answer is a string starting with '='
      // treat it as a formula too — the auditor sees the computed result and
      // the '=' expression stays hidden (only revealed when editing).
      const raw = values[q.id];
      if (typeof raw === 'string' && raw.trim().startsWith('=')) {
        const expr = raw.trim().slice(1);
        const v = evaluateFormula(expr, withAliases, effectiveCrossRef);
        computed[q.id] = v;
        publish(q.id, slug, explicitKey, undefined, v);
      }
      // Per-cell formulas in multi-column rows. Each cell with
      // inputType='formula' has its own formulaExpression stored on
      // q.columns[ci]. The row's aliases already expose col1..colN
      // for this q.id (see template-aliases buildAliases), so a cell
      // formula can freely reference `col1 * col2` or any other
      // question / firm variable by identifier.
      if (Array.isArray(q.columns) && q.columns.length > 0) {
        for (let ci = 0; ci < q.columns.length; ci++) {
          const colCfg = q.columns[ci];
          if (colCfg?.inputType === 'formula' && colCfg.formulaExpression) {
            const cellKey = `${q.id}_col${ci + 1}`;
            const v = evaluateFormula(colCfg.formulaExpression, withAliases, effectiveCrossRef);
            computed[cellKey] = v;
            publish(q.id, slug, explicitKey, ci + 1, v);
          }
        }
      }
    }
    return computed;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questions, values, externalValues, firmVariablesMap, crossRefData, crossSchedules]);

  function handleChange(questionId: string, value: string | number | boolean | null) {
    setValues(prev => ({ ...prev, [questionId]: value }));
    trackFieldEdit(questionId);
  }

  // ── Schedule-action firing ─────────────────────────────────────────
  //
  // When a question's effective value (computed if it's a formula
  // cell, raw otherwise) transitions INTO its configured triggerValue,
  // POST to the specialists endpoint to spin up a chat with the
  // action's role. The server is idempotent on (engagement, action,
  // questionId) so repeat fires are no-ops, but we also track the
  // prior value here to avoid even making the request on every render.
  //
  // First render captures the initial snapshot WITHOUT firing —
  // otherwise opening an existing engagement would refire every
  // already-triggered action on page load.
  //
  // Comparison is string-coerced + trimmed so a formula returning
  // the number 2 still matches a triggerValue saved as the string
  // "2" (or "2 " from a copy/paste).
  const prevTriggerSnapshotRef = useRef<Record<string, string> | null>(null);
  useEffect(() => {
    // Build current effective-value snapshot for every question with
    // a configured action. Formula cells: prefer computedValues.
    // Multi-column rows can have a formula on col1 → check col1's
    // computed value too (covers the "Refer to Tax Specialist"
    // pattern where the action sits on the row but the value lives
    // on col1).
    const current: Record<string, string> = {};
    for (const q of questions) {
      if (!q.scheduleAction?.key || !q.scheduleAction.triggerValue) continue;
      const rowVal = computedValues[q.id] ?? values[q.id];
      let effective: any = rowVal;
      // If the row has no row-level value but col1 does (multi-column
      // formula row), use col1. Otherwise fall through to row value.
      if ((effective === undefined || effective === null || effective === '') && Array.isArray(q.columns) && q.columns.length > 0) {
        const col1Key = `${q.id}_col1`;
        const col1 = computedValues[col1Key] ?? values[col1Key];
        if (col1 !== undefined && col1 !== null && col1 !== '') effective = col1;
      }
      current[q.id] = effective === null || effective === undefined ? '' : String(effective).trim();
    }

    // First render: stash and bail. We don't want to refire actions
    // that had already triggered in a prior session.
    if (prevTriggerSnapshotRef.current === null) {
      prevTriggerSnapshotRef.current = current;
      return;
    }

    for (const q of questions) {
      if (!q.scheduleAction?.key || !q.scheduleAction.triggerValue) continue;
      const want = String(q.scheduleAction.triggerValue).trim();
      const now = current[q.id] ?? '';
      const before = prevTriggerSnapshotRef.current[q.id] ?? '';
      // Fire only on transition into the trigger value.
      if (now === want && before !== want) {
        const actionKey = q.scheduleAction.key;
        fetch(`/api/engagements/${engagementId}/specialists/items`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            scheduleActionKey: actionKey,
            questionId: q.id,
            questionText: q.questionText,
            response: now,
          }),
        }).catch(() => { /* fire-and-forget; server is idempotent */ });
      }
    }
    prevTriggerSnapshotRef.current = current;
    // questions / engagementId are stable for the lifetime of this form.
    // computedValues + values drive re-evaluation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [computedValues, values]);

  /** Evaluate a `conditionalOn` rule against the current answers
   *  collection. Supports the full operator set; defaults to 'eq'
   *  when no operator is set (back-compat with old schemas). */
  /**
   * Per-cell visibility for a multi-column row. When a cell has a
   * conditionalOn pointing at another column on the SAME row, we
   * evaluate the other cell's current value against the operator +
   * expected value. Returns true (show) when there's no condition or
   * the condition passes; false (hide, render empty cell) otherwise.
   */
  function isCellVisible(q: TemplateQuestion, ci: number): boolean {
    const cond = q.columns?.[ci]?.conditionalOn;
    if (!cond) return true;
    // "Never" is a permanent-hide operator — no columnIndex / value
    // needed. Evaluate it before the other operators so admins can
    // tick "Never show" without also having to pick a reference
    // column they don't actually care about.
    if (cond.operator === 'never') return false;
    const { columnIndex, operator = 'eq', value = '' } = cond;
    if (!Number.isFinite(columnIndex) || columnIndex < 1) return true;
    const refKey = `${q.id}_col${columnIndex}`;
    const refValue = values[refKey];
    const refStr = refValue == null ? '' : String(refValue);
    const expected = String(value ?? '');
    const asNum = (v: string) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : NaN;
    };
    switch (operator) {
      case 'eq':          return refStr === expected;
      case 'ne':          return refStr !== expected;
      case 'contains':    return refStr.toLowerCase().includes(expected.toLowerCase());
      case 'notContains': return !refStr.toLowerCase().includes(expected.toLowerCase());
      case 'isEmpty':     return refStr.trim().length === 0;
      case 'isNotEmpty':  return refStr.trim().length > 0;
      case 'gt':  { const a = asNum(refStr), b = asNum(expected); return Number.isFinite(a) && Number.isFinite(b) && a >  b; }
      case 'gte': { const a = asNum(refStr), b = asNum(expected); return Number.isFinite(a) && Number.isFinite(b) && a >= b; }
      case 'lt':  { const a = asNum(refStr), b = asNum(expected); return Number.isFinite(a) && Number.isFinite(b) && a <  b; }
      case 'lte': { const a = asNum(refStr), b = asNum(expected); return Number.isFinite(a) && Number.isFinite(b) && a <= b; }
      default:            return refStr === expected;
    }
  }

  function isVisible(q: TemplateQuestion): boolean {
    if (!q.conditionalOn) return true;
    // "Never" is a permanent-hide — shown first so admins don't
    // need to pick a reference question just to suppress a row.
    if (q.conditionalOn.operator === 'never') return false;
    const { questionId, value, operator = 'eq', columnIndex } = q.conditionalOn;
    // When columnIndex is set the condition reads the parent's
    // per-cell value (stored as `<questionId>_col<N>`) instead of
    // the row-level answer. Used for table-layout sections where a
    // row's visibility depends on a specific cell of another row.
    const depKey = typeof columnIndex === 'number' && columnIndex >= 1
      ? `${questionId}_col${columnIndex}`
      : questionId;
    const depValue = values[depKey];
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
      {/* AI Polish error banner — surfaces transient failures from the
          /ai-polish endpoint (network blip, model overload, empty
          response). Auto-dismissable; the auditor's text is left
          untouched on failure. */}
      {polishError && (
        <div className="flex items-start gap-2 p-2.5 rounded-lg border border-fuchsia-200 bg-fuchsia-50 text-[11px] text-fuchsia-800">
          <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5 text-fuchsia-600" />
          <div className="flex-1">
            <div className="font-semibold">AI Polish couldn&rsquo;t process this</div>
            <div>{polishError}</div>
          </div>
          <button
            type="button"
            onClick={() => setPolishError(null)}
            className="text-fuchsia-600 hover:text-fuchsia-800 text-xs"
          >dismiss</button>
        </div>
      )}
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

        // Per-section layout — 'standard' (Q + PY + CY) is the default.
        // Non-standard layouts ('table_3col'/'4col'/'5col') render as a
        // multi-column table, one row per question, each non-label
        // column an editable cell stored under <questionId>_col<N>.
        // Admin sets this on the schedule in Methodology Admin →
        // Schedules → <Schedule Name> → section layout dropdown.
        const meta = sectionMeta?.[section.label];
        const sectionLayout: SectionLayout = (meta?.layout as SectionLayout) || 'standard';
        const tableHeaders = sectionLayout !== 'standard'
          ? (meta?.columnHeaders && meta.columnHeaders.length > 0
              ? meta.columnHeaders
              : (DEFAULT_COLUMN_HEADERS[sectionLayout] || []))
          : [];

        if (sectionLayout !== 'standard' && tableHeaders.length > 0) {
          return (
            <div key={section.label}>
              <div className="bg-blue-50 px-3 py-1.5 rounded-t-lg border border-blue-100">
                <h3 className="text-xs font-semibold text-blue-800">{formatSectionLabel(section.label)}</h3>
              </div>
              <div className="border border-t-0 border-slate-200 rounded-b-lg overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-100 border-b border-slate-200">
                      {tableHeaders.map((h, i) => (
                        <th
                          key={i}
                          className={`px-2 py-1.5 font-semibold text-slate-600 text-left ${i === 0 ? 'w-[35%]' : ''}`}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleQuestions.map((q, idx) => {
                      // Sub-header rows span the whole table.
                      if (q.inputType === 'subheader') {
                        return (
                          <tr key={q.id} className="bg-slate-100/70 border-b border-slate-200">
                            <td colSpan={tableHeaders.length} className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-700">
                              {q.questionText}
                            </td>
                          </tr>
                        );
                      }
                      // Description rows — question text spans every
                      // column rather than sitting narrow in column 0.
                      // Triggered by any of:
                      //   - q.isBold        (explicit admin flag from the schedule editor)
                      //   - 'textarea' / 'text' inputType with NO answer
                      //     cells to fill — i.e. a pure prose anchor
                      //     like "Audit strategy" above a table of
                      //     detail rows. Heuristic: when isBold is set
                      //     the admin has said "this is a header / label
                      //     row, not a data row". Matches how
                      //     CompletionPanel skips input cells for
                      //     isBold rows today.
                      if (q.isBold) {
                        return (
                          <tr key={q.id} className="bg-slate-50 border-b border-slate-200">
                            <td colSpan={tableHeaders.length} className="px-3 py-2 text-[11px] text-slate-700 leading-snug font-bold whitespace-pre-wrap">
                              {q.questionText}
                              {q.isRequired && <span className="text-red-400 ml-0.5">*</span>}
                            </td>
                          </tr>
                        );
                      }
                      const questionSlugT = (q as any).key || slugifyQuestionText(q.questionText) || q.id;
                      return (
                        <tr key={q.id} className={`group ${idx > 0 ? 'border-t border-slate-100' : ''} ${q.isBold ? 'bg-slate-50' : ''}`}>
                          {/* Column 0 — question text (read-only label). */}
                          <td className={`px-2 py-1.5 align-top ${q.isBold ? 'font-bold text-slate-700' : 'text-slate-700'}`}>
                            <div className="flex items-start gap-1">
                              <span className="flex-1 leading-snug">
                                {q.questionText}
                                {q.isRequired && <span className="text-red-400 ml-0.5">*</span>}
                              </span>
                              {isAdminViewer && (
                                <PlaceholderBadge
                                  path={`questionnaires.${questionnaireKey}.${questionSlugT}`}
                                  title={`Merge-field placeholder (admins only)\n{{questionnaires.${questionnaireKey}.${questionSlugT}}}`}
                                />
                              )}
                            </div>
                          </td>
                          {/* Remaining columns — editable cells. Stored as
                              <questionId>_col<N> in the same values map.
                              Each column has its own admin-configured
                              input type + dropdown options + validation
                              (meta.columns[ci]), so col1 could be
                              currency, col2 could be a dropdown, col3
                              could be free-text, etc. — independent per
                              column, not inherited from the question's
                              inputType. Red ring = this specific column
                              is referenced by a document / email template. */}
                          {tableHeaders.slice(1).map((_, ci) => {
                            const colN = ci + 1;
                            const cellKey = `${q.id}_col${colN}`;
                            const colReferenced = isColumnReferenced(q, colN);
                            const colTitle = colReferenced ? referencedByTooltip(q, colN) : undefined;
                            const refClass = colReferenced ? 'ring-2 ring-red-500 ring-offset-1' : '';
                            // Per-cell conditional — e.g. col2 is only
                            // relevant when col1 is 'Y'. When the
                            // condition fails we render an empty
                            // greyed-out placeholder cell AND skip the
                            // input widget, so the admin's "left-hand
                            // response means no right-hand answer"
                            // semantic is visible to the auditor. We
                            // deliberately don't clear the stored
                            // value — if the auditor toggles col1
                            // back the previous col2 answer reappears.
                            if (!isCellVisible(q, ci)) {
                              return (
                                <td key={ci} className="px-2 py-1 align-top">
                                  <div className="w-full text-[10px] text-slate-300 italic text-center bg-slate-50 rounded border border-dashed border-slate-200 py-1">
                                    —
                                  </div>
                                </td>
                              );
                            }
                            // Per-cell config is ROW-level — each
                            // question (row) has its own `columns`
                            // array describing what widget to render
                            // in each non-label cell. Priority:
                            //   1. q.columns[ci] (the row's own per-cell config)
                            //   2. q.inputType + q.dropdownOptions  (row-wide fallback)
                            // Different rows in the same table can
                            // therefore mix widgets — a currency row
                            // and a commentary row sitting side-by-side
                            // under the same Planning Amount column
                            // each render their own appropriate input.
                            const rowColCfg = q.columns?.[ci];
                            const cellInputType = rowColCfg?.inputType || q.inputType;
                            const cellOptions = rowColCfg?.dropdownOptions && rowColCfg.dropdownOptions.length > 0
                              ? rowColCfg.dropdownOptions
                              : q.dropdownOptions;
                            const cellPlaceholder = rowColCfg?.placeholder;
                            // Per-cell merge-field path. Always emitted in
                            // the form admins paste verbatim into a
                            // template — `questionnaires.<schedule>.<key>_col<N>`.
                            // The hover badge shows it AND copies it to
                            // the clipboard with one click.
                            //
                            // For multi-column sections the section's
                            // column header (when set) maps to a slug
                            // alias the renderer also exposes — e.g.
                            // header "Threat Description" on col2 of
                            // Ethics → Non Audit Services becomes
                            // {{threat_description}} INSIDE an asList
                            // loop. The badge tooltip lists that slug
                            // form too, so admins know both options.
                            const cellPath = `questionnaires.${questionnaireKey}.${questionSlugT}_col${colN}`;
                            const colHeaderText = String(tableHeaders[colN] || '');
                            const headerSlug = colHeaderText
                              ? colHeaderText.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
                              : '';
                            const cellBadgeTitle = headerSlug
                              ? `Merge-field placeholder (admins only)\n{{${cellPath}}}\n\nInside an asList loop, the column header "${colHeaderText}" is also addressable as {{${headerSlug}}}.`
                              : `Merge-field placeholder (admins only)\n{{${cellPath}}}`;
                            return (
                              <td key={ci} className="px-2 py-1 align-top relative" title={colTitle}>
                                {q.isBold ? null : cellInputType === 'dropdown' && cellOptions ? (
                                  <select
                                    value={(values[cellKey] as string) || ''}
                                    onChange={e => handleChange(cellKey, e.target.value)}
                                    className={`w-full border border-slate-200 rounded px-1.5 py-1 text-xs focus:outline-none focus:border-blue-300 ${refClass}`}
                                  >
                                    <option value="">Select...</option>
                                    {cellOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                                  </select>
                                ) : cellInputType === 'multiselect' && cellOptions ? (() => {
                                  const raw = values[cellKey];
                                  const selected: string[] = (() => {
                                    if (!raw || typeof raw !== 'string') return [];
                                    try {
                                      const parsed = JSON.parse(raw);
                                      return Array.isArray(parsed) ? parsed.filter((s: unknown) => typeof s === 'string') : [];
                                    } catch { return []; }
                                  })();
                                  const toggle = (opt: string) => {
                                    const next = selected.includes(opt) ? selected.filter(s => s !== opt) : [...selected, opt];
                                    handleChange(cellKey, next.length === 0 ? '' : JSON.stringify(next));
                                  };
                                  return (
                                    <div className={`w-full flex flex-wrap gap-x-2 gap-y-0.5 ${refClass}`}>
                                      {cellOptions.map(opt => (
                                        <label key={opt} className="inline-flex items-center gap-1 text-[11px] cursor-pointer">
                                          <input type="checkbox" checked={selected.includes(opt)} onChange={() => toggle(opt)} className="w-3 h-3 rounded border-slate-300" />
                                          <span>{opt}</span>
                                        </label>
                                      ))}
                                    </div>
                                  );
                                })() : cellInputType === 'yesno' ? (
                                  <select
                                    value={(values[cellKey] as string) || ''}
                                    onChange={e => handleChange(cellKey, e.target.value)}
                                    className={`w-full border border-slate-200 rounded px-1.5 py-1 text-xs focus:outline-none focus:border-blue-300 ${refClass}`}
                                  >
                                    <option value="">Select...</option>
                                    <option value="Y">Y</option>
                                    <option value="N">N</option>
                                  </select>
                                ) : cellInputType === 'yna' ? (
                                  <select
                                    value={(values[cellKey] as string) || ''}
                                    onChange={e => handleChange(cellKey, e.target.value)}
                                    className={`w-full border border-slate-200 rounded px-1.5 py-1 text-xs focus:outline-none focus:border-blue-300 ${refClass}`}
                                  >
                                    <option value="">Select...</option>
                                    <option value="Y">Y</option>
                                    <option value="N">N</option>
                                    <option value="N/A">N/A</option>
                                  </select>
                                ) : cellInputType === 'number' || cellInputType === 'currency' ? (
                                  <input
                                    type="number"
                                    value={values[cellKey] === null || values[cellKey] === undefined || values[cellKey] === '' ? '' : Number(values[cellKey])}
                                    onChange={e => handleChange(cellKey, e.target.value === '' ? null : Number(e.target.value))}
                                    min={rowColCfg?.validationMin}
                                    max={rowColCfg?.validationMax}
                                    placeholder={cellPlaceholder}
                                    className={`w-full border border-slate-200 rounded px-1.5 py-1 text-xs focus:outline-none focus:border-blue-300 ${refClass}`}
                                  />
                                ) : cellInputType === 'date' ? (
                                  <input
                                    type="date"
                                    value={typeof values[cellKey] === 'string' ? (values[cellKey] as string).split('T')[0] : ''}
                                    onChange={e => handleChange(cellKey, e.target.value || null)}
                                    className={`w-full border border-slate-200 rounded px-1.5 py-1 text-xs focus:outline-none focus:border-blue-300 ${refClass}`}
                                  />
                                ) : cellInputType === 'checkbox' ? (
                                  <input
                                    type="checkbox"
                                    checked={values[cellKey] === true || values[cellKey] === 'true'}
                                    onChange={e => handleChange(cellKey, e.target.checked)}
                                    className="w-4 h-4 rounded border-slate-300"
                                  />
                                ) : cellInputType === 'formula' ? (
                                  // Computed cell — value is evaluated
                                  // in the useMemo above and rendered
                                  // read-only. Purple ring so the user
                                  // recognises it as a formula-driven
                                  // cell, not editable input.
                                  <div
                                    className={`w-full border border-purple-200 bg-purple-50 rounded px-1.5 py-1 text-xs text-purple-900 min-h-[28px] ${refClass}`}
                                    title={rowColCfg?.formulaExpression ? `= ${rowColCfg.formulaExpression}` : 'Computed'}
                                  >
                                    {(() => {
                                      const v = computedValues[cellKey] ?? values[cellKey];
                                      if (v === undefined || v === null || v === '') return <span className="text-purple-400 italic">—</span>;
                                      // Apply per-cell display format when configured —
                                      // takes precedence over the default 2dp number
                                      // rendering. Empty / unset format falls back to
                                      // the historic toLocaleString behaviour.
                                      const fmt = (rowColCfg as any)?.displayFormat as string | undefined;
                                      if (fmt) return String(formatDisplayValue(v, fmt));
                                      if (typeof v === 'number') return v.toLocaleString('en-GB', { maximumFractionDigits: 2 });
                                      return String(v);
                                    })()}
                                  </div>
                                ) : cellInputType === 'text' ? (
                                  <input
                                    type="text"
                                    value={(values[cellKey] as string) || ''}
                                    onChange={e => handleChange(cellKey, e.target.value)}
                                    placeholder={cellPlaceholder}
                                    className={`w-full border border-slate-200 rounded px-1.5 py-1 text-xs focus:outline-none focus:border-blue-300 ${refClass}`}
                                  />
                                ) : (
                                  <textarea
                                    value={(values[cellKey] as string) || ''}
                                    onChange={e => handleChange(cellKey, e.target.value)}
                                    rows={1}
                                    placeholder={cellPlaceholder}
                                    className={`w-full border border-slate-200 rounded px-1.5 py-1 text-xs focus:outline-none focus:border-blue-300 min-h-[28px] resize-y ${refClass}`}
                                  />
                                )}
                                {/* Per-cell merge-field hover badge —
                                    visible only to admins, only on row
                                    hover. Click copies the placeholder
                                    `{{questionnaires.<schedule>.<key>_col<N>}}`
                                    to the clipboard so it's a one-click
                                    paste into a document or email
                                    template. Sub-headers / bold rows
                                    are skipped (no input cell to
                                    annotate). */}
                                {isAdminViewer && !q.isBold && q.inputType !== 'subheader' && (
                                  <div className="absolute bottom-0.5 right-1 pointer-events-auto">
                                    <PlaceholderBadge path={cellPath} title={cellBadgeTitle} />
                                  </div>
                                )}
                                {/* Per-cell AI Polish button — same
                                    semantics as the row-level one but
                                    scoped to this single cell. Schedule
                                    Designer enables it via the per-cell
                                    config. Visible only when the cell's
                                    inputType is prose-style and the
                                    designer enabled it. */}
                                {(rowColCfg as any)?.aiPolishEnabled && (cellInputType === 'text' || cellInputType === 'textarea') && (
                                  <button
                                    type="button"
                                    onClick={() => void runAiPolish(cellKey, `${q.questionText} — ${tableHeaders[colN] || `Column ${colN}`}`)}
                                    disabled={polishingKey === cellKey}
                                    title="Rewrite this cell's answer in formal UK audit language. You can still edit afterwards."
                                    className="absolute top-0.5 right-0.5 inline-flex items-center gap-1 text-[9px] px-1 py-0.5 rounded bg-fuchsia-50 text-fuchsia-700 border border-fuchsia-200 hover:bg-fuchsia-100 disabled:opacity-60"
                                  >
                                    {polishingKey === cellKey ? '…' : '✨'}
                                  </button>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        }

        // Standard Q + PY + CY layout (original rendering below).
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
                // PY placeholder path — each questionnaire's asList
                // carries a `previousAnswer` per row, which is the
                // canonical template-side way to reach prior-year data
                // for that question. We surface the path on the PY cell
                // so admins can see how to reference it.
                const pyPlaceholderPath = `questionnaires.${questionnaireKey}.asList.[?].previousAnswer`;
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
                    {/* Prior year column — read-only if data exists, editable if not.
                        Admin-only PY hover chip at the bottom so the merge-field
                        path for referencing PY data from a document template is
                        discoverable from the cell itself. */}
                    <div className="w-[15%] flex-shrink-0 bg-slate-100 px-2 py-1.5 border-l border-slate-200 relative">
                      <div className="flex items-center h-full">
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
                      {isAdminViewer && (
                        <div className="absolute -bottom-0.5 right-1 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-auto">
                          <PlaceholderBadge
                            path={pyPlaceholderPath}
                            title={`Prior-year placeholder (admins only) — PY data is usually reached via the schedule's asList loop using previousAnswer. Click to copy.`}
                          />
                        </div>
                      )}
                    </div>
                    <div
                      className={`flex-1 px-2 py-1.5 ${outline} relative ${isQuestionReferenced(q) ? 'ring-2 ring-red-500 ring-offset-0 rounded' : ''}`}
                      title={isQuestionReferenced(q) ? referencedByTooltip(q) : undefined}
                    >
                      <FormField
                        questionId={q.id}
                        inputType={q.inputType}
                        value={values[q.id] ?? null}
                        onChange={v => handleChange(q.id, v)}
                        dropdownOptions={q.dropdownOptions}
                        // Computed value passed PRE-FORMATTED so display
                        // shows e.g. "0.343%" while computedValues stays
                        // raw for cross-references. Formatting only fires
                        // when q.displayFormat is set; otherwise the raw
                        // value passes through.
                        computedValue={
                          computedValues[q.id] !== undefined
                            ? (formatDisplayValue(computedValues[q.id], (q as any).displayFormat) as any)
                            : undefined
                        }
                        // Treat as formula (read-only, computed value shown)
                        // when any of:
                        //   - question type is 'formula'
                        //   - answer is an ad-hoc '= ...' expression
                        //   - question has a crossRef to another schedule
                        //     (the value is owned by the other schedule)
                        isFormula={
                          q.inputType === 'formula'
                          || (typeof values[q.id] === 'string' && (values[q.id] as string).trim().startsWith('='))
                          || Boolean((q as any).crossRef && (q as any).crossRef.trim())
                        }
                        validationMin={q.validationMin}
                        validationMax={q.validationMax}
                      />
                      {isAdminViewer && (
                        <div className="absolute -bottom-0.5 right-1 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-auto">
                          <PlaceholderBadge
                            path={placeholderPath}
                            title={`Current-year placeholder (admins only) — click to copy\n{{${placeholderPath}}}`}
                          />
                        </div>
                      )}
                      {/* AI Polish button — visible whenever the
                          schedule designer ticked the box for this
                          question. The auditor types in shorthand;
                          one click rewrites the text in formal UK
                          audit language. Auditor can edit
                          afterwards — this is one-shot, not binding. */}
                      {(q as any).aiPolishEnabled && (q.inputType === 'text' || q.inputType === 'textarea') && (
                        <button
                          type="button"
                          onClick={() => void runAiPolish(q.id, q.questionText || '')}
                          disabled={polishingKey === q.id}
                          title="Rewrite this answer in formal UK audit language. You can still edit afterwards."
                          className="absolute top-1 right-1 inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-fuchsia-50 text-fuchsia-700 border border-fuchsia-200 hover:bg-fuchsia-100 disabled:opacity-60"
                        >
                          {polishingKey === q.id ? '…' : '✨ Polish'}
                        </button>
                      )}
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
