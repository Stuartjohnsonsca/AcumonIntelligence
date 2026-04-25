/**
 * Builds the root context object that document templates are rendered
 * against. Shape matches the paths documented in
 * `lib/template-merge-fields.ts` — keep the two files in sync.
 *
 * One DB round-trip per engagement (via a single deep `include`) plus
 * three questionnaire lookups. Tolerant of missing data: every field
 * defaults to a sensible empty value so a half-populated engagement
 * still renders without blowing up.
 */

import { prisma } from '@/lib/db';
import { ERROR_SCHEDULE_SAFE_SELECT } from '@/lib/error-schedule-select';
import { slugifyQuestionText } from '@/lib/formula-engine';

/** A single RMM row rendered into template context — every useful
 *  field from AuditRMMRow. Templates can show a minimal view (just
 *  `name` + `fsLine`) or a detailed view (everything) depending on
 *  which columns they tick in the dynamic table modal. */
export interface AuditRisk {
  id: string;
  /** Display name for the risk — prefers the explicit risk description,
   *  falls back to the line item. Safe to use in prose. */
  name: string;
  /** The FS line the risk attaches to (for grouping tables). */
  fsLine: string;
  /** Risk description as typed in the RMM tab. Often multi-line. */
  description: string;
  /** Assertions the risk covers (e.g. "EO", "RO"). Joined with ", ". */
  assertions: string;
  relevance: string | null;
  complexityText: string | null;
  subjectivityText: string | null;
  changeText: string | null;
  uncertaintyText: string | null;
  susceptibilityText: string | null;
  /** Inherent risk level — Remote / Low / Medium / High / Very High. */
  inherentRiskLevel: string | null;
  /** Auditor-reviewed AI summary of the risk. */
  aiSummary: string | null;
  likelihood: string | null;
  magnitude: string | null;
  finalRiskAssessment: string | null;
  controlRisk: string | null;
  overallRisk: string | null;
  /** 'significant_risk' | 'area_of_focus' — drives the filtered views. */
  rowCategory: string | null;
  amount: number | null;
  notes: string | null;
  fsStatement: string | null;
  fsLevel: string | null;
  sortOrder: number;
}

export interface TemplateContext {
  currentDate: string;   // ISO yyyy-mm-dd
  currentYear: number;
  firm: { id: string; name: string; address: string | null };
  client: {
    id: string;
    name: string;
    companyNumber: string | null;
    registeredAddress: string | null;
    sector: string | null;
    contactName: string | null;
    contactEmail: string | null;
  };
  engagement: {
    id: string;
    clientName: string;
    auditType: string;
    framework: string | null;
    status: string;
    hardCloseDate: string | null;
    priorPeriodEnd: string | null;
  };
  period: {
    periodStart: string | null;
    periodEnd: string | null;
  };
  team: Array<{ name: string; role: string; email: string | null }>;
  ri: { name: string | null; email: string | null };
  reviewer: { name: string | null; email: string | null };
  preparer: { name: string | null; email: string | null };
  materiality: {
    overall: number | null;
    performance: number | null;
    clearlyTrivial: number | null;
    benchmark: string | null;
    benchmarkAmount: number | null;
    benchmarkPct: number | null;
    // Narrative fields captured on the Materiality tab's Justification
    // section. Also available via questionnaires.materiality.* but
    // surfaced here for convenience + discoverability in the AI
    // suggester. Each has a prior-period counterpart under .prior.
    basisChanged: boolean | null;
    basisChangeReason: string | null;
    stakeholders: string | null;
    stakeholderFocus: string | null;
    keyJudgements: string | null;
    /** Prior-period materiality figures — pulled from the prior
     *  engagement's materiality record, with any local overrides
     *  from `priorOverrides` on the current engagement applied on
     *  top. Null-valued when there is no prior engagement yet. */
    prior: {
      overall: number | null;
      performance: number | null;
      clearlyTrivial: number | null;
      benchmark: string | null;
      benchmarkPct: number | null;
      basisChanged: boolean | null;
      basisChangeReason: string | null;
      stakeholders: string | null;
      stakeholderFocus: string | null;
      keyJudgements: string | null;
    };
  };
  errorSchedule: Array<{
    id: string;
    fsLine: string;
    accountCode: string | null;
    description: string;
    amount: number;
    errorType: string;
    explanation: string | null;
    resolution: string | null;
    isFraud: boolean;
  }>;
  errorScheduleTotals: {
    adjusted: number;
    unadjusted: number;
    count: number;
  };
  testConclusions: Array<{
    fsLine: string;
    testDescription: string;
    conclusion: string | null;
    totalErrors: number;
    extrapolatedError: number;
    auditorNotes: string | null;
    reviewedByName: string | null;
    riSignedByName: string | null;
  }>;
  auditPlan: {
    /** All RMM rows flagged as either a significant risk or an area
     *  of focus — each row exposes the FULL underlying assessment so
     *  document templates can pick which columns to render. */
    risks: AuditRisk[];
    /** Filtered view: only significant risks. */
    significantRisks: AuditRisk[];
    /** Filtered view: only areas of focus. */
    areasOfFocus: AuditRisk[];
  };
  /** Agreed dates from the Opening Tab's Audit Timetable section —
   *  Planning / Fieldwork / Completion etc. Use in document templates
   *  with a dynamic table to render the firm's agreed schedule. */
  auditTimetable: Array<{
    milestone: string;       // the row's description (Planning / Fieldwork / …)
    targetDate: string | null;   // ISO yyyy-mm-dd
    revisedTarget: string | null;
    progress: string | null;     // Not Started / In Progress / Complete / Overdue
    sortOrder: number;
  }>;
  questionnaires: {
    // Core four are always present (even if empty) so legacy
    // templates keep resolving `questionnaires.ethics.x` paths.
    permanentFile: Record<string, any>;
    ethics: Record<string, any>;
    continuance: Record<string, any>;
    materiality: Record<string, any>;
    // Any additional `*_questions` schemas the firm has defined are
    // exposed under their camelCase type key (e.g. newClientTakeOn,
    // subsequentEvents, auditSummaryMemo). The schema catalog is
    // open-ended, hence the index signature.
    [extraType: string]: Record<string, any>;
  };
  /** Full mirror of the context, built for the prior engagement if
   *  one is linked. Null on first-year engagements. Every current-
   *  period path has a sibling under `priorPeriod.*`. */
  priorPeriod?: TemplateContext | null;
  tb: {
    rows: Array<{
      fsStatement: string | null;
      fsLevel: string | null;
      fsLine: string | null;
      accountCode: string;
      description: string;
      currentYear: number;
      priorYear: number;
    }>;
    revenue: number;
    costOfSales: number;
    grossProfit: number;
    grossMarginPct: number | null;
    profitBeforeTax: number;
    totalAssets: number;
    totalEquity: number;
  };
}

