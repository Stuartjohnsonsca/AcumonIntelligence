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
    significantRisks: Array<{ fsLine: string; name: string }>;
    areasOfFocus: Array<{ fsLine: string; reason: string }>;
  };
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
export async function buildTemplateContext(engagementId: string): Promise<TemplateContext> {
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
  let materiality: TemplateContext['materiality'] = {
    overall: null, performance: null, clearlyTrivial: null,
    benchmark: null, benchmarkAmount: null, benchmarkPct: null,
  };
  try {
    const mat = await prisma.auditMateriality.findUnique({ where: { engagementId } }) as any;
    if (mat?.data) {
      const d: any = mat.data;
      materiality = {
        overall: d.overallMateriality ?? d.materiality ?? null,
        performance: d.performanceMateriality ?? null,
        clearlyTrivial: d.clearlyTrivial ?? null,
        benchmark: d.benchmark ?? null,
        benchmarkAmount: d.benchmarkAmount ?? null,
        benchmarkPct: d.benchmarkPct ?? null,
      };
    }
  } catch { /* tolerant — missing materiality row is fine */ }

  // Error schedule.
  const errorRows = await prisma.auditErrorSchedule.findMany({ where: { engagementId } });
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

  // Audit plan: significant risks + areas of focus are derived from the
  // RMM table (AuditRMMRow) where category is flagged accordingly.
  let significantRisks: Array<{ fsLine: string; name: string }> = [];
  let areasOfFocus: Array<{ fsLine: string; reason: string }> = [];
  try {
    const rmm = await (prisma as any).auditRMMRow?.findMany?.({ where: { engagementId } }) ?? [];
    significantRisks = rmm
      .filter((r: any) => r?.isSignificantRisk || r?.category === 'Significant Risk')
      .map((r: any) => ({ fsLine: r.lineItem || r.fsLine || '', name: r.riskName || r.description || 'Significant risk' }));
    areasOfFocus = rmm
      .filter((r: any) => r?.isAreaOfFocus || r?.category === 'Area of Focus')
      .map((r: any) => ({ fsLine: r.lineItem || r.fsLine || '', reason: r.description || '' }));
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
      if (!model || typeof model.findUnique !== 'function') return {};
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
  for (const s of qSchemas) {
    const items = Array.isArray(s.items) ? s.items as any[] : [];
    schemaByType.set(s.templateType, items);
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
    const out: Record<string, any> = { ...raw };
    const bySection: Record<string, Record<string, any>> = {};
    interface ListItem {
      question: string; key: string; answer: any;
      section: string | null; sortOrder: number;
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
      if (!item?.id || !item?.key) continue;
      const value = raw[item.id];
      // Skip entries the user hasn't answered — keeps the context
      // compact and makes missing-placeholder checks meaningful.
      if (value === undefined) continue;
      // Human-readable key at the top level of the questionnaire.
      out[item.key] = value;
      if (item.sectionKey) {
        const sec = slugify(item.sectionKey);
        if (!bySection[sec]) bySection[sec] = {};
        bySection[sec][item.key] = value;
      }
      asList.push({
        question: String(item.questionText ?? item.label ?? item.key),
        key: String(item.key),
        answer: value,
        section: item.sectionKey ? String(item.sectionKey) : null,
        sortOrder: Number(item.sortOrder) || 0,
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
      registeredAddress: engagement.client.address ?? null,
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
    auditPlan: { significantRisks, areasOfFocus },
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

  return ctx;
}
