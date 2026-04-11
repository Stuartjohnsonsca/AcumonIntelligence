/**
 * HM Land Registry — Business Gateway API client.
 *
 * Wraps the paid HMLR APIs used by the Verify UK Property Assets audit action:
 *   1. Search by Property Description (→ title number)
 *   2. Online Owner Verification
 *   3. Official Copy Title Known
 *   4. Register Extract Service (register, plan, conveyance, deed, lease)
 *   5. Restrictions (parsed from register, or optional dedicated lookup)
 *   6. Application Enquiry (pending transactions)
 *
 * Credentials are held by Super Admin in a single `aggregator_connector` row
 * shared across all firms. Every billable call is written to
 * `land_registry_costs` in GBP. Returned PDFs are stored in the
 * `land-registry` blob container and registered as `AuditDocument` rows so
 * they appear in the client's engagement document library.
 *
 * While the HMLR Business Gateway is the production target, this module is
 * designed to degrade gracefully in sandbox environments: if credentials are
 * not configured or the base URL is missing, the calls return a
 * `{ ok: false, errorMessage: 'not_configured' }` stub rather than throwing,
 * and the cost row is still written (as status='failed', cost=0) so the
 * audit trail is complete.
 */

import { prisma } from '@/lib/db';
import { uploadToContainer } from '@/lib/azure-blob';

// ─── Published fees (GBP) ───────────────────────────────────────────────────
// These are placeholder values close to HMLR's published fees and can be
// tuned by Super Admin once real invoices land. They exist as a single
// source of truth so the cost ledger stays consistent with what's charged.

export const HMLR_FEES_GBP: Record<string, number> = {
  search_by_description: 3,
  owner_verification: 4,
  official_copy_title: 3,
  register_extract_register: 3,
  register_extract_plan: 3,
  register_extract_conveyance: 7,
  register_extract_deed: 7,
  register_extract_lease: 7,
  restrictions: 3,
  application_enquiry: 3,
};

export const LAND_REGISTRY_CONTAINER = 'land-registry';

// HMLR Business Gateway uses a real production endpoint with a "dummy data"
// account for test firms (not a separate sandbox URL). Production firms hit
// the same URL but with live credentials. The Business Gateway transport is
// SOAP/XML, not JSON — we build XML envelopes by hand for the requests whose
// schemas are known. See lib/hmlr-client.ts test fixtures (HMLR_TEST_ADDRESSES)
// for the specific test properties supplied with the dummy-data account.

export const HMLR_BASE_URL_DEFAULT = 'https://business-gateway.landregistry.gov.uk';

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * Free-form address as captured from the client portal or uploaded file.
 * Uses PAON/SAON terminology (Primary/Secondary Addressable Object Name)
 * which is how UK postal addresses are typically described.
 */
export interface HmlrAddressQuery {
  paon?: string;   // Primary addressable object (street number or house name)
  saon?: string;   // Secondary addressable object (flat/unit number)
  street?: string;
  town?: string;
  postcode?: string;
  county?: string;
}

/**
 * HMLR EPD (Enquiry by Property Description) address shape, following the
 * Business Gateway "Best Practice" guide. The mapping is counter-intuitive:
 *   - BuildingName   = the street-level building identifier (e.g. "157",
 *                      "Jarrett House", "10"). House names are dropped when
 *                      a number is also present.
 *   - BuildingNumber = the sub-unit identifier, e.g. the flat number ("18",
 *                      "A", "91"). Despite the name, HMLR uses this field
 *                      for flat/apartment numbers, NOT for the street number.
 */
export interface EpdAddress {
  buildingName?: string;
  buildingNumber?: string;
  streetName?: string;
  cityName?: string;
  postcode?: string;
}

/**
 * Test fixtures taken verbatim from the HMLR EPD Best Practice guide.
 * These match properties on the dummy-data account and are the recommended
 * way to verify the Business Gateway connection.
 */
