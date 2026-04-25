/**
 * Single source of truth for "what counts as a schedule" across the
 * template subsystem.
 *
 * Historically four places independently filtered MethodologyTemplate
 * rows with `templateType: { endsWith: '_questions' }`:
 *
 *   • lib/template-context.ts          (live document render)
 *   • lib/template-render.ts           (preview / dynamic sample data)
 *   • template-references API          (red-outline detection)
 *   • suggest-placeholder API          (AI search catalog)
 *
 * That excluded:
 *   • `_categories`-suffixed schedules (e.g. `tax_technical_categories`)
 *   • Generic `questionnaire` rows (firm-defined ad-hoc questionnaires
 *     like "Financial Update")
 *   • Any custom schedule an admin creates via the Schedule Designer
 *     master-list with an arbitrary slug
 *
 * — and put four files out of sync with each other any time someone
 * needed to add a new shape (legacy flat array, the
 * `{ questions, sectionMeta }` shape, the `{ groups }` shape, …).
 *
 * This module centralises the rule. `loadFirmSchedules(firmId)` returns
 * every schedule-shaped template for the firm, normalised to a single
 * shape the consumers can iterate. Non-schedule rows (firm config,
 * specialist roles, validation rules, audit-type schedules, etc.) are
 * filtered out by inspecting whether the items contain at least one
 * question-shaped element.
 *
 * The four consumers each layer their own logic on top of the
 * normalised result — building AI catalogs, building preview rows,
 * resolving live answers, etc. They no longer need to know about
 * items shapes.
 */

import { prisma } from '@/lib/db';

/** Normalised schedule entry — the loader's output unit. */
export interface FirmSchedule {
  /** The raw `methodology_templates.template_type` (e.g.
   *  `ethics_questions`, `tax_technical_categories`, `questionnaire`). */
  templateType: string;
  /** The raw `methodology_templates.audit_type`. Disambiguates
   *  multiple rows with the same templateType (notably
   *  `questionnaire` schedules — a firm can have several). */
  auditType: string;
  /** Stable Handlebars-context key for `questionnaires.<ctxKey>.*`.
   *  Canonical mapping wins for the well-known _questions types so
   *  existing templates keep resolving. Other types fall back to a
   *  camelCase derivation; `questionnaire`-shape rows prefer the
   *  human `items.name` slug when set. */
  ctxKey: string;
  /** Human-readable label for AI menu / preview headers. */
  typeLabel: string;
  /** Flat list of question objects. Already merged from the
   *  three known input shapes. */
  questions: any[];
  /** sectionKey → meta. Empty when the schedule's items shape doesn't
   *  carry sectionMeta (legacy flat arrays, group-shaped). */
  sectionMeta: Record<string, any>;
  /** Prisma model name to load saved answers from, when one exists.
   *  Null when the schedule type has no dedicated answers table. */
  prismaModel: string | null;
}

const CANONICAL_CTX_KEYS: Record<string, { ctxKey: string; prismaModel: string | null; typeLabel: string }> = {
  permanent_file_questions:    { ctxKey: 'permanentFile',    prismaModel: 'auditPermanentFile',    typeLabel: 'Permanent File Questionnaire' },
  ethics_questions:            { ctxKey: 'ethics',           prismaModel: 'auditEthics',           typeLabel: 'Ethics Questionnaire' },
  continuance_questions:       { ctxKey: 'continuance',      prismaModel: 'auditContinuance',      typeLabel: 'Continuance Questionnaire' },
  materiality_questions:       { ctxKey: 'materiality',      prismaModel: 'auditMateriality',      typeLabel: 'Materiality Questionnaire' },
  new_client_takeon_questions: { ctxKey: 'newClientTakeOn',  prismaModel: 'auditNewClientTakeOn',  typeLabel: 'New Client Take-On Questionnaire' },
  subsequent_events_questions: { ctxKey: 'subsequentEvents', prismaModel: 'auditSubsequentEvents', typeLabel: 'Subsequent Events Questionnaire' },
};

function camelCase(stem: string): string {
  return stem.replace(/_([a-z0-9])/g, (_, ch) => ch.toUpperCase());
}

