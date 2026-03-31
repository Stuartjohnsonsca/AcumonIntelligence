import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

const LR_SPARQL_ENDPOINT = 'https://landregistry.data.gov.uk/landregistry/query';

/**
 * POST /api/land-registry
 * Query HM Land Registry for ownership verification or price paid data.
 *
 * Body: { action: 'verify_ownership' | 'price_paid', address: { paon, street, town, postcode, county? } }
 */
export async function POST(req: Request) {
  const session = await auth();
  try {
    const { action, address, clientId } = await req.json();

    if (!address || (!address.postcode && !address.street)) {
      return NextResponse.json({ error: 'Address details required (at least postcode or street)' }, { status: 400 });
    }

    let result: NextResponse;
    if (action === 'price_paid') {
      result = await searchPricePaid(address);
    } else if (action === 'verify_ownership') {
      result = await verifyOwnership(address);
    } else {
      return NextResponse.json({ error: 'Invalid action. Use "verify_ownership" or "price_paid"' }, { status: 400 });
    }

    // Log usage cost (Land Registry API is free/OGL but we track for reporting)
    try {
      if (clientId && session?.user?.id) {
        await prisma.aiUsage.create({
          data: {
            clientId,
            userId: session.user.id,
            action: 'Land Registry Lookup',
            model: 'hmlr-sparql',
            operation: action,
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
            estimatedCostUsd: 0, // Free API — cost is zero
          },
        });
      }
    } catch (costErr) {
      console.error('Failed to log Land Registry usage:', costErr);
    }

    return result;
  } catch (error) {
    console.error('Land Registry API error:', error);
    return NextResponse.json({ error: 'Land Registry lookup failed' }, { status: 500 });
  }
}

/**
 * Search Price Paid Data using SPARQL against Land Registry Linked Data
 */
async function searchPricePaid(address: { paon?: string; street?: string; town?: string; postcode?: string; county?: string }) {
  // Build SPARQL filter conditions
  const filters: string[] = [];
  if (address.paon) {
    // Search with both exact and space-normalised forms for hyphenated PAONs
    // e.g. "1-2" should match "1 - 2", "1-2", "1 -2" etc.
    const raw = sanitiseSparql(address.paon.toUpperCase());
    const spaced = sanitiseSparql(address.paon.toUpperCase().replace(/\s*-\s*/g, ' - '));
    if (raw === spaced) {
      filters.push(`FILTER(CONTAINS(UCASE(STR(?paon)), "${raw}"))`);
    } else {
      filters.push(`FILTER(CONTAINS(UCASE(STR(?paon)), "${raw}") || CONTAINS(UCASE(STR(?paon)), "${spaced}"))`);
    }
  }
  if (address.street) filters.push(`FILTER(CONTAINS(UCASE(STR(?street)), "${sanitiseSparql(address.street.toUpperCase())}"))`);
  if (address.town) filters.push(`FILTER(CONTAINS(UCASE(STR(?town)), "${sanitiseSparql(address.town.toUpperCase())}"))`);
  if (address.postcode) filters.push(`FILTER(CONTAINS(UCASE(STR(?postcode)), "${sanitiseSparql(address.postcode.toUpperCase().replace(/\s+/g, ''))}"))`);

  const sparql = `
    PREFIX lrppi: <http://landregistry.data.gov.uk/def/ppi/>
    PREFIX lrcommon: <http://landregistry.data.gov.uk/def/common/>

    SELECT ?transactionId ?pricePaid ?transactionDate ?propertyType ?estateType ?newBuild
           ?paon ?saon ?street ?locality ?town ?district ?county ?postcode
    WHERE {
      ?transaction lrppi:pricePaid ?pricePaid ;
                   lrppi:transactionDate ?transactionDate ;
                   lrppi:propertyAddress ?addr .

      ?addr lrcommon:paon ?paon ;
            lrcommon:street ?street ;
            lrcommon:town ?town ;
            lrcommon:postcode ?postcode .

      OPTIONAL { ?addr lrcommon:saon ?saon }
      OPTIONAL { ?addr lrcommon:locality ?locality }
      OPTIONAL { ?addr lrcommon:district ?district }
      OPTIONAL { ?addr lrcommon:county ?county }
      OPTIONAL { ?transaction lrppi:propertyType ?propertyType }
      OPTIONAL { ?transaction lrppi:estateType ?estateType }
      OPTIONAL { ?transaction lrppi:newBuild ?newBuild }

      BIND(STR(?transaction) AS ?transactionId)

      ${filters.join('\n      ')}
    }
    ORDER BY DESC(?transactionDate)
    LIMIT 20
  `;

  const res = await fetch(LR_SPARQL_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/sparql-results+json',
    },
    body: `query=${encodeURIComponent(sparql)}`,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error('Land Registry SPARQL error:', res.status, text.slice(0, 500));
    return NextResponse.json({ error: `Land Registry query failed (${res.status})`, results: [] }, { status: 502 });
  }

  const data = await res.json();
  const results = (data.results?.bindings || []).map((b: Record<string, { value: string }>) => ({
    transactionId: b.transactionId?.value || '',
    pricePaid: b.pricePaid?.value ? parseInt(b.pricePaid.value) : null,
    transactionDate: b.transactionDate?.value || '',
    propertyType: extractLabel(b.propertyType?.value),
    estateType: extractLabel(b.estateType?.value),
    newBuild: b.newBuild?.value === 'true',
    address: {
      paon: b.paon?.value || '',
      saon: b.saon?.value || '',
      street: b.street?.value || '',
      locality: b.locality?.value || '',
      town: b.town?.value || '',
      district: b.district?.value || '',
      county: b.county?.value || '',
      postcode: b.postcode?.value || '',
    },
  }));

  return NextResponse.json({
    action: 'price_paid',
    query: address,
    resultCount: results.length,
    results,
  });
}

/**
 * Verify ownership — uses price paid data to show transaction history
 * (full ownership register requires paid HMLR Business Gateway access)
 */
async function verifyOwnership(address: { paon?: string; street?: string; town?: string; postcode?: string }) {
  // Use the same SPARQL search but interpret results as ownership evidence
  const pricePaidResponse = await searchPricePaid(address);
  const body = await pricePaidResponse.json();

  return NextResponse.json({
    action: 'verify_ownership',
    query: address,
    resultCount: body.resultCount || 0,
    results: body.results || [],
    note: 'Ownership verification based on Price Paid Data. For full title register details, the HMLR Business Gateway (paid service) would be required.',
  });
}

function sanitiseSparql(str: string): string {
  return str.replace(/"/g, '\\"').replace(/\\/g, '\\\\');
}

function extractLabel(uri?: string): string {
  if (!uri) return '';
  const parts = uri.split('/');
  return parts[parts.length - 1].replace(/-/g, ' ');
}
