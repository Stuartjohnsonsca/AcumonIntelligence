/**
 * Cross-cutting helper: before any pipeline action asks the client
 * for information, check whether we already have it.
 *
 * Three sources, all opt-in via the action's `dedup_sources` input:
 *
 *   1. `existing_documents` — the engagement's AuditDocument table.
 *      Filtered by document type, area of work, and a recency window
 *      so a 5-year-old invoice doesn't satisfy this period's request.
 *   2. `prior_portal_responses` — past PortalRequest rows on the
 *      same engagement that already received a response. Useful for
 *      questionnaires and listing requests.
 *   3. `pipeline_state` — outputs from earlier steps in the same
 *      pipeline run, e.g. an Accounting Extract step that has
 *      already pulled the invoices we'd otherwise ask for.
 *
 * Each match becomes a row in `alreadyHave` with enough context
 * (where it came from, when, link / id) for the runtime UI to render
 * the items as "we already have these" without going to the client.
 *
 * Action handlers call `findExistingClientResponses(opts, ctx)` and
 * use the result to:
 *   - shrink or skip the portal request,
 *   - emit `already_have` on the action's outputs so downstream
 *     steps can chain off it,
 *   - keep `outstanding_count` honest (the count of items actually
 *     sent to the portal, not the original ask).
 */

import { prisma } from '@/lib/db';
import type { ActionHandlerContext } from '@/lib/action-handlers';
import type { InputFieldDef, OutputFieldDef } from '@/lib/action-registry';

export type DedupSource =
  | 'existing_documents'
  | 'prior_portal_responses'
  | 'pipeline_state';

export interface DedupOptions {
  engagementId: string;
  /**
   * How wide a net to cast. If null/empty/zero, dedup is treated as
   * disabled and the helper returns an empty result without hitting
   * the database — handlers should branch on `dedup_enabled` first
   * but this is a defensive second gate.
   */
  enabled: boolean;
  sources: DedupSource[];
  windowDays?: number;

  /** Document type filter for AuditDocument (e.g. 'invoice'). */
  documentType?: string | null;
  /**
   * Free-text "area of work" tag (matches AuditDocument.usageLocation
   * or PortalRequest.evidenceTag). Often the FS line.
   */
  areaOfWork?: string | null;
  /**
   * Optional explicit reference values to match against (transaction
   * refs, supplier names). Each item in `match` is matched as a
   * substring against AuditDocument.documentName / mappedItems and
   * PortalRequest.question / response.
   */
  match?: string[];
}

export interface DedupHit {
  source: DedupSource;
  /** Stable id (audit_document.id or portal_request.id). */
  id: string;
  /** Short, human-readable summary used in the UI. */
  summary: string;
  documentType?: string | null;
  receivedAt?: Date | string | null;
  /** Anything else the action handler wants to forward downstream. */
  extra?: Record<string, unknown>;
}

export interface DedupResult {
  enabled: boolean;
  hits: DedupHit[];
  summary: string;
}

const DEFAULT_WINDOW_DAYS = 365;

