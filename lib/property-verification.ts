/**
 * Property Verification helpers — used by the `verify_property_assets`
 * action handler to drive the multi-phase HMLR pipeline (portal request →
 * extract addresses → sample → per-property HMLR lookups → AI summary).
 *
 * The handler itself is a thin phase switch in lib/action-handlers.ts; all
 * the heavy lifting lives here so it's easier to test, extend, and reason
 * about independently of the pipeline engine.
 */

import { prisma } from '@/lib/db';
import { downloadBlob } from '@/lib/azure-blob';
import { extractDocumentText } from '@/lib/assurance-doc-processor';
import type { HmlrAddressQuery, HmlrCallContext, HmlrResult } from './hmlr-client';
import {
  getHmlrConnector,
  searchByDescription,
  verifyOwner,
  officialCopyTitleKnown,
  getRegisterExtract,
  getRestrictions,
  applicationEnquiry,
  formatAddress,
} from './hmlr-client';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ExtractedAddress extends HmlrAddressQuery {
  id: string; // stable UUID-ish id for selection
  raw: string; // original line the client supplied
}

export interface PropertyVerificationResult {
  id: string; // matches ExtractedAddress.id
  address: ExtractedAddress;
  titleNumber?: string;
  registeredProprietor?: string;
  hasRestriction?: boolean;
  applicationsOutstanding?: boolean;
  flags: string[];
  summary?: string;
  documents: Array<{
    id?: string;
    type: string; // 'register' | 'plan' | 'conveyance' | 'deed' | 'lease'
    path: string;
  }>;
  calls: Array<{
    apiName: string;
    ok: boolean;
    costGbp: number;
    error?: string;
  }>;
  totalCostGbp: number;
  valueGbp?: number;
}

// ─── Address extraction ─────────────────────────────────────────────────────

const UK_POSTCODE_RE = /\b([A-Z]{1,2}[0-9][A-Z0-9]?\s*[0-9][A-Z]{2})\b/i;

/**
 * Parse free-form text into one address per line, extracting postcode and
 * doing a best-effort split into PAON / street / town. This is intentionally
 * conservative — anything that does not look like an address is dropped.
 *
 * For higher-fidelity parsing (e.g. from a PDF of a property schedule),
 * callers should route the text through `lib/ai-extractor.ts` first and
 * feed the structured output into this function via the `raw` lines.
 */
export function parseAddressesFromText(text: string): ExtractedAddress[] {
  if (!text || typeof text !== 'string') return [];
  const lines = text
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length > 6);

  const out: ExtractedAddress[] = [];
  for (const line of lines) {
    // Split any commas in the line into tokens
    const parts = line.split(',').map(s => s.trim()).filter(Boolean);
    if (parts.length < 2) continue;

    const postcodeMatch = line.match(UK_POSTCODE_RE);
    const postcode = postcodeMatch ? postcodeMatch[1].toUpperCase() : undefined;

    // Strip postcode out of the parts so it does not appear as the town
    const cleanParts = parts
      .map(p => p.replace(UK_POSTCODE_RE, '').trim())
      .filter(Boolean);

    // Heuristic: if the first token starts with "Flat", "Apartment", "Unit", etc.,
    // treat it as SAON and the next token as PAON.
    let saon: string | undefined;
    let paon: string | undefined;
    let street: string | undefined;
    let town: string | undefined;
    let county: string | undefined;

    const isSaon = /^(flat|apartment|apt|unit|suite)\s+/i.test(cleanParts[0] || '');
    let cursor = 0;
    if (isSaon) {
      saon = cleanParts[cursor++];
    }
    paon = cleanParts[cursor++];
    street = cleanParts[cursor++];
    town = cleanParts[cursor++];
    if (cursor < cleanParts.length) county = cleanParts[cursor];

    // If PAON actually contains just a number plus the street (e.g. "10 Ringers Road"),
    // split on the first space so PAON = number and street = rest.
    if (paon && !street) {
      const m = paon.match(/^(\d+[a-z]?)\s+(.+)$/i);
      if (m) {
        paon = m[1];
        street = m[2];
      }
    }

    if (!paon && !street && !postcode) continue;

    out.push({
      id: cryptoRandom(),
      raw: line,
      saon,
      paon,
      street,
      town,
      county,
      postcode,
    });
  }
  return out;
}

