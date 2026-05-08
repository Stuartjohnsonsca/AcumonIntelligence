// Parse the citations InterrogateBot bakes into its answers.
//
// The bot is instructed to write JSON-path citations in parentheses
// directly after each fact, e.g.
//   "Overall materiality is £50,000 (materiality.overall)."
// Phase 3 also lets it cite uploaded documents:
//   "The board approved the new policy on 12 March 2025 (document:doc_id_xyz, page 3)."
//
// extractCitations() pulls both kinds out of an answer body so the UI
// can render them as clickable links.

const JSON_PATH_RE = /\(([a-zA-Z][\w]*(?:\.[\w]+)+(?:\s*—\s*[^)]+)?)\)/g;
const DOC_REF_RE = /\(document:([a-zA-Z0-9_-]+)(?:,\s*page\s*(\d+))?\)/g;

export interface ParsedCitation {
  raw: string; // the matched parenthesised substring
  type: 'json_path' | 'document';
  path?: string; // for json_path
  documentId?: string; // for document
  page?: number; // for document
  start: number;
  end: number;
}

export function extractCitations(text: string): ParsedCitation[] {
  if (!text) return [];
  const out: ParsedCitation[] = [];
  // Document refs first so the json-path regex doesn't false-match on `(document:...)`.
  for (const m of text.matchAll(DOC_REF_RE)) {
    out.push({
      raw: m[0],
      type: 'document',
      documentId: m[1],
      page: m[2] ? parseInt(m[2], 10) : undefined,
      start: m.index || 0,
      end: (m.index || 0) + m[0].length,
    });
  }
  for (const m of text.matchAll(JSON_PATH_RE)) {
    // Skip any range already consumed by a document citation.
    const start = m.index || 0;
    const end = start + m[0].length;
    if (out.some(c => start < c.end && end > c.start)) continue;
    const path = m[1].split('—')[0].trim();
    out.push({ raw: m[0], type: 'json_path', path, start, end });
  }
  out.sort((a, b) => a.start - b.start);
  return out;
}

/** Just the deduplicated list of cited JSON paths (for storing in
 *  InterrogateInteraction.sources). */
export function uniqueSourcePaths(text: string): string[] {
  const seen = new Set<string>();
  for (const c of extractCitations(text)) {
    if (c.type === 'json_path' && c.path) seen.add(c.path);
  }
  return Array.from(seen);
}

/** Just the deduplicated list of cited AuditDocument ids. */
export function uniqueDocumentRefs(text: string): string[] {
  const seen = new Set<string>();
  for (const c of extractCitations(text)) {
    if (c.type === 'document' && c.documentId) seen.add(c.documentId);
  }
  return Array.from(seen);
}

// ─── JSON path → engagement tab mapping ────────────────────────────
// First segment of the path → tab key the link should jump to. Matches
// what TemplateContext exposes (see lib/template-context.ts).

const PATH_TO_TAB: Record<string, string> = {
  client: 'opening',
  engagement: 'opening',
  team: 'opening',
  contacts: 'opening',
  specialists: 'tax-technical',
  agreedDates: 'opening',
  informationRequests: 'opening',
  ethics: 'ethics',
  continuance: 'continuance',
  newClientTakeOn: 'new-client',
  permanentFile: 'permanent-file',
  priorPeriod: 'prior-period',
  subsequentEvents: 'subsequent-events',
  materiality: 'materiality',
  trialBalance: 'tb',
  par: 'par',
  walkthroughs: 'walkthroughs',
  rmm: 'rmm',
  significantRisks: 'rmm',
  documents: 'documents',
  outstanding: 'outstanding',
  errorSchedule: 'outstanding',
  auditPlan: 'opening', // audit plan is a panel; opening is the closest tab
  questionnaires: 'opening', // questionnaires sub-paths are remapped below
  vat: 'materiality', // VAT recon sits under materiality/audit plan
  taxOnProfits: 'tax-technical',
  meetings: 'opening',
  taxTechnical: 'tax-technical',
  communication: 'communication',
};

const QUESTIONNAIRE_TO_TAB: Record<string, string> = {
  ethics: 'ethics',
  continuance: 'continuance',
  newClientTakeOn: 'new-client',
  permanentFile: 'permanent-file',
  priorPeriod: 'prior-period',
  subsequentEvents: 'subsequent-events',
  materiality: 'materiality',
  fees: 'opening',
};

/** Resolve a JSON path to the engagement tab key that owns that data,
 *  or null if there's no obvious mapping. */
export function jsonPathToTab(path: string): string | null {
  const head = path.split('.')[0];
  if (head === 'questionnaires') {
    const sub = path.split('.')[1];
    if (sub && QUESTIONNAIRE_TO_TAB[sub]) return QUESTIONNAIRE_TO_TAB[sub];
    return 'opening';
  }
  return PATH_TO_TAB[head] || null;
}
