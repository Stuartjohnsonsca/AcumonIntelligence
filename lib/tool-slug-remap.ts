/**
 * Per-firm slug remap for tool-wired schedule questions.
 *
 * Built-in calculators (VAT Reconciliation, Tax on Profits, etc.) read
 * answers from the Permanent / other schedules by looking up a
 * canonical question slug — derived from the question text via
 * slugifyQuestionText. Renaming or deleting the canonical question
 * breaks the wiring and the tool falls back to a "not configured"
 * state.
 *
 * The remap registry — stored on Firm.methodologyToolSlugRemaps as a
 * JSON array — lets a Methodology Admin redirect a tool to a
 * replacement question on the same template. Each entry is keyed by
 * (toolName, templateType, originalSlug, originalColumn) and points at
 * a (replacementSlug, replacementColumn). When a tool reads, it
 * consults the registry first; if no entry matches it falls back to
 * the canonical slug it ships with.
 *
 * Surface in the UI: AppendixTemplateEditor's protected-question
 * warning offers a "Remap to another question" path on top of the
 * existing Cancel / Continue choices. Picking a replacement saves a
 * remap entry, then the original question is deleted / renamed in the
 * same flow — no broken state in between.
 */

export interface ToolSlugRemap {
  toolName: string;          // e.g. 'VAT Reconciliation'
  templateType: string;      // e.g. 'permanent_file_questions'
  originalSlug: string;      // canonical slug shipped with the tool
  originalColumn?: number;   // 1-based; undefined means whole-row answer
  replacementSlug: string;
  replacementColumn?: number;
}

/** Coerce raw JSON loaded from the Firm row into a typed array. Tolerant
 *  of malformed entries — anything missing required fields is dropped
 *  silently so a hand-edited record can't brick the tool. */
export function parseRemaps(raw: unknown): ToolSlugRemap[] {
  if (!Array.isArray(raw)) return [];
  const out: ToolSlugRemap[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.toolName !== 'string' || !e.toolName) continue;
    if (typeof e.templateType !== 'string' || !e.templateType) continue;
    if (typeof e.originalSlug !== 'string' || !e.originalSlug) continue;
    if (typeof e.replacementSlug !== 'string' || !e.replacementSlug) continue;
    const remap: ToolSlugRemap = {
      toolName: e.toolName,
      templateType: e.templateType,
      originalSlug: e.originalSlug,
      replacementSlug: e.replacementSlug,
    };
    if (typeof e.originalColumn === 'number' && Number.isFinite(e.originalColumn)) {
      remap.originalColumn = e.originalColumn;
    }
    if (typeof e.replacementColumn === 'number' && Number.isFinite(e.replacementColumn)) {
      remap.replacementColumn = e.replacementColumn;
    }
    out.push(remap);
  }
  return out;
}

/** Compose the storage key the tool reads from the flattened schedule
 *  data. A column suffix is appended only when the column is a real
 *  positive integer; otherwise the bare slug is returned (matching the
 *  behaviour of the existing single-column reads). */
export function flatKey(slug: string, column?: number): string {
  if (typeof column === 'number' && column > 0) return `${slug}_col${column}`;
  return slug;
}

/** Resolve the (slug, column) pair the tool should read for a given
 *  canonical entry, applying the firm's first matching remap (if any).
 *  When no remap matches, returns the canonical pair unchanged. */
export function resolveRemap(
  remaps: ToolSlugRemap[],
  toolName: string,
  templateType: string,
  canonicalSlug: string,
  canonicalColumn?: number,
): { slug: string; column?: number } {
  for (const r of remaps) {
    if (r.toolName !== toolName) continue;
    if (r.templateType !== templateType) continue;
    if (r.originalSlug !== canonicalSlug) continue;
    if ((r.originalColumn ?? undefined) !== (canonicalColumn ?? undefined)) continue;
    return { slug: r.replacementSlug, column: r.replacementColumn };
  }
  return { slug: canonicalSlug, column: canonicalColumn };
}

/** Insert or update a remap entry in the registry. Match key is
 *  (toolName, templateType, originalSlug, originalColumn) — a second
 *  call with the same canonical pair overwrites the previous
 *  replacement. Returns a NEW array (caller persists it). */
export function upsertRemap(
  remaps: ToolSlugRemap[],
  next: ToolSlugRemap,
): ToolSlugRemap[] {
  const out = remaps.filter(r => !(
    r.toolName === next.toolName
    && r.templateType === next.templateType
    && r.originalSlug === next.originalSlug
    && (r.originalColumn ?? undefined) === (next.originalColumn ?? undefined)
  ));
  out.push(next);
  return out;
}

/** Remove a remap entry. No-op if no match. Returns a NEW array. */
export function removeRemap(
  remaps: ToolSlugRemap[],
  match: { toolName: string; templateType: string; originalSlug: string; originalColumn?: number },
): ToolSlugRemap[] {
  return remaps.filter(r => !(
    r.toolName === match.toolName
    && r.templateType === match.templateType
    && r.originalSlug === match.originalSlug
    && (r.originalColumn ?? undefined) === (match.originalColumn ?? undefined)
  ));
}