function iso(d: Date | null | undefined): string | null {
  if (!d) return null;
  try { return d.toISOString().slice(0, 10); } catch { return null; }
}

function num(v: unknown): number { const n = Number(v); return Number.isFinite(n) ? n : 0; }

/**
 * Load and aggregate every data source a document template might want
 * to reference for one engagement. Non-critical tables (questionnaires,
 * materiality) are loaded with `catch` fallbacks so a missing record
 * doesn't prevent the whole render.
 */
/**
 * Build the full render context for an engagement.
 *
 * Options:
 *   - `includePriorPeriod` (default `true` at the top-level call) —
 *     when true AND the engagement has a prior period linked, recursively
 *     builds the prior engagement's context and attaches it under
 *     `priorPeriod` on the result. Set to false for the recursive call
 *     itself so we only ever load TWO engagements (current + prior),
 *     never a chain.
 */
export async function buildTemplateContext(engagementId: string, opts: { includePriorPeriod?: boolean } = {}): Promise<TemplateContext> {
  const includePriorPeriod = opts.includePriorPeriod !== false;
  const engagement = await prisma.auditEngagement.findUnique({
    where: { id: engagementId },
    include: {
      firm: { select: { id: true, name: true } },
      client: true,
      period: true,
      priorPeriodEngagement: { include: { period: true } },
      teamMembers: { include: { user: { select: { name: true, email: true } } } },
    },
  });
  if (!engagement) throw new Error(`Engagement ${engagementId} not found`);

  // Team + convenience shortcuts.
  const team = engagement.teamMembers.map(m => ({
    name: m.user?.name || '',
    role: m.role,
    email: m.user?.email || null,
  }));
  const ri = team.find(t => t.role === 'RI') || team.find(t => t.role === 'Partner') || null;
  const reviewer = team.find(t => t.role === 'Manager') || team.find(t => t.role === 'Reviewer') || null;
  const preparer = team.find(t => t.role === 'Junior') || team.find(t => t.role === 'Preparer') || null;

  // Materiality — the primary data JSON holds Appendix-E-style values.
  // We ALSO resolve the prior-period figures here, coming from two
  // sources merged in precedence order:
  //   1. data.priorOverrides — the auditor's local overrides, typed
  //      directly on the Materiality tab. These take precedence.
  //   2. The prior engagement's own materiality record, looked up by
  //      (clientId, auditType, earlier period). Non-destructive —
  //      the prior engagement is never written to.
  let currentMaterialityData: any = null;
  let priorMaterialityData: any = null;
  let priorOverrides: Record<string, any> = {};
  try {
    const mat = await prisma.auditMateriality.findUnique({ where: { engagementId } }) as any;
    currentMaterialityData = mat?.data ?? null;
    if (currentMaterialityData?.priorOverrides && typeof currentMaterialityData.priorOverrides === 'object') {
      priorOverrides = currentMaterialityData.priorOverrides;
    }
  } catch { /* tolerant */ }
  try {
    if (engagement.priorPeriodEngagement?.id) {
      const priorMat = await prisma.auditMateriality.findUnique({ where: { engagementId: engagement.priorPeriodEngagement.id } }) as any;
      priorMaterialityData = priorMat?.data ?? null;
    }
  } catch { /* tolerant — first-year engagements have no prior */ }

  /** Read a key from priorOverrides first, then from the prior
   *  engagement's materiality data. Same precedence the Materiality
   *  tab's `getPy` helper uses. */
  function pickPrior<T = any>(key: string): T | null {
    const o = priorOverrides?.[key];
    if (o !== undefined && o !== null && o !== '') return o as T;
    const p = priorMaterialityData?.[key];
    if (p !== undefined && p !== null && p !== '') return p as T;
    return null;
  }

  const currentD = currentMaterialityData || {};
  /** Read a current-period key, tolerating empty strings. */
  function pickCurrent<T = any>(key: string): T | null {
    const v = currentD?.[key];
    if (v === undefined || v === null || v === '') return null;
    return v as T;
  }
  const materiality: TemplateContext['materiality'] = {
    overall: currentD.overallMateriality ?? currentD.materiality ?? null,
    performance: currentD.performanceMateriality ?? null,
    clearlyTrivial: currentD.clearlyTrivial ?? null,
    benchmark: currentD.benchmark ?? currentD.materiality_benchmark ?? null,
    benchmarkAmount: currentD.benchmarkAmount ?? null,
    benchmarkPct: currentD.benchmarkPct ?? currentD.benchmark_pct ?? null,
    // Narrative fields — the Materiality tab saves these under the
    // snake_case keys (basis_changed, key_judgements, etc.) directly
    // on the materiality data JSON.
    basisChanged: (pickCurrent<boolean>('basis_changed') as boolean | null) ?? null,
    basisChangeReason: pickCurrent<string>('basis_change_reason') ?? null,
    stakeholders: pickCurrent<string>('stakeholders') ?? null,
    stakeholderFocus: pickCurrent<string>('stakeholder_focus') ?? null,
    keyJudgements: pickCurrent<string>('key_judgements') ?? null,
    prior: {
      // The Materiality tab stores prior figures under these snake_case
      // keys (materiality_manual, performance_materiality_manual, etc.)
      // in both the prior engagement's data and in priorOverrides.
      overall: (pickPrior<number>('materiality_manual') ?? pickPrior<number>('overallMateriality') ?? null),
      performance: (pickPrior<number>('performance_materiality_manual') ?? pickPrior<number>('performanceMateriality') ?? null),
      clearlyTrivial: (pickPrior<number>('clearly_trivial_manual') ?? pickPrior<number>('clearlyTrivial') ?? null),
      benchmark: pickPrior<string>('materiality_benchmark') ?? pickPrior<string>('benchmark') ?? null,
      benchmarkPct: pickPrior<number>('benchmark_pct') ?? null,
      basisChanged: (pickPrior<boolean>('basis_changed') as boolean | null) ?? null,
      basisChangeReason: pickPrior<string>('basis_change_reason') ?? null,
      stakeholders: pickPrior<string>('stakeholders') ?? null,
      stakeholderFocus: pickPrior<string>('stakeholder_focus') ?? null,
      keyJudgements: pickPrior<string>('key_judgements') ?? null,
    },
  };

  // Error schedule. Using an explicit select because production Supabase
  // may be missing the `linked_from_type` / `linked_from_id` columns that
  // the Prisma schema declares — unbounded findMany would 500. The
  // try/catch is a belt-and-braces fallback: if some OTHER column has
  // drifted, we still render the Planning Letter with an empty error
  // schedule rather than failing the whole download. Remove once
  // scripts/sql/raise-as-linked-from.sql is applied.
  type ErrorRow = {
    id: string; fsLine: string; accountCode: string | null; description: string;
    errorAmount: number; errorType: string; explanation: string | null;
    resolution: string | null; isFraud: boolean;
  };
  let errorRows: ErrorRow[] = [];
  try {
    errorRows = await prisma.auditErrorSchedule.findMany({
      where: { engagementId },
      select: ERROR_SCHEDULE_SAFE_SELECT,
    }) as unknown as ErrorRow[];
  } catch (err: any) {
    console.error('[template-context] auditErrorSchedule.findMany failed — continuing with empty error schedule:', err?.message || err);
    errorRows = [];
  }
  const errorSchedule = errorRows.map(e => ({
    id: e.id,
    fsLine: e.fsLine,
    accountCode: e.accountCode,
    description: e.description,
    amount: num(e.errorAmount),
    errorType: e.errorType,
    explanation: e.explanation,
    resolution: e.resolution,
    isFraud: e.isFraud,
  }));
  const errorScheduleTotals = {
    adjusted: errorSchedule.filter(e => e.resolution === 'error').reduce((s, e) => s + e.amount, 0),
    unadjusted: errorSchedule.filter(e => !e.resolution).reduce((s, e) => s + e.amount, 0),
    count: errorSchedule.length,
  };

  // Audit Timetable — the agreed dates from the Opening Tab. Exposed
  // under `auditTimetable` as an array so templates can render them
  // through a dynamic table (one row per milestone). Ordered by the
  // sortOrder the admin chose on the Opening tab.
  let auditTimetable: TemplateContext['auditTimetable'] = [];
  try {
    const agreedDates = await prisma.auditAgreedDate.findMany({
      where: { engagementId },
      orderBy: { sortOrder: 'asc' },
    });
    auditTimetable = agreedDates.map(d => ({
      milestone: d.description || '',
      targetDate: iso(d.targetDate),
      revisedTarget: iso(d.revisedTarget),
      progress: d.progress ?? null,
      sortOrder: d.sortOrder ?? 0,
    }));
  } catch { /* tolerant — missing table / legacy env */ }

  // Test conclusions.
  const concRows = await prisma.auditTestConclusion.findMany({ where: { engagementId } });
  const testConclusions = concRows.map(c => ({
    fsLine: c.fsLine,
    testDescription: c.testDescription,
    conclusion: c.conclusion,
    totalErrors: num(c.totalErrors),
    extrapolatedError: num(c.extrapolatedError),
    auditorNotes: c.auditorNotes,
    reviewedByName: c.reviewedByName,
    riSignedByName: c.riSignedByName,
  }));

  // ── Audit plan: risks + areas of focus ───────────────────────────
  // Derived from the RMM table. Previously this filtered on
  // `isSignificantRisk` / `category === 'Significant Risk'` — neither
  // of which exist on AuditRMMRow. The actual column is `rowCategory`
  // with the literal values 'significant_risk' and 'area_of_focus'
  // (set via the Sig.Risk column in the RMM tab). That bug meant the
  // Planning Letter's risk sections rendered empty no matter what.
  //
  // Now: load ALL tagged rows, expose the FULL RMM field set on each
  // one, and provide three views:
  //   auditPlan.risks             — all significant + area-of-focus rows
  //   auditPlan.significantRisks  — rowCategory === 'significant_risk'
  //   auditPlan.areasOfFocus      — rowCategory === 'area_of_focus'
  // Templates can use the simple views for a single-column list, or
  // `risks` for a mixed table that filters/groups by rowCategory
  // through the dynamic-table modal's filter UI.
  let risks: AuditRisk[] = [];
  let significantRisks: AuditRisk[] = [];
  let areasOfFocus: AuditRisk[] = [];
  try {
    const rmm = await (prisma as any).auditRMMRow?.findMany?.({
      where: {
        engagementId,
        rowCategory: { in: ['significant_risk', 'area_of_focus'] },
      },
      orderBy: [{ sortOrder: 'asc' }, { lineItem: 'asc' }],
    }) ?? [];
    risks = rmm.map((r: any): AuditRisk => ({
      id: String(r.id || ''),
      name: (r.riskIdentified && String(r.riskIdentified).trim())
        || (r.aiSummary && String(r.aiSummary).trim())
        || (r.lineItem && String(r.lineItem).trim())
        || 'Risk',
      fsLine: String(r.lineItem || r.fsLine || ''),
      description: String(r.riskIdentified || ''),
      assertions: Array.isArray(r.assertions) ? r.assertions.join(', ') : String(r.assertions || ''),
      relevance: r.relevance ?? null,
      complexityText: r.complexityText ?? null,
      subjectivityText: r.subjectivityText ?? null,
      changeText: r.changeText ?? null,
      uncertaintyText: r.uncertaintyText ?? null,
      susceptibilityText: r.susceptibilityText ?? null,
      inherentRiskLevel: r.inherentRiskLevel ?? null,
      aiSummary: r.aiSummary ?? null,
      likelihood: r.likelihood ?? null,
      magnitude: r.magnitude ?? null,
      finalRiskAssessment: r.finalRiskAssessment ?? null,
      controlRisk: r.controlRisk ?? null,
      overallRisk: r.overallRisk ?? null,
      rowCategory: r.rowCategory ?? null,
      amount: typeof r.amount === 'number' ? r.amount : (r.amount ? Number(r.amount) : null),
      notes: r.notes ?? null,
      fsStatement: r.fsStatement ?? null,
      fsLevel: r.fsLevel ?? null,
      sortOrder: Number(r.sortOrder) || 0,
    }));
    significantRisks = risks.filter(r => r.rowCategory === 'significant_risk');
    areasOfFocus = risks.filter(r => r.rowCategory === 'area_of_focus');
  } catch { /* model may not be wired on this env — tolerant */ }

  // Questionnaires are stored as `{ data: { <uuid>: value, ... } }`
  // where the UUID is the `id` of the question in the firm's
  // MethodologyTemplate (one per questionnaire type). UUIDs are
  // impossible to use directly in Handlebars templates, so we enrich
  // the context: expose each answer under BOTH the original UUID
  // (for back-compat) AND the human-readable `key` declared in the
  // questionnaire schema, plus a `bySection` grouping keyed by
  // slugified section name.
  //
  // Example — a Continuance answer for "Engagement letter date" can
  // now be addressed as:
  //   {{formatDate questionnaires.continuance.engagement_letter_date "dd MMMM yyyy"}}
  //   {{formatDate questionnaires.continuance.bySection.continuity.engagement_letter_date "dd MMMM yyyy"}}
  //   {{formatDate questionnaires.continuance.<uuid> "dd MMMM yyyy"}}  ← still works
  async function loadQ(table: string): Promise<Record<string, any>> {
    try {
      const model = (prisma as any)[table];
      if (!model) return {};

      // AuditPermanentFile is the odd-one-out: data is split across
      // multiple rows keyed on (engagementId, sectionKey) — one row
      // per section, plus meta rows ('__signoffs', '__fieldmeta').
      // findUnique({ where: { engagementId } }) fails because engagementId
      // alone isn't unique on this model. Load all section rows and
      // merge their `data` objects into a single flat answer map, which
      // is the shape enrichQuestionnaire expects ({ <uuid>: value }).
      if (table === 'auditPermanentFile') {
        if (typeof model.findMany !== 'function') return {};
        const rows = await model.findMany({ where: { engagementId } });
        const merged: Record<string, any> = {};
        for (const r of rows) {
          const sk = r?.sectionKey as string | undefined;
          if (sk === '__signoffs' || sk === '__fieldmeta') continue;
          if (!r?.data || typeof r.data !== 'object') continue;
          Object.assign(merged, r.data as Record<string, any>);
        }
        return merged;
      }

      if (typeof model.findUnique !== 'function') return {};
      const row = await model.findUnique({ where: { engagementId } });
      return (row?.data && typeof row.data === 'object') ? row.data as Record<string, any> : {};
    } catch { return {}; }
  }

  // Load the firm's questionnaire schemas dynamically — any
  // MethodologyTemplate row whose `templateType` ends in `_questions`
  // is a questionnaire. Firms can add new ones (new client take-on,
  // subsequent events, audit summary memo, etc.) without code changes.
  const qSchemas = await prisma.methodologyTemplate.findMany({
    where: {
      firmId: engagement.firm.id,
      templateType: { endsWith: '_questions' },
    },
  });
  const schemaByType = new Map<string, any[]>();
  // Per-templateType sectionMeta — keyed first by templateType, then
  // by the literal sectionKey. Carries each section's columnHeaders so
  // enrichQuestionnaire can emit header-slug aliases on each asList
  // row (e.g. {{threat}} / {{safeguard}} alongside {{col1}} / {{col2}}).
  // Templates with the legacy flat-array shape have no sectionMeta and
  // therefore no slug aliases — they keep working through col<N>.
  const sectionMetaByType = new Map<string, Record<string, any>>();
  for (const s of qSchemas) {
    if (Array.isArray(s.items)) {
      schemaByType.set(s.templateType, s.items as any[]);
      sectionMetaByType.set(s.templateType, {});
    } else if (s.items && typeof s.items === 'object') {
      const items = s.items as any;
      const questions = Array.isArray(items.questions) ? items.questions
        : Array.isArray(items) ? items : [];
      schemaByType.set(s.templateType, questions);
      sectionMetaByType.set(s.templateType, (items.sectionMeta && typeof items.sectionMeta === 'object') ? items.sectionMeta : {});
    } else {
      schemaByType.set(s.templateType, []);
      sectionMetaByType.set(s.templateType, {});
    }
  }

  /** Map a `*_questions` templateType to both its Prisma model name
   *  (to load answers) and the camelCase key used in the context
   *  (`questionnaires.<key>`). Known canonical mappings take priority;
   *  anything else is derived by stripping `_questions` and
   *  camelCasing. Missing Prisma tables are tolerated — the schema
   *  (questions + keys) is still surfaced even if there are no
   *  stored answers yet. */
  function prismaAndCtxKeysFor(templateType: string): { prismaModel: string; ctxKey: string } {
    const canonical: Record<string, { prismaModel: string; ctxKey: string }> = {
      permanent_file_questions:    { prismaModel: 'auditPermanentFile',    ctxKey: 'permanentFile' },
      ethics_questions:            { prismaModel: 'auditEthics',           ctxKey: 'ethics' },
      continuance_questions:       { prismaModel: 'auditContinuance',      ctxKey: 'continuance' },
      materiality_questions:       { prismaModel: 'auditMateriality',      ctxKey: 'materiality' },
      new_client_takeon_questions: { prismaModel: 'auditNewClientTakeOn',  ctxKey: 'newClientTakeOn' },
      subsequent_events_questions: { prismaModel: 'auditSubsequentEvents', ctxKey: 'subsequentEvents' },
    };
    if (canonical[templateType]) return canonical[templateType];
    const stem = templateType.replace(/_questions$/, '');
    const ctxKey = stem.replace(/_([a-z0-9])/g, (_, ch) => ch.toUpperCase());
    const prismaModel = 'audit' + ctxKey.charAt(0).toUpperCase() + ctxKey.slice(1);
    return { prismaModel, ctxKey };
  }

  // Load answers for every discovered questionnaire type in parallel.
  // Types without a matching Prisma table return {} (tolerant).
  const questionnaireTypes = Array.from(schemaByType.keys());
  const loadedAnswers = await Promise.all(questionnaireTypes.map(async (tt) => {
    const { prismaModel, ctxKey } = prismaAndCtxKeysFor(tt);
    const raw = await loadQ(prismaModel);
    return { templateType: tt, ctxKey, raw };
  }));
  // Always ensure the core 4 keys exist on the context object (even
  // if the firm hasn't defined their schema) so older templates keep
  // resolving `questionnaires.ethics.x` style paths safely.
  const coreKeys = ['permanentFile', 'ethics', 'continuance', 'materiality'];
  const answersByCtxKey = new Map<string, Record<string, any>>();
  for (const { ctxKey, raw } of loadedAnswers) answersByCtxKey.set(ctxKey, raw);
  for (const core of coreKeys) if (!answersByCtxKey.has(core)) answersByCtxKey.set(core, {});

  /**
   * Slug a free-text section name into something Handlebars-safe
   * (lowercase, `_` separators, no punctuation).
   */
  function slugify(s: string): string {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'section';
  }

  /**
   * Enrich a raw UUID-keyed answer map with human-readable keys from
   * the corresponding questionnaire schema. Preserves the original
   * UUID keys so older templates still work.
   *
   * Also emits an `asList` array — one entry per answered question —
   * so templates can render a whole questionnaire as a dynamic
   * table via `{{#each questionnaires.<type>.asList}}`. Each entry
   * has `{ question, key, answer, section, sortOrder }` so the
   * template can choose which fields become columns.
   */
  function enrichQuestionnaire(raw: Record<string, any>, schemaTemplateType: string): Record<string, any> {
    const schema = schemaByType.get(schemaTemplateType) || [];
    const sectionMeta = sectionMetaByType.get(schemaTemplateType) || {};
    const out: Record<string, any> = { ...raw };
    const bySection: Record<string, Record<string, any>> = {};

    /**
     * For a given section, return a Map<colKey, slug[]> — e.g. for the
     * Ethics "Non Audit Services" section with columnHeaders
     * ["Item", "Threat", "Threat Description", "Safeguard"], emit:
     *   col1 → ["threat"]
     *   col2 → ["threat_description"]
     *   col3 → ["safeguard"]
     * (col0 is the question-text column, no storage column to alias.)
     *
     * Returns an empty Map when the section has no metadata or no
     * column headers — older templates without sectionMeta keep
     * working through the existing col<N> aliases unchanged.
     */
    function headerSlugsForSection(sectionKeyRaw: string | null | undefined): Map<string, string[]> {
      const out = new Map<string, string[]>();
      if (!sectionKeyRaw) return out;
      // sectionMeta may be keyed by the literal sectionKey OR by the
      // slugified form — try both for tolerance to historical data.
      const meta = sectionMeta[sectionKeyRaw] || sectionMeta[slugify(sectionKeyRaw)];
      const headers = Array.isArray(meta?.columnHeaders) ? meta.columnHeaders : null;
      if (!headers || headers.length < 2) return out;
      const seen = new Map<string, number>();
      for (let i = 1; i < headers.length; i++) {
        const slug = slugify(String(headers[i] || ''));
        if (!slug || slug === 'section') continue;
        // Same header text used twice in the same section → suffix the
        // duplicate so only the first wins the bare slug, the second
        // becomes <slug>_2 etc. Avoids silent overwrites.
        const count = (seen.get(slug) || 0) + 1;
        seen.set(slug, count);
        const finalSlug = count === 1 ? slug : `${slug}_${count}`;
        const colKey = `col${i}`;
        if (!out.has(colKey)) out.set(colKey, []);
        out.get(colKey)!.push(finalSlug);
      }
      return out;
    }
    interface ListItem {
      question: string; key: string; answer: any;
      section: string | null; sortOrder: number;
      // Multi-column layout extras — spread in per-question when the
      // section uses table_3col / 4col / 5col layout. Templates can
      // reference {{col1}}, {{col2}} etc. inside {{#each asList}}.
      [colN: `col${number}`]: any;
      // Derived fields populated in the post-pass below. They let
      // dynamic-table filters express "include the explanation only
      // when the preceding Y/N question was Y" and similar chained
      // conditions without any schema-level wiring. "Next" fields are
      // the mirror image — they let a row pull its successor's
      // question/answer into a column (e.g. iterate Y/N questions and
      // put the follow-up explanation in a neighbouring cell).
      //
      // `itemIndex` is the 0-based position in the sorted list, so a
      // template can reach any other row via {{../asList.[N].answer}}
      // when the trigger question and detail question aren't adjacent.
      previousKey?: string | null;
      previousQuestion?: string | null;
      previousAnswer?: any;
      nextKey?: string | null;
      nextQuestion?: string | null;
      nextAnswer?: any;
      itemIndex?: number;
      isEmpty?: boolean;
    }
    const asList: ListItem[] = [];
    for (const item of schema) {
      if (!item?.id) continue;
      // Resolve the human-readable key. Seeded questions set an explicit
      // `.key` (e.g. 'entity_address'); questions added via the admin
      // template editor currently DON'T — so fall back to a slug of the
      // question text, then to the UUID id. Without this fallback every
      // admin-added question was silently dropped from the template
      // context, leaving {{questionnaires.*.*}} placeholders blank.
      const keyResolved = typeof item.key === 'string' && item.key.trim()
        ? item.key
        : (slugifyQuestionText(item.questionText) || String(item.id));
      const value = raw[item.id];
      out[item.key || keyResolved] = value ?? null;
      // If the resolved key differs from what was saved on item.key,
      // expose under BOTH so templates work against either form.
      if (keyResolved !== item.key) out[keyResolved] = value ?? null;
      if (item.sectionKey) {
        const sec = slugify(item.sectionKey);
        if (!bySection[sec]) bySection[sec] = {};
        bySection[sec][keyResolved] = value ?? null;
      }

      // Multi-column layout: when a section's layout is table_3col /
      // 4col / 5col, DynamicAppendixForm stores each extra column under
      // `<questionId>_col<N>` in the same values map. Expose those
      // values alongside the primary answer so document templates can
      // address them directly:
      //   {{questionnaires.materiality.revenue_col1}}  ← planning amount
      //   {{questionnaires.materiality.revenue_col2}}  ← final amount
      // Also attached to the asList item as `col1` / `col2` / ... so
      // {{#each asList}} loops can render an N-column table cleanly.
      const colValues: Record<string, any> = {};
      // Header-slug aliases keyed by colN — populated below from
      // section column headers so {{threat}}, {{threat_description}},
      // {{safeguard}} resolve to the underlying col1/col2/col3 cell
      // values inside the asList loop. Computed once per question
      // because all rows in a section share the same headers.
      const slugMap = headerSlugsForSection(item.sectionKey);
      // Header-slug values to spread on the asList item — keyed by
      // header slug, valued by the cell value at the matching col<N>.
      const slugValues: Record<string, any> = {};
      for (const [rk, rv] of Object.entries(raw)) {
        if (!rk.startsWith(`${item.id}_col`)) continue;
        const n = Number(rk.slice(`${item.id}_col`.length));
        if (!Number.isFinite(n) || n < 1) continue;
        const colKey = `col${n}`;
        colValues[colKey] = rv;
        // Flat aliases: keyResolved_col1 etc. for direct placeholder use.
        out[`${keyResolved}_${colKey}`] = rv;
        if (item.key && keyResolved !== item.key) out[`${item.key}_${colKey}`] = rv;
        if (item.sectionKey) {
          const sec = slugify(item.sectionKey);
          if (!bySection[sec]) bySection[sec] = {};
          bySection[sec][`${keyResolved}_${colKey}`] = rv;
        }
        // Header-slug aliases for THIS column. A column may carry one
        // (or rarely several) slugs depending on whether the section's
        // header text was unique. They live alongside col1/col2/col3
        // on the asList row.
        const slugs = slugMap.get(colKey);
        if (slugs && slugs.length > 0) {
          for (const slug of slugs) slugValues[slug] = rv;
        }
      }

      // Every question — answered or not — goes into asList so
      // templates that iterate ({{#each …asList}}) see the full shape
      // of the questionnaire, not just the rows the auditor has
      // happened to fill in. `isEmpty` lets templates filter if they
      // want to.
      asList.push({
        question: String(item.questionText ?? item.label ?? keyResolved),
        key: keyResolved,
        answer: value ?? null,
        section: item.sectionKey ? String(item.sectionKey) : null,
        sortOrder: Number(item.sortOrder) || 0,
        ...colValues,   // col1, col2, col3 ... spread alongside 'answer'
        ...slugValues,  // header-slug aliases (e.g. threat / safeguard)
      });
    }
    asList.sort((a, b) => (a.sortOrder - b.sortOrder) || a.question.localeCompare(b.question));
    // Post-pass: attach previous/next neighbour fields + isEmpty to
    // each entry now that the sort is stable. "Previous" and "next"
    // are the immediately adjacent items by sortOrder across the
    // whole questionnaire — first item's previous* are null and the
    // last item's next* are null so filters can target those edges.
    for (let i = 0; i < asList.length; i++) {
      const prev = i > 0 ? asList[i - 1] : null;
      const next = i < asList.length - 1 ? asList[i + 1] : null;
      asList[i].itemIndex = i;
      asList[i].previousKey = prev?.key ?? null;
      asList[i].previousQuestion = prev?.question ?? null;
      asList[i].previousAnswer = prev?.answer ?? null;
      asList[i].nextKey = next?.key ?? null;
      asList[i].nextQuestion = next?.question ?? null;
      asList[i].nextAnswer = next?.answer ?? null;
      const v = asList[i].answer;
      asList[i].isEmpty = v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
    }
    if (Object.keys(bySection).length > 0) out.bySection = bySection;
    out.asList = asList;
    return out;
  }

  // Enrich every loaded questionnaire using its own schema. The
  // `questionnaires` object ends up with one key per discovered type
  // (core four always present; additional types exposed by camelCase
  // name). Also keeps back-compat shortcuts for pfData / ethicsData /
  // continuanceData / matData, used by `engagement.framework` below.
  const questionnairesOut: Record<string, Record<string, any>> = {};
  for (const core of coreKeys) questionnairesOut[core] = {}; // ensure present
  // Look up templateType by ctxKey so we can pass the right schema.
  const ttByCtxKey = new Map<string, string>();
  for (const tt of questionnaireTypes) {
    const { ctxKey } = prismaAndCtxKeysFor(tt);
    ttByCtxKey.set(ctxKey, tt);
  }
  for (const [ctxKey, raw] of answersByCtxKey.entries()) {
    const tt = ttByCtxKey.get(ctxKey) || '';
    questionnairesOut[ctxKey] = enrichQuestionnaire(raw, tt);
  }
  const pfData = questionnairesOut.permanentFile;
  const ethicsData = questionnairesOut.ethics;
  const continuanceData = questionnairesOut.continuance;
  const matData = questionnairesOut.materiality;

  // Trial balance — rows + some precomputed totals so the admin can
  // address {{tb.revenue}} etc. without a dedicated helper. We pull
  // the canonical FS line name via `canonicalFsLine` (the FK model
  // relation) because AuditTBRow doesn't carry a denormalised fsLine
  // string column.
  const tbRows = await prisma.auditTBRow.findMany({
    where: { engagementId },
    include: { canonicalFsLine: { select: { name: true } } },
  });
  let revenue = 0, costOfSales = 0, profitBeforeTax = 0, totalAssets = 0, totalEquity = 0;
  for (const r of tbRows) {
    const cy = num(r.currentYear);
    const fsLineName = (r.canonicalFsLine?.name || '').toLowerCase();
    const fsLevel = (r.fsLevel || '').toLowerCase();
    if (/revenue|sales|turnover/.test(fsLevel) || /revenue|sales|turnover/.test(fsLineName)) revenue += Math.abs(cy);
    if (/cost.*sales|cost.*goods|cogs/.test(fsLevel)) costOfSales += Math.abs(cy);
    if (/assets?$/.test(fsLevel) || /total assets/.test(fsLineName)) totalAssets += Math.abs(cy);
    if (/equity|capital|reserves/.test(fsLevel)) totalEquity += Math.abs(cy);
    if (/profit before tax|pbt/.test(fsLineName)) profitBeforeTax += cy;
  }
  const grossProfit = revenue - costOfSales;
  const grossMarginPct = revenue > 0 ? Math.round((grossProfit / revenue) * 1000) / 10 : null;

  const ctx: TemplateContext = {
    currentDate: new Date().toISOString().slice(0, 10),
    currentYear: new Date().getFullYear(),
    firm: {
      id: engagement.firm.id,
      name: engagement.firm.name,
      address: (engagement as any).firm?.address ?? null,
    },
    client: {
      id: engagement.client.id,
      name: engagement.client.clientName,
      companyNumber: (engagement.client as any).companyNumber ?? null,
      // ARCHITECTURAL PRINCIPLE: document-template data comes ONLY from
      // the audit file (the engagement's own schedules), not from
      // MyAccount / CRM / firm-wide records. The engagement is the
      // single source of truth for what goes into a generated document.
      // registeredAddress therefore reads the Permanent File's Entity
      // Address Block (tolerant of the common slug variants firms use).
      registeredAddress:
        (pfData as any)?.entity_address
        ?? (pfData as any)?.entity_address_block
        ?? (pfData as any)?.registered_address
        ?? (pfData as any)?.address
        ?? null,
      sector: engagement.client.sector,
      contactName: [engagement.client.contactFirstName, engagement.client.contactSurname].filter(Boolean).join(' ') || null,
      contactEmail: engagement.client.contactEmail,
    },
    engagement: {
      id: engagement.id,
      clientName: engagement.client.clientName,
      auditType: engagement.auditType,
      framework: (ethicsData as any)?.framework ?? (pfData as any)?.framework ?? null,
      status: engagement.status,
      hardCloseDate: iso(engagement.hardCloseDate),
      priorPeriodEnd: iso(engagement.priorPeriodEngagement?.period?.endDate ?? null),
    },
    period: {
      periodStart: iso(engagement.period.startDate),
      periodEnd: iso(engagement.period.endDate),
    },
    team,
    ri: { name: ri?.name ?? null, email: ri?.email ?? null },
    reviewer: { name: reviewer?.name ?? null, email: reviewer?.email ?? null },
    preparer: { name: preparer?.name ?? null, email: preparer?.email ?? null },
    materiality,
    errorSchedule,
    errorScheduleTotals,
    testConclusions,
    auditPlan: { risks, significantRisks, areasOfFocus },
    auditTimetable,
    // Spread every discovered questionnaire under its camelCase key.
    // Casting through `as any` because the index signature doesn't
    // narrow well alongside the four named core properties in the
    // TypeScript interface — at runtime it's just an object with
    // one key per questionnaire type.
    questionnaires: { ...questionnairesOut } as any,
    tb: {
      rows: tbRows.map(r => ({
        fsStatement: r.fsStatement,
        fsLevel: r.fsLevel,
        fsLine: r.canonicalFsLine?.name ?? null,
        accountCode: r.accountCode,
        description: r.description,
        currentYear: num(r.currentYear),
        priorYear: num(r.priorYear),
      })),
      revenue, costOfSales, grossProfit, grossMarginPct, profitBeforeTax,
      totalAssets, totalEquity,
    },
  };

  // ── Prior-period mirror ─────────────────────────────────────────────
  // If the engagement has a prior period linked, recursively build its
  // full context and attach under `priorPeriod`. This gives every
  // current-period path a sibling under priorPeriod.*:
  //    {{materiality.overall}}              → current
  //    {{priorPeriod.materiality.overall}}  → prior
  //    {{#each errorSchedule}}…{{/each}}    → current
  //    {{#each priorPeriod.errorSchedule}}  → prior
  // The recursive call passes includePriorPeriod=false so we never
  // walk more than one period back.
  if (includePriorPeriod && engagement.priorPeriodEngagement?.id) {
    try {
      const priorCtx = await buildTemplateContext(engagement.priorPeriodEngagement.id, { includePriorPeriod: false });
      (ctx as any).priorPeriod = priorCtx;
    } catch {
      // Prior engagement may be inaccessible (rare but possible when
      // a prior is soft-deleted or schema drifts). Tolerant.
      (ctx as any).priorPeriod = null;
    }
  } else {
    (ctx as any).priorPeriod = null;
  }

  return ctx;
}
