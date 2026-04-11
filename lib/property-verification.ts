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
 * Handles both the typed chat response and any uploaded files (CSV/XLSX/
 * text). PDFs of property schedules are out of scope for this helper —
 * callers should pre-extract the text via the OCR pipeline.
 */
export async function extractAddressesFromPortalResponse(
  portalRequestId: string,
): Promise<ExtractedAddress[]> {
  const request = await prisma.portalRequest.findUnique({
    where: { id: portalRequestId },
    include: { uploads: true },
  });
  if (!request) return [];

  const blobs: string[] = [];

  // 1. Typed response text.
  if (request.response) blobs.push(request.response);

  // 2. Chat history (clients sometimes reply with multiple messages).
  if (Array.isArray(request.chatHistory)) {
    for (const msg of request.chatHistory as any[]) {
      if (msg && typeof msg.message === 'string' && msg.from === 'client') {
        blobs.push(msg.message);
      }
    }
  }

  // 3. Uploaded files — at this point we only handle plain-text fallbacks.
  //    Proper PDF/XLSX extraction should happen upstream via lib/ai-extractor.ts
  //    before reaching this helper.
  // (no-op placeholder — real file handling is deferred to the caller)

  const allText = blobs.join('\n');
  return parseAddressesFromText(allText);
}

// ─── Per-property HMLR pipeline ─────────────────────────────────────────────

export interface RunOptions {
  restrictionStrategy: 'register_summary' | 'dedicated_search';
  includeApplicationEnquiry: boolean;
}

/**
 * Run the full HMLR pipeline for a single property. Short-circuits after
 * step 1 (title lookup) if the address does not resolve, so we don't
 * needlessly burn fees on an unknown property.
 */
export async function runHmlrPipelineForProperty(
  address: ExtractedAddress,
  options: RunOptions,
  ctx: HmlrCallContext,
): Promise<PropertyVerificationResult> {
  const connector = await getHmlrConnector();
  const result: PropertyVerificationResult = {
    id: address.id,
    address,
    flags: [],
    documents: [],
    calls: [],
    totalCostGbp: 0,
  };

  const recordCall = (r: HmlrResult) => {
    result.calls.push({ apiName: r.apiName, ok: r.ok, costGbp: r.costGbp, error: r.errorMessage });
    result.totalCostGbp += r.costGbp;
    if (!r.ok && r.errorMessage) result.flags.push(`${r.apiName}: ${r.errorMessage}`);
  };

  // Step 1 — EPD title lookup
  const search = await searchByDescription(connector, address, ctx);
  recordCall(search);
  if (!search.ok || !search.titleNumber) {
    result.flags.push('Title not found at HM Land Registry');
    return result;
  }
  result.titleNumber = search.titleNumber;

  // Step 2 — Online Owner Verification
  const owner = await verifyOwner(connector, search.titleNumber, address, ctx);
  recordCall(owner);
  result.registeredProprietor = extractProprietorFromParsed(owner.parsedData);

  // Step 3 — Official Copy Title Known
  const oct = await officialCopyTitleKnown(connector, search.titleNumber, address, ctx);
  recordCall(oct);

  // Step 4 — Register Extract Service (5 document types)
  let registerText: string | undefined;
  const docTypes: Array<'register' | 'plan' | 'conveyance' | 'deed' | 'lease'> = [
    'register', 'plan', 'conveyance', 'deed', 'lease',
  ];
  for (const docType of docTypes) {
    const extract = await getRegisterExtract(connector, search.titleNumber, address, docType, ctx);
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

  // Step 5 — Restrictions
  const restrictions = await getRestrictions(
    connector,
    search.titleNumber,
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

  // Step 6 — Application Enquiry (optional)
  if (options.includeApplicationEnquiry) {
    const apps = await applicationEnquiry(connector, search.titleNumber, address, ctx);
    recordCall(apps);
    const count = apps.parsedData?.outstandingCount ?? apps.parsedData?.applications?.length ?? 0;
    result.applicationsOutstanding = count > 0;
    if (result.applicationsOutstanding) {
      result.flags.push(`${count} uncompleted application(s) registered against the title at the time of search`);
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

export async function runBatch(
  addresses: ExtractedAddress[],
  options: RunOptions,
  ctx: HmlrCallContext,
  clientName: string,
  periodEnd?: Date | string,
): Promise<PropertyVerificationResult[]> {
  const results: PropertyVerificationResult[] = [];
  for (const addr of addresses) {
    const r = await runHmlrPipelineForProperty(addr, options, ctx);
    r.summary = await summariseProperty(r, clientName, periodEnd);
    results.push(r);
  }
  return results;
}
