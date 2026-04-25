import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { extractReferencedPaths, extractTemplateOutputs, type TemplateOutputRef } from '@/lib/template-handlebars';
import { loadFirmSchedules } from '@/lib/schedule-loader';

/**
 * GET /api/methodology-admin/template-references
 *
 * Returns every Handlebars path referenced by any of the firm's
 * active document + email templates (content + subject). Powers the
 * red "this cell feeds a template" highlight on schedule forms —
 * DynamicAppendixForm fetches this once on mount, and every question
 * whose placeholder path appears in the set gets a red outline on
 * the answer cell.
 *
 * Returns BOTH:
 *   1. Flat top-level paths (the historic shape) — fully-qualified
 *      `questionnaires.<X>.<key>` references.
 *   2. Synthetic loop-context paths — emitted when a template uses
 *      the asList iteration pattern. Format:
 *        `asList:<schedule>:<section>@col<N>`
 *        `asList:<schedule>:@col<N>`           (no section filter)
 *        `asList:<schedule>:<section>@answer`  (standard layout {{answer}})
 *        `asList:<schedule>:@answer`
 *      Slug body refs (e.g. {{threat_description}}) are resolved to
 *      their col<N> equivalent via the schedule's sectionMeta before
 *      being added to the path set, so the matcher only needs to
 *      compare col<N> forms.
 *
 * Response:
 *   {
 *     paths: string[],                 // unique paths referenced
 *     byPath: {
 *       [path]: Array<{ templateId, templateName, kind }>
 *     },
 *   }
 *
 * Auth: any authenticated user — schedules are seen by the whole
 * audit team and the red highlight is a read-only hint, not a
 * privileged action.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.twoFactorVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const firmId = session.user.firmId;

  const templates = await prisma.documentTemplate.findMany({
    where: { firmId, isActive: true },
    select: { id: true, name: true, kind: true, subject: true, content: true },
  });

  // Section meta keyed by ctxKey ('ethics' / 'continuance' / etc.) →
  // sectionName → { columnHeaders, layout, ... }. Used to resolve
  // header-slug body refs (e.g. {{threat_description}}) to their
  // col<N> position when emitting synthetic asList paths. Loaded
  // once for all templates on the request.
  const sectionMetaByCtxKey = await loadSectionMetaForFirm(firmId);

  const paths = new Set<string>();
  const byPath: Record<string, Array<{ templateId: string; templateName: string; kind: string }>> = {};

  function addPath(p: string, t: { id: string; name: string; kind: string }) {
    paths.add(p);
    if (!byPath[p]) byPath[p] = [];
    // Avoid duplicating the same template against the same path
    // (e.g. when subject + body both reference it).
    if (!byPath[p].some(x => x.templateId === t.id)) {
      byPath[p].push({ templateId: t.id, templateName: t.name, kind: t.kind });
    }
  }

  for (const t of templates) {
    const flatRefs = new Set<string>();
    let outputs: TemplateOutputRef[] = [];
    try {
      for (const p of extractReferencedPaths(t.content || '')) flatRefs.add(p);
      for (const p of extractReferencedPaths(t.subject || '')) flatRefs.add(p);
      outputs = [
        ...extractTemplateOutputs(t.content || ''),
        ...extractTemplateOutputs(t.subject || ''),
      ];
    } catch {
      // Malformed template shouldn't break the list.
      continue;
    }
    const tref = { id: t.id, name: t.name, kind: t.kind };
    for (const p of flatRefs) addPath(p, tref);

    // Synthetic asList paths from each loop reference.
    for (const ref of outputs) {
      const sec = ref.sectionName ?? '';
      // Resolve slug → col<N> using sectionMeta when available.
      let colN: number | null = ref.colN;
      if (colN == null && ref.slug) {
        colN = resolveSlugToColN(sectionMetaByCtxKey, ref.questionnaireKey, ref.sectionName, ref.slug);
      }
      if (colN != null) {
        // Emit BOTH a section-specific and a section-agnostic path so
        // the matcher can match either. Lets a Threats-only loop
        // outline only Threats rows, while a section-agnostic loop
        // outlines every section's row of the same column.
        addPath(`asList:${ref.questionnaireKey}:${sec}@col${colN}`, tref);
        addPath(`asList:${ref.questionnaireKey}:@col${colN}`, tref);
      } else if (ref.isAnswer) {
        addPath(`asList:${ref.questionnaireKey}:${sec}@answer`, tref);
        addPath(`asList:${ref.questionnaireKey}:@answer`, tref);
      } else if (ref.isQuestion) {
        addPath(`asList:${ref.questionnaireKey}:${sec}@question`, tref);
        addPath(`asList:${ref.questionnaireKey}:@question`, tref);
      }
      // else: unrecognised slug we couldn't resolve — drop silently
      // (better than a phantom outline on the wrong column).
    }
  }

  return NextResponse.json({
    paths: [...paths].sort(),
    byPath,
  });
}

/**
 * Pull sectionMeta for EVERY firm schedule (not just `_questions`-
 * suffixed ones — also `_categories`, `questionnaire`, custom slugs).
 * Indexed as { ctxKey → sectionName → meta }. Backed by
 * `loadFirmSchedules` so the same schedule-detection rule applies
 * here as in the AI catalog and live render path.
 */