function daysAgo(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

function caseInsensitiveContains(haystack: string | null | undefined, needle: string): boolean {
  if (!haystack) return false;
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

function summariseDocumentName(d: { documentName: string; documentType: string | null; receivedAt: Date | null }): string {
  const parts = [d.documentName];
  if (d.documentType) parts.push(`(${d.documentType})`);
  if (d.receivedAt) parts.push(`received ${d.receivedAt.toISOString().slice(0, 10)}`);
  return parts.join(' ');
}

function summariseRequest(p: { question: string; response: string | null; respondedAt: Date | null }): string {
  const ts = p.respondedAt ? p.respondedAt.toISOString().slice(0, 10) : 'pending';
  const q = p.question.length > 80 ? p.question.slice(0, 77) + '…' : p.question;
  return `Prior portal response (${ts}): ${q}`;
}

/**
 * Look up the engagement's existing client-supplied evidence
 * matching the action's request criteria.
 *
 * Returns `{ enabled: false, hits: [], summary: '...' }` when dedup
 * is disabled by the caller — the action can then proceed with its
 * normal "ask the client" path without a separate code branch.
 */
export async function findExistingClientResponses(
  opts: DedupOptions,
  ctx?: Pick<ActionHandlerContext, 'pipelineState' | 'stepIndex'>,
): Promise<DedupResult> {
  if (!opts.enabled || opts.sources.length === 0) {
    return { enabled: false, hits: [], summary: 'Dedup disabled — going straight to client.' };
  }
  const window = opts.windowDays && opts.windowDays > 0 ? opts.windowDays : DEFAULT_WINDOW_DAYS;
  const cutoff = daysAgo(window);
  const hits: DedupHit[] = [];

  // ─── 1. AuditDocument table ──────────────────────────────────────────────
  if (opts.sources.includes('existing_documents')) {
    const docs = await prisma.auditDocument.findMany({
      where: {
        engagementId: opts.engagementId,
        ...(opts.documentType ? { documentType: { equals: opts.documentType, mode: 'insensitive' } } : {}),
        ...(opts.areaOfWork
          ? {
              OR: [
                { usageLocation: { contains: opts.areaOfWork, mode: 'insensitive' } },
                { documentName: { contains: opts.areaOfWork, mode: 'insensitive' } },
              ],
            }
          : {}),
        receivedAt: { gte: cutoff },
      },
      select: {
        id: true,
        documentName: true,
        documentType: true,
        receivedAt: true,
        mappedItems: true,
      },
      orderBy: { receivedAt: 'desc' },
      take: 200,
    });

    for (const d of docs) {
      // When the caller supplied explicit `match` values, only count
      // documents whose name or mappedItems mention at least one of
      // them. This stops us mistaking last-quarter's invoice for the
      // current period's transaction.
      if (opts.match && opts.match.length > 0) {
        const haystack = [d.documentName, JSON.stringify(d.mappedItems || '')].join(' ');
        const matched = opts.match.some(m => caseInsensitiveContains(haystack, m));
        if (!matched) continue;
      }
      hits.push({
        source: 'existing_documents',
        id: d.id,
        summary: summariseDocumentName({
          documentName: d.documentName,
          documentType: d.documentType,
          receivedAt: d.receivedAt,
        }),
        documentType: d.documentType,
        receivedAt: d.receivedAt,
        extra: { mappedItems: d.mappedItems },
      });
    }
  }

  // ─── 2. PortalRequest history ────────────────────────────────────────────
  if (opts.sources.includes('prior_portal_responses')) {
    const requests = await prisma.portalRequest.findMany({
      where: {
        engagementId: opts.engagementId,
        status: { in: ['responded', 'verified', 'committed', 'chat_replied'] },
        respondedAt: { gte: cutoff },
        ...(opts.areaOfWork
          ? { evidenceTag: { contains: opts.areaOfWork, mode: 'insensitive' } }
          : {}),
      },
      select: {
        id: true,
        question: true,
        response: true,
        respondedAt: true,
        evidenceTag: true,
      },
      orderBy: { respondedAt: 'desc' },
      take: 50,
    });
    for (const p of requests) {
      if (opts.match && opts.match.length > 0) {
        const haystack = [p.question, p.response || '', p.evidenceTag || ''].join(' ');
        const matched = opts.match.some(m => caseInsensitiveContains(haystack, m));
        if (!matched) continue;
      }
      hits.push({
        source: 'prior_portal_responses',
        id: p.id,
        summary: summariseRequest({
          question: p.question,
          response: p.response,
          respondedAt: p.respondedAt,
        }),
        receivedAt: p.respondedAt,
        extra: { evidenceTag: p.evidenceTag },
      });
    }
  }

  // ─── 3. Pipeline state (this run's earlier steps) ───────────────────────
  if (opts.sources.includes('pipeline_state') && ctx?.pipelineState && ctx?.stepIndex !== undefined) {
    for (let i = 0; i < ctx.stepIndex; i++) {
      const step = ctx.pipelineState[i];
      if (!step) continue;
      // We treat any earlier step that produced a `documents` array,
      // a `data_table`, or an `extracted_evidence` table as relevant.
      const candidate =
        Array.isArray((step as any).documents) ? (step as any).documents :
        Array.isArray((step as any).extracted_evidence) ? (step as any).extracted_evidence :
        Array.isArray((step as any).data_table) ? (step as any).data_table :
        null;
      if (!candidate || candidate.length === 0) continue;
      hits.push({
        source: 'pipeline_state',
        id: `step_${i}`,
        summary: `Earlier step ${i + 1} produced ${candidate.length} item(s) of evidence`,
        extra: { stepIndex: i, count: candidate.length },
      });
    }
  }

  return {
    enabled: true,
    hits,
    summary: hits.length === 0
      ? `Checked ${opts.sources.join(', ')} (last ${window} days) — nothing already on file. Sending the full request.`
      : `Found ${hits.length} item(s) already on file across ${opts.sources.join(', ')} (last ${window} days). The portal request will only ask the client for what we don't already have.`,
  };
}

/**
 * Convenience: declarative input-schema fragment that every
 * client-request action attaches to its inputSchema. Centralising
 * this means adding a new dedup source / changing defaults only
 * touches one place.
 */
export const DEDUP_INPUT_FIELDS: InputFieldDef[] = [
  {
    code: 'dedup_enabled',
    label: 'Check Existing Evidence First',
    type: 'boolean',
    required: false,
    source: 'user',
    defaultValue: true,
    group: 'Deduplication',
    description: 'Before sending the portal request, look for matching evidence we already have on file. Anything found is added to `already_have` on the output and removed from the ask, so we don\'t pester the client for things they\'ve previously supplied.',
  },
  {
    code: 'dedup_sources',
    label: 'Where to Check',
    type: 'multiselect',
    required: false,
    source: 'user',
    defaultValue: ['existing_documents', 'prior_portal_responses', 'pipeline_state'],
    group: 'Deduplication',
    options: [
      { value: 'existing_documents',     label: 'Engagement\'s document library (uploaded files)' },
      { value: 'prior_portal_responses', label: 'Prior portal responses on this engagement' },
      { value: 'pipeline_state',         label: 'Earlier steps in this pipeline run' },
    ],
  },
  {
    code: 'dedup_window_days',
    label: 'Recency Window (days)',
    type: 'number',
    required: false,
    source: 'user',
    defaultValue: 365,
    group: 'Deduplication',
    description: 'Only count an existing item if we received it within the last N days. Stops a stale prior-year document from satisfying a current-period request.',
  },
];

/**
 * Convenience: declarative output-schema fragment exposing the
 * dedup result on every request_* action so downstream steps can
 * reference `$prev.already_have` regardless of which request action
 * was the previous step.
 */
export const DEDUP_OUTPUT_FIELDS: OutputFieldDef[] = [
  {
    code: 'already_have',
    label: 'Items Already On File',
    type: 'data_table',
    description: 'Per-item rows: source, id, summary, document_type, received_at. These came from the dedup pre-check and were not asked of the client again.',
  },
  {
    code: 'originally_requested_count',
    label: 'Originally Requested',
    type: 'number',
    description: 'Number of items the action would have asked for if dedup were off.',
  },
  {
    code: 'dedup_summary',
    label: 'Dedup Summary',
    type: 'text',
  },
];

/** Coerce the raw input bindings into the typed DedupOptions shape. */
export function readDedupOptions(
  inputs: Record<string, any>,
  base: { engagementId: string; documentType?: string | null; areaOfWork?: string | null; match?: string[] },
): DedupOptions {
  const enabled = inputs.dedup_enabled !== false; // default true
  const rawSources = inputs.dedup_sources;
  const sources: DedupSource[] = Array.isArray(rawSources)
    ? rawSources.filter((s: unknown): s is DedupSource =>
        s === 'existing_documents' || s === 'prior_portal_responses' || s === 'pipeline_state')
    : ['existing_documents', 'prior_portal_responses', 'pipeline_state'];
  const windowDays = Number(inputs.dedup_window_days) || DEFAULT_WINDOW_DAYS;
  return {
    enabled,
    sources,
    windowDays,
    engagementId: base.engagementId,
    documentType: base.documentType ?? null,
    areaOfWork: base.areaOfWork ?? null,
    match: base.match,
  };
}

export function dedupHitsToTable(result: DedupResult): Array<Record<string, unknown>> {
  return result.hits.map(h => ({
    source: h.source,
    id: h.id,
    summary: h.summary,
    document_type: h.documentType ?? null,
    received_at: h.receivedAt instanceof Date ? h.receivedAt.toISOString() : (h.receivedAt ?? null),
  }));
}