export const HMLR_TEST_ADDRESSES: Array<{ label: string; input: HmlrAddressQuery; expected: EpdAddress }> = [
  {
    label: 'Flat 18, 157 Sandgate Road, Folkestone, Kent, CT20 2DA',
    input: { saon: 'Flat 18', paon: '157', street: 'Sandgate Road', town: 'Folkestone', county: 'Kent', postcode: 'CT20 2DA' },
    expected: { buildingName: '157', buildingNumber: '18', streetName: 'Sandgate Road', cityName: 'Folkestone', postcode: 'CT20 2DA' },
  },
  {
    label: 'Flat 2, 50 Fore Street, St. Columb, Cornwall, TR9 6AL',
    input: { saon: 'Flat 2', paon: '50', street: 'Fore Street', town: 'St. Columb', county: 'Cornwall', postcode: 'TR9 6AL' },
    expected: { buildingName: '50', buildingNumber: '2', streetName: 'Fore Street', cityName: 'St. Columb', postcode: 'TR9 6AL' },
  },
  {
    label: 'Flat A, 48 Chesson Road, London, W14 9QX',
    input: { saon: 'Flat A', paon: '48', street: 'Chesson Road', town: 'London', postcode: 'W14 9QX' },
    expected: { buildingName: '48', buildingNumber: 'A', streetName: 'Chesson Road', cityName: 'London', postcode: 'W14 9QX' },
  },
  {
    label: 'Flat 2, Harestone Court, 10 Ringers Road, Bromley',
    input: { saon: 'Flat 2', paon: 'Harestone Court, 10', street: 'Ringers Road', town: 'Bromley' },
    expected: { buildingName: '10', buildingNumber: '2', streetName: 'Ringers Road', cityName: 'Bromley' },
  },
  {
    label: 'Flat 8, 14 Whitworth Street, Lancashire, Manchester',
    input: { saon: 'Flat 8', paon: '14', street: 'Whitworth Street', town: 'Manchester', county: 'Lancashire' },
    expected: { buildingName: '14', buildingNumber: '8', streetName: 'Whitworth Street', cityName: 'Manchester' },
  },
  {
    label: 'Flat 17, 70b Hampton Road, Teddington',
    input: { saon: 'Flat 17', paon: '70b', street: 'Hampton Road', town: 'Teddington' },
    expected: { buildingName: '70b', buildingNumber: '17', streetName: 'Hampton Road', cityName: 'Teddington' },
  },
  {
    label: 'Flat 17, 70b Courtyard Apartments, Hampton Road, Teddington',
    input: { saon: 'Flat 17', paon: '70b Courtyard Apartments', street: 'Hampton Road', town: 'Teddington' },
    expected: { buildingName: '70b Courtyard Apartments', buildingNumber: '17', streetName: 'Hampton Road', cityName: 'Teddington' },
  },
  {
    label: 'Apartment 91, 39 City Road East, Manchester, Lancashire',
    input: { saon: 'Apartment 91', paon: '39', street: 'City Road East', town: 'Manchester', county: 'Lancashire' },
    expected: { buildingName: '39', buildingNumber: '91', streetName: 'City Road East', cityName: 'Manchester' },
  },
  {
    label: 'Flat 5, 120 Widmore Road, Bromley, Greater London',
    input: { saon: 'Flat 5', paon: '120', street: 'Widmore Road', town: 'Bromley', county: 'Greater London' },
    expected: { buildingName: '120', buildingNumber: '5', streetName: 'Widmore Road', cityName: 'Bromley' },
  },
  {
    label: 'Flat 1811, Ontario Tower, 4 Fairmont Avenue, London',
    input: { saon: 'Flat 1811', paon: 'Ontario Tower, 4', street: 'Fairmont Avenue', town: 'London' },
    expected: { buildingName: '4', buildingNumber: '1811', streetName: 'Fairmont Avenue', cityName: 'London' },
  },
];