async function loadSectionMetaForFirm(firmId: string): Promise<Map<string, Map<string, any>>> {
  const out = new Map<string, Map<string, any>>();
  try {
    const schedules = await loadFirmSchedules(firmId);
    for (const s of schedules) {
      const map = out.get(s.ctxKey) || new Map<string, any>();
      // Multiple rows could share a ctxKey (e.g. several
      // `questionnaire` rows whose names slugified the same). Merge
      // their sectionMeta — last write wins per sectionName, which
      // is acceptable since collisions are rare and the loader's
      // ctxKey rule prefers items.name to keep them distinct.
      for (const [k, v] of Object.entries(s.sectionMeta)) map.set(k, v);
      out.set(s.ctxKey, map);
    }
  } catch {
    // Best-effort — empty map means slug refs won't resolve, the
    // existing fully-qualified path matching still works.
  }
  return out;
}

/**
 * Resolve a header-slug body ref (e.g. 'threat_description') to its
 * col<N> position by walking the firm's sectionMeta for the schedule.
 * If the slug appears in MULTIPLE sections at different col<N>
 * positions — rare, but possible — the section-specific path picks
 * up the right one; the section-agnostic path tolerates the
 * ambiguity by emitting an outline on every matching col<N>.
 */
function resolveSlugToColN(
  meta: Map<string, Map<string, any>>,
  ctxKey: string,
  sectionName: string | null,
  slug: string,
): number | null {
  const schedule = meta.get(ctxKey);
  if (!schedule) return null;
  const slugLower = slug.toLowerCase();
  // Section-specific: try the literal sectionName first, then a
  // slugified form (matches sectionMeta-key tolerance elsewhere).
  if (sectionName) {
    const s = schedule.get(sectionName) || schedule.get(slugifyHeader(sectionName));
    const colN = colForSlug(s, slugLower);
    if (colN != null) return colN;
  }
  // No section filter — search every section the schedule has and
  // return the first col<N> whose header slugifies to the requested
  // slug. Predictable: same algorithm both sides of the comparison.
  for (const sectionEntry of schedule.values()) {
    const colN = colForSlug(sectionEntry, slugLower);
    if (colN != null) return colN;
  }
  return null;
}

function colForSlug(sectionEntry: any, slug: string): number | null {
  const headers = Array.isArray(sectionEntry?.columnHeaders) ? sectionEntry.columnHeaders : null;
  if (!headers) return null;
  for (let i = 1; i < headers.length; i++) {
    if (slugifyHeader(String(headers[i] || '')) === slug) return i;
  }
  return null;
}

function slugifyHeader(s: string): string {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}
