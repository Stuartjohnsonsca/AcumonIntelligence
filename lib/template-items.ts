import type { TemplateQuestion, TemplateSectionMeta } from '@/types/methodology';

/**
 * Normalise a MethodologyTemplate's `items` JSON into a canonical
 * { questions, sectionMeta } shape.
 *
 * Older/simpler schedules store items as a flat TemplateQuestion[].
 * Schedules that carry section metadata (column layout, custom
 * headers, sign-off flag) store items as { questions, sectionMeta }.
 * Both shapes are accepted here so every caller can treat them the
 * same way — no more `Array.isArray(items) ? items : items.questions`
 * scattered through the tabs.
 */
export interface NormalisedTemplate {
  questions: TemplateQuestion[];
  sectionMeta: Record<string, TemplateSectionMeta>;
}

export function normaliseTemplateItems(raw: unknown): NormalisedTemplate {
  if (Array.isArray(raw)) {
    return { questions: raw as TemplateQuestion[], sectionMeta: {} };
  }
  if (raw && typeof raw === 'object') {
    const obj = raw as { questions?: unknown; sectionMeta?: unknown };
    const questions = Array.isArray(obj.questions) ? (obj.questions as TemplateQuestion[]) : [];
    const sectionMeta = obj.sectionMeta && typeof obj.sectionMeta === 'object'
      ? (obj.sectionMeta as Record<string, TemplateSectionMeta>)
      : {};
    return { questions, sectionMeta };
  }
  return { questions: [], sectionMeta: {} };
}