/**
 * Transform a free-form address into HMLR EPD field mapping per the
 * Business Gateway "Best Practice" guide.
 *
 * Rules (from the guide):
 *  - The sub-unit identifier (flat/apartment number) goes in BuildingNumber.
 *  - The street-level identifier goes in BuildingName.
 *  - When a PAON contains both a house name and a number (e.g.
 *    "Harestone Court, 10" or "Ontario Tower, 4"), the NUMBER wins —
 *    the name is dropped and only the number goes in BuildingName.
 *  - Exception: when PAON has a name plus a suffix-letter number
 *    (e.g. "70b Courtyard Apartments"), the full PAON is kept as-is
 *    because the number and name are interleaved.
 *  - When the address has no number at all (pure house name), the house
 *    name goes in BuildingName.
 */
export function toEpdAddress(q: HmlrAddressQuery): EpdAddress {
  const out: EpdAddress = {};

  // Extract the sub-unit number from SAON ("Flat 18" → "18", "Apartment 91" → "91")
  if (q.saon) {
    const match = q.saon.match(/(?:flat|apartment|apt|unit)\s+([a-z0-9]+)/i);
    out.buildingNumber = match ? match[1] : q.saon.replace(/^(flat|apartment|apt|unit)\s+/i, '').trim() || q.saon.trim();
  }

  // Derive BuildingName from PAON
  if (q.paon) {
    const paon = q.paon.trim();
    // Look for a comma-separated number at the end: "Harestone Court, 10" → "10"
    const commaSplit = paon.split(',').map(s => s.trim()).filter(Boolean);
    const lastPart = commaSplit[commaSplit.length - 1];
    const lastIsPureNumber = /^[0-9]+[a-z]?$/i.test(lastPart);

    if (commaSplit.length > 1 && lastIsPureNumber) {
      // Name-and-number form: drop the name per best practice.
      out.buildingName = lastPart;
    } else {
      // Otherwise keep the PAON as-is (covers pure numbers like "157",
      // pure names like "Jarrett House", and interleaved forms like
      // "70b Courtyard Apartments").
      out.buildingName = paon;
    }
  }

  if (q.street) out.streetName = q.street;
  if (q.town) out.cityName = q.town;
  if (q.postcode) out.postcode = q.postcode;

  return out;
}