function titleCaseWords(stem: string): string {
  return stem.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function slugify(s: string): string {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/**
 * Decide whether `items` looks like a question schema. Three
 * production shapes count:
 *   1. `Array<TemplateQuestion>` — flat list of questions, each with
 *      an id and questionText/text.
 *   2. `{ questions: TemplateQuestion[], sectionMeta?: ... }` — newer
 *      shape with explicit sectionMeta.
 *   3. `{ name?, groups: [{ title, questions: [...] }] }` — generic
 *      `questionnaire` shape.
 *
 * Anything else (specialist_roles, validation_rules, headings,
 * audit_type_schedules, connector configs, …) returns false.
 */
function isQuestionShaped(items: unknown): boolean {
  if (Array.isArray(items)) {
    for (const it of items) {
      if (it && typeof it === 'object') {
        const o = it as any;
        if (typeof o.questionText === 'string' || typeof o.text === 'string' || typeof o.label === 'string') {
          if (typeof o.id === 'string' || typeof o.key === 'string') return true;
        }
        // Group shape inside a flat array — treat as schedule too.
        if (Array.isArray(o.questions)) return true;
      }
    }
    return false;
  }
  if (items && typeof items === 'object') {
    const root = items as any;
    if (Array.isArray(root.questions)) {
      for (const q of root.questions) if (q && (q.questionText || q.text || q.label)) return true;
    }
    if (Array.isArray(root.groups)) {
      for (const g of root.groups) if (g && Array.isArray(g.questions)) {
        for (const q of g.questions) if (q && (q.questionText || q.text || q.label)) return true;
      }
    }
  }
  return false;
}

/**
 * Pull the question list out of any of the three production shapes.
 * For the `groups` shape we flatten with the group title carried
 * through as the question's `sectionKey` so consumers see the same
 * shape regardless of source.
 */
function extractQuestions(items: unknown): { questions: any[]; sectionMeta: Record<string, any> } {
  if (Array.isArray(items)) return { questions: items, sectionMeta: {} };
  if (items && typeof items === 'object') {
    const root = items as any;
    if (Array.isArray(root.questions)) {
      return { questions: root.questions, sectionMeta: root.sectionMeta && typeof root.sectionMeta === 'object' ? root.sectionMeta : {} };
    }
    if (Array.isArray(root.groups)) {
      // Flatten — promote each group's title onto every question as
      // its sectionKey. Lets the same downstream code that handles
      // table-layout sections handle generic `questionnaire` rows.
      const flat: any[] = [];
      for (const g of root.groups) {
        const sec = String(g?.title || '');
        if (!Array.isArray(g?.questions)) continue;
        for (const q of g.questions) {
          if (!q || typeof q !== 'object') continue;
          flat.push({ ...q, sectionKey: q.sectionKey || sec });
        }
      }
      return { questions: flat, sectionMeta: {} };
    }
  }
  return { questions: [], sectionMeta: {} };
}

/**
 * Pick a stable ctxKey for a row. Canonical types map to their
 * documented keys (preserves any merge fields admins have already
 * wired into templates). Non-canonical:
 *   - `questionnaire` rows → slug of `items.name` if set, otherwise
 *     fall back to the auditType slug. Multiple `questionnaire`
 *     rows for one firm therefore each get their own bucket
 *     (`questionnaires.financialUpdate`, etc.).
 *   - Anything else → camelCase of templateType with the
 *     `_questions` / `_categories` suffix stripped.
 */
function ctxKeyFor(templateType: string, auditType: string, items: unknown): string {
  const canonical = CANONICAL_CTX_KEYS[templateType];
  if (canonical) return canonical.ctxKey;

  if (templateType === 'questionnaire' && items && typeof items === 'object') {
    const name = (items as any).name;
    if (typeof name === 'string' && name.trim()) {
      return camelCase(slugify(name));
    }
    return camelCase(slugify(auditType || 'questionnaire'));
  }

  const stem = templateType.replace(/_(questions|categories)$/, '');
  return camelCase(stem);
}

function typeLabelFor(templateType: string, auditType: string, items: unknown): string {
  const canonical = CANONICAL_CTX_KEYS[templateType];
  if (canonical) return canonical.typeLabel;
  if (templateType === 'questionnaire' && items && typeof items === 'object') {
    const name = (items as any).name;
    if (typeof name === 'string' && name.trim()) return name.trim();
  }
  const stem = templateType.replace(/_(questions|categories)$/, '');
  return titleCaseWords(stem);
}

/**
 * Load every schedule-shaped methodology template for a firm and
 * normalise to {@link FirmSchedule}. Non-schedule rows (config,
 * specialist roles, validation rules, headings, …) are dropped by
 * inspecting items shape — no static templateType allow-list to
 * maintain.
 */
export async function loadFirmSchedules(firmId: string): Promise<FirmSchedule[]> {
  const rows = await prisma.methodologyTemplate.findMany({ where: { firmId } });
  const out: FirmSchedule[] = [];
  for (const row of rows) {
    if (!isQuestionShaped(row.items)) continue;
    const { questions, sectionMeta } = extractQuestions(row.items);
    if (questions.length === 0) continue;
    const ctxKey = ctxKeyFor(row.templateType, row.auditType, row.items);
    const typeLabel = typeLabelFor(row.templateType, row.auditType, row.items);
    const prismaModel = CANONICAL_CTX_KEYS[row.templateType]?.prismaModel ?? null;
    out.push({
      templateType: row.templateType,
      auditType: row.auditType,
      ctxKey,
      typeLabel,
      questions,
      sectionMeta,
      prismaModel,
    });
  }
  return out;
}

/**
 * Sync companion to {@link loadFirmSchedules} for callers that
 * already have the rows in memory (e.g. a route loaded them via a
 * raw query or a different where-clause). Same shape detection +
 * normalisation, no DB hit.
 */
export function normaliseSchedules(rows: Array<{ templateType: string; auditType: string; items: unknown }>): FirmSchedule[] {
  const out: FirmSchedule[] = [];
  for (const row of rows) {
    if (!isQuestionShaped(row.items)) continue;
    const { questions, sectionMeta } = extractQuestions(row.items);
    if (questions.length === 0) continue;
    const ctxKey = ctxKeyFor(row.templateType, row.auditType, row.items);
    const typeLabel = typeLabelFor(row.templateType, row.auditType, row.items);
    const prismaModel = CANONICAL_CTX_KEYS[row.templateType]?.prismaModel ?? null;
    out.push({ templateType: row.templateType, auditType: row.auditType, ctxKey, typeLabel, questions, sectionMeta, prismaModel });
  }
  return out;
}