function cryptoRandom(): string {
  // Lightweight id — good enough for in-memory list keys.
  return `addr_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

/**
 * Load a portal request and extract addresses from the client's response.
 *
 * Handles all response channels the client might use:
 *   1. Typed chat response (request.response)
 *   2. Follow-up chat history messages
 *   3. Uploaded files in any supported format:
 *      - PDF (text + scanned/OCR fallback)
 *      - Word (.docx via mammoth)
 *      - Excel (.xlsx via xlsx)
 *      - CSV / TXT / JSON / HTML (raw utf-8)
 *      - Images (PNG/JPEG/TIFF via vision model OCR)
 *
 * All extraction happens server-side via lib/assurance-doc-processor.ts so
 * the auditor never has to wait on the client and the browser never has to
 * parse binary files. Files are downloaded from Azure blob one at a time
 * (not bundled) so large uploads don't blow the memory budget.
 *
 * Extracted text from every source is concatenated and passed through
 * `parseAddressesFromText` to produce the final ExtractedAddress[] list.
 */
export async function extractAddressesFromPortalResponse(
  portalRequestId: string,
): Promise<ExtractedAddress[]> {
  const request = await prisma.portalRequest.findUnique({
    where: { id: portalRequestId },
    include: { uploads: true },
  });
  if (!request) return [];

  const textBlobs: string[] = [];

  // 1. Typed response text.
  if (request.response) textBlobs.push(request.response);

  // 2. Chat history — clients sometimes reply across multiple messages.
  if (Array.isArray(request.chatHistory)) {
    for (const msg of request.chatHistory as any[]) {
      if (msg && typeof msg.message === 'string' && msg.from === 'client') {
        textBlobs.push(msg.message);
      }
    }
  }

  // 3. Uploaded files — download each individually and run through the
  //    assurance-doc-processor extractor, which handles PDF text, PDF OCR
  //    fallback, image OCR, Excel, Word, CSV, and raw text.
  for (const upload of request.uploads || []) {
    try {
      const buffer = await downloadBlob(upload.storagePath, upload.containerName);
      const mimeType = upload.mimeType || guessMimeFromName(upload.originalName);
      const { text, method } = await extractDocumentText(buffer, mimeType, upload.originalName);
      if (text) {
        textBlobs.push(`\n--- Upload: ${upload.originalName} (${method}) ---\n${text}`);
      }
    } catch (err) {
      console.error(`[property-verification] Failed to extract "${upload.originalName}":`, err);
      // Non-fatal — keep going with the other uploads and the typed text.
    }
  }

  const allText = textBlobs.join('\n');
  return parseAddressesFromText(allText);
}

function guessMimeFromName(name: string): string {
  const lower = (name || '').toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (lower.endsWith('.doc')) return 'application/msword';
  if (lower.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (lower.endsWith('.xls')) return 'application/vnd.ms-excel';
  if (lower.endsWith('.csv')) return 'text/csv';
  if (lower.endsWith('.txt')) return 'text/plain';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.tiff') || lower.endsWith('.tif')) return 'image/tiff';
  return 'application/octet-stream';
}

// ─── Per-property HMLR pipeline ─────────────────────────────────────────────

/**
 * Data groups the auditor can tick per run. Each group maps to a subset of
 * HMLR Business Gateway API calls. Running with a subset of groups only
 * incurs the cost of that subset's APIs — and on a re-run the pipeline
 * skips any (titleNumber, apiName) pair it has already fetched, so the
 * delta cost of adding a new group is exactly the new APIs.
 *
 * Groups are orthogonal. "ownership" and "purchase" both need the title
 * number, so the first one fetched performs the search-by-description and
 * subsequent runs reuse the cached title. Title lookup is a shared
 * prerequisite, not billed against any one group.
 */
export type DataGroup = 'ownership' | 'purchase' | 'restrictions';

export const DATA_GROUPS: DataGroup[] = ['ownership', 'purchase', 'restrictions'];

/**
 * Maps each data group to the set of HMLR API names it needs. Used to drive
 * "what needs fetching" decisions in runHmlrPipelineForProperty. The title
 * lookup (search_by_description) is always run first regardless of group,
 * so it's not listed here.
 *
 * IMPORTANT: Each API listed is one individual HTTP call at runtime — the
 * code below loops through them sequentially rather than bundling.
 */
const GROUP_APIS: Record<DataGroup, string[]> = {
  ownership: [
    'owner_verification',
    'official_copy_title',
    'register_extract_register',
    'register_extract_plan',
    'application_enquiry',
  ],
  purchase: [
    'register_extract_conveyance',
    'register_extract_deed',
    // Price paid history could also plug in here once the paid endpoint is
    // wired up; for now the conveyance + deed extracts carry the transfer
    // detail on most titles.
  ],
  restrictions: [
    // Note: getRestrictions() internally decides whether to parse the
    // already-fetched register extract (free) or call a dedicated paid
    // restrictions endpoint, based on options.restrictionStrategy.
    'restrictions',
  ],
};

export interface RunOptions {
  dataGroups: DataGroup[];
  restrictionStrategy: 'register_summary' | 'dedicated_search';
}

/**
 * Run the HMLR pipeline for a single property, incrementally.
 *
 * If `previous` is supplied, we start from that result and only fetch APIs
 * for the groups whose API names are NOT already in previous.calls. This is
 * how a re-run with extra data groups only costs the delta — already-cached
 * calls are reused verbatim.
 *
 * Short-circuits after the title lookup if the address does not resolve,
 * so we don't burn fees downstream on an unknown property.
 */
export async function runHmlrPipelineForProperty(
  address: ExtractedAddress,
  options: RunOptions,
  ctx: HmlrCallContext,
  previous?: PropertyVerificationResult,
): Promise<PropertyVerificationResult> {
  const connector = await getHmlrConnector();

  // Start from previous result if given (incremental re-run) or fresh.
  const result: PropertyVerificationResult = previous
    ? {
        ...previous,
        flags: [...previous.flags],
        documents: [...previous.documents],
        calls: [...previous.calls],
      }
    : {
        id: address.id,
        address,
        flags: [],
        documents: [],
        calls: [],
        totalCostGbp: 0,
      };

  const alreadyCalled = (apiName: string) =>
    result.calls.some(c => c.apiName === apiName && c.ok);

  const recordCall = (r: HmlrResult) => {
    result.calls.push({ apiName: r.apiName, ok: r.ok, costGbp: r.costGbp, error: r.errorMessage });
    result.totalCostGbp += r.costGbp;
    if (!r.ok && r.errorMessage) result.flags.push(`${r.apiName}: ${r.errorMessage}`);
  };

  // ── Prerequisite: title number ────────────────────────────────────────
  // Always needed and always free across re-runs because the title is
  // cached on the result once looked up.
  if (!result.titleNumber) {
    const search = await searchByDescription(connector, address, ctx);
    recordCall(search);
    if (!search.ok || !search.titleNumber) {
      if (!result.flags.includes('Title not found at HM Land Registry')) {
        result.flags.push('Title not found at HM Land Registry');
      }
      return result;
    }
    result.titleNumber = search.titleNumber;
  }
  const titleNumber = result.titleNumber;

  // Collect the full set of APIs the requested groups need, deduped.
  const needed = new Set<string>();
  for (const g of options.dataGroups) {
    for (const api of GROUP_APIS[g]) needed.add(api);
  }

  // ── Ownership group ───────────────────────────────────────────────────
  if (needed.has('owner_verification') && !alreadyCalled('owner_verification')) {
    const owner = await verifyOwner(connector, titleNumber, address, ctx);
    recordCall(owner);
    const prop = extractProprietorFromParsed(owner.parsedData);
    if (prop) result.registeredProprietor = prop;
  }
  if (needed.has('official_copy_title') && !alreadyCalled('official_copy_title')) {
    const oct = await officialCopyTitleKnown(connector, titleNumber, address, ctx);
    recordCall(oct);
  }

  // Register Extract documents — one API call per document type. Runs in
  // any group that includes the corresponding api name. Documents are
  // uploaded to blob + registered as AuditDocument rows inside
  // getRegisterExtract, so we don't need to handle files here.
  //
  // IMPORTANT (per user requirement): each document type is a separate
  // HTTP call so large responses don't bundle together and blow out memory.
  const docTypes: Array<'register' | 'plan' | 'conveyance' | 'deed' | 'lease'> = [
    'register', 'plan', 'conveyance', 'deed', 'lease',
  ];
  let registerText: string | undefined;
  for (const docType of docTypes) {
    const apiName = `register_extract_${docType}`;
    if (!needed.has(apiName)) continue;
    if (alreadyCalled(apiName)) continue;
    const extract = await getRegisterExtract(connector, titleNumber, address, docType, ctx);
    recordCall(extract);
    if (extract.ok && extract.documentPath) {
      result.documents.push({
        id: extract.documentId,
        type: docType,
        path: extract.documentPath,
      });
    }
    if (docType === 'register' && extract.parsedData?.text) {
      registerText = extract.parsedData.text;
    }
  }

  // ── Application Enquiry (ownership group) ─────────────────────────────
  if (needed.has('application_enquiry') && !alreadyCalled('application_enquiry')) {
    const apps = await applicationEnquiry(connector, titleNumber, address, ctx);
    recordCall(apps);
    const count = apps.parsedData?.outstandingCount ?? apps.parsedData?.applications?.length ?? 0;
    result.applicationsOutstanding = count > 0;
    if (result.applicationsOutstanding) {
      result.flags.push(`${count} uncompleted application(s) registered against the title at the time of search`);
    }
  }

  // ── Restrictions group ────────────────────────────────────────────────
  if (needed.has('restrictions') && !alreadyCalled('restrictions')) {
    // If we already pulled the register extract (e.g. on an earlier run),
    // use that text for the free parse path. Otherwise getRestrictions
    // handles the dedicated paid endpoint.
    const restrictions = await getRestrictions(
      connector,
      titleNumber,
      address,
      registerText,
      options.restrictionStrategy === 'dedicated_search',
      ctx,
    );
    recordCall(restrictions);
    result.hasRestriction = !!restrictions.parsedData?.hasRestriction;
    if (result.hasRestriction) {
      result.flags.push(`Restriction(s) noted on register${restrictions.parsedData?.excerpt ? `: ${restrictions.parsedData.excerpt.slice(0, 120)}` : ''}`);
    }
  }

  return result;
}

function extractProprietorFromParsed(parsed: any): string | undefined {
  if (!parsed) return undefined;
  if (typeof parsed.registeredProprietor === 'string') return parsed.registeredProprietor;
  if (Array.isArray(parsed.proprietors)) return parsed.proprietors.join(', ');
  if (typeof parsed.owner === 'string') return parsed.owner;
  return undefined;
}

// ─── AI summary ─────────────────────────────────────────────────────────────

/**
 * Produce a concise per-property summary suitable for the Test Execution
 * view. Uses Together AI (same provider used by the AI Analysis action) so
 * no new dependency is added. Falls back to a deterministic summary if the
 * AI call fails — we'd rather show *something* than fail the whole action.
 */
export async function summariseProperty(
  result: PropertyVerificationResult,
  clientName: string,
  periodEnd?: Date | string,
): Promise<string> {
  const facts = [
    `Address: ${formatAddress(result.address)}`,
    result.titleNumber ? `Title number: ${result.titleNumber}` : 'Title number: not found',
    result.registeredProprietor ? `Registered proprietor: ${result.registeredProprietor}` : 'Registered proprietor: unknown',
    result.hasRestriction ? 'Restriction(s) noted on the register' : 'No restrictions noted',
    result.applicationsOutstanding ? 'Outstanding applications against the title' : 'No outstanding applications',
    `Documents retrieved: ${result.documents.map(d => d.type).join(', ') || 'none'}`,
    `HMLR spend: £${result.totalCostGbp.toFixed(2)}`,
  ].join('\n');

  try {
    const OpenAI = (await import('openai')).default;
    const apiKey = process.env.TOGETHER_API_KEY;
    if (!apiKey) return buildFallbackSummary(result, clientName);

    const client = new OpenAI({
      apiKey,
      baseURL: 'https://api.together.xyz/v1',
    });
    const response = await client.chat.completions.create({
      model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
      max_tokens: 400,
      temperature: 0.1,
      messages: [
        {
          role: 'system',
          content: 'You are a UK statutory auditor summarising HM Land Registry data about a property held by an audit client. Produce a 2-3 paragraph plain-English summary aimed at the audit review. Call out any exceptions, restrictions, or proprietor mismatches. Do not speculate beyond the facts supplied.',
        },
        {
          role: 'user',
          content: `Client: ${clientName}${periodEnd ? `\nPeriod end: ${new Date(periodEnd).toISOString().slice(0, 10)}` : ''}\n\nFacts from HM Land Registry:\n${facts}`,
        },
      ],
    });
    const summary = response.choices[0]?.message?.content?.trim();
    return summary || buildFallbackSummary(result, clientName);
  } catch (err) {
    console.error('[property-verification] AI summary failed:', err);
    return buildFallbackSummary(result, clientName);
  }
}

function buildFallbackSummary(result: PropertyVerificationResult, clientName: string): string {
  const address = formatAddress(result.address);
  const owner = result.registeredProprietor || 'not disclosed';
  const parts = [
    `HM Land Registry search for ${address} ${result.titleNumber ? `returned title number ${result.titleNumber}` : 'did not return a title number'}.`,
    `The registered proprietor is ${owner}.`,
  ];
  if (result.hasRestriction) parts.push('One or more restrictions are noted on the register and should be reviewed.');
  if (result.applicationsOutstanding) parts.push('There are uncompleted applications registered against the title at the time of search.');
  parts.push(`${result.documents.length} title document(s) retrieved. Cross-check the proprietor against ${clientName}'s fixed-asset register.`);
  return parts.join(' ');
}

// ─── Convenience: run + summarise a batch ──────────────────────────────────

/**
 * Run the HMLR pipeline for a batch of addresses.
 *
 * `previous` is an optional map of address.id → previous result. If
 * supplied, each property is re-run incrementally against its previous
 * state and only the APIs needed for data groups that weren't already
 * fetched are called. This is how adding a new data group to an
 * already-tested batch only costs the delta.
 */
export async function runBatch(
  addresses: ExtractedAddress[],
  options: RunOptions,
  ctx: HmlrCallContext,
  clientName: string,
  periodEnd?: Date | string,
  previous?: Record<string, PropertyVerificationResult>,
): Promise<PropertyVerificationResult[]> {
  const results: PropertyVerificationResult[] = [];
  for (const addr of addresses) {
    const prev = previous?.[addr.id];
    const r = await runHmlrPipelineForProperty(addr, options, ctx, prev);
    r.summary = await summariseProperty(r, clientName, periodEnd);
    results.push(r);
  }
  return results;
}