function xmlEscape(s: string | undefined): string {
  if (!s) return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Build the SOAP XML envelope for an EPD (Enquiry by Property Description)
 * request following the namespace structure shown in the HMLR Best Practice
 * guide. The guide only documents the `<sear:Address>` fragment — the outer
 * envelope is a best-effort representation of the published schema and
 * should be validated against HMLR's WSDL before go-live.
 */
export function buildEpdRequestXml(address: EpdAddress): string {
  const postcodeBlock = address.postcode
    ? `<sear:PostcodeZone><sear:Postcode>${xmlEscape(address.postcode)}</sear:Postcode></sear:PostcodeZone>`
    : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:sear="http://landregistry.gov.uk/service/search">
  <soap:Body>
    <sear:Enquiry>
      <sear:SubjectProperty>
        <sear:Address>
          ${address.buildingName ? `<sear:BuildingName>${xmlEscape(address.buildingName)}</sear:BuildingName>` : ''}
          ${address.buildingNumber ? `<sear:BuildingNumber>${xmlEscape(address.buildingNumber)}</sear:BuildingNumber>` : ''}
          ${address.streetName ? `<sear:StreetName>${xmlEscape(address.streetName)}</sear:StreetName>` : ''}
          ${address.cityName ? `<sear:CityName>${xmlEscape(address.cityName)}</sear:CityName>` : ''}
          ${postcodeBlock}
        </sear:Address>
      </sear:SubjectProperty>
    </sear:Enquiry>
  </soap:Body>
</soap:Envelope>`;
}

export interface HmlrCallContext {
  firmId: string;
  clientId: string;
  engagementId?: string;
  executionId?: string;
  userId: string;
}

export interface HmlrResult {
  ok: boolean;
  apiName: string;
  costGbp: number;
  titleNumber?: string;
  documentPath?: string; // Azure blob path
  documentId?: string; // AuditDocument.id if registered
  parsedData?: any;
  errorMessage?: string;
}

interface HmlrConnector {
  clientId: string;
  clientSecret: string;
  environment: 'test' | 'live';
  baseUrl: string;
}

// ─── Connector loading ──────────────────────────────────────────────────────

/**
 * Load the shared HMLR Business Gateway connector row. The credentials are
 * scoped to a well-known global firm id so every firm shares the same
 * credentials (the HMLR account is platform-level).
 *
 * Returns null if the connector has not been configured yet.
 */
export async function getHmlrConnector(): Promise<HmlrConnector | null> {
  // Look for the connector in any firm — it's platform-level but stored in
  // whichever firm the Super Admin happened to be in when adding it.
  const record = await prisma.methodologyTemplate.findFirst({
    where: {
      templateType: 'aggregator_connector',
      auditType: 'hmlr_business_gateway',
    },
    orderBy: { updatedAt: 'desc' },
  });
  if (!record) return null;

  const items = typeof record.items === 'object' && record.items !== null
    ? (record.items as Record<string, unknown>)
    : {};
  const config = (items.config as Record<string, string>) || {};
  if (!config.clientId || !config.clientSecret) return null;

  return {
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    environment: (config.environment as 'test' | 'live') || 'test',
    baseUrl: config.baseUrl || 'https://business-gateway.landregistry.gov.uk',
  };
}

// ─── Cost logging ───────────────────────────────────────────────────────────

async function recordCost(
  ctx: HmlrCallContext,
  apiName: string,
  costGbp: number,
  extras: {
    status?: 'success' | 'failed' | 'cached';
    titleNumber?: string;
    propertyAddress?: string;
    documentType?: string;
    documentPath?: string;
    errorMessage?: string;
  } = {},
): Promise<void> {
  try {
    await prisma.landRegistryCost.create({
      data: {
        firmId: ctx.firmId,
        clientId: ctx.clientId,
        engagementId: ctx.engagementId || null,
        executionId: ctx.executionId || null,
        userId: ctx.userId,
        apiName,
        costGbp,
        status: extras.status || 'success',
        titleNumber: extras.titleNumber || null,
        propertyAddress: extras.propertyAddress || null,
        documentType: extras.documentType || null,
        documentPath: extras.documentPath || null,
        errorMessage: extras.errorMessage || null,
      },
    });
  } catch (err) {
    console.error('[hmlr] Failed to log cost:', err);
  }
}

// ─── PDF persistence ────────────────────────────────────────────────────────

async function storePdfAsAuditDocument(
  ctx: HmlrCallContext,
  buffer: Buffer,
  docType: string,
  address: string,
  titleNumber: string | undefined,
): Promise<{ path: string; documentId: string | null }> {
  const safeTitle = (titleNumber || 'unknown').replace(/[^a-zA-Z0-9-]/g, '_');
  const blobName = `${ctx.firmId}/${ctx.clientId}/${ctx.executionId || 'ad-hoc'}/${safeTitle}-${docType}-${Date.now()}.pdf`;
  await uploadToContainer(LAND_REGISTRY_CONTAINER, blobName, buffer, 'application/pdf');

  let documentId: string | null = null;
  if (ctx.engagementId) {
    try {
      const doc = await prisma.auditDocument.create({
        data: {
          engagementId: ctx.engagementId,
          documentName: `HMLR ${docType} — ${titleNumber || address}`,
          requestedFrom: 'HM Land Registry',
          requestedDate: new Date(),
          requestedById: ctx.userId,
          uploadedDate: new Date(),
          uploadedById: ctx.userId,
          storagePath: blobName,
          containerName: LAND_REGISTRY_CONTAINER,
          fileSize: buffer.length,
          mimeType: 'application/pdf',
          visibleToClient: false,
          receivedByName: 'HM Land Registry',
          receivedAt: new Date(),
          source: 'Third Party',
          documentType: `Land Registry — ${docType}`,
          utilisedTab: 'property_verification',
        },
      });
      documentId = doc.id;
    } catch (err) {
      console.error('[hmlr] Failed to create AuditDocument:', err);
    }
  }

  return { path: blobName, documentId };
}

// ─── HTTP helper ────────────────────────────────────────────────────────────

/**
 * Transport helper. Supports both SOAP/XML and JSON payloads — real HMLR
 * Business Gateway APIs are SOAP over HTTPS, but test harnesses or thin
 * adapters in front of the service may accept JSON, so both are supported
 * to keep the surface area flexible.
 */
async function callHmlr(
  connector: HmlrConnector,
  endpoint: string,
  body: string | Record<string, unknown>,
  format: 'soap' | 'json' = 'json',
  soapAction?: string,
): Promise<{ ok: boolean; status: number; data?: any; text?: string; buffer?: Buffer; contentType?: string; error?: string }> {
  try {
    const isSoap = format === 'soap';
    const headers: Record<string, string> = {
      'Accept': isSoap
        ? 'text/xml, application/soap+xml, application/pdf'
        : 'application/json, application/pdf',
      'X-HMLR-Environment': connector.environment,
      'Authorization': `Basic ${Buffer.from(`${connector.clientId}:${connector.clientSecret}`).toString('base64')}`,
    };
    if (isSoap) {
      headers['Content-Type'] = 'text/xml; charset=utf-8';
      if (soapAction) headers['SOAPAction'] = soapAction;
    } else {
      headers['Content-Type'] = 'application/json';
    }

    const res = await fetch(`${connector.baseUrl}${endpoint}`, {
      method: 'POST',
      headers,
      body: isSoap ? (body as string) : JSON.stringify(body),
    });

    const contentType = res.headers.get('content-type') || '';
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, status: res.status, error: text.slice(0, 500) || `HTTP ${res.status}` };
    }

    if (contentType.includes('application/pdf')) {
      const arrBuf = await res.arrayBuffer();
      return { ok: true, status: res.status, buffer: Buffer.from(arrBuf), contentType };
    }

    if (contentType.includes('xml') || isSoap) {
      const text = await res.text();
      return { ok: true, status: res.status, text, contentType };
    }

    const data = await res.json().catch(() => ({}));
    return { ok: true, status: res.status, data, contentType };
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : 'network error' };
  }
}

/**
 * Minimal SOAP-response title-number extractor. Looks for common element
 * names used by HMLR EPD responses and falls back to a generic match on
 * anything that looks like a HMLR title number (2-4 uppercase letters
 * followed by digits, e.g. "TGL12345" or "NGL987654").
 */
function extractTitleNumberFromXml(xml: string): string | undefined {
  if (!xml) return undefined;
  const tagMatch = xml.match(/<(?:sear:)?TitleNumber[^>]*>([^<]+)<\/(?:sear:)?TitleNumber>/i);
  if (tagMatch) return tagMatch[1].trim();
  const generic = xml.match(/\b([A-Z]{2,4}\d{4,})\b/);
  return generic ? generic[1] : undefined;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Step 1 — Enquiry by Property Description (EPD).
 *
 * Resolves a postal address to a title number. This is the API documented
 * in HMLR's "EPD Best Practice" guide and the only one where we know the
 * exact SOAP schema (namespace `sear:`, nested `SubjectProperty > Address`).
 *
 * The input address is first mapped to the EPD field layout via
 * `toEpdAddress()` — which implements the Best Practice quirk where the
 * flat/apartment number goes in BuildingNumber and the street-level
 * identifier goes in BuildingName.
 *
 * Short-circuits the rest of the property pipeline if no title is found.
 */
export async function searchByDescription(
  connector: HmlrConnector | null,
  address: HmlrAddressQuery,
  ctx: HmlrCallContext,
): Promise<HmlrResult> {
  const apiName = 'search_by_description';
  const fee = HMLR_FEES_GBP[apiName];
  const addrStr = formatAddress(address);

  if (!connector) {
    await recordCost(ctx, apiName, 0, { status: 'failed', propertyAddress: addrStr, errorMessage: 'HMLR connector not configured' });
    return { ok: false, apiName, costGbp: 0, errorMessage: 'HMLR Business Gateway credentials not configured' };
  }

  const epd = toEpdAddress(address);
  const xml = buildEpdRequestXml(epd);
  const resp = await callHmlr(
    connector,
    '/services/SearchService',
    xml,
    'soap',
    'http://landregistry.gov.uk/service/search/EnquiryByPropertyDescription',
  );

  if (!resp.ok) {
    await recordCost(ctx, apiName, 0, { status: 'failed', propertyAddress: addrStr, errorMessage: resp.error });
    return { ok: false, apiName, costGbp: 0, errorMessage: resp.error };
  }

  // Response is SOAP XML — extract the title number.
  const titleNumber = resp.text
    ? extractTitleNumberFromXml(resp.text)
    : (resp.data?.titleNumber || resp.data?.results?.[0]?.titleNumber);

  if (!titleNumber) {
    // Still a billable lookup even when nothing is returned.
    await recordCost(ctx, apiName, fee, { status: 'success', propertyAddress: addrStr });
    return {
      ok: false,
      apiName,
      costGbp: fee,
      errorMessage: 'No title found for this address',
      parsedData: { epd, responseExcerpt: (resp.text || '').slice(0, 500) },
    };
  }

  await recordCost(ctx, apiName, fee, { status: 'success', titleNumber, propertyAddress: addrStr });
  return {
    ok: true,
    apiName,
    costGbp: fee,
    titleNumber,
    parsedData: { epd, titleNumber, responseExcerpt: (resp.text || '').slice(0, 500) },
  };
}

/**
 * Run the built-in EPD test-fixture set against the configured HMLR
 * dummy-data account. Used by the Aggregator Connectors "Test" button
 * to verify the EPD mapping and the SOAP transport are working end-to-end.
 *
 * Returns one row per fixture with: label, expected mapping, actual mapping,
 * whether the mapping matched the Best Practice expectation, and the title
 * number returned by the dummy account (if any).
 */
export async function runEpdTestFixtures(
  connector: HmlrConnector,
  ctx: HmlrCallContext,
): Promise<Array<{ label: string; mappingOk: boolean; titleNumber?: string; error?: string }>> {
  const results: Array<{ label: string; mappingOk: boolean; titleNumber?: string; error?: string }> = [];
  for (const fixture of HMLR_TEST_ADDRESSES) {
    const mapped = toEpdAddress(fixture.input);
    const mappingOk =
      mapped.buildingName === fixture.expected.buildingName &&
      mapped.buildingNumber === fixture.expected.buildingNumber &&
      mapped.streetName === fixture.expected.streetName &&
      mapped.cityName === fixture.expected.cityName &&
      (mapped.postcode || undefined) === (fixture.expected.postcode || undefined);

    const res = await searchByDescription(connector, fixture.input, ctx);
    results.push({
      label: fixture.label,
      mappingOk,
      titleNumber: res.titleNumber,
      error: res.ok ? undefined : res.errorMessage,
    });
  }
  return results;
}

/**
 * Step 2 — Online Owner Verification. Returns the registered proprietor(s)
 * for a given title number.
 */
export async function verifyOwner(
  connector: HmlrConnector | null,
  titleNumber: string,
  address: HmlrAddressQuery,
  ctx: HmlrCallContext,
): Promise<HmlrResult> {
  const apiName = 'owner_verification';
  const fee = HMLR_FEES_GBP[apiName];
  const addrStr = formatAddress(address);

  if (!connector) {
    await recordCost(ctx, apiName, 0, { status: 'failed', titleNumber, propertyAddress: addrStr, errorMessage: 'HMLR connector not configured' });
    return { ok: false, apiName, costGbp: 0, titleNumber, errorMessage: 'HMLR Business Gateway credentials not configured' };
  }

  const resp = await callHmlr(connector, '/owner-verification', { titleNumber });
  if (!resp.ok) {
    await recordCost(ctx, apiName, 0, { status: 'failed', titleNumber, propertyAddress: addrStr, errorMessage: resp.error });
    return { ok: false, apiName, costGbp: 0, titleNumber, errorMessage: resp.error };
  }

  await recordCost(ctx, apiName, fee, { status: 'success', titleNumber, propertyAddress: addrStr });
  return { ok: true, apiName, costGbp: fee, titleNumber, parsedData: resp.data };
}

/**
 * Step 3 — Official Copy Title Known. Checks whether an official copy of
 * the ownership documents exists and is available.
 */
export async function officialCopyTitleKnown(
  connector: HmlrConnector | null,
  titleNumber: string,
  address: HmlrAddressQuery,
  ctx: HmlrCallContext,
): Promise<HmlrResult> {
  const apiName = 'official_copy_title';
  const fee = HMLR_FEES_GBP[apiName];
  const addrStr = formatAddress(address);

  if (!connector) {
    await recordCost(ctx, apiName, 0, { status: 'failed', titleNumber, propertyAddress: addrStr, errorMessage: 'HMLR connector not configured' });
    return { ok: false, apiName, costGbp: 0, titleNumber, errorMessage: 'HMLR Business Gateway credentials not configured' };
  }

  const resp = await callHmlr(connector, '/official-copy-title-known', { titleNumber });
  if (!resp.ok) {
    await recordCost(ctx, apiName, 0, { status: 'failed', titleNumber, propertyAddress: addrStr, errorMessage: resp.error });
    return { ok: false, apiName, costGbp: 0, titleNumber, errorMessage: resp.error };
  }

  await recordCost(ctx, apiName, fee, { status: 'success', titleNumber, propertyAddress: addrStr });
  return { ok: true, apiName, costGbp: fee, titleNumber, parsedData: resp.data };
}

/**
 * Step 4 — Register Extract Service. Separate calls for each document type.
 * `documentType` is one of: 'register' | 'plan' | 'conveyance' | 'deed' | 'lease'.
 */
export async function getRegisterExtract(
  connector: HmlrConnector | null,
  titleNumber: string,
  address: HmlrAddressQuery,
  documentType: 'register' | 'plan' | 'conveyance' | 'deed' | 'lease',
  ctx: HmlrCallContext,
): Promise<HmlrResult> {
  const apiName = `register_extract_${documentType}`;
  const fee = HMLR_FEES_GBP[apiName];
  const addrStr = formatAddress(address);

  if (!connector) {
    await recordCost(ctx, apiName, 0, { status: 'failed', titleNumber, propertyAddress: addrStr, errorMessage: 'HMLR connector not configured' });
    return { ok: false, apiName, costGbp: 0, titleNumber, errorMessage: 'HMLR Business Gateway credentials not configured' };
  }

  const resp = await callHmlr(connector, '/register-extract', { titleNumber, documentType });
  if (!resp.ok) {
    await recordCost(ctx, apiName, 0, { status: 'failed', titleNumber, propertyAddress: addrStr, documentType, errorMessage: resp.error });
    return { ok: false, apiName, costGbp: 0, titleNumber, errorMessage: resp.error };
  }

  // If a PDF was returned, store it.
  let documentPath: string | undefined;
  let documentId: string | null = null;
  if (resp.buffer) {
    const stored = await storePdfAsAuditDocument(ctx, resp.buffer, documentType, addrStr, titleNumber);
    documentPath = stored.path;
    documentId = stored.documentId;
  }

  await recordCost(ctx, apiName, fee, {
    status: 'success',
    titleNumber,
    propertyAddress: addrStr,
    documentType: 'pdf',
    documentPath,
  });

  return {
    ok: true,
    apiName,
    costGbp: fee,
    titleNumber,
    documentPath,
    documentId: documentId || undefined,
    parsedData: resp.data,
  };
}

/**
 * Step 5 — Restrictions lookup. HMLR does not publish a dedicated
 * restrictions endpoint; by default we parse them out of the register
 * extract that we already have and record a zero-cost row for traceability.
 * When `useDedicatedSearch` is true, we instead call a paid dedicated
 * restrictions search API (endpoint varies by HMLR contract).
 */
export async function getRestrictions(
  connector: HmlrConnector | null,
  titleNumber: string,
  address: HmlrAddressQuery,
  registerExtractText: string | undefined,
  useDedicatedSearch: boolean,
  ctx: HmlrCallContext,
): Promise<HmlrResult> {
  const apiName = 'restrictions';
  const addrStr = formatAddress(address);

  if (!useDedicatedSearch) {
    // Free heuristic — scan register text for the word "RESTRICTION".
    const hasRestriction = !!registerExtractText && /RESTRICTION/i.test(registerExtractText);
    const excerpt = registerExtractText
      ? registerExtractText
          .split(/\n/)
          .filter(line => /RESTRICTION|NOTICE|CAUTION/i.test(line))
          .slice(0, 10)
          .join('\n')
      : '';
    await recordCost(ctx, apiName, 0, { status: 'success', titleNumber, propertyAddress: addrStr });
    return {
      ok: true,
      apiName,
      costGbp: 0,
      titleNumber,
      parsedData: { hasRestriction, excerpt, source: 'register_extract' },
    };
  }

  if (!connector) {
    await recordCost(ctx, apiName, 0, { status: 'failed', titleNumber, propertyAddress: addrStr, errorMessage: 'HMLR connector not configured' });
    return { ok: false, apiName, costGbp: 0, titleNumber, errorMessage: 'HMLR Business Gateway credentials not configured' };
  }

  const fee = HMLR_FEES_GBP[apiName];
  const resp = await callHmlr(connector, '/restrictions-search', { titleNumber });
  if (!resp.ok) {
    await recordCost(ctx, apiName, 0, { status: 'failed', titleNumber, propertyAddress: addrStr, errorMessage: resp.error });
    return { ok: false, apiName, costGbp: 0, titleNumber, errorMessage: resp.error };
  }

  await recordCost(ctx, apiName, fee, { status: 'success', titleNumber, propertyAddress: addrStr });
  return { ok: true, apiName, costGbp: fee, titleNumber, parsedData: resp.data };
}

/**
 * Step 6 — Application Enquiry. Reports any in-flight applications against
 * the title, which flags uncompleted transactions at period end.
 */
export async function applicationEnquiry(
  connector: HmlrConnector | null,
  titleNumber: string,
  address: HmlrAddressQuery,
  ctx: HmlrCallContext,
): Promise<HmlrResult> {
  const apiName = 'application_enquiry';
  const fee = HMLR_FEES_GBP[apiName];
  const addrStr = formatAddress(address);

  if (!connector) {
    await recordCost(ctx, apiName, 0, { status: 'failed', titleNumber, propertyAddress: addrStr, errorMessage: 'HMLR connector not configured' });
    return { ok: false, apiName, costGbp: 0, titleNumber, errorMessage: 'HMLR Business Gateway credentials not configured' };
  }

  const resp = await callHmlr(connector, '/application-enquiry', { titleNumber });
  if (!resp.ok) {
    await recordCost(ctx, apiName, 0, { status: 'failed', titleNumber, propertyAddress: addrStr, errorMessage: resp.error });
    return { ok: false, apiName, costGbp: 0, titleNumber, errorMessage: resp.error };
  }

  await recordCost(ctx, apiName, fee, { status: 'success', titleNumber, propertyAddress: addrStr });
  return { ok: true, apiName, costGbp: fee, titleNumber, parsedData: resp.data };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

export function formatAddress(address: HmlrAddressQuery): string {
  return [address.saon, address.paon, address.street, address.town, address.county, address.postcode]
    .filter(Boolean)
    .join(', ');
}
